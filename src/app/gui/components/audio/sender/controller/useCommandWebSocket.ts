"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { STORAGE_KEYS } from "@/app/gui/components/audio/sender/controller/constants";

type Args = {
  telecoIpAddress: string;
  telecoPort: string;
  shouldAutoCommandRef: MutableRefObject<boolean>;
  onError: (message: string) => void;
  onLogConnection: (line: string) => void;
  onLogCommand: (line: string) => void;
};

export function useCommandWebSocket({
  telecoIpAddress,
  telecoPort,
  shouldAutoCommandRef,
  onError,
  onLogConnection,
  onLogCommand,
}: Args) {
  const commandWsRef = useRef<WebSocket | null>(null);
  const commandReconnectTimerRef = useRef<number | null>(null);
  const commandReconnectAttemptRef = useRef(0);
  const manualCommandDisconnectRef = useRef(false);
  const onErrorRef = useRef(onError);
  const onLogConnectionRef = useRef(onLogConnection);
  const onLogCommandRef = useRef(onLogCommand);

  const [commandWsStatus, setCommandWsStatus] = useState<string>("未接続");

  useEffect(() => {
    onErrorRef.current = onError;
    onLogConnectionRef.current = onLogConnection;
    onLogCommandRef.current = onLogCommand;
  }, [onError, onLogConnection, onLogCommand]);

  const clearCommandReconnectTimer = () => {
    if (commandReconnectTimerRef.current != null) {
      window.clearTimeout(commandReconnectTimerRef.current);
      commandReconnectTimerRef.current = null;
    }
  };

  const connectCommandWs = (isReconnect = false) => {
    if (
      commandWsRef.current &&
      (commandWsRef.current.readyState === WebSocket.OPEN ||
        commandWsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    manualCommandDisconnectRef.current = false;
    clearCommandReconnectTimer();
    setCommandWsStatus("接続中");

    if (!telecoIpAddress.trim() || !telecoPort.trim()) {
      setCommandWsStatus("エラー");
      onErrorRef.current("teleco の IP Address / Port を入力してください。");
      onLogConnectionRef.current(
        "Command WS 接続失敗: teleco の IP Address / Port が未入力",
      );
      return;
    }

    const commandWsUrl = `ws://${telecoIpAddress.trim()}:${telecoPort.trim()}/command`;
    onLogConnectionRef.current(
      `${isReconnect ? "Command WS 再接続開始" : "Command WS 接続開始"}: ${commandWsUrl}`,
    );

    try {
      const ws = new WebSocket(commandWsUrl);
      commandWsRef.current = ws;

      ws.onopen = () => {
        commandReconnectAttemptRef.current = 0;
        setCommandWsStatus("接続済み");
        onLogConnectionRef.current(`Command WS 接続成功: ${commandWsUrl}`);
        if (isReconnect) {
          onLogCommandRef.current("Command WS 再接続");
        }
      };

      ws.onclose = (ev) => {
        if (commandWsRef.current === ws) commandWsRef.current = null;
        setCommandWsStatus("切断");
        onLogConnectionRef.current(
          `Command WS 切断 code=${ev.code} reason=${ev.reason || "(none)"}`,
        );

        if (
          manualCommandDisconnectRef.current ||
          !shouldAutoCommandRef.current
        ) {
          return;
        }

        clearCommandReconnectTimer();
        const waitMs = Math.min(
          15000,
          1000 * 2 ** commandReconnectAttemptRef.current,
        );
        commandReconnectAttemptRef.current += 1;
        onLogConnectionRef.current(
          `Command WS 再接続を予約 (${Math.round(waitMs / 1000)}s)`,
        );

        commandReconnectTimerRef.current = window.setTimeout(() => {
          commandReconnectTimerRef.current = null;
          connectCommandWs(true);
        }, waitMs);
      };

      ws.onerror = () => {
        setCommandWsStatus("エラー");
        onLogConnectionRef.current(`Command WS エラー: ${commandWsUrl}`);
        onErrorRef.current(
          `Command WebSocket 接続でエラーが発生しました。\n接続先: ${commandWsUrl}`,
        );
      };

      ws.onmessage = async (event) => {
        try {
          let text: string;
          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof Blob) {
            text = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(event.data);
          } else {
            text = String(event.data);
          }

          onLogCommandRef.current(`IN: ${text}`);
        } catch {
          onLogCommandRef.current("IN: (failed to decode message)");
        }
      };
    } catch (e) {
      console.error(e);
      setCommandWsStatus("エラー");
      onLogConnectionRef.current(`Command WS 作成失敗: ${String(e)}`);
      onErrorRef.current("Command WebSocket の作成に失敗しました。");
    }
  };

  const disconnectCommandWs = () => {
    manualCommandDisconnectRef.current = true;
    shouldAutoCommandRef.current = false;
    window.localStorage.setItem(STORAGE_KEYS.commandAutoConnect, "0");
    clearCommandReconnectTimer();
    onLogConnectionRef.current("Command WS 手動切断");

    const ws = commandWsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }

    commandWsRef.current = null;
    setCommandWsStatus("切断");
  };

  const sendCommand = (
    obj: unknown,
    options?: { silentIfDisconnected?: boolean },
  ) => {
    const ws = commandWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (!options?.silentIfDisconnected) {
        onErrorRef.current(
          "Command WS（teleco-main /command）に接続してください。",
        );
      }
      return false;
    }

    ws.send(JSON.stringify(obj));
    onLogCommandRef.current(`OUT: ${JSON.stringify(obj)}`);
    return true;
  };

  const recoverCommandConnection = () => {
    if (!manualCommandDisconnectRef.current && shouldAutoCommandRef.current) {
      const ws = commandWsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connectCommandWs(true);
      }
    }
  };

  const cleanupCommandSocket = () => {
    manualCommandDisconnectRef.current = true;
    clearCommandReconnectTimer();
    disconnectCommandWs();
  };

  return {
    commandWsStatus,
    sendCommand,
    connectCommandWs,
    disconnectCommandWs,
    recoverCommandConnection,
    cleanupCommandSocket,
  };
}
