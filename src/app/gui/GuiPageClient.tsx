"use client";

import React from "react";
import dynamic from "next/dynamic";
import AudioSenderDevicePanel from "@/app/gui/components/audio/sender/AudioSenderDevicePanel";
import { useAudioSenderController } from "@/app/gui/components/audio/sender/useAudioSenderController";
import TelecoControlPanel from "@/app/gui/components/teleco/TelecoControlPanel";
import {
  PanelField,
  PanelInfo,
  PanelInput,
  PanelSelect,
} from "@/components/ui/PanelCommon";
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
  () => import("@/app/gui/components/video/sender/VideoSenderPanel"),
  { ssr: false },
);
const EmbeddedAudioReceiverPage = dynamic(
  () => import("@/app/gui/components/audio/receiver/AudioReceiverPanel"),
  { ssr: false },
);

type VideoSourceMode = "local" | "webSender";
const VIDEO_MODE_STORAGE_KEY = "teleco.gui.videoMode";
const VIDEO_ROOM_STORAGE_KEY = "teleco.gui.video.roomId";
const VIDEO_SIGNAL_IP_ADDRESS_STORAGE_KEY =
  "teleco.gui.video.signalingIpAddress";
const VIDEO_SIGNAL_PORT_STORAGE_KEY = "teleco.gui.video.signalingPort";
const PANEL_AUDIO_SENDER_VISIBLE_KEY = "teleco.gui.panel.audioSender.visible";
const PANEL_AUDIO_RECEIVER_VISIBLE_KEY =
  "teleco.gui.panel.audioReceiver.visible";
const PANEL_TELECO_VISIBLE_KEY = "teleco.gui.panel.teleco.visible";
const PANEL_VIDEO_SENDER_VISIBLE_KEY = "teleco.gui.panel.videoSender.visible";
const PANEL_VIDEO_RECEIVER_VISIBLE_KEY =
  "teleco.gui.panel.videoReceiver.visible";

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
  const [showAudioSender, setShowAudioSender] = usePersistentState<boolean>(
    PANEL_AUDIO_SENDER_VISIBLE_KEY,
    true,
  );
  const [showAudioReceiver, setShowAudioReceiver] = usePersistentState<boolean>(
    PANEL_AUDIO_RECEIVER_VISIBLE_KEY,
    true,
  );
  const [showTeleco, setShowTeleco] = usePersistentState<boolean>(
    PANEL_TELECO_VISIBLE_KEY,
    true,
  );
  const [showVideoSender, setShowVideoSender] = usePersistentState<boolean>(
    PANEL_VIDEO_SENDER_VISIBLE_KEY,
    true,
  );
  const [showVideoReceiver, setShowVideoReceiver] = usePersistentState<boolean>(
    PANEL_VIDEO_RECEIVER_VISIBLE_KEY,
    true,
  );

  React.useEffect(() => {
    if (!didInitSettingsRef.current) return;
    if (!didEditSignalSettingsRef.current) return;
    scheduleEnvLocalSync({
      NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_IP_ADDRESS: videoSignalingIpAddress,
      NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_PORT: videoSignalingPort,
    });
  }, [videoSignalingIpAddress, videoSignalingPort]);

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
          <div className="toggle-pill-group">
            <button
              type="button"
              className={`toggle-pill ${showAudioSender ? "is-active" : ""}`}
              aria-pressed={showAudioSender}
              onClick={() => setShowAudioSender((v) => !v)}
            >
              音声送信
            </button>
            <button
              type="button"
              className={`toggle-pill ${showAudioReceiver ? "is-active" : ""}`}
              aria-pressed={showAudioReceiver}
              onClick={() => setShowAudioReceiver((v) => !v)}
            >
              音声受信
            </button>
            <button
              type="button"
              className={`toggle-pill ${showTeleco ? "is-active" : ""}`}
              aria-pressed={showTeleco}
              onClick={() => setShowTeleco((v) => !v)}
            >
              Teleco制御
            </button>
            <button
              type="button"
              className={`toggle-pill ${showVideoSender ? "is-active" : ""}`}
              aria-pressed={showVideoSender}
              onClick={() => setShowVideoSender((v) => !v)}
            >
              映像送信
            </button>
            <button
              type="button"
              className={`toggle-pill ${showVideoReceiver ? "is-active" : ""}`}
              aria-pressed={showVideoReceiver}
              onClick={() => setShowVideoReceiver((v) => !v)}
            >
              映像受信
            </button>
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

          {showAudioSender && (
            <Card title="音声送信">
              <AudioSenderDevicePanel {...audioSenderController.devicePanelProps} />
            </Card>
          )}

          {showAudioReceiver && (
            <Card title="音声受信">
              <EmbeddedAudioReceiverPage embedded />
            </Card>
          )}

        </section>

        <section className="space-y-4 lg:col-span-6 lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:pr-1">
          {showVideoSender && (
            <Card title="映像送信">
              <EmbeddedVideoSenderPage embedded />
            </Card>
          )}

          {showTeleco && (
            <Card title="Teleco制御">
              <TelecoControlPanel {...audioSenderController.telecoPanelProps} />
            </Card>
          )}

          {showVideoReceiver && (
            <Card title="映像受信">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">映像ソース</span>
                <PanelSelect
                  className="mt-0 px-3 py-1.5 text-xs"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as VideoSourceMode)}
                >
                  <option value="webSender">GUI内 送信映像（WebRTC）</option>
                  <option value="local">このPCのローカルカメラ</option>
                </PanelSelect>
              </div>

              {mode === "local" && (
                <LocalCameraStream videoDeviceId={selectedVideoId} />
              )}

              {mode === "webSender" && (
                <div className="space-y-3">
                  <WebRtcVideoReceiver
                    roomId={videoRoomId || DEFAULT_VIDEO_ROOM}
                    signalingWsUrl={videoSignalingWsUrl}
                    settingsPanel={({ connected, wsBusy }) => (
                      <>
                        <div className="grid gap-2 md:grid-cols-3">
                          <PanelField label="シグナリング IPアドレス">
                            <PanelInput
                              value={videoSignalingIpAddress}
                              onChange={(e) =>
                                handleVideoSignalingIpAddressChange(e.target.value)
                              }
                              placeholder="192.168.1.12"
                              disabled={connected || wsBusy}
                            />
                          </PanelField>

                          <PanelField label="シグナリング ポート">
                            <PanelInput
                              value={videoSignalingPort}
                              onChange={(e) =>
                                handleVideoSignalingPortChange(e.target.value)
                              }
                              placeholder="3000"
                              disabled={connected || wsBusy}
                            />
                          </PanelField>

                          <PanelField label="ルームID">
                            <PanelInput
                              value={videoRoomId}
                              onChange={(e) => setVideoRoomId(e.target.value)}
                              placeholder="video_ab"
                              disabled={connected || wsBusy}
                            />
                          </PanelField>
                        </div>

                        <PanelInfo>
                          確認用WS URL: {videoSignalingWsUrl}
                        </PanelInfo>
                      </>
                    )}
                  />
                </div>
              )}
            </Card>
          )}
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


