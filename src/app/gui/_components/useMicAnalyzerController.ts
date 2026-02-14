import type { RefObject } from "react";

type MicOption = { deviceId: string; label: string };

export function useMicAnalyzerController(params: {
  selectedMicId: string;
  micTestRunning: boolean;
  autoMouthEnabled: boolean;
  monitorVolume: number;
  noiseFloor: number;
  gain: number;
  mouthSendFps: number;
  micLevel: number;
  mics: MicOption[];
  signalWsStatus: string;
  callStatus: string;
  lastVowel: string;
  micTestAudioRef: RefObject<HTMLAudioElement | null>;
  canStartMicTest: boolean;
  canStopMicTest: boolean;
  onSetSelectedMicId: (v: string) => void;
  onSetAutoMouthEnabled: (v: boolean) => void;
  onSetMonitorVolume: (v: number) => void;
  onSetNoiseFloor: (v: number) => void;
  onSetGain: (v: number) => void;
  onSetMouthSendFps: (v: number) => void;
  onRefreshDevices: () => void;
  onStartMicTest: () => void;
  onStopMicTest: () => void;
}) {
  return {
    selectedMicId: params.selectedMicId,
    micTestRunning: params.micTestRunning,
    autoMouthEnabled: params.autoMouthEnabled,
    monitorVolume: params.monitorVolume,
    noiseFloor: params.noiseFloor,
    gain: params.gain,
    mouthSendFps: params.mouthSendFps,
    micLevel: params.micLevel,
    mics: params.mics,
    signalWsStatus: params.signalWsStatus,
    callStatus: params.callStatus,
    lastVowel: params.lastVowel,
    micTestAudioRef: params.micTestAudioRef,
    canStartMicTest: params.canStartMicTest,
    canStopMicTest: params.canStopMicTest,
    onSetSelectedMicId: params.onSetSelectedMicId,
    onSetAutoMouthEnabled: params.onSetAutoMouthEnabled,
    onSetMonitorVolume: params.onSetMonitorVolume,
    onSetNoiseFloor: params.onSetNoiseFloor,
    onSetGain: params.onSetGain,
    onSetMouthSendFps: params.onSetMouthSendFps,
    onRefreshDevices: params.onRefreshDevices,
    onStartMicTest: params.onStartMicTest,
    onStopMicTest: params.onStopMicTest,
  };
}
