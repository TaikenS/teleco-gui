"use client";

import { useEffect, useRef, useState } from "react";
import { getSignalingUrl } from "@/lib/siganling";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Role = "sender" | "viewer";

const STORAGE = {
  roomId: "teleco.sender.roomId",
  autoConnect: "teleco.sender.autoConnect",
  cameraActive: "teleco.sender.cameraActive",
  streamingActive: "teleco.sender.streamingActive",
};

const WS_KEEPALIVE_MS = 10_000;

const DEFAULT_VIDEO_ROOM = process.env.NEXT_PUBLIC_DEFAULT_VIDEO_ROOM || "room1";

export default function SenderPage() {
  const [roomId, setRoomId] = useState(DEFAULT_VIDEO_ROOM);
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualCloseRef = useRef(false);
  const keepaliveTimerRef = useRef<number | null>(null);

  const shouldAutoConnectRef = useRef(false);
  const shouldAutoStartCameraRef = useRef(false);
  const desiredStreamingRef = useRef(false);

  const logLine = (line: string) =>
      setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
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

  const closePc = () => {
    if (!pcRef.current) return;
    try {
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
    } catch {
      // noop
    }
    pcRef.current = null;
  };

  const closeWs = () => {
    stopKeepalive();
    if (!wsRef.current) return;

    try {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
    } catch {
      // noop
    }

    wsRef.current = null;
    setConnected(false);
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

  const maybeAutoStartWebRTC = () => {
    if (!desiredStreamingRef.current) return;
    if (!streamRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    void startWebRTC(true);
  };

  // カメラ起動
  const startCamera = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      media.getTracks().forEach((track) => {
        track.onended = () => {
          window.localStorage.setItem(STORAGE.cameraActive, "0");
          window.localStorage.setItem(STORAGE.streamingActive, "0");
          desiredStreamingRef.current = false;
          logLine("カメラトラックが終了しました");
        };
      });

      streamRef.current = media;
      setStream(media);

      window.localStorage.setItem(STORAGE.cameraActive, "1");
      logLine("カメラ起動");

      maybeAutoStartWebRTC();
    } catch (e) {
      console.error(e);
      logLine("カメラ起動に失敗");
    }
  };

  // シグナリングへの接続
  const connectSignaling = (isReconnect = false) => {
    const current = wsRef.current;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearReconnectTimer();
    setWsError(null);

    const ws = new WebSocket(getSignalingUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setWsError(null);
      reconnectAttemptRef.current = 0;

      startKeepalive(ws);

      logLine(isReconnect ? "シグナリング再接続" : "シグナリング接続");
      ws.send(JSON.stringify({ type: "join", roomId, role: "sender" as Role }));

      maybeAutoStartWebRTC();
    };

    ws.onclose = (ev) => {
      if (wsRef.current === ws) wsRef.current = null;
      stopKeepalive();
      setConnected(false);
      logLine(`シグナリング切断 code=${ev.code} reason=${ev.reason || "(none)"}`);

      // WSが切れても既存PeerConnectionはすぐには閉じない（メディア継続を優先）
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error(e);
      setWsError("シグナリングサーバへの接続に失敗");
    };

    ws.onmessage = async (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg?.type === "__pong" || msg?.type === "keepalive") {
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (msg.type === "answer") {
        try {
          const desc = new RTCSessionDescription(msg.payload);
          await pc.setRemoteDescription(desc);
          logLine("viewer から answer 受信");
        } catch (e) {
          console.error(e);
          logLine(`answer処理失敗: ${String(e)}`);
        }
      } else if (msg.type === "ice-candidate") {
        try {
          await pc.addIceCandidate(msg.payload);
        } catch (e) {
          console.error(e);
        }
      }
    };
  };

  // WebRTC 接続開始
  const startWebRTC = async (isAuto = false) => {
    const currentStream = streamRef.current;
    if (!currentStream) {
      if (!isAuto) logLine("先にカメラを起動してください");
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (!isAuto) logLine("先にシグナリングへ接続してください");
      return;
    }

    const existingPc = pcRef.current;
    if (
        existingPc &&
        (existingPc.connectionState === "connected" || existingPc.connectionState === "connecting")
    ) {
      // 既に送信中
      desiredStreamingRef.current = true;
      window.localStorage.setItem(STORAGE.streamingActive, "1");
      return;
    }

    closePc();

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    // ローカルストリームを全部乗せる
    currentStream.getTracks().forEach((track) => pc.addTrack(track, currentStream));

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      wsRef.current?.send(
          JSON.stringify({
            type: "ice-candidate",
            roomId,
            role: "sender",
            payload: event.candidate,
          }),
      );
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      logLine(`WebRTC状態: ${state}`);

      if (state === "failed" || state === "closed") {
        if (desiredStreamingRef.current) {
          // 自動復旧
          window.setTimeout(() => {
            maybeAutoStartWebRTC();
          }, 500);
        }
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    wsRef.current?.send(
        JSON.stringify({
          type: "offer",
          roomId,
          role: "sender",
          payload: offer,
        }),
    );

    desiredStreamingRef.current = true;
    window.localStorage.setItem(STORAGE.streamingActive, "1");

    logLine(isAuto ? "offer 再送信（自動復旧）" : "offer 送信");
  };

  // video にローカルストリームを表示
  useEffect(() => {
    const v = localVideoRef.current;
    if (!v) return;

    v.srcObject = stream ?? null;
    if (stream) v.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const savedRoom = window.localStorage.getItem(STORAGE.roomId);
    if (savedRoom) setRoomId(savedRoom);

    shouldAutoConnectRef.current = window.localStorage.getItem(STORAGE.autoConnect) === "1";
    shouldAutoStartCameraRef.current = window.localStorage.getItem(STORAGE.cameraActive) === "1";
    desiredStreamingRef.current = window.localStorage.getItem(STORAGE.streamingActive) === "1";

    if (shouldAutoStartCameraRef.current) {
      void startCamera();
    }

    if (shouldAutoConnectRef.current) {
      manualCloseRef.current = false;
      connectSignaling(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE.roomId, roomId);
  }, [roomId]);

  useEffect(() => {
    const recoverIfNeeded = () => {
      if (manualCloseRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        if (shouldAutoConnectRef.current) {
          connectSignaling(true);
        }
      }

      maybeAutoStartWebRTC();
    };

    const onOnline = () => recoverIfNeeded();
    const onVisible = () => {
      if (document.visibilityState === "visible") recoverIfNeeded();
    };
    const onPageShow = () => recoverIfNeeded();

    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cleanup
  useEffect(() => {
    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();

      closePc();
      closeWs();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-3xl p-4 space-y-4">
          <h1 className="text-xl font-semibold">Sender (別PC用)</h1>

          <div className="space-y-2 rounded-2xl border bg-white p-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-700">Room ID</label>
              <input
                  className="rounded-xl border px-3 py-1 text-sm"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <button onClick={startCamera} className="rounded-xl bg-slate-900 px-4 py-2 text-white">
                カメラ起動
              </button>
              <button
                  onClick={() => {
                    manualCloseRef.current = false;
                    shouldAutoConnectRef.current = true;
                    window.localStorage.setItem(STORAGE.autoConnect, "1");
                    connectSignaling();
                  }}
                  className="rounded-xl bg-slate-100 px-4 py-2"
              >
                シグナリング接続
              </button>
              <button onClick={() => void startWebRTC(false)} className="rounded-xl bg-emerald-600 px-4 py-2 text-white">
                viewer へ映像送信開始
              </button>
              <button
                  onClick={() => {
                    shouldAutoConnectRef.current = false;
                    desiredStreamingRef.current = false;
                    window.localStorage.setItem(STORAGE.autoConnect, "0");
                    window.localStorage.setItem(STORAGE.streamingActive, "0");
                    manualCloseRef.current = true;
                    closeWs();
                    closePc();
                  }}
                  className="rounded-xl bg-slate-100 px-4 py-2"
              >
                接続停止
              </button>
            </div>
            {wsError && <p className="text-xs text-red-600">{wsError}</p>}
          </div>

          <div className="rounded-2xl border bg-white p-4 space-y-2">
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
              <video ref={localVideoRef} className="h-full w-full object-cover" muted playsInline />
            </div>
            <p className="text-xs text-slate-500">これは「送信側PCのローカルプレビュー」です。</p>
            <p className="text-xs text-slate-500">Signal: {connected ? "接続中" : "未接続"}</p>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <h2 className="text-sm font-semibold mb-2">ログ</h2>
            <div className="max-h-48 overflow-auto text-xs text-slate-700 space-y-1">
              {log.map((l, i) => (
                  <div key={i}>{l}</div>
              ))}
            </div>
          </div>
        </div>
      </main>
  );
}
