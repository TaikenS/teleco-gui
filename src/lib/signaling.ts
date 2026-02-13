export type SignalingTarget = {
  ipAddress: string;
  port: string;
  roomId?: string;
};

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

function resolveDefaultIpAddress(): string {
  const envIpAddress = process.env.NEXT_PUBLIC_SIGNALING_IP_ADDRESS;
  if (envIpAddress?.trim()) return envIpAddress.trim();

  if (typeof window !== "undefined") {
    return window.location.hostname;
  }

  return "localhost";
}

function resolveDefaultPort(): string {
  const explicitPort = process.env.NEXT_PUBLIC_SIGNALING_PORT;
  if (explicitPort?.trim()) return explicitPort.trim();

  const serverPort = process.env.SIGNAL_PORT || process.env.PORT || "3000";
  return String(serverPort);
}

function resolveDefaultOrigin(): string {
  const port = resolveDefaultPort();

  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${resolveDefaultIpAddress()}:${port}`;
  }

  return `ws://${resolveDefaultIpAddress()}:${port}`;
}

export function getDefaultSignalingIpAddress(): string {
  return resolveDefaultIpAddress();
}

export function getDefaultSignalingPort(): string {
  return resolveDefaultPort();
}

function normalizePort(rawPort: string): string {
  return rawPort.trim();
}

export function buildSignalingBaseUrl(target: {
  ipAddress?: string;
  port?: string;
}): string {
  const ipAddress = (target.ipAddress || resolveDefaultIpAddress()).trim();
  const port = normalizePort(target.port || resolveDefaultPort());
  const proto =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "wss"
      : "ws";
  return `${proto}://${ipAddress}:${port}/ws`;
}

export function buildSignalingUrl(target: SignalingTarget): string {
  const base = buildSignalingBaseUrl(target);
  return appendRoomIfNeeded(base, target.roomId?.trim() || undefined);
}

export function parseSignalingUrl(raw: string): {
  ipAddress: string;
  port: string;
  roomId: string;
} | null {
  const input = raw.trim();
  if (!input) return null;

  const withScheme =
    input.startsWith("ws://") || input.startsWith("wss://")
      ? input
      : `ws://${input.replace(/^\/+/, "")}`;

  try {
    const u = new URL(withScheme);
    return {
      ipAddress: u.hostname || "",
      port: u.port || resolveDefaultPort(),
      roomId: u.searchParams.get("room") || "",
    };
  } catch {
    return null;
  }
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
