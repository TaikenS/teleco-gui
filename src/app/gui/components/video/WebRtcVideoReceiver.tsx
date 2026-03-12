"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  TELECO_ARROW_EVENT,
  TELECO_HEADING_EVENT,
} from "@/app/gui/components/audio/sender/controller/constants";
import {
  VIDEO_RECEIVER_SHOW_CUE_FRAME_STORAGE_KEY,
  VIDEO_RECEIVER_SHOW_DIRECTION_GUIDE_STORAGE_KEY,
  VIDEO_RECEIVER_SHOW_LOOKING_LABEL_STORAGE_KEY,
} from "@/app/gui/constants";
import { ActionButton, ActionControl } from "@/components/ui/ActionButton";
import { PanelDivider, PanelLog } from "@/components/ui/PanelCommon";
import { getSignalingUrl } from "@/lib/signaling";
import { usePersistentState } from "@/lib/usePersistentState";
import {
  isKeepaliveSignalMessage,
  isWsIceCandidateMessage,
  isWsOfferMessage,
  parseWsJsonData,
} from "@/lib/webrtc/wsMessageUtils";
import type { TelecoArrowDirection } from "@/app/gui/components/audio/sender/controller/types";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const WS_KEEPALIVE_MS = 10_000;
const VIDEO_CUE_ENV_KEYS = {
  common: {
    left: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LEFT_PERCENT",
    top: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_TOP_PERCENT",
    width: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_WIDTH_PERCENT",
    height: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_HEIGHT_PERCENT",
  },
  lookLeft: {
    left: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LOOK_LEFT_LEFT_PERCENT",
    top: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LOOK_LEFT_TOP_PERCENT",
    width: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LOOK_LEFT_WIDTH_PERCENT",
    height: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LOOK_LEFT_HEIGHT_PERCENT",
  },
  lookRight: {
    left: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LOOK_RIGHT_LEFT_PERCENT",
    top: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LOOK_RIGHT_TOP_PERCENT",
    width: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LOOK_RIGHT_WIDTH_PERCENT",
    height: "NEXT_PUBLIC_VIDEO_SPEECH_CUE_FRAME_LOOK_RIGHT_HEIGHT_PERCENT",
  },
} as const;
type VideoCueFrame = {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
};
type VideoCueFrames = {
  common: VideoCueFrame;
  lookLeft: VideoCueFrame;
  lookRight: VideoCueFrame;
};

const DEFAULT_VIDEO_CUE_FRAME: VideoCueFrame = {
  leftPercent: 34,
  topPercent: 10,
  widthPercent: 32,
  heightPercent: 74,
};
const DEFAULT_VIDEO_CUE_FRAMES: VideoCueFrames = {
  common: DEFAULT_VIDEO_CUE_FRAME,
  lookLeft: DEFAULT_VIDEO_CUE_FRAME,
  lookRight: DEFAULT_VIDEO_CUE_FRAME,
};

