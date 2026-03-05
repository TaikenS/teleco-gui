import { useState, type RefObject } from "react";
import { ActionButton, ActionControl } from "@/components/ui/ActionButton";
import {
  PanelBox,
  PanelDivider,
  PanelField,
  PanelInfo,
  PanelInput,
  PanelLog,
  PanelSelect,
} from "@/components/ui/PanelCommon";

type MicOption = { deviceId: string; label: string };

type Props = {
  signalConnected: boolean;
  signalBusy: boolean;
  callActive: boolean;
  callStatus: string;
  hasMic: boolean;
  signalingIpAddress: string;
  signalingPort: string;
  roomHint: string;
  signalingWsUrlForDisplay: string;
  mics: MicOption[];
  selectedMicId: string;
  signalWsStatus: string;
  lastVowel: string;
  micTestRunning: boolean;
  autoMouthEnabled: boolean;
  monitorVolume: number;
  noiseFloor: number;
  gain: number;
  mouthSpeakingThreshold: number;
  mouthSendFps: number;
  micLevel: number;
  canConnectSignalNow: boolean;
  canDisconnectSignal: boolean;
  canStartSending: boolean;
  canStopSending: boolean;
  canStartMicTest: boolean;
  canStopMicTest: boolean;
  hasSignalingTarget: boolean;
  showSignalLogPanel: boolean;
  signalConnectionLog: string;
  micTestAudioRef: RefObject<HTMLAudioElement | null>;
  onSetSignalingIpAddress: (v: string) => void;
  onSetSignalingPort: (v: string) => void;
  onSetRoomHint: (v: string) => void;
  onSetSelectedMicId: (v: string) => void;
  onSetAutoMouthEnabled: (v: boolean) => void;
  onSetMonitorVolume: (v: number) => void;
  onSetNoiseFloor: (v: number) => void;
  onSetGain: (v: number) => void;
  onSetMouthSpeakingThreshold: (v: number) => void;
  onSetMouthSendFps: (v: number) => void;
  onRefreshDevices: () => void;
  onConnectSignal: () => void;
  onDisconnectSignal: () => void;
  onStartSending: () => void;
  onStopSending: () => void;
  onStartMicTest: () => void;
  onStopMicTest: () => void;
  onSetShowSignalLogPanel: (v: boolean) => void;
};

