"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_AUDIO_ROOM,
  DEFAULT_SIGNALING_IP_ADDRESS,
  DEFAULT_SIGNALING_PORT,
  DEFAULT_TELECO_PORT,
  resolveDefaultTelecoIpAddress,
  STORAGE_KEYS,
  TELECO_ARROW_EVENT,
} from "@/app/gui/components/audio/sender/controller/constants";
import { bindRecoveryListeners } from "@/app/gui/components/audio/sender/controller/helpers";
import { useAudioInputController } from "@/app/gui/components/audio/sender/controller/useAudioInputController";
import { useAudioSenderPanelPersistence } from "@/app/gui/components/audio/sender/controller/useAudioSenderPanelPersistence";
import { useCommandWebSocket } from "@/app/gui/components/audio/sender/controller/useCommandWebSocket";
import { useSharedAudioStream } from "@/app/gui/components/audio/sender/controller/useSharedAudioStream";
import { useSignalWebSocket } from "@/app/gui/components/audio/sender/controller/useSignalWebSocket";
import { useTelecoCommandActions } from "@/app/gui/components/audio/sender/controller/useTelecoCommandActions";
import { useTelecoGamepadState } from "@/app/gui/components/audio/sender/controller/useTelecoGamepadState";
import { useDeviceSignalController } from "@/app/gui/components/audio/sender/useDeviceSignalController";
import { useMicAnalyzerController } from "@/app/gui/components/audio/sender/useMicAnalyzerController";
import { useTelecoCommandController } from "@/app/gui/components/teleco/useTelecoCommandController";
import { AudioCallManager } from "@/lib/webrtc/audioCallManager";
import type {
  TelecoArrowDirection,
  Vowel,
} from "@/app/gui/components/audio/sender/controller/types";

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
  const signalWsRef = useRef<WebSocket | null>(null);

  const shouldAutoSignalRef = useRef(false);
  const shouldAutoCommandRef = useRef(false);
  const shouldAutoSendingRef = useRef(false);
  const didInitDeviceSettingsRef = useRef(false);
  const didEditDeviceSignalSettingsRef = useRef(false);

  // WebRTC call
  const callIdRef = useRef<string | null>(null);

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
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const {
    usingForWebrtcRef,
    usingForMicTestRef,
    ensureSharedStream,
    stopSharedStreamIfUnused,
  } = useSharedAudioStream(selectedMicId);

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
  const [commandConnectionLog, setCommandConnectionLog] = useState<string>("");
  const [signalConnectionLog, setSignalConnectionLog] = useState<string>("");
  const [mouthSendFps, setMouthSendFps] = useState<number>(15);

  function appendError(msg: string) {
    setError(msg);
  }
  function logCommand(line: string) {
    setCommandLog((prev) => `${prev}${line}\n`);
  }
  function logCommandConnection(line: string) {
    setCommandConnectionLog(
      (prev) => `${prev}[${new Date().toLocaleTimeString()}] ${line}\n`,
    );
  }
  function logSignalConnection(line: string) {
    setSignalConnectionLog(
      (prev) => `${prev}[${new Date().toLocaleTimeString()}] ${line}\n`,
    );
  }

  const commandSocket = useCommandWebSocket({
    telecoIpAddress,
    telecoPort,
    shouldAutoCommandRef,
    onError: appendError,
    onLogConnection: logCommandConnection,
    onLogCommand: logCommand,
  });

  function sendRawCommandJson() {
    setError(null);
    try {
      const obj = JSON.parse(commandJson);
      commandSocket.sendCommand(obj);
    } catch {
      appendError(
        "JSONのパースに失敗しました。JSONとして正しい形式か確認してください。",
      );
    }
  }

  const [autoMouthEnabled, setAutoMouthEnabled] = useState(true);
  const [monitorVolume, setMonitorVolume] = useState<number>(0.2);

  const [showMouthPresetPanel, setShowMouthPresetPanel] = useState(false);
  const [showCommandPresetPanel, setShowCommandPresetPanel] = useState(false);
  const [showRawCommandPanel, setShowRawCommandPanel] = useState(false);
  const [showGamepadPanel, setShowGamepadPanel] = useState(false);
  const [showCommandLogPanel, setShowCommandLogPanel] = useState(false);
  const [showSignalLogPanel, setShowSignalLogPanel] = useState(false);
  const [enableFaceCommandSend, setEnableFaceCommandSend] = useState(true);
  const [enableMoveMultiSend, setEnableMoveMultiSend] = useState(true);
  const telecoActions = useTelecoCommandActions({
    sendCommand: commandSocket.sendCommand,
    logCommand,
    enableFaceCommandSend,
    enableMoveMultiSend,
    mouthSendFps,
    clientId: clientIdRef.current,
  });

  // レベルメータ用（RMS）
  const [noiseFloor, setNoiseFloor] = useState<number>(0.02);
  const [gain, setGain] = useState<number>(20);
  const [mouthSpeakingThreshold, setMouthSpeakingThreshold] =
    useState<number>(0.03);
  const audioInput = useAudioInputController({
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
    onClearError: () => setError(null),
    onError: appendError,
    sendMouthVowel: telecoActions.sendMouthVowel,
  });

  useAudioSenderPanelPersistence({
    isDevicePanel,
    isTelecoPanel,
    signalingIpAddress,
    signalingPort,
    telecoIpAddress,
    telecoPort,
    roomHint,
    selectedMicId,
    showMouthPresetPanel,
    showCommandPresetPanel,
    showRawCommandPanel,
    showGamepadPanel,
    showCommandLogPanel,
    showSignalLogPanel,
    mouthSpeakingThreshold,
    didInitDeviceSettingsRef,
    didEditDeviceSignalSettingsRef,
    shouldAutoSignalRef,
    shouldAutoCommandRef,
    shouldAutoSendingRef,
    setRoomHint,
    setSignalingIpAddress,
    setSignalingPort,
    setSelectedMicId,
    setShowMouthPresetPanel,
    setShowCommandPresetPanel,
    setShowRawCommandPanel,
    setShowGamepadPanel,
    setShowCommandLogPanel,
    setShowSignalLogPanel,
    setMouthSpeakingThreshold,
    refreshDevices: audioInput.refreshDevices,
  });

  const gamepadState = useTelecoGamepadState({
    enabled: isTelecoPanel,
    onArrow: (direction) =>
      telecoActions.sendArrowMove(direction, { silentIfDisconnected: true }),
  });

  const signalSocket = useSignalWebSocket({
    signalWsRef,
    signalingIpAddress,
    signalingPort,
    roomHint,
    shouldAutoSignalRef,
    shouldAutoSendingRef,
    callIdRef,
    onError: appendError,
    onLogConnection: logSignalConnection,
    onLogCommand: logCommand,
    onIncomingMessage: async (msg) => {
      await manager.handleIncomingMessage(msg);
    },
    onReconnectReadyToSend: () => {
      void audioInput.startSending();
    },
  });

  useEffect(() => {
    if (!isTelecoPanel) return;
    const onTelecoArrow = (ev: Event) => {
      const detail = (ev as CustomEvent<{ direction?: TelecoArrowDirection }>)
        .detail;
      if (!detail?.direction) return;
      telecoActions.sendArrowMove(detail.direction);
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
        telecoActions.sendArrowMove("left");
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        telecoActions.sendArrowMove("right");
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
    return bindRecoveryListeners(signalSocket.recoverSignalConnection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    return bindRecoveryListeners(commandSocket.recoverCommandConnection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelecoPanel]);

  useEffect(() => {
    if (!isDevicePanel) return;
    return () => {
      audioInput.cleanupAudioInput();
      signalSocket.cleanupSignalSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevicePanel]);

  useEffect(() => {
    if (!isTelecoPanel) return;
    return () => {
      commandSocket.cleanupCommandSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelecoPanel]);

  const deviceSignal = useDeviceSignalController({
    signalingIpAddress,
    signalingPort,
    roomHint,
    signalWsStatus: signalSocket.signalWsStatus,
    callStatus: audioInput.callStatus,
    selectedMicId,
  });
  const telecoCommand = useTelecoCommandController({
    telecoIpAddress,
    telecoPort,
    commandWsStatus: commandSocket.commandWsStatus,
  });
  const micAnalyzer = useMicAnalyzerController({
    selectedMicId,
    micTestRunning: audioInput.micTestRunning,
    autoMouthEnabled,
    monitorVolume,
    noiseFloor,
    gain,
    mouthSpeakingThreshold,
    mouthSendFps,
    micLevel: audioInput.micLevel,
    mics: audioInput.mics,
    signalWsStatus: signalSocket.signalWsStatus,
    callStatus: audioInput.callStatus,
    lastVowel: telecoActions.lastVowelRef.current,
    micTestAudioRef: audioInput.micTestAudioRef,
    canStartMicTest: !audioInput.micTestRunning && deviceSignal.hasMic,
    canStopMicTest: audioInput.micTestRunning,
    onSetSelectedMicId: setSelectedMicId,
    onSetAutoMouthEnabled: setAutoMouthEnabled,
    onSetMonitorVolume: setMonitorVolume,
    onSetNoiseFloor: setNoiseFloor,
    onSetGain: setGain,
    onSetMouthSpeakingThreshold: setMouthSpeakingThreshold,
    onSetMouthSendFps: setMouthSendFps,
    onRefreshDevices: audioInput.refreshDevices,
    onStartMicTest: () => void audioInput.startMicTest(),
    onStopMicTest: audioInput.stopMicTest,
  });

  return {
    error,
    isDevicePanel,
    isTelecoPanel,
    devicePanelProps: {
      signalConnected: deviceSignal.signalConnected,
      signalBusy: deviceSignal.signalBusy,
      callActive: deviceSignal.callActive,
      callStatus: audioInput.callStatus,
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
      showSignalLogPanel,
      signalConnectionLog,
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
        shouldAutoSignalRef.current = false;
        window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "0");
        signalSocket.connectSignalWs();
      },
      onDisconnectSignal: signalSocket.disconnectSignalWs,
      onStartSending: () => void audioInput.startSending(),
      onStopSending: audioInput.stopSending,
      onStartMicTest: micAnalyzer.onStartMicTest,
      onStopMicTest: micAnalyzer.onStopMicTest,
      onSetShowSignalLogPanel: setShowSignalLogPanel,
    },
    telecoPanelProps: {
      telecoIpAddress,
      telecoPort,
      telecoDebugUrlForDisplay: telecoCommand.telecoDebugUrlForDisplay,
      commandWsUrlForDisplay: telecoCommand.commandWsUrlForDisplay,
      gamepadConnected: gamepadState.gamepadConnected,
      gamepadIndex: gamepadState.gamepadIndex,
      gamepadId: gamepadState.gamepadId,
      gamepadMapping: gamepadState.gamepadMapping,
      gamepadPressedButtons: gamepadState.gamepadPressedButtons,
      gamepadLtValue: gamepadState.gamepadLtValue,
      gamepadRtValue: gamepadState.gamepadRtValue,
      commandConnected: telecoCommand.commandConnected,
      commandBusy: telecoCommand.commandBusy,
      hasTelecoTarget: telecoCommand.hasTelecoTarget,
      canConnectCommandNow: telecoCommand.canConnectCommandNow,
      canDisconnectCommand: telecoCommand.canDisconnectCommand,
      canRunMouthTest: telecoCommand.canRunMouthTest,
      commandWsStatus: commandSocket.commandWsStatus,
      showMouthPresetPanel,
      showCommandPresetPanel,
      showRawCommandPanel,
      showGamepadPanel,
      showCommandLogPanel,
      enableFaceCommandSend,
      enableMoveMultiSend,
      commandJson,
      commandLog,
      commandConnectionLog,
      onSetTelecoIpAddress: setTelecoIpAddress,
      onSetTelecoPort: setTelecoPort,
      onConnectCommand: () => {
        shouldAutoCommandRef.current = true;
        window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "0");
        commandSocket.connectCommandWs();
      },
      onDisconnectCommand: commandSocket.disconnectCommandWs,
      onMouthTestA: () =>
        telecoActions.sendMouthVowel("a", { force: true, source: "manual" }),
      onArrowLeft: () => telecoActions.sendArrowMove("left"),
      onArrowRight: () => telecoActions.sendArrowMove("right"),
      onInitializePose: telecoActions.sendInitializePose,
      onSetShowMouthPresetPanel: setShowMouthPresetPanel,
      onSetShowCommandPresetPanel: setShowCommandPresetPanel,
      onSetShowRawCommandPanel: setShowRawCommandPanel,
      onSetShowGamepadPanel: setShowGamepadPanel,
      onSetShowCommandLogPanel: setShowCommandLogPanel,
      onSetEnableFaceCommandSend: setEnableFaceCommandSend,
      onSetEnableMoveMultiSend: setEnableMoveMultiSend,
      onSendMouthVowel: (v: Vowel) =>
        telecoActions.sendMouthVowel(v, { force: true, source: "manual" }),
      onSendFaceCommandPreset: telecoActions.sendFaceCommandPreset,
      onSetCommandJson: setCommandJson,
      onSendRawCommandJson: sendRawCommandJson,
      onClearCommandLog: () => setCommandLog(""),
    },
  };
}
