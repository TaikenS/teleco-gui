import { ActionButton, ActionControl } from "@/components/ui/ActionButton";
import {
  PanelBox,
  PanelField,
  PanelInfo,
  PanelInput,
  PanelSelect,
} from "@/components/ui/PanelCommon";

type VideoInput = {
  deviceId: string;
  label: string;
};

type Props = {
  hasCameraStream: boolean;
  wsConnected: boolean;
  wsBusy: boolean;
  rtcBusy: boolean;
  rtcState: RTCPeerConnectionState;
  nextActionHint: string;
  roomId: string;
  signalingIpAddress: string;
  signalingPort: string;
  connected: boolean;
  signalingWsUrlForDisplay: string;
  selectedCameraId: string;
  videoInputs: VideoInput[];
  canStartCamera: boolean;
  canStopCamera: boolean;
  cameraBusy: boolean;
  startCameraReason: string;
  stopCameraReason: string;
  canConnectSignaling: boolean;
  connectReason: string;
  canDisconnectSignaling: boolean;
  disconnectReason: string;
  canStartStreaming: boolean;
  canStopStreaming: boolean;
  startStreamingReason: string;
  stopStreamingReason: string;
  wsError: string | null;
  onRoomIdChange: (value: string) => void;
  onSignalingIpAddressChange: (value: string) => void;
  onSignalingPortChange: (value: string) => void;
  onCameraChange: (deviceId: string) => void;
  onRefreshCameras: () => void;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onConnectSignaling: () => void;
  onDisconnectSignaling: () => void;
  onStartStreaming: () => void;
  onStopStreaming: () => void;
};

export default function VideoSenderControlPanel(props: Props) {
  const {
    hasCameraStream,
    wsConnected,
    wsBusy,
    rtcBusy,
    rtcState,
    nextActionHint,
    roomId,
    signalingIpAddress,
    signalingPort,
    connected,
    signalingWsUrlForDisplay,
    selectedCameraId,
    videoInputs,
    canStartCamera,
    canStopCamera,
    cameraBusy,
    startCameraReason,
    stopCameraReason,
    canConnectSignaling,
    connectReason,
    canDisconnectSignaling,
    disconnectReason,
    canStartStreaming,
    canStopStreaming,
    startStreamingReason,
    stopStreamingReason,
    wsError,
    onRoomIdChange,
    onSignalingIpAddressChange,
    onSignalingPortChange,
    onCameraChange,
    onRefreshCameras,
    onStartCamera,
    onStopCamera,
    onConnectSignaling,
    onDisconnectSignaling,
    onStartStreaming,
    onStopStreaming,
  } = props;

  return (
    <PanelBox className="space-y-2">
      <div className="status-chip-row">
        <span className={`status-chip ${hasCameraStream ? "is-on" : "is-off"}`}>
          Camera {hasCameraStream ? "ON" : "OFF"}
        </span>
        <span
          className={`status-chip ${wsConnected ? "is-on" : wsBusy ? "is-busy" : "is-off"}`}
        >
          Signal {wsConnected ? "CONNECTED" : wsBusy ? "CONNECTING" : "OFFLINE"}
        </span>
        <span
          className={`status-chip ${
            rtcState === "connected"
              ? "is-on"
              : rtcBusy || rtcState === "connecting"
                ? "is-busy"
                : "is-off"
          }`}
        >
          Stream{" "}
          {rtcState === "connected"
            ? "LIVE"
            : rtcBusy || rtcState === "connecting"
              ? "STARTING"
              : "IDLE"}
        </span>
      </div>

      <p className="action-state-hint" role="status" aria-live="polite">
        {nextActionHint}
      </p>

      <div className="grid gap-2 md:grid-cols-3">
        <PanelField label="シグナリング IPアドレス">
          <PanelInput
            value={signalingIpAddress}
            onChange={(e) => onSignalingIpAddressChange(e.target.value)}
            placeholder="192.168.1.12"
            disabled={connected}
          />
        </PanelField>
        <PanelField label="シグナリング ポート">
          <PanelInput
            value={signalingPort}
            onChange={(e) => onSignalingPortChange(e.target.value)}
            placeholder="3000"
            disabled={connected}
          />
        </PanelField>
        <PanelField label="ルームID">
          <PanelInput value={roomId} onChange={(e) => onRoomIdChange(e.target.value)} />
        </PanelField>
      </div>
      <PanelInfo>確認用 Signal WS URL: {signalingWsUrlForDisplay}</PanelInfo>

      <div className="space-y-1">
        <label className="text-sm text-slate-700">カメラ</label>
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <PanelSelect
            className="mt-0"
            value={selectedCameraId}
            onChange={(e) => onCameraChange(e.target.value)}
            disabled={videoInputs.length === 0}
          >
            {videoInputs.length === 0 ? (
              <option value="">カメラが見つかりません</option>
            ) : (
              videoInputs.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label?.trim() || `カメラ ${i + 1}`}
                </option>
              ))
            )}
          </PanelSelect>
          <ActionButton
            className="self-end"
            onClick={onRefreshCameras}
            tone="secondary"
            label="デバイス更新"
          />
        </div>
        <p className="text-[11px] text-slate-500">
          {videoInputs.length > 0
            ? "カメラを変更したあと「カメラ起動」を押してください。"
            : "カメラデバイスが未検出です。接続後にデバイス更新してください。"}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ActionControl
          isReady={canStartCamera}
          reason={startCameraReason}
          button={{
            onClick: onStartCamera,
            disabled: !canStartCamera,
            tone: "primary",
            busy: cameraBusy,
            label: "カメラ起動",
            busyLabel: "カメラ起動中...",
          }}
        />
        <ActionControl
          isReady={canStopCamera}
          reason={stopCameraReason}
          button={{
            onClick: onStopCamera,
            disabled: !canStopCamera,
            tone: "secondary",
            label: "カメラ停止",
          }}
        />
        <ActionControl
          isReady={canConnectSignaling}
          reason={connectReason}
          button={{
            onClick: onConnectSignaling,
            disabled: !canConnectSignaling,
            tone: "primary",
            busy: wsBusy,
            label: "シグナリング接続",
            busyLabel: "接続中...",
          }}
        />
        <ActionControl
          isReady={canDisconnectSignaling}
          reason={disconnectReason}
          button={{
            onClick: onDisconnectSignaling,
            disabled: !canDisconnectSignaling,
            tone: "secondary",
            label: "シグナリング切断",
          }}
        />
        <ActionControl
          isReady={canStartStreaming}
          reason={startStreamingReason}
          button={{
            onClick: onStartStreaming,
            disabled: !canStartStreaming,
            tone: "success",
            busy: rtcBusy,
            label: "送信開始",
            busyLabel: "開始中...",
          }}
        />
        <ActionControl
          isReady={canStopStreaming}
          reason={stopStreamingReason}
          button={{
            onClick: onStopStreaming,
            disabled: !canStopStreaming,
            tone: "secondary",
            label: "送信停止",
          }}
        />
      </div>

      {wsError && <p className="text-xs text-red-600">{wsError}</p>}
    </PanelBox>
  );
}
