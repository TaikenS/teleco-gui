"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AudioSenderControlPanel from "@/app/audio/sender/_components/AudioSenderControlPanel";
import AudioSenderLogPanel from "@/app/audio/sender/_components/AudioSenderLogPanel";
import AudioSenderMonitorPanel from "@/app/audio/sender/_components/AudioSenderMonitorPanel";
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

const STORAGE_KEYS = {
  roomId: "teleco.audioSender.roomId",
  signalingIpAddress: "teleco.audioSender.signalingIpAddress",
  signalingPort: "teleco.audioSender.signalingPort",
  signalingWsUrlLegacy: "teleco.audioSender.signalingWsUrl",
  sendEnabled: "teleco.audioSender.sendEnabled",
  autoConnect: "teleco.audioSender.autoConnect",
  micActive: "teleco.audioSender.micActive",
  sendingActive: "teleco.audioSender.sendingActive",
};

const WS_KEEPALIVE_MS = 10_000;
const DEFAULT_AUDIO_ROOM =
  process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM || "audio1";
const AUDIO_SEND_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_SENDER_SIGNALING_IP_ADDRESS",
];
const AUDIO_SEND_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_AUDIO_SENDER_SIGNALING_PORT",
];

export default function AudioSenderPage() {
  const [roomId, setRoomId] = useState(DEFAULT_AUDIO_ROOM);
  const [signalingIpAddress, setSignalingIpAddress] = useState<string>(
    getDefaultSignalingIpAddress({ envKeys: AUDIO_SEND_SIGNALING_IP_ENV_KEYS }),
  );
  const [signalingPort, setSignalingPort] = useState<string>(
    getDefaultSignalingPort({ envKeys: AUDIO_SEND_SIGNALING_PORT_ENV_KEYS }),
  );

  useEffect(() => {
    scheduleEnvLocalSync({
      NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS: signalingIpAddress,
      NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT: signalingPort,
    });
  }, [signalingIpAddress, signalingPort]);
  const [connected, setConnected] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [sendEnabled, setSendEnabled] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [wsBusy, setWsBusy] = useState(false);
  const [rtcState, setRtcState] = useState<RTCPeerConnectionState>("new");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const localAudioRef = useRef<HTMLAudioElement | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualCloseRef = useRef(false);
  const keepaliveTimerRef = useRef<number | null>(null);

  const shouldAutoConnectRef = useRef(false);
  const shouldAutoStartMicRef = useRef(false);
  const desiredSendingRef = useRef(false);

  const logLine = (line: string) =>
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

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
    setSendBusy(false);
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

  const maybeAutoStartSend = () => {
    if (!desiredSendingRef.current) return;
    if (!sendEnabled) return;
    if (!streamRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    void startSend(true);
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

  const startMic = async () => {
    if (micBusy) return;
    try {
      setError(null);
      setMicBusy(true);
      const s = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      s.getTracks().forEach((track) => {
        track.onended = () => {
          setMicReady(false);
          window.localStorage.setItem(STORAGE_KEYS.micActive, "0");
          window.localStorage.setItem(STORAGE_KEYS.sendingActive, "0");
          desiredSendingRef.current = false;
          logLine("マイクトラックが終了しました");
        };
      });

      streamRef.current = s;
      setMicReady(true);
      window.localStorage.setItem(STORAGE_KEYS.micActive, "1");

      if (localAudioRef.current) {
        localAudioRef.current.srcObject = s;
        void localAudioRef.current.play().catch(() => {});
      }
      logLine("マイク起動");

      maybeAutoStartSend();
    } catch (e) {
      console.error(e);
      setError("マイクの取得に失敗しました（権限を確認してください）");
    } finally {
      setMicBusy(false);
    }
  };

  const connectSignaling = (isReconnect = false) => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    setError(null);
    setWsBusy(true);
    clearReconnectTimer();

    const url = buildSignalingUrl({
      ipAddress: signalingIpAddress,
      port: signalingPort,
      roomId,
    });

    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      setError(`無効なSignal URLです: ${url}`);
      setWsBusy(false);
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setWsBusy(false);
      reconnectAttemptRef.current = 0;
      startKeepalive(ws);
      logLine(
        `${isReconnect ? "シグナリング再接続" : "シグナリング接続"}: ${url}`,
      );
      ws.send(JSON.stringify({ type: "join", roomId, role: "sender" }));

      maybeAutoStartSend();
    };

    ws.onclose = (ev) => {
      if (wsRef.current === ws) wsRef.current = null;
      stopKeepalive();
      setConnected(false);
      setWsBusy(false);
      logLine(
        `シグナリング切断 code=${ev.code} reason=${ev.reason || "(none)"}`,
      );

      // WS断では即座にPCを落とさない
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error(e);
      setError("シグナリングサーバへの接続に失敗しました");
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

      if (!pcRef.current) return;

      if (isWsAnswerMessage(msg)) {
        try {
          await pcRef.current.setRemoteDescription(
            new RTCSessionDescription(msg.payload),
          );
          logLine("viewer から answer 受信");
        } catch (e) {
          console.error(e);
          logLine(`answer処理失敗: ${String(e)}`);
        }
      } else if (isWsIceCandidateMessage(msg)) {
        try {
          await pcRef.current.addIceCandidate(msg.payload);
        } catch (e) {
          console.error(e);
        }
      }
    };
  };

  const startSend = async (isAuto = false) => {
    if (!sendEnabled) {
      setSendBusy(false);
      if (!isAuto) logLine("送信がOFFです（チェックをONにしてください）");
      return;
    }

    if (!streamRef.current) {
      setSendBusy(false);
      if (!isAuto) logLine("先にマイクを起動してください");
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setSendBusy(false);
      if (!isAuto) logLine("先にシグナリングへ接続してください");
      return;
    }

    const existingPc = pcRef.current;
    if (
      existingPc &&
      (existingPc.connectionState === "connected" ||
        existingPc.connectionState === "connecting")
    ) {
      desiredSendingRef.current = true;
      window.localStorage.setItem(STORAGE_KEYS.sendingActive, "1");
      setRtcState(existingPc.connectionState);
      setSendBusy(false);
      return;
    }

    closePc();
    setRtcState("new");
    setSendBusy(true);

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    streamRef.current
      .getTracks()
      .forEach((t) => pc.addTrack(t, streamRef.current!));

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
        if (desiredSendingRef.current) {
          window.setTimeout(() => {
            maybeAutoStartSend();
          }, 500);
        }
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsRef.current.send(
        JSON.stringify({
          type: "offer",
          roomId,
          role: "sender",
          payload: offer,
        }),
      );

      desiredSendingRef.current = true;
      window.localStorage.setItem(STORAGE_KEYS.sendingActive, "1");

      logLine(isAuto ? "offer 再送信（自動復旧）" : "offer 送信");
    } catch (e) {
      console.error(e);
      setError("音声送信の開始に失敗しました");
      logLine(`offer送信失敗: ${String(e)}`);
    } finally {
      setSendBusy(false);
    }
  };

  useEffect(() => {
    const savedRoom = window.localStorage.getItem(STORAGE_KEYS.roomId);
    if (savedRoom) setRoomId(savedRoom);

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

    const savedSend = window.localStorage.getItem(STORAGE_KEYS.sendEnabled);
    if (savedSend != null) setSendEnabled(savedSend === "1");

    shouldAutoConnectRef.current =
      window.localStorage.getItem(STORAGE_KEYS.autoConnect) === "1";
    shouldAutoStartMicRef.current =
      window.localStorage.getItem(STORAGE_KEYS.micActive) === "1";
    desiredSendingRef.current =
      window.localStorage.getItem(STORAGE_KEYS.sendingActive) === "1";

    if (shouldAutoStartMicRef.current) {
      void startMic();
    }

    if (shouldAutoConnectRef.current) {
      manualCloseRef.current = false;
      connectSignaling(false);
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
    window.localStorage.setItem(
      STORAGE_KEYS.sendEnabled,
      sendEnabled ? "1" : "0",
    );

    if (!sendEnabled) {
      desiredSendingRef.current = false;
      window.localStorage.setItem(STORAGE_KEYS.sendingActive, "0");
    }
  }, [sendEnabled]);

  useEffect(() => {
    const recoverIfNeeded = () => {
      if (manualCloseRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        if (shouldAutoConnectRef.current) {
          connectSignaling(true);
        }
      }

      maybeAutoStartSend();
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
      manualCloseRef.current = true;
      clearReconnectTimer();

      closeWs();
      closePc();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendLive = rtcState === "connected" || rtcState === "connecting";
  const canConnectSignal =
    !connected &&
    !wsBusy &&
    roomId.trim().length > 0 &&
    signalingIpAddress.trim().length > 0 &&
    signalingPort.trim().length > 0;
  const canStartSend =
    micReady && connected && sendEnabled && !sendBusy && !sendLive;
  const canStopConnection = connected || wsBusy || sendBusy || sendLive;
  const canStartMic = !micBusy;

  const signalingWsUrlForDisplay = buildSignalingUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
    roomId,
  });
  const signalingBaseUrlForDisplay = buildSignalingBaseUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
  });

  const handleConnectSignaling = () => {
    manualCloseRef.current = false;
    shouldAutoConnectRef.current = true;
    window.localStorage.setItem(STORAGE_KEYS.autoConnect, "1");
    connectSignaling(false);
  };

  const handleStopConnection = () => {
    desiredSendingRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.sendingActive, "0");
    shouldAutoConnectRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.autoConnect, "0");
    manualCloseRef.current = true;
    closePc();
    closeWs();
    setConnected(false);
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Audio Sender (別PC用)</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/audio"
              prefetch={false}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Receiverへ
            </Link>
            <Link
              href="/gui"
              prefetch={false}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              GUIへ戻る
            </Link>
          </div>
        </div>

        <AudioSenderControlPanel
          micReady={micReady}
          micBusy={micBusy}
          connected={connected}
          wsBusy={wsBusy}
          sendBusy={sendBusy}
          rtcState={rtcState}
          roomId={roomId}
          signalingIpAddress={signalingIpAddress}
          signalingPort={signalingPort}
          signalingWsUrlForDisplay={signalingWsUrlForDisplay}
          signalingBaseUrlForDisplay={signalingBaseUrlForDisplay}
          sendEnabled={sendEnabled}
          canStartMic={canStartMic}
          canConnectSignal={canConnectSignal}
          canStartSend={canStartSend}
          canStopConnection={canStopConnection}
          error={error}
          onRoomIdChange={setRoomId}
          onSignalingIpAddressChange={setSignalingIpAddress}
          onSignalingPortChange={setSignalingPort}
          onStartMic={startMic}
          onConnectSignal={handleConnectSignaling}
          onSendEnabledChange={setSendEnabled}
          onStartSend={() => void startSend(false)}
          onStopConnection={handleStopConnection}
        />

        <AudioSenderMonitorPanel localAudioRef={localAudioRef} />
        <AudioSenderLogPanel log={log} />
      </div>
    </main>
  );
}
