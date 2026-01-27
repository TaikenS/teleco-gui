// signalingTypes.ts

// どの teleco / rover 向けか（例: "teleco001"）
export type DestinationId = string

// WebRTC SDP
export interface SdpDescription {
  type: RTCSdpType
  sdp: string
}

// 昔のコードで "label" に入っていた種類
export type SignalingLabel =
  | 'callVideoRequest' // GUI -> teleco: 映像ちょうだい
  | 'callVideoAnswer' // teleco -> GUI: これが answer だよ
  | 'videoIceCandidateresponse' // 双方向: ICE candidate
  // ---- Audio ----
  | 'callAudioRequest' // GUI -> teleco: 音声通話開始 (offer)
  | 'callAudioAnswer' // teleco -> GUI: answer
  | 'audioIceCandidaterequest' // GUI -> teleco: ICE candidate
  | 'audioIceCandidateresponse' // teleco -> GUI: ICE candidate

// 共通メッセージフォーマット
export interface BaseSignalingMessage {
  label: SignalingLabel
  destination: DestinationId
  id_call_token: string // どの PeerConnection の会話かを識別
}

// 映像開始リクエスト (offer)
export interface CallVideoRequestMessage extends BaseSignalingMessage {
  label: 'callVideoRequest'
  sdp: SdpDescription
}

// answer
export interface CallVideoAnswerMessage extends BaseSignalingMessage {
  label: 'callVideoAnswer'
  sdp: SdpDescription
}

// ICE candidate
export interface VideoIceCandidateMessage extends BaseSignalingMessage {
  label: 'videoIceCandidateresponse'
  candidate: RTCIceCandidateInit
}

// ---- Audio messages ----
export interface CallAudioRequestMessage extends BaseSignalingMessage {
  label: 'callAudioRequest'
  sdp: SdpDescription
}

export interface CallAudioAnswerMessage extends BaseSignalingMessage {
  label: 'callAudioAnswer'
  sdp: SdpDescription
}

export interface AudioIceCandidateRequestMessage extends BaseSignalingMessage {
  label: 'audioIceCandidaterequest'
  candidate: RTCIceCandidateInit
}

export interface AudioIceCandidateResponseMessage extends BaseSignalingMessage {
  label: 'audioIceCandidateresponse'
  candidate: RTCIceCandidateInit
}

// 全部まとめた Union
export type SignalingMessage =
  | CallVideoRequestMessage
  | CallVideoAnswerMessage
  | VideoIceCandidateMessage
  | CallAudioRequestMessage
  | CallAudioAnswerMessage
  | AudioIceCandidateRequestMessage
  | AudioIceCandidateResponseMessage

export function generateCallToken(): string {
  return Math.random().toString(36).slice(2)
}
