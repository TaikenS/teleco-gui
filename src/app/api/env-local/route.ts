import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = new Set([
  "NEXT_PUBLIC_TELECO_IP_ADDRESS",
  "NEXT_PUBLIC_TELECO_PORT",
  "NEXT_PUBLIC_AUDIO_RECEIVE_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_RECEIVE_SIGNALING_PORT",
  "NEXT_PUBLIC_AUDIO_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_SIGNALING_PORT",
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT",
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS",
  "NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT",
]);

const REMOVED_KEYS = new Set([
  "NEXT_PUBLIC_TELECO_HTTP_URL",
  "NEXT_PUBLIC_TELECO_COMMAND_WS_URL",
]);

type EnvPayload = {
  values?: Record<string, string>;
};

type EnvMap = Record<string, string>;

function sanitizeEnvValue(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

function parseEnvContent(content: string): EnvMap {
  const values: EnvMap = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    values[key] = raw.replace(/^["']|["']$/g, "");
  }

  return values;
}

async function readEnvFileValues(filePath: string): Promise<EnvMap> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parseEnvContent(text);
  } catch {
    return {};
  }
}

function updateEnvContent(
  original: string,
  values: Record<string, string>,
): string {
  const lines =
    original.length > 0
      ? original
          .split(/\r?\n/)
          .filter((line) => {
            const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
            if (!m) return true;
            return !REMOVED_KEYS.has(m[1]);
          })
      : [];
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

export async function GET() {
  try {
    const envPath = path.join(process.cwd(), ".env");
    const envLocalPath = path.join(process.cwd(), ".env.local");

    const base = await readEnvFileValues(envPath);
    const local = await readEnvFileValues(envLocalPath);
    const merged = { ...base, ...local };

    const values: EnvMap = {};
    for (const key of Object.keys(merged)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      values[key] = merged[key];
    }

    return NextResponse.json({ ok: true, values });
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to read env files" },
      { status: 500 },
    );
  }
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
