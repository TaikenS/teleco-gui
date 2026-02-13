"use client";

import { useEffect, useRef, useState } from "react";
import { getSignalingUrl } from "@/lib/signaling";

/**
 * Signalingは WebSocket (/ws)。
 * - 入力が http(s) でも ws(s) に変換
 * - 入力が空なら「現在ページのhost」を使う
 */
function normalizeWsUrl(input: string) {
    const trimmed = input.trim();

    if (!trimmed) {
        return getSignalingUrl();
    }

    // http(s) -> ws(s)
    if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
    if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;

    // scheme が無い: localhost:3000/ws?room=audio1 など
    if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        return `${proto}://${trimmed.replace(/^\/+/, "")}`;
    }

    return trimmed;
}

/**
 * /ws?room=xxx を強制する（GUIと合わせる）
 */
function withRoomQuery(wsUrl: string, roomId: string) {
    try {
        const u = new URL(wsUrl);
        if (!u.pathname.endsWith("/ws")) u.pathname = "/ws";

        if (roomId) {
            u.searchParams.set("room", roomId);
        }
        return u.toString();
    } catch {
        if (wsUrl.includes("?")) return wsUrl;
        if (!roomId) return wsUrl;
        return `${wsUrl}${wsUrl.endsWith("/ws") ? "" : "/ws"}?room=${encodeURIComponent(roomId)}`;
    }
}

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const WS_KEEPALIVE_MS = 10_000;

const STORAGE_KEYS = {
    receiverId: "teleco.audio.receiverId",
    roomId: "teleco.audio.roomId",
    signalingWsUrl: "teleco.audio.signalingWsUrl",
    autoConnect: "teleco.audio.autoConnect",
};

const DEFAULT_AUDIO_ROOM = process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM || "audio1";
const DEFAULT_RECEIVER_ID = process.env.NEXT_PUBLIC_DEFAULT_RECEIVER_ID || "rover003";

/**
 * teleco-gui-master の label方式（Teleco互換）
 */
type DestinationId = string;

type SdpDescription = {
    type: RTCSdpType;
    sdp: string;
};

type SignalingLabel =
    | "callAudioRequest"
    | "callAudioAnswer"
    | "audioIceCandidaterequest"
    | "audioIceCandidateresponse"
    | "callVideoRequest"
    | "callVideoAnswer"
    | "videoIceCandidateresponse";

type BaseSignalingMessage = {
    label: SignalingLabel;
    destination: DestinationId;
    id_call_token: string;
};

type CallAudioRequestMessage = BaseSignalingMessage & { label: "callAudioRequest"; sdp: SdpDescription };
type CallAudioAnswerMessage = BaseSignalingMessage & { label: "callAudioAnswer"; sdp: SdpDescription };
type AudioIceCandidateRequestMessage = BaseSignalingMessage & {
    label: "audioIceCandidaterequest";
    candidate: RTCIceCandidateInit;
};
type AudioIceCandidateResponseMessage = BaseSignalingMessage & {
    label: "audioIceCandidateresponse";
    candidate: RTCIceCandidateInit;
};

type SignalingMessage =
    | CallAudioRequestMessage
    | CallAudioAnswerMessage
    | AudioIceCandidateRequestMessage
    | AudioIceCandidateResponseMessage
    | (BaseSignalingMessage & Record<string, any>);

function nowTime() {
    return new Date().toLocaleTimeString();
}

