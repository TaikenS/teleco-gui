"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * ========= 母音推定 =========
 * - LPC -> formant(F1,F2) -> vowel() -> getVowelLabel()
 * - 無音時 v=-1, 発話が止まったら "N" を出していた
 *   → ここでは "N" を "xn"（口閉じ）として扱う
 */
class VowelEstimator {
  public LPC_ORDER = 64;
  public samplingRate = 44100;
  public bufferSize = 1024;

  public th_volume = 0.00001;
  public th_volume_above = 0.0001;
  public th_volume_under = 0.000001;

  public VOWEL_WINDOW = 20;
  public pre_behavior: string = "n";
  public th_isSpeaking = 0.15;

  private vowelhist: number[] = [];
  private lockingBehavior = false;

  private timer_isSpeaking: number | null = null;

  // コールバック
  private onVowel: (v: string) => void = () => {};
  private onSpeakStatus: (s: "start" | "stop") => void = () => {};

  constructor() {
    this.vowelhist = new Array(this.VOWEL_WINDOW);
    this.vowelhist.fill(0);
  }

  public setSampleRate(sr: number) {
    this.samplingRate = sr;
  }

  public setCallbacks(
    onVowel: (v: string) => void,
    onSpeakStatus: (s: "start" | "stop") => void,
  ) {
    this.onVowel = onVowel;
    this.onSpeakStatus = onSpeakStatus;
  }

  public analyzeData(buffer: Float32Array) {
    const df = this.samplingRate / this.bufferSize;
    const vol = volume(buffer);

    let v: number;

    if (vol < this.th_volume) {
      v = -1;
      this.th_volume_under = this.th_volume_under * 0.99 + vol * 0.01;
      this.th_volume =
        this.th_volume_under * 0.85 + this.th_volume_above * 0.15;
    } else {
      const f = this.extract_formant(buffer, df);
      v = vowel(f[0], f[1]);
      this.th_volume_above = this.th_volume_above * 0.99 + vol * 0.01;
      this.th_volume =
        this.th_volume_under * 0.85 + this.th_volume_above * 0.15;
    }

    this.vowelhist.shift();
    if (v >= 0) this.vowelhist.push(v);
    else this.vowelhist.push(-1);

    const count = this.vowelhist.filter((x) => x >= 0).length;
    const ave = count / this.vowelhist.length;

    let _v = "n";

    if (ave > this.th_isSpeaking) {
      _v = getVowelLabel(v);

      if (!this.timer_isSpeaking) {
        this.onSpeakStatus("start");
      }

      if (this.timer_isSpeaking) {
        clearTimeout(this.timer_isSpeaking);
        this.timer_isSpeaking = null;
      }

      this.timer_isSpeaking = window.setTimeout(() => {
        this.onSpeakStatus("stop");
        this.timer_isSpeaking = null;
        this.onVowel("N");
      }, 1500);

      if (this.pre_behavior !== _v && !this.lockingBehavior) {
        this.onVowel(_v);
        this.lockingBehavior = true;
        this.pre_behavior = _v;
        window.setTimeout(() => (this.lockingBehavior = false), 200);
      }
    }
  }

  private hamming(data: Float32Array) {
    const ret = data.map((d, index) => {
      return (
        d * (0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (data.length - 1)))
      );
    });
    ret[0] = 0;
    ret[data.length - 1] = 0;
    return ret;
  }

  private extract_formant(data: Float32Array, df: number) {
    const hamming_result = normalize(this.hamming(data));
    const lpc_result = normalize(lpc(hamming_result, this.LPC_ORDER, df));
    const formant_result = formant(lpc_result, df);
    return formant_result;
  }
}

// ---- volume ----
function volume(buffer: Float32Array) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sum += v * v;
  }
  return sum / buffer.length;
}

// ---- normalize ----
function normalize(data: Float32Array) {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > max) max = a;
  }
  if (max === 0) return data;
  const ret = data.map((d) => d / max);
  return ret;
}

