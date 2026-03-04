"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  TELECO_ARROW_EVENT,
  TELECO_HEADING_EVENT,
} from "@/app/gui/components/audio/sender/controller/constants";
import { scheduleEnvLocalSync } from "@/lib/envLocalClient";
import type { TelecoArrowDirection } from "@/app/gui/components/audio/sender/controller/types";

type Props = {
  videoDeviceId?: string;
};

const CAMERA_PRESET_ENV_KEYS = {
  leftExposure: "NEXT_PUBLIC_CAMERA_LEFT_EXPOSURE_COMPENSATION",
  rightExposure: "NEXT_PUBLIC_CAMERA_RIGHT_EXPOSURE_COMPENSATION",
  leftBrightness: "NEXT_PUBLIC_CAMERA_LEFT_BRIGHTNESS",
  rightBrightness: "NEXT_PUBLIC_CAMERA_RIGHT_BRIGHTNESS",
  headingStep: "NEXT_PUBLIC_CAMERA_HEADING_STEP",
} as const;

type NumericRange = {
  min: number;
  max: number;
  step: number;
  supported: boolean;
};

const DEFAULT_EXPOSURE_RANGE: NumericRange = {
  min: -5,
  max: 5,
  step: 0.1,
  supported: false,
};

const DEFAULT_BRIGHTNESS_RANGE: NumericRange = {
  min: -64,
  max: 64,
  step: 1,
  supported: false,
};

const DEFAULT_ZOOM_RANGE: NumericRange = {
  min: 1,
  max: 3,
  step: 0.05,
  supported: false,
};

const DEFAULT_FOCUS_RANGE: NumericRange = {
  min: 0,
  max: 1,
  step: 0.01,
  supported: false,
};

const SHARPEN_RANGE = {
  min: 0,
  max: 2,
  step: 0.05,
} as const;

const MAX_SHARPEN_PROCESS_WIDTH = 960;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseFiniteOr(value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumericRange(
  raw: unknown,
  fallback: { min: number; max: number; step: number },
): NumericRange {
  if (!raw || typeof raw !== "object") {
    return { ...fallback, supported: false };
  }

  const candidate = raw as {
    min?: unknown;
    max?: unknown;
    step?: unknown;
  };

  const min = Number(candidate.min);
  const max = Number(candidate.max);
  const step = Number(candidate.step ?? fallback.step);

  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return { ...fallback, supported: false };
  }

  return {
    min,
    max,
    step: Number.isFinite(step) && step > 0 ? step : fallback.step,
    supported: true,
  };
}

function interpolateByHeading(
  leftValue: number,
  rightValue: number,
  heading: number,
): number {
  const normalized = clamp((heading + 1) / 2, 0, 1);
  return leftValue + (rightValue - leftValue) * normalized;
}

function headingLabel(heading: number): "LEFT" | "CENTER" | "RIGHT" {
  if (heading <= -0.33) return "LEFT";
  if (heading >= 0.33) return "RIGHT";
  return "CENTER";
}

