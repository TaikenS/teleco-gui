"use client";

import { useState } from "react";
import React from "react";
import Link from "next/link";
import AudioSender from "@/app/gui/_components/AudioSender";
import RemoteVideo from "@/app/gui/_components/RemoteVideo";
import VideoPreview from "@/app/gui/_components/VideoPreview";

type VideoSourceMode = "local" | "webSender" ;

export default function GuiPage() {
  const [mode, setMode] = useState<VideoSourceMode>("local");
  const [selectedVideoId] = useState<string | undefined>();

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
              {mode === "webSender" && <RemoteVideo roomId="room1" />}
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
