import { useEffect, useRef, useState } from "react";
import {
  AUDIO_RECEIVE_SIGNALING_IP_ENV_KEYS,
  AUDIO_RECEIVE_SIGNALING_PORT_ENV_KEYS,
  DEFAULT_AUDIO_ROOM,
  HAS_DEFAULT_AUDIO_ROOM_ENV,
  DEFAULT_SIGNALING_IP_ADDRESS,
  DEFAULT_SIGNALING_PORT,
  STORAGE_KEYS,
  WS_KEEPALIVE_MS,
} from "@/app/audio/controller/constants";
import { ensurePeerConnection } from "@/app/audio/controller/peer";
import { parseSignalingUrl } from "@/lib/signaling";
import {
  isKeepaliveSignalMessage,
  isLegacyTypedSignalMessage,
  isWsAudioIceRequestMessage,
  isWsAudioRequestMessage,
  isWsLabelMessage,
  parseWsJsonData,
} from "@/lib/webrtc/wsMessageUtils";

function nowTime() {
  return new Date().toLocaleTimeString();
}

type AudioOutputOption = {
  deviceId: string;
  label: string;
};

function canSetSinkId(audio: HTMLAudioElement | null): audio is HTMLAudioElement & {
  setSinkId: (sinkId: string) => Promise<void>;
} {
  return !!audio && "setSinkId" in audio;
}

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

