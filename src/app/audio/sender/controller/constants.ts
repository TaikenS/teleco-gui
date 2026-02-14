import {
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
} from "@/lib/signaling";

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
export const WS_KEEPALIVE_MS = 10_000;

export const STORAGE_KEYS = {
  roomId: "teleco.audioSender.roomId",
  signalingIpAddress: "teleco.audioSender.signalingIpAddress",
  signalingPort: "teleco.audioSender.signalingPort",
  signalingWsUrlLegacy: "teleco.audioSender.signalingWsUrl",
  sendEnabled: "teleco.audioSender.sendEnabled",
  autoConnect: "teleco.audioSender.autoConnect",
  micActive: "teleco.audioSender.micActive",
  sendingActive: "teleco.audioSender.sendingActive",
} as const;

const AUDIO_SEND_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_SENDER_SIGNALING_IP_ADDRESS",
];

const AUDIO_SEND_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_AUDIO_SENDER_SIGNALING_PORT",
];

export const DEFAULT_AUDIO_ROOM =
  process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM || "audio1";

export const DEFAULT_SIGNALING_IP_ADDRESS = getDefaultSignalingIpAddress({
  envKeys: AUDIO_SEND_SIGNALING_IP_ENV_KEYS,
});

export const DEFAULT_SIGNALING_PORT = getDefaultSignalingPort({
  envKeys: AUDIO_SEND_SIGNALING_PORT_ENV_KEYS,
});
