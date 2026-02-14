"use client";

import { useEffect, useRef, useState } from "react";
import AudioReceiverControlPanel from "@/app/audio/_components/AudioReceiverControlPanel";
import AudioReceiverLogPanel from "@/app/audio/_components/AudioReceiverLogPanel";
import AudioReceiverPlaybackPanel from "@/app/audio/_components/AudioReceiverPlaybackPanel";
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
  isLegacyTypedSignalMessage,
  isWsAudioIceRequestMessage,
  isWsAudioRequestMessage,
  isWsLabelMessage,
  parseWsJsonData,
} from "@/lib/webrtc/wsMessageUtils";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const WS_KEEPALIVE_MS = 10_000;

const STORAGE_KEYS = {
  roomId: "teleco.audio.roomId",
  signalingIpAddress: "teleco.audio.signalingIpAddress",
  signalingPort: "teleco.audio.signalingPort",
  signalingWsUrlLegacy: "teleco.audio.signalingWsUrl",
  autoConnect: "teleco.audio.autoConnect",
};

const DEFAULT_AUDIO_ROOM =
  process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM || "audio1";
const AUDIO_SIGNALING_IP_ENV_KEYS = ["NEXT_PUBLIC_AUDIO_SIGNALING_IP_ADDRESS"];
const AUDIO_SIGNALING_PORT_ENV_KEYS = ["NEXT_PUBLIC_AUDIO_SIGNALING_PORT"];

function nowTime() {
  return new Date().toLocaleTimeString();
}

