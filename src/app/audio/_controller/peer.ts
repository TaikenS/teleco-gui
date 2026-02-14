import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import { STUN_SERVERS } from "@/app/audio/_controller/constants";

export function ensurePeerConnection(params: {
  token: string;
  destination: string;
  pcsRef: MutableRefObject<Map<string, RTCPeerConnection>>;
  streamsRef: MutableRefObject<Map<string, MediaStream>>;
  audioRef: RefObject<HTMLAudioElement | null>;
  setHasAudioTrack: Dispatch<SetStateAction<boolean>>;
  logLine: (line: string) => void;
  sendWs: (obj: unknown) => void;
}) {
  const {
    token,
    destination,
    pcsRef,
    streamsRef,
    audioRef,
    setHasAudioTrack,
    logLine,
    sendWs,
  } = params;

  const existing = pcsRef.current.get(token);
  if (existing) return existing;

  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  pcsRef.current.set(token, pc);

  pc.ontrack = (ev) => {
    let stream = streamsRef.current.get(token);
    if (!stream) {
      stream = new MediaStream();
      streamsRef.current.set(token, stream);
    }
    stream.addTrack(ev.track);
    setHasAudioTrack(true);

    const audio = audioRef.current;
    if (audio) {
      audio.srcObject = stream;
      void audio.play().then(
        () => logLine(`audio.play() ok (token=${token})`),
        (e) => logLine(`audio.play() blocked: ${String(e)}`),
      );
    }
    logLine(`ontrack: kind=${ev.track.kind} token=${token}`);
  };

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    sendWs({
      label: "audioIceCandidateresponse",
      destination,
      id_call_token: token,
      candidate: ev.candidate,
    });
    logLine(`ICE -> audioIceCandidateresponse (token=${token})`);
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    logLine(`WebRTC state (token=${token}): ${state}`);

    if (state === "failed" || state === "closed") {
      try {
        pc.close();
      } catch {
        // noop
      }
      pcsRef.current.delete(token);
      streamsRef.current.delete(token);

      if (streamsRef.current.size === 0) {
        setHasAudioTrack(false);
        if (audioRef.current) {
          audioRef.current.srcObject = null;
        }
      }
    }
  };

  return pc;
}
