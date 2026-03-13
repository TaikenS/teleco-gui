"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { STORAGE_KEYS } from "@/app/gui/components/audio/sender/controller/constants";
import { buildSignalingUrl } from "@/lib/signaling";
import type { SignalingMessage } from "@/lib/webrtc/signalingTypes";

type Args = {
  signalWsRef: MutableRefObject<WebSocket | null>;
  signalingIpAddress: string;
  signalingPort: string;
  roomHint: string;
  shouldAutoSignalRef: MutableRefObject<boolean>;
  onError: (message: string) => void;
  onLogConnection: (line: string) => void;
  onLogCommand: (line: string) => void;
  onIncomingMessage: (msg: SignalingMessage) => Promise<void>;
  onDisconnected: () => void;
};

export function useSignalWebSocket({
  signalWsRef,
  signalingIpAddress,
  signalingPort,
  roomHint,
  shouldAutoSignalRef,
  onError,
  onLogConnection,
  onLogCommand,
  onIncomingMessage,
  onDisconnected,
}: Args) {
  const signalReconnectTimerRef = useRef<number | null>(null);
  const signalReconnectAttemptRef = useRef(0);
  const manualSignalDisconnectRef = useRef(false);
  const signalKeepaliveTimerRef = useRef<number | null>(null);
  const onErrorRef = useRef(onError);
  const onLogConnectionRef = useRef(onLogConnection);
  const onLogCommandRef = useRef(onLogCommand);
  const onIncomingMessageRef = useRef(onIncomingMessage);
  const onDisconnectedRef = useRef(onDisconnected);

  const [signalWsStatus, setSignalWsStatus] = useState<string>("未接続");

  useEffect(() => {
    onErrorRef.current = onError;
    onLogConnectionRef.current = onLogConnection;
    onLogCommandRef.current = onLogCommand;
    onIncomingMessageRef.current = onIncomingMessage;
    onDisconnectedRef.current = onDisconnected;
  }, [onDisconnected, onError, onIncomingMessage, onLogCommand, onLogConnection]);

  const clearSignalKeepalive = () => {
    if (signalKeepaliveTimerRef.current != null) {
      window.clearInterval(signalKeepaliveTimerRef.current);
      signalKeepaliveTimerRef.current = null;
    }
  };

  const startSignalKeepalive = (ws: WebSocket) => {
    clearSignalKeepalive();

    signalKeepaliveTimerRef.current = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(
          JSON.stringify({
            type: "keepalive",
            roomId: roomHint,
            ts: Date.now(),
          }),
        );
      } catch {
        // noop
      }
    }, 10000);
  };

  const clearSignalReconnectTimer = () => {
    if (signalReconnectTimerRef.current != null) {
      window.clearTimeout(signalReconnectTimerRef.current);
      signalReconnectTimerRef.current = null;
    }
  };

  const connectSignalWs = (
    isReconnect = false,
    target?: { ipAddress?: string; port?: string; roomId?: string },
  ) => {
    if (
      signalWsRef.current &&
      (signalWsRef.current.readyState === WebSocket.OPEN ||
        signalWsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    manualSignalDisconnectRef.current = false;
    clearSignalReconnectTimer();
    setSignalWsStatus("接続中");

    const ipAddress = (target?.ipAddress ?? signalingIpAddress).trim();
    const port = (target?.port ?? signalingPort).trim();
    const room = (target?.roomId ?? roomHint).trim();

    if (!ipAddress || !port || !room) {
      setSignalWsStatus("エラー");
      onErrorRef.current(
        "Signaling の IP Address / Port / Room ID を入力してください。",
      );
      return;
    }

    const normalized = buildSignalingUrl({
      ipAddress,
      port,
      roomId: room,
    });
    onLogConnectionRef.current(
      `${isReconnect ? "Signal WS 再接続開始" : "Signal WS 接続開始"}: ${normalized}`,
    );

    try {
      const ws = new WebSocket(normalized);
      signalWsRef.current = ws;

      ws.onopen = () => {
        signalReconnectAttemptRef.current = 0;
        setSignalWsStatus("接続済み");
        onLogConnectionRef.current(`Signal WS 接続成功: ${normalized}`);
        startSignalKeepalive(ws);
        ws.send(JSON.stringify({ type: "join", roomId: room, role: "sender" }));

        if (isReconnect) {
          onLogCommandRef.current("Signal WS 再接続");
        }
      };

      ws.onclose = () => {
        clearSignalKeepalive();
        if (signalWsRef.current === ws) signalWsRef.current = null;
        setSignalWsStatus("切断");
        onLogConnectionRef.current("Signal WS 切断");
        onDisconnectedRef.current();

        if (manualSignalDisconnectRef.current || !shouldAutoSignalRef.current) {
          return;
        }

        clearSignalReconnectTimer();
        const waitMs = Math.min(
          15000,
          1000 * 2 ** signalReconnectAttemptRef.current,
        );
        signalReconnectAttemptRef.current += 1;
        onLogConnectionRef.current(
          `Signal WS 再接続を予約 (${Math.round(waitMs / 1000)}s)`,
        );

        signalReconnectTimerRef.current = window.setTimeout(() => {
          signalReconnectTimerRef.current = null;
          connectSignalWs(true);
        }, waitMs);
      };

      ws.onerror = () => {
        setSignalWsStatus("エラー");
        onLogConnectionRef.current(`Signal WS エラー: ${normalized}`);
        onErrorRef.current(
          "Signal WebSocket 接続でエラーが発生しました。URL/ポート/PC(IP)を確認してください。\n" +
            `接続先: ${normalized}`,
        );
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(event.data);
          } else if (event.data instanceof Blob) {
            text = await event.data.text();
          } else {
            text = String(event.data);
          }

          const msg = JSON.parse(text) as SignalingMessage;
          await onIncomingMessageRef.current(msg);
        } catch {
          // ignore
        }
      };
    } catch (e) {
      console.error(e);
      setSignalWsStatus("エラー");
      onLogConnectionRef.current(`Signal WS 作成失敗: ${String(e)}`);
      onErrorRef.current("Signal WebSocket の作成に失敗しました。");
    }
  };

  const disconnectSignalWs = () => {
    manualSignalDisconnectRef.current = true;
    shouldAutoSignalRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.signalAutoConnect, "0");
    clearSignalReconnectTimer();
    clearSignalKeepalive();
    onLogConnectionRef.current("Signal WS 手動切断");

    const ws = signalWsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }

    signalWsRef.current = null;
    setSignalWsStatus("切断");
    onDisconnectedRef.current();
  };

  const sendSignal = (obj: unknown) => {
    const ws = signalWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  };

  const recoverSignalConnection = () => {
    if (!manualSignalDisconnectRef.current && shouldAutoSignalRef.current) {
      const ws = signalWsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connectSignalWs(true);
      }
    }
  };

  const cleanupSignalSocket = () => {
    manualSignalDisconnectRef.current = true;
    clearSignalReconnectTimer();
    clearSignalKeepalive();
    disconnectSignalWs();
  };

  return {
    signalWsRef,
    signalWsStatus,
    sendSignal,
    connectSignalWs,
    disconnectSignalWs,
    recoverSignalConnection,
    cleanupSignalSocket,
  };
}
