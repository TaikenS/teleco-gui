"use client";

import Link from "next/link";
import AudioSenderControlPanel from "@/app/audio/sender/components/AudioSenderControlPanel";
import AudioSenderLogPanel from "@/app/audio/sender/components/AudioSenderLogPanel";
import AudioSenderMonitorPanel from "@/app/audio/sender/components/AudioSenderMonitorPanel";
import { useAudioSenderController } from "@/app/audio/sender/controller/useAudioSenderController";

export default function AudioSenderPage() {
  const controller = useAudioSenderController();

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Audio Sender (別PC用)</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/audio"
              prefetch={false}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Receiverへ
            </Link>
            <Link
              href="/gui"
              prefetch={false}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              GUIへ戻る
            </Link>
          </div>
        </div>

        <AudioSenderControlPanel
          micReady={controller.micReady}
          micBusy={controller.micBusy}
          connected={controller.connected}
          wsBusy={controller.wsBusy}
          sendBusy={controller.sendBusy}
          rtcState={controller.rtcState}
          roomId={controller.roomId}
          signalingIpAddress={controller.signalingIpAddress}
          signalingPort={controller.signalingPort}
          signalingWsUrlForDisplay={controller.signalingWsUrlForDisplay}
          signalingBaseUrlForDisplay={controller.signalingBaseUrlForDisplay}
          sendEnabled={controller.sendEnabled}
          canStartMic={controller.canStartMic}
          canConnectSignal={controller.canConnectSignal}
          canStartSend={controller.canStartSend}
          canStopConnection={controller.canStopConnection}
          error={controller.error}
          onRoomIdChange={controller.setRoomId}
          onSignalingIpAddressChange={controller.setSignalingIpAddress}
          onSignalingPortChange={controller.setSignalingPort}
          onStartMic={controller.startMic}
          onConnectSignal={controller.handleConnectSignaling}
          onSendEnabledChange={controller.setSendEnabled}
          onStartSend={() => void controller.startSend(false)}
          onStopConnection={controller.handleStopConnection}
        />

        <AudioSenderMonitorPanel localAudioRef={controller.localAudioRef} />
        <AudioSenderLogPanel log={controller.log} />
      </div>
    </main>
  );
}
