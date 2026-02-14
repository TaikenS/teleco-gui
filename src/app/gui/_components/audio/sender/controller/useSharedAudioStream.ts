import { useRef } from "react";

export function useSharedAudioStream(selectedMicId: string) {
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const usingForWebrtcRef = useRef(false);
  const usingForMicTestRef = useRef(false);

  const ensureSharedStream = async (): Promise<MediaStream> => {
    const current = sharedStreamRef.current;
    const currentTrack = current?.getAudioTracks()?.[0];

    if (current && currentTrack && currentTrack.readyState === "live") {
      return current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: selectedMicId } },
      video: false,
    });

    sharedStreamRef.current = stream;
    return stream;
  };

  const stopSharedStreamIfUnused = () => {
    if (usingForWebrtcRef.current) return;
    if (usingForMicTestRef.current) return;

    const stream = sharedStreamRef.current;
    if (!stream) return;

    stream.getTracks().forEach((track) => track.stop());
    sharedStreamRef.current = null;
  };

  return {
    usingForWebrtcRef,
    usingForMicTestRef,
    ensureSharedStream,
    stopSharedStreamIfUnused,
  };
}
