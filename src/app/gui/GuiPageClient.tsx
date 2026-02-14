"use client";

import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import {
  buildSignalingUrl,
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
} from "@/lib/signaling";
import { usePersistentState } from "@/lib/usePersistentState";

const AudioSender = dynamic(
  () => import("@/app/gui/components/audio/sender/AudioSender"),
  { ssr: false },
);
const LocalCameraStream = dynamic(
  () => import("@/app/gui/components/video/LocalCameraStream"),
  { ssr: false },
);
const WebRtcVideoReceiver = dynamic(
  () => import("@/app/gui/components/video/WebRtcVideoReceiver"),
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
const VIDEO_SEND_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_IP_ADDRESS",
];
const VIDEO_SEND_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_PORT",
];
const DEFAULT_SIGNALING_IP_ADDRESS = getDefaultSignalingIpAddress({
  envKeys: VIDEO_SEND_SIGNALING_IP_ENV_KEYS,
});
const DEFAULT_SIGNALING_PORT = getDefaultSignalingPort({
  envKeys: VIDEO_SEND_SIGNALING_PORT_ENV_KEYS,
});

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
    scheduleEnvLocalSync({
      NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS: videoSignalingIpAddress,
      NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT: videoSignalingPort,
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

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const hasLegacyIp = window.localStorage.getItem(
      VIDEO_SIGNAL_IP_ADDRESS_STORAGE_KEY,
    );
    const hasLegacyPort = window.localStorage.getItem(
      VIDEO_SIGNAL_PORT_STORAGE_KEY,
    );
    if (hasLegacyIp == null && hasLegacyPort == null) return;

    window.localStorage.removeItem(VIDEO_SIGNAL_IP_ADDRESS_STORAGE_KEY);
    window.localStorage.removeItem(VIDEO_SIGNAL_PORT_STORAGE_KEY);
    setVideoSignalingIpAddress(DEFAULT_SIGNALING_IP_ADDRESS);
    setVideoSignalingPort(DEFAULT_SIGNALING_PORT);
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
            <p className="text-xs text-slate-500">
              左: 音声・Teleco制御 / 右: 映像受信・統合プレビュー
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="teleco-badge">映像ソース: {modeLabel(mode)}</span>
            <span className="teleco-badge">映像Room: {videoRoomId || "(未設定)"}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1680px] gap-4 px-4 py-4 md:px-6 lg:grid-cols-12 lg:items-start lg:pb-6">
        <section className="space-y-4 lg:col-span-4 lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:pr-1">
          <Card title="デバイス設定" subtitle="音声送信とマイク状態を確認します">
            <AudioSender panel="device" />
          </Card>

          <Card
            title="Teleco制御"
            subtitle="Teleco接続、口パク手動プリセット、任意コマンド送信"
          >
            <AudioSender panel="teleco" />
          </Card>
        </section>

        <section className="space-y-4 lg:col-span-8 lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:pr-1">
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
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    映像 Room ID
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={videoRoomId}
                      onChange={(e) => setVideoRoomId(e.target.value)}
                      placeholder="video_ab"
                    />
                  </label>

                  <label className="text-sm text-slate-700">
                    シグナリング IPアドレス
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={videoSignalingIpAddress}
                      onChange={(e) =>
                        setVideoSignalingIpAddress(e.target.value)
                      }
                      placeholder="192.168.1.12"
                    />
                  </label>

                  <label className="text-sm text-slate-700 md:col-span-2 lg:max-w-[280px]">
                    シグナリング ポート
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={videoSignalingPort}
                      onChange={(e) => setVideoSignalingPort(e.target.value)}
                      placeholder="3000"
                    />
                  </label>
                </div>

                <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-700">
                  確認用WS URL: {videoSignalingWsUrl}
                </p>

                <p className="text-[11px] text-slate-500">
                  単一インスタンス運用向け: ここで受信先のSignal / Roomを切り替えできます。
                  Sender側のRoom IDと一致させてください。
                </p>

                <WebRtcVideoReceiver
                  roomId={videoRoomId || DEFAULT_VIDEO_ROOM}
                  signalingWsUrl={videoSignalingWsUrl}
                />
              </div>
            )}
          </Card>

          <Card title="運用メモ" subtitle="GUIの動作ポイント">
            <ul className="space-y-2 text-sm">
              {[
                "AudioSenderは常時マウントされるため、映像ソースを切り替えてもWSは切断されません。",
                "口パク送信は Command WS 接続時のみ有効です。",
              ].map((line, idx) => (
                <li key={idx} className="rounded-xl bg-slate-100 px-3 py-2">
                  {line}
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="統合プレビュー"
            subtitle="/video と /audio をこのページ内に埋め込みます"
          >
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
                <section className="rounded-xl border bg-slate-50 p-2">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <h3 className="text-sm font-semibold">
                      Video Sender (/video)
                    </h3>
                    <Link
                      href="/video"
                      target="_blank"
                      prefetch={false}
                      className="text-xs text-slate-600 hover:text-slate-900"
                    >
                      新しいタブで開く
                    </Link>
                  </div>

                  <iframe
                    src="/video"
                    title="Video Sender"
                    className="h-[760px] w-full rounded-lg border bg-white"
                    allow="camera; microphone; autoplay"
                  />
                </section>
              )}

              {showAudioReceiverPanel && (
                <section className="rounded-xl border bg-slate-50 p-2">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <h3 className="text-sm font-semibold">
                      Audio Receiver (/audio)
                    </h3>
                    <Link
                      href="/audio"
                      target="_blank"
                      prefetch={false}
                      className="text-xs text-slate-600 hover:text-slate-900"
                    >
                      新しいタブで開く
                    </Link>
                  </div>

                  <iframe
                    src="/audio"
                    title="Audio Receiver"
                    className="h-[760px] w-full rounded-lg border bg-white"
                    allow="autoplay"
                  />
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

function modeLabel(mode: VideoSourceMode): string {
  return mode === "local" ? "ローカルカメラ" : "WebRTC sender";
}
