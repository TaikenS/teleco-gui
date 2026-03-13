"use client";

import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  AUDIO_SEND_SIGNALING_IP_ENV_KEYS,
  AUDIO_SEND_SIGNALING_PORT_ENV_KEYS,
  DEFAULT_AUDIO_ROOM,
  HAS_AUDIO_SEND_SIGNALING_IP_ENV,
  HAS_AUDIO_SEND_SIGNALING_PORT_ENV,
  HAS_DEFAULT_AUDIO_ROOM_ENV,
  STORAGE_KEYS,
} from "@/app/gui/components/audio/sender/controller/constants";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import { parseSignalingUrl } from "@/lib/signaling";

type EnvLocalResponse = {
  ok?: boolean;
  values?: Record<string, string>;
};

type Setter<T> = Dispatch<SetStateAction<T>>;

type Args = {
  isDevicePanel: boolean;
  isTelecoPanel: boolean;
  signalingIpAddress: string;
  signalingPort: string;
  telecoIpAddress: string;
  telecoPort: string;
  roomHint: string;
  selectedMicId: string;
  showMouthPresetPanel: boolean;
  showCommandPresetPanel: boolean;
  showRawCommandPanel: boolean;
  showGamepadPanel: boolean;
  showCommandLogPanel: boolean;
  showSignalLogPanel: boolean;
  mouthSpeakingThreshold: number;
  didInitDeviceSettingsRef: MutableRefObject<boolean>;
  didEditDeviceSignalSettingsRef: MutableRefObject<boolean>;
  shouldAutoSignalRef: MutableRefObject<boolean>;
  shouldAutoCommandRef: MutableRefObject<boolean>;
  setRoomHint: Setter<string>;
  setSignalingIpAddress: Setter<string>;
  setSignalingPort: Setter<string>;
  setSelectedMicId: Setter<string>;
  setShowMouthPresetPanel: Setter<boolean>;
  setShowCommandPresetPanel: Setter<boolean>;
  setShowRawCommandPanel: Setter<boolean>;
  setShowGamepadPanel: Setter<boolean>;
  setShowCommandLogPanel: Setter<boolean>;
  setShowSignalLogPanel: Setter<boolean>;
  setMouthSpeakingThreshold: Setter<number>;
  refreshDevices: () => Promise<void>;
};

function getFirstValue(
  values: Record<string, string>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = values[key];
    if (value?.trim()) return value.trim();
  }
  return null;
}

export function useAudioSenderPanelPersistence({
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
  refreshDevices,
}: Args) {
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
    didEditDeviceSignalSettingsRef,
    didInitDeviceSettingsRef,
    isDevicePanel,
    isTelecoPanel,
    signalingIpAddress,
    signalingPort,
    telecoIpAddress,
    telecoPort,
  ]);

  useEffect(() => {
    if (!isDevicePanel) return;

    const init = async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        tmp.getTracks().forEach((track) => track.stop());
      } catch {
        // noop
      }

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
        const data = (await res.json()) as EnvLocalResponse;
        const values = data?.values;
        if (values) {
          const envIpAddress = getFirstValue(
            values,
            AUDIO_SEND_SIGNALING_IP_ENV_KEYS,
          );
          const envPort = getFirstValue(
            values,
            AUDIO_SEND_SIGNALING_PORT_ENV_KEYS,
          );
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

      const savedMicId = window.localStorage.getItem(
        STORAGE_KEYS.selectedMicId,
      );
      if (savedMicId) {
        setSelectedMicId(savedMicId);
      }

      const savedShowSignalLogPanel = window.localStorage.getItem(
        STORAGE_KEYS.showSignalLogPanel,
      );
      if (savedShowSignalLogPanel != null) {
        setShowSignalLogPanel(savedShowSignalLogPanel === "1");
      }

      shouldAutoSignalRef.current = false;
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
    if (savedShowMouthPresetPanel != null) {
      setShowMouthPresetPanel(savedShowMouthPresetPanel === "1");
    }

    const savedShowRawCommandPanel = window.localStorage.getItem(
      STORAGE_KEYS.showRawCommandPanel,
    );
    if (savedShowRawCommandPanel != null) {
      setShowRawCommandPanel(savedShowRawCommandPanel === "1");
    }

    const savedShowCommandPresetPanel = window.localStorage.getItem(
      STORAGE_KEYS.showCommandPresetPanel,
    );
    if (savedShowCommandPresetPanel != null) {
      setShowCommandPresetPanel(savedShowCommandPresetPanel === "1");
    }

    const savedShowGamepadPanel = window.localStorage.getItem(
      STORAGE_KEYS.showGamepadPanel,
    );
    if (savedShowGamepadPanel != null) {
      setShowGamepadPanel(savedShowGamepadPanel === "1");
    }

    const savedShowCommandLogPanel = window.localStorage.getItem(
      STORAGE_KEYS.showCommandLogPanel,
    );
    if (savedShowCommandLogPanel != null) {
      setShowCommandLogPanel(savedShowCommandLogPanel === "1");
    }

    const savedMouthSpeakingThreshold = window.localStorage.getItem(
      STORAGE_KEYS.mouthSpeakingThreshold,
    );
    if (savedMouthSpeakingThreshold != null) {
      const parsed = Number(savedMouthSpeakingThreshold);
      if (Number.isFinite(parsed)) {
        setMouthSpeakingThreshold(Math.max(0, Math.min(1, parsed)));
      }
    }

    shouldAutoCommandRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "0");
  }, [
    isTelecoPanel,
    setMouthSpeakingThreshold,
    setShowCommandLogPanel,
    setShowCommandPresetPanel,
    setShowGamepadPanel,
    setShowMouthPresetPanel,
    setShowRawCommandPanel,
    shouldAutoCommandRef,
  ]);

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
      STORAGE_KEYS.showCommandPresetPanel,
      showCommandPresetPanel ? "1" : "0",
    );
  }, [isTelecoPanel, showCommandPresetPanel]);

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
    if (!isTelecoPanel) return;
    window.localStorage.setItem(
      STORAGE_KEYS.showCommandLogPanel,
      showCommandLogPanel ? "1" : "0",
    );
  }, [isTelecoPanel, showCommandLogPanel]);

  useEffect(() => {
    if (!isDevicePanel) return;
    window.localStorage.setItem(
      STORAGE_KEYS.showSignalLogPanel,
      showSignalLogPanel ? "1" : "0",
    );
  }, [isDevicePanel, showSignalLogPanel]);

  useEffect(() => {
    if (!isDevicePanel) return;
    window.localStorage.setItem(
      STORAGE_KEYS.mouthSpeakingThreshold,
      String(mouthSpeakingThreshold),
    );
  }, [isDevicePanel, mouthSpeakingThreshold]);
}
