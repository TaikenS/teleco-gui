import type { RefObject } from "react";

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
  signalingBaseUrlForDisplay: string;
  mics: MicOption[];
  selectedMicId: string;
  signalWsStatus: string;
  lastVowel: string;
  micTestRunning: boolean;
  autoMouthEnabled: boolean;
  monitorVolume: number;
  noiseFloor: number;
  gain: number;
  mouthSendFps: number;
  micLevel: number;
  canConnectSignalNow: boolean;
  canDisconnectSignal: boolean;
  canStartSending: boolean;
  canStopSending: boolean;
  canStartMicTest: boolean;
  canStopMicTest: boolean;
  hasSignalingTarget: boolean;
  micTestAudioRef: RefObject<HTMLAudioElement | null>;
  onSetSignalingIpAddress: (v: string) => void;
  onSetSignalingPort: (v: string) => void;
  onSetRoomHint: (v: string) => void;
  onSetSelectedMicId: (v: string) => void;
  onSetAutoMouthEnabled: (v: boolean) => void;
  onSetMonitorVolume: (v: number) => void;
  onSetNoiseFloor: (v: number) => void;
  onSetGain: (v: number) => void;
  onSetMouthSendFps: (v: number) => void;
  onRefreshDevices: () => void;
  onConnectSignal: () => void;
  onDisconnectSignal: () => void;
  onStartSending: () => void;
  onStopSending: () => void;
  onStartMicTest: () => void;
  onStopMicTest: () => void;
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
  signalingBaseUrlForDisplay,
  mics,
  selectedMicId,
  signalWsStatus,
  lastVowel,
  micTestRunning,
  autoMouthEnabled,
  monitorVolume,
  noiseFloor,
  gain,
  mouthSendFps,
  micLevel,
  canConnectSignalNow,
  canDisconnectSignal,
  canStartSending,
  canStopSending,
  canStartMicTest,
  canStopMicTest,
  hasSignalingTarget,
  micTestAudioRef,
  onSetSignalingIpAddress,
  onSetSignalingPort,
  onSetRoomHint,
  onSetSelectedMicId,
  onSetAutoMouthEnabled,
  onSetMonitorVolume,
  onSetNoiseFloor,
  onSetGain,
  onSetMouthSendFps,
  onRefreshDevices,
  onConnectSignal,
  onDisconnectSignal,
  onStartSending,
  onStopSending,
  onStartMicTest,
  onStopMicTest,
}: Props) {
  return (
    <>
      <div className="rounded-xl border bg-white p-3 space-y-3">
        <div className="text-sm font-semibold">
          音声送信・マイク確認（GUI → 別PC AudioReceiver）
        </div>

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
            ? "次の操作: ① Signal WS接続"
            : !hasMic
              ? "次の操作: ② マイクを選択"
              : !callActive
                ? "次の操作: ③ Receiver送信開始"
                : "現在: 送信中"}
        </p>

        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-sm text-slate-700">
            Signaling IP Address
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={signalingIpAddress}
              onChange={(e) => onSetSignalingIpAddress(e.target.value)}
              placeholder="192.168.1.12"
            />
          </label>

          <label className="text-sm text-slate-700">
            Signaling Port
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={signalingPort}
              onChange={(e) => onSetSignalingPort(e.target.value)}
              placeholder="3000"
            />
          </label>

          <label className="text-sm text-slate-700">
            Room ID
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={roomHint}
              onChange={(e) => onSetRoomHint(e.target.value)}
              placeholder="audio1"
            />
          </label>
        </div>
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-700">
          Signaling WS URL（確認用）: {signalingWsUrlForDisplay}
        </p>
        <p className="text-[11px] text-slate-500">
          Base: {signalingBaseUrlForDisplay}
        </p>

        <label className="text-sm text-slate-700">
          Microphone
          <select
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
            value={selectedMicId}
            onChange={(e) => onSetSelectedMicId(e.target.value)}
          >
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-3">
          <div className="action-button-wrap">
            <button
              onClick={onRefreshDevices}
              className="action-button bg-slate-100 text-sm"
            >
              デバイス更新
            </button>
            <p className="button-reason is-ready">
              接続前にマイク一覧を更新できます
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onConnectSignal}
              disabled={!canConnectSignalNow}
              className="action-button bg-slate-900 text-white text-sm"
              data-busy={signalBusy ? "1" : "0"}
              aria-busy={signalBusy}
            >
              {signalBusy ? "Signal 接続中..." : "Signal WS接続"}
            </button>
            <p
              className={`button-reason ${canConnectSignalNow ? "is-ready" : "is-disabled"}`}
            >
              {signalConnected
                ? "Signal WSはすでに接続中です"
                : signalBusy
                  ? "Signal WS接続処理中です"
                  : !hasSignalingTarget
                    ? "IP Address / Port / Room ID を入力してください"
                    : "Signal WSへ接続できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onDisconnectSignal}
              disabled={!canDisconnectSignal}
              className="action-button bg-slate-100 text-sm"
            >
              Signal WS切断
            </button>
            <p
              className={`button-reason ${canDisconnectSignal ? "is-ready" : "is-disabled"}`}
            >
              {canDisconnectSignal
                ? "Signal WS接続を停止できます"
                : "Signal WSは未接続です"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onStartSending}
              disabled={!canStartSending}
              className="action-button bg-emerald-600 text-white text-sm"
              data-busy={callStatus === "offer送信中" ? "1" : "0"}
              aria-busy={callStatus === "offer送信中"}
            >
              {callStatus === "offer送信中"
                ? "送信開始中..."
                : "Receiver送信開始"}
            </button>
            <p
              className={`button-reason ${canStartSending ? "is-ready" : "is-disabled"}`}
            >
              {!signalConnected
                ? "先にSignal WS接続が必要です"
                : !hasMic
                  ? "先にマイクを選択してください"
                  : callActive
                    ? "すでに送信中です"
                    : "Receiverへ送信を開始できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onStopSending}
              className="action-button bg-slate-100 text-sm"
              disabled={!canStopSending}
            >
              送信停止
            </button>
            <p
              className={`button-reason ${canStopSending ? "is-ready" : "is-disabled"}`}
            >
              {canStopSending
                ? "送信を停止できます"
                : "現在は送信していません"}
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-600 space-y-1">
          <div>Signal WS: {signalWsStatus}</div>
          <div>Audio Send: {callStatus}</div>
          <div>Last Vowel: {lastVowel}</div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3 space-y-3">
        <div className="text-sm font-semibold">
          マイクテスト（ローカル再生 + 母音推定 → faceCommand）
        </div>

        <div className="status-chip-row">
          <span className={`status-chip ${micTestRunning ? "is-on" : "is-off"}`}>
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
              ? "次の操作: Mic Test Start"
              : "現在: マイクテスト動作中です"}
        </p>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="action-button-wrap">
            <button
              onClick={onStartMicTest}
              disabled={!canStartMicTest}
              className="action-button bg-blue-600 text-white text-sm"
            >
              Mic Test Start
            </button>
            <p
              className={`button-reason ${canStartMicTest ? "is-ready" : "is-disabled"}`}
            >
              {!hasMic
                ? "先にマイクを選択してください"
                : micTestRunning
                  ? "すでに実行中です"
                  : "マイクテストを開始できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onStopMicTest}
              disabled={!canStopMicTest}
              className="action-button bg-slate-100 text-sm"
            >
              Mic Test Stop
            </button>
            <p
              className={`button-reason ${canStopMicTest ? "is-ready" : "is-disabled"}`}
            >
              {canStopMicTest
                ? "マイクテストを停止できます"
                : "現在は停止中です"}
            </p>
          </div>

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
            Monitor Volume（ハウリング注意）
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
            Noise Floor（レベルメータ用）
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              type="number"
              step="0.001"
              value={noiseFloor}
              onChange={(e) => onSetNoiseFloor(Number(e.target.value))}
            />
          </label>

          <label className="text-xs text-slate-700">
            Gain（レベルメータ用）
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              type="number"
              step="1"
              value={gain}
              onChange={(e) => onSetGain(Number(e.target.value))}
            />
          </label>

          <label className="text-xs text-slate-700">
            Mouth Send FPS（送信頻度制限）
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              type="number"
              step="1"
              value={mouthSendFps}
              onChange={(e) => onSetMouthSendFps(Number(e.target.value))}
            />
          </label>

          <div className="md:col-span-2">
            <div className="text-xs text-slate-700">Mic Level</div>
            <div className="h-3 w-full rounded bg-slate-100 overflow-hidden border">
              <div
                className="h-3 bg-emerald-500"
                style={{ width: `${Math.round(micLevel * 100)}%` }}
              />
            </div>
            <div className="text-[11px] text-slate-500">
              level={micLevel.toFixed(3)}
            </div>
          </div>
        </div>

        <audio ref={micTestAudioRef} autoPlay controls className="w-full" />
      </div>
    </>
  );
}

