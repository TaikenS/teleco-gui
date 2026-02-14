"use client";

import AudioSenderDevicePanel from "@/app/gui/_components/audio/sender/AudioSenderDevicePanel";
import {
  type AudioSenderPanelMode,
  useAudioSenderController,
} from "@/app/gui/_components/audio/sender/useAudioSenderController";
import TelecoControlPanel from "@/app/gui/_components/teleco/TelecoControlPanel";

export default function AudioSender({
  panel = "all",
}: {
  panel?: AudioSenderPanelMode;
}) {
  const controller = useAudioSenderController({ panel });

  return (
    <div className="space-y-4">
      {controller.error && (
        <p className="text-xs text-red-600 whitespace-pre-line">
          {controller.error}
        </p>
      )}

      {controller.isDevicePanel && (
        <AudioSenderDevicePanel {...controller.devicePanelProps} />
      )}

      {controller.isTelecoPanel && (
        <TelecoControlPanel {...controller.telecoPanelProps} />
      )}
    </div>
  );
}
