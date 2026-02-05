"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioCallManager } from "@/lib/webrtc/audioCallManager";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

type MicOption = { deviceId: string; label: string };

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
  // 2) ロボ制御コマンド用（teleco-main /command）
  const commandWsRef = useRef<WebSocket | null>(null);

  // WebRTC通話状態
  const callIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Lipsync（RMS）用
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSendMsRef = useRef<number>(0);

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

  // ---- 口パク設定----
  //  joints: [2, 4, 13] を使っているのでそれに寄せる
  // 2,4: 口角（左右逆符号）
  // 13: jaw（開閉）
  const MOUTH_JOINTS = [2, 4, 13] as const;

  const [lipsyncEnabled, setLipsyncEnabled] = useState<boolean>(true);
  const [sendFps, setSendFps] = useState<number>(30);

  // 無音時の床とゲイン（環境に合わせて調整）
  const [noiseFloor, setNoiseFloor] = useState<number>(0.02);
  const [gain, setGain] = useState<number>(20);

  // 角度スケールは「度」前提（40, -40, 20 など）
  const [jawMaxDeg, setJawMaxDeg] = useState<number>(25); // joint 13: 0..25（o=25のイメージ）
  const [sideMaxDeg, setSideMaxDeg] = useState<number>(40); // joint 2/4: 0..40

  // 送信speed
  const [speedSide, setSpeedSide] = useState<number>(50);
  const [speedJaw, setSpeedJaw] = useState<number>(20);

  // ---- Command WS テスト送信用 ----
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

  function logCommand(line: string) {
    setCommandLog((prev) => `${prev}${line}\n`);
  }

  function sendRawCommandJson() {
    setError(null);

    const ws = commandWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendError("Command WS（11920/command）に接続してください。");
      return;
    }

    try {
      const obj = JSON.parse(commandJson);
      ws.send(JSON.stringify(obj));
      logCommand(`OUT: ${JSON.stringify(obj)}`);
    } catch (e) {
      appendError("JSONのパースに失敗しました。JSONとして正しい形式か確認してください。");
    }
  }


  const clientIdRef = useRef<string>(
      `teleco-gui-master-${Math.random().toString(36).slice(2, 10)}`
  );

  const appendError = (msg: string) => setError(msg);

  // マイク一覧を更新（権限未許可だと label が空のことがあります）
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

  // 初回：権限要求→デバイス列挙
  useEffect(() => {
    const init = async () => {
      try {
        // enumerateDevices の label を得るために先に権限を取る
        const tmp = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        tmp.getTracks().forEach((t) => t.stop());
      } catch {
        // 権限がなくても列挙自体は可能な場合がある
      }
      await refreshDevices();
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sendSignal(obj: unknown) {
    const ws = signalWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function sendCommand(obj: unknown) {
    const ws = commandWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

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

      // teleco-main /command は色々返す可能性があるが、ここでは必須ではない
      ws.onmessage = () => {
        // 必要ならデバッグログに回す
        // console.log("command ws in:", event.data);
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

  // ---- Lipsync loop ----
  function stopLipsyncLoop() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;

    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
  }

  function startLipsyncLoop(stream: MediaStream) {
    stopLipsyncLoop();
    if (!lipsyncEnabled) return;

    const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      appendError("AudioContext が利用できません（ブラウザ非対応）。");
      return;
    }

    const ctx = new AudioContextCtor();
    audioCtxRef.current = ctx;

    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    analyserRef.current = analyser;

    const buf = new Float32Array(analyser.fftSize);

    const loop = () => {
      const a = analyserRef.current;
      if (!a) return;

      a.getFloatTimeDomainData(buf);

      // RMS
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);

      // 正規化（無音床を引いてゲインを掛ける）
      const level = clamp01((rms - noiseFloor) * gain);

      // 送信レート制限
      const now = performance.now();
      const intervalMs = 1000 / Math.max(1, sendFps);
      if (now - lastSendMsRef.current >= intervalMs) {
        lastSendMsRef.current = now;

        // umekitagui互換の簡易マッピング（Phase1）
        // level 0..1 → jaw 0..jawMaxDeg, side 0..sideMaxDeg（2と4は逆符号）
        const jaw = level * jawMaxDeg;
        const side = level * sideMaxDeg;

        sendCommand({
          label: "move_multi",
          joints: [...MOUTH_JOINTS],
          angles: [side, -side, jaw],
          speeds: [speedSide, speedSide, speedJaw],
          dontsendback: true,
          clientId: clientIdRef.current,
          ts: Date.now(),
        });
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }

  // ---- WebRTC Start/Stop ----
  const startSending = async () => {
    setError(null);

    const signalWs = signalWsRef.current;
    if (!signalWs || signalWs.readyState !== WebSocket.OPEN) {
      appendError("先に Signal WebSocket（8080/room）に接続してください。");
      return;
    }

    const commandWs = commandWsRef.current;
    if (!commandWs || commandWs.readyState !== WebSocket.OPEN) {
      appendError("先に Command WebSocket（11920/command）に接続してください。");
      return;
    }

    if (!selectedMicId) {
      appendError("マイクを選択してください。");
      return;
    }

    // 既存があれば止める
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

      // 口パク送信（RMS→move_multi）開始
      startLipsyncLoop(stream);

      setCallStatus("offer送信中");

      // WebRTCシグナリングは signalWs に送る
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

    stopLipsyncLoop();
    setCallStatus("停止");
  };

  // cleanup
  useEffect(() => {
    return () => {
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

          {/* Lipsync settings */}
          <div className="rounded-xl border bg-slate-50 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                  id="lipsync"
                  type="checkbox"
                  checked={lipsyncEnabled}
                  onChange={(e) => setLipsyncEnabled(e.target.checked)}
              />
              <label htmlFor="lipsync" className="text-sm text-slate-700">
                口パク（RMS→move_multi）を送信する（umekita互換: joints 2,4,13）
              </label>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <label className="text-xs text-slate-700">
                Jaw Max（deg, joint 13）
                <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                    type="number"
                    step="1"
                    value={jawMaxDeg}
                    onChange={(e) => setJawMaxDeg(Number(e.target.value))}
                />
              </label>

              <label className="text-xs text-slate-700">
                Side Max（deg, joints 2/4）
                <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                    type="number"
                    step="1"
                    value={sideMaxDeg}
                    onChange={(e) => setSideMaxDeg(Number(e.target.value))}
                />
              </label>

              <label className="text-xs text-slate-700">
                Send FPS
                <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                    type="number"
                    value={sendFps}
                    onChange={(e) => setSendFps(Number(e.target.value))}
                />
              </label>

              <label className="text-xs text-slate-700">
                Noise Floor（無音床）
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
                Speed Side（2/4）
                <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                    type="number"
                    step="1"
                    value={speedSide}
                    onChange={(e) => setSpeedSide(Number(e.target.value))}
                />
              </label>

              <label className="text-xs text-slate-700">
                Speed Jaw（13）
                <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                    type="number"
                    step="1"
                    value={speedJaw}
                    onChange={(e) => setSpeedJaw(Number(e.target.value))}
                />
              </label>

              <div className="text-xs text-slate-500 flex items-end">
                clientId: {clientIdRef.current}
              </div>
            </div>
          </div>

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
              WebRTC送信開始
            </button>

            <button
                onClick={stopSending}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
              停止
            </button>
          </div>
        </div>

        {/* ---- Command WS Test Panel ---- */}
        <div className="rounded-xl border bg-white p-3 space-y-2">
          <div className="text-sm font-semibold">Command WS テスト送信</div>

          <div className="text-xs text-slate-600">
            ここに任意のJSONを入れて <code>/command</code> に送信できます（接続確認用）。
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


        <div className="text-xs text-slate-600 space-y-1">
          <div>Signal WS: {signalWsStatus}</div>
          <div>Command WS: {commandWsStatus}</div>
          <div>Audio Send: {callStatus}</div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
  );
}
