export type SignalingTarget = {
  ipAddress: string;
  port: string;
  roomId?: string;
};

type SignalingDefaultOptions = {
  envKeys?: string[];
};

function firstEnvValue(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value?.trim()) return value.trim();
  }
  return null;
}

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

function resolveDefaultIpAddress(options?: SignalingDefaultOptions): string {
  const envIpAddress = firstEnvValue([
    ...(options?.envKeys || []),
    "NEXT_PUBLIC_SIGNALING_IP_ADDRESS",
  ]);
  if (envIpAddress) return envIpAddress;

  if (typeof window !== "undefined") {
    return window.location.hostname;
  }

  return "localhost";
}

function resolveDefaultPort(options?: SignalingDefaultOptions): string {
  const explicitPort = firstEnvValue([
    ...(options?.envKeys || []),
    "NEXT_PUBLIC_SIGNALING_PORT",
  ]);
  if (explicitPort) return explicitPort;

  const serverPort = process.env.SIGNAL_PORT || process.env.PORT || "3000";
  return String(serverPort);
}

function resolveDefaultOrigin(options?: SignalingDefaultOptions): string {
  const port = resolveDefaultPort(options);

  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${resolveDefaultIpAddress(options)}:${port}`;
  }

  return `ws://${resolveDefaultIpAddress(options)}:${port}`;
}

export function getDefaultSignalingIpAddress(
  options?: SignalingDefaultOptions,
): string {
  return resolveDefaultIpAddress(options);
}

export function getDefaultSignalingPort(
  options?: SignalingDefaultOptions,
): string {
  return resolveDefaultPort(options);
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
