"use client";

import {
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { STORAGE_KEYS } from "@/app/gui/components/audio/sender/controller/constants";
import { useMouthAnalyzer } from "@/app/gui/components/audio/sender/controller/useMouthAnalyzer";
import { AudioCallManager } from "@/lib/webrtc/audioCallManager";
import type { MicOption } from "@/app/gui/components/audio/sender/controller/types";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

type Args = {
  selectedMicId: string;
  setSelectedMicId: Dispatch<SetStateAction<string>>;
  usingForWebrtcRef: MutableRefObject<boolean>;
  usingForMicTestRef: MutableRefObject<boolean>;
  ensureSharedStream: () => Promise<MediaStream>;
  stopSharedStreamIfUnused: () => void;
  signalWsRef: MutableRefObject<WebSocket | null>;
  callIdRef: MutableRefObject<string | null>;
  shouldAutoSendingRef: MutableRefObject<boolean>;
  manager: AudioCallManager;
  autoMouthEnabled: boolean;
  monitorVolume: number;
  noiseFloor: number;
  gain: number;
  mouthSpeakingThreshold: number;
  onClearError: () => void;
  onError: (message: string) => void;
  sendMouthVowel: (msg: "a" | "i" | "u" | "e" | "o" | "xn") => void;
};

export function useAudioInputController({
  selectedMicId,
  setSelectedMicId,
  usingForWebrtcRef,
  usingForMicTestRef,
  ensureSharedStream,
  stopSharedStreamIfUnused,
  signalWsRef,
  callIdRef,
  shouldAutoSendingRef,
  manager,
  autoMouthEnabled,
  monitorVolume,
  noiseFloor,
  gain,
  mouthSpeakingThreshold,
  onClearError,
  onError,
  sendMouthVowel,
}: Args) {
  const streamRef = useRef<MediaStream | null>(null);
  const [mics, setMics] = useState<MicOption[]>([]);
  const [callStatus, setCallStatus] = useState<string>("停止");

  const {
    micTestAudioRef,
    micTestRunning,
    micLevel,
    startMouthAnalyzer,
    stopMouthAnalyzer,
  } = useMouthAnalyzer({
    autoMouthEnabled,
    monitorVolume,
    noiseFloor,
    gain,
    speakingThreshold: mouthSpeakingThreshold,
    onError,
    sendMouthVowel,
  });

  const refreshDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, idx) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${idx + 1}`,
        }));
      setMics(audioInputs);
      if (!selectedMicId && audioInputs.length > 0) {
        setSelectedMicId(audioInputs[0].deviceId);
      }
    } catch (e) {
      console.error(e);
      onError("デバイス一覧の取得に失敗しました。");
    }
  };

  const startMicTest = async () => {
    onClearError();
    if (!selectedMicId) {
      onError("マイクを選択してください。");
      return;
    }

    try {
      usingForMicTestRef.current = true;
      const stream = await ensureSharedStream();
      await startMouthAnalyzer("micTest", stream);
    } catch (e) {
      console.error(e);
      usingForMicTestRef.current = false;
      stopSharedStreamIfUnused();
      onError("マイクテスト開始に失敗しました。");
    }
  };

  const stopMicTest = () => {
    const audioElement = micTestAudioRef.current;
    if (audioElement) {
      audioElement.srcObject = null;
    }

    stopMouthAnalyzer();
    usingForMicTestRef.current = false;
    stopSharedStreamIfUnused();
  };

  const stopSending = () => {
    const callId = callIdRef.current;
    if (callId) {
      manager.closeCall(callId);
      callIdRef.current = null;
    }

    streamRef.current = null;
    stopMouthAnalyzer();
    usingForWebrtcRef.current = false;
    stopSharedStreamIfUnused();
    setCallStatus("停止");
    shouldAutoSendingRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.sendingActive, "0");
  };

  const startSending = async () => {
    onClearError();
    const signalWs = signalWsRef.current;
    if (!signalWs || signalWs.readyState !== WebSocket.OPEN) {
      onError("先に Signal WebSocket（/ws?room=...）に接続してください。");
      return;
    }

    if (!selectedMicId) {
      onError("マイクを選択してください。");
      return;
    }

    stopSending();

    try {
      usingForWebrtcRef.current = true;

      const stream = await ensureSharedStream();
      streamRef.current = stream;
      await startMouthAnalyzer("webrtc", stream);

      const track = stream.getAudioTracks()[0];
      if (!track) {
        onError("音声トラックを取得できませんでした。");
        usingForWebrtcRef.current = false;
        stopSharedStreamIfUnused();
        return;
      }

      setCallStatus("offer送信中");
      const sendFn = (msg: SignalingMessage) => {
        const ws = signalWsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(msg));
      };
      const callId = await manager.callAudioRequest(
        track,
        "",
        sendFn,
        (state) => setCallStatus(`WebRTC: ${state}`),
      );

      callIdRef.current = callId;
      shouldAutoSendingRef.current = true;
      window.localStorage.setItem(STORAGE_KEYS.sendingActive, "1");
    } catch (e) {
      console.error(e);
      usingForWebrtcRef.current = false;
      stopSharedStreamIfUnused();
      onError("マイク取得または WebRTC 開始に失敗しました。");
    }
  };

  const cleanupAudioInput = () => {
    usingForWebrtcRef.current = false;
    usingForMicTestRef.current = false;
    stopSharedStreamIfUnused();
    stopMicTest();
    stopSending();
  };

  return {
    mics,
    callStatus,
    micTestAudioRef,
    micTestRunning,
    micLevel,
    refreshDevices,
    startMicTest,
    stopMicTest,
    startSending,
    stopSending,
    cleanupAudioInput,
  };
}
