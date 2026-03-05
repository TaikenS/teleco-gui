"use client";

import React from "react";
import dynamic from "next/dynamic";
import AudioSenderDevicePanel from "@/app/gui/components/audio/sender/AudioSenderDevicePanel";
import { useAudioSenderController } from "@/app/gui/components/audio/sender/useAudioSenderController";
import TelecoControlPanel from "@/app/gui/components/teleco/TelecoControlPanel";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import {
  buildSignalingUrl,
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
} from "@/lib/signaling";
import { usePersistentState } from "@/lib/usePersistentState";

const LocalCameraStream = dynamic(
  () => import("@/app/gui/components/video/LocalCameraStream"),
  { ssr: false },
);
const WebRtcVideoReceiver = dynamic(
  () => import("@/app/gui/components/video/WebRtcVideoReceiver"),
  { ssr: false },
);
const EmbeddedVideoSenderPage = dynamic(
  () => import("@/app/video/VideoSenderPageClient"),
  { ssr: false },
);
const EmbeddedAudioReceiverPage = dynamic(
  () => import("@/app/audio/AudioReceiverPageClient"),
  { ssr: false },
);

type VideoSourceMode = "local" | "webSender";
const VIDEO_MODE_STORAGE_KEY = "teleco.gui.videoMode";
const VIDEO_ROOM_STORAGE_KEY = "teleco.gui.video.roomId";
const VIDEO_SIGNAL_IP_ADDRESS_STORAGE_KEY =
  "teleco.gui.video.signalingIpAddress";
const VIDEO_SIGNAL_PORT_STORAGE_KEY = "teleco.gui.video.signalingPort";
const EMBED_VIDEO_SENDER_KEY = "teleco.gui.embed.videoSender";
const EMBED_AUDIO_RECEIVER_KEY = "teleco.gui.embed.audioReceiver";

const RAW_DEFAULT_VIDEO_ROOM =
  process.env.NEXT_PUBLIC_VIDEO_SENDER_ROOM_ID?.trim() ||
  process.env.NEXT_PUBLIC_DEFAULT_VIDEO_ROOM?.trim() ||
  "";
const HAS_DEFAULT_VIDEO_ROOM_ENV = RAW_DEFAULT_VIDEO_ROOM.length > 0;
const DEFAULT_VIDEO_ROOM = RAW_DEFAULT_VIDEO_ROOM || "room1";
const VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_IP_ADDRESS",
];
const VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_PORT",
];
const HAS_VIDEO_SIGNALING_IP_ENV = VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS.some(
  (key) => !!process.env[key]?.trim(),
);
const HAS_VIDEO_SIGNALING_PORT_ENV = VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS.some(
  (key) => !!process.env[key]?.trim(),
);
const DEFAULT_SIGNALING_IP_ADDRESS = getDefaultSignalingIpAddress({
  envKeys: VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS,
});
const DEFAULT_SIGNALING_PORT = getDefaultSignalingPort({
  envKeys: VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS,
});

function getFirstValue(
  values: Record<string, string>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = values[key];
    if (value?.trim()) return value.trim();
  }
  return null;
}

function parseVideoMode(raw: string): VideoSourceMode {
  return raw === "webSender" ? "webSender" : "local";
}

function parseBinaryFlag(raw: string): boolean {
  return raw === "1";
}

function serializeBinaryFlag(value: boolean): string {
  return value ? "1" : "0";
}

