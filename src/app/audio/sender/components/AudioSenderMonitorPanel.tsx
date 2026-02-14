import type { RefObject } from "react";

type Props = {
  localAudioRef: RefObject<HTMLAudioElement | null>;
};

export default function AudioSenderMonitorPanel({ localAudioRef }: Props) {
  return (
    <div className="rounded-2xl border bg-white p-4 space-y-2">
      <p className="text-sm text-slate-700">
        ここで自分のマイク音声を確認できます（ローカル再生）。
      </p>
      <audio ref={localAudioRef} controls autoPlay className="w-full" />
    </div>
  );
}
