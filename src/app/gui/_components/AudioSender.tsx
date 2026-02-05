"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
};

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

    // room が無ければ付ける
    if (!u.searchParams.get("room")) {
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
  const [roomHint, setRoomHint] = useState<string>("audio1");

  const [signalWsUrl, setSignalWsUrl] = useState<string>(() => {
    if (typeof window === "undefined") return "ws://localhost:3000/ws?room=audio1";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    // ★統合シグナリング：Nextサーバと同じhost/portの /ws
    return `${proto}://${window.location.host}/ws?room=audio1`;
  });

  const [receiverDestination, setReceiverDestination] = useState<string>("rover003");

  const [commandWsUrl, setCommandWsUrl] = useState<string>("ws://localhost:11920/command");
  const [telecoDebugUrl, setTelecoDebugUrl] = useState<string>("http://localhost:11920/");

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
    const angle = direction === "left" ? 10 : -10;
    sendCommand({
      label: "move_multi",
      joints: [10],
      angles: [angle],
      speeds: [1],
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

    const normalized = normalizeSignalingWsUrl(signalWsUrl, roomHint);
    setSignalWsUrl(normalized);

    if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
      appendError("Signal WS URL は ws:// または wss:// で始まる必要があります。");
      return;
    }
    if (!normalized.includes("/ws")) {
      // normalizeで直るはずだが念のため
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

          <div className="flex flex-wrap gap-2">
            <button onClick={refreshDevices} className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200">
              デバイス更新
            </button>

            <button
                onClick={() => {
                  manualSignalDisconnectRef.current = false;
                  shouldAutoSignalRef.current = true;
                  window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "1");
                  connectSignalWs();
                }}
                disabled={signalWsStatus === "接続済み"}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              Signal WS接続
            </button>

            <button
                onClick={disconnectSignalWs}
                disabled={signalWsStatus !== "接続済み"}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
            >
              Signal WS切断
            </button>

            <button
                onClick={startSending}
                className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm hover:bg-emerald-700"
            >
              Receiver送信開始
            </button>

            <button onClick={stopSending} className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200">
              送信停止
            </button>
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

          <label className="text-sm text-slate-700">
            Command WS（teleco-main /command）
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={commandWsUrl}
                onChange={(e) => setCommandWsUrl(e.target.value)}
                placeholder="ws://localhost:11920/command"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
                onClick={() => {
                  manualCommandDisconnectRef.current = false;
                  shouldAutoCommandRef.current = true;
                  window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "1");
                  connectCommandWs();
                }}
                disabled={commandWsStatus === "接続済み"}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              Command WS接続
            </button>

            <button
                onClick={disconnectCommandWs}
                disabled={commandWsStatus !== "接続済み"}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
            >
              Command WS切断
            </button>

            <button
                onClick={() => sendMouthVowel("a")}
                className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700"
            >
              口パクテスト（a）
            </button>

            <button
                onClick={() => sendArrowMove("left")}
                disabled={!commandConnected}
                className="rounded-xl bg-violet-600 text-white px-4 py-2 text-sm hover:bg-violet-700 disabled:opacity-50"
            >
              ← 左（+10）
            </button>

            <button
                onClick={() => sendArrowMove("right")}
                disabled={!commandConnected}
                className="rounded-xl bg-violet-600 text-white px-4 py-2 text-sm hover:bg-violet-700 disabled:opacity-50"
            >
              → 右（-10）
            </button>

          </div>

          <div className="text-xs text-slate-600">Command WS: {commandWsStatus}</div>
        </div>

        {/* ---- Mic Test Panel ---- */}
        <div className="rounded-xl border bg-white p-3 space-y-3">
          <div className="text-sm font-semibold">マイクテスト（ローカル再生 + 母音推定 → faceCommand）</div>

          <div className="flex flex-wrap gap-2 items-center">
            <button
                onClick={startMicTest}
                disabled={micTestRunning}
                className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Mic Test Start
            </button>
            <button
                onClick={stopMicTest}
                disabled={!micTestRunning}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
            >
              Mic Test Stop
            </button>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={autoMouthEnabled} onChange={(e) => setAutoMouthEnabled(e.target.checked)} />
              口パク送信（faceCommand）
            </label>
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

        {/* ---- Mouth Manual Presets ---- */}
        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold">口パク手動プリセット（faceCommand）</div>
          <div className="flex flex-wrap gap-2">
            {(["a", "i", "u", "e", "o", "xn"] as Vowel[]).map((v) => (
                <button
                    key={v}
                    onClick={() => sendMouthVowel(v)}
                    className={`rounded-xl px-4 py-2 text-sm hover:opacity-90 ${
                        v === "xn" ? "bg-slate-100" : "bg-slate-900 text-white"
                    }`}
                >
                  {v === "xn" ? "close(xn)" : v}
                </button>
            ))}
          </div>
        </div>

        {/* ---- Command WS Test Panel ---- */}
        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold">任意コマンド送信（/command）</div>

          <div className="text-xs text-slate-600">
            move_multi でハンド等を試す場合はここから送ってください（口は faceCommand で口パク）。
          </div>

          <textarea
              className="w-full rounded-xl border px-3 py-2 text-xs font-mono bg-slate-50"
              rows={10}
              value={commandJson}
              onChange={(e) => setCommandJson(e.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <button onClick={sendRawCommandJson} className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700">
              Send Command
            </button>

            <button onClick={() => setCommandLog("")} className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200">
              Clear Log
            </button>
          </div>

          <pre className="w-full rounded-xl border bg-slate-50 p-2 text-[11px] overflow-auto max-h-48">
{commandLog || "(no logs)"}
        </pre>
        </div>
      </div>
  );
}