// ---- FFT helper ----
function expi(theta: number): [number, number] {
  return [Math.cos(theta), Math.sin(theta)];
}
function iadd(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] + b[0], a[1] + b[1]];
}
function isub(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}
function imul(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

// ---- FFT (Cooley–Tukey) ----
function fft(reals: Float32Array) {
  const n = reals.length;
  const xs: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) xs[i] = [reals[i], 0];

  // bit reverse
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tmp = xs[i];
      xs[i] = xs[j];
      xs[j] = tmp;
    }
    let m = n >> 1;
    while (j >= m && m >= 2) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const w = expi(ang * k);
        const u = xs[i + k];
        const t = imul(xs[i + k + len / 2], w);
        xs[i + k] = iadd(u, t);
        xs[i + k + len / 2] = isub(u, t);
      }
    }
  }
  return xs;
}

// ---- autocorrelation ----
function autocorr(x: Float32Array, lag: number) {
  let sum = 0;
  for (let i = 0; i < x.length - lag; i++) sum += x[i] * x[i + lag];
  return sum;
}

// ---- Levinson-Durbin for LPC ----
function levinsonDurbin(r: number[], order: number) {
  const a: number[] = new Array(order + 1).fill(0);
  const e: number[] = new Array(order + 1).fill(0);
  const k: number[] = new Array(order + 1).fill(0);

  a[0] = 1;
  e[0] = r[0];

  for (let i = 1; i <= order; i++) {
    let acc = 0;
    for (let j = 1; j < i; j++) {
      acc += a[j] * r[i - j];
    }
    k[i] = (r[i] - acc) / (e[i - 1] || 1e-12);

    a[i] = k[i];
    for (let j = 1; j < i; j++) {
      a[j] = a[j] - k[i] * a[i - j];
    }
    e[i] = (1 - k[i] * k[i]) * e[i - 1];
  }
  return a;
}

// ---- lpc spectrum ----
function lpc(data: Float32Array, order: number, _df: number) {
  const r: number[] = [];
  for (let i = 0; i <= order; i++) {
    r.push(autocorr(data, i));
  }

  const a = levinsonDurbin(r, order);

  const coeff = new Float32Array(data.length);
  coeff[0] = 1;
  for (let i = 1; i <= order && i < coeff.length; i++) {
    coeff[i] = a[i];
  }

  const X = fft(coeff);
  const spec = new Float32Array(X.length);
  for (let i = 0; i < X.length; i++) {
    const [re, im] = X[i];
    const mag = Math.sqrt(re * re + im * im);
    spec[i] = mag === 0 ? 0 : 1 / mag;
  }
  return spec;
}

// ---- formant peak pick ----
function formant(spec: Float32Array, df: number) {
  const peaks: number[] = [];
  for (let i = 1; i < spec.length - 1; i++) {
    if (spec[i] > spec[i - 1] && spec[i] > spec[i + 1]) peaks.push(i);
  }

  peaks.sort((a, b) => spec[b] - spec[a]);

  const freqs: number[] = [];
  for (let i = 0; i < peaks.length && freqs.length < 5; i++) {
    const f = peaks[i] * df;
    if (f > 150 && f < 5000) freqs.push(f);
  }
  freqs.sort((a, b) => a - b);

  const f1 = freqs[0] ?? 0;
  const f2 = freqs[1] ?? 0;
  return [f1, f2];
}

