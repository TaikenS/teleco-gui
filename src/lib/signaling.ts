function normalizeSignalingUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.pathname || u.pathname === "/") {
      u.pathname = "/ws";
    } else if (!u.pathname.startsWith("/ws")) {
      u.pathname = "/ws";
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function appendRoomIfNeeded(url: string, roomId?: string): string {
  if (!roomId) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("room", roomId);
    return u.toString();
  } catch {
    return url;
  }
}

function resolveDefaultOrigin(): string {
  const explicitPort = process.env.NEXT_PUBLIC_SIGNALING_PORT;

  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = explicitPort
      ? `${window.location.hostname}:${explicitPort}`
      : window.location.host;
    return `${proto}://${host}`;
  }

  const port =
    explicitPort || process.env.SIGNAL_PORT || process.env.PORT || "3000";
  return `ws://localhost:${port}`;
}

/**
 * Signaling URL を返す。
 * - NEXT_PUBLIC_SIGNALING_URL があれば最優先
 * - なければ NEXT_PUBLIC_SIGNALING_PORT（または現在origin）から組み立て
 * - roomId を渡した場合は ?room=... を付与
 */
export function getSignalingUrl(roomId?: string): string {
  const envUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;

  if (envUrl) {
    const normalized = normalizeSignalingUrl(envUrl);
    return appendRoomIfNeeded(normalized, roomId);
  }

  const url = `${resolveDefaultOrigin()}/ws`;
  return appendRoomIfNeeded(url, roomId);
}
