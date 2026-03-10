"use client";

import { useEffect, useEffectEvent, useState } from "react";
import {
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
} from "@/app/gui/components/audio/sender/controller/constants";
import type { TelecoArrowDirection } from "@/app/gui/components/audio/sender/controller/types";

type Args = {
  enabled: boolean;
  onArrow: (direction: TelecoArrowDirection) => void;
};

export function useTelecoGamepadState({ enabled, onArrow }: Args) {
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [gamepadIndex, setGamepadIndex] = useState<number | null>(null);
  const [gamepadId, setGamepadId] = useState("");
  const [gamepadMapping, setGamepadMapping] = useState("");
  const [gamepadPressedButtons, setGamepadPressedButtons] = useState<number[]>(
    [],
  );
  const [gamepadLtValue, setGamepadLtValue] = useState(0);
  const [gamepadRtValue, setGamepadRtValue] = useState(0);
  const emitArrow = useEffectEvent(onArrow);

  useEffect(() => {
    if (!enabled) return;

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
          emitArrow("left");
          lastSentAt = now;
        } else if (rightPressed && !lastRightPressed && canSend) {
          emitArrow("right");
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
  }, [enabled]);

  return {
    gamepadConnected,
    gamepadIndex,
    gamepadId,
    gamepadMapping,
    gamepadPressedButtons,
    gamepadLtValue,
    gamepadRtValue,
  };
}
