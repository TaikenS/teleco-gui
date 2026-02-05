"use client";

import { useEffect, useRef, useState } from "react";
import { getSignalingUrl } from "@/lib/siganling";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Role = "sender" | "viewer";

export default function SenderPage() {
  const [roomId, setRoomId] = useState("room1"); // 適当な部屋名
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const logLine = (line: string) =>
      setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  // カメラ起動
  const startCamera = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(media);
      logLine("カメラ起動");
    } catch (e) {
      console.error(e);
      logLine("カメラ起動に失敗");
    }
  };

  // シグナリングへの接続
  const connectSignaling = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(getSignalingUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setWsError(null);
      logLine("シグナリング接続");
      ws.send(JSON.stringify({ type: "join", roomId, role: "sender" as Role }));
    };

    ws.onclose = () => {
      setConnected(false);
      logLine("シグナリング切断");
    };

    ws.onerror = (e) => {
      console.error(e);
      setWsError("シグナリングサーバへの接続に失敗");
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (!pcRef.current) return;
      if (msg.type === "answer") {
        const desc = new RTCSessionDescription(msg.payload);
        await pcRef.current.setRemoteDescription(desc);
        logLine("viewer から answer 受信");
      } else if (msg.type === "ice-candidate") {
        try {
          await pcRef.current.addIceCandidate(msg.payload);
        } catch (e) {
          console.error(e);
        }
      }
    };
  };

  // WebRTC 接続開始
  const startWebRTC = async () => {
    if (!stream) {
      logLine("先にカメラを起動してください");
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      logLine("先にシグナリングへ接続してください");
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    // ローカルストリームを全部乗せる
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current?.send(
            JSON.stringify({
              type: "ice-candidate",
              roomId,
              role: "sender",
              payload: event.candidate,
            }),
        );
      }
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

  // cleanup
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      wsRef.current?.close();
    };
  }, [stream]);

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
                  onClick={connectSignaling}
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