export default function AudioReceiverPage() {
  const [roomId, setRoomId] = useState<string>(DEFAULT_AUDIO_ROOM);
  const [signalingIpAddress, setSignalingIpAddress] = useState<string>(
    getDefaultSignalingIpAddress({ envKeys: AUDIO_SIGNALING_IP_ENV_KEYS }),
  );
  const [signalingPort, setSignalingPort] = useState<string>(
    getDefaultSignalingPort({ envKeys: AUDIO_SIGNALING_PORT_ENV_KEYS }),
  );

  useEffect(() => {
    scheduleEnvLocalSync({
      NEXT_PUBLIC_AUDIO_SIGNALING_IP_ADDRESS: signalingIpAddress,
      NEXT_PUBLIC_AUDIO_SIGNALING_PORT: signalingPort,
    });
  }, [signalingIpAddress, signalingPort]);

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

  // token -> PeerConnection
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  // token -> MediaStream（受信音声）
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const logLine = (line: string) =>
    setLog((prev) => [...prev, `[${nowTime()}] ${line}`]);

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

  function clearReconnectTimer() {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function stopKeepalive() {
    if (keepaliveTimerRef.current != null) {
      window.clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
  }

  function startKeepalive(ws: WebSocket) {
    stopKeepalive();

    keepaliveTimerRef.current = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      try {
        ws.send(JSON.stringify({ type: "keepalive", roomId, ts: Date.now() }));
      } catch {
        // noop
      }
    }, WS_KEEPALIVE_MS);
  }

  function scheduleReconnect() {
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
  }

  function cleanupAllPeers() {
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
  }

  function cleanupWs() {
    stopKeepalive();
    try {
      wsRef.current?.close();
    } catch {
      // noop
    }
    wsRef.current = null;
    setConnected(false);
    setWsBusy(false);
  }

  function sendWs(obj: unknown) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function sendJoin() {
    sendWs({ type: "join", roomId, role: "viewer" });
    logLine(`join送信 roomId=${roomId} role=viewer`);
  }

  function ensurePc(token: string, destination: string) {
    let pc = pcsRef.current.get(token);
    if (pc) return pc;

    pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcsRef.current.set(token, pc);

    // 受信トラック -> stream に集約して audio 要素へ
    pc.ontrack = (ev) => {
      let stream = streamsRef.current.get(token);
      if (!stream) {
        stream = new MediaStream();
        streamsRef.current.set(token, stream);
      }
      stream.addTrack(ev.track);
      setHasAudioTrack(true);

      const audio = audioRef.current;
      if (audio) {
        audio.srcObject = stream;
        void audio.play().then(
          () => logLine(`audio.play() ok (token=${token})`),
          (e) => logLine(`audio.play() blocked: ${String(e)}`),
        );
      }
      logLine(`ontrack: kind=${ev.track.kind} token=${token}`);
    };

    // ICE: teleco互換として「response」を返す側（Receiver=teleco側）
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      sendWs({
        label: "audioIceCandidateresponse",
        destination,
        id_call_token: token,
        candidate: ev.candidate,
      });
      logLine(`ICE -> audioIceCandidateresponse (token=${token})`);
    };

    pc.onconnectionstatechange = () => {
      const state = pc!.connectionState;
      logLine(`WebRTC state (token=${token}): ${state}`);

      if (state === "failed" || state === "closed") {
        try {
          pc?.close();
        } catch {
          // noop
        }
        pcsRef.current.delete(token);
        streamsRef.current.delete(token);

        if (streamsRef.current.size === 0) {
          setHasAudioTrack(false);
          if (audioRef.current) {
            audioRef.current.srcObject = null;
          }
        }
      }
    };

    return pc;
  }

  const connect = (isReconnect = false) => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    )
      return;

    manualDisconnectRef.current = false;
    clearReconnectTimer();
    setError(null);
    setWsBusy(true);

    const url = buildSignalingUrl({
      ipAddress: signalingIpAddress,
      port: signalingPort,
      roomId,
    });

    logLine(`Signaling接続開始: ${url}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setWsBusy(false);
      setError(`Signaling URL が不正です: ${url}`);
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

      // 以前はここでcleanupAllPeersしていたが、
      // 一時的なWS断で音声を切らないため保持する。
      scheduleReconnect();
    };

    ws.onerror = () => {
      setError(`シグナリングサーバへの接続に失敗しました。URL=${url}`);
      logLine(`WS error (URL=${url})`);
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
        const m = msg;

        const token = m.id_call_token;
        const destination = m.destination || "";

        if (m.label === "callAudioRequest") {
          logLine(`callAudioRequest受信 (token=${token})`);

          const pc = ensurePc(token, destination);

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
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

        if (m.label === "audioIceCandidaterequest") {
          const pc = pcsRef.current.get(token);
          if (!pc) {
            logLine(`ICE request before offer -> create PC (token=${token})`);
          }
          const pc2 = pc ?? ensurePc(token, destination);

          try {
            await pc2.addIceCandidate(m.candidate);
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

  const canConnect =
    !connected &&
    !wsBusy &&
    roomId.trim().length > 0 &&
    signalingIpAddress.trim().length > 0 &&
    signalingPort.trim().length > 0;
  const canDisconnect = connected || wsBusy;
  const signalingWsUrlForDisplay = buildSignalingUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
    roomId,
  });
  const signalingBaseUrlForDisplay = buildSignalingBaseUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
  });

  const handleConnect = () => {
    manualDisconnectRef.current = false;
    shouldAutoConnectRef.current = true;
    window.localStorage.setItem(STORAGE_KEYS.autoConnect, "1");
    connect(false);
  };

  const handleOpenWsDebug = () => {
    window.open("/ws", "_blank");
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            Audio Receiver（別PC用 / label方式 Teleco互換）
          </h1>
        </div>
        <AudioReceiverControlPanel
          connected={connected}
          wsBusy={wsBusy}
          hasAudioTrack={hasAudioTrack}
          signalingIpAddress={signalingIpAddress}
          signalingPort={signalingPort}
          roomId={roomId}
          signalingWsUrlForDisplay={signalingWsUrlForDisplay}
          signalingBaseUrlForDisplay={signalingBaseUrlForDisplay}
          canConnect={canConnect}
          canDisconnect={canDisconnect}
          error={error}
          onSignalingIpAddressChange={setSignalingIpAddress}
          onSignalingPortChange={setSignalingPort}
          onRoomIdChange={setRoomId}
          onConnect={handleConnect}
          onDisconnect={disconnect}
          onOpenWsDebug={handleOpenWsDebug}
        />
        <AudioReceiverPlaybackPanel audioRef={audioRef} />
        <AudioReceiverLogPanel log={log} />
      </div>
    </main>
  );
}
