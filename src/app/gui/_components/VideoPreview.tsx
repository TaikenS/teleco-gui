"use client";

import { useEffect, useRef, useState } from "react";

export default function VideoPreview() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(false);

    // 映像取得開始
    const start = async () => {
        try {
            setError(null);
            setIsStarting(true);

            // カメラ映像を取得（音声も欲しければ audio: true）
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
                audio: false,
            });

            setStream(mediaStream);
        } catch (e) {
            console.error(e);
            setError("カメラの取得に失敗しました。ブラウザの権限設定を確認してください。");
        } finally {
            setIsStarting(false);
        }
    };

    // 停止
    const stop = () => {
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            setStream(null);
        }
    };

    // stream が変わったら <video> に反映
    useEffect(() => {
        if (!videoRef.current) return;
        if (!stream) {
            videoRef.current.srcObject = null;
            return;
        }

        videoRef.current.srcObject = stream;
        videoRef.current
            .play()
            .catch((err) => {
                console.error(err);
                setError("映像の再生に失敗しました。");
            });
    }, [stream]);

    // コンポーネントが unmount されたら停止
    useEffect(() => {
        return () => {
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [stream]);

    return (
        <div className="space-y-3">
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
                <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                />
            </div>

            <div className="flex items-center gap-2 text-sm">
                <button
                    type="button"
                    onClick={start}
                    disabled={!!stream || isStarting}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                >
                    {isStarting ? "起動中…" : stream ? "起動済み" : "カメラ開始"}
                </button>
                <button
                    type="button"
                    onClick={stop}
                    disabled={!stream}
                    className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-900 disabled:opacity-60"
                >
                    停止
                </button>
                {error && <span className="text-xs text-red-600">{error}</span>}
            </div>
        </div>
    );
}
