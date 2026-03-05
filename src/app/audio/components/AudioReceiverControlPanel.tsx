import { useState, type RefObject } from "react";
import { ActionButton, ActionControl } from "@/components/ui/ActionButton";

type AudioOutputOption = {
  deviceId: string;
  label: string;
};

type Props = {
  connected: boolean;
  wsBusy: boolean;
  hasAudioTrack: boolean;
  signalingIpAddress: string;
  signalingPort: string;
  roomId: string;
  signalingWsUrlForDisplay: string;
  canConnect: boolean;
  canDisconnect: boolean;
  error: string | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  audioOutputOptions: AudioOutputOption[];
  selectedAudioOutputId: string;
  sinkSelectionSupported: boolean;
  log: string[];
  onSignalingIpAddressChange: (value: string) => void;
  onSignalingPortChange: (value: string) => void;
  onRoomIdChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAudioOutputChange: (deviceId: string) => void;
  onRefreshAudioOutputs: () => void;
};

export default function AudioReceiverControlPanel(props: Props) {
  const {
    connected,
    wsBusy,
    hasAudioTrack,
    signalingIpAddress,
    signalingPort,
    roomId,
    signalingWsUrlForDisplay,
    canConnect,
    canDisconnect,
    error,
    audioRef,
    audioOutputOptions,
    selectedAudioOutputId,
    sinkSelectionSupported,
    log,
    onSignalingIpAddressChange,
    onSignalingPortChange,
    onRoomIdChange,
    onConnect,
    onDisconnect,
    onAudioOutputChange,
    onRefreshAudioOutputs,
  } = props;
  const [showLogPanel, setShowLogPanel] = useState(false);

  return (
    <div className="space-y-3 rounded-xl border bg-white p-3">
      <div className="status-chip-row">
        <span
          className={`status-chip ${connected ? "is-on" : wsBusy ? "is-busy" : "is-off"}`}
        >
          Signal {connected ? "CONNECTED" : wsBusy ? "CONNECTING" : "OFFLINE"}
        </span>
        <span
          className={`status-chip ${hasAudioTrack ? "is-on" : connected ? "is-busy" : "is-off"}`}
        >
          Audio {hasAudioTrack ? "PLAYING" : connected ? "WAITING" : "IDLE"}
        </span>
      </div>

      <p className="action-state-hint" role="status" aria-live="polite">
        {!connected
          ? "次の操作: ① シグナリング接続"
          : !hasAudioTrack
            ? "待機中: Senderからの offer/音声受信を待っています"
            : "現在: 音声受信中です"}
      </p>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-sm text-slate-700">
          シグナリング IPアドレス
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
            value={signalingIpAddress}
            onChange={(e) => onSignalingIpAddressChange(e.target.value)}
            disabled={connected || wsBusy}
            placeholder="192.168.0.10"
          />
        </label>

        <label className="text-sm text-slate-700">
          シグナリング ポート
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
            value={signalingPort}
            onChange={(e) => onSignalingPortChange(e.target.value)}
            disabled={connected || wsBusy}
            placeholder="3000"
          />
        </label>

        <label className="text-sm text-slate-700">
          ルームID
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
            value={roomId}
            onChange={(e) => onRoomIdChange(e.target.value)}
            disabled={connected || wsBusy}
          />
        </label>
      </div>
      <div className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-700">
        <div>Signaling WS URL（確認用）: {signalingWsUrlForDisplay}</div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <ActionControl
          isReady={canConnect}
          reason={
            !roomId.trim() ||
            !signalingIpAddress.trim() ||
            !signalingPort.trim()
              ? "ルームID / IPアドレス / ポート を入力してください"
              : connected
                ? "すでに接続中です"
                : wsBusy
                  ? "シグナリング接続処理中です"
                  : "シグナリングへ接続できます"
          }
          button={{
            onClick: onConnect,
            disabled: !canConnect,
            tone: "primary",
            busy: wsBusy,
            label: "シグナリング接続",
            busyLabel: "シグナリング接続中...",
          }}
        />
        <ActionControl
          isReady={canDisconnect}
          reason={
            canDisconnect
              ? "シグナリング接続を停止できます"
              : "シグナリングは未接続です"
          }
          button={{
            onClick: onDisconnect,
            disabled: !canDisconnect,
            tone: "secondary",
            label: "シグナリング切断",
          }}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <label className="text-xs text-slate-700">
          出力デバイス
          <select
            className="mt-1 w-full rounded-xl border px-3 py-1.5 text-xs bg-white"
            value={selectedAudioOutputId}
            onChange={(e) => onAudioOutputChange(e.target.value)}
            disabled={!sinkSelectionSupported || audioOutputOptions.length === 0}
          >
            {audioOutputOptions.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <ActionButton
          className="self-end"
          onClick={onRefreshAudioOutputs}
          tone="secondary"
          label="デバイス更新"
        />
      </div>
      {!sinkSelectionSupported && (
        <p className="text-xs text-amber-700">
          このブラウザでは出力デバイスの切替（setSinkId）が未対応です。
        </p>
      )}
      <audio ref={audioRef} controls autoPlay className="w-full" />

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
      {showLogPanel && (
        <pre className="w-full rounded-xl border bg-slate-50 p-2 text-[11px] overflow-auto max-h-48 text-slate-700">
          {log.length > 0 ? log.join("\n") : "ログはまだありません"}
        </pre>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