export function useAudioReceiverSignaling() {
  const HAS_AUDIO_RECEIVE_SIGNALING_IP_ENV =
    AUDIO_RECEIVE_SIGNALING_IP_ENV_KEYS.some(
      (key) => !!process.env[key]?.trim(),
    );
  const HAS_AUDIO_RECEIVE_SIGNALING_PORT_ENV =
    AUDIO_RECEIVE_SIGNALING_PORT_ENV_KEYS.some(
      (key) => !!process.env[key]?.trim(),
    );

  const [roomId, setRoomId] = useState<string>(DEFAULT_AUDIO_ROOM);
  const [signalingIpAddress, setSignalingIpAddress] = useState<string>(
    DEFAULT_SIGNALING_IP_ADDRESS,
  );
  const [signalingPort, setSignalingPort] = useState<string>(
    DEFAULT_SIGNALING_PORT,
  );

  const [connected, setConnected] = useState<boolean>(false);
  const [wsBusy, setWsBusy] = useState<boolean>(false);
  const [hasAudioTrack, setHasAudioTrack] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [audioOutputOptions, setAudioOutputOptions] = useState<
    AudioOutputOption[]
  >([]);
  const [selectedAudioOutputId, setSelectedAudioOutputId] =
    useState<string>("default");

  const wsRef = useRef<WebSocket | null>(null);
  const keepaliveTimerRef = useRef<number | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const shouldAutoConnectRef = useRef(false);

  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sinkSelectionSupported =
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;

  const logLine = (line: string) =>
    setLog((prev) => [...prev, `[${nowTime()}] ${line}`]);

  const applyAudioOutput = async (deviceId: string) => {
    const audio = audioRef.current;
    if (!canSetSinkId(audio)) return;

    try {
      await audio.setSinkId(deviceId);
      logLine(`出力デバイス切替: ${deviceId}`);
    } catch (e) {
      setError(`出力デバイスの切替に失敗しました: ${String(e)}`);
      logLine(`setSinkId failed: ${String(e)}`);
    }
  };

  const refreshAudioOutputs = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      const options = outputs.map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Audio Output ${index + 1}`,
      }));

      setAudioOutputOptions(options);

      if (!options.some((d) => d.deviceId === selectedAudioOutputId)) {
        const fallbackId = options[0]?.deviceId || "default";
        setSelectedAudioOutputId(fallbackId);
      }
    } catch (e) {
      logLine(`enumerateDevices(audiooutput) failed: ${String(e)}`);
    }
  };

  const handleAudioOutputChange = (deviceId: string) => {
    setSelectedAudioOutputId(deviceId);
    window.localStorage.setItem(STORAGE_KEYS.outputDeviceId, deviceId);
    void applyAudioOutput(deviceId);
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

  const scheduleReconnect = () => {
    if (manualDisconnectRef.current) return;
    if (!shouldAutoConnectRef.current) return;

    clearReconnectTimer();

    const waitMs = Math.min(15_000, 1000 * 2 ** reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;

    logLine(`再接続を予約 (${Math.round(waitMs / 1000)}s)`);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connect(true);
    }, waitMs);
  };

  const cleanupAllPeers = () => {
    for (const [token, pc] of pcsRef.current.entries()) {
      try {
        pc.close();
      } catch {
        // noop
      }
      pcsRef.current.delete(token);
      streamsRef.current.delete(token);
    }
    setHasAudioTrack(false);
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  };

  const cleanupWs = () => {
    stopKeepalive();
    try {
      wsRef.current?.close();
    } catch {
      // noop
    }
    wsRef.current = null;
    setConnected(false);
    setWsBusy(false);
  };

  const sendWs = (obj: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  };

  const sendJoin = () => {
    sendWs({ type: "join", roomId, role: "viewer" });
    logLine(`join送信 roomId=${roomId} role=viewer`);
  };

  const connect = (
    isReconnect = false,
    target?: { ipAddress?: string; port?: string; roomId?: string },
  ) => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    manualDisconnectRef.current = false;
    clearReconnectTimer();
    setError(null);
    setWsBusy(true);

    const ipAddress = (target?.ipAddress ?? signalingIpAddress).trim();
    const port = (target?.port ?? signalingPort).trim();
    const room = (target?.roomId ?? roomId).trim();

    const url = new URL(`ws://${ipAddress}:${port}/ws`);
    url.searchParams.set("room", room);

    const wsUrl = url.toString();
    logLine(`Signaling接続開始: ${wsUrl}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      setWsBusy(false);
      setError(`Signaling URL が不正です: ${wsUrl}`);
      logLine(`WS URL invalid: ${String(e)}`);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setWsBusy(false);
      reconnectAttemptRef.current = 0;
      startKeepalive(ws);
      logLine(
        isReconnect ? "シグナリング再接続(open)" : "シグナリング接続(open)",
      );
      sendJoin();
    };

    ws.onclose = (ev) => {
      if (wsRef.current === ws) wsRef.current = null;
      setConnected(false);
      setWsBusy(false);
      stopKeepalive();
      logLine(
        `シグナリング切断(close) code=${ev.code} reason=${ev.reason || "(none)"}`,
      );
      scheduleReconnect();
    };

    ws.onerror = () => {
      setError(`シグナリングサーバへの接続に失敗しました。URL=${wsUrl}`);
      logLine(`WS error (URL=${wsUrl})`);
      setWsBusy(false);
    };

    ws.onmessage = async (event) => {
      const msg = parseWsJsonData(event.data);
      if (!msg) {
        logLine("WS message parse failed");
        return;
      }

      if (isKeepaliveSignalMessage(msg)) {
        return;
      }

      if (isWsAudioRequestMessage(msg) || isWsAudioIceRequestMessage(msg)) {
        const token = msg.id_call_token;
        const destination = msg.destination || "";

        if (msg.label === "callAudioRequest") {
          logLine(`callAudioRequest受信 (token=${token})`);

          const pc = ensurePeerConnection({
            token,
            destination,
            pcsRef,
            streamsRef,
            audioRef,
            setHasAudioTrack,
            logLine,
            sendWs,
          });

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            logLine("setRemoteDescription(offer) ok");

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            logLine("createAnswer/setLocalDescription ok");

            sendWs({
              label: "callAudioAnswer",
              destination,
              id_call_token: token,
              sdp: { type: answer.type, sdp: answer.sdp ?? "" },
            });
            logLine(`callAudioAnswer送信 (token=${token})`);
          } catch (e) {
            logLine(`offer handling failed: ${String(e)}`);
          }
          return;
        }

        if (msg.label === "audioIceCandidaterequest") {
          const pc =
            pcsRef.current.get(token) ||
            ensurePeerConnection({
              token,
              destination,
              pcsRef,
              streamsRef,
              audioRef,
              setHasAudioTrack,
              logLine,
              sendWs,
            });

          try {
            await pc.addIceCandidate(msg.candidate);
            logLine(`addIceCandidate ok (token=${token})`);
          } catch (e) {
            logLine(`addIceCandidate failed (token=${token}): ${String(e)}`);
          }
          return;
        }
      }

      if (isWsLabelMessage(msg)) {
        logLine(`WS label=${msg.label} (no-op)`);
        return;
      }

      if (isLegacyTypedSignalMessage(msg)) {
        logLine(`WS msg type=${msg.type} (legacy/no-op)`);
        return;
      }

      logLine("WS msg unknown format");
    };
  };

  const disconnect = () => {
    manualDisconnectRef.current = true;
    shouldAutoConnectRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.autoConnect, "0");

    clearReconnectTimer();
    logLine("手動切断");
    cleanupWs();
    cleanupAllPeers();
    setConnected(false);
  };

  const handleConnect = () => {
    manualDisconnectRef.current = false;
    shouldAutoConnectRef.current = true;
    window.localStorage.setItem(STORAGE_KEYS.autoConnect, "1");
    connect(false);
  };

  useEffect(() => {
    void (async () => {
      let nextRoomId = roomId;
      let nextSignalingIpAddress = signalingIpAddress;
      let nextSignalingPort = signalingPort;

      const savedRoomId = window.localStorage.getItem(STORAGE_KEYS.roomId);
      if (savedRoomId) {
        nextRoomId = savedRoomId;
        setRoomId(savedRoomId);
      }

      const savedSignalIpAddress = window.localStorage.getItem(
        STORAGE_KEYS.signalingIpAddress,
      );
      if (!HAS_AUDIO_RECEIVE_SIGNALING_IP_ENV && savedSignalIpAddress) {
        nextSignalingIpAddress = savedSignalIpAddress;
        setSignalingIpAddress(savedSignalIpAddress);
      }

      const savedSignalPort = window.localStorage.getItem(
        STORAGE_KEYS.signalingPort,
      );
      if (!HAS_AUDIO_RECEIVE_SIGNALING_PORT_ENV && savedSignalPort) {
        nextSignalingPort = savedSignalPort;
        setSignalingPort(savedSignalPort);
      }

      const legacySignalUrl = window.localStorage.getItem(
        STORAGE_KEYS.signalingWsUrlLegacy,
      );
      if (legacySignalUrl) {
        const parsed = parseSignalingUrl(legacySignalUrl);
        if (!HAS_AUDIO_RECEIVE_SIGNALING_IP_ENV && parsed?.ipAddress) {
          nextSignalingIpAddress = parsed.ipAddress;
          setSignalingIpAddress(parsed.ipAddress);
        }
        if (!HAS_AUDIO_RECEIVE_SIGNALING_PORT_ENV && parsed?.port) {
          nextSignalingPort = parsed.port;
          setSignalingPort(parsed.port);
        }
        if (parsed?.roomId) {
          nextRoomId = parsed.roomId;
          setRoomId(parsed.roomId);
        }
      }

      if (HAS_DEFAULT_AUDIO_ROOM_ENV) {
        nextRoomId = DEFAULT_AUDIO_ROOM;
        setRoomId(DEFAULT_AUDIO_ROOM);
      }

      try {
        const res = await fetch("/api/env-local", { cache: "no-store" });
        const data = (await res.json()) as {
          ok?: boolean;
          values?: Record<string, string>;
        };
        const values = data?.values;
        if (values) {
          const envIpAddress = getFirstValue(
            values,
            AUDIO_RECEIVE_SIGNALING_IP_ENV_KEYS,
          );
          const envPort = getFirstValue(
            values,
            AUDIO_RECEIVE_SIGNALING_PORT_ENV_KEYS,
          );
          if (envIpAddress) {
            nextSignalingIpAddress = envIpAddress;
            setSignalingIpAddress(envIpAddress);
          }
          if (envPort) {
            nextSignalingPort = envPort;
            setSignalingPort(envPort);
          }
        }
      } catch {
        // noop
      }

      shouldAutoConnectRef.current =
        window.localStorage.getItem(STORAGE_KEYS.autoConnect) === "1";

      const savedOutputDeviceId = window.localStorage.getItem(
        STORAGE_KEYS.outputDeviceId,
      );
      if (savedOutputDeviceId) {
        setSelectedAudioOutputId(savedOutputDeviceId);
      }

      void refreshAudioOutputs();

      if (shouldAutoConnectRef.current) {
        manualDisconnectRef.current = false;
        connect(false, {
          ipAddress: nextSignalingIpAddress,
          port: nextSignalingPort,
          roomId: nextRoomId,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.roomId, roomId);
  }, [roomId]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEYS.signalingIpAddress,
      signalingIpAddress,
    );
  }, [signalingIpAddress]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.signalingPort, signalingPort);
  }, [signalingPort]);

  useEffect(() => {
    if (!sinkSelectionSupported) return;
    void applyAudioOutput(selectedAudioOutputId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAudioOutputId, sinkSelectionSupported]);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;

    const onDeviceChange = () => {
      void refreshAudioOutputs();
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        onDeviceChange,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const recoverIfNeeded = () => {
      if (manualDisconnectRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        if (shouldAutoConnectRef.current) {
          connect(true);
        }
      }
    };

    const onOnline = () => recoverIfNeeded();
    const onPageShow = () => recoverIfNeeded();
    const onVisible = () => {
      if (document.visibilityState === "visible") recoverIfNeeded();
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
      manualDisconnectRef.current = true;
      clearReconnectTimer();
      cleanupWs();
      cleanupAllPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    connected,
    wsBusy,
    hasAudioTrack,
    error,
    log,
    audioRef,
    audioOutputOptions,
    selectedAudioOutputId,
    sinkSelectionSupported,
    roomId,
    signalingIpAddress,
    signalingPort,
    setRoomId,
    setSignalingIpAddress,
    setSignalingPort,
    refreshAudioOutputs,
    handleAudioOutputChange,
    handleConnect,
    disconnect,
  };
}
