"use client";

import React from "react";
import {
  PANEL_AUDIO_RECEIVER_VISIBLE_KEY,
  PANEL_AUDIO_SENDER_VISIBLE_KEY,
  PANEL_TELECO_VISIBLE_KEY,
  PANEL_VIDEO_RECEIVER_VISIBLE_KEY,
  PANEL_VIDEO_SENDER_VISIBLE_KEY,
} from "@/app/gui/constants";
import { usePersistentState } from "@/lib/usePersistentState";

type PanelToggleItem = {
  id: string;
  label: string;
  visible: boolean;
  toggle: () => void;
};

function usePersistentVisibility(
  key: string,
): [visible: boolean, toggle: () => void] {
  const [visible, setVisible] = usePersistentState<boolean>(key, true);
  const toggle = React.useCallback(() => {
    setVisible((prev) => !prev);
  }, [setVisible]);
  return [visible, toggle];
}

export function useGuiPanelVisibility(): {
  showAudioSender: boolean;
  showAudioReceiver: boolean;
  showTeleco: boolean;
  showVideoSender: boolean;
  showVideoReceiver: boolean;
  panelToggleItems: PanelToggleItem[];
} {
  const [showAudioSender, toggleAudioSender] = usePersistentVisibility(
    PANEL_AUDIO_SENDER_VISIBLE_KEY,
  );
  const [showAudioReceiver, toggleAudioReceiver] = usePersistentVisibility(
    PANEL_AUDIO_RECEIVER_VISIBLE_KEY,
  );
  const [showTeleco, toggleTeleco] = usePersistentVisibility(
    PANEL_TELECO_VISIBLE_KEY,
  );
  const [showVideoSender, toggleVideoSender] = usePersistentVisibility(
    PANEL_VIDEO_SENDER_VISIBLE_KEY,
  );
  const [showVideoReceiver, toggleVideoReceiver] = usePersistentVisibility(
    PANEL_VIDEO_RECEIVER_VISIBLE_KEY,
  );

  const panelToggleItems = React.useMemo(
    () => [
      {
        id: "audio-sender",
        label: "音声送信",
        visible: showAudioSender,
        toggle: toggleAudioSender,
      },
      {
        id: "audio-receiver",
        label: "音声受信",
        visible: showAudioReceiver,
        toggle: toggleAudioReceiver,
      },
      {
        id: "teleco",
        label: "Teleco制御",
        visible: showTeleco,
        toggle: toggleTeleco,
      },
      {
        id: "video-sender",
        label: "映像送信",
        visible: showVideoSender,
        toggle: toggleVideoSender,
      },
      {
        id: "video-receiver",
        label: "映像受信",
        visible: showVideoReceiver,
        toggle: toggleVideoReceiver,
      },
    ],
    [
      showAudioReceiver,
      showAudioSender,
      showTeleco,
      showVideoReceiver,
      showVideoSender,
      toggleAudioReceiver,
      toggleAudioSender,
      toggleTeleco,
      toggleVideoReceiver,
      toggleVideoSender,
    ],
  );

  return {
    showAudioSender,
    showAudioReceiver,
    showTeleco,
    showVideoSender,
    showVideoReceiver,
    panelToggleItems,
  };
}
