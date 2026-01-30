export function getSignalingUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;
  if (envUrl) {
    return envUrl;
  }

  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.hostname}:8080`;
  }

  return "ws://localhost:8080";
}
