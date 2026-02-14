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
  signalingBaseUrlForDisplay: string;
  selectedCameraId: string;
  videoInputs: VideoInput[];
  canStartCamera: boolean;
  cameraBusy: boolean;
  startCameraReason: string;
  canConnectSignaling: boolean;
  connectReason: string;
  canStartStreaming: boolean;
  startStreamingReason: string;
  canStopConnection: boolean;
  stopReason: string;
  wsError: string | null;
  onRoomIdChange: (value: string) => void;
  onSignalingIpAddressChange: (value: string) => void;
  onSignalingPortChange: (value: string) => void;
  onCameraChange: (deviceId: string) => void;
  onRefreshCameras: () => void;
  onStartCamera: () => void;
  onConnectSignaling: () => void;
  onStartStreaming: () => void;
  onStopConnection: () => void;
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
    signalingBaseUrlForDisplay,
    selectedCameraId,
    videoInputs,
    canStartCamera,
    cameraBusy,
    startCameraReason,
    canConnectSignaling,
    connectReason,
    canStartStreaming,
    startStreamingReason,
    canStopConnection,
    stopReason,
    wsError,
    onRoomIdChange,
    onSignalingIpAddressChange,
    onSignalingPortChange,
    onCameraChange,
    onRefreshCameras,
    onStartCamera,
    onConnectSignaling,
    onStartStreaming,
    onStopConnection,
  } = props;

  return (
    <div className="space-y-2 rounded-2xl border bg-white p-4">
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
          Stream {rtcState === "connected" ? "LIVE" : rtcBusy || rtcState === "connecting" ? "STARTING" : "IDLE"}
        </span>
      </div>

      <p className="action-state-hint" role="status" aria-live="polite">
        {nextActionHint}
      </p>

      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-700">Room ID</label>
        <input
          className="rounded-xl border px-3 py-1 text-sm"
          value={roomId}
          onChange={(e) => onRoomIdChange(e.target.value)}
        />
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm text-slate-700">
          Signaling IP Address
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            value={signalingIpAddress}
            onChange={(e) => onSignalingIpAddressChange(e.target.value)}
            placeholder="192.168.1.12"
            disabled={connected}
          />
        </label>
        <label className="text-sm text-slate-700">
          Signaling Port
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            value={signalingPort}
            onChange={(e) => onSignalingPortChange(e.target.value)}
            placeholder="3000"
            disabled={connected}
          />
        </label>
      </div>
      <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
        <div>Signaling WS URL（確認用）: {signalingWsUrlForDisplay}</div>
        <div className="mt-1 text-slate-500">Base: {signalingBaseUrlForDisplay}</div>
      </div>

      <div className="space-y-1">
        <label className="text-sm text-slate-700">カメラ</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="min-w-[240px] rounded-xl border px-3 py-2 text-sm"
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
          </select>

          <button onClick={onRefreshCameras} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
            カメラ再読み込み
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          {videoInputs.length > 0
            ? "カメラを変更したあと「カメラ起動」を押すか、配信中なら自動でそのカメラに切り替わります。"
            : "カメラデバイスが未検出です。接続後に再読み込みしてください。"}
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="action-button-wrap">
          <button
            onClick={onStartCamera}
            className="action-button bg-slate-900 text-white"
            disabled={!canStartCamera}
            data-busy={cameraBusy ? "1" : "0"}
            aria-busy={cameraBusy}
          >
            {cameraBusy ? "カメラ起動中..." : "カメラ起動"}
          </button>
          <p className={`button-reason ${canStartCamera ? "is-ready" : "is-disabled"}`}>
            {startCameraReason}
          </p>
        </div>

        <div className="action-button-wrap">
          <button
            onClick={onConnectSignaling}
            className="action-button bg-slate-100"
            disabled={!canConnectSignaling}
            data-busy={wsBusy ? "1" : "0"}
            aria-busy={wsBusy}
          >
            {wsBusy ? "接続中..." : "シグナリング接続"}
          </button>
          <p className={`button-reason ${canConnectSignaling ? "is-ready" : "is-disabled"}`}>
            {connectReason}
          </p>
        </div>

        <div className="action-button-wrap">
          <button
            onClick={onStartStreaming}
            className="action-button bg-emerald-600 text-white"
            disabled={!canStartStreaming}
            data-busy={rtcBusy ? "1" : "0"}
            aria-busy={rtcBusy}
          >
            {rtcBusy ? "開始中..." : "viewer へ映像送信開始"}
          </button>
          <p className={`button-reason ${canStartStreaming ? "is-ready" : "is-disabled"}`}>
            {startStreamingReason}
          </p>
        </div>

        <div className="action-button-wrap">
          <button
            onClick={onStopConnection}
            className="action-button bg-slate-100"
            disabled={!canStopConnection}
          >
            接続停止
          </button>
          <p className={`button-reason ${canStopConnection ? "is-ready" : "is-disabled"}`}>
            {stopReason}
          </p>
        </div>
      </div>

      {wsError && <p className="text-xs text-red-600">{wsError}</p>}
    </div>
  );
}
