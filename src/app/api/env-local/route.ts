import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

const ALLOWED_KEYS = new Set([
  "NEXT_PUBLIC_TELECO_IP_ADDRESS",
  "NEXT_PUBLIC_TELECO_PORT",
  "NEXT_PUBLIC_AUDIO_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_SIGNALING_PORT",
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT",
]);

type EnvPayload = {
  values?: Record<string, string>;
};

function sanitizeEnvValue(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

function updateEnvContent(
  original: string,
  values: Record<string, string>,
): string {
  const lines = original.length > 0 ? original.split(/\r?\n/) : [];
  const indexByKey = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m) continue;
    indexByKey.set(m[1], i);
  }

  for (const [key, value] of Object.entries(values)) {
    const nextLine = `${key}=${sanitizeEnvValue(String(value ?? ""))}`;
    const idx = indexByKey.get(key);
    if (idx == null) {
      lines.push(nextLine);
    } else {
      lines[idx] = nextLine;
    }
  }

  const joined = lines.join("\n").replace(/\n*$/, "\n");
  return joined;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as EnvPayload;
    const rawValues = body?.values;
    if (!rawValues || typeof rawValues !== "object") {
      return NextResponse.json(
        { ok: false, error: "invalid payload" },
        { status: 400 },
      );
    }

    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawValues)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      values[key] = String(value ?? "");
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json(
        { ok: false, error: "no allowed keys" },
        { status: 400 },
      );
    }

    const envPath = path.join(process.cwd(), ".env.local");
    let current = "";
    try {
      current = await fs.readFile(envPath, "utf8");
    } catch {
      current = "";
    }

    const next = updateEnvContent(current, values);
    await fs.writeFile(envPath, next, "utf8");

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to update .env.local" },
      { status: 500 },
    );
  }
}