export default function AudioReceiverPage() {
    const [receiverId, setReceiverId] = useState<string>(DEFAULT_RECEIVER_ID);
    const [roomId, setRoomId] = useState<string>(DEFAULT_AUDIO_ROOM);
    const [signalingWsUrl, setSignalingWsUrl] = useState<string>(() => getSignalingUrl(DEFAULT_AUDIO_ROOM));

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

    const logLine = (line: string) => setLog((prev) => [...prev, `[${nowTime()}] ${line}`]);

    useEffect(() => {
        const savedReceiver = window.localStorage.getItem(STORAGE_KEYS.receiverId);
        if (savedReceiver) setReceiverId(savedReceiver);

        const savedRoomId = window.localStorage.getItem(STORAGE_KEYS.roomId);
        if (savedRoomId) setRoomId(savedRoomId);

        const savedSignalUrl = window.localStorage.getItem(STORAGE_KEYS.signalingWsUrl);
        if (savedSignalUrl) setSignalingWsUrl(savedSignalUrl);

        shouldAutoConnectRef.current = window.localStorage.getItem(STORAGE_KEYS.autoConnect) === "1";
        if (shouldAutoConnectRef.current) {
            manualDisconnectRef.current = false;
            connect(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.receiverId, receiverId);
    }, [receiverId]);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.roomId, roomId);
    }, [roomId]);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.signalingWsUrl, signalingWsUrl);
    }, [signalingWsUrl]);

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

    function sendWs(obj: any) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(obj));
    }

    function sendJoin() {
        sendWs({ type: "join", roomId, role: "viewer", id: receiverId });
        logLine(`join送信 roomId=${roomId} role=viewer id=${receiverId}`);
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
        if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

        manualDisconnectRef.current = false;
        clearReconnectTimer();
        setError(null);
        setWsBusy(true);

        const base = normalizeWsUrl(signalingWsUrl);
        const url = withRoomQuery(base, roomId);

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
            logLine(isReconnect ? "シグナリング再接続(open)" : "シグナリング接続(open)");
            sendJoin();
        };

        ws.onclose = (ev) => {
            if (wsRef.current === ws) wsRef.current = null;
            setConnected(false);
            setWsBusy(false);
            stopKeepalive();
            logLine(`シグナリング切断(close) code=${ev.code} reason=${ev.reason || "(none)"}`);

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
            let msg: any;
            try {
                msg = JSON.parse(event.data);
            } catch {
                logLine("WS message parse failed");
                return;
            }

            if (msg?.type === "__pong" || msg?.type === "keepalive") {
                return;
            }

            // ---- label方式（Teleco互換） ----
            if (msg && typeof msg.label === "string") {
                const m = msg as SignalingMessage;

                if (m.destination && m.destination !== receiverId) {
                    logLine(`IGNORED (dest mismatch): label=${m.label} dest=${m.destination}`);
                    return;
                }

                if (!m.id_call_token) {
                    logLine(`WS msg(label=${m.label}) missing id_call_token`);
                    return;
                }

                const token = m.id_call_token;
                const destination = m.destination || receiverId;

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

                logLine(`WS label=${m.label} (no-op)`);
                return;
            }

            if (msg && typeof msg.type === "string") {
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
    }, []);

    const canConnect =
        !connected && !wsBusy && roomId.trim().length > 0 && receiverId.trim().length > 0 && signalingWsUrl.trim().length > 0;
    const canDisconnect = connected || wsBusy;

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-3xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-semibold">Audio Receiver（別PC用 / label方式 Teleco互換）</h1>
                </div>

                <div className="space-y-3 rounded-2xl border bg-white p-4">
                    <div className="status-chip-row">
                        <span className={`status-chip ${connected ? "is-on" : wsBusy ? "is-busy" : "is-off"}`}>
                            Signal {connected ? "CONNECTED" : wsBusy ? "CONNECTING" : "OFFLINE"}
                        </span>
                        <span className={`status-chip ${hasAudioTrack ? "is-on" : connected ? "is-busy" : "is-off"}`}>
                            Audio {hasAudioTrack ? "PLAYING" : connected ? "WAITING" : "IDLE"}
                        </span>
                    </div>

                    <p className="action-state-hint" role="status" aria-live="polite">
                        {!connected
                            ? "次の操作: ① シグナリング接続"
                            : !hasAudioTrack
                                ? "待機中: Senderからの offer/音声受信を待っています"
                                : "現在: 音声受信中です"}
                    </p>

                    <label className="block text-sm text-slate-700">
                        Signaling WS URL（GUIと同じURLにする）
                        <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                            value={signalingWsUrl}
                            onChange={(e) => setSignalingWsUrl(e.target.value)}
                            disabled={connected || wsBusy}
                            placeholder="ws://192.168.0.10:3000/ws?room=audio1"
                        />
                        <div className="mt-1 text-[11px] text-slate-500">
                            ※ Receiverを別PCで動かす場合、GUI(=シグナリングを持つPC)のIP/ポートを指定してください。
                        </div>
                    </label>

                    <div className="grid gap-2 md:grid-cols-2">
                        <label className="text-sm text-slate-700">
                            Room ID（?room= に入る）
                            <input
                                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value)}
                                disabled={connected || wsBusy}
                            />
                        </label>

                        <label className="text-sm text-slate-700">
                            Receiver ID（Destination / GUIのDestinationと一致）
                            <input
                                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                value={receiverId}
                                onChange={(e) => setReceiverId(e.target.value)}
                                disabled={connected || wsBusy}
                                placeholder="rover003"
                            />
                        </label>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm">
                        <div className="action-button-wrap">
                            <button
                                onClick={() => {
                                    manualDisconnectRef.current = false;
                                    shouldAutoConnectRef.current = true;
                                    window.localStorage.setItem(STORAGE_KEYS.autoConnect, "1");
                                    connect(false);
                                }}
                                disabled={!canConnect}
                                className="action-button rounded-xl bg-slate-100 px-4 py-2"
                                data-busy={wsBusy ? "1" : "0"}
                                aria-busy={wsBusy}
                            >
                                {wsBusy ? "接続中..." : "接続"}
                            </button>
                            <p className={`button-reason ${canConnect ? "is-ready" : "is-disabled"}`}>
                                {!roomId.trim() || !receiverId.trim() || !signalingWsUrl.trim()
                                    ? "Room ID / Receiver ID / Signal URL を入力してください"
                                    : connected
                                        ? "すでに接続中です"
                                        : wsBusy
                                            ? "接続処理中です"
                                            : "シグナリングへ接続できます"}
                            </p>
                        </div>

                        <div className="action-button-wrap">
                            <button
                                onClick={disconnect}
                                disabled={!canDisconnect}
                                className="action-button rounded-xl bg-slate-900 px-4 py-2 text-white"
                            >
                                切断
                            </button>
                            <p className={`button-reason ${canDisconnect ? "is-ready" : "is-disabled"}`}>
                                {canDisconnect ? "接続を停止できます" : "現在は未接続です"}
                            </p>
                        </div>

                        <div className="action-button-wrap">
                            <button
                                onClick={() => window.open("/ws", "_blank")}
                                className="action-button rounded-xl bg-slate-100 px-4 py-2"
                                type="button"
                            >
                                /ws を開く（デバッグ）
                            </button>
                            <p className="button-reason is-ready">接続確認用に別タブで開けます</p>
                        </div>
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
                    <div className="max-h-56 overflow-auto text-xs text-slate-700 space-y-1">
                        {log.map((l, i) => (
                            <div key={i}>{l}</div>
                        ))}
                    </div>
                </div>
            </div>
        </main>
    );
}

