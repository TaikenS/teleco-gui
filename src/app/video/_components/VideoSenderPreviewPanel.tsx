import type { RefObject } from "react";

type Props = {
  localVideoRef: RefObject<HTMLVideoElement | null>;
  connected: boolean;
  activeCameraLabel: string;
};

export default function VideoSenderPreviewPanel({ localVideoRef, connected, activeCameraLabel }: Props) {
  return (
    <div className="space-y-2 rounded-2xl border bg-white p-4">
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
        <video ref={localVideoRef} className="h-full w-full object-cover" muted playsInline />
      </div>
      <p className="text-xs text-slate-500">これは「送信側PCのローカルプレビュー」です。</p>
      <p className="text-xs text-slate-500">Signal: {connected ? "接続中" : "未接続"}</p>
      <p className="text-xs text-slate-500">Camera: {activeCameraLabel}</p>
    </div>
  );
}
