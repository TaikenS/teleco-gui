import { useState, type RefObject } from "react";

type Props = {
  localVideoRef: RefObject<HTMLVideoElement | null>;
  connected: boolean;
  log: string[];
};

export default function VideoSenderPreviewPanel({
  localVideoRef,
  connected,
  log,
}: Props) {
  const [showLog, setShowLog] = useState(false);

  return (
    <div className="space-y-3 rounded-xl border bg-white p-3">
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
        <video
          ref={localVideoRef}
          className="h-full w-full object-cover"
          muted
          playsInline
        />
      </div>

      <p className="text-xs text-slate-500">
        Signal: {connected ? "接続中" : "未接続"}
      </p>

      <div className="border-t pt-3" />
      <div className="toggle-pill-group">
        <button
          type="button"
          className={`toggle-pill ${showLog ? "is-active" : ""}`}
          onClick={() => setShowLog((v) => !v)}
          aria-pressed={showLog}
        >
          ログ
        </button>
      </div>

      {showLog && (
        <pre className="w-full rounded-xl border bg-slate-50 p-2 text-[11px] overflow-auto max-h-48 text-slate-700">
          {log.length > 0 ? log.join("\n") : "ログはまだありません"}
        </pre>
      )}
    </div>
  );
}
