export function getSignalingUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;
  if (envUrl) {
    return envUrl;
  }

  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    // Next.js と同じポートで動く「内蔵シグナリング」に寄せる
    // 例: ws://localhost:3000/ws
    return `${proto}://${window.location.host}/ws`;
  }

  return "ws://localhost:3000/ws";
}
