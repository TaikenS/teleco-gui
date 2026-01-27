// audioCallManager.ts
import {
  type CallAudioRequestMessage,
  type CallAudioAnswerMessage,
  type AudioIceCandidateRequestMessage,
  type AudioIceCandidateResponseMessage,
  type SignalingMessage,
  generateCallToken,
  type DestinationId
} from './signalingTypes';

type SendFunction = (msg: SignalingMessage) => void

export interface AudioCallOptions {
  rtcConfig?: RTCConfiguration
}

/**
 * GUI 側で「音声を送る」WebRTC を管理するクラス。
 * - callAudioRequest: teleco へ offer(SDP) を送り、音声トラックを送信開始
 * - handleIncomingMessage: teleco からの answer / ICE を処理
 */
export class AudioCallManager {
  private peers = new Map<string, RTCPeerConnection>()
  private rtcConfig: RTCConfiguration

  constructor(options: AudioCallOptions = {}) {
    this.rtcConfig = options.rtcConfig ?? {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    }
  }

  async callAudioRequest(
    track: MediaStreamTrack,
    destination: DestinationId,
    sendFn: SendFunction,
    onConnectionState?: (state: RTCPeerConnectionState) => void
  ): Promise<string> {
    const id = generateCallToken()
    const pc = new RTCPeerConnection(this.rtcConfig)
    this.peers.set(id, pc)

    pc.addTrack(track)

    pc.onicecandidate = ev => {
      if (!ev.candidate) {
        return
      }
      const msg: AudioIceCandidateRequestMessage = {
        label: 'audioIceCandidaterequest',
        destination,
        id_call_token: id,
        candidate: ev.candidate.toJSON()
      }
      sendFn(msg)
    }

    pc.onconnectionstatechange = () => {
      onConnectionState?.(pc.connectionState)
    }

    const offer = await pc.createOffer({ offerToReceiveAudio: false })
    await pc.setLocalDescription(offer)

    const msg: CallAudioRequestMessage = {
      label: 'callAudioRequest',
      destination,
      id_call_token: id,
      sdp: {
        type: offer.type,
        sdp: offer.sdp ?? ''
      }
    }
    sendFn(msg)

    return id
  }

  async handleIncomingMessage(msg: SignalingMessage): Promise<void> {
    // 音声系だけ処理
    if (msg.label !== 'callAudioAnswer' && msg.label !== 'audioIceCandidateresponse') {
      return
    }

    const pc = this.peers.get(msg.id_call_token)
    if (!pc) {
      return
    }

    if (msg.label === 'callAudioAnswer') {
      const answer = new RTCSessionDescription((msg as CallAudioAnswerMessage).sdp)
      await pc.setRemoteDescription(answer)
      return
    }

    if (msg.label === 'audioIceCandidateresponse') {
      const candidate = new RTCIceCandidate((msg as AudioIceCandidateResponseMessage).candidate)
      await pc.addIceCandidate(candidate)
    }
  }

  closeCall(id: string) {
    const pc = this.peers.get(id)
    if (pc) {
      pc.close()
      this.peers.delete(id)
    }
  }
}
