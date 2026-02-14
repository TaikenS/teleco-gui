type Props = {
  telecoIpAddress: string;
  telecoPort: string;
  telecoDebugUrlForDisplay: string;
  commandWsUrlForDisplay: string;
  commandConnected: boolean;
  commandBusy: boolean;
  hasTelecoTarget: boolean;
  canConnectCommandNow: boolean;
  canDisconnectCommand: boolean;
  canRunMouthTest: boolean;
  commandWsStatus: string;
  showMouthPresetPanel: boolean;
  showRawCommandPanel: boolean;
  commandJson: string;
  commandLog: string;
  onSetTelecoIpAddress: (v: string) => void;
  onSetTelecoPort: (v: string) => void;
  onConnectCommand: () => void;
  onDisconnectCommand: () => void;
  onMouthTestA: () => void;
  onArrowLeft: () => void;
  onArrowRight: () => void;
  onSetShowMouthPresetPanel: (v: boolean) => void;
  onSetShowRawCommandPanel: (v: boolean) => void;
  onSendMouthVowel: (v: "a" | "i" | "u" | "e" | "o" | "xn") => void;
  onSetCommandJson: (v: string) => void;
  onSendRawCommandJson: () => void;
  onClearCommandLog: () => void;
};

export default function AudioSenderTelecoPanel({
  telecoIpAddress,
  telecoPort,
  telecoDebugUrlForDisplay,
  commandWsUrlForDisplay,
  commandConnected,
  commandBusy,
  hasTelecoTarget,
  canConnectCommandNow,
  canDisconnectCommand,
  canRunMouthTest,
  commandWsStatus,
  showMouthPresetPanel,
  showRawCommandPanel,
  commandJson,
  commandLog,
  onSetTelecoIpAddress,
  onSetTelecoPort,
  onConnectCommand,
  onDisconnectCommand,
  onMouthTestA,
  onArrowLeft,
  onArrowRight,
  onSetShowMouthPresetPanel,
  onSetShowRawCommandPanel,
  onSendMouthVowel,
  onSetCommandJson,
  onSendRawCommandJson,
  onClearCommandLog,
}: Props) {
  return (
    <>
      <div className="rounded-xl border bg-white p-3 space-y-2">
        <div className="text-sm font-semibold">teleco setting</div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm text-slate-700">
            teleco IP Address
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={telecoIpAddress}
              onChange={(e) => onSetTelecoIpAddress(e.target.value)}
              placeholder="192.168.1.12"
            />
          </label>

          <label className="text-sm text-slate-700">
            teleco Port
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={telecoPort}
              onChange={(e) => onSetTelecoPort(e.target.value)}
              placeholder="11920"
            />
          </label>
        </div>
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-700">
          teleco Debug URL（確認用）: {telecoDebugUrlForDisplay}
        </p>
        <p className="text-[11px] text-slate-500">
          Command WS URL（確認用）: {commandWsUrlForDisplay}
        </p>

        <button
          onClick={() =>
            window.open(telecoDebugUrlForDisplay, "_blank", "noopener,noreferrer")
          }
          className="rounded-xl bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200"
        >
          デバッグ開く（teleco）
        </button>

        <div className="status-chip-row">
          <span
            className={`status-chip ${commandConnected ? "is-on" : commandBusy ? "is-busy" : "is-off"}`}
          >
            Command WS{" "}
            {commandConnected
              ? "CONNECTED"
              : commandBusy
                ? "CONNECTING"
                : "OFFLINE"}
          </span>
        </div>

        <p className="action-state-hint" role="status" aria-live="polite">
          {commandConnected
            ? "現在: 口パクテスト・矢印コマンドを実行できます"
            : "次の操作: ① Command WS接続（/command）"}
        </p>

        <div className="flex flex-wrap gap-3">
          <div className="action-button-wrap">
            <button
              onClick={onConnectCommand}
              disabled={!canConnectCommandNow}
              className="action-button bg-slate-900 text-white text-sm"
              data-busy={commandBusy ? "1" : "0"}
              aria-busy={commandBusy}
            >
              {commandBusy ? "Command 接続中..." : "Command WS接続"}
            </button>
            <p
              className={`button-reason ${canConnectCommandNow ? "is-ready" : "is-disabled"}`}
            >
              {commandConnected
                ? "Command WSはすでに接続中です"
                : commandBusy
                  ? "Command WS接続処理中です"
                  : !hasTelecoTarget
                    ? "teleco の IP Address / Port を入力してください"
                    : "Command WSへ接続できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onDisconnectCommand}
              disabled={!canDisconnectCommand}
              className="action-button bg-slate-100 text-sm"
            >
              Command WS切断
            </button>
            <p
              className={`button-reason ${canDisconnectCommand ? "is-ready" : "is-disabled"}`}
            >
              {canDisconnectCommand
                ? "Command WS接続を停止できます"
                : "Command WSは未接続です"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onMouthTestA}
              disabled={!canRunMouthTest}
              className="action-button bg-blue-600 text-white text-sm"
            >
              口パクテスト（a）
            </button>
            <p
              className={`button-reason ${canRunMouthTest ? "is-ready" : "is-disabled"}`}
            >
              {canRunMouthTest
                ? "即時に口パクテストを送信できます"
                : "Command WS接続後に実行できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onArrowLeft}
              disabled={!commandConnected}
              className="action-button bg-violet-600 text-white text-sm"
            >
              ← 左（+10）
            </button>
            <p
              className={`button-reason ${commandConnected ? "is-ready" : "is-disabled"}`}
            >
              {commandConnected
                ? "首を左へ動かせます"
                : "Command WS未接続のため送信できません"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={onArrowRight}
              disabled={!commandConnected}
              className="action-button bg-violet-600 text-white text-sm"
            >
              → 右（-10）
            </button>
            <p
              className={`button-reason ${commandConnected ? "is-ready" : "is-disabled"}`}
            >
              {commandConnected
                ? "首を右へ動かせます"
                : "Command WS未接続のため送信できません"}
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-600">Command WS: {commandWsStatus}</div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">詳細パネル表示</div>
          <div className="text-[11px] text-slate-500">表示/非表示を切り替え</div>
        </div>

        <p className="action-state-hint" role="status" aria-live="polite">
          下の2パネルはチェックで表示/非表示を切り替えできます。
        </p>

        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
            <input
              type="checkbox"
              checked={showMouthPresetPanel}
              onChange={(e) => onSetShowMouthPresetPanel(e.target.checked)}
            />
            口パク手動プリセット
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
            <input
              type="checkbox"
              checked={showRawCommandPanel}
              onChange={(e) => onSetShowRawCommandPanel(e.target.checked)}
            />
            任意コマンド送信
          </label>
        </div>
      </div>

      {showMouthPresetPanel && (
        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold">口パク手動プリセット（faceCommand）</div>
          <p className="action-state-hint" role="status" aria-live="polite">
            {commandConnected
              ? "Command WS接続済み: 手動プリセットを送信できます"
              : "Command WS未接続: 接続すると手動プリセットを送信できます"}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["a", "i", "u", "e", "o", "xn"] as const).map((v) => (
              <button
                key={v}
                onClick={() => onSendMouthVowel(v)}
                disabled={!commandConnected}
                className={`action-button text-sm hover:opacity-90 ${
                  v === "xn" ? "bg-slate-100" : "bg-slate-900 text-white"
                }`}
              >
                {v === "xn" ? "close(xn)" : v}
              </button>
            ))}
          </div>
        </div>
      )}

      {showRawCommandPanel && (
        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold">任意コマンド送信（/command）</div>

          <p className="action-state-hint" role="status" aria-live="polite">
            {commandConnected
              ? "Command WS接続済み: JSONコマンドを送信できます"
              : "Command WS未接続: 接続するとJSONコマンドを送信できます"}
          </p>

          <div className="text-xs text-slate-600">
            move_multi でハンド等を試す場合はここから送ってください（口は
            faceCommand で口パク）。
          </div>

          <textarea
            className="w-full rounded-xl border px-3 py-2 text-xs font-mono bg-slate-50"
            rows={10}
            value={commandJson}
            onChange={(e) => onSetCommandJson(e.target.value)}
          />

          <div className="flex flex-wrap gap-3">
            <div className="action-button-wrap">
              <button
                onClick={onSendRawCommandJson}
                disabled={!commandConnected}
                className="action-button bg-blue-600 text-white text-sm"
              >
                Send Command
              </button>
              <p
                className={`button-reason ${commandConnected ? "is-ready" : "is-disabled"}`}
              >
                {commandConnected
                  ? "現在のJSONを送信できます"
                  : "Command WS接続後に送信できます"}
              </p>
            </div>

            <div className="action-button-wrap">
              <button
                onClick={onClearCommandLog}
                className="action-button bg-slate-100 text-sm"
              >
                Clear Log
              </button>
              <p className="button-reason is-ready">ログ表示をクリアします</p>
            </div>
          </div>

          <pre className="w-full rounded-xl border bg-slate-50 p-2 text-[11px] overflow-auto max-h-48">
            {commandLog || "(no logs)"}
          </pre>
        </div>
      )}
    </>
  );
}

