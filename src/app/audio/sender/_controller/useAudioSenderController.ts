import { useEffect } from "react";
import { useAudioSenderSignaling } from "@/app/audio/sender/_controller/useAudioSenderSignaling";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import { buildSignalingBaseUrl, buildSignalingUrl } from "@/lib/signaling";

export function useAudioSenderController() {
  const signaling = useAudioSenderSignaling();

  useEffect(() => {
    scheduleEnvLocalSync({
      NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS: signaling.signalingIpAddress,
      NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT: signaling.signalingPort,
    });
  }, [signaling.signalingIpAddress, signaling.signalingPort]);

  const sendLive =
    signaling.rtcState === "connected" || signaling.rtcState === "connecting";

  const canConnectSignal =
    !signaling.connected &&
    !signaling.wsBusy &&
    signaling.roomId.trim().length > 0 &&
    signaling.signalingIpAddress.trim().length > 0 &&
    signaling.signalingPort.trim().length > 0;

  const canStartSend =
    signaling.micReady &&
    signaling.connected &&
    signaling.sendEnabled &&
    !signaling.sendBusy &&
    !sendLive;

  const canStopConnection =
    signaling.connected || signaling.wsBusy || signaling.sendBusy || sendLive;

  const canStartMic = !signaling.micBusy;

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
    canConnectSignal,
    canStartSend,
    canStopConnection,
    canStartMic,
    signalingWsUrlForDisplay,
    signalingBaseUrlForDisplay,
  };
}
