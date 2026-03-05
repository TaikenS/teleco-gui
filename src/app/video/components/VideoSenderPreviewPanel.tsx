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
        <div className="rounded-xl border bg-white p-3">
          <div className="mb-2 text-sm font-semibold">映像送信 ログ</div>
          <div className="max-h-48 space-y-1 overflow-auto text-xs text-slate-700">
            {log.length > 0 ? (
              log.map((line, index) => <div key={index}>{line}</div>)
            ) : (
              <div className="text-slate-500">ログはまだありません</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
