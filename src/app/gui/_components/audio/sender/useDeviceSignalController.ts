import { buildSignalingBaseUrl, buildSignalingUrl } from "@/lib/signaling";

export function useDeviceSignalController(params: {
  signalingIpAddress: string;
  signalingPort: string;
  roomHint: string;
  signalWsStatus: string;
  callStatus: string;
  selectedMicId: string;
}) {
  const signalConnected = params.signalWsStatus === "接続済み";
  const signalBusy = params.signalWsStatus === "接続中";
  const hasMic = params.selectedMicId.trim().length > 0;

  const callStateLower = params.callStatus.toLowerCase();
  const callActive =
    params.callStatus !== "停止" &&
    !callStateLower.includes("closed") &&
    !callStateLower.includes("failed") &&
    !callStateLower.includes("disconnected");

  const canConnectSignal = !signalConnected && !signalBusy;
  const canDisconnectSignal = signalConnected || signalBusy;
  const canStartSending = signalConnected && hasMic && !callActive;
  const canStopSending = callActive;

  const signalingWsUrlForDisplay = buildSignalingUrl({
    ipAddress: params.signalingIpAddress,
    port: params.signalingPort,
    roomId: params.roomHint,
  });
  const signalingBaseUrlForDisplay = buildSignalingBaseUrl({
    ipAddress: params.signalingIpAddress,
    port: params.signalingPort,
  });

  const hasSignalingTarget =
    params.signalingIpAddress.trim().length > 0 &&
    params.signalingPort.trim().length > 0 &&
    params.roomHint.trim().length > 0;
  const canConnectSignalNow = canConnectSignal && hasSignalingTarget;

  return {
    signalConnected,
    signalBusy,
    hasMic,
    callActive,
    canConnectSignal,
    canDisconnectSignal,
    canStartSending,
    canStopSending,
    signalingWsUrlForDisplay,
    signalingBaseUrlForDisplay,
    hasSignalingTarget,
    canConnectSignalNow,
  };
}
