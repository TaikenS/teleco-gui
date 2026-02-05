"use client";

import { useEffect, useRef, useState } from "react";
import { getSignalingUrl } from "@/lib/siganling";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Role = "sender" | "viewer";

export default function RemoteVideo({ roomId }: { roomId: string }) {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
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

  // シグナリング接続 + WebRTC 初期化
  useEffect(() => {
    const ws = new WebSocket(getSignalingUrl());
    wsRef.current = ws;

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
            .catch((e) => console.error(e));
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current?.send(
            JSON.stringify({
              type: "ice-candidate",
              roomId,
              role: "viewer" as Role,
              payload: event.candidate,
            }),
        );
      }
    };

    pc.onconnectionstatechange = () => {
      logLine(`WebRTC状態: ${pc.connectionState}`);
    };

    ws.onopen = () => {
      logLine("シグナリング接続");
      ws.send(JSON.stringify({ type: "join", roomId, role: "viewer" as Role }));
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (!msg) {
        logLine("不正なシグナリングメッセージを無視しました");
        return;
      }
      if (msg.type === "offer") {
        logLine("sender から offer 受信");
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
      } else if (msg.type === "ice-candidate") {
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

    ws.onclose = () => {
      logLine("シグナリング切断");
    };

    return () => {
      pc.close();
      ws.close();
    };
  }, [roomId]);

  // FPS / 解像度計測
  useEffect(() => {
    let animationId: number;

    const loop = (time: number) => {
      const video = remoteVideoRef.current;
      if (video && video.readyState >= 2) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          setResolution((prev) =>
              !prev || prev.width !== w || prev.height !== h
                  ? { width: w, height: h }
                  : prev,
          );
        }

        if (lastTimeRef.current == null) {
          lastTimeRef.current = time;
          frameCountRef.current = 0;
        } else {
          frameCountRef.current += 1;
          const delta = time - lastTimeRef.current;
          if (delta >= 1000) {
            const currentFps = Math.round(
                (frameCountRef.current * 1000) / delta,
            );
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
            className="w-full h-[60vh] max-h-[70vh] overflow-hidden rounded-xl bg-slate-200 cursor-pointer"
            title="クリックでフルスクリーン切替"
            onClick={() => {
              const el = remoteVideoRef.current;
              if (!el) return;
              if (document.fullscreenElement) {
                void document.exitFullscreen();
              } else {
                void el.requestFullscreen();
              }
            }}
        >
          <video
              ref={remoteVideoRef}
              className="h-full w-full object-contain"
              playsInline
              autoPlay
          />
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span>FPS: {fps ?? "--"}</span>
          <span>
          解像度:{" "}
            {resolution ? `${resolution.width} x ${resolution.height}` : "--"}
        </span>
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
