"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSignalingUrl } from "@/lib/siganling";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
type Role = "sender" | "viewer";

const STORAGE_KEYS = {
    roomId: "teleco.audioSender.roomId",
    sendEnabled: "teleco.audioSender.sendEnabled",
    autoConnect: "teleco.audioSender.autoConnect",
    micActive: "teleco.audioSender.micActive",
    sendingActive: "teleco.audioSender.sendingActive",
};

const WS_KEEPALIVE_MS = 10_000;

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
        try {
            setError(null);
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
            startKeepalive(ws);
            logLine(isReconnect ? "シグナリング再接続" : "シグナリング接続");
            ws.send(JSON.stringify({ type: "join", roomId, role: "sender" as Role }));

            maybeAutoStartSend();
        };

        ws.onclose = (ev) => {
            if (wsRef.current === ws) wsRef.current = null;
            stopKeepalive();
            setConnected(false);
            logLine(`シグナリング切断 code=${ev.code} reason=${ev.reason || "(none)"}`);

            // WS断では即座にPCを落とさない
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

            if (msg?.type === "__pong" || msg?.type === "keepalive") {
                return;
            }

            if (!pcRef.current) return;

            if (msg.type === "answer") {
                try {
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.payload));
                    logLine("viewer から answer 受信");
                } catch (e) {
                    console.error(e);
                    logLine(`answer処理失敗: ${String(e)}`);
                }
            } else if (msg.type === "ice-candidate") {
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
            if (!isAuto) logLine("送信がOFFです（チェックをONにしてください）");
            return;
        }

        if (!streamRef.current) {
            if (!isAuto) logLine("先にマイクを起動してください");
            return;
        }
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            if (!isAuto) logLine("先にシグナリングへ接続してください");
            return;
        }

        const existingPc = pcRef.current;
        if (existingPc && (existingPc.connectionState === "connected" || existingPc.connectionState === "connecting")) {
            desiredSendingRef.current = true;
            window.localStorage.setItem(STORAGE_KEYS.sendingActive, "1");
            return;
        }

        closePc();

        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        pcRef.current = pc;

        streamRef.current.getTracks().forEach((t) => pc.addTrack(t, streamRef.current!));

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
            logLine(`WebRTC状態: ${state}`);

            if (state === "failed" || state === "closed") {
                if (desiredSendingRef.current) {
                    window.setTimeout(() => {
                        maybeAutoStartSend();
                    }, 500);
                }
            }
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

        desiredSendingRef.current = true;
        window.localStorage.setItem(STORAGE_KEYS.sendingActive, "1");

        logLine(isAuto ? "offer 再送信（自動復旧）" : "offer 送信");
    };

    useEffect(() => {
        const savedRoom = window.localStorage.getItem(STORAGE_KEYS.roomId);
        if (savedRoom) setRoomId(savedRoom);

        const savedSend = window.localStorage.getItem(STORAGE_KEYS.sendEnabled);
        if (savedSend != null) setSendEnabled(savedSend === "1");

        shouldAutoConnectRef.current = window.localStorage.getItem(STORAGE_KEYS.autoConnect) === "1";
        shouldAutoStartMicRef.current = window.localStorage.getItem(STORAGE_KEYS.micActive) === "1";
        desiredSendingRef.current = window.localStorage.getItem(STORAGE_KEYS.sendingActive) === "1";

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
        window.localStorage.setItem(STORAGE_KEYS.sendEnabled, sendEnabled ? "1" : "0");

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

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-3xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-semibold">Audio Sender (別PC用)</h1>
                    <div className="flex items-center gap-3">
                        <Link href="/audio" className="text-sm text-slate-600 hover:text-slate-900">
                            Receiverへ
                        </Link>
                        <Link href="/gui" className="text-sm text-slate-600 hover:text-slate-900">
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
                        <button onClick={startMic} className="rounded-xl bg-slate-900 px-4 py-2 text-white">
                            マイク起動
                        </button>

                        <button
                            onClick={() => {
                                manualCloseRef.current = false;
                                shouldAutoConnectRef.current = true;
                                window.localStorage.setItem(STORAGE_KEYS.autoConnect, "1");
                                connectSignaling(false);
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
                            <input type="checkbox" checked={sendEnabled} onChange={(e) => setSendEnabled(e.target.checked)} />
                            送信を有効化
                        </label>

                        <button
                            onClick={() => void startSend(false)}
                            disabled={!micReady || !connected}
                            className="rounded-xl bg-emerald-600 px-4 py-2 text-white disabled:opacity-60"
                        >
                            Receiverへ送信開始
                        </button>

                        <button
                            onClick={() => {
                                desiredSendingRef.current = false;
                                window.localStorage.setItem(STORAGE_KEYS.sendingActive, "0");
                                shouldAutoConnectRef.current = false;
                                window.localStorage.setItem(STORAGE_KEYS.autoConnect, "0");
                                manualCloseRef.current = true;
                                closePc();
                                closeWs();
                                setConnected(false);
                            }}
                            className="rounded-xl bg-slate-100 px-4 py-2"
                        >
                            接続停止
                        </button>
                    </div>

                    {error && <p className="text-xs text-red-600">{error}</p>}
                </div>

                <div className="rounded-2xl border bg-white p-4 space-y-2">
                    <p className="text-sm text-slate-700">ここで自分のマイク音声を確認できます（ローカル再生）。</p>
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
