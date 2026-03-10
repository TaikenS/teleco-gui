import {
  DEFAULT_VIDEO_ROOM,
  HAS_DEFAULT_VIDEO_ROOM_ENV,
} from "@/app/gui/constants";
import {
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
} from "@/lib/signaling";

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export const VIDEO_SENDER_STORAGE = {
  roomId: "teleco.video.roomId",
  signalingIpAddress: "teleco.video.signalingIpAddress",
  signalingPort: "teleco.video.signalingPort",
  signalingWsUrlLegacy: "teleco.video.signalingWsUrl",
  autoConnect: "teleco.video.autoConnect",
  cameraActive: "teleco.video.cameraActive",
  streamingActive: "teleco.video.streamingActive",
  cameraDeviceId: "teleco.video.cameraDeviceId",
} as const;

const LEGACY_VIDEO_SENDER_STORAGE = {
  roomId: "teleco.sender.roomId",
  signalingIpAddress: "teleco.sender.signalingIpAddress",
  signalingPort: "teleco.sender.signalingPort",
  signalingWsUrlLegacy: "teleco.sender.signalingWsUrl",
  autoConnect: "teleco.sender.autoConnect",
  cameraActive: "teleco.sender.cameraActive",
  streamingActive: "teleco.sender.streamingActive",
  cameraDeviceId: "teleco.sender.cameraDeviceId",
} as const;

export const VIDEO_SEND_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_IP_ADDRESS",
];

export const VIDEO_SEND_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_PORT",
];

export const HAS_VIDEO_SIGNALING_IP_ENV = VIDEO_SEND_SIGNALING_IP_ENV_KEYS.some(
  (key) => !!process.env[key]?.trim(),
);

export const HAS_VIDEO_SIGNALING_PORT_ENV =
  VIDEO_SEND_SIGNALING_PORT_ENV_KEYS.some((key) => !!process.env[key]?.trim());

export const DEFAULT_VIDEO_SIGNALING_IP_ADDRESS = getDefaultSignalingIpAddress({
  envKeys: VIDEO_SEND_SIGNALING_IP_ENV_KEYS,
});

export const DEFAULT_VIDEO_SIGNALING_PORT = getDefaultSignalingPort({
  envKeys: VIDEO_SEND_SIGNALING_PORT_ENV_KEYS,
});

export const VIDEO_SENDER_WS_KEEPALIVE_MS = 10_000;

export {
  DEFAULT_VIDEO_ROOM,
  HAS_DEFAULT_VIDEO_ROOM_ENV,
  LEGACY_VIDEO_SENDER_STORAGE,
};

export function getStoredVideoSenderValue(
  key: keyof typeof VIDEO_SENDER_STORAGE,
): string | null {
  if (typeof window === "undefined") return null;

  const next = window.localStorage.getItem(VIDEO_SENDER_STORAGE[key]);
  if (next != null) return next;

  return window.localStorage.getItem(LEGACY_VIDEO_SENDER_STORAGE[key]);
}
