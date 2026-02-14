export function parseHostPortFromUrl(
  raw: string,
): { ipAddress: string; port: string } | null {
  const input = raw.trim();
  if (!input) return null;

  const withScheme =
    input.startsWith("ws://") ||
    input.startsWith("wss://") ||
    input.startsWith("http://") ||
    input.startsWith("https://")
      ? input
      : `http://${input.replace(/^\/+/, "")}`;

  try {
    const u = new URL(withScheme);
    return {
      ipAddress: u.hostname || "",
      port: u.port || "",
    };
  } catch {
    return null;
  }
}

export function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function bindRecoveryListeners(recoverIfNeeded: () => void): () => void {
  const onOnline = () => recoverIfNeeded();
  const onPageShow = () => recoverIfNeeded();
  const onVisible = () => {
    if (document.visibilityState === "visible") recoverIfNeeded();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