function clampPercent(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function parsePercentOr(value: string | undefined, fallback: number) {
  return clampPercent(Number(value), fallback);
}

function readCueFrame(
  values: Record<string, string>,
  keys: {
    left: string;
    top: string;
    width: string;
    height: string;
  },
  fallback: VideoCueFrame,
): VideoCueFrame {
  return {
    leftPercent: parsePercentOr(values[keys.left], fallback.leftPercent),
    topPercent: parsePercentOr(values[keys.top], fallback.topPercent),
    widthPercent: parsePercentOr(values[keys.width], fallback.widthPercent),
    heightPercent: parsePercentOr(values[keys.height], fallback.heightPercent),
  };
}

function normalizeWsUrl(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    return getSignalingUrl();
  }

  if (trimmed.startsWith("http://"))
    return `ws://${trimmed.slice("http://".length)}`;
  if (trimmed.startsWith("https://"))
    return `wss://${trimmed.slice("https://".length)}`;

  if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${trimmed.replace(/^\/+/, "")}`;
  }

  return trimmed;
}

function withRoomQuery(wsUrl: string, roomId: string) {
  try {
    const u = new URL(wsUrl);
    if (!u.pathname.endsWith("/ws")) u.pathname = "/ws";
    if (roomId) u.searchParams.set("room", roomId);
    return u.toString();
  } catch {
    const base = wsUrl.endsWith("/ws") ? wsUrl : `${wsUrl}/ws`;
    if (!roomId) return base;
    return `${base}${base.includes("?") ? "&" : "?"}room=${encodeURIComponent(roomId)}`;
  }
}

export default function WebRtcVideoReceiver({
  roomId,
  signalingWsUrl,
  settingsPanel,
}: {
  roomId: string;
  signalingWsUrl?: string;
  settingsPanel?:
    | ReactNode
    | ((state: { connected: boolean; wsBusy: boolean }) => ReactNode);
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualCloseRef = useRef(false);
  const shouldAutoConnectRef = useRef(false);
  const keepaliveTimerRef = useRef<number | null>(null);
  const disconnectedRecoveryTimerRef = useRef<number | null>(null);

  const [connected, setConnected] = useState(false);
  const [wsBusy, setWsBusy] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playRetryNeeded, setPlayRetryNeeded] = useState(false);
  const [headingDirection, setHeadingDirection] =
    useState<TelecoArrowDirection | null>(null);
  const [showLookingLabel, setShowLookingLabel] = usePersistentState<boolean>(
    VIDEO_RECEIVER_SHOW_LOOKING_LABEL_STORAGE_KEY,
    true,
  );
  const [showCueFrame, setShowCueFrame] = usePersistentState<boolean>(
    VIDEO_RECEIVER_SHOW_CUE_FRAME_STORAGE_KEY,
    true,
  );
  const [showDirectionGuide, setShowDirectionGuide] =
    usePersistentState<boolean>(
      VIDEO_RECEIVER_SHOW_DIRECTION_GUIDE_STORAGE_KEY,
      true,
    );
  const [cueFrames, setCueFrames] = useState(DEFAULT_VIDEO_CUE_FRAMES);
  const [fps, setFps] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  const logLine = (line: string) =>
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const dispatchArrow = (direction: TelecoArrowDirection) => {
    window.dispatchEvent(
      new CustomEvent<{ direction: TelecoArrowDirection }>(TELECO_ARROW_EVENT, {
        detail: { direction },
      }),
    );
  };

  const sendArrowByHorizontalPosition = (
    ev: ReactMouseEvent<HTMLDivElement>,
  ) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const direction: TelecoArrowDirection =
      x <= rect.width / 2 ? "left" : "right";

    dispatchArrow(direction);
  };

  const tryPlayRemoteVideo = async () => {
    const video = remoteVideoRef.current;
    if (!video) return;

    try {
      await video.play();
      setPlayRetryNeeded(false);
      logLine("リモート映像再生開始");
    } catch (e) {
      console.error(e);
      setPlayRetryNeeded(true);
      logLine(`映像再生待機: ${String(e)}`);
    }
  };

  const stopKeepalive = () => {
    if (keepaliveTimerRef.current != null) {
      window.clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
  };

  const startKeepalive = (ws: WebSocket) => {
    stopKeepalive();
    keepaliveTimerRef.current = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: "keepalive", roomId, ts: Date.now() }));
      } catch {
        // noop
      }
    }, WS_KEEPALIVE_MS);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const clearDisconnectedRecoveryTimer = () => {
    if (disconnectedRecoveryTimerRef.current != null) {
      window.clearTimeout(disconnectedRecoveryTimerRef.current);
      disconnectedRecoveryTimerRef.current = null;
    }
  };

  const closePeer = () => {
    clearDisconnectedRecoveryTimer();

    const pc = pcRef.current;
    if (!pc) return;

    try {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
    } catch {
      // noop
    }

    pcRef.current = null;
  };

  const sendJoin = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ type: "join", roomId, role: "viewer" }));
    logLine("join 送信(viewer)");
  };

  const createPeer = () => {
    closePeer();

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      const video = remoteVideoRef.current;
      if (video) {
        video.srcObject = remoteStream;
        void tryPlayRemoteVideo();
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      ws.send(
        JSON.stringify({
          type: "ice-candidate",
          roomId,
          role: "viewer",
          payload: event.candidate,
        }),
      );
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      logLine(`WebRTC状態: ${state}`);

      if (state === "failed" || state === "closed") {
        closePeer();

        // シグナリングが生きていれば再待機状態へ戻す
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          createPeer();
          sendJoin();
        }
        return;
      }

      if (state === "disconnected") {
        clearDisconnectedRecoveryTimer();
        disconnectedRecoveryTimerRef.current = window.setTimeout(() => {
          const cur = pcRef.current;
          if (!cur) return;
          if (cur.connectionState !== "disconnected") return;

          logLine("WebRTC disconnected が継続したため待機再初期化");
          closePeer();

          if (wsRef.current?.readyState === WebSocket.OPEN) {
            createPeer();
            sendJoin();
          }
        }, 5_000);
      } else {
        clearDisconnectedRecoveryTimer();
      }
    };

    return pc;
  };

  const scheduleReconnect = () => {
    if (manualCloseRef.current) return;
    if (!shouldAutoConnectRef.current) return;
    clearReconnectTimer();

    const waitMs = Math.min(15_000, 1000 * 2 ** reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    logLine(`シグナリング再接続を予約 (${Math.round(waitMs / 1000)}s)`);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectSignaling(true);
    }, waitMs);
  };

  const connectSignaling = (isReconnect = false) => {
    if (manualCloseRef.current) return;

    const current = wsRef.current;
    if (
      current &&
      (current.readyState === WebSocket.OPEN ||
        current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    setWsBusy(true);

    clearReconnectTimer();

    // ws再接続だけでメディアが維持されるケースを優先。
    // peerが無い場合のみ再作成。
    if (
      !pcRef.current ||
      pcRef.current.connectionState === "closed" ||
      pcRef.current.connectionState === "failed"
    ) {
      createPeer();
    }

    const base = normalizeWsUrl(signalingWsUrl || getSignalingUrl(roomId));
    const url = withRoomQuery(base, roomId);

    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      setError(`無効なSignal URLです: ${url}`);
      setWsBusy(false);
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      setError(null);
      setConnected(true);
      setWsBusy(false);
      logLine(
        `${isReconnect ? "シグナリング再接続" : "シグナリング接続"}: ${url}`,
      );
      startKeepalive(ws);
      sendJoin();
    };

    ws.onmessage = async (event) => {
      const msg = parseWsJsonData(event.data);
      if (!msg) {
        logLine("不正なシグナリングメッセージを無視しました");
        return;
      }

      if (isKeepaliveSignalMessage(msg)) {
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (isWsOfferMessage(msg)) {
        logLine("sender から offer 受信");
        try {
          const desc = new RTCSessionDescription(msg.payload);
          await pc.setRemoteDescription(desc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          ws.send(
            JSON.stringify({
              type: "answer",
              roomId,
              role: "viewer",
              payload: answer,
            }),
          );
          logLine("answer 送信");
        } catch (e) {
          console.error(e);
          logLine(`offer処理失敗: ${String(e)}`);
        }
      } else if (isWsIceCandidateMessage(msg)) {
        try {
          await pc.addIceCandidate(msg.payload);
        } catch (e) {
          console.error(e);
        }
      }
    };

    ws.onerror = (e) => {
      console.error(e);
      setError("シグナリングサーバへの接続に失敗しました");
      setWsBusy(false);
    };

    ws.onclose = (ev) => {
      stopKeepalive();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      setConnected(false);
      setWsBusy(false);

      logLine(
        `シグナリング切断 code=${ev.code} reason=${ev.reason || "(none)"}`,
      );

      // ここでpeerを閉じない: 一時的なWS断でもメディアを維持する
      scheduleReconnect();
    };
  };

  const disconnectSignaling = () => {
    shouldAutoConnectRef.current = false;
    manualCloseRef.current = true;
    clearReconnectTimer();
    stopKeepalive();

    const ws = wsRef.current;
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch {
        // noop
      }
    }
    wsRef.current = null;
    setConnected(false);
    setWsBusy(false);
    closePeer();
    logLine("シグナリング手動切断");
  };

  const handleConnectSignaling = () => {
    manualCloseRef.current = false;
    shouldAutoConnectRef.current = true;
    reconnectAttemptRef.current = 0;
    connectSignaling(false);
  };

  const canConnectSignaling = !connected && !wsBusy;
  const canDisconnectSignaling = connected || wsBusy;
  const connectReason = canConnectSignaling
    ? "シグナリングへ接続できます"
    : connected
      ? "すでに接続中です"
      : "シグナリング接続処理中です";
  const disconnectReason = canDisconnectSignaling
    ? "シグナリング接続を停止できます"
    : "シグナリングは未接続です";
  const resolvedSettingsPanel =
    typeof settingsPanel === "function"
      ? settingsPanel({ connected, wsBusy })
      : settingsPanel;

  // シグナリング復旧ハンドリング
  useEffect(() => {
    manualCloseRef.current = false;
    if (shouldAutoConnectRef.current) {
      connectSignaling(false);
    }

    const recoverIfNeeded = () => {
      if (manualCloseRef.current) return;
      if (!shouldAutoConnectRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connectSignaling(true);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recoverIfNeeded();
      }
    };

    const onOnline = () => {
      recoverIfNeeded();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onVisibilityChange);

    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      stopKeepalive();

      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("fullscreenchange", onVisibilityChange);

      closePeer();
      stopKeepalive();
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {
          // noop
        }
      }
      wsRef.current = null;
      setConnected(false);
      setWsBusy(false);
    };
    // roomを変えたら再接続し直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, signalingWsUrl]);

  useEffect(() => {
    const onHeading = (ev: Event) => {
      const detail = (ev as CustomEvent<{ direction?: TelecoArrowDirection }>)
        .detail;
      const direction = detail?.direction;
      if (direction !== "left" && direction !== "right") return;
      setHeadingDirection(direction);
    };

    window.addEventListener(TELECO_HEADING_EVENT, onHeading as EventListener);
    return () => {
      window.removeEventListener(
        TELECO_HEADING_EVENT,
        onHeading as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/env-local", { cache: "no-store" });
        const data = (await res.json()) as {
          values?: Record<string, string>;
        };
        const values = data.values;
        if (!values) return;

        const common = readCueFrame(
          values,
          VIDEO_CUE_ENV_KEYS.common,
          DEFAULT_VIDEO_CUE_FRAME,
        );
        setCueFrames({
          common,
          lookLeft: readCueFrame(values, VIDEO_CUE_ENV_KEYS.lookLeft, common),
          lookRight: readCueFrame(values, VIDEO_CUE_ENV_KEYS.lookRight, common),
        });
      } catch {
        // noop
      }
    })();
  }, []);

  // FPS / 解像度計測
  useEffect(() => {
    let animationId: number | null = null;
    let frameRequestId: number | null = null;
    let cancelled = false;

    const updateResolution = (video: HTMLVideoElement) => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;

      setResolution((prev) =>
        !prev || prev.width !== w || prev.height !== h
          ? { width: w, height: h }
          : prev,
      );
    };

    const updateFps = (timestamp: number) => {
      if (lastTimeRef.current == null) {
        lastTimeRef.current = timestamp;
        frameCountRef.current = 0;
        return;
      }

      frameCountRef.current += 1;
      const delta = timestamp - lastTimeRef.current;
      if (delta < 1000) return;

      const currentFps = Math.round((frameCountRef.current * 1000) / delta);
      setFps(currentFps);
      frameCountRef.current = 0;
      lastTimeRef.current = timestamp;
    };

    const video = remoteVideoRef.current;
    const supportsVideoFrameCallback =
      !!video && typeof video.requestVideoFrameCallback === "function";

    if (video && supportsVideoFrameCallback) {
      const onVideoFrame = (
        _now: number,
        metadata: VideoFrameCallbackMetadata,
      ) => {
        if (cancelled) return;

        updateResolution(video);
        updateFps(metadata.expectedDisplayTime || performance.now());
        frameRequestId = video.requestVideoFrameCallback(onVideoFrame);
      };

      frameRequestId = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      const rafLoop = (time: number) => {
        if (cancelled) return;
        const currentVideo = remoteVideoRef.current;
        if (currentVideo && currentVideo.readyState >= 2) {
          updateResolution(currentVideo);
          updateFps(time);
        }
        animationId = requestAnimationFrame(rafLoop);
      };

      animationId = requestAnimationFrame(rafLoop);
    }

    return () => {
      cancelled = true;
      if (animationId != null) {
        cancelAnimationFrame(animationId);
      }
      if (frameRequestId != null) {
        video?.cancelVideoFrameCallback(frameRequestId);
      }
    };
  }, []);

  const directionCue =
    headingDirection === "right"
      ? {
          frameClass:
            "border-red-500 bg-transparent shadow-[0_0_0_1px_rgba(239,68,68,0.35)]",
          frameLabelClass: "bg-red-500 text-white",
          frameLabel: "右の人を見ています",
          actionLabel: "左の人を見る",
          actionDirection: "left" as const,
          actionAlignClass: "justify-start",
          actionCardClass: "border-transparent bg-transparent text-white shadow-none",
          actionButtonClass: "border-blue-500 text-white",
        }
      : headingDirection === "left"
        ? {
            frameClass:
              "border-blue-500 bg-transparent shadow-[0_0_0_1px_rgba(59,130,246,0.35)]",
            frameLabelClass: "bg-blue-500 text-white",
            frameLabel: "左の人を見ています",
            actionLabel: "右の人を見る",
            actionDirection: "right" as const,
            actionAlignClass: "justify-end",
            actionCardClass: "border-transparent bg-transparent text-white shadow-none",
            actionButtonClass: "border-red-500 text-white",
          }
        : null;
  const activeCueFrame =
    headingDirection === "left"
      ? cueFrames.lookLeft
      : headingDirection === "right"
        ? cueFrames.lookRight
        : cueFrames.common;

  return (
    <div className="space-y-3">
      <div className="status-chip-row">
        <span
          className={`status-chip ${connected ? "is-on" : wsBusy ? "is-busy" : "is-off"}`}
        >
          Signal {connected ? "CONNECTED" : wsBusy ? "CONNECTING" : "OFFLINE"}
        </span>
      </div>

      <p className="action-state-hint" role="status" aria-live="polite">
        {connected ? "現在: 映像受信待機中" : "次の操作: シグナリング接続"}
      </p>

      {resolvedSettingsPanel}

      <div className="grid gap-3 md:grid-cols-2">
        <ActionControl
          isReady={canConnectSignaling}
          reason={connectReason}
          button={{
            onClick: handleConnectSignaling,
            disabled: !canConnectSignaling,
            tone: "primary",
            busy: wsBusy,
            label: "シグナリング接続",
            busyLabel: "シグナリング接続中...",
          }}
        />
        <ActionControl
          isReady={canDisconnectSignaling}
          reason={disconnectReason}
          button={{
            onClick: disconnectSignaling,
            disabled: !canDisconnectSignaling,
            tone: "secondary",
            label: "シグナリング切断",
          }}
        />
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
          ref={remoteVideoRef}
          className="h-full w-full object-contain"
          playsInline
          autoPlay
          muted
        />
        {directionCue && (
          <div className="pointer-events-none absolute inset-0 z-10">
            {(showCueFrame || showLookingLabel) && (
              <div
                className={`absolute rounded-2xl ${showCueFrame ? `border-4 ${directionCue.frameClass}` : ""}`}
                style={{
                  left: `${activeCueFrame.leftPercent}%`,
                  top: `${activeCueFrame.topPercent}%`,
                  width: `${activeCueFrame.widthPercent}%`,
                  height: `${activeCueFrame.heightPercent}%`,
                }}
              >
                {showLookingLabel && (
                  <div
                    className={`absolute -top-3 left-3 rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${directionCue.frameLabelClass}`}
                  >
                    {directionCue.frameLabel}
                  </div>
                )}
              </div>
            )}

            {showDirectionGuide && (
              <div
                className={`absolute inset-x-0 bottom-4 flex px-4 ${directionCue.actionAlignClass}`}
              >
                <div
                  className={`pointer-events-auto flex max-w-[240px] flex-col gap-2 rounded-2xl border px-3 py-3 shadow-lg backdrop-blur ${directionCue.actionCardClass}`}
                >
                  <button
                    type="button"
                    className={`w-full rounded-xl border-2 bg-white/20 px-4 py-2 text-sm font-bold shadow-none backdrop-blur [text-shadow:0_1px_2px_rgba(0,0,0,0.95)] ${directionCue.actionButtonClass}`}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      dispatchArrow(directionCue.actionDirection);
                    }}
                  >
                    {directionCue.actionLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {playRetryNeeded && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
            <ActionButton
              className="pointer-events-auto"
              tone="secondary"
              label="映像再生を再試行"
              onPointerDown={(ev) => {
                ev.stopPropagation();
              }}
              onClick={(ev) => {
                ev.stopPropagation();
                void tryPlayRemoteVideo();
              }}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
        <span>FPS: {fps ?? "--"}</span>
        <span>
          解像度:{" "}
          {resolution ? `${resolution.width} x ${resolution.height}` : "--"}
        </span>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <PanelDivider />
      <div className="toggle-pill-group">
        <button
          type="button"
          className={`toggle-pill ${showCueFrame ? "is-active" : ""}`}
          aria-pressed={showCueFrame}
          onClick={() => setShowCueFrame((v) => !v)}
        >
          枠表示
        </button>
        <button
          type="button"
          className={`toggle-pill ${showLookingLabel ? "is-active" : ""}`}
          aria-pressed={showLookingLabel}
          onClick={() => setShowLookingLabel((v) => !v)}
        >
          誰見てるか表示
        </button>
        <button
          type="button"
          className={`toggle-pill ${showDirectionGuide ? "is-active" : ""}`}
          aria-pressed={showDirectionGuide}
          onClick={() => setShowDirectionGuide((v) => !v)}
        >
          左右案内表示
        </button>
        <button
          type="button"
          className={`toggle-pill ${showLogPanel ? "is-active" : ""}`}
          aria-pressed={showLogPanel}
          onClick={() => setShowLogPanel((v) => !v)}
        >
          ログ
        </button>
      </div>
      {showLogPanel && (
        <PanelLog>
          {log.length > 0 ? log.join("\n") : "ログはまだありません"}
        </PanelLog>
      )}
    </div>
  );
}
