"use client";

import { useState } from "react";
import AudioReceiverControlPanel from "@/app/audio/components/AudioReceiverControlPanel";
import AudioReceiverLogPanel from "@/app/audio/components/AudioReceiverLogPanel";
import AudioReceiverPlaybackPanel from "@/app/audio/components/AudioReceiverPlaybackPanel";
import { useAudioReceiverController } from "@/app/audio/controller/useAudioReceiverController";

export default function AudioReceiverPage() {
  const controller = useAudioReceiverController();
  const [showLogPanel, setShowLogPanel] = useState(false);

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
          onSignalingIpAddressChange={controller.setSignalingIpAddress}
          onSignalingPortChange={controller.setSignalingPort}
          onRoomIdChange={controller.setRoomId}
          onConnect={controller.handleConnect}
          onDisconnect={controller.disconnect}
        />

        <AudioReceiverPlaybackPanel
          audioRef={controller.audioRef}
          audioOutputOptions={controller.audioOutputOptions}
          selectedAudioOutputId={controller.selectedAudioOutputId}
          sinkSelectionSupported={controller.sinkSelectionSupported}
          onAudioOutputChange={controller.handleAudioOutputChange}
          onRefreshAudioOutputs={controller.refreshAudioOutputs}
        />

        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="border-t pt-3" />
          <div className="toggle-pill-group">
            <button
              type="button"
              className={`toggle-pill ${showLogPanel ? "is-active" : ""}`}
              aria-pressed={showLogPanel}
              onClick={() => setShowLogPanel((v) => !v)}
            >
              ログ
            </button>
          </div>
          {showLogPanel && <AudioReceiverLogPanel log={controller.log} />}
        </div>
      </div>
    </main>
  );
}
