"use client";

import { useEffect, useState } from "react";
import React from "react";
import Link from "next/link";
import AudioSender from "@/app/gui/_components/AudioSender";
import RemoteVideo from "@/app/gui/_components/RemoteVideo";
import VideoPreview from "@/app/gui/_components/VideoPreview";

type VideoSourceMode = "local" | "webSender";
const VIDEO_MODE_STORAGE_KEY = "teleco.gui.videoMode";
const VIDEO_ROOM_STORAGE_KEY = "teleco.gui.video.roomId";
const VIDEO_SIGNAL_URL_STORAGE_KEY = "teleco.gui.video.signalingWsUrl";
const EMBED_VIDEO_SENDER_KEY = "teleco.gui.embed.videoSender";
const EMBED_AUDIO_RECEIVER_KEY = "teleco.gui.embed.audioReceiver";

const DEFAULT_VIDEO_ROOM = process.env.NEXT_PUBLIC_DEFAULT_VIDEO_ROOM || "room1";
const DEFAULT_SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "";

export default function GuiPage() {
  const [mode, setMode] = useState<VideoSourceMode>("local");
  const [selectedVideoId] = useState<string | undefined>();
  const [videoRoomId, setVideoRoomId] = useState<string>(DEFAULT_VIDEO_ROOM);
  const [videoSignalingWsUrl, setVideoSignalingWsUrl] = useState<string>(DEFAULT_SIGNALING_URL);

  // 1タブ統合パネルの表示状態
  const [showVideoSenderPanel, setShowVideoSenderPanel] = useState<boolean>(true);
  const [showAudioReceiverPanel, setShowAudioReceiverPanel] = useState<boolean>(true);

  useEffect(() => {
    const savedMode = window.localStorage.getItem(VIDEO_MODE_STORAGE_KEY);
    if (savedMode === "local" || savedMode === "webSender") {
      setMode(savedMode);
    }

    const savedVideoRoomId = window.localStorage.getItem(VIDEO_ROOM_STORAGE_KEY);
    if (savedVideoRoomId) {
      setVideoRoomId(savedVideoRoomId);
    }

    const savedVideoSignalUrl = window.localStorage.getItem(VIDEO_SIGNAL_URL_STORAGE_KEY);
    if (savedVideoSignalUrl != null) {
      setVideoSignalingWsUrl(savedVideoSignalUrl);
    }

    const savedShowVideoSender = window.localStorage.getItem(EMBED_VIDEO_SENDER_KEY);
    if (savedShowVideoSender != null) {
      setShowVideoSenderPanel(savedShowVideoSender === "1");
    }

    const savedShowAudioReceiver = window.localStorage.getItem(EMBED_AUDIO_RECEIVER_KEY);
    if (savedShowAudioReceiver != null) {
      setShowAudioReceiverPanel(savedShowAudioReceiver === "1");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIDEO_MODE_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    window.localStorage.setItem(VIDEO_ROOM_STORAGE_KEY, videoRoomId);
  }, [videoRoomId]);

  useEffect(() => {
    window.localStorage.setItem(VIDEO_SIGNAL_URL_STORAGE_KEY, videoSignalingWsUrl);
  }, [videoSignalingWsUrl]);

  useEffect(() => {
    window.localStorage.setItem(EMBED_VIDEO_SENDER_KEY, showVideoSenderPanel ? "1" : "0");
  }, [showVideoSenderPanel]);

  useEffect(() => {
    window.localStorage.setItem(EMBED_AUDIO_RECEIVER_KEY, showAudioReceiverPanel ? "1" : "0");
  }, [showAudioReceiverPanel]);

  return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
            <span className="font-semibold tracking-tight">Teleco Operator</span>

            <nav className="ml-auto flex flex-wrap items-center gap-2">
              <Link
                  href="/sender"
                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800"
              >
                Video Senderへ
              </Link>
              <Link
                  href="/audio"
                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800"
              >
                Audio Receiverへ
              </Link>
              <Link
                  href="/audio/sender"
                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800"
              >
                Audio Senderへ
              </Link>
              <Link href="/" className="px-1 text-sm text-slate-600 hover:text-slate-900">
                Home
              </Link>

              <span className="ml-2 text-xs text-slate-500">映像ソース</span>
              <select
                  className="rounded-xl border bg-white px-2 py-1 text-xs"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as VideoSourceMode)}
              >
                <option value="webSender">WebRTC sender (/sender)</option>
                <option value="local">このPCのカメラ</option>
              </select>
            </nav>
          </div>
        </header>

        <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-12">
          <section className="space-y-4 lg:col-span-5">
            <Card title="Device Setting" subtitle="Audio Sender / Mouth / Command">
              <AudioSender />
            </Card>
          </section>

          <section className="space-y-4 lg:col-span-7">
            <Card title="Preview" subtitle={subtitleForMode(mode)}>
              {mode === "local" && <VideoPreview videoDeviceId={selectedVideoId} />}
              {mode === "webSender" && (
                  <div className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="text-sm text-slate-700">
                        Video Room ID
                        <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                            value={videoRoomId}
                            onChange={(e) => setVideoRoomId(e.target.value)}
                            placeholder="video_ab"
                        />
                      </label>

                      <label className="text-sm text-slate-700">
                        Signaling WS URL（空ならこのGUI自身）
                        <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                            value={videoSignalingWsUrl}
                            onChange={(e) => setVideoSignalingWsUrl(e.target.value)}
                            placeholder="ws://192.168.1.12:3000/ws"
                        />
                      </label>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      1インスタンス運用向け: ここで受信先Signal/Roomを切り替えできます。Sender側のRoom IDと合わせてください。
                    </p>

                    <RemoteVideo roomId={videoRoomId || DEFAULT_VIDEO_ROOM} signalingWsUrl={videoSignalingWsUrl} />
                  </div>
              )}
            </Card>

            <Card title="Logs" subtitle="GUI status">
              <ul className="space-y-2 text-sm">
                {[
                  "AudioSender は常時マウントされるため、映像ソース切替でWSは切断されません。",
                  "口パク送信は Command WS 接続時に有効です。",
                ].map((line, idx) => (
                    <li key={idx} className="rounded-xl bg-slate-100 px-3 py-2">
                      {line}
                    </li>
                ))}
              </ul>
            </Card>
          </section>

          <section className="space-y-4 lg:col-span-12">
            <Card title="1タブ統合パネル" subtitle="/sender と /audio をこのページ内に埋め込みます">
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                      type="checkbox"
                      checked={showVideoSenderPanel}
                      onChange={(e) => setShowVideoSenderPanel(e.target.checked)}
                  />
                  Video Sender パネルを表示
                </label>

                <label className="inline-flex items-center gap-2">
                  <input
                      type="checkbox"
                      checked={showAudioReceiverPanel}
                      onChange={(e) => setShowAudioReceiverPanel(e.target.checked)}
                  />
                  Audio Receiver パネルを表示
                </label>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {showVideoSenderPanel && (
                    <section className="rounded-xl border bg-slate-50 p-2">
                      <div className="mb-2 flex items-center justify-between px-1">
                        <h3 className="text-sm font-semibold">Video Sender (/sender)</h3>
                        <Link href="/sender" target="_blank" className="text-xs text-slate-600 hover:text-slate-900">
                          別タブで開く
                        </Link>
                      </div>

                      <iframe
                          src="/sender"
                          title="Video Sender"
                          className="h-[760px] w-full rounded-lg border bg-white"
                          allow="camera; microphone; autoplay"
                      />
                    </section>
                )}

                {showAudioReceiverPanel && (
                    <section className="rounded-xl border bg-slate-50 p-2">
                      <div className="mb-2 flex items-center justify-between px-1">
                        <h3 className="text-sm font-semibold">Audio Receiver (/audio)</h3>
                        <Link href="/audio" target="_blank" className="text-xs text-slate-600 hover:text-slate-900">
                          別タブで開く
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
                  <p className="text-sm text-slate-500">パネルが非表示です。必要なものにチェックを入れてください。</p>
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
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="text-lg font-semibold leading-none tracking-tight">{props.title}</h2>
          {props.subtitle && <p className="mt-0.5 text-sm text-slate-500">{props.subtitle}</p>}
        </div>
        {props.children}
      </section>
  );
}

function subtitleForMode(mode: VideoSourceMode): string {
  switch (mode) {
    case "local":
      return "このPCのカメラ映像 (getUserMedia)";
    case "webSender":
      return "別PCの /sender からの映像(WebRTC+WS)";
  }
}
