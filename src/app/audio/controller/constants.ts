import {
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
} from "@/lib/signaling";

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
export const WS_KEEPALIVE_MS = 10_000;

export const STORAGE_KEYS = {
  roomId: "teleco.audio.roomId",
  signalingIpAddress: "teleco.audio.signalingIpAddress",
  signalingPort: "teleco.audio.signalingPort",
  signalingWsUrlLegacy: "teleco.audio.signalingWsUrl",
  autoConnect: "teleco.audio.autoConnect",
  outputDeviceId: "teleco.audio.outputDeviceId",
} as const;

const AUDIO_SIGNALING_IP_ENV_KEYS = ["NEXT_PUBLIC_AUDIO_SIGNALING_IP_ADDRESS"];
const AUDIO_SIGNALING_PORT_ENV_KEYS = ["NEXT_PUBLIC_AUDIO_SIGNALING_PORT"];

const RAW_DEFAULT_AUDIO_ROOM =
  process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM?.trim() || "";

export const HAS_DEFAULT_AUDIO_ROOM_ENV = RAW_DEFAULT_AUDIO_ROOM.length > 0;
export const DEFAULT_AUDIO_ROOM = RAW_DEFAULT_AUDIO_ROOM || "audio1";

export const DEFAULT_SIGNALING_IP_ADDRESS = getDefaultSignalingIpAddress({
  envKeys: AUDIO_SIGNALING_IP_ENV_KEYS,
});

export const DEFAULT_SIGNALING_PORT = getDefaultSignalingPort({
  envKeys: AUDIO_SIGNALING_PORT_ENV_KEYS,
});
