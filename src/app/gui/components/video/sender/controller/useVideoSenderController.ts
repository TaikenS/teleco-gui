"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_VIDEO_ROOM,
  DEFAULT_VIDEO_SIGNALING_IP_ADDRESS,
  DEFAULT_VIDEO_SIGNALING_PORT,
  HAS_DEFAULT_VIDEO_ROOM_ENV,
  HAS_VIDEO_SIGNALING_IP_ENV,
  HAS_VIDEO_SIGNALING_PORT_ENV,
  VIDEO_SEND_SIGNALING_IP_ENV_KEYS,
  VIDEO_SEND_SIGNALING_PORT_ENV_KEYS,
  VIDEO_SENDER_STORAGE,
  VIDEO_SENDER_WS_KEEPALIVE_MS,
  STUN_SERVERS,
  getStoredVideoSenderValue,
} from "@/app/gui/components/video/sender/controller/constants";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import { buildSignalingUrl, parseSignalingUrl } from "@/lib/signaling";
import {
  isKeepaliveSignalMessage,
  isWsAnswerMessage,
  isWsIceCandidateMessage,
  parseWsJsonData,
} from "@/lib/webrtc/wsMessageUtils";

type EnvLocalResponse = {
  ok?: boolean;
  values?: Record<string, string>;
};

function getFirstValue(
  values: Record<string, string>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = values[key];
    if (value?.trim()) return value.trim();
  }
  return null;
}

async function getRuntimeVideoSignalDefaults(): Promise<{
  ipAddress: string | null;
  port: string | null;
}> {
  try {
    const res = await fetch("/api/env-local", { cache: "no-store" });
    const data = (await res.json()) as EnvLocalResponse;
    const values = data?.values;
    if (!values) return { ipAddress: null, port: null };

    return {
      ipAddress: getFirstValue(values, VIDEO_SEND_SIGNALING_IP_ENV_KEYS),
      port: getFirstValue(values, VIDEO_SEND_SIGNALING_PORT_ENV_KEYS),
    };
  } catch {
    return { ipAddress: null, port: null };
  }
}

