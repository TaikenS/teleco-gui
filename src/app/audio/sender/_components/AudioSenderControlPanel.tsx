type Props = {
  micReady: boolean;
  micBusy: boolean;
  connected: boolean;
  wsBusy: boolean;
  sendBusy: boolean;
  rtcState: RTCPeerConnectionState;
  roomId: string;
  signalingIpAddress: string;
  signalingPort: string;
  signalingWsUrlForDisplay: string;
  signalingBaseUrlForDisplay: string;
  sendEnabled: boolean;
  canStartMic: boolean;
  canConnectSignal: boolean;
  canStartSend: boolean;
  canStopConnection: boolean;
  error: string | null;
  onRoomIdChange: (value: string) => void;
  onSignalingIpAddressChange: (value: string) => void;
  onSignalingPortChange: (value: string) => void;
  onStartMic: () => void;
  onConnectSignal: () => void;
  onSendEnabledChange: (value: boolean) => void;
  onStartSend: () => void;
  onStopConnection: () => void;
};

export default function AudioSenderControlPanel(props: Props) {
  const {
    micReady,
    micBusy,
    connected,
    wsBusy,
    sendBusy,
    rtcState,
    roomId,
    signalingIpAddress,
    signalingPort,
    signalingWsUrlForDisplay,
    signalingBaseUrlForDisplay,
    sendEnabled,
    canStartMic,
    canConnectSignal,
    canStartSend,
    canStopConnection,
    error,
    onRoomIdChange,
    onSignalingIpAddressChange,
    onSignalingPortChange,
    onStartMic,
    onConnectSignal,
    onSendEnabledChange,
    onStartSend,
    onStopConnection,
  } = props;

  const sendLive = rtcState === "connected" || rtcState === "connecting";

  return (
    <div className="space-y-2 rounded-2xl border bg-white p-4">
      <div className="status-chip-row">
        <span
          className={`status-chip ${micReady ? "is-on" : micBusy ? "is-busy" : "is-off"}`}
        >
          Mic {micReady ? "READY" : micBusy ? "STARTING" : "OFF"}
        </span>
        <span
          className={`status-chip ${connected ? "is-on" : wsBusy ? "is-busy" : "is-off"}`}
        >
          Signal {connected ? "CONNECTED" : wsBusy ? "CONNECTING" : "OFFLINE"}
        </span>
        <span
          className={`status-chip ${
            rtcState === "connected"
              ? "is-on"
              : sendBusy || rtcState === "connecting"
                ? "is-busy"
                : "is-off"
          }`}
        >
          Send{" "}
          {rtcState === "connected"
            ? "LIVE"
            : sendBusy || rtcState === "connecting"
              ? "STARTING"
              : "IDLE"}
        </span>
      </div>

      <p className="action-state-hint" role="status" aria-live="polite">
        {!micReady
          ? "次の操作: ① マイク起動"
          : !connected
            ? "次の操作: ② シグナリング接続"
            : !sendEnabled
              ? "次の操作: ③ 「送信を有効化」をON"
              : !sendLive
                ? "次の操作: ④ Receiverへ送信開始"
                : "現在: Receiverへ音声送信中です"}
      </p>

      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-700">Room ID</label>
        <input
          className="rounded-xl border px-3 py-1 text-sm"
          value={roomId}
          onChange={(e) => onRoomIdChange(e.target.value)}
          disabled={connected || wsBusy}
        />
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm text-slate-700">
          Signaling IP Address
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            value={signalingIpAddress}
            onChange={(e) => onSignalingIpAddressChange(e.target.value)}
            disabled={connected || wsBusy}
            placeholder="192.168.1.12"
          />
        </label>
        <label className="text-sm text-slate-700">
          Signaling Port
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            value={signalingPort}
            onChange={(e) => onSignalingPortChange(e.target.value)}
            disabled={connected || wsBusy}
            placeholder="3000"
          />
        </label>
      </div>
      <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
        <div>Signaling WS URL（確認用）: {signalingWsUrlForDisplay}</div>
        <div className="mt-1 text-slate-500">
          Base: {signalingBaseUrlForDisplay}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="action-button-wrap">
          <button
            onClick={onStartMic}
            className="action-button bg-slate-900 text-white"
            disabled={!canStartMic}
            data-disabled-label="利用不可"
            data-busy={micBusy ? "1" : "0"}
            aria-busy={micBusy}
          >
            {micBusy ? "マイク起動中..." : "マイク起動"}
          </button>
          <p
            className={`button-reason ${canStartMic ? "is-ready" : "is-disabled"}`}
          >
            {micBusy
              ? "マイク起動処理中です"
              : micReady
                ? "マイク準備OKです"
                : "マイクを起動できます"}
          </p>
        </div>

        <div className="action-button-wrap">
          <button
            onClick={onConnectSignal}
            disabled={!canConnectSignal}
            className="action-button bg-slate-100"
            data-disabled-label="利用不可"
            data-busy={wsBusy ? "1" : "0"}
            aria-busy={wsBusy}
          >
            {wsBusy ? "接続中..." : "シグナリング接続"}
          </button>
          <p
            className={`button-reason ${canConnectSignal ? "is-ready" : "is-disabled"}`}
          >
            {!roomId.trim() ||
            !signalingIpAddress.trim() ||
            !signalingPort.trim()
              ? "Room ID と IP Address / Port を入力してください"
              : connected
                ? "すでに接続中です"
                : wsBusy
                  ? "接続処理中です"
                  : "シグナリング接続できます"}
          </p>
        </div>

        <div className="action-button-wrap">
          <label className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
            <input
              type="checkbox"
              checked={sendEnabled}
              onChange={(e) => onSendEnabledChange(e.target.checked)}
            />
            送信を有効化
          </label>
          <p
            className={`button-reason ${sendEnabled ? "is-ready" : "is-disabled"}`}
          >
            {sendEnabled
              ? "送信開始ボタンを押せます"
              : "ONにすると送信開始できます"}
          </p>
        </div>

        <div className="action-button-wrap">
          <button
            onClick={onStartSend}
            disabled={!canStartSend}
            className="action-button bg-emerald-600 text-white"
            data-disabled-label="利用不可"
            data-busy={sendBusy ? "1" : "0"}
            aria-busy={sendBusy}
          >
            {sendBusy ? "開始中..." : "Receiverへ送信開始"}
          </button>
          <p
            className={`button-reason ${canStartSend ? "is-ready" : "is-disabled"}`}
          >
            {!micReady
              ? "先にマイク起動が必要です"
              : !connected
                ? "先にシグナリング接続が必要です"
                : !sendEnabled
                  ? "先に「送信を有効化」をONにしてください"
                  : sendBusy
                    ? "送信開始処理中です"
                    : sendLive
                      ? "すでに送信中です"
                      : "Receiverへ送信できます"}
          </p>
        </div>

        <div className="action-button-wrap">
          <button
            onClick={onStopConnection}
            className="action-button bg-slate-100"
            disabled={!canStopConnection}
            data-disabled-label="利用不可"
          >
            接続停止
          </button>
          <p
            className={`button-reason ${canStopConnection ? "is-ready" : "is-disabled"}`}
          >
            {canStopConnection ? "接続を停止できます" : "停止対象がありません"}
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
