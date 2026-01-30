"use client";

import { useState } from "react";
import React from "react";
import Link from "next/link";
import AudioSender from "@/app/gui/_components/AudioSender";
import { LegacyTelecoVideoTs } from "@/app/gui/_components/LegacyTelecoVideoTs";
import RemoteVideo from "@/app/gui/_components/RemoteVideo";
import VideoPreview from "@/app/gui/_components/VideoPreview";

type VideoSourceMode = "local" | "webSender" | "telecoLegacy";

export default function GuiPage() {
  const [mode, setMode] = useState<VideoSourceMode>("local");
  const [selectedVideoId] = useState<string | undefined>();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center">
          <span className="font-semibold trackiing-tight">Teleco Operator</span>
          <nav className="ml-auto flex max-w-6xl items-center px-4 py-3">
            <Link href="/" className="text-slate-600 hover:text-slate-900">
              Home
            </Link>

            <span className="text-slate-500">映像ソース</span>
            <select
              className="rounded-xl border bg-white px-2 py-1 text-xs"
              value={mode}
              onChange={(e) => setMode(e.target.value as VideoSourceMode)}
            >
              <option value="telecoLegacy">teleco/rover</option>
              <option value="webSender">WebRTC sender (/sender)</option>
              <option value="local">このPCのカメラ</option>
            </select>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl p-4 grid gap-4 lg:grid-cols-12">
        {/* Left: controls */}
        <section className="lg:col-span-5 space-y-4">
          <Card
            title="Device Setting"
            subtitle="Camera/Microphone/Share Screen"
          >
            <AudioSender />
          </Card>
        </section>

        {/* Right: preview & logs */}
        <section className="lg:col-span-7 space-y-4">
          <Card title="Preview" subtitle={subtitleForMode(mode)}>
            {mode === "local" && (
              <VideoPreview videoDeviceId={selectedVideoId} />
            )}
            {mode === "webSender" && <RemoteVideo roomId="room1" />}
            {mode === "telecoLegacy" && (
              <LegacyTelecoVideoTs telecoId="rover003" />
            )}
          </Card>

          <Card title="Logs" subtitle="New Event">
            <ul className="space-y-2 text-sm">
              {[
                "waiting for device",
                "get device list /api/get_configuration",
              ].map((l, item) => (
                <li key={item} className="rounded-xl bg-slate-100 px-3 py-2">
                  {l}
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
        <h2 className="text-lg font-semibold leading-none tracking-tight">
          {props.title}
        </h2>
        {props.subtitle && (
          <p className="text-slate-500 text-sm mt-0.5">{props.subtitle}</p>
        )}
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
      return "別PCの /senderからの映像(WebRTC+WS)";
    case "telecoLegacy":
      return "teleco/rover からの映像";
  }
}
