"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_AUDIO_ROOM,
  HAS_DEFAULT_AUDIO_ROOM_ENV,
  DEFAULT_SIGNALING_IP_ADDRESS,
  DEFAULT_SIGNALING_PORT,
  DEFAULT_TELECO_IP_ADDRESS,
  DEFAULT_TELECO_PORT,
  STORAGE_KEYS,
  TELECO_ARROW_EVENT,
} from "@/app/gui/components/audio/sender/controller/constants";
import {
  bindRecoveryListeners,
  parseHostPortFromUrl,
} from "@/app/gui/components/audio/sender/controller/helpers";
import { useMouthAnalyzer } from "@/app/gui/components/audio/sender/controller/useMouthAnalyzer";
import { useSharedAudioStream } from "@/app/gui/components/audio/sender/controller/useSharedAudioStream";
import { useDeviceSignalController } from "@/app/gui/components/audio/sender/useDeviceSignalController";
import { useMicAnalyzerController } from "@/app/gui/components/audio/sender/useMicAnalyzerController";
import { useTelecoCommandController } from "@/app/gui/components/teleco/useTelecoCommandController";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import { buildSignalingUrl, parseSignalingUrl } from "@/lib/signaling";
import { AudioCallManager } from "@/lib/webrtc/audioCallManager";
import type {
  MicOption,
  TelecoArrowDirection,
  Vowel,
} from "@/app/gui/components/audio/sender/controller/types";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

/**
 * =================== コンポーネント ===================
 */
export type AudioSenderPanelMode = "all" | "device" | "teleco";

