"use client";

import { useEffect, useRef, useState } from "react";
import VideoSenderControlPanel from "@/app/video/_components/VideoSenderControlPanel";
import VideoSenderLogPanel from "@/app/video/_components/VideoSenderLogPanel";
import VideoSenderPreviewPanel from "@/app/video/_components/VideoSenderPreviewPanel";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import {
  buildSignalingBaseUrl,
  buildSignalingUrl,
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
  parseSignalingUrl,
} from "@/lib/signaling";
import {
  isKeepaliveSignalMessage,
  isWsAnswerMessage,
  isWsIceCandidateMessage,
  parseWsJsonData,
} from "@/lib/webrtc/wsMessageUtils";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const STORAGE = {
  roomId: "teleco.video.roomId",
  signalingIpAddress: "teleco.video.signalingIpAddress",
  signalingPort: "teleco.video.signalingPort",
  signalingWsUrlLegacy: "teleco.video.signalingWsUrl",
  autoConnect: "teleco.video.autoConnect",
  cameraActive: "teleco.video.cameraActive",
  streamingActive: "teleco.video.streamingActive",
  cameraDeviceId: "teleco.video.cameraDeviceId",
};
const LEGACY_STORAGE = {
  roomId: "teleco.sender.roomId",
  signalingIpAddress: "teleco.sender.signalingIpAddress",
  signalingPort: "teleco.sender.signalingPort",
  signalingWsUrlLegacy: "teleco.sender.signalingWsUrl",
  autoConnect: "teleco.sender.autoConnect",
  cameraActive: "teleco.sender.cameraActive",
  streamingActive: "teleco.sender.streamingActive",
  cameraDeviceId: "teleco.sender.cameraDeviceId",
};

function getStoredValue(key: keyof typeof STORAGE): string | null {
  if (typeof window === "undefined") return null;
  const next = window.localStorage.getItem(STORAGE[key]);
  if (next != null) return next;
  return window.localStorage.getItem(LEGACY_STORAGE[key]);
}

const WS_KEEPALIVE_MS = 10_000;

const DEFAULT_VIDEO_ROOM =
  process.env.NEXT_PUBLIC_DEFAULT_VIDEO_ROOM || "room1";
const VIDEO_SEND_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_IP_ADDRESS",
];
const VIDEO_SEND_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_PORT",
];

