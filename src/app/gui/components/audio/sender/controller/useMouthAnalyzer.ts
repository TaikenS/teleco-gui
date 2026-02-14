import { useRef, useState } from "react";
import { clamp01 } from "@/app/gui/components/audio/sender/controller/helpers";
import { VowelEstimator } from "@/app/gui/components/audio/sender/vowelEstimator";
import type {
  MouthMode,
  Vowel,
} from "@/app/gui/components/audio/sender/controller/types";

export function useMouthAnalyzer(params: {
  autoMouthEnabled: boolean;
  monitorVolume: number;
  noiseFloor: number;
  gain: number;
  onError: (message: string) => void;
  sendMouthVowel: (vowel: Vowel) => void;
}) {
  const {
    autoMouthEnabled,
    monitorVolume,
    noiseFloor,
    gain,
    onError,
    sendMouthVowel,
  } = params;

  const mouthModeRef = useRef<MouthMode | null>(null);
  const mouthCtxRef = useRef<AudioContext | null>(null);
  const mouthSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mouthProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mouthZeroGainRef = useRef<GainNode | null>(null);
  const mouthEstimatorRef = useRef<VowelEstimator | null>(null);

  const micTestAudioRef = useRef<HTMLAudioElement | null>(null);

  const [micTestRunning, setMicTestRunning] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const stopMouthAnalyzer = () => {
    if (mouthProcessorRef.current) {
      try {
        mouthProcessorRef.current.disconnect();
      } catch {
        // noop
      }
      mouthProcessorRef.current.onaudioprocess = null;
      mouthProcessorRef.current = null;
    }

    if (mouthSourceRef.current) {
      try {
        mouthSourceRef.current.disconnect();
      } catch {
        // noop
      }
      mouthSourceRef.current = null;
    }

    if (mouthZeroGainRef.current) {
      try {
        mouthZeroGainRef.current.disconnect();
      } catch {
        // noop
      }
      mouthZeroGainRef.current = null;
    }

    if (mouthCtxRef.current) {
      try {
        void mouthCtxRef.current.close();
      } catch {
        // noop
      }
      mouthCtxRef.current = null;
    }

    mouthEstimatorRef.current = null;
    mouthModeRef.current = null;

    setMicTestRunning(false);
    setMicLevel(0);

    if (autoMouthEnabled) {
      sendMouthVowel("xn");
    }
  };

  const startMouthAnalyzer = async (mode: MouthMode, stream: MediaStream) => {
    if (mouthModeRef.current) {
      stopMouthAnalyzer();
    }

    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) {
      onError("AudioContext が利用できません（ブラウザ非対応）。");
      return;
    }

    try {
      if (mode === "micTest" && micTestAudioRef.current) {
        micTestAudioRef.current.srcObject = stream;
        micTestAudioRef.current.volume = clamp01(monitorVolume);
        await micTestAudioRef.current.play().catch(() => {});
      }

      const ctx = new AudioContextCtor();
      mouthCtxRef.current = ctx;
      mouthModeRef.current = mode;

      const source = ctx.createMediaStreamSource(stream);
      mouthSourceRef.current = source;

      const processor = ctx.createScriptProcessor(1024, 1, 1);
      mouthProcessorRef.current = processor;

      const zeroGain = ctx.createGain();
      zeroGain.gain.value = 0;
      mouthZeroGainRef.current = zeroGain;

      source.connect(processor);
      processor.connect(zeroGain);
      zeroGain.connect(ctx.destination);

      const estimator = new VowelEstimator();
      estimator.bufferSize = 1024;
      estimator.setSampleRate(ctx.sampleRate);
      estimator.setCallbacks(
        (v) => {
          if (!autoMouthEnabled) return;
          if (v === "N" || v === "n") {
            sendMouthVowel("xn");
            return;
          }
          if (v === "a" || v === "i" || v === "u" || v === "e" || v === "o") {
            sendMouthVowel(v);
          }
        },
        () => {},
      );
      mouthEstimatorRef.current = estimator;

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);

        if (mouthModeRef.current === "micTest") {
          let sum = 0;
          for (let i = 0; i < input.length; i++) {
            sum += input[i] * input[i];
          }
          const rms = Math.sqrt(sum / input.length);
          const level = clamp01((rms - noiseFloor) * gain);
          setMicLevel(level);
        }

        mouthEstimatorRef.current?.analyzeData(input);
      };

      if (mode === "micTest") {
        setMicTestRunning(true);
      }
    } catch (error) {
      console.error(error);
      onError("口パク解析の開始に失敗しました。");
      stopMouthAnalyzer();
    }
  };

  return {
    micTestAudioRef,
    micTestRunning,
    micLevel,
    startMouthAnalyzer,
    stopMouthAnalyzer,
  };
}
