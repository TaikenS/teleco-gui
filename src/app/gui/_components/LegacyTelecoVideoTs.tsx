"use client";

import { useEffect, useRef, useState } from "react";
import { MqttHandler } from "@/lib/webrtc/mqttHandler";
import { VideoCallManager } from "@/lib/webrtc/videoCallManager";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

interface LegacyTelecoVideoProps {
  telecoId: string;
}

export function LegacyTelecoVideoTs({ telecoId }: LegacyTelecoVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<string>("初期化中…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let mqtt: MqttHandler | null = null;
    const manager = new VideoCallManager();
    let currentCallId: string | null = null;

    const init = async () => {
      try {
        setStatus("MQTT 接続中…");

        mqtt = new MqttHandler({
          host: "wss://mittsu-talk.jp/mosmos-test2/ws/",
          onConnected: () => {
            if (!mounted) return;
            setStatus("MQTT 接続完了");
          },
        });

        mqtt.addPublisher(telecoId, `/${telecoId}/command`);
        mqtt.addSubscriber(telecoId, `/${telecoId}/INFO`, (msg: SignalingMessage) => {
          void manager.handleIncomingMessage(msg);
        });

        const dummyStream = new MediaStream();
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const dummyVideoTrack = canvas.captureStream(1).getVideoTracks()[0];
        dummyStream.addTrack(dummyVideoTrack);

        if (!videoRef.current) return;

        setStatus("映像リクエスト送信中…");
        const callId = await manager.callVideoRequest(
            dummyVideoTrack,
            telecoId,
            (msg) => mqtt?.sendToPublisher(telecoId, msg),
            (remoteStream) => {
              if (!mounted || !videoRef.current) return;
              videoRef.current.srcObject = remoteStream;
              void videoRef.current.play();
              setStatus("リモート映像受信中");
            },
        );
        currentCallId = callId;
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setError("Legacy teleco との接続に失敗しました");
        setStatus("エラー");
      }
    };

    void init();

    return () => {
      mounted = false;
      if (currentCallId) {
        manager.closeCall(currentCallId);
      }
      if (mqtt) {
        // mqtt切断は実装依存
      }
    };
  }, [telecoId]);

  return (
      <div className="space-y-2">
        <div
            className="w-full h-[60vh] max-h-[70vh] overflow-hidden rounded-xl bg-slate-200 cursor-pointer"
            title="クリックでフルスクリーン切替"
            onClick={() => {
              const el = videoRef.current;
              if (!el) return;
              if (document.fullscreenElement) {
                void document.exitFullscreen();
              } else {
                void el.requestFullscreen();
              }
            }}
        >
          <video
              ref={videoRef}
              className="h-full w-full object-contain"
              autoPlay
              playsInline
          />
        </div>
        <p className="text-xs text-slate-500">状態: {status}</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
  );
}
