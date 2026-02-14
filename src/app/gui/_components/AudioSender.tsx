"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AudioSenderDevicePanel from "@/app/gui/_components/AudioSenderDevicePanel";
import AudioSenderTelecoPanel from "@/app/gui/_components/AudioSenderTelecoPanel";
import { VowelEstimator } from "@/app/gui/_components/vowelEstimator";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import {
  buildSignalingBaseUrl,
  buildSignalingUrl,
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
  parseSignalingUrl,
} from "@/lib/signaling";
import { AudioCallManager } from "@/lib/webrtc/audioCallManager";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

type MicOption = { deviceId: string; label: string };
type Vowel = "a" | "i" | "u" | "e" | "o" | "xn";

type TelecoArrowDirection = "left" | "right";
const TELECO_ARROW_EVENT = "teleco:arrow";

const STORAGE_KEYS = {
  roomId: "teleco.gui.audio.roomId",
  signalingIpAddress: "teleco.gui.audio.signalingIpAddress",
  signalingPort: "teleco.gui.audio.signalingPort",
  signalingWsUrlLegacy: "teleco.gui.audio.signalWsUrl",
  telecoIpAddress: "teleco.gui.audio.telecoIpAddress",
  telecoPort: "teleco.gui.audio.telecoPort",
  commandWsUrlLegacy: "teleco.gui.audio.commandWsUrl",
  telecoDebugUrlLegacy: "teleco.gui.audio.telecoDebugUrl",
  selectedMicId: "teleco.gui.audio.selectedMicId",
  signalAutoConnect: "teleco.gui.audio.signalAutoConnect",
  commandAutoConnect: "teleco.gui.audio.commandAutoConnect",
  sendingActive: "teleco.gui.audio.sendingActive",
  showMouthPresetPanel: "teleco.gui.audio.showMouthPresetPanel",
  showRawCommandPanel: "teleco.gui.audio.showRawCommandPanel",
};

const DEFAULT_AUDIO_ROOM =
  process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM || "audio1";
const AUDIO_SEND_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_SENDER_SIGNALING_IP_ADDRESS",
];
const AUDIO_SEND_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_AUDIO_SENDER_SIGNALING_PORT",
];
const DEFAULT_SIGNALING_IP_ADDRESS = getDefaultSignalingIpAddress({
  envKeys: AUDIO_SEND_SIGNALING_IP_ENV_KEYS,
});
const DEFAULT_SIGNALING_PORT = getDefaultSignalingPort({
  envKeys: AUDIO_SEND_SIGNALING_PORT_ENV_KEYS,
});
const DEFAULT_TELECO_IP_ADDRESS =
  process.env.NEXT_PUBLIC_TELECO_IP_ADDRESS || "localhost";
const DEFAULT_TELECO_PORT = process.env.NEXT_PUBLIC_TELECO_PORT || "11920";

function parseHostPortFromUrl(
  raw: string,
): { ipAddress: string; port: string } | null {
  const input = raw.trim();
  if (!input) return null;

  const withScheme =
    input.startsWith("ws://") ||
    input.startsWith("wss://") ||
    input.startsWith("http://") ||
    input.startsWith("https://")
      ? input
      : `http://${input.replace(/^\/+/, "")}`;

  try {
    const u = new URL(withScheme);
    return {
      ipAddress: u.hostname || "",
      port: u.port || "",
    };
  } catch {
    return null;
  }
}

