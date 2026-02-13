"use client";

import { useEffect, useRef, useState } from "react";
import { getSignalingUrl } from "@/lib/signaling";
import {
  isKeepaliveSignalMessage,
  isWsIceCandidateMessage,
  isWsOfferMessage,
  parseWsJsonData,
} from "@/lib/webrtc/wsMessageUtils";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const WS_KEEPALIVE_MS = 10_000;

function normalizeWsUrl(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    return getSignalingUrl();
  }

  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;

  if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${trimmed.replace(/^\/+/, "")}`;
  }

  return trimmed;
}

function withRoomQuery(wsUrl: string, roomId: string) {
  try {
    const u = new URL(wsUrl);
    if (!u.pathname.endsWith("/ws")) u.pathname = "/ws";
    if (roomId) u.searchParams.set("room", roomId);
    return u.toString();
  } catch {
    const base = wsUrl.endsWith("/ws") ? wsUrl : `${wsUrl}/ws`;
    if (!roomId) return base;
    return `${base}${base.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
  }
}

export default function RemoteVideo({ roomId, signalingWsUrl }: { roomId: string; signalingWsUrl?: string }) {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualCloseRef = useRef(false);
  const keepaliveTimerRef = useRef<number | null>(null);
  const disconnectedRecoveryTimerRef = useRef<number | null>(null);

  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  const logLine = (line: string) =>
      setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

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

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const clearDisconnectedRecoveryTimer = () => {
    if (disconnectedRecoveryTimerRef.current != null) {
      window.clearTimeout(disconnectedRecoveryTimerRef.current);
      disconnectedRecoveryTimerRef.current = null;
    }
  };

  const closePeer = () => {
    clearDisconnectedRecoveryTimer();

    const pc = pcRef.current;
    if (!pc) return;

    try {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
    } catch {
      // noop
    }

    pcRef.current = null;
  };

  const sendJoin = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ type: "join", roomId, role: "viewer" }));
    logLine("join 送信(viewer)");
  };

  const createPeer = () => {
    closePeer();

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      const video = remoteVideoRef.current;
      if (video) {
        video.srcObject = remoteStream;
        video
            .play()
            .then(() => logLine("リモート映像再生開始"))
            .catch((e) => {
              console.error(e);
            });
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      ws.send(
          JSON.stringify({
            type: "ice-candidate",
            roomId,
            role: "viewer",
            payload: event.candidate,
          }),
      );
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      logLine(`WebRTC状態: ${state}`);

      if (state === "failed" || state === "closed") {
        closePeer();

        // シグナリングが生きていれば再待機状態へ戻す
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          createPeer();
          sendJoin();
        }
        return;
      }

      if (state === "disconnected") {
        clearDisconnectedRecoveryTimer();
        disconnectedRecoveryTimerRef.current = window.setTimeout(() => {
          const cur = pcRef.current;
          if (!cur) return;
          if (cur.connectionState !== "disconnected") return;

          logLine("WebRTC disconnected が継続したため待機再初期化");
          closePeer();

          if (wsRef.current?.readyState === WebSocket.OPEN) {
            createPeer();
            sendJoin();
          }
        }, 5_000);
      } else {
        clearDisconnectedRecoveryTimer();
      }
    };

    return pc;
  };

  const scheduleReconnect = () => {
    if (manualCloseRef.current) return;
    clearReconnectTimer();

    const waitMs = Math.min(15_000, 1000 * 2 ** reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    logLine(`シグナリング再接続を予約 (${Math.round(waitMs / 1000)}s)`);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectSignaling(true);
    }, waitMs);
  };

  const connectSignaling = (isReconnect = false) => {
    if (manualCloseRef.current) return;

    const current = wsRef.current;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearReconnectTimer();

    // ws再接続だけでメディアが維持されるケースを優先。
    // peerが無い場合のみ再作成。
    if (!pcRef.current || pcRef.current.connectionState === "closed" || pcRef.current.connectionState === "failed") {
      createPeer();
    }

    const base = normalizeWsUrl(signalingWsUrl || getSignalingUrl(roomId));
    const url = withRoomQuery(base, roomId);

    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      setError(`無効なSignal URLです: ${url}`);
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      setError(null);
      logLine(`${isReconnect ? "シグナリング再接続" : "シグナリング接続"}: ${url}`);
      startKeepalive(ws);
      sendJoin();
    };

    ws.onmessage = async (event) => {
      const msg = parseWsJsonData(event.data);
      if (!msg) {
        logLine("不正なシグナリングメッセージを無視しました");
        return;
      }

      if (isKeepaliveSignalMessage(msg)) {
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (isWsOfferMessage(msg)) {
        logLine("sender から offer 受信");
        try {
          const desc = new RTCSessionDescription(msg.payload);
          await pc.setRemoteDescription(desc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          ws.send(
              JSON.stringify({
                type: "answer",
                roomId,
                role: "viewer",
                payload: answer,
              }),
          );
          logLine("answer 送信");
        } catch (e) {
          console.error(e);
          logLine(`offer処理失敗: ${String(e)}`);
        }
      } else if (isWsIceCandidateMessage(msg)) {
        try {
          await pc.addIceCandidate(msg.payload);
        } catch (e) {
          console.error(e);
        }
      }
    };

    ws.onerror = (e) => {
      console.error(e);
      setError("シグナリングサーバへの接続に失敗しました");
    };

    ws.onclose = (ev) => {
      stopKeepalive();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      logLine(`シグナリング切断 code=${ev.code} reason=${ev.reason || "(none)"}`);

      // ここでpeerを閉じない: 一時的なWS断でもメディアを維持する
      scheduleReconnect();
    };
  };

  // シグナリング接続 + WebRTC 初期化
  useEffect(() => {
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    connectSignaling(false);

    const recoverIfNeeded = () => {
      if (manualCloseRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connectSignaling(true);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recoverIfNeeded();
      }
    };

    const onOnline = () => {
      recoverIfNeeded();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onVisibilityChange);

    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      stopKeepalive();

      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("fullscreenchange", onVisibilityChange);

      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {
          // noop
        }
        wsRef.current = null;
      }

      closePeer();
    };
    // roomを変えたら再接続し直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, signalingWsUrl]);

  // FPS / 解像度計測
  useEffect(() => {
    let animationId: number;

    const loop = (time: number) => {
      const video = remoteVideoRef.current;
      if (video && video.readyState >= 2) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          setResolution((prev) => (!prev || prev.width !== w || prev.height !== h ? { width: w, height: h } : prev));
        }

        if (lastTimeRef.current == null) {
          lastTimeRef.current = time;
          frameCountRef.current = 0;
        } else {
          frameCountRef.current += 1;
          const delta = time - lastTimeRef.current;
          if (delta >= 1000) {
            const currentFps = Math.round((frameCountRef.current * 1000) / delta);
            setFps(currentFps);
            frameCountRef.current = 0;
            lastTimeRef.current = time;
          }
        }
      }
      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
      <div className="space-y-3">
        <div
            ref={frameRef}
            className="relative w-full h-[60vh] max-h-[70vh] overflow-hidden rounded-xl bg-slate-200 cursor-pointer"
            title="クリックでフルスクリーン切替"
            onClick={() => {
              const frame = frameRef.current;
              if (!frame) return;
              if (document.fullscreenElement) {
                void document.exitFullscreen();
              } else {
                void frame.requestFullscreen();
              }
            }}
        >
          <video ref={remoteVideoRef} className="h-full w-full object-contain" playsInline autoPlay />

        </div>

        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span>FPS: {fps ?? "--"}</span>
          <span>解像度: {resolution ? `${resolution.width} x ${resolution.height}` : "--"}</span>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <details className="mt-2 rounded-xl bg-slate-100 p-2 text-xs text-slate-700">
          <summary className="cursor-pointer select-none">ログ</summary>
          <div className="mt-1 max-h-40 space-y-1 overflow-auto">
            {log.map((l, i) => (
                <div key={i}>{l}</div>
            ))}
          </div>
        </details>
      </div>
  );
}

