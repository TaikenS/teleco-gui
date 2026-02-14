import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_AUDIO_ROOM,
  DEFAULT_SIGNALING_IP_ADDRESS,
  DEFAULT_SIGNALING_PORT,
  STORAGE_KEYS,
  WS_KEEPALIVE_MS,
} from "@/app/audio/_controller/constants";
import { ensurePeerConnection } from "@/app/audio/_controller/peer";
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

export function useAudioReceiverSignaling() {
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

  const wsRef = useRef<WebSocket | null>(null);
  const keepaliveTimerRef = useRef<number | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const shouldAutoConnectRef = useRef(false);

  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const logLine = (line: string) =>
    setLog((prev) => [...prev, `[${nowTime()}] ${line}`]);

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

  const connect = (isReconnect = false) => {
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

    const url = new URL(`ws://${signalingIpAddress}:${signalingPort}/ws`);
    url.searchParams.set("room", roomId);

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
    const savedRoomId = window.localStorage.getItem(STORAGE_KEYS.roomId);
    if (savedRoomId) setRoomId(savedRoomId);

    const savedSignalIpAddress = window.localStorage.getItem(
      STORAGE_KEYS.signalingIpAddress,
    );
    if (savedSignalIpAddress) setSignalingIpAddress(savedSignalIpAddress);

    const savedSignalPort = window.localStorage.getItem(
      STORAGE_KEYS.signalingPort,
    );
    if (savedSignalPort) setSignalingPort(savedSignalPort);

    const legacySignalUrl = window.localStorage.getItem(
      STORAGE_KEYS.signalingWsUrlLegacy,
    );
    if (legacySignalUrl) {
      const parsed = parseSignalingUrl(legacySignalUrl);
      if (parsed?.ipAddress) setSignalingIpAddress(parsed.ipAddress);
      if (parsed?.port) setSignalingPort(parsed.port);
      if (parsed?.roomId) setRoomId(parsed.roomId);
    }

    shouldAutoConnectRef.current =
      window.localStorage.getItem(STORAGE_KEYS.autoConnect) === "1";
    if (shouldAutoConnectRef.current) {
      manualDisconnectRef.current = false;
      connect(false);
    }
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
    roomId,
    signalingIpAddress,
    signalingPort,
    setRoomId,
    setSignalingIpAddress,
    setSignalingPort,
    handleConnect,
    disconnect,
  };
}
