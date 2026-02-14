"use client";

import VowelFormantAnalyzer from "./VowelFormantAnalyzer";

export type VowelLabel = "A" | "I" | "U" | "E" | "O" | "N";

export interface LipSyncCallbacks {
  onVowel?: (vowel: VowelLabel) => void;
  onSpeakStatus?: (status: "start" | "stop") => void;
  onRms?: (rms: number) => void;
}

export interface LipSyncHandle {
  stop: () => void;
}

export function startLipSync(
  stream: MediaStream,
  cb: LipSyncCallbacks = {},
  options: { bufferSize?: number } = {},
): LipSyncHandle {
  const bufferSize = options.bufferSize ?? 1024;

  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);

  const proc = ctx.createScriptProcessor(bufferSize, 1, 1);

  const silent = ctx.createGain();
  silent.gain.value = 0;

  const formant = new VowelFormantAnalyzer();
  formant.setVowelHandler((v: string) => {
    const upper = String(v).toUpperCase();
    const vowel = (
      ["A", "I", "U", "E", "O", "N"].includes(upper) ? upper : "N"
    ) as VowelLabel;
    cb.onVowel?.(vowel);
  });
  formant.setSpeakStatusHandler((s: string) => {
    if (s === "start" || s === "stop") {
      cb.onSpeakStatus?.(s);
    }
  });

  proc.onaudioprocess = (e: AudioProcessingEvent) => {
    const input = e.inputBuffer.getChannelData(0);
    const buf = new Float32Array(bufferSize);

    let sum = 0;
    for (let i = 0; i < bufferSize; i++) {
      const x = input[i] ?? 0;
      buf[i] = x;
      sum += x * x;
    }

    const rms = Math.sqrt(sum / bufferSize);
    cb.onRms?.(rms);

    // feed analyzer
    formant.analyzeData(buf);
  };

  src.connect(proc);
  proc.connect(silent);
  silent.connect(ctx.destination);

  const stop = () => {
    try {
      proc.disconnect();
    } catch {}
    try {
      src.disconnect();
    } catch {}
    try {
      silent.disconnect();
    } catch {}
    try {
      ctx.close();
    } catch {}
  };

  return { stop };
}