function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function bindRecoveryListeners(recoverIfNeeded: () => void): () => void {
  const onOnline = () => recoverIfNeeded();
  const onPageShow = () => recoverIfNeeded();
  const onVisible = () => {
    if (document.visibilityState === "visible") recoverIfNeeded();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * =================== コンポーネント ===================
 */
type AudioSenderPanelMode = "all" | "device" | "teleco";

export default function AudioSender({
  panel = "all",
}: {
  panel?: AudioSenderPanelMode;
}) {
  const isDevicePanel = panel !== "teleco";
  const isTelecoPanel = panel !== "device";
  const manager = useMemo(() => new AudioCallManager(), []);

  // WS: シグナリング（room）
  const signalWsRef = useRef<WebSocket | null>(null);

  // WS: teleco向け（/command）
  const commandWsRef = useRef<WebSocket | null>(null);

  const signalReconnectTimerRef = useRef<number | null>(null);
  const signalReconnectAttemptRef = useRef(0);
  const manualSignalDisconnectRef = useRef(false);

  const commandReconnectTimerRef = useRef<number | null>(null);
  const commandReconnectAttemptRef = useRef(0);
  const manualCommandDisconnectRef = useRef(false);

  const signalKeepaliveTimerRef = useRef<number | null>(null);

  const shouldAutoSignalRef = useRef(false);
  const shouldAutoCommandRef = useRef(false);
  const shouldAutoSendingRef = useRef(false);

  // WebRTC call
  const callIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // UI state
  const [roomHint, setRoomHint] = useState<string>(DEFAULT_AUDIO_ROOM);
  const [signalingIpAddress, setSignalingIpAddress] = useState<string>(
    DEFAULT_SIGNALING_IP_ADDRESS,
  );
  const [signalingPort, setSignalingPort] = useState<string>(
    DEFAULT_SIGNALING_PORT,
  );

  const [telecoIpAddress, setTelecoIpAddress] = useState<string>(
    DEFAULT_TELECO_IP_ADDRESS,
  );
  const [telecoPort, setTelecoPort] = useState<string>(DEFAULT_TELECO_PORT);

  useEffect(() => {
    const values: Record<string, string> = {};
    if (isDevicePanel) {
      values.NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS = signalingIpAddress;
      values.NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT = signalingPort;
    }
    if (isTelecoPanel) {
      values.NEXT_PUBLIC_TELECO_IP_ADDRESS = telecoIpAddress;
      values.NEXT_PUBLIC_TELECO_PORT = telecoPort;
    }
    if (Object.keys(values).length > 0) {
      scheduleEnvLocalSync(values);
    }
  }, [
    isDevicePanel,
    isTelecoPanel,
    signalingIpAddress,
    signalingPort,
    telecoIpAddress,
    telecoPort,
  ]);

  const [mics, setMics] = useState<MicOption[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");

  // ✅ 共有マイク（WebRTC送信 & 口パク解析 & mic monitor で共用）
  const sharedStreamRef = useRef<MediaStream | null>(null);

  // “どの用途が共有Streamを掴んでるか” の簡易フラグ
  const usingForWebrtcRef = useRef(false);
  const usingForMicTestRef = useRef(false);

  async function ensureSharedStream(): Promise<MediaStream> {
    const cur = sharedStreamRef.current;
    const curTrack = cur?.getAudioTracks()?.[0];

    // 既にあって track も生きてるなら再利用
    if (cur && curTrack && curTrack.readyState === "live") return cur;

    // ない/死んでる → 作り直し
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: selectedMicId } },
      video: false,
    });

    sharedStreamRef.current = stream;
    return stream;
  }

  function stopSharedStreamIfUnused() {
    // どちらも使ってないなら止める
    if (usingForWebrtcRef.current) return;
    if (usingForMicTestRef.current) return;

    const s = sharedStreamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      sharedStreamRef.current = null;
    }
  }

  const [signalWsStatus, setSignalWsStatus] = useState<string>("未接続");
  const [commandWsStatus, setCommandWsStatus] = useState<string>("未接続");
  const [callStatus, setCallStatus] = useState<string>("停止");
  const [error, setError] = useState<string | null>(null);

  const commandConnected = commandWsStatus === "接続済み";

  const clientIdRef = useRef<string>(
    `teleco-gui-master-${Math.random().toString(36).slice(2, 10)}`,
  );

  // ---- 任意コマンド送信（hand等検証用）----
  const [commandJson, setCommandJson] = useState<string>(
    `{
  "label": "move_multi",
  "joints": [10],
  "angles": [10],
  "speeds": [20],
  "dontsendback": true
}`,
  );
  const [commandLog, setCommandLog] = useState<string>("");

  // ---- mouth ----
  const lastVowelRef = useRef<Vowel>("xn");
  const lastSendMsRef = useRef<number>(0);
  const [mouthSendFps, setMouthSendFps] = useState<number>(15);

  function appendError(msg: string) {
    setError(msg);
  }
  function logCommand(line: string) {
    setCommandLog((prev) => `${prev}${line}\n`);
  }

  function sendSignal(obj: unknown) {
    const ws = signalWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function sendCommand(
    obj: unknown,
    options?: { silentIfDisconnected?: boolean },
  ) {
    const ws = commandWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (!options?.silentIfDisconnected) {
        appendError("Command WS（teleco-main /command）に接続してください。");
      }
      return false;
    }
    ws.send(JSON.stringify(obj));
    logCommand(`OUT: ${JSON.stringify(obj)}`);
    return true;
  }

  const clearSignalKeepalive = () => {
    if (signalKeepaliveTimerRef.current != null) {
      window.clearInterval(signalKeepaliveTimerRef.current);
      signalKeepaliveTimerRef.current = null;
    }
  };

  const startSignalKeepalive = (ws: WebSocket) => {
    clearSignalKeepalive();

    signalKeepaliveTimerRef.current = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(
          JSON.stringify({
            type: "keepalive",
            roomId: roomHint,
            ts: Date.now(),
          }),
        );
      } catch {
        // noop
      }
    }, 10000);
  };

  function sendRawCommandJson() {
    setError(null);
    try {
      const obj = JSON.parse(commandJson);
      sendCommand(obj);
    } catch {
      appendError(
        "JSONのパースに失敗しました。JSONとして正しい形式か確認してください。",
      );
    }
  }

  function sendMouthVowel(vowel: Vowel) {
    const now = performance.now();
    const minInterval = 1000 / Math.max(1, mouthSendFps);

    if (
      vowel === lastVowelRef.current &&
      now - lastSendMsRef.current < minInterval
    )
      return;

    lastVowelRef.current = vowel;
    lastSendMsRef.current = now;

    sendCommand(
      {
        label: "faceCommand",
        commandFace: "change_mouth_vowel",
        vowel,
        clientId: clientIdRef.current,
        ts: Date.now(),
      },
      { silentIfDisconnected: true },
    );
  }

  function sendArrowMove(direction: TelecoArrowDirection) {
    const angle = direction === "left" ? -30 : 30;
    sendCommand({
      label: "move_multi",
      joints: [8],
      angles: [angle],
      speeds: [30],
      dontsendback: true,
    });
  }

  type MouthMode = "micTest" | "webrtc";

  const mouthModeRef = useRef<MouthMode | null>(null);

  const mouthCtxRef = useRef<AudioContext | null>(null);
  const mouthSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mouthProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mouthZeroGainRef = useRef<GainNode | null>(null);
  const mouthEstimatorRef = useRef<VowelEstimator | null>(null);

  // “Mic Test のときだけ” 使う（monitor再生）
  const micTestAudioRef = useRef<HTMLAudioElement | null>(null);

  // “Mic Test のときだけ” 使う（UI表示）
  const [micTestRunning, setMicTestRunning] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  function stopMouthAnalyzer() {
    if (mouthProcessorRef.current) {
      try {
        mouthProcessorRef.current.disconnect();
      } catch {}
      mouthProcessorRef.current.onaudioprocess = null;
      mouthProcessorRef.current = null;
    }
    if (mouthSourceRef.current) {
      try {
        mouthSourceRef.current.disconnect();
      } catch {}
      mouthSourceRef.current = null;
    }
    if (mouthZeroGainRef.current) {
      try {
        mouthZeroGainRef.current.disconnect();
      } catch {}
      mouthZeroGainRef.current = null;
    }
    if (mouthCtxRef.current) {
      try {
        void mouthCtxRef.current.close();
      } catch {}
      mouthCtxRef.current = null;
    }

    mouthEstimatorRef.current = null;
    mouthModeRef.current = null;

    // micTest UI だけ戻す
    setMicTestRunning(false);
    setMicLevel(0);

    // 口閉じ
    if (autoMouthEnabled) sendMouthVowel("xn");
  }

  async function startMouthAnalyzer(mode: MouthMode, stream: MediaStream) {
    // すでに動いてるならモードが違う可能性あるので止めてから起動
    if (mouthModeRef.current) stopMouthAnalyzer();

    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) {
      appendError("AudioContext が利用できません（ブラウザ非対応）。");
      return;
    }

    try {
      // micTest のときだけ monitor 再生（ここは AudioContext ではなく HTMLAudio でOK）
      if (mode === "micTest" && micTestAudioRef.current) {
        micTestAudioRef.current.srcObject = stream;
        micTestAudioRef.current.volume = clamp01(monitorVolume);
        await micTestAudioRef.current.play().catch(() => {});
      }

      const ctx = new AudioContextCtor();
      mouthCtxRef.current = ctx;
      mouthModeRef.current = mode;

      const src = ctx.createMediaStreamSource(stream);
      mouthSourceRef.current = src;

      const processor = ctx.createScriptProcessor(1024, 1, 1);
      mouthProcessorRef.current = processor;

      // ScriptProcessor を動かすため destination に繋ぐ（gain=0）
      const zero = ctx.createGain();
      zero.gain.value = 0;
      mouthZeroGainRef.current = zero;

      src.connect(processor);
      processor.connect(zero);
      zero.connect(ctx.destination);

      const est = new VowelEstimator();
      est.bufferSize = 1024;
      est.setSampleRate(ctx.sampleRate);
      est.setCallbacks(
        (v) => {
          if (!autoMouthEnabled) return;
          if (v === "N" || v === "n") return sendMouthVowel("xn");
          if (v === "a" || v === "i" || v === "u" || v === "e" || v === "o")
            sendMouthVowel(v);
        },
        (_s) => {},
      );
      mouthEstimatorRef.current = est;

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);

        // micTest のときだけレベルメータ更新
        if (mouthModeRef.current === "micTest") {
          let sum = 0;
          for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
          const rms = Math.sqrt(sum / input.length);
          const level = clamp01((rms - noiseFloor) * gain);
          setMicLevel(level);
        }

        mouthEstimatorRef.current?.analyzeData(input);
      };

      if (mode === "micTest") setMicTestRunning(true);
    } catch (e) {
      console.error(e);
      appendError("口パク解析の開始に失敗しました。");
      stopMouthAnalyzer();
    }
  }

  const [autoMouthEnabled, setAutoMouthEnabled] = useState(true);
  const [monitorVolume, setMonitorVolume] = useState<number>(0.2);

  const [showMouthPresetPanel, setShowMouthPresetPanel] = useState(true);
  const [showRawCommandPanel, setShowRawCommandPanel] = useState(true);

  // レベルメータ用（RMS）
  const [noiseFloor, setNoiseFloor] = useState<number>(0.02);
  const [gain, setGain] = useState<number>(20);

  async function startMicTest() {
    setError(null);
    if (!selectedMicId) return appendError("マイクを選択してください。");

    try {
      usingForMicTestRef.current = true;

      const stream = await ensureSharedStream();

      // ✅ micTestモード：monitor + meter + vowel
      await startMouthAnalyzer("micTest", stream);
    } catch (e) {
      console.error(e);
      usingForMicTestRef.current = false;
      stopSharedStreamIfUnused();
      appendError("マイクテスト開始に失敗しました。");
    }
  }

  function stopMicTest() {
    // monitor 停止（srcObjectだけ外す）
    const a = micTestAudioRef.current;
    if (a) a.srcObject = null;

    stopMouthAnalyzer();

    usingForMicTestRef.current = false;
    stopSharedStreamIfUnused();
  }

  // ---- devices ----
  const refreshDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((d) => d.kind === "audioinput")
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${idx + 1}`,
        }));
      setMics(audioInputs);
      if (!selectedMicId && audioInputs.length > 0)
        setSelectedMicId(audioInputs[0].deviceId);
    } catch (e) {
      console.error(e);
      appendError("デバイス一覧の取得に失敗しました。");
    }
  };

  useEffect(() => {
    if (!isDevicePanel) return;
    const init = async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        tmp.getTracks().forEach((t) => t.stop());
      } catch {}
      await refreshDevices();
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel]);

  useEffect(() => {
    if (!isDevicePanel) return;

    const savedRoomHint = window.localStorage.getItem(STORAGE_KEYS.roomId);
    if (savedRoomHint) setRoomHint(savedRoomHint);

    const savedSignalIpAddress = window.localStorage.getItem(
      STORAGE_KEYS.signalingIpAddress,
    );
    if (savedSignalIpAddress) setSignalingIpAddress(savedSignalIpAddress);

    const savedSignalPort = window.localStorage.getItem(
      STORAGE_KEYS.signalingPort,
    );
    if (savedSignalPort) setSignalingPort(savedSignalPort);

    const legacySignalUrl = window.localStorage.getItem(
      STORAGE_KEYS.signalingWsUrlLegacy,
    );
    if (legacySignalUrl) {
      const parsed = parseSignalingUrl(legacySignalUrl);
      if (parsed?.ipAddress) setSignalingIpAddress(parsed.ipAddress);
      if (parsed?.port) setSignalingPort(parsed.port);
      if (parsed?.roomId) setRoomHint(parsed.roomId);
    }

    const savedMicId = window.localStorage.getItem(STORAGE_KEYS.selectedMicId);
    if (savedMicId) setSelectedMicId(savedMicId);

    shouldAutoSignalRef.current =
      window.localStorage.getItem(STORAGE_KEYS.signalAutoConnect) === "1";
    shouldAutoSendingRef.current =
      window.localStorage.getItem(STORAGE_KEYS.sendingActive) === "1";

    if (shouldAutoSignalRef.current) {
      manualSignalDisconnectRef.current = false;
      window.setTimeout(() => connectSignalWs(false), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel]);

  useEffect(() => {
    if (!isTelecoPanel) return;

    const savedTelecoIpAddress = window.localStorage.getItem(
      STORAGE_KEYS.telecoIpAddress,
    );
    if (savedTelecoIpAddress) setTelecoIpAddress(savedTelecoIpAddress);

    const savedTelecoPort = window.localStorage.getItem(STORAGE_KEYS.telecoPort);
    if (savedTelecoPort) setTelecoPort(savedTelecoPort);

    const legacyCommandWsUrl = window.localStorage.getItem(
      STORAGE_KEYS.commandWsUrlLegacy,
    );
    if (legacyCommandWsUrl) {
      const parsed = parseHostPortFromUrl(legacyCommandWsUrl);
      if (parsed?.ipAddress) setTelecoIpAddress(parsed.ipAddress);
      if (parsed?.port) setTelecoPort(parsed.port);
    }

    const legacyDebugUrl = window.localStorage.getItem(
      STORAGE_KEYS.telecoDebugUrlLegacy,
    );
    if (legacyDebugUrl) {
      const parsed = parseHostPortFromUrl(legacyDebugUrl);
      if (parsed?.ipAddress) setTelecoIpAddress(parsed.ipAddress);
      if (parsed?.port) setTelecoPort(parsed.port);
    }

    const savedShowMouthPresetPanel = window.localStorage.getItem(
      STORAGE_KEYS.showMouthPresetPanel,
    );
    if (savedShowMouthPresetPanel != null)
      setShowMouthPresetPanel(savedShowMouthPresetPanel === "1");

    const savedShowRawCommandPanel = window.localStorage.getItem(
      STORAGE_KEYS.showRawCommandPanel,
    );
    if (savedShowRawCommandPanel != null)
      setShowRawCommandPanel(savedShowRawCommandPanel === "1");

    shouldAutoCommandRef.current =
      window.localStorage.getItem(STORAGE_KEYS.commandAutoConnect) === "1";
    if (shouldAutoCommandRef.current) {
      manualCommandDisconnectRef.current = false;
      window.setTimeout(() => connectCommandWs(false), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelecoPanel]);

  useEffect(() => {
    if (!isDevicePanel) return;
    window.localStorage.setItem(STORAGE_KEYS.roomId, roomHint);
  }, [isDevicePanel, roomHint]);

  useEffect(() => {
    if (!isDevicePanel) return;
    window.localStorage.setItem(
      STORAGE_KEYS.signalingIpAddress,
      signalingIpAddress,
    );
  }, [isDevicePanel, signalingIpAddress]);

  useEffect(() => {
    if (!isDevicePanel) return;
    window.localStorage.setItem(STORAGE_KEYS.signalingPort, signalingPort);
  }, [isDevicePanel, signalingPort]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    window.localStorage.setItem(STORAGE_KEYS.telecoIpAddress, telecoIpAddress);
  }, [isTelecoPanel, telecoIpAddress]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    window.localStorage.setItem(STORAGE_KEYS.telecoPort, telecoPort);
  }, [isTelecoPanel, telecoPort]);

  useEffect(() => {
    if (!isDevicePanel) return;
    if (!selectedMicId) return;
    window.localStorage.setItem(STORAGE_KEYS.selectedMicId, selectedMicId);
  }, [isDevicePanel, selectedMicId]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    window.localStorage.setItem(
      STORAGE_KEYS.showMouthPresetPanel,
      showMouthPresetPanel ? "1" : "0",
    );
  }, [isTelecoPanel, showMouthPresetPanel]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    window.localStorage.setItem(
      STORAGE_KEYS.showRawCommandPanel,
      showRawCommandPanel ? "1" : "0",
    );
  }, [isTelecoPanel, showRawCommandPanel]);

  const clearSignalReconnectTimer = () => {
    if (signalReconnectTimerRef.current != null) {
      window.clearTimeout(signalReconnectTimerRef.current);
      signalReconnectTimerRef.current = null;
    }
  };

  const scheduleSignalReconnect = () => {
    if (manualSignalDisconnectRef.current) return;
    if (!shouldAutoSignalRef.current) return;
    clearSignalReconnectTimer();

    const waitMs = Math.min(
      15000,
      1000 * 2 ** signalReconnectAttemptRef.current,
    );
    signalReconnectAttemptRef.current += 1;

    signalReconnectTimerRef.current = window.setTimeout(() => {
      signalReconnectTimerRef.current = null;
      connectSignalWs(true);
    }, waitMs);
  };

  const clearCommandReconnectTimer = () => {
    if (commandReconnectTimerRef.current != null) {
      window.clearTimeout(commandReconnectTimerRef.current);
      commandReconnectTimerRef.current = null;
    }
  };

  const scheduleCommandReconnect = () => {
    if (manualCommandDisconnectRef.current) return;
    if (!shouldAutoCommandRef.current) return;
    clearCommandReconnectTimer();

    const waitMs = Math.min(
      15000,
      1000 * 2 ** commandReconnectAttemptRef.current,
    );
    commandReconnectAttemptRef.current += 1;

    commandReconnectTimerRef.current = window.setTimeout(() => {
      commandReconnectTimerRef.current = null;
      connectCommandWs(true);
    }, waitMs);
  };

  // ---- WS connect (signal) ----
  const connectSignalWs = (isReconnect = false) => {
    setError(null);

    if (
      signalWsRef.current &&
      (signalWsRef.current.readyState === WebSocket.OPEN ||
        signalWsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    manualSignalDisconnectRef.current = false;
    clearSignalReconnectTimer();
    setSignalWsStatus("接続中");

    if (
      !signalingIpAddress.trim() ||
      !signalingPort.trim() ||
      !roomHint.trim()
    ) {
      setSignalWsStatus("エラー");
      appendError(
        "Signaling の IP Address / Port / Room ID を入力してください。",
      );
      return;
    }

    const normalized = buildSignalingUrl({
      ipAddress: signalingIpAddress,
      port: signalingPort,
      roomId: roomHint,
    });

    try {
      const ws = new WebSocket(normalized);
      signalWsRef.current = ws;

      ws.onopen = () => {
        signalReconnectAttemptRef.current = 0;
        setSignalWsStatus("接続済み");
        startSignalKeepalive(ws);

        // room同期（queryと二重でも問題なし）
        ws.send(
          JSON.stringify({ type: "join", roomId: roomHint, role: "sender" }),
        );

        if (isReconnect) {
          logCommand("Signal WS 再接続");
        }

        if (shouldAutoSendingRef.current && !callIdRef.current) {
          window.setTimeout(() => {
            void startSending();
          }, 300);
        }
      };

      ws.onclose = () => {
        clearSignalKeepalive();
        if (signalWsRef.current === ws) signalWsRef.current = null;
        setSignalWsStatus("切断");
        scheduleSignalReconnect();
      };

      ws.onerror = () => {
        setSignalWsStatus("エラー");
        appendError(
          "Signal WebSocket 接続でエラーが発生しました。URL/ポート/PC(IP)を確認してください。\n" +
            `接続先: ${normalized}`,
        );
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") text = event.data;
          else if (event.data instanceof ArrayBuffer)
            text = new TextDecoder().decode(event.data);
          else if (event.data instanceof Blob) text = await event.data.text();
          else text = String(event.data);

          const msg = JSON.parse(text) as SignalingMessage;
          await manager.handleIncomingMessage(msg);
        } catch {
          // ignore
        }
      };
    } catch (e) {
      console.error(e);
      setSignalWsStatus("エラー");
      appendError("Signal WebSocket の作成に失敗しました。");
    }
  };

  const disconnectSignalWs = () => {
    manualSignalDisconnectRef.current = true;
    shouldAutoSignalRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "0");
    clearSignalReconnectTimer();
    clearSignalKeepalive();

    const ws = signalWsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }

    signalWsRef.current = null;
    setSignalWsStatus("切断");
  };

  // ---- WS connect (command) ----
  const connectCommandWs = (isReconnect = false) => {
    setError(null);

    if (
      commandWsRef.current &&
      (commandWsRef.current.readyState === WebSocket.OPEN ||
        commandWsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    manualCommandDisconnectRef.current = false;
    clearCommandReconnectTimer();
    setCommandWsStatus("接続中");

    if (!telecoIpAddress.trim() || !telecoPort.trim()) {
      setCommandWsStatus("エラー");
      appendError("teleco の IP Address / Port を入力してください。");
      return;
    }

    const commandWsUrl = `ws://${telecoIpAddress.trim()}:${telecoPort.trim()}/command`;

    try {
      const ws = new WebSocket(commandWsUrl);
      commandWsRef.current = ws;

      ws.onopen = () => {
        commandReconnectAttemptRef.current = 0;
        setCommandWsStatus("接続済み");
        if (isReconnect) {
          logCommand("Command WS 再接続");
        }
      };

      ws.onclose = () => {
        if (commandWsRef.current === ws) commandWsRef.current = null;
        setCommandWsStatus("切断");
        scheduleCommandReconnect();
      };

      ws.onerror = () => {
        setCommandWsStatus("エラー");
        appendError(
          `Command WebSocket 接続でエラーが発生しました。\n接続先: ${commandWsUrl}`,
        );
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") text = event.data;
          else if (event.data instanceof Blob) text = await event.data.text();
          else if (event.data instanceof ArrayBuffer)
            text = new TextDecoder().decode(event.data);
          else text = String(event.data);

          logCommand(`IN: ${text}`);
        } catch {
          logCommand("IN: (failed to decode message)");
        }
      };
    } catch (e) {
      console.error(e);
      setCommandWsStatus("エラー");
      appendError("Command WebSocket の作成に失敗しました。");
    }
  };

  const disconnectCommandWs = () => {
    manualCommandDisconnectRef.current = true;
    shouldAutoCommandRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "0");
    clearCommandReconnectTimer();

    const ws = commandWsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }

    commandWsRef.current = null;
    setCommandWsStatus("切断");
  };

  // ---- WebRTC (audio send) ----
  const startSending = async () => {
    setError(null);

    const signalWs = signalWsRef.current;
    if (!signalWs || signalWs.readyState !== WebSocket.OPEN) {
      appendError("先に Signal WebSocket（/ws?room=...）に接続してください。");
      return;
    }

    if (!selectedMicId) {
      appendError("マイクを選択してください。");
      return;
    }

    stopSending();

    try {
      usingForWebrtcRef.current = true;

      const stream = await ensureSharedStream();
      streamRef.current = stream;

      // ✅ webrtcモード：口パク推定のみ（monitor/levelなし）
      await startMouthAnalyzer("webrtc", stream);

      const track = stream.getAudioTracks()[0];
      if (!track) {
        appendError("音声トラックを取得できませんでした。");
        usingForWebrtcRef.current = false;
        stopSharedStreamIfUnused();
        return;
      }

      setCallStatus("offer送信中");

      const sendFn = (msg: SignalingMessage) => sendSignal(msg);
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
      appendError("マイク取得または WebRTC 開始に失敗しました。");
    }
  };

  const stopSending = () => {
    const callId = callIdRef.current;
    if (callId) {
      manager.closeCall(callId);
      callIdRef.current = null;
    }

    // streamRef は sharedStream を指しているだけなので null にするだけ
    streamRef.current = null;

    stopMouthAnalyzer();

    usingForWebrtcRef.current = false;
    stopSharedStreamIfUnused();

    setCallStatus("停止");
    shouldAutoSendingRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.sendingActive, "0");
  };

  useEffect(() => {
    if (!isTelecoPanel) return;
    const onTelecoArrow = (ev: Event) => {
      const detail = (ev as CustomEvent<{ direction?: TelecoArrowDirection }>)
        .detail;
      if (!detail?.direction) return;
      sendArrowMove(detail.direction);
    };

    window.addEventListener(TELECO_ARROW_EVENT, onTelecoArrow as EventListener);
    return () => {
      window.removeEventListener(
        TELECO_ARROW_EVENT,
        onTelecoArrow as EventListener,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelecoPanel]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        sendArrowMove("left");
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        sendArrowMove("right");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelecoPanel]);

  useEffect(() => {
    if (!isDevicePanel) return;
    const recoverIfNeeded = () => {
      if (!manualSignalDisconnectRef.current && shouldAutoSignalRef.current) {
        const ws = signalWsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectSignalWs(true);
        }
      }

      if (
        shouldAutoSendingRef.current &&
        !callIdRef.current &&
        signalWsRef.current?.readyState === WebSocket.OPEN
      ) {
        void startSending();
      }
    };
    return bindRecoveryListeners(recoverIfNeeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    const recoverIfNeeded = () => {
      if (!manualCommandDisconnectRef.current && shouldAutoCommandRef.current) {
        const ws = commandWsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectCommandWs(true);
        }
      }
    };
    return bindRecoveryListeners(recoverIfNeeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelecoPanel]);

  useEffect(() => {
    if (!isDevicePanel) return;
    return () => {
      usingForWebrtcRef.current = false;
      usingForMicTestRef.current = false;
      stopSharedStreamIfUnused();
      stopMicTest();
      stopSending();
      manualSignalDisconnectRef.current = true;
      clearSignalReconnectTimer();
      clearSignalKeepalive();
      disconnectSignalWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    return () => {
      manualCommandDisconnectRef.current = true;
      clearCommandReconnectTimer();
      disconnectCommandWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelecoPanel]);

  const signalConnected = signalWsStatus === "接続済み";
  const signalBusy = signalWsStatus === "接続中";
  const commandBusy = commandWsStatus === "接続中";
  const hasMic = selectedMicId.trim().length > 0;
  const callStateLower = callStatus.toLowerCase();
  const callActive =
    callStatus !== "停止" &&
    !callStateLower.includes("closed") &&
    !callStateLower.includes("failed") &&
    !callStateLower.includes("disconnected");

  const canConnectSignal = !signalConnected && !signalBusy;
  const canDisconnectSignal = signalConnected || signalBusy;
  const canStartSending = signalConnected && hasMic && !callActive;
  const canStopSending = callActive;

  const canConnectCommand = !commandConnected && !commandBusy;
  const canDisconnectCommand = commandConnected || commandBusy;
  const canRunMouthTest = commandConnected;
  const canStartMicTest = !micTestRunning && hasMic;
  const canStopMicTest = micTestRunning;
  const signalingWsUrlForDisplay = buildSignalingUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
    roomId: roomHint,
  });
  const signalingBaseUrlForDisplay = buildSignalingBaseUrl({
    ipAddress: signalingIpAddress,
    port: signalingPort,
  });
  const hasSignalingTarget =
    signalingIpAddress.trim().length > 0 &&
    signalingPort.trim().length > 0 &&
    roomHint.trim().length > 0;
  const canConnectSignalNow = canConnectSignal && hasSignalingTarget;
  const telecoDebugUrlForDisplay = `http://${telecoIpAddress.trim()}:${telecoPort.trim()}/`;
  const commandWsUrlForDisplay = `ws://${telecoIpAddress.trim()}:${telecoPort.trim()}/command`;
  const hasTelecoTarget =
    telecoIpAddress.trim().length > 0 && telecoPort.trim().length > 0;
  const canConnectCommandNow = canConnectCommand && hasTelecoTarget;

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-xs text-red-600 whitespace-pre-line">{error}</p>
      )}

      {isDevicePanel && (
        <AudioSenderDevicePanel
          signalConnected={signalConnected}
          signalBusy={signalBusy}
          callActive={callActive}
          callStatus={callStatus}
          hasMic={hasMic}
          signalingIpAddress={signalingIpAddress}
          signalingPort={signalingPort}
          roomHint={roomHint}
          signalingWsUrlForDisplay={signalingWsUrlForDisplay}
          signalingBaseUrlForDisplay={signalingBaseUrlForDisplay}
          mics={mics}
          selectedMicId={selectedMicId}
          signalWsStatus={signalWsStatus}
          lastVowel={lastVowelRef.current}
          micTestRunning={micTestRunning}
          autoMouthEnabled={autoMouthEnabled}
          monitorVolume={monitorVolume}
          noiseFloor={noiseFloor}
          gain={gain}
          mouthSendFps={mouthSendFps}
          micLevel={micLevel}
          canConnectSignalNow={canConnectSignalNow}
          canDisconnectSignal={canDisconnectSignal}
          canStartSending={canStartSending}
          canStopSending={canStopSending}
          canStartMicTest={canStartMicTest}
          canStopMicTest={canStopMicTest}
          hasSignalingTarget={hasSignalingTarget}
          micTestAudioRef={micTestAudioRef}
          onSetSignalingIpAddress={setSignalingIpAddress}
          onSetSignalingPort={setSignalingPort}
          onSetRoomHint={setRoomHint}
          onSetSelectedMicId={setSelectedMicId}
          onSetAutoMouthEnabled={setAutoMouthEnabled}
          onSetMonitorVolume={setMonitorVolume}
          onSetNoiseFloor={setNoiseFloor}
          onSetGain={setGain}
          onSetMouthSendFps={setMouthSendFps}
          onRefreshDevices={refreshDevices}
          onConnectSignal={() => {
            manualSignalDisconnectRef.current = false;
            shouldAutoSignalRef.current = true;
            window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "1");
            connectSignalWs();
          }}
          onDisconnectSignal={disconnectSignalWs}
          onStartSending={() => void startSending()}
          onStopSending={stopSending}
          onStartMicTest={() => void startMicTest()}
          onStopMicTest={stopMicTest}
        />
      )}

      {isTelecoPanel && (
        <AudioSenderTelecoPanel
          telecoIpAddress={telecoIpAddress}
          telecoPort={telecoPort}
          telecoDebugUrlForDisplay={telecoDebugUrlForDisplay}
          commandWsUrlForDisplay={commandWsUrlForDisplay}
          commandConnected={commandConnected}
          commandBusy={commandBusy}
          hasTelecoTarget={hasTelecoTarget}
          canConnectCommandNow={canConnectCommandNow}
          canDisconnectCommand={canDisconnectCommand}
          canRunMouthTest={canRunMouthTest}
          commandWsStatus={commandWsStatus}
          showMouthPresetPanel={showMouthPresetPanel}
          showRawCommandPanel={showRawCommandPanel}
          commandJson={commandJson}
          commandLog={commandLog}
          onSetTelecoIpAddress={setTelecoIpAddress}
          onSetTelecoPort={setTelecoPort}
          onConnectCommand={() => {
            manualCommandDisconnectRef.current = false;
            shouldAutoCommandRef.current = true;
            window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "1");
            connectCommandWs();
          }}
          onDisconnectCommand={disconnectCommandWs}
          onMouthTestA={() => sendMouthVowel("a")}
          onArrowLeft={() => sendArrowMove("left")}
          onArrowRight={() => sendArrowMove("right")}
          onSetShowMouthPresetPanel={setShowMouthPresetPanel}
          onSetShowRawCommandPanel={setShowRawCommandPanel}
          onSendMouthVowel={sendMouthVowel}
          onSetCommandJson={setCommandJson}
          onSendRawCommandJson={sendRawCommandJson}
          onClearCommandLog={() => setCommandLog("")}
        />
      )}
    </div>
  );
}
