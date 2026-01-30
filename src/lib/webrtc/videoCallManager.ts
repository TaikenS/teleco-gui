// videoCallManager.ts
import {
  type CallVideoRequestMessage,
  type VideoIceCandidateMessage,
  type SignalingMessage,
  generateCallToken,
  type DestinationId,
} from "./signalingTypes";

type SendFunction = (msg: SignalingMessage) => void;

export interface VideoCallOptions {
  rtcConfig?: RTCConfiguration;
}

/**
 * GUI 側で WebRTC を管理するクラス（学習用簡易版）
 * - callVideoRequest: teleco に「映像ちょうだい」と依頼する
 * - handleIncomingMessage: teleco からの answer / ICE を処理する
 */
export class VideoCallManager {
  private peers = new Map<string, RTCPeerConnection>();
  private streams = new Map<string, MediaStream>();
  private rtcConfig: RTCConfiguration;

  constructor(options: VideoCallOptions = {}) {
    this.rtcConfig = options.rtcConfig ?? {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };
  }

  /**
   * GUI -> teleco: 映像リクエストを送る
   *
   * @param track GUI 側のダミー映像トラック（相手に本物を送ってもらうための m-line 用）
   * @param destination 例: "teleco001"
   * @param sendFn MQTT publish 用関数
   * @param onRemoteStream リモート映像が届いたら呼ぶ callback
   */
  async callVideoRequest(
    track: MediaStreamTrack,
    destination: DestinationId,
    sendFn: SendFunction,
    onRemoteStream: (stream: MediaStream) => void,
  ): Promise<string> {
    const id = generateCallToken();
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peers.set(id, pc);

    // ダミーの映像トラックを乗せる（昔の devices.get_video_track()）
    pc.addTrack(track);

    // リモート映像を受け取る
    pc.ontrack = (event) => {
      let stream = this.streams.get(id);
      if (!stream) {
        stream = event.streams[0] ?? new MediaStream();
        this.streams.set(id, stream);
      }

      if (event.streams[0]) {
        stream = event.streams[0];
        this.streams.set(id, stream);
      } else {
        stream.addTrack(event.track);
      }

      onRemoteStream(stream);
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) {
        return;
      }
      const msg: VideoIceCandidateMessage = {
        label: "videoIceCandidateresponse",
        destination,
        id_call_token: id,
        candidate: ev.candidate.toJSON(),
      };
      sendFn(msg);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const msg: CallVideoRequestMessage = {
      label: "callVideoRequest",
      destination,
      id_call_token: id,
      sdp: {
        type: offer.type,
        sdp: offer.sdp ?? "",
      },
    };
    sendFn(msg);

    return id;
  }

  /**
   * teleco 側からの answer / ICE を受け取って処理する。
   *
   * @param msg MQTT 経由で受け取った SignalingMessage
   */
  async handleIncomingMessage(msg: SignalingMessage): Promise<void> {
    const pc = this.peers.get(msg.id_call_token);
    if (!pc) {
      return;
    }

    if (msg.label === "callVideoAnswer") {
      const answer = new RTCSessionDescription(msg.sdp);
      await pc.setRemoteDescription(answer);
    }

    if (msg.label === "videoIceCandidateresponse") {
      const candidate = new RTCIceCandidate(msg.candidate);
      await pc.addIceCandidate(candidate);
    }
  }

  /**
   * 接続終了（GUI 側から通話を切る）
   */
  closeCall(id: string) {
    const pc = this.peers.get(id);
    if (pc) {
      pc.close();
      this.peers.delete(id);
    }
    const stream = this.streams.get(id);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      this.streams.delete(id);
    }
  }
}
