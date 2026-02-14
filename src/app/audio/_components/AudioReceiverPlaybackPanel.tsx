import type { RefObject } from "react";

type Props = {
  audioRef: RefObject<HTMLAudioElement | null>;
};

export default function AudioReceiverPlaybackPanel({ audioRef }: Props) {
  return (
    <div className="rounded-2xl border bg-white p-4 space-y-2">
      <p className="text-sm text-slate-700">
        受信した音声をここで再生します（再生できない場合は、ボタンなどで一度ユーザ操作してから試してください）。
      </p>
      <audio ref={audioRef} controls autoPlay className="w-full" />
    </div>
  );
}
