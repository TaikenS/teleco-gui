"use client";

import { useState } from "react";
import VideoPreview from "./_components/VideoPreview";
import AudioSender from "./_components/AudioSender";

type LayoutMode = "telecoStream" | "audioSender";

export default function GuiPage() {
  const [mode, setMode] = useState<LayoutMode>("telecoStream");

  return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
        <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-5">
          <header className="rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur px-5 py-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Teleco GUI</h1>
                <p className="text-sm text-slate-600">操作モードを切り替えて利用できます</p>
              </div>

              <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                <button
                    onClick={() => setMode("telecoStream")}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        mode === "telecoStream"
                            ? "bg-slate-900 text-white shadow"
                            : "text-slate-600 hover:bg-white"
                    }`}
                >
                  Video Control
                </button>
                <button
                    onClick={() => setMode("audioSender")}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        mode === "audioSender"
                            ? "bg-slate-900 text-white shadow"
                            : "text-slate-600 hover:bg-white"
                    }`}
                >
                  Audio Sender
                </button>
              </div>
            </div>
          </header>

          {mode === "telecoStream" ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
                <VideoPreview />
              </section>
          ) : (
              <section className="rounded-3xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
                <AudioSender />
              </section>
          )}
        </div>
      </main>
  );
}
