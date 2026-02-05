"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioCallManager } from "@/lib/webrtc/audioCallManager";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

type MicOption = { deviceId: string; label: string };
type Vowel = "a" | "i" | "u" | "e" | "o" | "xn";

function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * ========= umekita の母音推定（AudioVowelProcessFormant.js）完全移植 =========
 * - LPC -> formant(F1,F2) -> vowel() -> getVowelLabel()
 * - umekita では無音時 v=-1, 発話が止まったら "N" を出していた
 *   → ここでは "N" を "xn"（口閉じ）として扱う
 */
class UmekitaVowelEstimator {
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
      onSpeakStatus: (s: "start" | "stop") => void
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
    if (v >= 0) {
      this.vowelhist.push(v);
    } else {
      this.vowelhist.push(-1);
    }

    const count = this.vowelhist.filter((x) => x >= 0).length;
    const ave = count / this.vowelhist.length;

    let _v = "n";

    if (ave > this.th_isSpeaking) {
      _v = getVowelLabel(v);

      // speaking start/stop
      if (!this.timer_isSpeaking) {
        this.onSpeakStatus("start");
      }

      if (this.timer_isSpeaking) {
        clearTimeout(this.timer_isSpeaking);
        this.timer_isSpeaking = null;
      }

      // 1.5秒無音が続いたら stop 扱い + "N"
      this.timer_isSpeaking = window.setTimeout(() => {
        this.onSpeakStatus("stop");
        this.timer_isSpeaking = null;
        this.onVowel("N"); // umekita の仕様
      }, 1500);

      // 口形状の変化を200msロック（パタつき防止）
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
          d *
          (0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (data.length - 1)))
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

/**
 * ==== 以下、umekita の DSP関数群（そのまま） ====
 */

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
      const d = Math.sqrt(
          (f1 - xm[i]) * (f1 - xm[i]) + (f2 - ym[i]) * (f2 - ym[i])
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
export default function AudioSender() {
  const manager = useMemo(() => new AudioCallManager(), []);

  // ---- WS ----
  const signalWsRef = useRef<WebSocket | null>(null);
  const commandWsRef = useRef<WebSocket | null>(null);

  // WebRTC（Receiverへ送る = callAudioRequest）
  const callIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // UI
  const [signalWsUrl, setSignalWsUrl] = useState<string>(() => {
    // ここは「以前動いていた signaling-server (8080/?room=xxx)」をデフォルトに戻す
    // GUIを別PCへ持っていく時は、signaling-server のIPに変えるだけでOK
    return "ws://localhost:8080/?room=audio1";
  });

  const [receiverEnabled, setReceiverEnabled] = useState(true);
  const [receiverRoom, setReceiverRoom] = useState("audio1");

  const [commandWsUrl, setCommandWsUrl] = useState<string>(
      "ws://localhost:11920/command"
  );

  const [destination, setDestination] = useState<string>("rover003");

  const [mics, setMics] = useState<MicOption[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");

  const [signalWsStatus, setSignalWsStatus] = useState<string>("未接続");
  const [commandWsStatus, setCommandWsStatus] = useState<string>("未接続");
  const [callStatus, setCallStatus] = useState<string>("停止");
  const [error, setError] = useState<string | null>(null);

  // debug logs（折りたたみ）
  const [debugOpen, setDebugOpen] = useState(false);
  const [signalLog, setSignalLog] = useState<string>("");
  const [telecoLog, setTelecoLog] = useState<string>("");

  const clientIdRef = useRef<string>(
      `teleco-gui-master-${Math.random().toString(36).slice(2, 10)}`
  );

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

  // ---- mouth ----
  const lastVowelRef = useRef<Vowel>("xn");
  const lastSendMsRef = useRef<number>(0);
  const [mouthSendFps, setMouthSendFps] = useState<number>(15);

  function appendError(msg: string) {
    setError(msg);
  }

  function logSignal(line: string) {
    setSignalLog((prev) => `${prev}${line}\n`);
  }

  function logTeleco(line: string) {
    setTelecoLog((prev) => `${prev}${line}\n`);
  }

  function sendSignal(obj: unknown) {
    const ws = signalWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(obj);
    ws.send(s);
    if (debugOpen) logSignal(`OUT: ${s}`);
  }

  function sendCommand(obj: unknown) {
    const ws = commandWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendError("Command WS（teleco-main /command）に接続してください。");
      return;
    }
    const s = JSON.stringify(obj);
    ws.send(s);
    if (debugOpen) logTeleco(`OUT: ${s}`);
  }

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

    if (vowel === lastVowelRef.current && now - lastSendMsRef.current < minInterval)
      return;

    lastVowelRef.current = vowel;
    lastSendMsRef.current = now;

    sendCommand({
      label: "faceCommand",
      commandFace: "change_mouth_vowel",
      vowel,
      clientId: clientIdRef.current,
      ts: Date.now(),
    });
  }

  /* =======================
   * デバイス取得
   * ======================= */
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
      if (!selectedMicId && audioInputs.length > 0) {
        setSelectedMicId(audioInputs[0].deviceId);
      }
    } catch (e) {
      console.error(e);
      appendError("デバイス一覧の取得に失敗しました。");
    }
  };

  useEffect(() => {
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
  }, []);

  /* =======================
   * Signal WS（label方式 / room）
   * ======================= */
  const connectSignalWs = () => {
    setError(null);

    // room をUIから変えた場合にURLのroomに反映させる
    // 例: ws://host:8080/?room=audio1
    const url = (() => {
      try {
        const u = new URL(signalWsUrl);
        u.searchParams.set("room", receiverRoom);
        return u.toString();
      } catch {
        // 文字列がURLとして解釈できない場合はそのまま
        return signalWsUrl;
      }
    })();

    if (signalWsRef.current && signalWsRef.current.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(url);
      signalWsRef.current = ws;

      ws.onopen = () => {
        setSignalWsStatus("接続済み");
        if (debugOpen) logSignal(`WS OPEN: ${url}`);
      };

      ws.onclose = () => {
        setSignalWsStatus("切断");
        signalWsRef.current = null;
        if (debugOpen) logSignal("WS CLOSE");
      };

      ws.onerror = () => {
        setSignalWsStatus("エラー");
        appendError("Signal WebSocket 接続でエラーが発生しました。");
        if (debugOpen) logSignal("WS ERROR");
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") text = event.data;
          else if (event.data instanceof ArrayBuffer)
            text = new TextDecoder().decode(event.data);
          else if (event.data instanceof Blob) text = await event.data.text();
          else text = String(event.data);

          if (debugOpen) logSignal(`IN: ${text}`);

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
    signalWsRef.current?.close();
    signalWsRef.current = null;
    setSignalWsStatus("切断");
  };

  /* =======================
   * Command WS（teleco /command）
   * ======================= */
  const connectCommandWs = () => {
    setError(null);

    if (commandWsRef.current && commandWsRef.current.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(commandWsUrl);
      commandWsRef.current = ws;

      ws.onopen = () => {
        setCommandWsStatus("接続済み");
        if (debugOpen) logTeleco(`WS OPEN: ${commandWsUrl}`);
      };
      ws.onclose = () => {
        setCommandWsStatus("切断");
        commandWsRef.current = null;
        if (debugOpen) logTeleco("WS CLOSE");
      };
      ws.onerror = () => {
        setCommandWsStatus("エラー");
        appendError("Command WebSocket 接続でエラーが発生しました。");
        if (debugOpen) logTeleco("WS ERROR");
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") text = event.data;
          else if (event.data instanceof Blob) text = await event.data.text();
          else if (event.data instanceof ArrayBuffer)
            text = new TextDecoder().decode(event.data);
          else text = String(event.data);

          if (debugOpen) logTeleco(`IN: ${text}`);
        } catch {
          if (debugOpen) logTeleco("IN: (failed to decode)");
        }
      };
    } catch (e) {
      console.error(e);
      appendError("Command WebSocket の作成に失敗しました。");
    }
  };

  const disconnectCommandWs = () => {
    commandWsRef.current?.close();
    commandWsRef.current = null;
    setCommandWsStatus("切断");
  };

  /* =======================
   * Receiverへ音声送信（label方式で統一）
   * - AudioReceiver(client.html)が受けるのは callAudioRequest/callAudioAnswer の世界
   * - なのでここも AudioCallManager.callAudioRequest を使う（＝確実に刺さる）
   * ======================= */
  const startSending = async () => {
    setError(null);

    if (!receiverEnabled) {
      appendError("Receiver送信が無効になっています（チェックをONにしてください）。");
      return;
    }

    const signalWs = signalWsRef.current;
    if (!signalWs || signalWs.readyState !== WebSocket.OPEN) {
      appendError("先に Signal WebSocket（room）に接続してください。");
      return;
    }

    if (!selectedMicId) {
      appendError("マイクを選択してください。");
      return;
    }

    stopSending();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedMicId } },
        video: false,
      });

      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) {
        appendError("音声トラックを取得できませんでした。");
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }

      setCallStatus("offer送信中");

      const sendFn = (msg: SignalingMessage) => sendSignal(msg);
      const callId = await manager.callAudioRequest(
          track,
          destination,
          sendFn,
          (state) => setCallStatus(`WebRTC: ${state}`)
      );

      callIdRef.current = callId;
    } catch (e) {
      console.error(e);
      appendError("マイク取得または WebRTC 開始に失敗しました。");
    }
  };

  const stopSending = () => {
    const callId = callIdRef.current;
    if (callId) {
      manager.closeCall(callId);
      callIdRef.current = null;
    }

    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setCallStatus("停止");
  };

  /* =======================
   * Mic Test（ローカル再生 + umekita母音推定 -> faceCommand）
   * ======================= */
  const [micTestRunning, setMicTestRunning] = useState(false);
  const [micLevel, setMicLevel] = useState<number>(0);

  const [autoMouthEnabled, setAutoMouthEnabled] = useState(true);
  const [monitorVolume, setMonitorVolume] = useState<number>(0.2);

  const [noiseFloor, setNoiseFloor] = useState<number>(0.02);
  const [gain, setGain] = useState<number>(20);

  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestAudioRef = useRef<HTMLAudioElement | null>(null);
  const micTestCtxRef = useRef<AudioContext | null>(null);
  const micTestSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micTestProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micTestZeroGainRef = useRef<GainNode | null>(null);

  const umekitaEstimatorRef = useRef<UmekitaVowelEstimator | null>(null);

  function stopMicTest() {
    if (micTestProcessorRef.current) {
      try {
        micTestProcessorRef.current.disconnect();
      } catch {}
      micTestProcessorRef.current.onaudioprocess = null;
      micTestProcessorRef.current = null;
    }
    if (micTestSourceRef.current) {
      try {
        micTestSourceRef.current.disconnect();
      } catch {}
      micTestSourceRef.current = null;
    }
    if (micTestZeroGainRef.current) {
      try {
        micTestZeroGainRef.current.disconnect();
      } catch {}
      micTestZeroGainRef.current = null;
    }

    if (micTestCtxRef.current) {
      try {
        void micTestCtxRef.current.close();
      } catch {}
      micTestCtxRef.current = null;
    }

    if (micTestStreamRef.current) {
      micTestStreamRef.current.getTracks().forEach((t) => t.stop());
      micTestStreamRef.current = null;
    }

    if (micTestAudioRef.current) {
      micTestAudioRef.current.srcObject = null;
    }

    umekitaEstimatorRef.current = null;

    setMicTestRunning(false);
    setMicLevel(0);

    if (autoMouthEnabled) sendMouthVowel("xn");
  }

  async function startMicTest() {
    setError(null);

    if (!selectedMicId) {
      appendError("マイクを選択してください。");
      return;
    }

    if (autoMouthEnabled) {
      const ws = commandWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendError("口パク確認のために Command WS（teleco-main /command）へ接続してください。");
        return;
      }
    }

    stopMicTest();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedMicId } },
        video: false,
      });
      micTestStreamRef.current = stream;

      if (micTestAudioRef.current) {
        micTestAudioRef.current.srcObject = stream;
        micTestAudioRef.current.volume = clamp01(monitorVolume);
        await micTestAudioRef.current.play();
      }

      const AudioContextCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;

      if (!AudioContextCtor) {
        appendError("AudioContext が利用できません（ブラウザ非対応）。");
        setMicTestRunning(true);
        return;
      }

      const ctx = new AudioContextCtor();
      micTestCtxRef.current = ctx;

      const src = ctx.createMediaStreamSource(stream);
      micTestSourceRef.current = src;

      const processor = ctx.createScriptProcessor(1024, 1, 1);
      micTestProcessorRef.current = processor;

      const zero = ctx.createGain();
      zero.gain.value = 0;
      micTestZeroGainRef.current = zero;

      src.connect(processor);
      processor.connect(zero);
      zero.connect(ctx.destination);

      const est = new UmekitaVowelEstimator();
      est.bufferSize = 1024;
      est.setSampleRate(ctx.sampleRate);
      est.setCallbacks(
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
          (_s) => {}
      );
      umekitaEstimatorRef.current = est;

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          const x = input[i];
          sum += x * x;
        }
        const rms = Math.sqrt(sum / input.length);
        const level = clamp01((rms - noiseFloor) * gain);
        setMicLevel(level);

        const estimator = umekitaEstimatorRef.current;
        if (estimator) {
          estimator.analyzeData(input);
        }
      };

      setMicTestRunning(true);
    } catch (e) {
      console.error(e);
      appendError("マイクテスト開始に失敗しました。");
    }
  }

  /* =======================
   * cleanup
   * ======================= */
  useEffect(() => {
    return () => {
      stopMicTest();
      stopSending();
      disconnectSignalWs();
      disconnectCommandWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =======================
   * UI
   * ======================= */
  return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Audio Sender（GUI）</h2>

          <button
              onClick={() => setDebugOpen((v) => !v)}
              className="rounded-xl bg-slate-200 px-4 py-2 text-sm hover:bg-slate-300"
          >
            デバッグ {debugOpen ? "閉じる" : "開く"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* ---- Receiver（別PCへ送信）---- */}
        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="font-semibold">音声送信（GUI → 別PC Receiver）</div>

          <label className="flex items-center gap-2 text-sm">
            <input
                type="checkbox"
                checked={receiverEnabled}
                onChange={(e) => setReceiverEnabled(e.target.checked)}
            />
            Receiverへ送信を有効化
          </label>

          <label className="text-sm text-slate-700">
            Signal WS（label方式 / room）
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={signalWsUrl}
                onChange={(e) => setSignalWsUrl(e.target.value)}
                placeholder="ws://<signaling-host>:8080/?room=audio1"
            />
          </label>

          <label className="text-sm text-slate-700">
            Room
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={receiverRoom}
                onChange={(e) => setReceiverRoom(e.target.value)}
                placeholder="audio1"
            />
          </label>

          <label className="text-sm text-slate-700">
            Destination（AudioReceiver側のID）
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="rover003"
            />
          </label>

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

          <div className="flex flex-wrap gap-2 pt-1">
            <button
                onClick={refreshDevices}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
              デバイス更新
            </button>

            <button
                onClick={connectSignalWs}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700"
            >
              Signal WS接続
            </button>

            <button
                onClick={disconnectSignalWs}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
              Signal WS切断
            </button>

            <button
                disabled={!receiverEnabled}
                onClick={startSending}
                className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              Receiver送信開始
            </button>

            <button
                onClick={stopSending}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
              送信停止
            </button>
          </div>

          <div className="text-xs text-slate-600 space-y-1">
            <div>Signal WS: {signalWsStatus}</div>
            <div>Audio Send: {callStatus}</div>
          </div>
        </div>

        {/* ---- teleco command ---- */}
        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="font-semibold">teleco コマンド送信（/command）</div>

          <label className="text-sm text-slate-700">
            Command WS（teleco-main /command）
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={commandWsUrl}
                onChange={(e) => setCommandWsUrl(e.target.value)}
                placeholder="ws://<teleco-host>:11920/command"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
                onClick={connectCommandWs}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700"
            >
              Command WS 接続
            </button>

            <button
                onClick={disconnectCommandWs}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
              Command WS 切断
            </button>

            <button
                onClick={() =>
                    sendCommand({
                      label: "faceCommand",
                      commandFace: "change_mouth_vowel",
                      vowel: "a",
                    })
                }
                className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700"
            >
              口パクテスト（a）
            </button>
          </div>

          <div className="text-xs text-slate-600">
            状態: {commandWsStatus}
          </div>
        </div>

        {/* ---- Mic Test Panel ---- */}
        <div className="rounded-xl border bg-white p-3 space-y-3">
          <div className="text-sm font-semibold">
            マイクテスト（ローカル再生 + umekita母音推定 → faceCommand）
          </div>

          <div className="text-xs text-slate-600">
            umekita の LPC/フォルマント推定を完全移植し、{" "}
            <code>change_mouth_vowel</code> を自動送信します（無音は{" "}
            <code>xn</code>）
          </div>

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
              <input
                  type="checkbox"
                  checked={autoMouthEnabled}
                  onChange={(e) => setAutoMouthEnabled(e.target.checked)}
              />
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

        {/* ---- Mouth Manual Presets ---- */}
        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold">
            口パク手動プリセット（faceCommand）
          </div>
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
            move_multi でハンド等を試す場合はここから送ってください（口は faceCommand）。
          </div>

          <textarea
              className="w-full rounded-xl border px-3 py-2 text-xs font-mono bg-slate-50"
              rows={10}
              value={commandJson}
              onChange={(e) => setCommandJson(e.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <button
                onClick={sendRawCommandJson}
                className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700"
            >
              Send Command
            </button>

            <button
                onClick={() => {
                  setTelecoLog("");
                  setSignalLog("");
                }}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
              Clear Debug Log
            </button>
          </div>
        </div>

        {/* ---- Debug Panel ---- */}
        {debugOpen && (
            <div className="rounded-xl border bg-white p-3 space-y-3">
              <div className="text-sm font-semibold">デバッグログ</div>

              <div className="text-xs text-slate-600 space-y-1">
                <div>Signal WS: {signalWsStatus}</div>
                <div>Command WS: {commandWsStatus}</div>
                <div>Audio Send: {callStatus}</div>
                <div>Last Vowel: {lastVowelRef.current}</div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold">Signal WS Log</div>
                  <pre className="w-full rounded-xl border bg-slate-50 p-2 text-[11px] overflow-auto max-h-56">
{signalLog || "(no signal logs)"}
              </pre>
                </div>
                <div>
                  <div className="text-xs font-semibold">teleco /command Log</div>
                  <pre className="w-full rounded-xl border bg-slate-50 p-2 text-[11px] overflow-auto max-h-56">
{telecoLog || "(no teleco logs)"}
              </pre>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}