export function useVideoSenderController() {
  const [roomId, setRoomId] = useState(DEFAULT_VIDEO_ROOM);
  const [signalingIpAddress, setSignalingIpAddress] = useState(
    DEFAULT_VIDEO_SIGNALING_IP_ADDRESS,
  );
  const [signalingPort, setSignalingPort] = useState(
    DEFAULT_VIDEO_SIGNALING_PORT,
  );
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [wsBusy, setWsBusy] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [rtcBusy, setRtcBusy] = useState(false);
  const [rtcState, setRtcState] = useState<RTCPeerConnectionState>("new");
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualCloseRef = useRef(false);
  const keepaliveTimerRef = useRef<number | null>(null);

  const shouldAutoConnectRef = useRef(false);
  const desiredStreamingRef = useRef(false);
  const didInitSettingsRef = useRef(false);
  const didEditSignalSettingsRef = useRef(false);

  const logLine = (line: string) =>
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const cameraLabelById = (deviceId: string, indexFallback = 0) => {
    const idx = videoInputs.findIndex((device) => device.deviceId === deviceId);
    if (idx >= 0) {
      const target = videoInputs[idx];
      return target.label?.trim() || `カメラ ${idx + 1}`;
    }
    return `カメラ ${indexFallback + 1}`;
  };

  const enumerateVideoInputs = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cameras = all.filter((device) => device.kind === "videoinput");
      setVideoInputs(cameras);

      if (cameras.length === 0) {
        setSelectedCameraId("");
        return;
      }

      setSelectedCameraId((prev) => {
        if (prev && cameras.some((camera) => camera.deviceId === prev)) {
          return prev;
        }

        const saved = getStoredVideoSenderValue("cameraDeviceId") || "";
        if (saved && cameras.some((camera) => camera.deviceId === saved)) {
          return saved;
        }

        return cameras[0].deviceId;
      });
    } catch (e) {
      console.error(e);
      logLine("カメラ一覧の取得に失敗");
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const stopKeepalive = () => {
    if (keepaliveTimerRef.current != null) {
      window.clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
  };

  const startKeepalive = (ws: WebSocket) => {
    stopKeepalive();

    keepaliveTimerRef.current = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      try {
        ws.send(JSON.stringify({ type: "keepalive", roomId, ts: Date.now() }));
      } catch {
        // noop
      }
    }, VIDEO_SENDER_WS_KEEPALIVE_MS);
  };

  const closePc = () => {
    if (!pcRef.current) return;

    try {
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
    } catch {
      // noop
    }

    pcRef.current = null;
    setRtcState("closed");
  };

  const closeWs = () => {
    stopKeepalive();
    if (!wsRef.current) return;

    try {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
    } catch {
      // noop
    }

    wsRef.current = null;
    setConnected(false);
    setWsBusy(false);
  };

  const scheduleReconnect = () => {
    if (manualCloseRef.current) return;
    if (!shouldAutoConnectRef.current) return;

    clearReconnectTimer();

    const waitMs = Math.min(15_000, 1000 * 2 ** reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    logLine(`シグナリング再接続を予約 (${Math.round(waitMs / 1000)}s)`);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectSignaling(true);
    }, waitMs);
  };

  const maybeAutoStartWebRTC = () => {
    if (!desiredStreamingRef.current) return;
    if (!streamRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    void startWebRTC({ isAuto: true });
  };

  const startCamera = async (preferredDeviceId?: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      logLine("このブラウザはカメラAPIに対応していません");
      return;
    }

    if (cameraBusy) return;
    setCameraBusy(true);

    const targetDeviceId = preferredDeviceId ?? selectedCameraId;

    try {
      const buildVideoConstraints = (
        deviceId?: string,
        withIdealSize = true,
      ): MediaTrackConstraints => ({
        ...(withIdealSize
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {}),
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      });

      const attempts: Array<{
        label: string;
        constraints: MediaStreamConstraints;
      }> = [];

      if (targetDeviceId) {
        attempts.push({
          label: "選択カメラ + 1280x720",
          constraints: {
            video: buildVideoConstraints(targetDeviceId, true),
            audio: false,
          },
        });
        attempts.push({
          label: "選択カメラ（解像度指定なし）",
          constraints: {
            video: buildVideoConstraints(targetDeviceId, false),
            audio: false,
          },
        });
        attempts.push({
          label: "既定カメラ + 1280x720",
          constraints: {
            video: buildVideoConstraints(undefined, true),
            audio: false,
          },
        });
      } else {
        attempts.push({
          label: "既定カメラ + 1280x720",
          constraints: {
            video: buildVideoConstraints(undefined, true),
            audio: false,
          },
        });
      }

      attempts.push({
        label: "既定カメラ（video:true）",
        constraints: { video: true, audio: false },
      });

      let media: MediaStream | null = null;
      let lastError: unknown = null;

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        try {
          media = await navigator.mediaDevices.getUserMedia(
            attempt.constraints,
          );
          if (i > 0) {
            logLine(`カメラ起動フォールバック成功: ${attempt.label}`);
          }
          break;
        } catch (err) {
          lastError = err;
          const errName =
            err instanceof DOMException ? err.name : "UnknownError";
          if (i < attempts.length - 1) {
            logLine(`カメラ起動リトライ: ${attempt.label} -> ${errName}`);
          }
        }
      }

      if (!media) {
        throw lastError ?? new Error("No camera stream acquired");
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      media.getTracks().forEach((track) => {
        track.onended = () => {
          window.localStorage.setItem(VIDEO_SENDER_STORAGE.cameraActive, "0");
          window.localStorage.setItem(
            VIDEO_SENDER_STORAGE.streamingActive,
            "0",
          );
          desiredStreamingRef.current = false;
          logLine("カメラトラックが終了しました");
        };
      });

      streamRef.current = media;
      setStream(media);

      const activeTrack = media.getVideoTracks()[0];
      const activeDeviceId =
        (activeTrack?.getSettings?.().deviceId as string | undefined) ||
        targetDeviceId ||
        "";

      if (activeDeviceId) {
        setSelectedCameraId(activeDeviceId);
        window.localStorage.setItem(
          VIDEO_SENDER_STORAGE.cameraDeviceId,
          activeDeviceId,
        );
      }

      const settings = activeTrack?.getSettings?.();
      if (settings?.width && settings?.height) {
        logLine(`カメラ設定: ${settings.width}x${settings.height}`);
      }

      window.localStorage.setItem(VIDEO_SENDER_STORAGE.cameraActive, "1");
      logLine(
        `カメラ起動${activeDeviceId ? `: ${cameraLabelById(activeDeviceId)}` : ""}`,
      );

      await enumerateVideoInputs();
    } catch (e) {
      console.error(e);
      const errName = e instanceof DOMException ? e.name : "UnknownError";
      const errMessage =
        e instanceof Error ? e.message : typeof e === "string" ? e : "";
      logLine(
        `カメラ起動に失敗: ${errName}${errMessage ? ` (${errMessage})` : ""}`,
      );
    } finally {
      setCameraBusy(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setStream(null);
    desiredStreamingRef.current = false;
    setRtcBusy(false);
    closePc();

    window.localStorage.setItem(VIDEO_SENDER_STORAGE.cameraActive, "0");
    window.localStorage.setItem(VIDEO_SENDER_STORAGE.streamingActive, "0");
    logLine("カメラ停止");
  };

  const connectSignaling = (
    isReconnect = false,
    target?: { ipAddress?: string; port?: string; roomId?: string },
  ) => {
    const current = wsRef.current;
    if (
      current &&
      (current.readyState === WebSocket.OPEN ||
        current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setWsBusy(true);
    clearReconnectTimer();
    setWsError(null);

    const ipAddress = (target?.ipAddress ?? signalingIpAddress).trim();
    const port = (target?.port ?? signalingPort).trim();
    const room = (target?.roomId ?? roomId).trim();

    const url = buildSignalingUrl({
      ipAddress,
      port,
      roomId: room,
    });

    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      setWsError(`無効なSignal URLです: ${url}`);
      setWsBusy(false);
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setWsError(null);
      setWsBusy(false);
      reconnectAttemptRef.current = 0;

      startKeepalive(ws);

      logLine(
        `${isReconnect ? "シグナリング再接続" : "シグナリング接続"}: ${url}`,
      );
      ws.send(JSON.stringify({ type: "join", roomId: room, role: "sender" }));

      maybeAutoStartWebRTC();
    };

    ws.onclose = (ev) => {
      if (wsRef.current === ws) wsRef.current = null;
      stopKeepalive();
      setConnected(false);
      setWsBusy(false);
      logLine(
        `シグナリング切断 code=${ev.code} reason=${ev.reason || "(none)"}`,
      );

      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error(e);
      setWsError("シグナリングサーバへの接続に失敗");
      setWsBusy(false);
    };

    ws.onmessage = async (event) => {
      const msg = parseWsJsonData(event.data);
      if (!msg || isKeepaliveSignalMessage(msg)) return;

      if (typeof msg === "object" && msg !== null) {
        const msgObj = msg as Record<string, unknown>;
        if (
          msgObj.type === "peer-joined" &&
          msgObj.role === "viewer" &&
          desiredStreamingRef.current &&
          streamRef.current
        ) {
          logLine("viewer 参加通知を受信。offer を再送します");
          void startWebRTC({ isAuto: true, forceRestart: true });
          return;
        }
      }

      if (isWsAnswerMessage(msg)) {
        const pc = pcRef.current;
        if (!pc) return;

        try {
          const desc = new RTCSessionDescription(msg.payload);
          await pc.setRemoteDescription(desc);
          logLine("viewer から answer 受信");
        } catch (e) {
          console.error(e);
          logLine(`answer処理失敗: ${String(e)}`);
        }
        return;
      }

      if (isWsIceCandidateMessage(msg)) {
        const pc = pcRef.current;
        if (!pc) return;

        try {
          await pc.addIceCandidate(msg.payload);
        } catch (e) {
          console.error(e);
        }
      }
    };
  };

  const startWebRTC = async (options?: {
    isAuto?: boolean;
    forceRestart?: boolean;
  }) => {
    const isAuto = options?.isAuto ?? false;
    const forceRestart = options?.forceRestart ?? false;

    if (rtcBusy) return;

    const currentStream = streamRef.current;
    if (!currentStream) {
      if (!isAuto) logLine("先にカメラを起動してください");
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (!isAuto) logLine("先にシグナリングへ接続してください");
      return;
    }

    const existingPc = pcRef.current;
    if (
      !forceRestart &&
      existingPc &&
      (existingPc.connectionState === "connected" ||
        existingPc.connectionState === "connecting")
    ) {
      desiredStreamingRef.current = true;
      window.localStorage.setItem(VIDEO_SENDER_STORAGE.streamingActive, "1");
      setRtcState(existingPc.connectionState);
      return;
    }

    if (forceRestart && existingPc) {
      logLine("viewer参加を検知したため WebRTC を再ネゴシエーションします");
    }

    setRtcBusy(true);
    closePc();
    setRtcState("new");

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    currentStream
      .getTracks()
      .forEach((track) => pc.addTrack(track, currentStream));

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      wsRef.current?.send(
        JSON.stringify({
          type: "ice-candidate",
          roomId,
          role: "sender",
          payload: event.candidate,
        }),
      );
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setRtcState(state);
      logLine(`WebRTC状態: ${state}`);

      if (state === "failed" || state === "closed") {
        if (desiredStreamingRef.current) {
          window.setTimeout(() => {
            maybeAutoStartWebRTC();
          }, 500);
        }
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsRef.current?.send(
        JSON.stringify({
          type: "offer",
          roomId,
          role: "sender",
          payload: offer,
        }),
      );

      desiredStreamingRef.current = true;
      window.localStorage.setItem(VIDEO_SENDER_STORAGE.streamingActive, "1");

      logLine(isAuto ? "offer 再送信（自動復旧）" : "offer 送信");
    } catch (e) {
      console.error(e);
      logLine(`offer送信失敗: ${String(e)}`);
    } finally {
      setRtcBusy(false);
    }
  };

  useEffect(() => {
    if (!didInitSettingsRef.current) return;
    if (!didEditSignalSettingsRef.current) return;

    scheduleEnvLocalSync({
      NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS: signalingIpAddress,
      NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT: signalingPort,
    });
  }, [signalingIpAddress, signalingPort]);

  useEffect(() => {
    const videoElement = localVideoRef.current;
    if (!videoElement) return;

    videoElement.srcObject = stream ?? null;
    if (stream) videoElement.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    void (async () => {
      const savedRoom = getStoredVideoSenderValue("roomId");
      if (savedRoom) {
        setRoomId(savedRoom);
      }

      const savedSignalIpAddress =
        getStoredVideoSenderValue("signalingIpAddress");
      if (!HAS_VIDEO_SIGNALING_IP_ENV && savedSignalIpAddress) {
        setSignalingIpAddress(savedSignalIpAddress);
      }

      const savedSignalPort = getStoredVideoSenderValue("signalingPort");
      if (!HAS_VIDEO_SIGNALING_PORT_ENV && savedSignalPort) {
        setSignalingPort(savedSignalPort);
      }

      const legacySignalUrl = getStoredVideoSenderValue("signalingWsUrlLegacy");
      if (legacySignalUrl) {
        const parsed = parseSignalingUrl(legacySignalUrl);
        if (!HAS_VIDEO_SIGNALING_IP_ENV && parsed?.ipAddress) {
          setSignalingIpAddress(parsed.ipAddress);
        }
        if (!HAS_VIDEO_SIGNALING_PORT_ENV && parsed?.port) {
          setSignalingPort(parsed.port);
        }
        if (parsed?.roomId) {
          setRoomId(parsed.roomId);
        }
      }

      if (HAS_DEFAULT_VIDEO_ROOM_ENV) {
        setRoomId(DEFAULT_VIDEO_ROOM);
      }

      const runtimeDefaults = await getRuntimeVideoSignalDefaults();
      if (runtimeDefaults.ipAddress && !didEditSignalSettingsRef.current) {
        setSignalingIpAddress(runtimeDefaults.ipAddress);
      }
      if (runtimeDefaults.port && !didEditSignalSettingsRef.current) {
        setSignalingPort(runtimeDefaults.port);
      }

      const savedCameraDeviceId =
        getStoredVideoSenderValue("cameraDeviceId") || "";
      if (savedCameraDeviceId) {
        setSelectedCameraId(savedCameraDeviceId);
      }

      shouldAutoConnectRef.current = false;
      desiredStreamingRef.current = false;
      window.localStorage.setItem(VIDEO_SENDER_STORAGE.autoConnect, "0");
      window.localStorage.setItem(VIDEO_SENDER_STORAGE.cameraActive, "0");
      window.localStorage.setItem(VIDEO_SENDER_STORAGE.streamingActive, "0");

      void enumerateVideoInputs();

      didInitSettingsRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices) return;

    const onDeviceChange = () => {
      void enumerateVideoInputs();
    };

    navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener?.(
        "devicechange",
        onDeviceChange,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIDEO_SENDER_STORAGE.roomId, roomId);
  }, [roomId]);

  useEffect(() => {
    window.localStorage.setItem(
      VIDEO_SENDER_STORAGE.signalingIpAddress,
      signalingIpAddress,
    );
  }, [signalingIpAddress]);

  useEffect(() => {
    window.localStorage.setItem(
      VIDEO_SENDER_STORAGE.signalingPort,
      signalingPort,
    );
  }, [signalingPort]);

  useEffect(() => {
    if (selectedCameraId) {
      window.localStorage.setItem(
        VIDEO_SENDER_STORAGE.cameraDeviceId,
        selectedCameraId,
      );
    }
  }, [selectedCameraId]);

  useEffect(() => {
    const recoverIfNeeded = () => {
      if (manualCloseRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        if (shouldAutoConnectRef.current) {
          connectSignaling(true);
        }
      }

      maybeAutoStartWebRTC();
    };

    const onOnline = () => recoverIfNeeded();
    const onPageShow = () => recoverIfNeeded();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        recoverIfNeeded();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      closePc();
      closeWs();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasCameraStream = !!stream;
  const wsConnected = connected;
  const rtcConnectingOrConnected =
    rtcState === "connecting" || rtcState === "connected";

  const canStartCamera = !cameraBusy && !hasCameraStream;
  const canStopCamera = !cameraBusy && hasCameraStream;
  const canConnectSignaling =
    !wsConnected &&
    !wsBusy &&
    roomId.trim().length > 0 &&
    signalingIpAddress.trim().length > 0 &&
    signalingPort.trim().length > 0;
  const canStartStreaming =
    hasCameraStream && wsConnected && !rtcBusy && !rtcConnectingOrConnected;
  const canStopStreaming = rtcBusy || rtcConnectingOrConnected;
  const canDisconnectSignaling = wsConnected || wsBusy;

  const startCameraReason = canStartCamera
    ? "カメラを起動できます"
    : cameraBusy
      ? "カメラ起動処理中です"
      : "すでにカメラ起動済みです";
  const stopCameraReason = canStopCamera
    ? "カメラを停止できます"
    : cameraBusy
      ? "カメラ起動処理中です"
      : "カメラは停止中です";

  const connectReason = canConnectSignaling
    ? "シグナリング接続できます"
    : wsConnected
      ? "すでに接続中です"
      : wsBusy
        ? "シグナリング接続処理中です"
        : "ルームID / IPアドレス / ポート を入力してください";

  const signalingWsUrlForDisplay = buildSignalingUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
    roomId,
  });

  const startStreamingReason = canStartStreaming
    ? "送信を開始できます"
    : !hasCameraStream
      ? "先にカメラ起動が必要です"
      : !wsConnected
        ? "先にシグナリング接続が必要です"
        : rtcBusy
          ? "配信開始処理中です"
          : "すでに送信中です";
  const stopStreamingReason = canStopStreaming
    ? "送信を停止できます"
    : "現在は送信していません";

  const disconnectReason = canDisconnectSignaling
    ? "シグナリング接続を切断できます"
    : "シグナリングは未接続です";

  const nextActionHint = !hasCameraStream
    ? "次の操作: ① カメラ起動"
    : !wsConnected
      ? "次の操作: ② シグナリング接続"
      : !rtcConnectingOrConnected
        ? "次の操作: ③ 送信開始"
        : "現在: 送信中です";

  const handleCameraChange = (nextId: string) => {
    setSelectedCameraId(nextId);
    window.localStorage.setItem(VIDEO_SENDER_STORAGE.cameraDeviceId, nextId);

    if (streamRef.current) {
      void startCamera(nextId);
    }
  };

  const handleSignalingIpAddressChange = (nextValue: string) => {
    didEditSignalSettingsRef.current = true;
    setSignalingIpAddress(nextValue);
  };

  const handleSignalingPortChange = (nextValue: string) => {
    didEditSignalSettingsRef.current = true;
    setSignalingPort(nextValue);
  };

  const handleConnectSignaling = () => {
    manualCloseRef.current = false;
    shouldAutoConnectRef.current = false;
    window.localStorage.setItem(VIDEO_SENDER_STORAGE.autoConnect, "0");
    connectSignaling();
  };

  const handleDisconnectSignaling = () => {
    shouldAutoConnectRef.current = false;
    desiredStreamingRef.current = false;
    window.localStorage.setItem(VIDEO_SENDER_STORAGE.autoConnect, "0");
    window.localStorage.setItem(VIDEO_SENDER_STORAGE.streamingActive, "0");
    manualCloseRef.current = true;
    closeWs();
    closePc();
    setRtcBusy(false);
  };

  const handleStopStreaming = () => {
    desiredStreamingRef.current = false;
    window.localStorage.setItem(VIDEO_SENDER_STORAGE.streamingActive, "0");
    closePc();
    setRtcBusy(false);
    logLine("送信停止");
  };

  return {
    controlPanelProps: {
      hasCameraStream,
      wsConnected,
      wsBusy,
      rtcBusy,
      rtcState,
      nextActionHint,
      roomId,
      signalingIpAddress,
      signalingPort,
      connected,
      signalingWsUrlForDisplay,
      selectedCameraId,
      videoInputs,
      canStartCamera,
      canStopCamera,
      cameraBusy,
      startCameraReason,
      stopCameraReason,
      canConnectSignaling,
      connectReason,
      canDisconnectSignaling,
      disconnectReason,
      canStartStreaming,
      canStopStreaming,
      startStreamingReason,
      stopStreamingReason,
      wsError,
      onRoomIdChange: setRoomId,
      onSignalingIpAddressChange: handleSignalingIpAddressChange,
      onSignalingPortChange: handleSignalingPortChange,
      onCameraChange: handleCameraChange,
      onRefreshCameras: () => void enumerateVideoInputs(),
      onStartCamera: () => void startCamera(),
      onStopCamera: stopCamera,
      onConnectSignaling: handleConnectSignaling,
      onDisconnectSignaling: handleDisconnectSignaling,
      onStartStreaming: () => void startWebRTC(),
      onStopStreaming: handleStopStreaming,
    },
    previewPanelProps: {
      localVideoRef,
      connected,
      log,
    },
  };
}