export default function LocalCameraStream({ videoDeviceId }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sharpenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sharpenWorkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const didLoadEnvRef = useRef(false);

  const [fps, setFps] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [heading, setHeading] = useState(0);
  const [headingStep, setHeadingStep] = useState(0.25);
  const [leftExposure, setLeftExposure] = useState(0);
  const [rightExposure, setRightExposure] = useState(0);
  const [leftBrightness, setLeftBrightness] = useState(0);
  const [rightBrightness, setRightBrightness] = useState(0);
  const [exposureRange, setExposureRange] = useState<NumericRange>(
    DEFAULT_EXPOSURE_RANGE,
  );
  const [brightnessRange, setBrightnessRange] = useState<NumericRange>(
    DEFAULT_BRIGHTNESS_RANGE,
  );
  const [manualExposureSupported, setManualExposureSupported] = useState(false);
  const [zoomRange, setZoomRange] = useState<NumericRange>(DEFAULT_ZOOM_RANGE);
  const [zoomValue, setZoomValue] = useState(1);
  const [focusRange, setFocusRange] = useState<NumericRange>(DEFAULT_FOCUS_RANGE);
  const [focusValue, setFocusValue] = useState(0.5);
  const [manualFocusSupported, setManualFocusSupported] = useState(false);
  const [sharpenAmount, setSharpenAmount] = useState(0);
  const [applyStatus, setApplyStatus] = useState<string>("未適用");
  const [appliedExposure, setAppliedExposure] = useState<number | null>(null);
  const [appliedBrightness, setAppliedBrightness] = useState<number | null>(null);
  const [appliedZoom, setAppliedZoom] = useState<number | null>(null);
  const [appliedFocus, setAppliedFocus] = useState<number | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const lastApplySignatureRef = useRef("");

  const setCapabilityFromTrack = (track: MediaStreamTrack | null) => {
    const caps = (track?.getCapabilities?.() ?? {}) as Record<string, unknown>;

    setExposureRange(
      toNumericRange(caps.exposureCompensation, {
        min: DEFAULT_EXPOSURE_RANGE.min,
        max: DEFAULT_EXPOSURE_RANGE.max,
        step: DEFAULT_EXPOSURE_RANGE.step,
      }),
    );
    setBrightnessRange(
      toNumericRange(caps.brightness, {
        min: DEFAULT_BRIGHTNESS_RANGE.min,
        max: DEFAULT_BRIGHTNESS_RANGE.max,
        step: DEFAULT_BRIGHTNESS_RANGE.step,
      }),
    );
    const nextZoomRange = toNumericRange(caps.zoom, {
      min: DEFAULT_ZOOM_RANGE.min,
      max: DEFAULT_ZOOM_RANGE.max,
      step: DEFAULT_ZOOM_RANGE.step,
    });
    setZoomRange(nextZoomRange);
    setZoomValue((prev) =>
      clamp(prev, nextZoomRange.min, nextZoomRange.max),
    );
    const nextFocusRange = toNumericRange(caps.focusDistance, {
      min: DEFAULT_FOCUS_RANGE.min,
      max: DEFAULT_FOCUS_RANGE.max,
      step: DEFAULT_FOCUS_RANGE.step,
    });
    setFocusRange(nextFocusRange);
    setFocusValue((prev) =>
      clamp(prev, nextFocusRange.min, nextFocusRange.max),
    );

    const exposureModes = Array.isArray(caps.exposureMode)
      ? caps.exposureMode
      : [];
    setManualExposureSupported(exposureModes.includes("manual"));
    const focusModes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
    setManualFocusSupported(focusModes.includes("manual"));
  };

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
      setCapabilityFromTrack(mediaStream.getVideoTracks()[0] ?? null);
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
    setAppliedExposure(null);
    setAppliedBrightness(null);
    setAppliedZoom(null);
    setAppliedFocus(null);
    setApplyStatus("未適用");
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
    const onHeading = (ev: Event) => {
      const detail = (ev as CustomEvent<{ direction?: TelecoArrowDirection }>)
        .detail;
      const direction = detail?.direction;
      if (direction !== "left" && direction !== "right") return;

      setHeading((prev) =>
        clamp(prev + (direction === "left" ? -headingStep : headingStep), -1, 1),
      );
    };

    window.addEventListener(TELECO_HEADING_EVENT, onHeading as EventListener);
    return () => {
      window.removeEventListener(
        TELECO_HEADING_EVENT,
        onHeading as EventListener,
      );
    };
  }, [headingStep]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/env-local", { cache: "no-store" });
        const data = (await res.json()) as {
          values?: Record<string, string>;
        };
        const values = data.values;
        if (!values) return;

        setLeftExposure(
          parseFiniteOr(values[CAMERA_PRESET_ENV_KEYS.leftExposure], 0),
        );
        setRightExposure(
          parseFiniteOr(values[CAMERA_PRESET_ENV_KEYS.rightExposure], 0),
        );
        setLeftBrightness(
          parseFiniteOr(values[CAMERA_PRESET_ENV_KEYS.leftBrightness], 0),
        );
        setRightBrightness(
          parseFiniteOr(values[CAMERA_PRESET_ENV_KEYS.rightBrightness], 0),
        );
        setHeadingStep(
          clamp(parseFiniteOr(values[CAMERA_PRESET_ENV_KEYS.headingStep], 0.25), 0.05, 1),
        );
      } catch {
        // noop
      } finally {
        didLoadEnvRef.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!didLoadEnvRef.current) return;
    scheduleEnvLocalSync({
      [CAMERA_PRESET_ENV_KEYS.leftExposure]: String(leftExposure),
      [CAMERA_PRESET_ENV_KEYS.rightExposure]: String(rightExposure),
      [CAMERA_PRESET_ENV_KEYS.leftBrightness]: String(leftBrightness),
      [CAMERA_PRESET_ENV_KEYS.rightBrightness]: String(rightBrightness),
      [CAMERA_PRESET_ENV_KEYS.headingStep]: String(headingStep),
    });
  }, [headingStep, leftBrightness, leftExposure, rightBrightness, rightExposure]);

  useEffect(() => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const exposureValue = interpolateByHeading(leftExposure, rightExposure, heading);
    const brightnessValue = interpolateByHeading(
      leftBrightness,
      rightBrightness,
      heading,
    );

    const advanced: Record<string, unknown> = {};
    if (manualExposureSupported) {
      advanced.exposureMode = "manual";
    }
    if (exposureRange.supported) {
      advanced.exposureCompensation = clamp(
        exposureValue,
        exposureRange.min,
        exposureRange.max,
      );
    }
    if (brightnessRange.supported) {
      advanced.brightness = clamp(
        brightnessValue,
        brightnessRange.min,
        brightnessRange.max,
      );
    }
    if (zoomRange.supported) {
      advanced.zoom = clamp(zoomValue, zoomRange.min, zoomRange.max);
    }
    if (manualFocusSupported) {
      advanced.focusMode = "manual";
    }
    if (focusRange.supported) {
      advanced.focusDistance = clamp(focusValue, focusRange.min, focusRange.max);
    }

    if (Object.keys(advanced).length === 0) {
      setApplyStatus("このカメラは露出/輝度/ズーム/フォーカスのWeb制御に未対応です");
      return;
    }

    const signature = JSON.stringify(advanced);
    if (lastApplySignatureRef.current === signature) return;

    void track
      .applyConstraints({ advanced: [advanced] })
      .then(() => {
        lastApplySignatureRef.current = signature;
        setAppliedExposure(
          typeof advanced.exposureCompensation === "number"
            ? advanced.exposureCompensation
            : null,
        );
        setAppliedBrightness(
          typeof advanced.brightness === "number" ? advanced.brightness : null,
        );
        setAppliedZoom(typeof advanced.zoom === "number" ? advanced.zoom : null);
        setAppliedFocus(
          typeof advanced.focusDistance === "number"
            ? advanced.focusDistance
            : null,
        );
        setApplyStatus("向きに応じてカメラ設定を適用中");
      })
      .catch((e: unknown) => {
        const name = e instanceof DOMException ? e.name : "UnknownError";
        setApplyStatus(`カメラ設定の適用に失敗: ${name}`);
      });
  }, [
    stream,
    heading,
    leftExposure,
    rightExposure,
    leftBrightness,
    rightBrightness,
    zoomValue,
    focusValue,
    exposureRange,
    brightnessRange,
    zoomRange,
    focusRange,
    manualExposureSupported,
    manualFocusSupported,
  ]);

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
  const useSharpenPreview = sharpenAmount > 0;

  const sendArrowByHorizontalPosition = (
    ev: ReactMouseEvent<HTMLDivElement>,
  ) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const direction: TelecoArrowDirection =
      x <= rect.width / 2 ? "left" : "right";

    window.dispatchEvent(
      new CustomEvent<{ direction: TelecoArrowDirection }>(TELECO_ARROW_EVENT, {
        detail: { direction },
      }),
    );
  };

  useEffect(() => {
    if (!stream || sharpenAmount <= 0) return;

    const video = videoRef.current;
    const outputCanvas = sharpenCanvasRef.current;
    if (!video || !outputCanvas) return;

    if (!sharpenWorkCanvasRef.current) {
      sharpenWorkCanvasRef.current = document.createElement("canvas");
    }
    const workCanvas = sharpenWorkCanvasRef.current;

    const outputCtx = outputCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const workCtx = workCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!outputCtx || !workCtx) return;

    let rafId: number | null = null;
    let lastFrameAt = 0;

    const render = (now: number) => {
      if (!video || video.readyState < 2) {
        rafId = window.requestAnimationFrame(render);
        return;
      }

      if (now - lastFrameAt < 33) {
        rafId = window.requestAnimationFrame(render);
        return;
      }
      lastFrameAt = now;

      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) {
        rafId = window.requestAnimationFrame(render);
        return;
      }

      const scale = Math.min(1, MAX_SHARPEN_PROCESS_WIDTH / sourceWidth);
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

      if (
        outputCanvas.width !== targetWidth ||
        outputCanvas.height !== targetHeight
      ) {
        outputCanvas.width = targetWidth;
        outputCanvas.height = targetHeight;
      }
      if (workCanvas.width !== targetWidth || workCanvas.height !== targetHeight) {
        workCanvas.width = targetWidth;
        workCanvas.height = targetHeight;
      }

      workCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
      const srcImage = workCtx.getImageData(0, 0, targetWidth, targetHeight);
      const src = srcImage.data;
      const dstImage = new ImageData(
        new Uint8ClampedArray(src),
        targetWidth,
        targetHeight,
      );
      const dst = dstImage.data;
      const amount = sharpenAmount * 0.35;

      for (let y = 1; y < targetHeight - 1; y++) {
        for (let x = 1; x < targetWidth - 1; x++) {
          const idx = (y * targetWidth + x) * 4;
          const left = idx - 4;
          const right = idx + 4;
          const up = idx - targetWidth * 4;
          const down = idx + targetWidth * 4;

          for (let c = 0; c < 3; c++) {
            const value =
              src[idx + c] * (1 + 4 * amount) -
              amount *
                (src[left + c] + src[right + c] + src[up + c] + src[down + c]);
            dst[idx + c] = clamp(Math.round(value), 0, 255);
          }
        }
      }

      outputCtx.putImageData(dstImage, 0, 0);
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [stream, sharpenAmount]);

  return (
    <div className="space-y-3">
      <div className="status-chip-row">
        <span
          className={`status-chip ${cameraOn ? "is-on" : isStarting ? "is-busy" : "is-off"}`}
        >
          Camera {cameraOn ? "ON" : isStarting ? "STARTING" : "OFF"}
        </span>
        <span
          className={`status-chip ${fps != null ? "is-on" : cameraOn ? "is-busy" : "is-off"}`}
        >
          Monitor {fps != null ? "ACTIVE" : cameraOn ? "WARMUP" : "IDLE"}
        </span>
      </div>

      <p className="action-state-hint" role="status" aria-live="polite">
        {!cameraOn
          ? "次の操作: カメラ開始"
          : "現在: プレビュー表示中です（クリックでフルスクリーン）"}
      </p>

      <div className="rounded-xl border bg-slate-50 p-3 space-y-3">
        <div className="status-chip-row">
          <span className={`status-chip ${cameraOn ? "is-on" : "is-off"}`}>
            Heading {headingLabel(heading)}
          </span>
          <span
            className={`status-chip ${exposureRange.supported ? "is-on" : "is-off"}`}
          >
            Exposure {exposureRange.supported ? "SUPPORTED" : "UNSUPPORTED"}
          </span>
          <span
            className={`status-chip ${brightnessRange.supported ? "is-on" : "is-off"}`}
          >
            Brightness {brightnessRange.supported ? "SUPPORTED" : "UNSUPPORTED"}
          </span>
          <span className={`status-chip ${zoomRange.supported ? "is-on" : "is-busy"}`}>
            Zoom {zoomRange.supported ? "SUPPORTED" : "PREVIEW"}
          </span>
          <span className={`status-chip ${manualFocusSupported || focusRange.supported ? "is-on" : "is-off"}`}>
            Focus {manualFocusSupported || focusRange.supported ? "SUPPORTED" : "UNSUPPORTED"}
          </span>
          <span className={`status-chip ${useSharpenPreview ? "is-on" : "is-off"}`}>
            Sharp {useSharpenPreview ? "ACTIVE" : "OFF"}
          </span>
        </div>

        <p className="text-xs text-slate-600">
          左右コマンドに合わせて、左/右プリセットを自動補間して適用します。
          変更値は `.env.local` に保存され、次回起動時に読み込みます。
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-slate-700">
            左向き: 露出補正 ({leftExposure.toFixed(2)})
            <input
              type="range"
              min={exposureRange.min}
              max={exposureRange.max}
              step={exposureRange.step}
              value={leftExposure}
              onChange={(e) => setLeftExposure(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
          <label className="text-xs text-slate-700">
            右向き: 露出補正 ({rightExposure.toFixed(2)})
            <input
              type="range"
              min={exposureRange.min}
              max={exposureRange.max}
              step={exposureRange.step}
              value={rightExposure}
              onChange={(e) => setRightExposure(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>

          <label className="text-xs text-slate-700">
            左向き: 明るさ ({leftBrightness.toFixed(2)})
            <input
              type="range"
              min={brightnessRange.min}
              max={brightnessRange.max}
              step={brightnessRange.step}
              value={leftBrightness}
              onChange={(e) => setLeftBrightness(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
          <label className="text-xs text-slate-700">
            右向き: 明るさ ({rightBrightness.toFixed(2)})
            <input
              type="range"
              min={brightnessRange.min}
              max={brightnessRange.max}
              step={brightnessRange.step}
              value={rightBrightness}
              onChange={(e) => setRightBrightness(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-700">
            拡大縮小 ({zoomValue.toFixed(2)}x)
            <input
              type="range"
              min={zoomRange.supported ? zoomRange.min : 1}
              max={zoomRange.supported ? zoomRange.max : 3}
              step={zoomRange.supported ? zoomRange.step : 0.05}
              value={zoomValue}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const min = zoomRange.supported ? zoomRange.min : 1;
                const max = zoomRange.supported ? zoomRange.max : 3;
                setZoomValue(clamp(raw, min, max));
              }}
              className="mt-1 w-48"
            />
          </label>
          <label className="text-xs text-slate-700">
            フォーカス ({focusValue.toFixed(2)})
            <input
              type="range"
              min={focusRange.min}
              max={focusRange.max}
              step={focusRange.step}
              value={focusValue}
              onChange={(e) => {
                const raw = Number(e.target.value);
                setFocusValue(clamp(raw, focusRange.min, focusRange.max));
              }}
              className="mt-1 w-48"
            />
          </label>
          <label className="text-xs text-slate-700">
            シャープ補正 ({sharpenAmount.toFixed(2)})
            <input
              type="range"
              min={SHARPEN_RANGE.min}
              max={SHARPEN_RANGE.max}
              step={SHARPEN_RANGE.step}
              value={sharpenAmount}
              onChange={(e) =>
                setSharpenAmount(
                  clamp(
                    Number(e.target.value),
                    SHARPEN_RANGE.min,
                    SHARPEN_RANGE.max,
                  ),
                )
              }
              className="mt-1 w-48"
            />
          </label>

          <label className="text-xs text-slate-700">
            向きステップ ({headingStep.toFixed(2)})
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={headingStep}
              onChange={(e) => setHeadingStep(Number(e.target.value))}
              className="mt-1 w-48"
            />
          </label>

          <button
            type="button"
            onClick={() => setHeading(0)}
            className="action-button bg-slate-100 text-sm text-slate-900"
          >
            向き推定を中央に戻す
          </button>
        </div>

        <p className="text-[11px] text-slate-500">
          適用状態: {applyStatus}
          {appliedExposure != null && ` / exposure=${appliedExposure.toFixed(2)}`}
          {appliedBrightness != null &&
            ` / brightness=${appliedBrightness.toFixed(2)}`}
          {appliedZoom != null && ` / zoom=${appliedZoom.toFixed(2)}`}
          {appliedFocus != null && ` / focus=${appliedFocus.toFixed(2)}`}
          {!zoomRange.supported && " / zoom=プレビュー拡大で代替"}
          {!manualFocusSupported && !focusRange.supported && " / focus=未対応"}
          {useSharpenPreview && " / sharpen=プレビュー後段補正"}
        </p>
      </div>

      <div
        ref={frameRef}
        className="relative w-full h-[60vh] max-h-[70vh] overflow-hidden rounded-xl bg-slate-200 cursor-pointer"
        title="クリックでフルスクリーン / 全画面中は左右タップで向きを変更"
        onPointerDown={(ev) => {
          const frame = frameRef.current;
          if (!frame) return;
          if (document.fullscreenElement === frame) {
            sendArrowByHorizontalPosition(ev);
            return;
          }
          if (!document.fullscreenElement) {
            void frame.requestFullscreen();
          }
        }}
      >
        <video
          ref={videoRef}
          className={`h-full w-full object-contain ${useSharpenPreview ? "hidden" : ""}`}
          style={
            zoomRange.supported
              ? undefined
              : { transform: `scale(${zoomValue})`, transformOrigin: "center" }
          }
          muted
          playsInline
        />
        <canvas
          ref={sharpenCanvasRef}
          className={`h-full w-full object-contain ${useSharpenPreview ? "" : "hidden"}`}
          style={
            zoomRange.supported
              ? undefined
              : { transform: `scale(${zoomValue})`, transformOrigin: "center" }
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="action-button-wrap">
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            className="action-button bg-slate-900 text-sm text-white"
            data-busy={isStarting ? "1" : "0"}
            aria-busy={isStarting}
          >
            {isStarting
              ? "起動中..."
              : cameraOn
                ? "カメラ再起動"
                : "カメラ開始"}
          </button>
          <p
            className={`button-reason ${canStart ? "is-ready" : "is-disabled"}`}
          >
            {isStarting
              ? "カメラ起動処理中です"
              : cameraOn
                ? "現在の設定で再起動できます"
                : "カメラを起動できます"}
          </p>
        </div>

        <div className="action-button-wrap">
          <button
            type="button"
            onClick={stop}
            disabled={!canStop}
            className="action-button bg-slate-100 text-sm text-slate-900"
          >
            停止
          </button>
          <p
            className={`button-reason ${canStop ? "is-ready" : "is-disabled"}`}
          >
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
