"use client";

import VideoSenderControlPanel from "@/app/gui/components/video/sender/components/VideoSenderControlPanel";
import VideoSenderPreviewPanel from "@/app/gui/components/video/sender/components/VideoSenderPreviewPanel";
import { useVideoSenderController } from "@/app/gui/components/video/sender/controller/useVideoSenderController";

export default function VideoSenderPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const controller = useVideoSenderController();

  const content = (
    <>
      {!embedded && <h1 className="text-xl font-semibold">Sender (別PC用)</h1>}
      <VideoSenderControlPanel {...controller.controlPanelProps} />
      <VideoSenderPreviewPanel {...controller.previewPanelProps} />
    </>
  );

  if (embedded) {
    return <div className="space-y-4">{content}</div>;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-4 p-4">{content}</div>
    </main>
  );
}