// ---- vowel decision ----
function vowel(f1: number, f2: number) {
  const frame_f1_f2 = [
    [
      [1200, 2000],
      [1800, 2800],
    ], // a?
    [
      [400, 1000],
      [3000, 6000],
    ], // i
    [
      [200, 600],
      [1000, 3200],
    ], // u
    [
      [800, 1200],
      [2000, 4800],
    ], // e
    [
      [500, 1500],
      [900, 2000],
    ], // o
  ];

  const claster = [0, 0, 0, 0, 0];
  const xm = [750, 300, 350, 520, 480];
  const ym = [1180, 2200, 1100, 1900, 900];

  for (let i = 0; i < 5; i++) {
    if (
      f1 > frame_f1_f2[i][0][0] &&
      f1 < frame_f1_f2[i][0][1] &&
      f2 > frame_f1_f2[i][1][0] &&
      f2 < frame_f1_f2[i][1][1]
    ) {
      claster[i] = 1;
    }
  }

  let distance = 99999;
  let ans = -1;
  for (let i = 0; i < 5; i++) {
    if (claster[i] === 1) {
      const d = Math.sqrt(
        (f1 - xm[i]) * (f1 - xm[i]) + (f2 - ym[i]) * (f2 - ym[i]),
      );
      if (d < distance) {
        distance = d;
        ans = i;
      }
    }
  }
  return ans;
}

