"use client"

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

declare global {
    interface Window {
        LegacyTeleco?: {
            init: (mqttUrl: string, options?: unknown) => void;
            startVideo: (telecoId: string, videoElement: HTMLVideoElement) => void;
            stopVideo: () => void;
        };
    }
}

export default function LegacyTelecoVideo({ telecoId }: { telecoId: string }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Legacy スクリプトが読み込まれたら init
    useEffect(() => {
        if (!ready) return;
        if (!window.LegacyTeleco) {
            setError("Legacy Teleco script not loaded");
            return;
        }

        try {
            window.LegacyTeleco.init("wss://mittsu-talk.jp/mosmos-test2/ws/", {});
        } catch (e) {
            setError("Failed to initialize Legacy Teleco: " + e);
        }
    }, [ready]);

    // videoElementがマウントされたらstartVideo
    useEffect(() => {
        if (!ready) return;
        if (!window.LegacyTeleco) return;
        const video = videoRef.current;
        if (!video) return;

        try {
            window.LegacyTeleco.startVideo(telecoId, video);
        }catch(e){
            console.error(e);
            setError("Failed to start video: " + e);
        }

        return () => {
            try {
                window.LegacyTeleco?.stopVideo();
            } catch {

            }
        };
    }, [ready, telecoId]);

    return (
        <div className="space-y-2">
            {/* 旧ライブラリ類の読み込み */}
            <Script
                src="/legacy/mqtt.min.js"
                strategy="lazyOnload"
                onError={() => setError("Failed to load mqtt.min.js")}
            />
            <Script
                src="/legacy/webrtc.js"
                strategy="lazyOnload"
                onError={() => setError("Failed to load webrtc.js")}
            />
            <Script
                src="/legacy/connections.js"
                strategy="lazyOnload"
                onError={() => setError("Failed to load connections.js")}
            />
            <Script
                src="/legacy/devices.js"
                strategy="lazyOnload"
                onError={() => setError("Failed to load devices.js")}
            />
            <Script
                src="/legacy/legacy-bridge.js"
                strategy="lazyOnload"
                onLoad={() => setReady(true)}
                onError={() => setError("legacy-bridge.js の読み込みに失敗しました")}
            />

            <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
                <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    playsInline
                    autoPlay
                />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
            {!error && (
                <p className="text-xs text-slate-500">
                    MQTT + WebRTC
                </p>
            )}
        </div>
    )
}