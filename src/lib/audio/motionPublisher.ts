"use client";

import { BrowserMqttClientWrapper } from "@/lib/mqtt/browserMqttClient";
import { startLipSync } from "./lipsync/lipsyncRunner";
import type { VowelLabel } from "./lipsync/lipsyncRunner";

export type MotionMessage =
  | {
      kind: "mouth";
      ts: number;
      source: "teleco-gui";
      target: string;
      vowel: VowelLabel;
      open: number; // 0..1
      speaking: boolean;
    }
  | {
      kind: "gesture";
      ts: number;
      source: "teleco-gui";
      target: string;
      name: "talk_start" | "talk_stop" | "beat";
      intensity: number; // 0..1
    };

export interface MotionPublisherHandle {
  stop: () => void;
}

function clamp01(x: number) {
  if (x < 0) {
    return 0;
  }
  if (x > 1) {
    return 1;
  }
  return x;
}

export function normalizeTargetId(raw: string): string {
  const mRover = raw.match(/^rover(\d+)$/i);
  if (mRover) {
    return `ROVER-${mRover[1].padStart(3, "0")}`;
  }

  const mTeleco = raw.match(/^teleco(\d+)$/i);
  if (mTeleco) {
    return `teleco-${mTeleco[1].padStart(3, "0")}`;
  }

  return raw;
}

export function startAudioMotionPublisher(params: {
  stream: MediaStream;
  targetId: string; // rover003 / teleco001 / etc
  mqtt: BrowserMqttClientWrapper;
  topicName?: string; // default: `${normalized}/motion`
  mouthHz?: number; // publish rate limit
}): MotionPublisherHandle {
  const target = normalizeTargetId(params.targetId);
  const topicName = params.topicName ?? `${target}/motion`;
  const mouthIntervalMs = Math.max(
    20,
    Math.round(1000 / (params.mouthHz ?? 15)),
  );

  let speaking = false;
  let lastMouthTs = 0;
  let lastRms = 0;
  let lastVowel: VowelLabel = "N";

  // gesture
  let nextBeatAt = 0;

  const handle = startLipSync(params.stream, {
    onRms: (rms) => {
      lastRms = rms;
      const now = Date.now();

      // publish mouth at limited rate
      if (now - lastMouthTs >= mouthIntervalMs) {
        lastMouthTs = now;
        // simple rms -> open mapping (log-ish)
        const open = clamp01(rms * 18); // tweak
        const msg: MotionMessage = {
          kind: "mouth",
          ts: now,
          source: "teleco-gui",
          target,
          vowel: lastVowel,
          open,
          speaking,
        };
        params.mqtt.publish(topicName, msg);
      }

      // beat gesture when speaking and energy present
      if (speaking) {
        if (now >= nextBeatAt && rms > 0.02) {
          nextBeatAt = now + 450 + Math.floor(Math.random() * 450);
          const intensity = clamp01((rms - 0.02) * 20);
          const g: MotionMessage = {
            kind: "gesture",
            ts: now,
            source: "teleco-gui",
            target,
            name: "beat",
            intensity,
          };
          params.mqtt.publish(topicName, g);
        }
      }
    },
    onVowel: (v) => {
      lastVowel = v;
    },
    onSpeakStatus: (s) => {
      const now = Date.now();
      speaking = s === "start";
      nextBeatAt = now + 350;

      const g: MotionMessage = {
        kind: "gesture",
        ts: now,
        source: "teleco-gui",
        target,
        name: s === "start" ? "talk_start" : "talk_stop",
        intensity: 1,
      };
      params.mqtt.publish(topicName, g);
    },
  });

  return {
    stop: () => {
      handle.stop();
    },
  };
}
