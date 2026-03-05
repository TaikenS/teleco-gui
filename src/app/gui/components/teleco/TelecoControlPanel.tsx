import { ActionButton, ActionControl } from "@/components/ui/ActionButton";
import {
  PanelBox,
  PanelDivider,
  PanelField,
  PanelInfo,
  PanelInput,
  PanelLog,
} from "@/components/ui/PanelCommon";

type Props = {
  telecoIpAddress: string;
  telecoPort: string;
  telecoDebugUrlForDisplay: string;
  commandWsUrlForDisplay: string;
  gamepadConnected: boolean;
  gamepadIndex: number | null;
  gamepadId: string;
  gamepadMapping: string;
  gamepadPressedButtons: number[];
  gamepadLtValue: number;
  gamepadRtValue: number;
  commandConnected: boolean;
  commandBusy: boolean;
  hasTelecoTarget: boolean;
  canConnectCommandNow: boolean;
  canDisconnectCommand: boolean;
  canRunMouthTest: boolean;
  commandWsStatus: string;
  showMouthPresetPanel: boolean;
  showRawCommandPanel: boolean;
  showGamepadPanel: boolean;
  showCommandLogPanel: boolean;
  enableFaceCommandSend: boolean;
  enableMoveMultiSend: boolean;
  commandJson: string;
  commandLog: string;
  commandConnectionLog: string;
  onSetTelecoIpAddress: (v: string) => void;
  onSetTelecoPort: (v: string) => void;
  onConnectCommand: () => void;
  onDisconnectCommand: () => void;
  onMouthTestA: () => void;
  onArrowLeft: () => void;
  onArrowRight: () => void;
  onInitializePose: () => void;
  onSetShowMouthPresetPanel: (v: boolean) => void;
  onSetShowRawCommandPanel: (v: boolean) => void;
  onSetShowGamepadPanel: (v: boolean) => void;
  onSetShowCommandLogPanel: (v: boolean) => void;
  onSetEnableFaceCommandSend: (v: boolean) => void;
  onSetEnableMoveMultiSend: (v: boolean) => void;
  onSendMouthVowel: (v: "a" | "i" | "u" | "e" | "o" | "xn") => void;
  onSetCommandJson: (v: string) => void;
  onSendRawCommandJson: () => void;
  onClearCommandLog: () => void;
};

