import { useState, type RefObject } from "react";
import { PanelDivider, PanelLog } from "@/components/ui/PanelCommon";

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

      <PanelDivider />
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
        <PanelLog>{log.length > 0 ? log.join("\n") : "ログはまだありません"}</PanelLog>
      )}
    </div>
  );
}
