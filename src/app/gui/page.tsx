"use client"

import Link from "next/link";
import { useState } from "react";
import React from "react";
import VideoPreview from "@/app/gui/_components/VideoPreview";
import RemoteVideo from "@/app/gui/_components/RemoteVideo";
import LegacyTelecoVideo from "@/app/gui/_components/LegacyTelecoVideo";

type VideoSourceMode = "local" | "webSender" | "telecoLegacy";

export default function GuiPage(){
    const [mode, setMode] = useState<VideoSourceMode>("telecoLegacy");

    const [selectedVideoId, setSelectedVideoId] = useState<string | undefined>();

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            { /* Top bar */ }
            <header className="sticky top-0 border-b bg-white/90 backdrop-blur">
                <div className="mx-auto max-w-6xl px-4 py-3 flex items-center">
                    <span className="font-semibold trackiing-tight">
                        Operator
                    </span>
                    <nav className="ml-auto flex max-w-6xl items-center px-4 py-3">
                        <span className="text-slate-500">
                            映像ソース
                        </span>
                        <select className="rounded-xl border bg-white px-2 py-1 text-xs"
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

            { /* Content */ }
            <main className="mx-auto max-w-6xl p-4 grid gap-4 lg:grid-cols-12">
                {/* Left: controls */}
                <section className="lg:col-span-5 space-y-4">
                    <Card title="Device Setting" subtitle="Camera/Microphone/Share Screen">
                        <Field label="Camera">
                            <select className="w-full rounded-xl border px-3 py-2 text-sm bg-white">
                                <option>Front Camera</option>
                                <option>Room Camera</option>
                            </select>
                        </Field>
                        <Field label="Microphone">
                            <select className="w-full rounded-xl border px-3 py-2 text-sm bg-white">
                                <option>Built-in Mic</option>
                                <option>USB Mic</option>
                            </select>
                        </Field>
                        <div className="pt-2 flex gap-2">
                            <button className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:gb-slate-700">接続</button>
                            <button className="rounded-xl bg-slate-100 px-4py-2 text-sm hover:bg-slate-200">テスト</button>
                        </div>
                    </Card>
                </section>

                { /* Right: preview & logs */ }
                <section className="lg:col-span-7 space-y-4">
                    <Card title="Preview" subtitle={subtitleForMode(mode)}>
                        {mode === "local" && (
                            <VideoPreview videoDeviceId={selectedVideoId} />
                        )}
                        {mode === "webSender" && (
                            <RemoteVideo roomId="room1" />
                        )}
                        {mode === "telecoLegacy" && (
                            <LegacyTelecoVideo telecoId="teleco001"/>
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

function Card(props: {title: string;
                      subtitle?: string;
children: React.ReactNode}) {
    return (
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="mb-3">
                <h2 className="text-lg font-semibold leading-none tracking-tight">
                    {props.title}
                </h2>
                {props.subtitle &&
                    <p className="text-slate-500 text-sm mt-0.5">
                        {props.subtitle}
                    </p>}
            </div>
            {props.children}
        </section>
    )
}

function Field({ label, children }: { label: string, children: React.ReactNode}) {
    return (
        <div className="flex items-center gap-3 py-2">
            <div className="w-20 shrink-0 text-sm text-slate-500">{label}</div>
            <div className="grow">{children}</div>
        </div>
    );
}

function subtitleForMode(mode: VideoSourceMode): string {
    switch (mode) {
        case "local":
            return "このPCのカメラ映像 (getUserMedia)";
        case "webSender":
            return "別PCの /senderからの映像(WebRTC+WS)";
        case "telecoLegacy":
            return "teleco/rover からの映像"
    }
}

function ConfigViewer() {
    // Client Component (SSR不要)
    // ここでは簡易実装 (fetchを直接使用)
    // 本格実装は src/lib/api.tsをimportしてuseEffect/useStateでOK
    return (
        <pre className="rounded-xl bg-slate-100 p-3 text-xs">
            {`{"version": "0.1", "features": ["devicePicker", "preview", "logging"]}`}
        </pre>
    );
}