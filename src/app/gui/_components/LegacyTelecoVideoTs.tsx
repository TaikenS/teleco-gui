"use client";

import { useEffect, useRef, useState } from "react";
import { MqttHandler } from "@/lib/webrtc/mqttHandler";
import { VideoCallManager } from "@/lib/webrtc/videoCallManager";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

interface LegacyTelecoVideoProps {
  telecoId: string; // "teleco001" など
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
          host: "wss://mittsu-talk.jp/mosmos-test2/ws/", // ★実際の broker に合わせて変更
          onConnected: () => {
            if (!mounted) return;
            setStatus("MQTT 接続完了");
          },
        });

        // Publisher / Subscriber の登録（旧 connections.js 相当）
        mqtt.addPublisher(telecoId, `/${telecoId}/command`); // 例: /teleco-001/command
        mqtt.addSubscriber(
          telecoId,
          `/${telecoId}/INFO`, // 例: /teleco-001/INFO
          (msg: SignalingMessage) => {
            // teleco からの answer / ICE をココで受け取る
            void manager.handleIncomingMessage(msg);
          },
        );

        // ダミー映像トラックを作る（昔の fake_canvas.captureStream(1)!）
        const dummyStream = new MediaStream();
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const dummyVideoTrack = canvas.captureStream(1).getVideoTracks()[0];
        dummyStream.addTrack(dummyVideoTrack);

        if (!videoRef.current) return;

        // teleco に「映像ちょうだい」と依頼
        setStatus("映像リクエスト送信中…");
        const callId = await manager.callVideoRequest(
          dummyVideoTrack,
          telecoId,
          (msg) => mqtt?.sendToPublisher(telecoId, msg),
          (remoteStream) => {
            // ここが「映像を受け取った瞬間」
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
        // 本物は mqtt.client.end() などで切断する
      }
    };
  }, [telecoId]);

  return (
    <div className="space-y-2">
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          autoPlay
          playsInline
        />
      </div>
      <p className="text-xs text-slate-500">状態: {status}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
