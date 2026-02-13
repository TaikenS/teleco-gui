"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSignalingUrl } from "@/lib/signaling";
import {
    isKeepaliveSignalMessage,
    isWsAnswerMessage,
    isWsIceCandidateMessage,
    parseWsJsonData,
} from "@/lib/webrtc/wsMessageUtils";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const STORAGE_KEYS = {
    roomId: "teleco.audioSender.roomId",
    signalingWsUrl: "teleco.audioSender.signalingWsUrl",
    sendEnabled: "teleco.audioSender.sendEnabled",
    autoConnect: "teleco.audioSender.autoConnect",
    micActive: "teleco.audioSender.micActive",
    sendingActive: "teleco.audioSender.sendingActive",
};

const WS_KEEPALIVE_MS = 10_000;
const DEFAULT_AUDIO_ROOM = process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM || "audio1";

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

export default function AudioSenderPage() {
    const [roomId, setRoomId] = useState(DEFAULT_AUDIO_ROOM);
    const [signalingWsUrl, setSignalingWsUrl] = useState<string>(() => getSignalingUrl(DEFAULT_AUDIO_ROOM));
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
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            return;
        }
        setError(null);
        setWsBusy(true);
        clearReconnectTimer();

        const base = normalizeWsUrl(signalingWsUrl);
        const url = withRoomQuery(base, roomId);

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
            logLine(`${isReconnect ? "シグナリング再接続" : "シグナリング接続"}: ${url}`);
            ws.send(JSON.stringify({ type: "join", roomId, role: "sender" }));

            maybeAutoStartSend();
        };

        ws.onclose = (ev) => {
            if (wsRef.current === ws) wsRef.current = null;
            stopKeepalive();
            setConnected(false);
            setWsBusy(false);
            logLine(`シグナリング切断 code=${ev.code} reason=${ev.reason || "(none)"}`);

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
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.payload));
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
        if (existingPc && (existingPc.connectionState === "connected" || existingPc.connectionState === "connecting")) {
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

        const savedSignalWsUrl = window.localStorage.getItem(STORAGE_KEYS.signalingWsUrl);
        if (savedSignalWsUrl) setSignalingWsUrl(savedSignalWsUrl);

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
        window.localStorage.setItem(STORAGE_KEYS.signalingWsUrl, signalingWsUrl);
    }, [signalingWsUrl]);

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

    const sendLive = rtcState === "connected" || rtcState === "connecting";
    const canConnectSignal = !connected && !wsBusy && roomId.trim().length > 0 && signalingWsUrl.trim().length > 0;
    const canStartSend = micReady && connected && sendEnabled && !sendBusy && !sendLive;
    const canStopConnection = connected || wsBusy || sendBusy || sendLive;
    const canStartMic = !micBusy;

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
                    <div className="status-chip-row">
                        <span className={`status-chip ${micReady ? "is-on" : micBusy ? "is-busy" : "is-off"}`}>
                            Mic {micReady ? "READY" : micBusy ? "STARTING" : "OFF"}
                        </span>
                        <span className={`status-chip ${connected ? "is-on" : wsBusy ? "is-busy" : "is-off"}`}>
                            Signal {connected ? "CONNECTED" : wsBusy ? "CONNECTING" : "OFFLINE"}
                        </span>
                        <span className={`status-chip ${rtcState === "connected" ? "is-on" : sendBusy || rtcState === "connecting" ? "is-busy" : "is-off"}`}>
                            Send {rtcState === "connected" ? "LIVE" : sendBusy || rtcState === "connecting" ? "STARTING" : "IDLE"}
                        </span>
                    </div>

                    <p className="action-state-hint" role="status" aria-live="polite">
                        {!micReady
                            ? "次の操作: ① マイク起動"
                            : !connected
                                ? "次の操作: ② シグナリング接続"
                                : !sendEnabled
                                    ? "次の操作: ③ 「送信を有効化」をON"
                                    : !sendLive
                                        ? "次の操作: ④ Receiverへ送信開始"
                                        : "現在: Receiverへ音声送信中です"}
                    </p>

                    <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-700">Room ID</label>
                        <input
                            className="rounded-xl border px-3 py-1 text-sm"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            disabled={connected || wsBusy}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm text-slate-700">Signaling WS URL</label>
                        <input
                            className="w-full rounded-xl border px-3 py-2 text-sm"
                            value={signalingWsUrl}
                            onChange={(e) => setSignalingWsUrl(e.target.value)}
                            disabled={connected || wsBusy}
                            placeholder="ws://192.168.1.12:3000/ws"
                        />
                        <p className="text-[11px] text-slate-500">
                            送信先Receiver側GUIのSignal URLを指定（例: ws://192.168.1.12:3000/ws）。
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm">
                        <div className="action-button-wrap">
                            <button
                                onClick={startMic}
                                className="action-button bg-slate-900 text-white"
                                disabled={!canStartMic}
                                data-disabled-label="利用不可"
                                data-busy={micBusy ? "1" : "0"}
                                aria-busy={micBusy}
                            >
                                {micBusy ? "マイク起動中..." : "マイク起動"}
                            </button>
                            <p className={`button-reason ${canStartMic ? "is-ready" : "is-disabled"}`}>
                                {micBusy ? "マイク起動処理中です" : micReady ? "マイク準備OKです" : "マイクを起動できます"}
                            </p>
                        </div>

                        <div className="action-button-wrap">
                            <button
                                onClick={() => {
                                    manualCloseRef.current = false;
                                    shouldAutoConnectRef.current = true;
                                    window.localStorage.setItem(STORAGE_KEYS.autoConnect, "1");
                                    connectSignaling(false);
                                }}
                                disabled={!canConnectSignal}
                                className="action-button bg-slate-100"
                                data-disabled-label="利用不可"
                                data-busy={wsBusy ? "1" : "0"}
                                aria-busy={wsBusy}
                            >
                                {wsBusy ? "接続中..." : "シグナリング接続"}
                            </button>
                            <p className={`button-reason ${canConnectSignal ? "is-ready" : "is-disabled"}`}>
                                {!roomId.trim() || !signalingWsUrl.trim()
                                    ? "Room ID と Signal URL を入力してください"
                                    : connected
                                        ? "すでに接続中です"
                                        : wsBusy
                                            ? "接続処理中です"
                                            : "シグナリング接続できます"}
                            </p>
                        </div>

                        <div className="action-button-wrap">
                            <label className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
                                <input type="checkbox" checked={sendEnabled} onChange={(e) => setSendEnabled(e.target.checked)} />
                                送信を有効化
                            </label>
                            <p className={`button-reason ${sendEnabled ? "is-ready" : "is-disabled"}`}>
                                {sendEnabled ? "送信開始ボタンを押せます" : "ONにすると送信開始できます"}
                            </p>
                        </div>

                        <div className="action-button-wrap">
                            <button
                                onClick={() => void startSend(false)}
                                disabled={!canStartSend}
                                className="action-button bg-emerald-600 text-white"
                                data-disabled-label="利用不可"
                                data-busy={sendBusy ? "1" : "0"}
                                aria-busy={sendBusy}
                            >
                                {sendBusy ? "開始中..." : "Receiverへ送信開始"}
                            </button>
                            <p className={`button-reason ${canStartSend ? "is-ready" : "is-disabled"}`}>
                                {!micReady
                                    ? "先にマイク起動が必要です"
                                    : !connected
                                        ? "先にシグナリング接続が必要です"
                                        : !sendEnabled
                                            ? "先に「送信を有効化」をONにしてください"
                                            : sendBusy
                                                ? "送信開始処理中です"
                                                : sendLive
                                                    ? "すでに送信中です"
                                                    : "Receiverへ送信できます"}
                            </p>
                        </div>

                        <div className="action-button-wrap">
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
                                className="action-button bg-slate-100"
                                disabled={!canStopConnection}
                                data-disabled-label="利用不可"
                            >
                                接続停止
                            </button>
                            <p className={`button-reason ${canStopConnection ? "is-ready" : "is-disabled"}`}>
                                {canStopConnection ? "接続を停止できます" : "停止対象がありません"}
                            </p>
                        </div>
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

