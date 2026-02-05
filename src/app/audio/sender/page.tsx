"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSignalingUrl } from "@/lib/siganling";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
type Role = "sender" | "viewer";

const STORAGE_KEYS = {
    roomId: "teleco.audioSender.roomId",
    sendEnabled: "teleco.audioSender.sendEnabled",
};

export default function AudioSenderPage() {
    const [roomId, setRoomId] = useState("audio1");
    const [connected, setConnected] = useState(false);
    const [micReady, setMicReady] = useState(false);
    const [sendEnabled, setSendEnabled] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const localAudioRef = useRef<HTMLAudioElement | null>(null);

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

    const startMic = async () => {
        try {
            setError(null);
            const s = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
            });

            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
            }

            streamRef.current = s;
            setMicReady(true);

            // 自分だけで確認（ローカル再生）
            if (localAudioRef.current) {
                localAudioRef.current.srcObject = s;
                void localAudioRef.current.play().catch(() => {});
            }
            logLine("マイク起動");
        } catch (e) {
            console.error(e);
            setError("マイクの取得に失敗しました（権限を確認してください）");
        }
    };

    const connectSignaling = (isReconnect = false) => {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            return;
        }
        setError(null);
        clearReconnectTimer();

        const ws = new WebSocket(getSignalingUrl());
        wsRef.current = ws;

        ws.onopen = () => {
            setConnected(true);
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
            setError("シグナリングサーバへの接続に失敗しました");
        };

        ws.onmessage = async (event) => {
            let msg: any;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            if (!pcRef.current) return;

            if (msg.type === "answer") {
                await pcRef.current.setRemoteDescription(
                    new RTCSessionDescription(msg.payload),
                );
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

    const startSend = async () => {
        if (!sendEnabled) {
            logLine("送信がOFFです（チェックをONにしてください）");
            return;
        }

        if (!streamRef.current) {
            logLine("先にマイクを起動してください");
            return;
        }
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            logLine("先にシグナリングへ接続してください");
            return;
        }

        closePc();

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
            logLine(`WebRTC状態: ${pc.connectionState}`);
        };

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
        logLine("offer 送信");
    };

    useEffect(() => {
        const savedRoom = window.localStorage.getItem(STORAGE_KEYS.roomId);
        if (savedRoom) setRoomId(savedRoom);

        const savedSend = window.localStorage.getItem(STORAGE_KEYS.sendEnabled);
        if (savedSend != null) setSendEnabled(savedSend === "1");
    }, []);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.roomId, roomId);
    }, [roomId]);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.sendEnabled, sendEnabled ? "1" : "0");
    }, [sendEnabled]);

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

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-3xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-semibold">Audio Sender (別PC用)</h1>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/audio"
                            className="text-sm text-slate-600 hover:text-slate-900"
                        >
                            Receiverへ
                        </Link>
                        <Link
                            href="/gui"
                            className="text-sm text-slate-600 hover:text-slate-900"
                        >
                            GUIへ戻る
                        </Link>
                    </div>
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
                            onClick={startMic}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-white"
                        >
                            マイク起動
                        </button>

                        <button
                            onClick={() => {
                                manualCloseRef.current = false;
                                connectSignaling();
                            }}
                            disabled={connected}
                            className={
                                connected
                                    ? "rounded-xl bg-emerald-600 px-4 py-2 text-white opacity-80"
                                    : "rounded-xl bg-slate-100 px-4 py-2 hover:bg-slate-200"
                            }
                        >
                            {connected ? "シグナリング接続中" : "シグナリング接続"}
                        </button>

                        <label className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
                            <input
                                type="checkbox"
                                checked={sendEnabled}
                                onChange={(e) => setSendEnabled(e.target.checked)}
                            />
                            送信を有効化
                        </label>

                        <button
                            onClick={startSend}
                            disabled={!micReady || !connected}
                            className="rounded-xl bg-emerald-600 px-4 py-2 text-white disabled:opacity-60"
                        >
                            Receiverへ送信開始
                        </button>
                    </div>

                    {error && <p className="text-xs text-red-600">{error}</p>}
                </div>

                <div className="rounded-2xl border bg-white p-4 space-y-2">
                    <p className="text-sm text-slate-700">
                        ここで自分のマイク音声を確認できます（ローカル再生）。
                    </p>
                    <audio ref={localAudioRef} controls autoPlay className="w-full" />
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
