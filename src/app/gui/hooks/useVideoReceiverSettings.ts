"use client";

import React from "react";
import {
  DEFAULT_SIGNALING_IP_ADDRESS,
  DEFAULT_SIGNALING_PORT,
  DEFAULT_VIDEO_ROOM,
  HAS_DEFAULT_VIDEO_ROOM_ENV,
  HAS_VIDEO_SIGNALING_IP_ENV,
  HAS_VIDEO_SIGNALING_PORT_ENV,
  VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS,
  VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS,
  VIDEO_ROOM_STORAGE_KEY,
  VIDEO_SIGNAL_IP_ADDRESS_STORAGE_KEY,
  VIDEO_SIGNAL_PORT_STORAGE_KEY,
} from "@/app/gui/constants";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import { buildSignalingUrl } from "@/lib/signaling";
import { usePersistentState } from "@/lib/usePersistentState";

type EnvLocalResponse = {
  ok?: boolean;
  values?: Record<string, string>;
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

export function useVideoReceiverSettings(): {
  videoRoomId: string;
  effectiveVideoRoomId: string;
  setVideoRoomId: React.Dispatch<React.SetStateAction<string>>;
  videoSignalingIpAddress: string;
  videoSignalingPort: string;
  videoSignalingWsUrl: string;
  onVideoSignalingIpAddressChange: (nextValue: string) => void;
  onVideoSignalingPortChange: (nextValue: string) => void;
} {
  const didInitSettingsRef = React.useRef(false);
  const didEditSignalSettingsRef = React.useRef(false);

  const [videoRoomId, setVideoRoomId] = usePersistentState<string>(
    VIDEO_ROOM_STORAGE_KEY,
    DEFAULT_VIDEO_ROOM,
  );
  const [videoSignalingIpAddress, setVideoSignalingIpAddress] =
    usePersistentState<string>(
      VIDEO_SIGNAL_IP_ADDRESS_STORAGE_KEY,
      DEFAULT_SIGNALING_IP_ADDRESS,
    );
  const [videoSignalingPort, setVideoSignalingPort] =
    usePersistentState<string>(
      VIDEO_SIGNAL_PORT_STORAGE_KEY,
      DEFAULT_SIGNALING_PORT,
    );

  React.useEffect(() => {
    if (!didInitSettingsRef.current || !didEditSignalSettingsRef.current)
      return;

    scheduleEnvLocalSync({
      NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_IP_ADDRESS: videoSignalingIpAddress,
      NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_PORT: videoSignalingPort,
    });
  }, [videoSignalingIpAddress, videoSignalingPort]);

  React.useEffect(() => {
    if (HAS_VIDEO_SIGNALING_IP_ENV) {
      setVideoSignalingIpAddress(DEFAULT_SIGNALING_IP_ADDRESS);
    }
    if (HAS_VIDEO_SIGNALING_PORT_ENV) {
      setVideoSignalingPort(DEFAULT_SIGNALING_PORT);
    }
    didInitSettingsRef.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/env-local", { cache: "no-store" });
        const data = (await res.json()) as EnvLocalResponse;
        const values = data?.values;
        if (!values || cancelled) return;

        if (!didEditSignalSettingsRef.current) {
          const envIp = getFirstValue(
            values,
            VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS,
          );
          const envPort = getFirstValue(
            values,
            VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS,
          );
          if (envIp) setVideoSignalingIpAddress(envIp);
          if (envPort) setVideoSignalingPort(envPort);
        }
      } catch {
        // noop
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setVideoSignalingIpAddress, setVideoSignalingPort]);

  React.useEffect(() => {
    if (!HAS_DEFAULT_VIDEO_ROOM_ENV) return;
    setVideoRoomId(DEFAULT_VIDEO_ROOM);
  }, [setVideoRoomId]);

  const onVideoSignalingIpAddressChange = React.useCallback(
    (nextValue: string) => {
      didEditSignalSettingsRef.current = true;
      setVideoSignalingIpAddress(nextValue);
    },
    [setVideoSignalingIpAddress],
  );

  const onVideoSignalingPortChange = React.useCallback(
    (nextValue: string) => {
      didEditSignalSettingsRef.current = true;
      setVideoSignalingPort(nextValue);
    },
    [setVideoSignalingPort],
  );

  const effectiveVideoRoomId = videoRoomId || DEFAULT_VIDEO_ROOM;

  const videoSignalingWsUrl = React.useMemo(
    () =>
      buildSignalingUrl({
        ipAddress: videoSignalingIpAddress,
        port: videoSignalingPort,
        roomId: effectiveVideoRoomId,
      }),
    [effectiveVideoRoomId, videoSignalingIpAddress, videoSignalingPort],
  );

  return {
    videoRoomId,
    effectiveVideoRoomId,
    setVideoRoomId,
    videoSignalingIpAddress,
    videoSignalingPort,
    videoSignalingWsUrl,
    onVideoSignalingIpAddressChange,
    onVideoSignalingPortChange,
  };
}