export default function TelecoControlPanel({
  telecoIpAddress,
  telecoPort,
  telecoDebugUrlForDisplay,
  commandWsUrlForDisplay,
  gamepadConnected,
  gamepadIndex,
  gamepadId,
  gamepadMapping,
  gamepadPressedButtons,
  gamepadLtValue,
  gamepadRtValue,
  commandConnected,
  commandBusy,
  hasTelecoTarget,
  canConnectCommandNow,
  canDisconnectCommand,
  canRunMouthTest,
  commandWsStatus,
  showMouthPresetPanel,
  showRawCommandPanel,
  showGamepadPanel,
  showCommandLogPanel,
  enableFaceCommandSend,
  enableMoveMultiSend,
  commandJson,
  commandLog,
  commandConnectionLog,
  onSetTelecoIpAddress,
  onSetTelecoPort,
  onConnectCommand,
  onDisconnectCommand,
  onMouthTestA,
  onArrowLeft,
  onArrowRight,
  onInitializePose,
  onSetShowMouthPresetPanel,
  onSetShowRawCommandPanel,
  onSetShowGamepadPanel,
  onSetShowCommandLogPanel,
  onSetEnableFaceCommandSend,
  onSetEnableMoveMultiSend,
  onSendMouthVowel,
  onSetCommandJson,
  onSendRawCommandJson,
  onClearCommandLog,
}: Props) {
  return (
    <>
      <PanelBox className="space-y-2">
        <div className="status-chip-row">
          <span
            className={`status-chip ${commandConnected ? "is-on" : commandBusy ? "is-busy" : "is-off"}`}
          >
            テレコ{" "}
            {commandConnected
              ? "CONNECTED"
              : commandBusy
                ? "CONNECTING"
                : "OFFLINE"}
          </span>
          <span className={`status-chip ${gamepadConnected ? "is-on" : "is-off"}`}>
            Gamepad {gamepadConnected ? "CONNECTED" : "OFFLINE"}
          </span>
        </div>

        <p className="action-state-hint" role="status" aria-live="polite">
          {commandConnected
            ? "現在: 口パクテスト・矢印コマンドを実行できます"
            : "次の操作: ① テレコ接続（/command）"}
        </p>

        <div className="grid gap-2 md:grid-cols-2">
          <PanelField label="テレコ IPアドレス">
            <PanelInput
              value={telecoIpAddress}
              onChange={(e) => onSetTelecoIpAddress(e.target.value)}
              placeholder="192.168.1.12"
              disabled={commandConnected || commandBusy}
            />
          </PanelField>

          <PanelField label="テレコ ポート">
            <PanelInput
              value={telecoPort}
              onChange={(e) => onSetTelecoPort(e.target.value)}
              placeholder="11920"
              disabled={commandConnected || commandBusy}
            />
          </PanelField>
        </div>
        <PanelInfo>
          確認用デバッグURL: {commandWsUrlForDisplay}
        </PanelInfo>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ActionControl
            isReady={canConnectCommandNow}
            reason={
              commandConnected
                ? "テレコはすでに接続中です"
                : commandBusy
                  ? "テレコ接続処理中です"
                  : !hasTelecoTarget
                    ? "テレコの IPアドレス / ポートを入力してください"
                    : "テレコへ接続できます"
            }
            button={{
              onClick: onConnectCommand,
              disabled: !canConnectCommandNow,
              tone: "primary",
              busy: commandBusy,
              label: "テレコ 接続",
              busyLabel: "テレコ 接続中...",
            }}
          />

          <ActionControl
            isReady={canDisconnectCommand}
            reason={
              canDisconnectCommand
                ? "テレコ接続を停止できます"
                : "テレコは未接続です"
            }
            button={{
              onClick: onDisconnectCommand,
              disabled: !canDisconnectCommand,
              tone: "secondary",
              label: "テレコ 切断",
            }}
          />

          <ActionControl
            isReady={canRunMouthTest}
            reason={
              canRunMouthTest
                ? "即時に口パクテストを送信できます"
                : "テレコ接続後に実行できます"
            }
            button={{
              onClick: onMouthTestA,
              disabled: !canRunMouthTest,
              tone: "info",
              label: "口パクテスト（a）",
            }}
          />

          <ActionControl
            isReady={commandConnected}
            reason={
              commandConnected
                ? "首を左へ動かせます"
                : "テレコ未接続のため送信できません"
            }
            button={{
              onClick: onArrowLeft,
              disabled: !commandConnected,
              tone: "violet",
              label: "← 左（+10）",
            }}
          />

          <ActionControl
            isReady={commandConnected}
            reason={
              commandConnected
                ? "首を右へ動かせます"
                : "テレコ未接続のため送信できません"
            }
            button={{
              onClick: onArrowRight,
              disabled: !commandConnected,
              tone: "violet",
              label: "→ 右（-10）",
            }}
          />

          <ActionControl
            isReady={commandConnected}
            reason={
              commandConnected
                ? "初期姿勢コマンドを送信します"
                : "テレコ未接続のため送信できません"
            }
            button={{
              onClick: onInitializePose,
              disabled: !commandConnected,
              tone: "amber",
              label: "初期化",
            }}
          />
        </div>

        <div className="text-xs text-slate-600">テレコ: {commandWsStatus}</div>

        <PanelDivider />
        <div className="toggle-pill-group">
          <button
            type="button"
            className={`toggle-pill ${showMouthPresetPanel ? "is-active" : ""}`}
            aria-pressed={showMouthPresetPanel}
            onClick={() => onSetShowMouthPresetPanel(!showMouthPresetPanel)}
          >
            口パク手動プリセット
          </button>

          <button
            type="button"
            className={`toggle-pill ${showRawCommandPanel ? "is-active" : ""}`}
            aria-pressed={showRawCommandPanel}
            onClick={() => onSetShowRawCommandPanel(!showRawCommandPanel)}
          >
            任意コマンド送信
          </button>

          <button
            type="button"
            className={`toggle-pill ${showGamepadPanel ? "is-active" : ""}`}
            aria-pressed={showGamepadPanel}
            onClick={() => onSetShowGamepadPanel(!showGamepadPanel)}
          >
            コントローラー確認
          </button>

          <button
            type="button"
            className="toggle-pill"
            onClick={() =>
              window.open(
                telecoDebugUrlForDisplay,
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            テレコデバッグ画面を開く
          </button>

          <button
            type="button"
            className={`toggle-pill ${showCommandLogPanel ? "is-active" : ""}`}
            aria-pressed={showCommandLogPanel}
            onClick={() => onSetShowCommandLogPanel(!showCommandLogPanel)}
          >
            ログ
          </button>
        </div>
      </PanelBox>

      {showMouthPresetPanel && (
        <PanelBox className="space-y-2">
          <div className="text-sm font-semibold">
            口パク手動プリセット（faceCommand）
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableFaceCommandSend}
                onChange={(e) => onSetEnableFaceCommandSend(e.target.checked)}
              />
              口パク送信（faceCommand）
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableMoveMultiSend}
                onChange={(e) => onSetEnableMoveMultiSend(e.target.checked)}
              />
              腕動かし送信（move_multi 2,4）
            </label>
          </div>
          <p className="text-xs text-slate-500">
            初期状態は両方OFFです。チェックしたコマンドだけ送信します。
          </p>
          <p className="action-state-hint" role="status" aria-live="polite">
            {commandConnected
              ? "テレコ接続済み: 手動プリセットを送信できます"
              : "テレコ未接続: 接続すると手動プリセットを送信できます"}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["a", "i", "u", "e", "o", "xn"] as const).map((v) => (
              <ActionButton
                key={v}
                onClick={() => onSendMouthVowel(v)}
                disabled={!commandConnected}
                tone={v === "xn" ? "secondary" : "primary"}
                label={v === "xn" ? "close(xn)" : v}
              />
            ))}
          </div>
        </PanelBox>
      )}

      {showRawCommandPanel && (
        <PanelBox className="space-y-2">
          <div className="text-sm font-semibold">
            任意コマンド送信（/command）
          </div>

          <p className="action-state-hint" role="status" aria-live="polite">
            {commandConnected
              ? "テレコ接続済み: JSONコマンドを送信できます"
              : "テレコ未接続: 接続するとJSONコマンドを送信できます"}
          </p>

          <div className="text-xs text-slate-600">
            move_multi でハンド等を試す場合はここから送ってください（口は
            faceCommand を使用）。
          </div>

          <textarea
            className="w-full rounded-xl border bg-slate-50 px-3 py-2 text-xs font-mono"
            rows={10}
            value={commandJson}
            onChange={(e) => onSetCommandJson(e.target.value)}
          />

          <div className="flex flex-wrap gap-3">
            <ActionControl
              isReady={commandConnected}
              reason={
                commandConnected
                  ? "現在のJSONを送信できます"
                  : "テレコ接続後に送信できます"
              }
              button={{
                onClick: onSendRawCommandJson,
                disabled: !commandConnected,
                tone: "info",
                label: "コマンド送信",
              }}
            />

            <ActionControl
              isReady
              reason="ログ表示をクリアします"
              button={{
                onClick: onClearCommandLog,
                tone: "secondary",
                label: "ログをクリア",
              }}
            />
          </div>

          <PanelLog>{commandLog || "ログはまだありません"}</PanelLog>
        </PanelBox>
      )}

      {showGamepadPanel && (
        <PanelBox className="space-y-2">
          <div className="text-sm font-semibold">コントローラー確認</div>
          <p className="text-[11px] text-slate-500">
            XBOXコントローラー対応: LB/LT/X/十字左で左、RB/RT/B/十字右で右
          </p>
          <PanelInfo className="break-all">
            Gamepad Debug: index={gamepadIndex ?? "-"} / mapping=
            {gamepadMapping || "-"} / LT={gamepadLtValue.toFixed(2)} / RT=
            {gamepadRtValue.toFixed(2)} / pressed=
            {gamepadPressedButtons.length > 0
              ? gamepadPressedButtons.join(",")
              : "(none)"}
            <br />
            id: {gamepadId || "(none)"}
          </PanelInfo>
        </PanelBox>
      )}

      {showCommandLogPanel && (
        <PanelLog>
          {commandConnectionLog || "ログはまだありません"}
        </PanelLog>
      )}
    </>
  );
}
