import type { RefObject } from "react";

type AudioOutputOption = {
  deviceId: string;
  label: string;
};

type Props = {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioOutputOptions: AudioOutputOption[];
  selectedAudioOutputId: string;
  sinkSelectionSupported: boolean;
  onAudioOutputChange: (deviceId: string) => void;
  onRefreshAudioOutputs: () => void;
};

export default function AudioReceiverPlaybackPanel({
  audioRef,
  audioOutputOptions,
  selectedAudioOutputId,
  sinkSelectionSupported,
  onAudioOutputChange,
  onRefreshAudioOutputs,
}: Props) {
  return (
    <div className="rounded-2xl border bg-white p-4 space-y-2">
      <p className="text-sm text-slate-700">
        受信した音声をここで再生します（再生できない場合は、ボタンなどで一度ユーザ操作してから試してください）。
      </p>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <label className="text-sm text-slate-700">
          出力デバイス
          <select
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
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
        <button
          className="action-button bg-slate-100 self-end"
          type="button"
          onClick={onRefreshAudioOutputs}
        >
          デバイス更新
        </button>
      </div>

      {!sinkSelectionSupported && (
        <p className="text-xs text-amber-700">
          このブラウザでは出力デバイスの切替（setSinkId）が未対応です。
        </p>
      )}

      <audio ref={audioRef} controls autoPlay className="w-full" />
    </div>
  );
}
