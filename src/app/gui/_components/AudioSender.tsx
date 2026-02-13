"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSignalingUrl } from "@/lib/signaling";
import { AudioCallManager } from "@/lib/webrtc/audioCallManager";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

type MicOption = { deviceId: string; label: string };
type Vowel = "a" | "i" | "u" | "e" | "o" | "xn";

type TelecoArrowDirection = "left" | "right";
const TELECO_ARROW_EVENT = "teleco:arrow";

const STORAGE_KEYS = {
  roomHint: "teleco.gui.audio.roomHint",
  signalWsUrl: "teleco.gui.audio.signalWsUrl",
  receiverDestination: "teleco.gui.audio.receiverDestination",
  commandWsUrl: "teleco.gui.audio.commandWsUrl",
  telecoDebugUrl: "teleco.gui.audio.telecoDebugUrl",
  selectedMicId: "teleco.gui.audio.selectedMicId",
  signalAutoConnect: "teleco.gui.audio.signalAutoConnect",
  commandAutoConnect: "teleco.gui.audio.commandAutoConnect",
  sendingActive: "teleco.gui.audio.sendingActive",
  showMicTestPanel: "teleco.gui.audio.showMicTestPanel",
  showMouthPresetPanel: "teleco.gui.audio.showMouthPresetPanel",
  showRawCommandPanel: "teleco.gui.audio.showRawCommandPanel",
};