export function useAudioSenderController({
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
  const {
    usingForWebrtcRef,
    usingForMicTestRef,
    ensureSharedStream,
    stopSharedStreamIfUnused,
  } = useSharedAudioStream(selectedMicId);

  const [signalWsStatus, setSignalWsStatus] = useState<string>("未接続");
  const [commandWsStatus, setCommandWsStatus] = useState<string>("未接続");
  const [callStatus, setCallStatus] = useState<string>("停止");
  const [error, setError] = useState<string | null>(null);

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
    const angle = direction === "left" ? -13 : 13;
    sendCommand({
      label: "move_multi",
      joints: [8],
      angles: [angle],
      speeds: [30],
      dontsendback: true,
    });
  }

  function sendInitializePose() {
    sendCommand({
      label: "move_multi",
      joints: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      angles: [0, 0, -90, 7, -90, -7, 0, 0, 0, 0, 0, 0, 0],
      speeds: [100, 100, 100, 100, 100, 100, 100, 100, 100, 1, 1, 1, 1],
      dontsendback: true,
    });
  }

  const [autoMouthEnabled, setAutoMouthEnabled] = useState(true);
  const [monitorVolume, setMonitorVolume] = useState<number>(0.2);

  const [showMouthPresetPanel, setShowMouthPresetPanel] = useState(false);
  const [showRawCommandPanel, setShowRawCommandPanel] = useState(false);

  // レベルメータ用（RMS）
  const [noiseFloor, setNoiseFloor] = useState<number>(0.02);
  const [gain, setGain] = useState<number>(20);
  const [mouthSpeakingThreshold, setMouthSpeakingThreshold] =
    useState<number>(0.1);
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
    onError: appendError,
    sendMouthVowel,
  });

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

    if (HAS_DEFAULT_AUDIO_ROOM_ENV) {
      setRoomHint(DEFAULT_AUDIO_ROOM);
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

    const savedMouthSpeakingThreshold = window.localStorage.getItem(
      STORAGE_KEYS.mouthSpeakingThreshold,
    );
    if (savedMouthSpeakingThreshold != null) {
      const parsed = Number(savedMouthSpeakingThreshold);
      if (Number.isFinite(parsed)) {
        setMouthSpeakingThreshold(Math.max(0, Math.min(1, parsed)));
      }
    }

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

  useEffect(() => {
    if (!isDevicePanel) return;
    window.localStorage.setItem(
      STORAGE_KEYS.mouthSpeakingThreshold,
      String(mouthSpeakingThreshold),
    );
  }, [isDevicePanel, mouthSpeakingThreshold]);

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

  const deviceSignal = useDeviceSignalController({
    signalingIpAddress,
    signalingPort,
    roomHint,
    signalWsStatus,
    callStatus,
    selectedMicId,
  });
  const telecoCommand = useTelecoCommandController({
    telecoIpAddress,
    telecoPort,
    commandWsStatus,
  });
  const micAnalyzer = useMicAnalyzerController({
    selectedMicId,
    micTestRunning,
    autoMouthEnabled,
    monitorVolume,
    noiseFloor,
    gain,
    mouthSpeakingThreshold,
    mouthSendFps,
    micLevel,
    mics,
    signalWsStatus,
    callStatus,
    lastVowel: lastVowelRef.current,
    micTestAudioRef,
    canStartMicTest: !micTestRunning && deviceSignal.hasMic,
    canStopMicTest: micTestRunning,
    onSetSelectedMicId: setSelectedMicId,
    onSetAutoMouthEnabled: setAutoMouthEnabled,
    onSetMonitorVolume: setMonitorVolume,
    onSetNoiseFloor: setNoiseFloor,
    onSetGain: setGain,
    onSetMouthSpeakingThreshold: setMouthSpeakingThreshold,
    onSetMouthSendFps: setMouthSendFps,
    onRefreshDevices: refreshDevices,
    onStartMicTest: () => void startMicTest(),
    onStopMicTest: stopMicTest,
  });

  return {
    error,
    isDevicePanel,
    isTelecoPanel,
    devicePanelProps: {
      signalConnected: deviceSignal.signalConnected,
      signalBusy: deviceSignal.signalBusy,
      callActive: deviceSignal.callActive,
      callStatus,
      hasMic: deviceSignal.hasMic,
      signalingIpAddress,
      signalingPort,
      roomHint,
      signalingWsUrlForDisplay: deviceSignal.signalingWsUrlForDisplay,
      signalingBaseUrlForDisplay: deviceSignal.signalingBaseUrlForDisplay,
      mics: micAnalyzer.mics,
      selectedMicId: micAnalyzer.selectedMicId,
      signalWsStatus: micAnalyzer.signalWsStatus,
      lastVowel: micAnalyzer.lastVowel,
      micTestRunning: micAnalyzer.micTestRunning,
      autoMouthEnabled: micAnalyzer.autoMouthEnabled,
      monitorVolume: micAnalyzer.monitorVolume,
      noiseFloor: micAnalyzer.noiseFloor,
      gain: micAnalyzer.gain,
      mouthSpeakingThreshold: micAnalyzer.mouthSpeakingThreshold,
      mouthSendFps: micAnalyzer.mouthSendFps,
      micLevel: micAnalyzer.micLevel,
      canConnectSignalNow: deviceSignal.canConnectSignalNow,
      canDisconnectSignal: deviceSignal.canDisconnectSignal,
      canStartSending: deviceSignal.canStartSending,
      canStopSending: deviceSignal.canStopSending,
      canStartMicTest: micAnalyzer.canStartMicTest,
      canStopMicTest: micAnalyzer.canStopMicTest,
      hasSignalingTarget: deviceSignal.hasSignalingTarget,
      micTestAudioRef: micAnalyzer.micTestAudioRef,
      onSetSignalingIpAddress: setSignalingIpAddress,
      onSetSignalingPort: setSignalingPort,
      onSetRoomHint: setRoomHint,
      onSetSelectedMicId: micAnalyzer.onSetSelectedMicId,
      onSetAutoMouthEnabled: micAnalyzer.onSetAutoMouthEnabled,
      onSetMonitorVolume: micAnalyzer.onSetMonitorVolume,
      onSetNoiseFloor: micAnalyzer.onSetNoiseFloor,
      onSetGain: micAnalyzer.onSetGain,
      onSetMouthSpeakingThreshold: micAnalyzer.onSetMouthSpeakingThreshold,
      onSetMouthSendFps: micAnalyzer.onSetMouthSendFps,
      onRefreshDevices: micAnalyzer.onRefreshDevices,
      onConnectSignal: () => {
        manualSignalDisconnectRef.current = false;
        shouldAutoSignalRef.current = true;
        window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "1");
        connectSignalWs();
      },
      onDisconnectSignal: disconnectSignalWs,
      onStartSending: () => void startSending(),
      onStopSending: stopSending,
      onStartMicTest: micAnalyzer.onStartMicTest,
      onStopMicTest: micAnalyzer.onStopMicTest,
    },
    telecoPanelProps: {
      telecoIpAddress,
      telecoPort,
      telecoDebugUrlForDisplay: telecoCommand.telecoDebugUrlForDisplay,
      commandWsUrlForDisplay: telecoCommand.commandWsUrlForDisplay,
      commandConnected: telecoCommand.commandConnected,
      commandBusy: telecoCommand.commandBusy,
      hasTelecoTarget: telecoCommand.hasTelecoTarget,
      canConnectCommandNow: telecoCommand.canConnectCommandNow,
      canDisconnectCommand: telecoCommand.canDisconnectCommand,
      canRunMouthTest: telecoCommand.canRunMouthTest,
      commandWsStatus,
      showMouthPresetPanel,
      showRawCommandPanel,
      commandJson,
      commandLog,
      onSetTelecoIpAddress: setTelecoIpAddress,
      onSetTelecoPort: setTelecoPort,
      onConnectCommand: () => {
        manualCommandDisconnectRef.current = false;
        shouldAutoCommandRef.current = true;
        window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "1");
        connectCommandWs();
      },
      onDisconnectCommand: disconnectCommandWs,
      onMouthTestA: () => sendMouthVowel("a"),
      onArrowLeft: () => sendArrowMove("left"),
      onArrowRight: () => sendArrowMove("right"),
      onInitializePose: sendInitializePose,
      onSetShowMouthPresetPanel: setShowMouthPresetPanel,
      onSetShowRawCommandPanel: setShowRawCommandPanel,
      onSendMouthVowel: sendMouthVowel,
      onSetCommandJson: setCommandJson,
      onSendRawCommandJson: sendRawCommandJson,
      onClearCommandLog: () => setCommandLog(""),
    },
  };
}