function getVowelLabel(v: number) {
  let _v = "n";
  if (v === 0) _v = "a";
  if (v === 1) _v = "i";
  if (v === 2) _v = "u";
  if (v === 3) _v = "e";
  if (v === 4) _v = "o";
  return _v;
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
    if (isDevicePanel) {
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
    }

    if (isTelecoPanel) {
      const savedTelecoIpAddress = window.localStorage.getItem(
        STORAGE_KEYS.telecoIpAddress,
      );
      if (savedTelecoIpAddress) setTelecoIpAddress(savedTelecoIpAddress);

      const savedTelecoPort = window.localStorage.getItem(
        STORAGE_KEYS.telecoPort,
      );
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
    }

    shouldAutoSignalRef.current =
      isDevicePanel &&
      window.localStorage.getItem(STORAGE_KEYS.signalAutoConnect) === "1";
    shouldAutoCommandRef.current =
      isTelecoPanel &&
      window.localStorage.getItem(STORAGE_KEYS.commandAutoConnect) === "1";
    shouldAutoSendingRef.current =
      isDevicePanel &&
      window.localStorage.getItem(STORAGE_KEYS.sendingActive) === "1";

    if (shouldAutoSignalRef.current) {
      manualSignalDisconnectRef.current = false;
      window.setTimeout(() => connectSignalWs(false), 0);
    }

    if (shouldAutoCommandRef.current) {
      manualCommandDisconnectRef.current = false;
      window.setTimeout(() => connectCommandWs(false), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel, isTelecoPanel]);

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
    const recoverIfNeeded = () => {
      if (
        isDevicePanel &&
        !manualSignalDisconnectRef.current &&
        shouldAutoSignalRef.current
      ) {
        const ws = signalWsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectSignalWs(true);
        }
      }

      if (
        isTelecoPanel &&
        !manualCommandDisconnectRef.current &&
        shouldAutoCommandRef.current
      ) {
        const ws = commandWsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectCommandWs(true);
        }
      }

      if (
        isDevicePanel &&
        shouldAutoSendingRef.current &&
        !callIdRef.current &&
        signalWsRef.current?.readyState === WebSocket.OPEN
      ) {
        void startSending();
      }
    };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel, isTelecoPanel]);

  // cleanup
  useEffect(() => {
    return () => {
      // 念のため共有Streamも止める
      usingForWebrtcRef.current = false;
      usingForMicTestRef.current = false;
      if (isDevicePanel) {
        stopSharedStreamIfUnused();
        stopMicTest();
        stopSending();
      }

      manualSignalDisconnectRef.current = true;
      manualCommandDisconnectRef.current = true;
      if (isDevicePanel) {
        clearSignalReconnectTimer();
        clearSignalKeepalive();
        disconnectSignalWs();
      }
      if (isTelecoPanel) {
        clearCommandReconnectTimer();
        disconnectCommandWs();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel, isTelecoPanel]);

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
        <>
          <div className="rounded-xl border bg-white p-3 space-y-3">
        <div className="text-sm font-semibold">
          音声送信・マイク確認（GUI → 別PC AudioReceiver）
        </div>

        <div className="status-chip-row">
          <span
            className={`status-chip ${signalConnected ? "is-on" : signalBusy ? "is-busy" : "is-off"}`}
          >
            Signal{" "}
            {signalConnected
              ? "CONNECTED"
              : signalBusy
                ? "CONNECTING"
                : "OFFLINE"}
          </span>
          <span
            className={`status-chip ${callActive ? (callStatus.includes("connecting") || callStatus.includes("offer") ? "is-busy" : "is-on") : "is-off"}`}
          >
            Audio {callActive ? "LIVE" : "IDLE"}
          </span>
        </div>

        <p className="action-state-hint" role="status" aria-live="polite">
          {!signalConnected
            ? "次の操作: ① Signal WS接続"
            : !hasMic
              ? "次の操作: ② マイクを選択"
              : !callActive
                ? "次の操作: ③ Receiver送信開始"
                : "現在: 送信中"}
        </p>

        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-sm text-slate-700">
            Signaling IP Address
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={signalingIpAddress}
              onChange={(e) => setSignalingIpAddress(e.target.value)}
              placeholder="192.168.1.12"
            />
          </label>

          <label className="text-sm text-slate-700">
            Signaling Port
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={signalingPort}
              onChange={(e) => setSignalingPort(e.target.value)}
              placeholder="3000"
            />
          </label>

          <label className="text-sm text-slate-700">
            Room ID
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={roomHint}
              onChange={(e) => setRoomHint(e.target.value)}
              placeholder="audio1"
            />
          </label>
        </div>
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-700">
          Signaling WS URL（確認用）: {signalingWsUrlForDisplay}
        </p>
        <p className="text-[11px] text-slate-500">
          Base: {signalingBaseUrlForDisplay}
        </p>

        <label className="text-sm text-slate-700">
          Microphone
          <select
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
            value={selectedMicId}
            onChange={(e) => setSelectedMicId(e.target.value)}
          >
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-3">
          <div className="action-button-wrap">
            <button
              onClick={refreshDevices}
              className="action-button bg-slate-100 text-sm"
            >
              デバイス更新
            </button>
            <p className="button-reason is-ready">
              接続前にマイク一覧を更新できます
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={() => {
                manualSignalDisconnectRef.current = false;
                shouldAutoSignalRef.current = true;
                window.localStorage.setItem(
                  STORAGE_KEYS.signalAutoConnect,
                  "1",
                );
                connectSignalWs();
              }}
              disabled={!canConnectSignalNow}
              className="action-button bg-slate-900 text-white text-sm"
              data-busy={signalBusy ? "1" : "0"}
              aria-busy={signalBusy}
            >
              {signalBusy ? "Signal 接続中..." : "Signal WS接続"}
            </button>
            <p
              className={`button-reason ${canConnectSignalNow ? "is-ready" : "is-disabled"}`}
            >
              {signalConnected
                ? "Signal WSはすでに接続中です"
                : signalBusy
                  ? "Signal WS接続処理中です"
                  : !hasSignalingTarget
                    ? "IP Address / Port / Room ID を入力してください"
                    : "Signal WSへ接続できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={disconnectSignalWs}
              disabled={!canDisconnectSignal}
              className="action-button bg-slate-100 text-sm"
            >
              Signal WS切断
            </button>
            <p
              className={`button-reason ${canDisconnectSignal ? "is-ready" : "is-disabled"}`}
            >
              {canDisconnectSignal
                ? "Signal WS接続を停止できます"
                : "Signal WSは未接続です"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={() => void startSending()}
              disabled={!canStartSending}
              className="action-button bg-emerald-600 text-white text-sm"
              data-busy={callStatus === "offer送信中" ? "1" : "0"}
              aria-busy={callStatus === "offer送信中"}
            >
              {callStatus === "offer送信中"
                ? "送信開始中..."
                : "Receiver送信開始"}
            </button>
            <p
              className={`button-reason ${canStartSending ? "is-ready" : "is-disabled"}`}
            >
              {!signalConnected
                ? "先にSignal WS接続が必要です"
                : !hasMic
                  ? "先にマイクを選択してください"
                  : callActive
                    ? "すでに送信中です"
                    : "Receiverへ送信を開始できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={stopSending}
              className="action-button bg-slate-100 text-sm"
              disabled={!canStopSending}
            >
              送信停止
            </button>
            <p
              className={`button-reason ${canStopSending ? "is-ready" : "is-disabled"}`}
            >
              {canStopSending ? "送信を停止できます" : "現在は送信していません"}
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-600 space-y-1">
          <div>Signal WS: {signalWsStatus}</div>
          <div>Audio Send: {callStatus}</div>
          <div>Last Vowel: {lastVowelRef.current}</div>
        </div>
          </div>

          <div className="rounded-xl border bg-white p-3 space-y-3">
        <div className="text-sm font-semibold">
          マイクテスト（ローカル再生 + 母音推定 → faceCommand）
        </div>

        <div className="status-chip-row">
          <span
            className={`status-chip ${micTestRunning ? "is-on" : "is-off"}`}
          >
            Mic Test {micTestRunning ? "RUNNING" : "STOPPED"}
          </span>
          <span
            className={`status-chip ${autoMouthEnabled ? "is-on" : "is-off"}`}
          >
            Auto Mouth {autoMouthEnabled ? "ON" : "OFF"}
          </span>
        </div>

        <p className="action-state-hint" role="status" aria-live="polite">
          {!hasMic
            ? "次の操作: マイクを選択してください"
            : !micTestRunning
              ? "次の操作: Mic Test Start"
              : "現在: マイクテスト動作中です"}
        </p>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="action-button-wrap">
            <button
              onClick={() => void startMicTest()}
              disabled={!canStartMicTest}
              className="action-button bg-blue-600 text-white text-sm"
            >
              Mic Test Start
            </button>
            <p
              className={`button-reason ${canStartMicTest ? "is-ready" : "is-disabled"}`}
            >
              {!hasMic
                ? "先にマイクを選択してください"
                : micTestRunning
                  ? "すでに実行中です"
                  : "マイクテストを開始できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
              onClick={stopMicTest}
              disabled={!canStopMicTest}
              className="action-button bg-slate-100 text-sm"
            >
              Mic Test Stop
            </button>
            <p
              className={`button-reason ${canStopMicTest ? "is-ready" : "is-disabled"}`}
            >
              {canStopMicTest
                ? "マイクテストを停止できます"
                : "現在は停止中です"}
            </p>
          </div>

          <div className="action-button-wrap">
            <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
              <input
                type="checkbox"
                checked={autoMouthEnabled}
                onChange={(e) => setAutoMouthEnabled(e.target.checked)}
              />
              口パク送信（faceCommand）
            </label>
            <p
              className={`button-reason ${autoMouthEnabled ? "is-ready" : "is-disabled"}`}
            >
              {autoMouthEnabled
                ? "母音推定をfaceCommandとして送信します"
                : "ONにすると母音推定を送信します"}
            </p>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-xs text-slate-700">
            Monitor Volume（ハウリング注意）
            <input
              className="mt-1 w-full"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={monitorVolume}
              onChange={(e) => setMonitorVolume(Number(e.target.value))}
            />
            <div className="text-[11px] text-slate-500">
              {monitorVolume.toFixed(2)}
            </div>
          </label>

          <label className="text-xs text-slate-700">
            Noise Floor（レベルメータ用）
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              type="number"
              step="0.001"
              value={noiseFloor}
              onChange={(e) => setNoiseFloor(Number(e.target.value))}
            />
          </label>

          <label className="text-xs text-slate-700">
            Gain（レベルメータ用）
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              type="number"
              step="1"
              value={gain}
              onChange={(e) => setGain(Number(e.target.value))}
            />
          </label>

          <label className="text-xs text-slate-700">
            Mouth Send FPS（送信頻度制限）
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              type="number"
              step="1"
              value={mouthSendFps}
              onChange={(e) => setMouthSendFps(Number(e.target.value))}
            />
          </label>

          <div className="md:col-span-2">
            <div className="text-xs text-slate-700">Mic Level</div>
            <div className="h-3 w-full rounded bg-slate-100 overflow-hidden border">
              <div
                className="h-3 bg-emerald-500"
                style={{ width: `${Math.round(micLevel * 100)}%` }}
              />
            </div>
            <div className="text-[11px] text-slate-500">
              level={micLevel.toFixed(3)}
            </div>
          </div>
        </div>

            <audio ref={micTestAudioRef} autoPlay controls className="w-full" />
          </div>
        </>
      )}

      {isTelecoPanel && (
        <>
          <div className="rounded-xl border bg-white p-3 space-y-2">
        <div className="text-sm font-semibold">teleco setting</div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm text-slate-700">
            teleco IP Address
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={telecoIpAddress}
              onChange={(e) => setTelecoIpAddress(e.target.value)}
              placeholder="192.168.1.12"
            />
          </label>

          <label className="text-sm text-slate-700">
            teleco Port
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={telecoPort}
              onChange={(e) => setTelecoPort(e.target.value)}
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
            window.open(
              telecoDebugUrlForDisplay,
              "_blank",
              "noopener,noreferrer",
            )
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
              onClick={() => {
                manualCommandDisconnectRef.current = false;
                shouldAutoCommandRef.current = true;
                window.localStorage.setItem(
                  STORAGE_KEYS.commandAutoConnect,
                  "1",
                );
                connectCommandWs();
              }}
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
              onClick={disconnectCommandWs}
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
              onClick={() => sendMouthVowel("a")}
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
              onClick={() => sendArrowMove("left")}
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
              onClick={() => sendArrowMove("right")}
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

        <div className="text-xs text-slate-600">
          Command WS: {commandWsStatus}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">詳細パネル表示</div>
          <div className="text-[11px] text-slate-500">
            表示/非表示を切り替え
          </div>
        </div>

        <p className="action-state-hint" role="status" aria-live="polite">
          下の2パネルはチェックで表示/非表示を切り替えできます。
        </p>

        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
            <input
              type="checkbox"
              checked={showMouthPresetPanel}
              onChange={(e) => setShowMouthPresetPanel(e.target.checked)}
            />
            口パク手動プリセット
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
            <input
              type="checkbox"
              checked={showRawCommandPanel}
              onChange={(e) => setShowRawCommandPanel(e.target.checked)}
            />
            任意コマンド送信
          </label>
        </div>
          </div>

          {/* ---- Mouth Manual Presets ---- */}
          {showMouthPresetPanel && (
            <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold">
            口パク手動プリセット（faceCommand）
          </div>
          <p className="action-state-hint" role="status" aria-live="polite">
            {commandConnected
              ? "Command WS接続済み: 手動プリセットを送信できます"
              : "Command WS未接続: 接続すると手動プリセットを送信できます"}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["a", "i", "u", "e", "o", "xn"] as Vowel[]).map((v) => (
              <button
                key={v}
                onClick={() => sendMouthVowel(v)}
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

          {/* ---- Command WS Test Panel ---- */}
          {showRawCommandPanel && (
            <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold">
            任意コマンド送信（/command）
          </div>

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
            onChange={(e) => setCommandJson(e.target.value)}
          />

          <div className="flex flex-wrap gap-3">
            <div className="action-button-wrap">
              <button
                onClick={sendRawCommandJson}
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
                onClick={() => setCommandLog("")}
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
      )}
    </div>
  );
}
