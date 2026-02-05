"use client";

import { useEffect, useRef, useState } from "react";
import { getSignalingUrl } from "@/lib/siganling";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Role = "sender" | "viewer";
const ROOM_ID_STORAGE_KEY = "teleco.sender.roomId";

export default function SenderPage() {
  const [roomId, setRoomId] = useState("room1");
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualCloseRef = useRef(false);

  const logLine = (line: string) =>
      setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const closePc = () => {
    if (!pcRef.current) return;
    try {
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
    } catch {}
    pcRef.current = null;
  };

  const closeWs = () => {
    if (!wsRef.current) return;
    try {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
    } catch {}
    wsRef.current = null;
    setConnected(false);
  };

  const scheduleReconnect = () => {
    if (manualCloseRef.current) return;
    clearReconnectTimer();

    const waitMs = Math.min(15000, 1000 * 2 ** reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    logLine(`シグナリング再接続を予約 (${Math.round(waitMs / 1000)}s)`);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectSignaling(true);
    }, waitMs);
  };

  // カメラ起動
  const startCamera = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      streamRef.current = media;
      setStream(media);
      logLine("カメラ起動");
    } catch (e) {
      console.error(e);
      logLine("カメラ起動に失敗");
    }
  };

  // シグナリングへの接続
  const connectSignaling = (isReconnect = false) => {
    const current = wsRef.current;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearReconnectTimer();
    setWsError(null);

    const ws = new WebSocket(getSignalingUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setWsError(null);
      reconnectAttemptRef.current = 0;
      logLine(isReconnect ? "シグナリング再接続" : "シグナリング接続");
      ws.send(JSON.stringify({ type: "join", roomId, role: "sender" as Role }));
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      setConnected(false);
      logLine("シグナリング切断");
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error(e);
      setWsError("シグナリングサーバへの接続に失敗");
    };

    ws.onmessage = async (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (msg.type === "answer") {
        const desc = new RTCSessionDescription(msg.payload);
        await pc.setRemoteDescription(desc);
        logLine("viewer から answer 受信");
      } else if (msg.type === "ice-candidate") {
        try {
          await pc.addIceCandidate(msg.payload);
        } catch (e) {
          console.error(e);
        }
      }
    };
  };

  // WebRTC 接続開始
  const startWebRTC = async () => {
    const currentStream = streamRef.current;
    if (!currentStream) {
      logLine("先にカメラを起動してください");
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      logLine("先にシグナリングへ接続してください");
      return;
    }

    closePc();

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    // ローカルストリームを全部乗せる
    currentStream.getTracks().forEach((track) => pc.addTrack(track, currentStream));

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
      logLine(`WebRTC状態: ${pc.connectionState}`);
    };

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
    logLine("offer 送信");
  };

  // video にローカルストリームを表示
  useEffect(() => {
    const v = localVideoRef.current;
    if (!v) return;
    v.srcObject = stream ?? null;
    if (stream) v.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const saved = window.localStorage.getItem(ROOM_ID_STORAGE_KEY);
    if (saved) setRoomId(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ROOM_ID_STORAGE_KEY, roomId);
  }, [roomId]);

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

  return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-3xl p-4 space-y-4">
          <h1 className="text-xl font-semibold">Sender (別PC用)</h1>

          <div className="space-y-2 rounded-2xl border bg-white p-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-700">Room ID</label>
              <input
                  className="rounded-xl border px-3 py-1 text-sm"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <button
                  onClick={startCamera}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white"
              >
                カメラ起動
              </button>
              <button
                  onClick={() => {
                    manualCloseRef.current = false;
                    connectSignaling();
                  }}
                  className="rounded-xl bg-slate-100 px-4 py-2"
              >
                シグナリング接続
              </button>
              <button
                  onClick={startWebRTC}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-white"
              >
                viewer へ映像送信開始
              </button>
            </div>
            {wsError && <p className="text-xs text-red-600">{wsError}</p>}
          </div>

          <div className="rounded-2xl border bg-white p-4 space-y-2">
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
              <video
                  ref={localVideoRef}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
              />
            </div>
            <p className="text-xs text-slate-500">
              これは「送信側PCのローカルプレビュー」です。
            </p>
            <p className="text-xs text-slate-500">
              Signal: {connected ? "接続中" : "未接続"}
            </p>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <h2 className="text-sm font-semibold mb-2">ログ</h2>
            <div className="max-h-48 overflow-auto text-xs text-slate-700 space-y-1">
              {log.map((l, i) => (
                  <div key={i}>{l}</div>
              ))}
            </div>
          </div>
        </div>
      </main>
  );
}
