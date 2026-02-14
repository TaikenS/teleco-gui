import { useEffect } from "react";
import { useAudioReceiverSignaling } from "@/app/audio/_controller/useAudioReceiverSignaling";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import { buildSignalingBaseUrl, buildSignalingUrl } from "@/lib/signaling";

export function useAudioReceiverController() {
  const signaling = useAudioReceiverSignaling();

  useEffect(() => {
    scheduleEnvLocalSync({
      NEXT_PUBLIC_AUDIO_SIGNALING_IP_ADDRESS: signaling.signalingIpAddress,
      NEXT_PUBLIC_AUDIO_SIGNALING_PORT: signaling.signalingPort,
    });
  }, [signaling.signalingIpAddress, signaling.signalingPort]);

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
  };
}
