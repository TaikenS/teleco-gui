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
    <PanelBox>
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
        <PanelField label="シグナリング IPアドレス">
          <PanelInput
            value={signalingIpAddress}
            onChange={(e) => onSignalingIpAddressChange(e.target.value)}
            disabled={connected || wsBusy}
            placeholder="192.168.0.10"
          />
        </PanelField>

        <PanelField label="シグナリング ポート">
          <PanelInput
            value={signalingPort}
            onChange={(e) => onSignalingPortChange(e.target.value)}
            disabled={connected || wsBusy}
            placeholder="3000"
          />
        </PanelField>

        <PanelField label="ルームID">
          <PanelInput
            value={roomId}
            onChange={(e) => onRoomIdChange(e.target.value)}
            disabled={connected || wsBusy}
          />
        </PanelField>
      </div>
      <PanelInfo>Signaling WS URL（確認用）: {signalingWsUrlForDisplay}</PanelInfo>

      <div className="grid gap-3 md:grid-cols-2">
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
        <PanelField label="出力デバイス" labelClassName="text-xs">
          <PanelSelect
            className="py-1.5 text-xs"
            value={selectedAudioOutputId}
            onChange={(e) => onAudioOutputChange(e.target.value)}
            disabled={!sinkSelectionSupported || audioOutputOptions.length === 0}
          >
            {audioOutputOptions.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </PanelSelect>
        </PanelField>
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

      <PanelDivider />
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
        <PanelLog>{log.length > 0 ? log.join("\n") : "ログはまだありません"}</PanelLog>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </PanelBox>
  );
}
