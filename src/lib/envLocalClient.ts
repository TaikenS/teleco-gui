let flushTimer: number | null = null;
let pending: Record<string, string> = {};

async function flush() {
  const values = pending;
  pending = {};
  flushTimer = null;

  if (Object.keys(values).length === 0) return;

  try {
    await fetch("/api/env-local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    });
  } catch (e) {
    console.warn("Failed to sync .env.local", e);
  }
}

export function scheduleEnvLocalSync(values: Record<string, string>) {
  pending = { ...pending, ...values };
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
  }
  flushTimer = window.setTimeout(() => {
    void flush();
  }, 500);
}