const DEFAULT_AUDIO_ROOM = process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM || "audio1";
const DEFAULT_RECEIVER_ID = process.env.NEXT_PUBLIC_DEFAULT_RECEIVER_ID || "rover003";
const DEFAULT_TELECO_COMMAND_WS_URL = process.env.NEXT_PUBLIC_TELECO_COMMAND_WS_URL || "ws://localhost:11920/command";
const DEFAULT_TELECO_HTTP_URL = process.env.NEXT_PUBLIC_TELECO_HTTP_URL || "http://localhost:11920/";

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

  public setCallbacks(onVowel: (v: string) => void, onSpeakStatus: (s: "start" | "stop") => void) {
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
      this.th_volume = this.th_volume_under * 0.85 + this.th_volume_above * 0.15;
    } else {
      const f = this.extract_formant(buffer, df);
      v = vowel(f[0], f[1]);
      this.th_volume_above = this.th_volume_above * 0.99 + vol * 0.01;
      this.th_volume = this.th_volume_under * 0.85 + this.th_volume_above * 0.15;
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
      return d * (0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (data.length - 1)));
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
  const a = new Array(order + 1).fill(0);
  const e = new Array(order + 1).fill(0);
  const k = new Array(order + 1).fill(0);

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
function lpc(data: Float32Array, order: number, df: number) {
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
    [[1200, 2000], [1800, 2800]], // a?
    [[400, 1000], [3000, 6000]], // i
    [[200, 600], [1000, 3200]], // u
    [[800, 1200], [2000, 4800]], // e
    [[500, 1500], [900, 2000]], // o
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
      const d = Math.sqrt((f1 - xm[i]) * (f1 - xm[i]) + (f2 - ym[i]) * (f2 - ym[i]));
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
 * =================== URL補正 ===================
 * - server.mjs は /ws で upgrade を受ける
 * - ws://host:port/?room=xx のように /ws が抜けても補正する
 */
function normalizeSignalingWsUrl(input: string, fallbackRoom: string) {
  let s = input.trim();
  if (!s) return s;

  // http(s) を ws(s) に寄せる（貼り付け事故対策）
  if (s.startsWith("http://")) s = "ws://" + s.slice("http://".length);
  if (s.startsWith("https://")) s = "wss://" + s.slice("https://".length);

  // ws(s) でなければそのまま（UIでエラー表示する）
  if (!s.startsWith("ws://") && !s.startsWith("wss://")) return s;

  try {
    const u = new URL(s);

    // /ws が無ければ /ws を付ける
    if (u.pathname === "/" || u.pathname === "") {
      // ユーザが ?room=... だけ付けてるケースを救済
      u.pathname = "/ws";
    } else if (!u.pathname.startsWith("/ws")) {
      // /signal とか入れてしまった場合は、明示的に /ws に寄せる
      // （必要ならここは「そのまま」にしてもいいが、今回の事故はここで救える）
      u.pathname = "/ws";
    }

    // room は常に roomHint 側を優先（UIとズレないようにする）
    if (fallbackRoom) {
      u.searchParams.set("room", fallbackRoom);
    }

    return u.toString();
  } catch {
    return s;
  }
}

/**
 * =================== コンポーネント ===================
 */
export default function AudioSender() {
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

  const [signalWsUrl, setSignalWsUrl] = useState<string>(() => getSignalingUrl(DEFAULT_AUDIO_ROOM));

  const [receiverDestination, setReceiverDestination] = useState<string>(DEFAULT_RECEIVER_ID);

  const [commandWsUrl, setCommandWsUrl] = useState<string>(DEFAULT_TELECO_COMMAND_WS_URL);
  const [telecoDebugUrl, setTelecoDebugUrl] = useState<string>(DEFAULT_TELECO_HTTP_URL);

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


  const clientIdRef = useRef<string>(`teleco-gui-master-${Math.random().toString(36).slice(2, 10)}`);

  // ---- 任意コマンド送信（hand等検証用）----
  const [commandJson, setCommandJson] = useState<string>(
      `{
  "label": "move_multi",
  "joints": [10],
  "angles": [10],
  "speeds": [20],
  "dontsendback": true
}`
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

  function sendCommand(obj: unknown, options?: { silentIfDisconnected?: boolean }) {
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
        ws.send(JSON.stringify({ type: "keepalive", roomId: roomHint, ts: Date.now() }));
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
      appendError("JSONのパースに失敗しました。JSONとして正しい形式か確認してください。");
    }
  }

  function sendMouthVowel(vowel: Vowel) {
    const now = performance.now();
    const minInterval = 1000 / Math.max(1, mouthSendFps);

    if (vowel === lastVowelRef.current && now - lastSendMsRef.current < minInterval) return;

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
        { silentIfDisconnected: true }
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
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

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
            if (v === "a" || v === "i" || v === "u" || v === "e" || v === "o") sendMouthVowel(v);
          },
          (_s) => {}
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

  const [showMicTestPanel, setShowMicTestPanel] = useState(true);
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
      if (!selectedMicId && audioInputs.length > 0) setSelectedMicId(audioInputs[0].deviceId);
    } catch (e) {
      console.error(e);
      appendError("デバイス一覧の取得に失敗しました。");
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        tmp.getTracks().forEach((t) => t.stop());
      } catch {}
      await refreshDevices();
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    const savedRoomHint = window.localStorage.getItem(STORAGE_KEYS.roomHint);
    if (savedRoomHint) setRoomHint(savedRoomHint);

    const savedSignalWsUrl = window.localStorage.getItem(STORAGE_KEYS.signalWsUrl);
    if (savedSignalWsUrl) setSignalWsUrl(savedSignalWsUrl);

    const savedDest = window.localStorage.getItem(STORAGE_KEYS.receiverDestination);
    if (savedDest) setReceiverDestination(savedDest);

    const savedCommandWsUrl = window.localStorage.getItem(STORAGE_KEYS.commandWsUrl);
    if (savedCommandWsUrl) setCommandWsUrl(savedCommandWsUrl);

    const savedDebugUrl = window.localStorage.getItem(STORAGE_KEYS.telecoDebugUrl);
    if (savedDebugUrl) setTelecoDebugUrl(savedDebugUrl);

    const savedMicId = window.localStorage.getItem(STORAGE_KEYS.selectedMicId);
    if (savedMicId) setSelectedMicId(savedMicId);

    const savedShowMicTestPanel = window.localStorage.getItem(STORAGE_KEYS.showMicTestPanel);
    if (savedShowMicTestPanel != null) setShowMicTestPanel(savedShowMicTestPanel === "1");

    const savedShowMouthPresetPanel = window.localStorage.getItem(STORAGE_KEYS.showMouthPresetPanel);
    if (savedShowMouthPresetPanel != null) setShowMouthPresetPanel(savedShowMouthPresetPanel === "1");

    const savedShowRawCommandPanel = window.localStorage.getItem(STORAGE_KEYS.showRawCommandPanel);
    if (savedShowRawCommandPanel != null) setShowRawCommandPanel(savedShowRawCommandPanel === "1");

    shouldAutoSignalRef.current = window.localStorage.getItem(STORAGE_KEYS.signalAutoConnect) === "1";
    shouldAutoCommandRef.current = window.localStorage.getItem(STORAGE_KEYS.commandAutoConnect) === "1";
    shouldAutoSendingRef.current = window.localStorage.getItem(STORAGE_KEYS.sendingActive) === "1";

    if (shouldAutoSignalRef.current) {
      manualSignalDisconnectRef.current = false;
      window.setTimeout(() => connectSignalWs(false), 0);
    }

    if (shouldAutoCommandRef.current) {
      manualCommandDisconnectRef.current = false;
      window.setTimeout(() => connectCommandWs(false), 0);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.roomHint, roomHint);
  }, [roomHint]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.signalWsUrl, signalWsUrl);
  }, [signalWsUrl]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.receiverDestination, receiverDestination);
  }, [receiverDestination]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.commandWsUrl, commandWsUrl);
  }, [commandWsUrl]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.telecoDebugUrl, telecoDebugUrl);
  }, [telecoDebugUrl]);

  useEffect(() => {
    if (!selectedMicId) return;
    window.localStorage.setItem(STORAGE_KEYS.selectedMicId, selectedMicId);
  }, [selectedMicId]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.showMicTestPanel, showMicTestPanel ? "1" : "0");
  }, [showMicTestPanel]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.showMouthPresetPanel, showMouthPresetPanel ? "1" : "0");
  }, [showMouthPresetPanel]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.showRawCommandPanel, showRawCommandPanel ? "1" : "0");
  }, [showRawCommandPanel]);

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

    const waitMs = Math.min(15000, 1000 * 2 ** signalReconnectAttemptRef.current);
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

    const waitMs = Math.min(15000, 1000 * 2 ** commandReconnectAttemptRef.current);
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
        (signalWsRef.current.readyState === WebSocket.OPEN || signalWsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    manualSignalDisconnectRef.current = false;
    clearSignalReconnectTimer();
    setSignalWsStatus("接続中");

    const normalized = normalizeSignalingWsUrl(signalWsUrl, roomHint);
    setSignalWsUrl(normalized);

    if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
      setSignalWsStatus("エラー");
      appendError("Signal WS URL は ws:// または wss:// で始まる必要があります。");
      return;
    }
    if (!normalized.includes("/ws")) {
      // normalizeで直るはずだが念のため
      setSignalWsStatus("エラー");
      appendError("Signal WS は /ws に接続してください（例: ws://HOST:PORT/ws?room=audio1）。");
      return;
    }

    try {
      const ws = new WebSocket(normalized);
      signalWsRef.current = ws;

      ws.onopen = () => {
        signalReconnectAttemptRef.current = 0;
        setSignalWsStatus("接続済み");
        startSignalKeepalive(ws);

        // room同期（queryと二重でも問題なし）
        ws.send(JSON.stringify({ type: "join", roomId: roomHint, role: "sender" }));

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
            "※ 統合シグナリングの場合は /ws?room=... が必須です（/ が抜けると Upgrade Required になります）。",
        );
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") text = event.data;
          else if (event.data instanceof ArrayBuffer) text = new TextDecoder().decode(event.data);
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
        (commandWsRef.current.readyState === WebSocket.OPEN || commandWsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    manualCommandDisconnectRef.current = false;
    clearCommandReconnectTimer();
    setCommandWsStatus("接続中");

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
        appendError("Command WebSocket 接続でエラーが発生しました。");
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") text = event.data;
          else if (event.data instanceof Blob) text = await event.data.text();
          else if (event.data instanceof ArrayBuffer) text = new TextDecoder().decode(event.data);
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
      const callId = await manager.callAudioRequest(track, receiverDestination, sendFn, (state) =>
          setCallStatus(`WebRTC: ${state}`)
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
    const onTelecoArrow = (ev: Event) => {
      const detail = (ev as CustomEvent<{ direction?: TelecoArrowDirection }>).detail;
      if (!detail?.direction) return;
      sendArrowMove(detail.direction);
    };

    window.addEventListener(TELECO_ARROW_EVENT, onTelecoArrow as EventListener);
    return () => {
      window.removeEventListener(TELECO_ARROW_EVENT, onTelecoArrow as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
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
  }, []);

  useEffect(() => {
    const recoverIfNeeded = () => {
      if (!manualSignalDisconnectRef.current && shouldAutoSignalRef.current) {
        const ws = signalWsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectSignalWs(true);
        }
      }

      if (!manualCommandDisconnectRef.current && shouldAutoCommandRef.current) {
        const ws = commandWsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectCommandWs(true);
        }
      }

      if (shouldAutoSendingRef.current && !callIdRef.current && signalWsRef.current?.readyState === WebSocket.OPEN) {
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
  }, []);

  // cleanup
  useEffect(() => {
    return () => {
      // 念のため共有Streamも止める
      usingForWebrtcRef.current = false;
      usingForMicTestRef.current = false;
      stopSharedStreamIfUnused();

      stopMicTest();
      stopSending();

      manualSignalDisconnectRef.current = true;
      manualCommandDisconnectRef.current = true;
      clearSignalReconnectTimer();
      clearCommandReconnectTimer();
      clearSignalKeepalive();

      disconnectSignalWs();
      disconnectCommandWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-base font-semibold">Audio Sender（GUI）</div>
          <div className="flex items-center gap-2">
            <input
                className="w-[280px] rounded-xl border px-3 py-2 text-xs bg-white"
                value={telecoDebugUrl}
                onChange={(e) => setTelecoDebugUrl(e.target.value)}
                placeholder="http://localhost:11920/"
            />
            <button
                onClick={() => window.open(telecoDebugUrl, "_blank", "noopener,noreferrer")}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200"
            >
              デバッグ開く（teleco）
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-600 whitespace-pre-line">{error}</p>}

        <div className="rounded-xl border bg-white p-3 space-y-3">
          <div className="text-sm font-semibold">音声送信（GUI → 別PC AudioReceiver）</div>

          <div className="status-chip-row">
            <span className={`status-chip ${signalConnected ? "is-on" : signalBusy ? "is-busy" : "is-off"}`}>
              Signal {signalConnected ? "CONNECTED" : signalBusy ? "CONNECTING" : "OFFLINE"}
            </span>
            <span className={`status-chip ${callActive ? (callStatus.includes("connecting") || callStatus.includes("offer") ? "is-busy" : "is-on") : "is-off"}`}>
              Audio {callActive ? "LIVE" : "IDLE"}
            </span>
            <span className={`status-chip ${commandConnected ? "is-on" : commandBusy ? "is-busy" : "is-off"}`}>
              Command {commandConnected ? "READY" : commandBusy ? "CONNECTING" : "OFF"}
            </span>
          </div>

          <p className="action-state-hint" role="status" aria-live="polite">
            {!signalConnected
                ? "次の操作: ① Signal WS接続"
                : !hasMic
                    ? "次の操作: ② マイクを選択"
                    : !callActive
                        ? "次の操作: ③ Receiver送信開始"
                        : !commandConnected
                            ? "補足: Command WS接続で口パク・矢印操作が有効になります"
                            : "現在: 送信中（口パク・矢印操作も利用可能）"}
          </p>

          <label className="text-sm text-slate-700">
            Signal WS（統合シグナリング：必ず /ws）
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={signalWsUrl}
                onChange={(e) => setSignalWsUrl(e.target.value)}
                placeholder="ws://<host>:<port>/ws?room=audio1"
            />
          </label>

          <div className="grid gap-2 md:grid-cols-3">
            <label className="text-sm text-slate-700">
              Room（見やすさ用メモ）
              <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                  value={roomHint}
                  onChange={(e) => setRoomHint(e.target.value)}
                  placeholder="audio1"
              />
            </label>

            <label className="text-sm text-slate-700 md:col-span-2">
              Destination（AudioReceiver 側の ID ラベル）
              <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                  value={receiverDestination}
                  onChange={(e) => setReceiverDestination(e.target.value)}
                  placeholder="rover003"
              />
            </label>
          </div>

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
              <button onClick={refreshDevices} className="action-button rounded-xl bg-slate-100 px-4 py-2 text-sm">
                デバイス更新
              </button>
              <p className="button-reason is-ready">接続前にマイク一覧を更新できます</p>
            </div>

            <div className="action-button-wrap">
              <button
                  onClick={() => {
                    manualSignalDisconnectRef.current = false;
                    shouldAutoSignalRef.current = true;
                    window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "1");
                    connectSignalWs();
                  }}
                  disabled={!canConnectSignal}
                  className="action-button rounded-xl bg-slate-900 text-white px-4 py-2 text-sm"

                  data-busy={signalBusy ? "1" : "0"}
                  aria-busy={signalBusy}
              >
                {signalBusy ? "Signal 接続中..." : "Signal WS接続"}
              </button>
              <p className={`button-reason ${canConnectSignal ? "is-ready" : "is-disabled"}`}>
                {signalConnected ? "Signal WSはすでに接続中です" : signalBusy ? "Signal WS接続処理中です" : "Signal WSへ接続できます"}
              </p>
            </div>

            <div className="action-button-wrap">
              <button
                  onClick={disconnectSignalWs}
                  disabled={!canDisconnectSignal}
                  className="action-button rounded-xl bg-slate-100 px-4 py-2 text-sm"

              >
                Signal WS切断
              </button>
              <p className={`button-reason ${canDisconnectSignal ? "is-ready" : "is-disabled"}`}>
                {canDisconnectSignal ? "Signal WS接続を停止できます" : "Signal WSは未接続です"}
              </p>
            </div>

            <div className="action-button-wrap">
              <button
                  onClick={() => void startSending()}
                  disabled={!canStartSending}
                  className="action-button rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm"

                  data-busy={callStatus === "offer送信中" ? "1" : "0"}
                  aria-busy={callStatus === "offer送信中"}
              >
                {callStatus === "offer送信中" ? "送信開始中..." : "Receiver送信開始"}
              </button>
              <p className={`button-reason ${canStartSending ? "is-ready" : "is-disabled"}`}>
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
                  className="action-button rounded-xl bg-slate-100 px-4 py-2 text-sm"
                  disabled={!canStopSending}

              >
                送信停止
              </button>
              <p className={`button-reason ${canStopSending ? "is-ready" : "is-disabled"}`}>
                {canStopSending ? "送信を停止できます" : "現在は送信していません"}
              </p>
            </div>
          </div>

          <div className="text-xs text-slate-600 space-y-1">
            <div>Signal WS: {signalWsStatus}</div>
            <div>Audio Send: {callStatus}</div>
            <div>Last Vowel: {lastVowelRef.current}</div>
            <div>Command WS: {commandWsStatus === "接続済み" ? "接続済み（口パク送信有効）" : "未接続（音声送信のみ継続）"}</div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-3 space-y-3">
          <div className="text-sm font-semibold">teleco コマンド送信（/command）</div>

          <div className="status-chip-row">
            <span className={`status-chip ${commandConnected ? "is-on" : commandBusy ? "is-busy" : "is-off"}`}>
              Command WS {commandConnected ? "CONNECTED" : commandBusy ? "CONNECTING" : "OFFLINE"}
            </span>
          </div>

          <p className="action-state-hint" role="status" aria-live="polite">
            {commandConnected
                ? "現在: 口パクテスト・矢印コマンドを実行できます"
                : "次の操作: ① Command WS接続（/command）"}
          </p>

          <label className="text-sm text-slate-700">
            Command WS（teleco-main /command）
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={commandWsUrl}
                onChange={(e) => setCommandWsUrl(e.target.value)}
                placeholder="ws://localhost:11920/command"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <div className="action-button-wrap">
              <button
                  onClick={() => {
                    manualCommandDisconnectRef.current = false;
                    shouldAutoCommandRef.current = true;
                    window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "1");
                    connectCommandWs();
                  }}
                  disabled={!canConnectCommand}
                  className="action-button rounded-xl bg-slate-900 text-white px-4 py-2 text-sm"

                  data-busy={commandBusy ? "1" : "0"}
                  aria-busy={commandBusy}
              >
                {commandBusy ? "Command 接続中..." : "Command WS接続"}
              </button>
              <p className={`button-reason ${canConnectCommand ? "is-ready" : "is-disabled"}`}>
                {commandConnected ? "Command WSはすでに接続中です" : commandBusy ? "Command WS接続処理中です" : "Command WSへ接続できます"}
              </p>
            </div>

            <div className="action-button-wrap">
              <button
                  onClick={disconnectCommandWs}
                  disabled={!canDisconnectCommand}
                  className="action-button rounded-xl bg-slate-100 px-4 py-2 text-sm"

              >
                Command WS切断
              </button>
              <p className={`button-reason ${canDisconnectCommand ? "is-ready" : "is-disabled"}`}>
                {canDisconnectCommand ? "Command WS接続を停止できます" : "Command WSは未接続です"}
              </p>
            </div>

            <div className="action-button-wrap">
              <button
                  onClick={() => sendMouthVowel("a")}
                  disabled={!canRunMouthTest}
                  className="action-button rounded-xl bg-blue-600 text-white px-4 py-2 text-sm"

              >
                口パクテスト（a）
              </button>
              <p className={`button-reason ${canRunMouthTest ? "is-ready" : "is-disabled"}`}>
                {canRunMouthTest ? "即時に口パクテストを送信できます" : "Command WS接続後に実行できます"}
              </p>
            </div>

            <div className="action-button-wrap">
              <button
                  onClick={() => sendArrowMove("left")}
                  disabled={!commandConnected}
                  className="action-button rounded-xl bg-violet-600 text-white px-4 py-2 text-sm"

              >
                ← 左（+10）
              </button>
              <p className={`button-reason ${commandConnected ? "is-ready" : "is-disabled"}`}>
                {commandConnected ? "首を左へ動かせます" : "Command WS未接続のため送信できません"}
              </p>
            </div>

            <div className="action-button-wrap">
              <button
                  onClick={() => sendArrowMove("right")}
                  disabled={!commandConnected}
                  className="action-button rounded-xl bg-violet-600 text-white px-4 py-2 text-sm"

              >
                → 右（-10）
              </button>
              <p className={`button-reason ${commandConnected ? "is-ready" : "is-disabled"}`}>
                {commandConnected ? "首を右へ動かせます" : "Command WS未接続のため送信できません"}
              </p>
            </div>

          </div>

          <div className="text-xs text-slate-600">Command WS: {commandWsStatus}</div>
        </div>

        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">詳細パネル表示</div>
            <div className="text-[11px] text-slate-500">表示/非表示を切り替え</div>
          </div>

          <p className="action-state-hint" role="status" aria-live="polite">
            下の3パネルはチェックで表示/非表示を切り替えできます。
          </p>

          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
              <input type="checkbox" checked={showMicTestPanel} onChange={(e) => setShowMicTestPanel(e.target.checked)} />
              マイクテスト
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
              <input type="checkbox" checked={showMouthPresetPanel} onChange={(e) => setShowMouthPresetPanel(e.target.checked)} />
              口パク手動プリセット
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
              <input type="checkbox" checked={showRawCommandPanel} onChange={(e) => setShowRawCommandPanel(e.target.checked)} />
              任意コマンド送信
            </label>
          </div>
        </div>

        {/* ---- Mic Test Panel ---- */}
        {showMicTestPanel && (
            <div className="rounded-xl border bg-white p-3 space-y-3">
              <div className="text-sm font-semibold">マイクテスト（ローカル再生 + 母音推定 → faceCommand）</div>

              <div className="status-chip-row">
                <span className={`status-chip ${micTestRunning ? "is-on" : "is-off"}`}>Mic Test {micTestRunning ? "RUNNING" : "STOPPED"}</span>
                <span className={`status-chip ${autoMouthEnabled ? "is-on" : "is-off"}`}>Auto Mouth {autoMouthEnabled ? "ON" : "OFF"}</span>
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
                      className="action-button rounded-xl bg-blue-600 text-white px-4 py-2 text-sm"
    
                  >
                    Mic Test Start
                  </button>
                  <p className={`button-reason ${canStartMicTest ? "is-ready" : "is-disabled"}`}>
                    {!hasMic ? "先にマイクを選択してください" : micTestRunning ? "すでに実行中です" : "マイクテストを開始できます"}
                  </p>
                </div>

                <div className="action-button-wrap">
                  <button
                      onClick={stopMicTest}
                      disabled={!canStopMicTest}
                      className="action-button rounded-xl bg-slate-100 px-4 py-2 text-sm"
    
                  >
                    Mic Test Stop
                  </button>
                  <p className={`button-reason ${canStopMicTest ? "is-ready" : "is-disabled"}`}>
                    {canStopMicTest ? "マイクテストを停止できます" : "現在は停止中です"}
                  </p>
                </div>

                <div className="action-button-wrap">
                  <label className="flex items-center gap-2 text-xs text-slate-700 rounded-xl bg-slate-100 px-3 py-2">
                    <input type="checkbox" checked={autoMouthEnabled} onChange={(e) => setAutoMouthEnabled(e.target.checked)} />
                    口パク送信（faceCommand）
                  </label>
                  <p className={`button-reason ${autoMouthEnabled ? "is-ready" : "is-disabled"}`}>
                    {autoMouthEnabled ? "母音推定をfaceCommandとして送信します" : "ONにすると母音推定を送信します"}
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
                  <div className="text-[11px] text-slate-500">{monitorVolume.toFixed(2)}</div>
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
                    <div className="h-3 bg-emerald-500" style={{ width: `${Math.round(micLevel * 100)}%` }} />
                  </div>
                  <div className="text-[11px] text-slate-500">level={micLevel.toFixed(3)}</div>
                </div>
              </div>

              <audio ref={micTestAudioRef} autoPlay controls className="w-full" />
            </div>
        )}

        {/* ---- Mouth Manual Presets ---- */}
        {showMouthPresetPanel && (
            <div className="rounded-xl border bg-white p-3 space-y-2">
              <div className="text-sm font-semibold">口パク手動プリセット（faceCommand）</div>
              <p className="action-state-hint" role="status" aria-live="polite">
                {commandConnected ? "Command WS接続済み: 手動プリセットを送信できます" : "Command WS未接続: 接続すると手動プリセットを送信できます"}
              </p>
              <div className="flex flex-wrap gap-2">
                {(["a", "i", "u", "e", "o", "xn"] as Vowel[]).map((v) => (
                    <button
                        key={v}
                        onClick={() => sendMouthVowel(v)}
                        disabled={!commandConnected}
      
                        className={`action-button rounded-xl px-4 py-2 text-sm hover:opacity-90 ${
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
              <div className="text-sm font-semibold">任意コマンド送信（/command）</div>

              <p className="action-state-hint" role="status" aria-live="polite">
                {commandConnected ? "Command WS接続済み: JSONコマンドを送信できます" : "Command WS未接続: 接続するとJSONコマンドを送信できます"}
              </p>

              <div className="text-xs text-slate-600">
                move_multi でハンド等を試す場合はここから送ってください（口は faceCommand で口パク）。
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
                      className="action-button rounded-xl bg-blue-600 text-white px-4 py-2 text-sm"
    
                  >
                    Send Command
                  </button>
                  <p className={`button-reason ${commandConnected ? "is-ready" : "is-disabled"}`}>
                    {commandConnected ? "現在のJSONを送信できます" : "Command WS接続後に送信できます"}
                  </p>
                </div>

                <div className="action-button-wrap">
                  <button onClick={() => setCommandLog("")} className="action-button rounded-xl bg-slate-100 px-4 py-2 text-sm">
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
      </div>
  );
}

