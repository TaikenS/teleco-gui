"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  videoDeviceId?: string;
};

export default function VideoPreview({ videoDeviceId }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const [fps, setFps] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  const start = async () => {
    try {
      setError(null);
      setIsStarting(true);

      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }

      const constraints: MediaStreamConstraints = {
        video: videoDeviceId
            ? { deviceId: { exact: videoDeviceId } }
            : {
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
        audio: false,
      };

      const mediaStream =
          await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      resetStats();
    } catch (e) {
      console.error(e);
      setError(
          "カメラの取得に失敗しました。ブラウザの権限設定を確認してください。",
      );
    } finally {
      setIsStarting(false);
    }
  };

  const stop = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    resetStats();
  };

  const resetStats = () => {
    setFps(null);
    setResolution(null);
    frameCountRef.current = 0;
    lastTimeRef.current = null;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!stream) {
      video.srcObject = null;
      return;
    }

    video.srcObject = stream;
    video.play().catch((err) => {
      console.error(err);
      setError("映像の再生に失敗しました。");
    });
  }, [stream]);

  useEffect(() => {
    let animationId: number;

    const loop = (time: number) => {
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          setResolution((prev) =>
              !prev || prev.width !== w || prev.height !== h
                  ? { width: w, height: h }
                  : prev,
          );
        }

        if (lastTimeRef.current == null) {
          lastTimeRef.current = time;
          frameCountRef.current = 0;
        } else {
          frameCountRef.current += 1;
          const delta = time - lastTimeRef.current;
          if (delta >= 1000) {
            const currentFps = Math.round(
                (frameCountRef.current * 1000) / delta,
            );
            setFps(currentFps);
            frameCountRef.current = 0;
            lastTimeRef.current = time;
          }
        }
      }

      animationId = requestAnimationFrame(loop);
    };

    if (stream) {
      animationId = requestAnimationFrame(loop);
    } else {
      resetStats();
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [stream]);

  useEffect(() => {
    if (!videoDeviceId) return;
    if (!stream) return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDeviceId]);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [stream]);

  const cameraOn = !!stream;
  const canStart = !isStarting;
  const canStop = !!stream;

  return (
      <div className="space-y-3">
        <div className="status-chip-row">
          <span className={`status-chip ${cameraOn ? "is-on" : isStarting ? "is-busy" : "is-off"}`}>
            Camera {cameraOn ? "ON" : isStarting ? "STARTING" : "OFF"}
          </span>
          <span className={`status-chip ${fps != null ? "is-on" : cameraOn ? "is-busy" : "is-off"}`}>
            Monitor {fps != null ? "ACTIVE" : cameraOn ? "WARMUP" : "IDLE"}
          </span>
        </div>

        <p className="action-state-hint" role="status" aria-live="polite">
          {!cameraOn ? "次の操作: カメラ開始" : "現在: プレビュー表示中です（クリックでフルスクリーン）"}
        </p>

        <div
            className="w-full h-[60vh] max-h-[70vh] overflow-hidden rounded-xl bg-slate-200 cursor-pointer"
            title="クリックでフルスクリーン切替"
            onClick={() => {
              const el = videoRef.current;
              if (!el) return;
              if (document.fullscreenElement) {
                void document.exitFullscreen();
              } else {
                void el.requestFullscreen();
              }
            }}
        >
          <video
              ref={videoRef}
              className="h-full w-full object-contain"
              muted
              playsInline
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="action-button-wrap">
            <button
                type="button"
                onClick={start}
                disabled={!canStart}
                className="action-button rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
                data-busy={isStarting ? "1" : "0"}
                aria-busy={isStarting}
            >
              {isStarting ? "起動中..." : cameraOn ? "カメラ再起動" : "カメラ開始"}
            </button>
            <p className={`button-reason ${canStart ? "is-ready" : "is-disabled"}`}>
              {isStarting ? "カメラ起動処理中です" : cameraOn ? "現在の設定で再起動できます" : "カメラを起動できます"}
            </p>
          </div>

          <div className="action-button-wrap">
            <button
                type="button"
                onClick={stop}
                disabled={!canStop}
                className="action-button rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-900"
            >
              停止
            </button>
            <p className={`button-reason ${canStop ? "is-ready" : "is-disabled"}`}>
              {canStop ? "プレビューを停止できます" : "停止対象がありません"}
            </p>
          </div>

          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span>FPS: {fps ?? "--"}</span>
          <span>
          解像度:{" "}
            {resolution ? `${resolution.width} x ${resolution.height}` : "--"}
        </span>
        </div>
      </div>
  );
}
