import {
  getDefaultSignalingIpAddress,
  getDefaultSignalingPort,
} from "@/lib/signaling";

export const TELECO_ARROW_EVENT = "teleco:arrow";

export const STORAGE_KEYS = {
  roomId: "teleco.gui.audio.roomId",
  signalingIpAddress: "teleco.gui.audio.signalingIpAddress",
  signalingPort: "teleco.gui.audio.signalingPort",
  signalingWsUrlLegacy: "teleco.gui.audio.signalWsUrl",
  telecoIpAddress: "teleco.gui.audio.telecoIpAddress",
  telecoPort: "teleco.gui.audio.telecoPort",
  commandWsUrlLegacy: "teleco.gui.audio.commandWsUrl",
  telecoDebugUrlLegacy: "teleco.gui.audio.telecoDebugUrl",
  selectedMicId: "teleco.gui.audio.selectedMicId",
  signalAutoConnect: "teleco.gui.audio.signalAutoConnect",
  commandAutoConnect: "teleco.gui.audio.commandAutoConnect",
  sendingActive: "teleco.gui.audio.sendingActive",
  showMouthPresetPanel: "teleco.gui.audio.showMouthPresetPanel",
  showRawCommandPanel: "teleco.gui.audio.showRawCommandPanel",
} as const;

const AUDIO_SEND_SIGNALING_IP_ENV_KEYS = [
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_SENDER_SIGNALING_IP_ADDRESS",
];

const AUDIO_SEND_SIGNALING_PORT_ENV_KEYS = [
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_AUDIO_SENDER_SIGNALING_PORT",
];

const RAW_DEFAULT_AUDIO_ROOM =
  process.env.NEXT_PUBLIC_GUI_AUDIO_ROOM_ID?.trim() ||
  process.env.NEXT_PUBLIC_DEFAULT_AUDIO_ROOM?.trim() ||
  "";

export const HAS_DEFAULT_AUDIO_ROOM_ENV = RAW_DEFAULT_AUDIO_ROOM.length > 0;
export const DEFAULT_AUDIO_ROOM = RAW_DEFAULT_AUDIO_ROOM || "audio1";

export const DEFAULT_SIGNALING_IP_ADDRESS = getDefaultSignalingIpAddress({
  envKeys: AUDIO_SEND_SIGNALING_IP_ENV_KEYS,
});

export const DEFAULT_SIGNALING_PORT = getDefaultSignalingPort({
  envKeys: AUDIO_SEND_SIGNALING_PORT_ENV_KEYS,
});

export const DEFAULT_TELECO_IP_ADDRESS =
  process.env.NEXT_PUBLIC_TELECO_IP_ADDRESS || "localhost";

export const DEFAULT_TELECO_PORT =
  process.env.NEXT_PUBLIC_TELECO_PORT || "11920";
