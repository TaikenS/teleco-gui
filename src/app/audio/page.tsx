"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSignalingUrl } from "@/lib/siganling";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
type Role = "sender" | "viewer";

export default function AudioReceiverPage() {
    const [roomId, setRoomId] = useState("audio1");
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const logLine = (line: string) =>
        setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

    const connect = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        setError(null);
        const ws = new WebSocket(getSignalingUrl());
        wsRef.current = ws;

        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        pcRef.current = pc;

        pc.ontrack = (event) => {
            const [remoteStream] = event.streams;
            const audio = audioRef.current;
            if (!audio) return;
            audio.srcObject = remoteStream;
            void audio.play().catch(() => {});
            logLine("リモート音声の受信開始");
        };

        pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            ws.send(
                JSON.stringify({
                    type: "ice-candidate",
                    roomId,
                    role: "viewer" as Role,
                    payload: event.candidate,
                }),
            );
        };

        pc.onconnectionstatechange = () => {
            logLine(`WebRTC状態: ${pc.connectionState}`);
        };

        ws.onopen = () => {
            setConnected(true);
            logLine("シグナリング接続");
            ws.send(JSON.stringify({ type: "join", roomId, role: "viewer" as Role }));
        };

        ws.onclose = () => {
            setConnected(false);
            wsRef.current = null;
            pcRef.current?.close();
            pcRef.current = null;
            logLine("シグナリング切断");
        };

        ws.onerror = (e) => {
            console.error(e);
            setError("シグナリングサーバへの接続に失敗しました");
        };

        ws.onmessage = async (event) => {
            const msg = JSON.parse(event.data);
            if (!msg || !pcRef.current) return;

            if (msg.type === "offer") {
                logLine("sender から offer 受信");
                await pcRef.current.setRemoteDescription(
                    new RTCSessionDescription(msg.payload),
                );
                const answer = await pcRef.current.createAnswer();
                await pcRef.current.setLocalDescription(answer);
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
                    await pcRef.current.addIceCandidate(msg.payload);
                } catch (e) {
                    console.error(e);
                }
            }
        };
    };

    const disconnect = () => {
        wsRef.current?.close();
        wsRef.current = null;
    };

    useEffect(() => {
        return () => {
            wsRef.current?.close();
            pcRef.current?.close();
        };
    }, []);

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-3xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-semibold">Audio Receiver (別PC用)</h1>
                    <Link
                        href="/gui"
                        className="text-sm text-slate-600 hover:text-slate-900"
                    >
                        GUIへ戻る
                    </Link>
                </div>

                <div className="space-y-2 rounded-2xl border bg-white p-4">
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-700">Room ID</label>
                        <input
                            className="rounded-xl border px-3 py-1 text-sm"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            disabled={connected}
                        />
                    </div>

                    <div className="flex flex-wrap gap-2 text-sm">
                        <button
                            onClick={connect}
                            disabled={connected}
                            className={
                                connected
                                    ? "rounded-xl bg-emerald-600 px-4 py-2 text-white opacity-80"
                                    : "rounded-xl bg-slate-100 px-4 py-2 hover:bg-slate-200"
                            }
                        >
                            {connected ? "接続中" : "接続"}
                        </button>
                        <button
                            onClick={disconnect}
                            disabled={!connected}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
                        >
                            切断
                        </button>
                    </div>

                    {error && <p className="text-xs text-red-600">{error}</p>}
                </div>

                <div className="rounded-2xl border bg-white p-4 space-y-2">
                    <p className="text-sm text-slate-700">
                        受信した音声をここで再生します（再生できない場合は、ボタンなどで一度ユーザ操作してから試してください）。
                    </p>
                    <audio ref={audioRef} controls autoPlay className="w-full" />
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
