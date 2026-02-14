type Props = {
  connected: boolean;
  wsBusy: boolean;
  hasAudioTrack: boolean;
  signalingIpAddress: string;
  signalingPort: string;
  roomId: string;
  signalingWsUrlForDisplay: string;
  signalingBaseUrlForDisplay: string;
  canConnect: boolean;
  canDisconnect: boolean;
  error: string | null;
  onSignalingIpAddressChange: (value: string) => void;
  onSignalingPortChange: (value: string) => void;
  onRoomIdChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenWsDebug: () => void;
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
    signalingBaseUrlForDisplay,
    canConnect,
    canDisconnect,
    error,
    onSignalingIpAddressChange,
    onSignalingPortChange,
    onRoomIdChange,
    onConnect,
    onDisconnect,
    onOpenWsDebug,
  } = props;

  return (
    <div className="space-y-3 rounded-2xl border bg-white p-4">
      <div className="status-chip-row">
        <span className={`status-chip ${connected ? "is-on" : wsBusy ? "is-busy" : "is-off"}`}>
          Signal {connected ? "CONNECTED" : wsBusy ? "CONNECTING" : "OFFLINE"}
        </span>
        <span className={`status-chip ${hasAudioTrack ? "is-on" : connected ? "is-busy" : "is-off"}`}>
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

      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm text-slate-700">
          Signaling IP Address
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
            value={signalingIpAddress}
            onChange={(e) => onSignalingIpAddressChange(e.target.value)}
            disabled={connected || wsBusy}
            placeholder="192.168.0.10"
          />
        </label>

        <label className="text-sm text-slate-700">
          Signaling Port
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
            value={signalingPort}
            onChange={(e) => onSignalingPortChange(e.target.value)}
            disabled={connected || wsBusy}
            placeholder="3000"
          />
        </label>

        <label className="text-sm text-slate-700">
          Room ID（?room= に入る）
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            value={roomId}
            onChange={(e) => onRoomIdChange(e.target.value)}
            disabled={connected || wsBusy}
          />
        </label>
      </div>
      <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
        <div>Signaling WS URL（確認用）: {signalingWsUrlForDisplay}</div>
        <div className="mt-1 text-slate-500">Base: {signalingBaseUrlForDisplay}</div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="action-button-wrap">
          <button
            onClick={onConnect}
            disabled={!canConnect}
            className="action-button bg-slate-100"
            data-busy={wsBusy ? "1" : "0"}
            aria-busy={wsBusy}
          >
            {wsBusy ? "接続中..." : "接続"}
          </button>
          <p className={`button-reason ${canConnect ? "is-ready" : "is-disabled"}`}>
            {!roomId.trim() || !signalingIpAddress.trim() || !signalingPort.trim()
              ? "Room ID / IP Address / Port を入力してください"
              : connected
                ? "すでに接続中です"
                : wsBusy
                  ? "接続処理中です"
                  : "シグナリングへ接続できます"}
          </p>
        </div>

        <div className="action-button-wrap">
          <button
            onClick={onDisconnect}
            disabled={!canDisconnect}
            className="action-button bg-slate-900 text-white"
          >
            切断
          </button>
          <p className={`button-reason ${canDisconnect ? "is-ready" : "is-disabled"}`}>
            {canDisconnect ? "接続を停止できます" : "現在は未接続です"}
          </p>
        </div>

        <div className="action-button-wrap">
          <button onClick={onOpenWsDebug} className="action-button bg-slate-100" type="button">
            /ws を開く（デバッグ）
          </button>
          <p className="button-reason is-ready">接続確認用に別タブで開けます</p>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
