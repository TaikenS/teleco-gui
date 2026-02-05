"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Signalingは WebSocket (/ws)。
 * - 入力が http(s) でも ws(s) に変換
 * - 入力が空なら「現在ページのhost」を使う
 * - 末尾が /ws でなくても /ws を補う（ただしクエリ付きの /ws?... は尊重）
 */
function normalizeWsUrl(input: string) {
    const trimmed = input.trim();

    if (!trimmed) {
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        return `${proto}://${window.location.host}/ws`;
    }

    // http(s) -> ws(s)
    if (trimmed.startsWith("http://")) return "ws://" + trimmed.slice("http://".length);
    if (trimmed.startsWith("https://")) return "wss://" + trimmed.slice("https://".length);

    // scheme が無い: localhost:3000/ws?room=audio1 など
    if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        return `${proto}://${trimmed.replace(/^\/+/, "")}`;
    }

    return trimmed;
}

/**
 * /ws?room=xxx を強制する（GUIと合わせる）
 * - すでに ?room= があるならそれを優先
 * - roomが空なら付けない（サーバ側で join メッセージを送る方式でも動く）
 */
function withRoomQuery(wsUrl: string, roomId: string) {
    try {
        const u = new URL(wsUrl);
        // /ws を補う（/ws 以外が来た場合の保険）
        if (!u.pathname.endsWith("/ws")) u.pathname = "/ws";

        if (roomId) {
            // 既に room があればそれを尊重、無ければ付与
            if (!u.searchParams.get("room")) u.searchParams.set("room", roomId);
        }
        return u.toString();
    } catch {
        // URLとして解釈できない場合は雑に補正
        // 例: ws://host:3000/ws?room=audio1 はそのまま通る想定
        if (wsUrl.includes("?")) return wsUrl;
        if (!roomId) return wsUrl;
        return `${wsUrl}${wsUrl.endsWith("/ws") ? "" : "/ws"}?room=${encodeURIComponent(roomId)}`;
    }
}

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

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
    // ついでに video が来ても無害にログだけ出す
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
    // GUI の Destination と一致させる（例: rover003）
    const [receiverId, setReceiverId] = useState<string>("rover003");

    // 画面表示用の Room（実際は ws url の ?room= で揃える）
    const [roomId, setRoomId] = useState<string>("audio1");

    // GUIと同じURL（/ws?room=audio1）にする
    const [signalingWsUrl, setSignalingWsUrl] = useState<string>(() => {
        if (typeof window === "undefined") return "ws://localhost:3000/ws?room=audio1";
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        return `${proto}://${window.location.host}/ws?room=audio1`;
    });

    const [connected, setConnected] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const wsRef = useRef<WebSocket | null>(null);

    // token -> PeerConnection
    const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());

    // token -> MediaStream（受信音声）
    const streamsRef = useRef<Map<string, MediaStream>>(new Map());

    const audioRef = useRef<HTMLAudioElement | null>(null);

    const logLine = (line: string) => setLog((prev) => [...prev, `[${nowTime()}] ${line}`]);

    function cleanupAllPeers() {
        for (const [token, pc] of pcsRef.current.entries()) {
            try {
                pc.close();
            } catch {}
            pcsRef.current.delete(token);
            streamsRef.current.delete(token);
        }
    }

    function cleanupWs() {
        try {
            wsRef.current?.close();
        } catch {}
        wsRef.current = null;
    }

    function sendWs(obj: any) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(obj));
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

            // 今は「最初に来たtokenの音」を再生、必要ならUIで切替可能
            const audio = audioRef.current;
            if (audio) {
                audio.srcObject = stream;
                void audio.play().then(
                    () => logLine(`audio.play() ok (token=${token})`),
                    (e) => logLine(`audio.play() blocked: ${String(e)}`)
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
            logLine(`WebRTC state (token=${token}): ${pc!.connectionState}`);
        };

        return pc;
    }

    const connect = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        setError(null);

        const base = normalizeWsUrl(signalingWsUrl);
        const url = withRoomQuery(base, roomId);

        logLine(`Signaling接続開始: ${url}`);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            setConnected(true);
            logLine("シグナリング接続(open)");

            // server.mjs は join メッセージでも room を設定できるので送っておく（?room= が無い場合の保険）
            sendWs({ type: "join", roomId, role: "viewer", id: receiverId });
            logLine(`join送信 roomId=${roomId} role=viewer id=${receiverId}`);
        };

        ws.onclose = (ev) => {
            setConnected(false);
            logLine(`シグナリング切断(close) code=${ev.code} reason=${ev.reason || "(none)"}`);
            cleanupWs();
            cleanupAllPeers();
        };

        ws.onerror = () => {
            setError(`シグナリングサーバへの接続に失敗しました。URL=${url}`);
            logLine(`WS error (URL=${url})`);
        };

        ws.onmessage = async (event) => {
            let msg: any;
            try {
                msg = JSON.parse(event.data);
            } catch {
                logLine("WS message parse failed");
                return;
            }

            // ---- label方式（Teleco互換） ----
            if (msg && typeof msg.label === "string") {
                const m = msg as SignalingMessage;

                // destination フィルタ（自分宛だけ処理）
                if (m.destination && m.destination !== receiverId) {
                    // 同一ルームに複数 receiver がいる可能性があるのでノイズは抑える
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
                        // 先にICEが来た場合に備えてPCを作る（後でofferが来ても同じtokenなら使い回す）
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

                // 受信側は通常 answer を受け取らないが、ログだけは出す
                logLine(`WS label=${m.label} (no-op)`);
                return;
            }

            // ---- 旧 type方式が混在しても一応ログ ----
            if (msg && typeof msg.type === "string") {
                logLine(`WS msg type=${msg.type} (legacy/no-op)`);
                return;
            }

            logLine("WS msg unknown format");
        };
    };

    const disconnect = () => {
        logLine("手動切断");
        cleanupWs();
        cleanupAllPeers();
        setConnected(false);
    };

    useEffect(() => {
        return () => {
            cleanupWs();
            cleanupAllPeers();
        };
    }, []);

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-3xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-semibold">Audio Receiver（別PC用 / label方式 Teleco互換）</h1>
                    <Link href="/gui" className="text-sm text-slate-600 hover:text-slate-900">
                        GUIへ戻る
                    </Link>
                </div>

                <div className="space-y-3 rounded-2xl border bg-white p-4">
                    <label className="block text-sm text-slate-700">
                        Signaling WS URL（GUIと同じURLにする）
                        <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                            value={signalingWsUrl}
                            onChange={(e) => setSignalingWsUrl(e.target.value)}
                            disabled={connected}
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
                                disabled={connected}
                            />
                        </label>

                        <label className="text-sm text-slate-700">
                            Receiver ID（Destination / GUIのDestinationと一致）
                            <input
                                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                value={receiverId}
                                onChange={(e) => setReceiverId(e.target.value)}
                                disabled={connected}
                                placeholder="rover003"
                            />
                        </label>
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

                        <button
                            onClick={() => window.open("/ws", "_blank")}
                            className="rounded-xl bg-slate-100 px-4 py-2 hover:bg-slate-200"
                            type="button"
                        >
                            /ws を開く（デバッグ）
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
