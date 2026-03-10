"use client";

import { useRef } from "react";
import { TELECO_HEADING_EVENT } from "@/app/gui/components/audio/sender/controller/constants";
import type {
  TelecoArrowDirection,
  Vowel,
} from "@/app/gui/components/audio/sender/controller/types";

type SendCommand = (
  obj: unknown,
  options?: { silentIfDisconnected?: boolean },
) => boolean;

type Args = {
  sendCommand: SendCommand;
  logCommand: (line: string) => void;
  enableFaceCommandSend: boolean;
  enableMoveMultiSend: boolean;
  mouthSendFps: number;
  clientId: string;
};

export function useTelecoCommandActions({
  sendCommand,
  logCommand,
  enableFaceCommandSend,
  enableMoveMultiSend,
  mouthSendFps,
  clientId,
}: Args) {
  const lastVowelRef = useRef<Vowel>("xn");
  const lastSendMsRef = useRef<number>(0);
  const mouthPositiveSideRef = useRef<boolean>(true);

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
      if (
        !force &&
        !vowelChanged &&
        now - lastSendMsRef.current < minInterval
      ) {
        return;
      }

      const faceSent = enableFaceCommandSend
        ? sendCommand(
            {
              label: "faceCommand",
              commandFace: "change_mouth_vowel",
              vowel,
              clientId,
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
            clientId,
            ts: Date.now(),
          },
          { silentIfDisconnected: true },
        )
      : false;
    const moveSent = enableMoveMultiSend
      ? sendCommand(
          {
            label: "move_multi",
            joints: [2, 4],
            angles: openAngles,
            speeds: [50, 50],
            dontsendback: true,
          },
          { silentIfDisconnected: true },
        )
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

  function sendFaceCommandPreset(
    commandFace: "blink_start" | "blink_stop" | "init_face",
  ) {
    sendCommand({
      label: "faceCommand",
      commandFace,
    });
  }

  return {
    lastVowelRef,
    sendMouthVowel,
    sendArrowMove,
    sendInitializePose,
    sendFaceCommandPreset,
  };
}
