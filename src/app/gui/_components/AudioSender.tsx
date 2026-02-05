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

export default function AudioSender() {
  const manager = useMemo(() => new AudioCallManager(), []);

  // ---- WS (分離) ----
  // 1) WebRTCシグナリング用（roomサーバ）
  const signalWsRef = useRef<WebSocket | null>(null);
  // 2) teleco-main /command 用（faceCommand / move_multi 等）
  const commandWsRef = useRef<WebSocket | null>(null);

  // WebRTC通話状態
  const callIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // --- UI state ---
  const [signalWsUrl, setSignalWsUrl] = useState<string>(
      "ws://localhost:8080/?room=test"
  );
  const [commandWsUrl, setCommandWsUrl] = useState<string>(
      "ws://localhost:11920/command"
  );

  // WebRTCのdestination（teleco側のシグナリング仕様に合わせる）
  const [destination, setDestination] = useState<string>("rover003");

  const [mics, setMics] = useState<MicOption[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");

  const [signalWsStatus, setSignalWsStatus] = useState<string>("未接続");
  const [commandWsStatus, setCommandWsStatus] = useState<string>("未接続");
  const [callStatus, setCallStatus] = useState<string>("停止");
  const [error, setError] = useState<string | null>(null);

  const clientIdRef = useRef<string>(
      `teleco-gui-master-${Math.random().toString(36).slice(2, 10)}`
  );

  // ---- 任意コマンド送信（接続確認/ハンド検証用）----
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

  // ---- 口パク（ディスプレイ） ----
  const lastVowelRef = useRef<Vowel>("xn");
  const lastVowelSendMsRef = useRef<number>(0);

  // ---- マイクテスト（ローカルモニタ + 口パク確認） ----
  const [micTestRunning, setMicTestRunning] = useState(false);
  const [micLevel, setMicLevel] = useState<number>(0); // 0..1
  const [autoMouthEnabled, setAutoMouthEnabled] = useState(true);

  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestAudioRef = useRef<HTMLAudioElement | null>(null);
  const micTestCtxRef = useRef<AudioContext | null>(null);
  const micTestAnalyserRef = useRef<AnalyserNode | null>(null);
  const micTestRafRef = useRef<number | null>(null);

  // 口パク切り替え頻度（送りすぎ防止）
  const [mouthSendFps, setMouthSendFps] = useState<number>(15);
  // 無音床/ゲイン（マイク環境で調整）
  const [noiseFloor, setNoiseFloor] = useState<number>(0.02);
  const [gain, setGain] = useState<number>(20);

  // ハウリング防止（ローカル再生の音量）
  const [monitorVolume, setMonitorVolume] = useState<number>(0.2);

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

  function sendCommand(obj: unknown) {
    const ws = commandWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendError("Command WS（teleco-main /command）に接続してください。");
      return;
    }
    ws.send(JSON.stringify(obj));
    logCommand(`OUT: ${JSON.stringify(obj)}`);
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

  // ---- 口パク（ディスプレイ）: faceCommand/change_mouth_vowel ----
  function sendMouthVowel(vowel: Vowel) {
    // 送りすぎ制御（vowelが変わったときだけ送る＋上限fps）
    const now = performance.now();
    const minInterval = 1000 / Math.max(1, mouthSendFps);

    if (vowel === lastVowelRef.current && now - lastVowelSendMsRef.current < minInterval) {
      return;
    }

    lastVowelRef.current = vowel;
    lastVowelSendMsRef.current = now;

    sendCommand({
      label: "faceCommand",
      commandFace: "change_mouth_vowel",
      vowel,
      clientId: clientIdRef.current,
      ts: Date.now(),
    });
  }

  // ---- 超簡易「音量→母音」マッピング（まず動作確認用）----
  // ※正確な母音推定は次段階。ここでは口が動くことを確認する目的。
  function levelToVowel(level01: number): Vowel {
    // 0..1 の音量レベルを段階に分ける
    if (level01 < 0.08) return "xn"; // 無音
    if (level01 < 0.18) return "i";
    if (level01 < 0.30) return "e";
    if (level01 < 0.45) return "u";
    if (level01 < 0.65) return "a";
    return "o";
  }

  // ---- マイク一覧を更新 ----
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

  // ---- Connect / Disconnect (signal WS) ----
  const connectSignalWs = () => {
    setError(null);

    if (signalWsRef.current && signalWsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(signalWsUrl);
      signalWsRef.current = ws;

      ws.onopen = () => setSignalWsStatus("接続済み");
      ws.onclose = () => setSignalWsStatus("切断");
      ws.onerror = () => {
        setSignalWsStatus("エラー");
        appendError("Signal WebSocket 接続でエラーが発生しました。");
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;

          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(event.data);
          } else if (event.data instanceof Blob) {
            text = await event.data.text();
          } else {
            text = String(event.data);
          }

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

  // ---- Connect / Disconnect (command WS) ----
  const connectCommandWs = () => {
    setError(null);

    if (commandWsRef.current && commandWsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(commandWsUrl);
      commandWsRef.current = ws;

      ws.onopen = () => setCommandWsStatus("接続済み");
      ws.onclose = () => setCommandWsStatus("切断");
      ws.onerror = () => {
        setCommandWsStatus("エラー");
        appendError("Command WebSocket 接続でエラーが発生しました。");
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;

          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof Blob) {
            text = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(event.data);
          } else {
            text = String(event.data);
          }
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
    commandWsRef.current?.close();
    commandWsRef.current = null;
    setCommandWsStatus("切断");
  };

  // ---- WebRTC Start/Stop（音声送信）----
  const startSending = async () => {
    setError(null);

    const signalWs = signalWsRef.current;
    if (!signalWs || signalWs.readyState !== WebSocket.OPEN) {
      appendError("先に Signal WebSocket（8080/room）に接続してください。");
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

  // ---- マイクテスト Start/Stop（ローカルモニタ + 口パク確認）----
  function stopMicTest() {
    if (micTestRafRef.current) {
      cancelAnimationFrame(micTestRafRef.current);
      micTestRafRef.current = null;
    }

    micTestAnalyserRef.current = null;

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

    setMicTestRunning(false);
    setMicLevel(0);

    // 口を閉じる
    if (autoMouthEnabled) sendMouthVowel("xn");
  }

  async function startMicTest() {
    setError(null);

    if (!selectedMicId) {
      appendError("マイクを選択してください。");
      return;
    }

    // 口パク確認するなら command WS 必須
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

      // ローカル再生（自分で確認）
      if (micTestAudioRef.current) {
        micTestAudioRef.current.srcObject = stream;
        micTestAudioRef.current.volume = clamp01(monitorVolume);
        await micTestAudioRef.current.play();
      }

      // 音量解析
      const AudioContextCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) {
        appendError("AudioContext が利用できません（ブラウザ非対応）。");
        setMicTestRunning(true);
        return;
      }

      const ctx = new AudioContextCtor();
      micTestCtxRef.current = ctx;

      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);
      micTestAnalyserRef.current = analyser;

      const buf = new Float32Array(analyser.fftSize);

      const loop = () => {
        const a = micTestAnalyserRef.current;
        if (!a) return;

        a.getFloatTimeDomainData(buf);

        // RMS
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);

        const level = clamp01((rms - noiseFloor) * gain);
        setMicLevel(level);

        // 口パク（超簡易：音量→母音切替）
        if (autoMouthEnabled) {
          const vowel = levelToVowel(level);
          sendMouthVowel(vowel);
        }

        micTestRafRef.current = requestAnimationFrame(loop);
      };

      micTestRafRef.current = requestAnimationFrame(loop);
      setMicTestRunning(true);
    } catch (e) {
      console.error(e);
      appendError("マイクテスト開始に失敗しました。");
    }
  }

  useEffect(() => {
    return () => {
      stopMicTest();
      stopSending();
      disconnectSignalWs();
      disconnectCommandWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
      <div className="space-y-4">
        <div className="grid gap-3">
          <label className="text-sm text-slate-700">
            Signal WS（WebRTCシグナリング / room）
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={signalWsUrl}
                onChange={(e) => setSignalWsUrl(e.target.value)}
                placeholder="ws://localhost:8080/?room=test"
            />
          </label>

          <label className="text-sm text-slate-700">
            Command WS（teleco-main /command）
            <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={commandWsUrl}
                onChange={(e) => setCommandWsUrl(e.target.value)}
                placeholder="ws://localhost:11920/command"
            />
          </label>

          <label className="text-sm text-slate-700">
            Destination（WebRTC用）
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
                onClick={connectCommandWs}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700"
            >
              Command WS接続
            </button>

            <button
                onClick={startSending}
                className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm hover:bg-emerald-700"
            >
              WebRTC送信開始（音声）
            </button>

            <button
                onClick={stopSending}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
              WebRTC停止
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-600 space-y-1">
          <div>Signal WS: {signalWsStatus}</div>
          <div>Command WS: {commandWsStatus}</div>
          <div>Audio Send: {callStatus}</div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* ---- Mic Test Panel ---- */}
        <div className="rounded-xl border bg-white p-3 space-y-3">
          <div className="text-sm font-semibold">マイクテスト（ローカル再生 + 口パク確認）</div>

          <div className="text-xs text-slate-600">
            自分のマイク入力をこのブラウザで再生して確認します（イヤホン推奨）。<br />
            口パクは <code>faceCommand/change_mouth_vowel</code> を送って確認します。
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
              口パク確認を有効（WSで vowel 送信）
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
              Noise Floor
              <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                  type="number"
                  step="0.001"
                  value={noiseFloor}
                  onChange={(e) => setNoiseFloor(Number(e.target.value))}
              />
            </label>

            <label className="text-xs text-slate-700">
              Gain
              <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                  type="number"
                  step="1"
                  value={gain}
                  onChange={(e) => setGain(Number(e.target.value))}
              />
            </label>

            <label className="text-xs text-slate-700">
              Mouth Send FPS
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
                level={micLevel.toFixed(3)} / lastVowel={lastVowelRef.current}
              </div>
            </div>
          </div>

          {/* ローカル再生用 audio */}
          <audio ref={micTestAudioRef} autoPlay controls className="w-full" />
        </div>

        {/* ---- Mouth Manual Presets (optional) ---- */}
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
            move_multi でハンド等を試す場合はここから送ってください（口は faceCommand で確認）。
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
                onClick={() => setCommandLog("")}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
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
