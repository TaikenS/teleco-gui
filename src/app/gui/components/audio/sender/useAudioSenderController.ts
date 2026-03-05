"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUDIO_SEND_SIGNALING_IP_ENV_KEYS,
  AUDIO_SEND_SIGNALING_PORT_ENV_KEYS,
  DEFAULT_AUDIO_ROOM,
  HAS_DEFAULT_AUDIO_ROOM_ENV,
  DEFAULT_SIGNALING_IP_ADDRESS,
  DEFAULT_SIGNALING_PORT,
  DEFAULT_TELECO_PORT,
  GAMEPAD_ARROW_COOLDOWN_MS,
  GAMEPAD_B_BUTTON_INDEX,
  GAMEPAD_DPAD_LEFT_BUTTON_INDEX,
  GAMEPAD_DPAD_RIGHT_BUTTON_INDEX,
  GAMEPAD_LB_BUTTON_INDEX,
  GAMEPAD_LT_BUTTON_INDEX,
  GAMEPAD_RB_BUTTON_INDEX,
  GAMEPAD_RT_BUTTON_INDEX,
  GAMEPAD_TRIGGER_THRESHOLD,
  GAMEPAD_X_BUTTON_INDEX,
  resolveDefaultTelecoIpAddress,
  STORAGE_KEYS,
  TELECO_ARROW_EVENT,
  TELECO_HEADING_EVENT,
} from "@/app/gui/components/audio/sender/controller/constants";
import {
  bindRecoveryListeners,
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
  const HAS_AUDIO_SEND_SIGNALING_IP_ENV = AUDIO_SEND_SIGNALING_IP_ENV_KEYS.some(
    (key) => !!process.env[key]?.trim(),
  );
  const HAS_AUDIO_SEND_SIGNALING_PORT_ENV =
    AUDIO_SEND_SIGNALING_PORT_ENV_KEYS.some(
      (key) => !!process.env[key]?.trim(),
    );

  const getFirstValue = (
    values: Record<string, string>,
    keys: string[],
  ): string | null => {
    for (const key of keys) {
      const value = values[key];
      if (value?.trim()) return value.trim();
    }
    return null;
  };

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
  const didInitDeviceSettingsRef = useRef(false);
  const didEditDeviceSignalSettingsRef = useRef(false);

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

  const [telecoIpAddress, setTelecoIpAddress] = useState<string>(() =>
    resolveDefaultTelecoIpAddress(),
  );
  const [telecoPort, setTelecoPort] = useState<string>(DEFAULT_TELECO_PORT);

  useEffect(() => {
    const values: Record<string, string> = {};
    if (
      isDevicePanel &&
      didInitDeviceSettingsRef.current &&
      didEditDeviceSignalSettingsRef.current
    ) {
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
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [gamepadIndex, setGamepadIndex] = useState<number | null>(null);
  const [gamepadId, setGamepadId] = useState<string>("");
  const [gamepadMapping, setGamepadMapping] = useState<string>("");
  const [gamepadPressedButtons, setGamepadPressedButtons] = useState<number[]>(
    [],
  );
  const [gamepadLtValue, setGamepadLtValue] = useState(0);
  const [gamepadRtValue, setGamepadRtValue] = useState(0);
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
  const mouthPositiveSideRef = useRef<boolean>(true);
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

  function sendMouthVowel(
    vowel: Vowel,
    options?: { force?: boolean; source?: "manual" | "auto" },
  ) {
    const force = options?.force === true;
    const source = options?.source ?? "auto";
    const now = performance.now();
    const minInterval = 1000 / Math.max(1, mouthSendFps);

    if (vowel === "xn") {
      const vowelChanged = lastVowelRef.current !== "xn";
      if (!force && !vowelChanged && now - lastSendMsRef.current < minInterval) {
        return;
      }
      const faceSent = enableFaceCommandSend
        ? sendCommand(
            {
              label: "faceCommand",
              commandFace: "change_mouth_vowel",
              vowel,
              clientId: clientIdRef.current,
              ts: Date.now(),
            },
            { silentIfDisconnected: true },
          )
        : false;
      if (faceSent) {
        lastSendMsRef.current = now;
      }
      logCommand(
        `MOUTH(${source}): vowel=${vowel} face=${enableFaceCommandSend ? (faceSent ? "sent" : "skip") : "off"} move_multi=off`,
      );
      lastVowelRef.current = "xn";
      return;
    }

    const vowelChanged = lastVowelRef.current !== vowel;
    if (
      !force &&
      !vowelChanged &&
      lastVowelRef.current !== "xn" &&
      now - lastSendMsRef.current < minInterval
    ) {
      return;
    }

    lastVowelRef.current = vowel;
    lastSendMsRef.current = now;
    mouthPositiveSideRef.current = !mouthPositiveSideRef.current;
    const amplitude = 40;
    const sign = mouthPositiveSideRef.current ? 1 : -1;
    const openAngles = [amplitude * sign, -amplitude * sign];
    const faceSent = enableFaceCommandSend
      ? sendCommand(
          {
            label: "faceCommand",
            commandFace: "change_mouth_vowel",
            vowel,
            clientId: clientIdRef.current,
            ts: Date.now(),
          },
          { silentIfDisconnected: true },
        )
      : false;
    const payload = {
      label: "move_multi",
      joints: [2, 4],
      angles: openAngles,
      speeds: [50, 50],
      dontsendback: true,
    };
    const moveSent = enableMoveMultiSend
      ? sendCommand(payload, { silentIfDisconnected: true })
      : false;
    logCommand(
      `MOUTH(${source}): vowel=${vowel} face=${enableFaceCommandSend ? (faceSent ? "sent" : "skip") : "off"} move_multi=${enableMoveMultiSend ? (moveSent ? "sent" : "skip") : "off"} joints=[2,4] angles=[${openAngles[0]},${openAngles[1]}]`,
    );
  }

  function sendArrowMove(
    direction: TelecoArrowDirection,
    options?: { silentIfDisconnected?: boolean },
  ) {
    const angle = direction === "left" ? -20 : 20;
    const sent = sendCommand(
      {
        label: "move_multi",
        joints: [8],
        angles: [angle],
        speeds: [30],
        dontsendback: true,
      },
      options,
    );
    if (sent) {
      window.dispatchEvent(
        new CustomEvent<{ direction: TelecoArrowDirection }>(
          TELECO_HEADING_EVENT,
          { detail: { direction } },
        ),
      );
    }
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
  const [showGamepadPanel, setShowGamepadPanel] = useState(false);
  const [enableFaceCommandSend, setEnableFaceCommandSend] = useState(true);
  const [enableMoveMultiSend, setEnableMoveMultiSend] = useState(true);

  // レベルメータ用（RMS）
  const [noiseFloor, setNoiseFloor] = useState<number>(0.02);
  const [gain, setGain] = useState<number>(20);
  const [mouthSpeakingThreshold, setMouthSpeakingThreshold] =
    useState<number>(0.03);
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
    void (async () => {
      const savedRoomHint = window.localStorage.getItem(STORAGE_KEYS.roomId);
      if (savedRoomHint) {
        setRoomHint(savedRoomHint);
      }

      const savedSignalIpAddress = window.localStorage.getItem(
        STORAGE_KEYS.signalingIpAddress,
      );
      if (!HAS_AUDIO_SEND_SIGNALING_IP_ENV && savedSignalIpAddress) {
        setSignalingIpAddress(savedSignalIpAddress);
      }

      const savedSignalPort = window.localStorage.getItem(
        STORAGE_KEYS.signalingPort,
      );
      if (!HAS_AUDIO_SEND_SIGNALING_PORT_ENV && savedSignalPort) {
        setSignalingPort(savedSignalPort);
      }

      const legacySignalUrl = window.localStorage.getItem(
        STORAGE_KEYS.signalingWsUrlLegacy,
      );
      if (legacySignalUrl) {
        const parsed = parseSignalingUrl(legacySignalUrl);
        if (!HAS_AUDIO_SEND_SIGNALING_IP_ENV && parsed?.ipAddress) {
          setSignalingIpAddress(parsed.ipAddress);
        }
        if (!HAS_AUDIO_SEND_SIGNALING_PORT_ENV && parsed?.port) {
          setSignalingPort(parsed.port);
        }
        if (parsed?.roomId) {
          setRoomHint(parsed.roomId);
        }
      }

      if (HAS_DEFAULT_AUDIO_ROOM_ENV) {
        setRoomHint(DEFAULT_AUDIO_ROOM);
      }

      try {
        const res = await fetch("/api/env-local", { cache: "no-store" });
        const data = (await res.json()) as {
          ok?: boolean;
          values?: Record<string, string>;
        };
        const values = data?.values;
        if (values) {
          const envIpAddress = getFirstValue(
            values,
            AUDIO_SEND_SIGNALING_IP_ENV_KEYS,
          );
          const envPort = getFirstValue(values, AUDIO_SEND_SIGNALING_PORT_ENV_KEYS);
          if (envIpAddress) {
            setSignalingIpAddress(envIpAddress);
          }
          if (envPort) {
            setSignalingPort(envPort);
          }
        }
      } catch {
        // noop
      }

      const savedMicId = window.localStorage.getItem(STORAGE_KEYS.selectedMicId);
      if (savedMicId) setSelectedMicId(savedMicId);

      shouldAutoSignalRef.current = false;
      shouldAutoSendingRef.current =
        window.localStorage.getItem(STORAGE_KEYS.sendingActive) === "1";
      window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "0");
      didInitDeviceSettingsRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel]);

  useEffect(() => {
    if (!isTelecoPanel) return;

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

    const savedShowGamepadPanel = window.localStorage.getItem(
      STORAGE_KEYS.showGamepadPanel,
    );
    if (savedShowGamepadPanel != null)
      setShowGamepadPanel(savedShowGamepadPanel === "1");

    const savedMouthSpeakingThreshold = window.localStorage.getItem(
      STORAGE_KEYS.mouthSpeakingThreshold,
    );
    if (savedMouthSpeakingThreshold != null) {
      const parsed = Number(savedMouthSpeakingThreshold);
      if (Number.isFinite(parsed)) {
        setMouthSpeakingThreshold(Math.max(0, Math.min(1, parsed)));
      }
    }

    // 初期表示では常に未接続で開始する（起動時の自動接続はしない）
    shouldAutoCommandRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "0");
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
    if (!isTelecoPanel) return;
    window.localStorage.setItem(
      STORAGE_KEYS.showGamepadPanel,
      showGamepadPanel ? "1" : "0",
    );
  }, [isTelecoPanel, showGamepadPanel]);

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
  const connectSignalWs = (
    isReconnect = false,
    target?: { ipAddress?: string; port?: string; roomId?: string },
  ) => {
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

    const ipAddress = (target?.ipAddress ?? signalingIpAddress).trim();
    const port = (target?.port ?? signalingPort).trim();
    const room = (target?.roomId ?? roomHint).trim();

    if (!ipAddress || !port || !room) {
      setSignalWsStatus("エラー");
      appendError(
        "Signaling の IP Address / Port / Room ID を入力してください。",
      );
      return;
    }

    const normalized = buildSignalingUrl({
      ipAddress,
      port,
      roomId: room,
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
          JSON.stringify({ type: "join", roomId: room, role: "sender" }),
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
    if (!isTelecoPanel) return;

    let rafId: number | null = null;
    let lastDebugSignature = "";
    let lastLeftPressed = false;
    let lastRightPressed = false;
    let lastSentAt = 0;
    let lastConnectionState = false;

    const readTriggerValue = (button: GamepadButton | undefined): number => {
      if (!button) return 0;
      return typeof button.value === "number"
        ? button.value
        : button.pressed
          ? 1
          : 0;
    };
    const isPressed = (button: GamepadButton | undefined): boolean =>
      !!button?.pressed;

    const tick = () => {
      const pads = navigator.getGamepads?.() ?? [];
      let padIndex = -1;
      let bestScore = -1;
      for (let i = 0; i < pads.length; i++) {
        const candidate = pads[i];
        if (!candidate?.connected) continue;

        const id = candidate.id?.toLowerCase() ?? "";
        const isXboxLike =
          id.includes("xbox") ||
          id.includes("xinput") ||
          id.includes("microsoft");
        const hasStandardMapping = candidate.mapping === "standard";
        const buttonCount = candidate.buttons?.length ?? 0;
        const likelyGamepad = buttonCount >= 10;

        // 優先順:
        // 1) Xbox系ID
        // 2) standard mapping
        // 3) ボタン数が多い
        const score =
          (isXboxLike ? 1000 : 0) +
          (hasStandardMapping ? 100 : 0) +
          (likelyGamepad ? 10 : 0) +
          buttonCount;

        if (score > bestScore) {
          bestScore = score;
          padIndex = i;
        }
      }
      const pad = padIndex >= 0 ? pads[padIndex] : null;
      const connected = !!pad;
      if (connected !== lastConnectionState) {
        lastConnectionState = connected;
        setGamepadConnected(connected);
      }

      if (pad) {
        const ltRaw = readTriggerValue(pad.buttons[GAMEPAD_LT_BUTTON_INDEX]);
        const rtRaw = readTriggerValue(pad.buttons[GAMEPAD_RT_BUTTON_INDEX]);
        const pressedButtons = pad.buttons
          .map((button, index) => (button?.pressed ? index : -1))
          .filter((index) => index >= 0);
        const mapping = pad.mapping || "(empty)";
        const nextSignature = [
          String(padIndex),
          pad.id,
          mapping,
          pressedButtons.join(","),
          ltRaw.toFixed(2),
          rtRaw.toFixed(2),
        ].join("|");
        if (nextSignature !== lastDebugSignature) {
          lastDebugSignature = nextSignature;
          setGamepadIndex(padIndex);
          setGamepadId(pad.id || "(empty)");
          setGamepadMapping(mapping);
          setGamepadPressedButtons(pressedButtons);
          setGamepadLtValue(ltRaw);
          setGamepadRtValue(rtRaw);
        }

        const leftPressed =
          isPressed(pad.buttons[GAMEPAD_LB_BUTTON_INDEX]) ||
          isPressed(pad.buttons[GAMEPAD_X_BUTTON_INDEX]) ||
          isPressed(pad.buttons[GAMEPAD_DPAD_LEFT_BUTTON_INDEX]) ||
          ltRaw >= GAMEPAD_TRIGGER_THRESHOLD;
        const rightPressed =
          isPressed(pad.buttons[GAMEPAD_RB_BUTTON_INDEX]) ||
          isPressed(pad.buttons[GAMEPAD_B_BUTTON_INDEX]) ||
          isPressed(pad.buttons[GAMEPAD_DPAD_RIGHT_BUTTON_INDEX]) ||
          rtRaw >= GAMEPAD_TRIGGER_THRESHOLD;
        const now = performance.now();
        const canSend = now - lastSentAt >= GAMEPAD_ARROW_COOLDOWN_MS;

        if (leftPressed && !lastLeftPressed && canSend) {
          sendArrowMove("left", { silentIfDisconnected: true });
          lastSentAt = now;
        } else if (rightPressed && !lastRightPressed && canSend) {
          sendArrowMove("right", { silentIfDisconnected: true });
          lastSentAt = now;
        }

        lastLeftPressed = leftPressed;
        lastRightPressed = rightPressed;
      } else {
        if (lastDebugSignature !== "") {
          lastDebugSignature = "";
          setGamepadIndex(null);
          setGamepadId("");
          setGamepadMapping("");
          setGamepadPressedButtons([]);
          setGamepadLtValue(0);
          setGamepadRtValue(0);
        }
        lastLeftPressed = false;
        lastRightPressed = false;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      setGamepadConnected(false);
      setGamepadIndex(null);
      setGamepadId("");
      setGamepadMapping("");
      setGamepadPressedButtons([]);
      setGamepadLtValue(0);
      setGamepadRtValue(0);
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
      onSetSignalingIpAddress: (value: string) => {
        didEditDeviceSignalSettingsRef.current = true;
        setSignalingIpAddress(value);
      },
      onSetSignalingPort: (value: string) => {
        didEditDeviceSignalSettingsRef.current = true;
        setSignalingPort(value);
      },
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
        shouldAutoSignalRef.current = false;
        window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "0");
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
      gamepadConnected,
      gamepadIndex,
      gamepadId,
      gamepadMapping,
      gamepadPressedButtons,
      gamepadLtValue,
      gamepadRtValue,
      commandConnected: telecoCommand.commandConnected,
      commandBusy: telecoCommand.commandBusy,
      hasTelecoTarget: telecoCommand.hasTelecoTarget,
      canConnectCommandNow: telecoCommand.canConnectCommandNow,
      canDisconnectCommand: telecoCommand.canDisconnectCommand,
      canRunMouthTest: telecoCommand.canRunMouthTest,
      commandWsStatus,
      showMouthPresetPanel,
      showRawCommandPanel,
      showGamepadPanel,
      enableFaceCommandSend,
      enableMoveMultiSend,
      commandJson,
      commandLog,
      onSetTelecoIpAddress: setTelecoIpAddress,
      onSetTelecoPort: setTelecoPort,
      onConnectCommand: () => {
        manualCommandDisconnectRef.current = false;
        shouldAutoCommandRef.current = true;
        window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "0");
        connectCommandWs();
      },
      onDisconnectCommand: disconnectCommandWs,
      onMouthTestA: () => sendMouthVowel("a", { force: true, source: "manual" }),
      onArrowLeft: () => sendArrowMove("left"),
      onArrowRight: () => sendArrowMove("right"),
      onInitializePose: sendInitializePose,
      onSetShowMouthPresetPanel: setShowMouthPresetPanel,
      onSetShowRawCommandPanel: setShowRawCommandPanel,
      onSetShowGamepadPanel: setShowGamepadPanel,
      onSetEnableFaceCommandSend: setEnableFaceCommandSend,
      onSetEnableMoveMultiSend: setEnableMoveMultiSend,
      onSendMouthVowel: (v: Vowel) =>
        sendMouthVowel(v, { force: true, source: "manual" }),
      onSetCommandJson: setCommandJson,
      onSendRawCommandJson: sendRawCommandJson,
      onClearCommandLog: () => setCommandLog(""),
    },
  };
}
