import type { SignalingLabel } from "./signalingTypes";

type JsonObject = Record<string, unknown>;

const SIGNALING_LABELS: readonly SignalingLabel[] = [
  "callVideoRequest",
  "callVideoAnswer",
  "videoIceCandidateresponse",
  "callAudioRequest",
  "callAudioAnswer",
  "audioIceCandidaterequest",
  "audioIceCandidateresponse",
];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function isSignalingLabel(value: unknown): value is SignalingLabel {
  return (
    typeof value === "string" &&
    (SIGNALING_LABELS as readonly string[]).includes(value)
  );
}

function isSdpType(value: unknown): value is RTCSdpType {
  return (
    value === "offer" ||
    value === "answer" ||
    value === "pranswer" ||
    value === "rollback"
  );
}

export function isRtcSessionDescriptionInit(
  value: unknown,
): value is RTCSessionDescriptionInit {
  if (!isObject(value)) return false;
  if (!isSdpType(value.type)) return false;
  if (value.sdp != null && typeof value.sdp !== "string") return false;
  return true;
}

export function isRtcIceCandidateInit(
  value: unknown,
): value is RTCIceCandidateInit {
  if (!isObject(value)) return false;
  if (typeof value.candidate !== "string") return false;
  if (value.sdpMid != null && typeof value.sdpMid !== "string") return false;
  if (value.sdpMLineIndex != null && typeof value.sdpMLineIndex !== "number") {
    return false;
  }
  if (
    value.usernameFragment != null &&
    typeof value.usernameFragment !== "string"
  ) {
    return false;
  }
  return true;
}

export function parseWsJsonData(data: unknown): unknown | null {
  try {
    if (typeof data === "string") {
      return JSON.parse(data) as unknown;
    }

    if (data instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder().decode(data)) as unknown;
    }

    if (ArrayBuffer.isView(data)) {
      return JSON.parse(new TextDecoder().decode(data)) as unknown;
    }
  } catch {
    return null;
  }

  return null;
}

export function isKeepaliveSignalMessage(
  message: unknown,
): message is { type: "__pong" | "keepalive" | "__ping" | "ping" } {
  if (!isObject(message)) return false;
  return (
    message.type === "__pong" ||
    message.type === "keepalive" ||
    message.type === "__ping" ||
    message.type === "ping"
  );
}

export function isLegacyTypedSignalMessage(
  message: unknown,
): message is { type: string } {
  return isObject(message) && typeof message.type === "string";
}

function isRoomRole(value: unknown): value is "sender" | "viewer" {
  return value === "sender" || value === "viewer";
}

function hasValidOptionalRoomFields(message: JsonObject): boolean {
  if (message.roomId != null && typeof message.roomId !== "string") return false;
  if (message.role != null && !isRoomRole(message.role)) return false;
  return true;
}

export interface WsOfferMessage {
  type: "offer";
  payload: RTCSessionDescriptionInit;
  roomId?: string;
  role?: "sender" | "viewer";
}

export interface WsAnswerMessage {
  type: "answer";
  payload: RTCSessionDescriptionInit;
  roomId?: string;
  role?: "sender" | "viewer";
}

export interface WsIceCandidateMessage {
  type: "ice-candidate";
  payload: RTCIceCandidateInit;
  roomId?: string;
  role?: "sender" | "viewer";
}

export function isWsOfferMessage(message: unknown): message is WsOfferMessage {
  if (!isObject(message)) return false;
  if (message.type !== "offer") return false;
  if (!hasValidOptionalRoomFields(message)) return false;
  return isRtcSessionDescriptionInit(message.payload);
}

export function isWsAnswerMessage(message: unknown): message is WsAnswerMessage {
  if (!isObject(message)) return false;
  if (message.type !== "answer") return false;
  if (!hasValidOptionalRoomFields(message)) return false;
  return isRtcSessionDescriptionInit(message.payload);
}

export function isWsIceCandidateMessage(
  message: unknown,
): message is WsIceCandidateMessage {
  if (!isObject(message)) return false;
  if (message.type !== "ice-candidate") return false;
  if (!hasValidOptionalRoomFields(message)) return false;
  return isRtcIceCandidateInit(message.payload);
}

export interface WsLabelMessage {
  label: SignalingLabel;
  destination?: string;
  id_call_token?: string;
}

export function isWsLabelMessage(message: unknown): message is WsLabelMessage {
  if (!isObject(message)) return false;
  if (!isSignalingLabel(message.label)) return false;
  if (message.destination != null && typeof message.destination !== "string") {
    return false;
  }
  if (
    message.id_call_token != null &&
    typeof message.id_call_token !== "string"
  ) {
    return false;
  }
  return true;
}

export interface WsAudioRequestMessage extends WsLabelMessage {
  label: "callAudioRequest";
  id_call_token: string;
  sdp: RTCSessionDescriptionInit;
}

export interface WsAudioIceRequestMessage extends WsLabelMessage {
  label: "audioIceCandidaterequest";
  id_call_token: string;
  candidate: RTCIceCandidateInit;
}

export function isWsAudioRequestMessage(
  message: unknown,
): message is WsAudioRequestMessage {
  if (!isWsLabelMessage(message)) return false;
  if (message.label !== "callAudioRequest") return false;
  if (!message.id_call_token) return false;
  const payload = message as unknown as JsonObject;
  return isRtcSessionDescriptionInit(payload.sdp);
}

export function isWsAudioIceRequestMessage(
  message: unknown,
): message is WsAudioIceRequestMessage {
  if (!isWsLabelMessage(message)) return false;
  if (message.label !== "audioIceCandidaterequest") return false;
  if (!message.id_call_token) return false;
  const payload = message as unknown as JsonObject;
  return isRtcIceCandidateInit(payload.candidate);
}
