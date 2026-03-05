"use client";

import AudioReceiverControlPanel from "@/app/audio/components/AudioReceiverControlPanel";
import { useAudioReceiverController } from "@/app/audio/controller/useAudioReceiverController";

export default function AudioReceiverPage() {
  const controller = useAudioReceiverController();

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            Audio Receiver（別PC用 / label方式 Teleco互換）
          </h1>
        </div>

        <AudioReceiverControlPanel
          connected={controller.connected}
          wsBusy={controller.wsBusy}
          hasAudioTrack={controller.hasAudioTrack}
          signalingIpAddress={controller.signalingIpAddress}
          signalingPort={controller.signalingPort}
          roomId={controller.roomId}
          signalingWsUrlForDisplay={controller.signalingWsUrlForDisplay}
          canConnect={controller.canConnect}
          canDisconnect={controller.canDisconnect}
          error={controller.error}
          audioRef={controller.audioRef}
          audioOutputOptions={controller.audioOutputOptions}
          selectedAudioOutputId={controller.selectedAudioOutputId}
          sinkSelectionSupported={controller.sinkSelectionSupported}
          log={controller.log}
          onSignalingIpAddressChange={controller.setSignalingIpAddress}
          onSignalingPortChange={controller.setSignalingPort}
          onRoomIdChange={controller.setRoomId}
          onConnect={controller.handleConnect}
          onDisconnect={controller.disconnect}
          onAudioOutputChange={controller.handleAudioOutputChange}
          onRefreshAudioOutputs={controller.refreshAudioOutputs}
        />
      </div>
    </main>
  );
}