export default function AudioSenderDevicePanel({
  signalConnected,
  signalBusy,
  callActive,
  callStatus,
  hasMic,
  signalingIpAddress,
  signalingPort,
  roomHint,
  signalingWsUrlForDisplay,
  mics,
  selectedMicId,
  signalWsStatus,
  lastVowel,
  micTestRunning,
  autoMouthEnabled,
  monitorVolume,
  noiseFloor,
  gain,
  mouthSpeakingThreshold,
  mouthSendFps,
  micLevel,
  canConnectSignalNow,
  canDisconnectSignal,
  canStartSending,
  canStopSending,
  canStartMicTest,
  canStopMicTest,
  hasSignalingTarget,
  showSignalLogPanel,
  signalConnectionLog,
  micTestAudioRef,
  onSetSignalingIpAddress,
  onSetSignalingPort,
  onSetRoomHint,
  onSetSelectedMicId,
  onSetAutoMouthEnabled,
  onSetMonitorVolume,
  onSetNoiseFloor,
  onSetGain,
  onSetMouthSpeakingThreshold,
  onSetMouthSendFps,
  onRefreshDevices,
  onConnectSignal,
  onDisconnectSignal,
  onStartSending,
  onStopSending,
  onStartMicTest,
  onStopMicTest,
  onSetShowSignalLogPanel,
}: Props) {
  const [showMicTestPanel, setShowMicTestPanel] = useState(false);

  return (
    <PanelBox>
        <div className="status-chip-row">
          <span
            className={`status-chip ${signalConnected ? "is-on" : signalBusy ? "is-busy" : "is-off"}`}
          >
            Signal{" "}
            {signalConnected
              ? "CONNECTED"
              : signalBusy
                ? "CONNECTING"
                : "OFFLINE"}
          </span>
          <span
            className={`status-chip ${callActive ? (callStatus.includes("connecting") || callStatus.includes("offer") ? "is-busy" : "is-on") : "is-off"}`}
          >
            Audio {callActive ? "LIVE" : "IDLE"}
          </span>
        </div>

        <p className="action-state-hint" role="status" aria-live="polite">
          {!signalConnected
            ? "次の操作: ① シグナリング接続"
            : !hasMic
              ? "次の操作: ② マイクを選択"
              : !callActive
                ? "次の操作: ③ 送信開始"
                : "現在: 送信中"}
        </p>

        <div className="grid gap-2 md:grid-cols-3">
          <PanelField label="シグナリング IPアドレス">
            <PanelInput
              value={signalingIpAddress}
              onChange={(e) => onSetSignalingIpAddress(e.target.value)}
              placeholder="192.168.1.12"
              disabled={signalConnected || signalBusy}
            />
          </PanelField>

          <PanelField label="シグナリング ポート">
            <PanelInput
              value={signalingPort}
              onChange={(e) => onSetSignalingPort(e.target.value)}
              placeholder="3000"
              disabled={signalConnected || signalBusy}
            />
          </PanelField>

          <PanelField label="ルームID">
            <PanelInput
              value={roomHint}
              onChange={(e) => onSetRoomHint(e.target.value)}
              placeholder="audio1"
              disabled={signalConnected || signalBusy}
            />
          </PanelField>
        </div>
        <PanelInfo>
          確認用 Signal WS URL: {signalingWsUrlForDisplay}
        </PanelInfo>

        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <PanelField label="マイク">
            <PanelSelect
              value={selectedMicId}
              onChange={(e) => onSetSelectedMicId(e.target.value)}
            >
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label}
                </option>
              ))}
            </PanelSelect>
          </PanelField>
          <ActionButton
            className="self-end"
            onClick={onRefreshDevices}
            tone="secondary"
            label="デバイス更新"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ActionControl
            isReady={canConnectSignalNow}
            reason={
              signalConnected
                ? "シグナリングはすでに接続中です"
                : signalBusy
                  ? "シグナリング接続処理中です"
                  : !hasSignalingTarget
                    ? "IPアドレス / ポート / ルームIDを入力してください"
                    : "シグナリングへ接続できます"
            }
            button={{
              onClick: onConnectSignal,
              disabled: !canConnectSignalNow,
              tone: "primary",
              busy: signalBusy,
              label: "シグナリング接続",
              busyLabel: "シグナリング接続中...",
            }}
          />
          <ActionControl
            isReady={canDisconnectSignal}
            reason={
              canDisconnectSignal
                ? "シグナリング接続を停止できます"
                : "シグナリングは未接続です"
            }
            button={{
              onClick: onDisconnectSignal,
              disabled: !canDisconnectSignal,
              tone: "secondary",
              label: "シグナリング切断",
            }}
          />
          <ActionControl
            isReady={canStartSending}
            reason={
              !signalConnected
                ? "先にシグナリング接続が必要です"
                : !hasMic
                  ? "先にマイクを選択してください"
                  : callActive
                    ? "すでに送信中です"
                    : "Receiverへ送信できます"
            }
            button={{
              onClick: onStartSending,
              disabled: !canStartSending,
              tone: "success",
              busy: callStatus === "offer送信中",
              label: "送信開始",
              busyLabel: "送信開始中...",
            }}
          />
          <ActionControl
            isReady={canStopSending}
            reason={
              canStopSending ? "送信を停止できます" : "現在は送信していません"
            }
            button={{
              onClick: onStopSending,
              disabled: !canStopSending,
              tone: "secondary",
              label: "送信停止",
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>シグナリング: {signalWsStatus}</span>
          <span>音声送信: {callStatus}</span>
          <span>最終母音: {lastVowel}</span>
        </div>

        <PanelDivider />
        <div className="toggle-pill-group">
          <button
            type="button"
            className={`toggle-pill ${showMicTestPanel ? "is-active" : ""}`}
            onClick={() => setShowMicTestPanel((v) => !v)}
            aria-expanded={showMicTestPanel}
            aria-pressed={showMicTestPanel}
          >
            マイクテスト
          </button>
          <button
            type="button"
            className={`toggle-pill ${showSignalLogPanel ? "is-active" : ""}`}
            onClick={() => onSetShowSignalLogPanel(!showSignalLogPanel)}
            aria-pressed={showSignalLogPanel}
          >
            ログ
          </button>
        </div>

        {showMicTestPanel && (
          <>
            <div className="status-chip-row">
              <span
                className={`status-chip ${micTestRunning ? "is-on" : "is-off"}`}
              >
                Mic Test {micTestRunning ? "RUNNING" : "STOPPED"}
              </span>
              <span
                className={`status-chip ${autoMouthEnabled ? "is-on" : "is-off"}`}
              >
                Auto Mouth {autoMouthEnabled ? "ON" : "OFF"}
              </span>
            </div>

            <p className="action-state-hint" role="status" aria-live="polite">
              {!hasMic
                ? "次の操作: マイクを選択してください"
                : !micTestRunning
                  ? "次の操作: マイクテストを開始"
                  : "現在: マイクテスト動作中です"}
            </p>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <ActionControl
                isReady={canStartMicTest}
                reason={
                  !hasMic
                    ? "先にマイクを選択してください"
                    : micTestRunning
                      ? "すでに実行中です"
                      : "マイクテストを開始できます"
                }
                button={{
                  onClick: onStartMicTest,
                  disabled: !canStartMicTest,
                  tone: "info",
                  label: "マイクテスト開始",
                }}
              />

              <ActionControl
                isReady={canStopMicTest}
                reason={
                  canStopMicTest
                    ? "マイクテストを停止できます"
                    : "現在は停止中です"
                }
                button={{
                  onClick: onStopMicTest,
                  disabled: !canStopMicTest,
                  tone: "secondary",
                  label: "マイクテスト停止",
                }}
              />

              <div className="action-button-wrap">
                <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={autoMouthEnabled}
                    onChange={(e) => onSetAutoMouthEnabled(e.target.checked)}
                  />
                  口パク送信（faceCommand）
                </label>
                <p
                  className={`button-reason ${autoMouthEnabled ? "is-ready" : "is-disabled"}`}
                >
                  {autoMouthEnabled
                    ? "母音推定をfaceCommandとして送信します"
                    : "ONにすると母音推定を送信します"}
                </p>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs text-slate-700">
                モニター音量（ハウリング注意）
                <input
                  className="mt-1 w-full"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={monitorVolume}
                  onChange={(e) => onSetMonitorVolume(Number(e.target.value))}
                />
                <div className="text-[11px] text-slate-500">
                  {monitorVolume.toFixed(2)}
                </div>
              </label>

              <label className="text-xs text-slate-700">
                ノイズしきい値（レベルメーター用）
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                  type="number"
                  step="0.001"
                  value={noiseFloor}
                  onChange={(e) => onSetNoiseFloor(Number(e.target.value))}
                />
              </label>

              <label className="text-xs text-slate-700">
                ゲイン（レベルメーター用）
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                  type="number"
                  step="1"
                  value={gain}
                  onChange={(e) => onSetGain(Number(e.target.value))}
                />
              </label>

              <label className="text-xs text-slate-700">
                口パクしきい値（小さいほど反応しやすい）
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                  type="number"
                  min={0}
                  max={1}
                  step="0.01"
                  value={mouthSpeakingThreshold}
                  onChange={(e) =>
                    onSetMouthSpeakingThreshold(Number(e.target.value))
                  }
                />
              </label>

              <label className="text-xs text-slate-700">
                口パク送信FPS（送信頻度制限）
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                  type="number"
                  step="1"
                  value={mouthSendFps}
                  onChange={(e) => onSetMouthSendFps(Number(e.target.value))}
                />
              </label>

              <div className="md:col-span-2">
                <div className="text-xs text-slate-700">マイク入力レベル</div>
                <div className="h-3 w-full rounded bg-slate-100 overflow-hidden border">
                  <div
                    className="h-3 bg-emerald-500"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500">
                  レベル: {micLevel.toFixed(3)}
                </div>
              </div>
            </div>

            <audio ref={micTestAudioRef} autoPlay controls className="w-full" />
          </>
        )}

        {showSignalLogPanel && (
          <PanelLog>{signalConnectionLog || "ログはまだありません"}</PanelLog>
        )}
    </PanelBox>
  );
}
