"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioCallManager } from "@/lib/webrtc/audioCallManager";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

type MicOption = { deviceId: string; label: string };

export default function AudioSender() {
    const manager = useMemo(() => new AudioCallManager(), []);
    const wsRef = useRef<WebSocket | null>(null);
    const callIdRef = useRef<string | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [wsUrl, setWsUrl] = useState<string>("ws://localhost:8000/command");
    const [destination, setDestination] = useState<string>("rover003");
    const [mics, setMics] = useState<MicOption[]>([]);
    const [selectedMicId, setSelectedMicId] = useState<string>("");
    const [wsStatus, setWsStatus] = useState<string>("未接続");
    const [callStatus, setCallStatus] = useState<string>("停止");
    const [error, setError] = useState<string | null>(null);

    const appendError = (msg: string) => setError(msg);

    // マイク一覧を更新（権限未許可だと label が空のことがあります）
    const refreshDevices = async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices
                .filter((d) => d.kind === "audioinput")
                .map((d, idx) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Microphone ${idx + 1}`,
                }));
            setMics(audioInputs);
            if (!selectedMicId && audioInputs.length > 0) {
                setSelectedMicId(audioInputs[0].deviceId);
            }
        } catch (e) {
            console.error(e);
            appendError("デバイス一覧の取得に失敗しました。");
        }
    };

    // 初回：権限要求→デバイス列挙
    useEffect(() => {
        const init = async () => {
            try {
                // enumerateDevices の label を得るために先に権限を取る
                const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                tmp.getTracks().forEach((t) => t.stop());
            } catch {
                // 権限がなくても列挙自体は可能な場合がある
            }
            await refreshDevices();
        };
        void init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // WebSocket 接続
    const connectWs = () => {
        setError(null);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

        try {
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setWsStatus("接続済み");
            };
            ws.onclose = () => {
                setWsStatus("切断");
            };
            ws.onerror = () => {
                setWsStatus("エラー");
                appendError("WebSocket 接続でエラーが発生しました。");
            };
            ws.onmessage = async (event) => {
                try {
                    const msg = JSON.parse(event.data) as SignalingMessage;
                    await manager.handleIncomingMessage(msg);
                } catch (e) {
                    // 受信が別形式の場合は無視（teleco側のログ等）
                    console.warn("WS message ignored", e);
                }
            };
        } catch (e) {
            console.error(e);
            appendError("WebSocket の作成に失敗しました。");
        }
    };

    const disconnectWs = () => {
        wsRef.current?.close();
        wsRef.current = null;
        setWsStatus("切断");
    };

    // WebRTC 送信開始
    const startSending = async () => {
        setError(null);
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            appendError("先に WebSocket に接続してください。");
            return;
        }
        if (!selectedMicId) {
            appendError("マイクを選択してください。");
            return;
        }

        // 既存の送信があれば停止
        stopSending();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: selectedMicId } },
                video: false,
            });
            streamRef.current = stream;
            const track = stream.getAudioTracks()[0];
            if (!track) {
                appendError("音声トラックを取得できませんでした。");
                stream.getTracks().forEach((t) => t.stop());
                return;
            }

            setCallStatus("offer送信中");
            const sendFn = (msg: SignalingMessage) => {
                wsRef.current?.send(JSON.stringify(msg));
            };

            const callId = await manager.callAudioRequest(
                track,
                destination,
                sendFn,
                (state) => setCallStatus(`WebRTC: ${state}`),
            );
            callIdRef.current = callId;
        } catch (e) {
            console.error(e);
            appendError("マイク取得または WebRTC 開始に失敗しました。");
        }
    };

    const stopSending = () => {
        const callId = callIdRef.current;
        if (callId) {
            manager.closeCall(callId);
            callIdRef.current = null;
        }
        const stream = streamRef.current;
        if (stream) {
            stream.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
        setCallStatus("停止");
    };

    // cleanup
    useEffect(() => {
        return () => {
            stopSending();
            disconnectWs();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="space-y-3">
            <div className="grid gap-2">
                <label className="text-sm text-slate-700">
                    WebSocket URL（シグナリング）
                    <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        value={wsUrl}
                        onChange={(e) => setWsUrl(e.target.value)}
                        placeholder="ws://..."
                    />
                </label>

                <label className="text-sm text-slate-700">
                    Destination（teleco/rover 側のID）
                    <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                        placeholder="rover003"
                    />
                </label>

                <label className="text-sm text-slate-700">
                    Microphone
                    <select
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        value={selectedMicId}
                        onChange={(e) => setSelectedMicId(e.target.value)}
                    >
                        {mics.map((m) => (
                            <option key={m.deviceId} value={m.deviceId}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </label>

                <div className="flex flex-wrap gap-2 pt-1">
                    <button
                        onClick={refreshDevices}
                        className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
                    >
                        デバイス更新
                    </button>
                    <button
                        onClick={connectWs}
                        className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700"
                    >
                        WebSocket接続
                    </button>
                    <button
                        onClick={startSending}
                        className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm hover:bg-emerald-700"
                    >
                        WebRTC送信開始
                    </button>
                    <button
                        onClick={stopSending}
                        className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
                    >
                        停止
                    </button>
                </div>
            </div>

            <div className="text-xs text-slate-600 space-y-1">
                <div>WebSocket: {wsStatus}</div>
                <div>Audio Send: {callStatus}</div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
    );
}
