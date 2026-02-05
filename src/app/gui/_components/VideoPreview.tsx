"use client";

import { useEffect, useMemo, useState } from "react";

type TelecoArrowDirection = "left" | "right";
const TELECO_ARROW_EVENT = "teleco:arrow";

function emitTelecoArrow(direction: TelecoArrowDirection) {
  window.dispatchEvent(
      new CustomEvent(TELECO_ARROW_EVENT, {
        detail: { direction },
      })
  );
}

export default function VideoPreview() {
  const [isExpanded, setIsExpanded] = useState(false);
  const videoSource = useMemo(() => "http://localhost:11920/video-stream", []);

  const onClose = () => setIsExpanded(false);
  const onOpen = () => setIsExpanded(true);

  useEffect(() => {
    if (!isExpanded) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        emitTelecoArrow("left");
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        emitTelecoArrow("right");
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isExpanded]);

  return (
      <div className="space-y-3">
        {!isExpanded ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-lg">
              <div className="relative aspect-video w-full">
                <img
                    src={videoSource}
                    alt="teleco preview"
                    className="h-full w-full object-cover"
                    loading="eager"
                />

                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
                  <p className="text-xs md:text-sm text-white/90">
                    Preview ・拡大中は <span className="font-semibold">← / →</span> で teleco 操作
                  </p>
                  <button
                      onClick={onOpen}
                      className="rounded-xl bg-white/90 px-3 py-1.5 text-xs md:text-sm font-medium text-slate-900 hover:bg-white"
                  >
                    拡大表示
                  </button>
                </div>
              </div>
            </div>
        ) : (
            <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-sm">
              <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
                <button
                    onClick={onClose}
                    className="rounded-xl bg-white/90 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-white"
                >
                  閉じる (Esc)
                </button>
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs text-white">
              キーボード操作: ← (+10) / → (-10)
            </span>
              </div>

              <div className="absolute inset-0 flex items-center justify-center p-4 md:p-8">
                <div className="relative h-full w-full max-w-[1600px] overflow-hidden rounded-2xl border border-white/20">
                  <img
                      src={videoSource}
                      alt="teleco preview fullscreen"
                      className="h-full w-full object-contain bg-black"
                      loading="eager"
                  />

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2 md:px-4">
                    <button
                        onClick={() => emitTelecoArrow("left")}
                        className="pointer-events-auto rounded-full bg-black/50 px-5 py-5 text-2xl text-white hover:bg-black/65"
                        aria-label="left"
                        title="左へ（+10）"
                    >
                      ←
                    </button>
                    <button
                        onClick={() => emitTelecoArrow("right")}
                        className="pointer-events-auto rounded-full bg-black/50 px-5 py-5 text-2xl text-white hover:bg-black/65"
                        aria-label="right"
                        title="右へ（-10）"
                    >
                      →
                    </button>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3 text-sm text-white/90">
                    拡大中に ← / → を押すと teleco に <code className="text-white">move_multi</code> を送信
                  </div>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}
