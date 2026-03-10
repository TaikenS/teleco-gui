"use client";

import React from "react";
import dynamic from "next/dynamic";
import SectionCard from "@/app/gui/components/SectionCard";
import AudioSenderDevicePanel from "@/app/gui/components/audio/sender/AudioSenderDevicePanel";
import { useAudioSenderController } from "@/app/gui/components/audio/sender/useAudioSenderController";
import TelecoControlPanel from "@/app/gui/components/teleco/TelecoControlPanel";
import {
  type VideoSourceMode,
  VIDEO_MODE_STORAGE_KEY,
  parseVideoMode,
} from "@/app/gui/constants";
import { useGuiPanelVisibility } from "@/app/gui/hooks/useGuiPanelVisibility";
import { useVideoReceiverSettings } from "@/app/gui/hooks/useVideoReceiverSettings";
import {
  PanelField,
  PanelInfo,
  PanelInput,
  PanelSelect,
} from "@/components/ui/PanelCommon";
import { usePersistentState } from "@/lib/usePersistentState";

const LocalCameraStream = dynamic(
  () => import("@/app/gui/components/video/LocalCameraStream"),
  { ssr: false },
);
const WebRtcVideoReceiver = dynamic(
  () => import("@/app/gui/components/video/WebRtcVideoReceiver"),
  { ssr: false },
);
const EmbeddedVideoSenderPage = dynamic(
  () => import("@/app/gui/components/video/sender/VideoSenderPanel"),
  { ssr: false },
);
const EmbeddedAudioReceiverPage = dynamic(
  () => import("@/app/gui/components/audio/receiver/AudioReceiverPanel"),
  { ssr: false },
);

export default function GuiPage() {
  const audioSenderController = useAudioSenderController({ panel: "all" });
  const panelVisibility = useGuiPanelVisibility();
  const videoReceiverSettings = useVideoReceiverSettings();

  const [mode, setMode] = usePersistentState<VideoSourceMode>(
    VIDEO_MODE_STORAGE_KEY,
    "local",
    { deserialize: parseVideoMode },
  );

  return (
    <div className="teleco-gui-shell min-h-screen text-slate-900">
      <header className="teleco-gui-header sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-500">
              Teleco GUI
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-slate-950">
              Teleco Operator Console
            </h1>
          </div>
          <div className="toggle-pill-group">
            {panelVisibility.panelToggleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`toggle-pill ${item.visible ? "is-active" : ""}`}
                aria-pressed={item.visible}
                onClick={item.toggle}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1680px] gap-4 px-4 py-4 md:px-6 lg:grid-cols-12 lg:items-start lg:pb-6">
        <section className="space-y-4 lg:col-span-6 lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:pr-1">
          {audioSenderController.error && (
            <p className="text-xs text-red-600 whitespace-pre-line">
              {audioSenderController.error}
            </p>
          )}

          {panelVisibility.showAudioSender && (
            <SectionCard title="音声送信">
              <AudioSenderDevicePanel
                {...audioSenderController.devicePanelProps}
              />
            </SectionCard>
          )}

          {panelVisibility.showAudioReceiver && (
            <SectionCard title="音声受信">
              <EmbeddedAudioReceiverPage embedded />
            </SectionCard>
          )}
        </section>

        <section className="space-y-4 lg:col-span-6 lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:pr-1">
          {panelVisibility.showVideoSender && (
            <SectionCard title="映像送信">
              <EmbeddedVideoSenderPage embedded />
            </SectionCard>
          )}

          {panelVisibility.showTeleco && (
            <SectionCard title="Teleco制御">
              <TelecoControlPanel {...audioSenderController.telecoPanelProps} />
            </SectionCard>
          )}

          {panelVisibility.showVideoReceiver && (
            <SectionCard title="映像受信">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">
                  映像ソース
                </span>
                <PanelSelect
                  className="mt-0 px-3 py-1.5 text-xs"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as VideoSourceMode)}
                >
                  <option value="webSender">GUI内 送信映像（WebRTC）</option>
                  <option value="local">このPCのローカルカメラ</option>
                </PanelSelect>
              </div>

              {mode === "local" && (
                <LocalCameraStream videoDeviceId={undefined} />
              )}

              {mode === "webSender" && (
                <div className="space-y-3">
                  <WebRtcVideoReceiver
                    roomId={videoReceiverSettings.effectiveVideoRoomId}
                    signalingWsUrl={videoReceiverSettings.videoSignalingWsUrl}
                    settingsPanel={({ connected, wsBusy }) => (
                      <>
                        <div className="grid gap-2 md:grid-cols-3">
                          <PanelField label="シグナリング IPアドレス">
                            <PanelInput
                              value={
                                videoReceiverSettings.videoSignalingIpAddress
                              }
                              onChange={(e) =>
                                videoReceiverSettings.onVideoSignalingIpAddressChange(
                                  e.target.value,
                                )
                              }
                              placeholder="192.168.1.12"
                              disabled={connected || wsBusy}
                            />
                          </PanelField>

                          <PanelField label="シグナリング ポート">
                            <PanelInput
                              value={videoReceiverSettings.videoSignalingPort}
                              onChange={(e) =>
                                videoReceiverSettings.onVideoSignalingPortChange(
                                  e.target.value,
                                )
                              }
                              placeholder="3000"
                              disabled={connected || wsBusy}
                            />
                          </PanelField>

                          <PanelField label="ルームID">
                            <PanelInput
                              value={videoReceiverSettings.videoRoomId}
                              onChange={(e) =>
                                videoReceiverSettings.setVideoRoomId(
                                  e.target.value,
                                )
                              }
                              placeholder="video_ab"
                              disabled={connected || wsBusy}
                            />
                          </PanelField>
                        </div>

                        <PanelInfo>
                          確認用WS URL:{" "}
                          {videoReceiverSettings.videoSignalingWsUrl}
                        </PanelInfo>
                      </>
                    )}
                  />
                </div>
              )}
            </SectionCard>
          )}
        </section>
      </main>
    </div>
  );
}
