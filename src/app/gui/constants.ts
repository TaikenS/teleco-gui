import {
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
} from "@/lib/signaling";

export type VideoSourceMode = "local" | "webSender";

export const VIDEO_MODE_STORAGE_KEY = "teleco.gui.videoMode";
export const VIDEO_ROOM_STORAGE_KEY = "teleco.gui.video.roomId";
export const VIDEO_SIGNAL_IP_ADDRESS_STORAGE_KEY =
  "teleco.gui.video.signalingIpAddress";
export const VIDEO_SIGNAL_PORT_STORAGE_KEY = "teleco.gui.video.signalingPort";
export const VIDEO_RECEIVER_SHOW_LOOKING_LABEL_STORAGE_KEY =
  "teleco.gui.video.receiver.showLookingLabel";
export const VIDEO_RECEIVER_SHOW_DIRECTION_GUIDE_STORAGE_KEY =
  "teleco.gui.video.receiver.showDirectionGuide";
export const VIDEO_RECEIVER_SHOW_CUE_FRAME_STORAGE_KEY =
  "teleco.gui.video.receiver.showCueFrame";

export const PANEL_AUDIO_SENDER_VISIBLE_KEY =
  "teleco.gui.panel.audioSender.visible";
export const PANEL_AUDIO_RECEIVER_VISIBLE_KEY =
  "teleco.gui.panel.audioReceiver.visible";
export const PANEL_TELECO_VISIBLE_KEY = "teleco.gui.panel.teleco.visible";
export const PANEL_VIDEO_SENDER_VISIBLE_KEY =
  "teleco.gui.panel.videoSender.visible";
export const PANEL_VIDEO_RECEIVER_VISIBLE_KEY =
  "teleco.gui.panel.videoReceiver.visible";

const RAW_DEFAULT_VIDEO_ROOM =
  process.env.NEXT_PUBLIC_VIDEO_SENDER_ROOM_ID?.trim() ||
  process.env.NEXT_PUBLIC_DEFAULT_VIDEO_ROOM?.trim() ||
  "";

export const HAS_DEFAULT_VIDEO_ROOM_ENV = RAW_DEFAULT_VIDEO_ROOM.length > 0;
export const DEFAULT_VIDEO_ROOM = RAW_DEFAULT_VIDEO_ROOM || "room1";

export const VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_IP_ADDRESS",
];

export const VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_VIDEO_RECEIVE_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SENDER_SIGNALING_PORT",
];

export const HAS_VIDEO_SIGNALING_IP_ENV =
  VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS.some((key) => !!process.env[key]?.trim());

export const HAS_VIDEO_SIGNALING_PORT_ENV =
  VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS.some(
    (key) => !!process.env[key]?.trim(),
  );

export const DEFAULT_SIGNALING_IP_ADDRESS = getDefaultSignalingIpAddress({
  envKeys: VIDEO_RECEIVE_SIGNALING_IP_ENV_KEYS,
});

export const DEFAULT_SIGNALING_PORT = getDefaultSignalingPort({
  envKeys: VIDEO_RECEIVE_SIGNALING_PORT_ENV_KEYS,
});

export function parseVideoMode(raw: string): VideoSourceMode {
  return raw === "webSender" ? "webSender" : "local";
}