export default function GuiPage() {
  const didInitSettingsRef = React.useRef(false);
  const didEditSignalSettingsRef = React.useRef(false);

  const audioSenderController = useAudioSenderController({ panel: "all" });

  const [mode, setMode] = usePersistentState<VideoSourceMode>(
    VIDEO_MODE_STORAGE_KEY,
    "local",
    { deserialize: parseVideoMode },
  );
  const selectedVideoId: string | undefined = undefined;
  const [videoRoomId, setVideoRoomId] = usePersistentState<string>(
    VIDEO_ROOM_STORAGE_KEY,
    DEFAULT_VIDEO_ROOM,
  );
  const [videoSignalingIpAddress, setVideoSignalingIpAddress] =
    usePersistentState<string>(
      VIDEO_SIGNAL_IP_ADDRESS_STORAGE_KEY,
      DEFAULT_SIGNALING_IP_ADDRESS,
    );
  const [videoSignalingPort, setVideoSignalingPort] =
    usePersistentState<string>(
      VIDEO_SIGNAL_PORT_STORAGE_KEY,
      DEFAULT_SIGNALING_PORT,
    );

  React.useEffect(() => {
    if (!didInitSettingsRef.current) return;
    if (!didEditSignalSettingsRef.current) return;
    scheduleEnvLocalSync({
      NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_IP_ADDRESS: videoSignalingIpAddress,
      NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_PORT: videoSignalingPort,
    });
  }, [videoSignalingIpAddress, videoSignalingPort]);

  const [showVideoSenderPanel, setShowVideoSenderPanel] =
    usePersistentState<boolean>(EMBED_VIDEO_SENDER_KEY, false, {
      deserialize: parseBinaryFlag,
      serialize: serializeBinaryFlag,
    });
  const [showAudioReceiverPanel, setShowAudioReceiverPanel] =
    usePersistentState<boolean>(EMBED_AUDIO_RECEIVER_KEY, false, {
      deserialize: parseBinaryFlag,
      serialize: serializeBinaryFlag,
    });
  const isSingleEmbeddedPreviewPanel =
    Number(showVideoSenderPanel) + Number(showAudioReceiverPanel) === 1;

  React.useEffect(() => {
    if (HAS_VIDEO_SIGNALING_IP_ENV) {
      setVideoSignalingIpAddress(DEFAULT_SIGNALING_IP_ADDRESS);
    }
    if (HAS_VIDEO_SIGNALING_PORT_ENV) {
      setVideoSignalingPort(DEFAULT_SIGNALING_PORT);
    }
    didInitSettingsRef.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/env-local", { cache: "no-store" });
        const data = (await res.json()) as {
          ok?: boolean;
          values?: Record<string, string>;
        };
        const values = data?.values;
        if (!values) return;

        if (!didEditSignalSettingsRef.current) {
          const envIp = getFirstValue(
            values,
            VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS,
          );
          const envPort = getFirstValue(
            values,
            VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS,
          );
          if (envIp) setVideoSignalingIpAddress(envIp);
          if (envPort) setVideoSignalingPort(envPort);
        }
      } catch {
        // noop
      }
    })();
  }, [setVideoSignalingIpAddress, setVideoSignalingPort]);

  React.useEffect(() => {
    if (!HAS_DEFAULT_VIDEO_ROOM_ENV) return;
    setVideoRoomId(DEFAULT_VIDEO_ROOM);
  }, [setVideoRoomId]);

  const videoSignalingWsUrl = buildSignalingUrl({
    ipAddress: videoSignalingIpAddress,
    port: videoSignalingPort,
    roomId: videoRoomId || DEFAULT_VIDEO_ROOM,
  });

  const handleVideoSignalingIpAddressChange = (nextValue: string) => {
    didEditSignalSettingsRef.current = true;
    setVideoSignalingIpAddress(nextValue);
  };

  const handleVideoSignalingPortChange = (nextValue: string) => {
    didEditSignalSettingsRef.current = true;
    setVideoSignalingPort(nextValue);
  };

  return (
    <div className="teleco-gui-shell min-h-screen text-slate-900">
      <header className="teleco-gui-header sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-500">
              Teleco GUI
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-slate-950">
              Teleco Operator Console
            </h1>
          </div>

        </div>
      </header>

      <main className="mx-auto grid max-w-[1680px] gap-4 px-4 py-4 md:px-6 lg:grid-cols-12 lg:items-start lg:pb-6">
        <section className="space-y-4 lg:col-span-6 lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:pr-1">
          {audioSenderController.error && (
            <p className="text-xs text-red-600 whitespace-pre-line">
              {audioSenderController.error}
            </p>
          )}

          <Card title="音声送信">
            <AudioSenderDevicePanel {...audioSenderController.devicePanelProps} />
          </Card>

          <Card title="Teleco制御">
            <TelecoControlPanel {...audioSenderController.telecoPanelProps} />
          </Card>
        </section>

        <section className="space-y-4 lg:col-span-6 lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:pr-1">
          <Card title="映像受信" subtitle={subtitleForMode(mode)}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">映像ソース</span>
              <select
                className="rounded-xl border bg-white px-3 py-1.5 text-xs"
                value={mode}
                onChange={(e) => setMode(e.target.value as VideoSourceMode)}
              >
                <option value="webSender">/video 送信映像（WebRTC）</option>
                <option value="local">このPCのローカルカメラ</option>
              </select>
            </div>

            {mode === "local" && (
              <LocalCameraStream videoDeviceId={selectedVideoId} />
            )}

            {mode === "webSender" && (
              <div className="space-y-3">
                <WebRtcVideoReceiver
                  roomId={videoRoomId || DEFAULT_VIDEO_ROOM}
                  signalingWsUrl={videoSignalingWsUrl}
                  settingsPanel={
                    <>
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="text-sm text-slate-700">
                          シグナリング IPアドレス
                          <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                            value={videoSignalingIpAddress}
                            onChange={(e) =>
                              handleVideoSignalingIpAddressChange(e.target.value)
                            }
                            placeholder="192.168.1.12"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          シグナリング ポート
                          <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                            value={videoSignalingPort}
                            onChange={(e) =>
                              handleVideoSignalingPortChange(e.target.value)
                            }
                            placeholder="3000"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          ルームID
                          <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                            value={videoRoomId}
                            onChange={(e) => setVideoRoomId(e.target.value)}
                            placeholder="video_ab"
                          />
                        </label>
                      </div>

                      <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-700">
                        確認用WS URL: {videoSignalingWsUrl}
                      </p>
                    </>
                  }
                />
              </div>
            )}
          </Card>

          <Card title="統合プレビュー">
            <div className="mb-3">
              <div className="mb-2 text-xs text-slate-500">
                表示するパネルを選択
              </div>
              <div className="toggle-pill-group">
                <button
                  type="button"
                  className={`toggle-pill ${showVideoSenderPanel ? "is-active" : ""}`}
                  aria-pressed={showVideoSenderPanel}
                  onClick={() => setShowVideoSenderPanel((v) => !v)}
                >
                  Video Sender
                </button>
                <button
                  type="button"
                  className={`toggle-pill ${showAudioReceiverPanel ? "is-active" : ""}`}
                  aria-pressed={showAudioReceiverPanel}
                  onClick={() => setShowAudioReceiverPanel((v) => !v)}
                >
                  Audio Receiver
                </button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {showVideoSenderPanel && (
                <section
                  className={`rounded-xl border bg-slate-50 p-2 ${isSingleEmbeddedPreviewPanel ? "xl:col-span-2" : ""}`}
                >
                  <div className="mb-2 px-1">
                    <h3 className="text-sm font-semibold">Video Sender</h3>
                  </div>
                  <EmbeddedVideoSenderPage embedded />
                </section>
              )}

              {showAudioReceiverPanel && (
                <section
                  className={`rounded-xl border bg-slate-50 p-2 ${isSingleEmbeddedPreviewPanel ? "xl:col-span-2" : ""}`}
                >
                  <div className="mb-2 px-1">
                    <h3 className="text-sm font-semibold">Audio Receiver</h3>
                  </div>
                  <EmbeddedAudioReceiverPage embedded />
                </section>
              )}
            </div>

            {!showVideoSenderPanel && !showAudioReceiverPanel && (
              <p className="text-sm text-slate-500">
                パネルは初期状態で非表示です。上のトグルから表示してください。
              </p>
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}

function Card(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="teleco-card rounded-2xl border bg-white p-4 shadow-sm md:p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold leading-none tracking-tight text-slate-900">
          {props.title}
        </h2>
        {props.subtitle && (
          <p className="mt-1 text-sm text-slate-500">{props.subtitle}</p>
        )}
      </div>
      {props.children}
    </section>
  );
}

function subtitleForMode(mode: VideoSourceMode): string {
  switch (mode) {
    case "local":
      return "このPCのカメラ映像を表示します（getUserMedia）。";
    case "webSender":
      return "別PCの /video から映像を受信します（WebRTC + WS）。";
  }
}