export default function VideoSenderPage() {
  const [roomId, setRoomId] = useState(DEFAULT_VIDEO_ROOM);
  const [signalingIpAddress, setSignalingIpAddress] = useState<string>(
    getDefaultSignalingIpAddress({ envKeys: VIDEO_SEND_SIGNALING_IP_ENV_KEYS }),
  );
  const [signalingPort, setSignalingPort] = useState<string>(
    getDefaultSignalingPort({ envKeys: VIDEO_SEND_SIGNALING_PORT_ENV_KEYS }),
  );

  useEffect(() => {
    scheduleEnvLocalSync({
      NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS: signalingIpAddress,
      NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT: signalingPort,
    });
  }, [signalingIpAddress, signalingPort]);
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
  const shouldAutoStartCameraRef = useRef(false);
  const desiredStreamingRef = useRef(false);

  const logLine = (line: string) =>
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const cameraLabelById = (deviceId: string, indexFallback = 0) => {
    const idx = videoInputs.findIndex((d) => d.deviceId === deviceId);
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
      const cameras = all.filter((d) => d.kind === "videoinput");
      setVideoInputs(cameras);

      if (cameras.length === 0) {
        setSelectedCameraId("");
        return;
      }

      setSelectedCameraId((prev) => {
        if (prev && cameras.some((c) => c.deviceId === prev)) return prev;

        const saved = getStoredValue("cameraDeviceId") || "";
        if (saved && cameras.some((c) => c.deviceId === saved)) return saved;

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
    }, WS_KEEPALIVE_MS);
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

    void startWebRTC(true);
  };

  // カメラ起動
  const startCamera = async (preferredDeviceId?: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      logLine("このブラウザはカメラAPIに対応していません");
      return;
    }

    if (cameraBusy) return;
    setCameraBusy(true);

    const open = (deviceId?: string) =>
      navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        audio: false,
      });

    const targetDeviceId = preferredDeviceId ?? selectedCameraId;

    try {
      let media: MediaStream;
      try {
        media = await open(targetDeviceId || undefined);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        // 保存済みdeviceIdが無効になった場合などはデフォルトカメラへフォールバック
        if (
          targetDeviceId &&
          (name === "OverconstrainedError" || name === "NotFoundError")
        ) {
          logLine(
            "選択中カメラが見つからないため、利用可能なカメラで再試行します",
          );
          media = await open(undefined);
        } else {
          throw err;
        }
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      media.getTracks().forEach((track) => {
        track.onended = () => {
          window.localStorage.setItem(STORAGE.cameraActive, "0");
          window.localStorage.setItem(STORAGE.streamingActive, "0");
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
        window.localStorage.setItem(STORAGE.cameraDeviceId, activeDeviceId);
      }

      window.localStorage.setItem(STORAGE.cameraActive, "1");
      logLine(
        `カメラ起動${activeDeviceId ? `: ${cameraLabelById(activeDeviceId)}` : ""}`,
      );

      // 権限許可後はデバイスラベルが取れるので更新
      await enumerateVideoInputs();

      maybeAutoStartWebRTC();
    } catch (e) {
      console.error(e);
      logLine("カメラ起動に失敗");
    } finally {
      setCameraBusy(false);
    }
  };

  // シグナリングへの接続
  const connectSignaling = (isReconnect = false) => {
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

    const url = buildSignalingUrl({
      ipAddress: signalingIpAddress,
      port: signalingPort,
      roomId,
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
      ws.send(JSON.stringify({ type: "join", roomId, role: "sender" }));

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

      // WSが切れても既存PeerConnectionはすぐには閉じない（メディア継続を優先）
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error(e);
      setWsError("シグナリングサーバへの接続に失敗");
      setWsBusy(false);
    };

    ws.onmessage = async (event) => {
      const msg = parseWsJsonData(event.data);
      if (!msg) {
        return;
      }

      if (isKeepaliveSignalMessage(msg)) {
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (isWsAnswerMessage(msg)) {
        try {
          const desc = new RTCSessionDescription(msg.payload);
          await pc.setRemoteDescription(desc);
          logLine("viewer から answer 受信");
        } catch (e) {
          console.error(e);
          logLine(`answer処理失敗: ${String(e)}`);
        }
      } else if (isWsIceCandidateMessage(msg)) {
        try {
          await pc.addIceCandidate(msg.payload);
        } catch (e) {
          console.error(e);
        }
      }
    };
  };

  // WebRTC 接続開始
  const startWebRTC = async (isAuto = false) => {
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
      existingPc &&
      (existingPc.connectionState === "connected" ||
        existingPc.connectionState === "connecting")
    ) {
      // 既に送信中
      desiredStreamingRef.current = true;
      window.localStorage.setItem(STORAGE.streamingActive, "1");
      setRtcState(existingPc.connectionState);
      return;
    }

    setRtcBusy(true);
    closePc();
    setRtcState("new");

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    // ローカルストリームを全部乗せる
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
          // 自動復旧
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
      window.localStorage.setItem(STORAGE.streamingActive, "1");

      logLine(isAuto ? "offer 再送信（自動復旧）" : "offer 送信");
    } catch (e) {
      console.error(e);
      logLine(`offer送信失敗: ${String(e)}`);
    } finally {
      setRtcBusy(false);
    }
  };

  // video にローカルストリームを表示
  useEffect(() => {
    const v = localVideoRef.current;
    if (!v) return;

    v.srcObject = stream ?? null;
    if (stream) v.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const savedRoom = getStoredValue("roomId");
    if (savedRoom) setRoomId(savedRoom);

    const savedSignalIpAddress = getStoredValue("signalingIpAddress");
    if (savedSignalIpAddress) setSignalingIpAddress(savedSignalIpAddress);

    const savedSignalPort = getStoredValue("signalingPort");
    if (savedSignalPort) setSignalingPort(savedSignalPort);

    const legacySignalUrl = getStoredValue("signalingWsUrlLegacy");
    if (legacySignalUrl) {
      const parsed = parseSignalingUrl(legacySignalUrl);
      if (parsed?.ipAddress) setSignalingIpAddress(parsed.ipAddress);
      if (parsed?.port) setSignalingPort(parsed.port);
      if (parsed?.roomId) setRoomId(parsed.roomId);
    }

    const savedCameraDeviceId = getStoredValue("cameraDeviceId") || "";
    if (savedCameraDeviceId) setSelectedCameraId(savedCameraDeviceId);

    shouldAutoConnectRef.current = getStoredValue("autoConnect") === "1";
    shouldAutoStartCameraRef.current = getStoredValue("cameraActive") === "1";
    desiredStreamingRef.current = getStoredValue("streamingActive") === "1";

    void enumerateVideoInputs();

    if (shouldAutoStartCameraRef.current) {
      void startCamera(savedCameraDeviceId || undefined);
    }

    if (shouldAutoConnectRef.current) {
      manualCloseRef.current = false;
      connectSignaling(false);
    }
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
    window.localStorage.setItem(STORAGE.roomId, roomId);
  }, [roomId]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE.signalingIpAddress, signalingIpAddress);
  }, [signalingIpAddress]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE.signalingPort, signalingPort);
  }, [signalingPort]);

  useEffect(() => {
    if (selectedCameraId) {
      window.localStorage.setItem(STORAGE.cameraDeviceId, selectedCameraId);
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
    const onVisible = () => {
      if (document.visibilityState === "visible") recoverIfNeeded();
    };
    const onPageShow = () => recoverIfNeeded();

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

  // cleanup
  useEffect(() => {
    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();

      closePc();
      closeWs();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCameraLabel = selectedCameraId
    ? cameraLabelById(selectedCameraId)
    : videoInputs.length > 0
      ? cameraLabelById(videoInputs[0].deviceId)
      : "未選択";

  const hasCameraStream = !!stream;
  const wsConnected = connected;
  const rtcConnectingOrConnected =
    rtcState === "connecting" || rtcState === "connected";

  const canStartCamera = !cameraBusy;
  const canConnectSignaling =
    !wsConnected &&
    !wsBusy &&
    roomId.trim().length > 0 &&
    signalingIpAddress.trim().length > 0 &&
    signalingPort.trim().length > 0;
  const canStartStreaming =
    hasCameraStream && wsConnected && !rtcBusy && !rtcConnectingOrConnected;
  const canStopConnection =
    wsConnected || wsBusy || rtcBusy || rtcConnectingOrConnected;

  const startCameraReason = canStartCamera
    ? "カメラを起動できます"
    : "カメラ起動処理中です";

  const connectReason = canConnectSignaling
    ? "シグナリング接続できます"
    : wsConnected
      ? "すでに接続中です"
      : wsBusy
        ? "シグナリング接続処理中です"
        : "Room ID と IP Address / Port を入力してください";

  const signalingWsUrlForDisplay = buildSignalingUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
    roomId,
  });
  const signalingBaseUrlForDisplay = buildSignalingBaseUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
  });

  const startStreamingReason = canStartStreaming
    ? "viewer への配信を開始できます"
    : !hasCameraStream
      ? "先にカメラ起動が必要です"
      : !wsConnected
        ? "先にシグナリング接続が必要です"
        : rtcBusy
          ? "配信開始処理中です"
          : "すでに送信中です";

  const stopReason = canStopConnection
    ? "接続を停止できます"
    : "停止対象がありません";

  const nextActionHint = !hasCameraStream
    ? "次の操作: ① カメラ起動"
    : !wsConnected
      ? "次の操作: ② シグナリング接続"
      : !rtcConnectingOrConnected
        ? "次の操作: ③ viewerへ映像送信開始"
        : "現在: viewerへ映像送信中です";

  const handleCameraChange = (nextId: string) => {
    setSelectedCameraId(nextId);
    window.localStorage.setItem(STORAGE.cameraDeviceId, nextId);

    if (streamRef.current) {
      void startCamera(nextId);
    }
  };

  const handleConnectSignaling = () => {
    manualCloseRef.current = false;
    shouldAutoConnectRef.current = true;
    window.localStorage.setItem(STORAGE.autoConnect, "1");
    connectSignaling();
  };

  const handleStopConnection = () => {
    shouldAutoConnectRef.current = false;
    desiredStreamingRef.current = false;
    window.localStorage.setItem(STORAGE.autoConnect, "0");
    window.localStorage.setItem(STORAGE.streamingActive, "0");
    manualCloseRef.current = true;
    closeWs();
    closePc();
    setRtcBusy(false);
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Sender (別PC用)</h1>
        <VideoSenderControlPanel
          hasCameraStream={hasCameraStream}
          wsConnected={wsConnected}
          wsBusy={wsBusy}
          rtcBusy={rtcBusy}
          rtcState={rtcState}
          nextActionHint={nextActionHint}
          roomId={roomId}
          signalingIpAddress={signalingIpAddress}
          signalingPort={signalingPort}
          connected={connected}
          signalingWsUrlForDisplay={signalingWsUrlForDisplay}
          signalingBaseUrlForDisplay={signalingBaseUrlForDisplay}
          selectedCameraId={selectedCameraId}
          videoInputs={videoInputs}
          canStartCamera={canStartCamera}
          cameraBusy={cameraBusy}
          startCameraReason={startCameraReason}
          canConnectSignaling={canConnectSignaling}
          connectReason={connectReason}
          canStartStreaming={canStartStreaming}
          startStreamingReason={startStreamingReason}
          canStopConnection={canStopConnection}
          stopReason={stopReason}
          wsError={wsError}
          onRoomIdChange={setRoomId}
          onSignalingIpAddressChange={setSignalingIpAddress}
          onSignalingPortChange={setSignalingPort}
          onCameraChange={handleCameraChange}
          onRefreshCameras={() => void enumerateVideoInputs()}
          onStartCamera={() => void startCamera()}
          onConnectSignaling={handleConnectSignaling}
          onStartStreaming={() => void startWebRTC(false)}
          onStopConnection={handleStopConnection}
        />
        <VideoSenderPreviewPanel
          localVideoRef={localVideoRef}
          connected={connected}
          activeCameraLabel={activeCameraLabel}
        />
        <VideoSenderLogPanel log={log} />
      </div>
    </main>
  );
}
