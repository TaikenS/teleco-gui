import { useEffect, useRef } from "react";
import { useAudioReceiverSignaling } from "@/app/audio/controller/useAudioReceiverSignaling";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import { buildSignalingBaseUrl, buildSignalingUrl } from "@/lib/signaling";

export function useAudioReceiverController() {
  const signaling = useAudioReceiverSignaling();
  const didInitSignalSettingsRef = useRef(false);
  const didEditSignalSettingsRef = useRef(false);

  useEffect(() => {
    if (!didInitSignalSettingsRef.current) return;
    if (!didEditSignalSettingsRef.current) return;
    scheduleEnvLocalSync({
      NEXT_PUBLIC_AUDIO_RECEIVE_SIGNALING_IP_ADDRESS:
        signaling.signalingIpAddress,
      NEXT_PUBLIC_AUDIO_RECEIVE_SIGNALING_PORT: signaling.signalingPort,
    });
  }, [signaling.signalingIpAddress, signaling.signalingPort]);

  useEffect(() => {
    didInitSignalSettingsRef.current = true;
  }, []);

  const canConnect =
    !signaling.connected &&
    !signaling.wsBusy &&
    signaling.roomId.trim().length > 0 &&
    signaling.signalingIpAddress.trim().length > 0 &&
    signaling.signalingPort.trim().length > 0;

  const canDisconnect = signaling.connected || signaling.wsBusy;

  const signalingWsUrlForDisplay = buildSignalingUrl({
    ipAddress: signaling.signalingIpAddress,
    port: signaling.signalingPort,
    roomId: signaling.roomId,
  });

  const signalingBaseUrlForDisplay = buildSignalingBaseUrl({
    ipAddress: signaling.signalingIpAddress,
    port: signaling.signalingPort,
  });

  return {
    ...signaling,
    canConnect,
    canDisconnect,
    signalingWsUrlForDisplay,
    signalingBaseUrlForDisplay,
    setSignalingIpAddress: (value: string) => {
      didEditSignalSettingsRef.current = true;
      signaling.setSignalingIpAddress(value);
    },
    setSignalingPort: (value: string) => {
      didEditSignalSettingsRef.current = true;
      signaling.setSignalingPort(value);
    },
  };
}
