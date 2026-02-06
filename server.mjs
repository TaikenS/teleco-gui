import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import next from "next";
import { WebSocketServer } from "ws";

function loadDotEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;

    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;

        const key = trimmed.slice(0, eq).trim();
        if (!key || process.env[key] != null) continue;

        let value = trimmed.slice(eq + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}

function loadEnvForCustomServer() {
    const cwd = process.cwd();
    // 優先順: .env.local -> .env
    loadDotEnvFile(path.join(cwd, ".env.local"));
    loadDotEnvFile(path.join(cwd, ".env"));
}

function getNetworkIPv4Addresses() {
    const nets = os.networkInterfaces();
    const list = [];

    for (const name of Object.keys(nets)) {
        for (const ni of nets[name] || []) {
            if (ni.family !== "IPv4") continue;
            if (ni.internal) continue;
            list.push(ni.address);
        }
    }

    return [...new Set(list)];
}

loadEnvForCustomServer();

const dev = process.env.NODE_ENV !== "production";
const host = process.env.HOST || "0.0.0.0";
const appPort = Number(process.env.PORT || 3000);
const signalingPort = Number(process.env.SIGNAL_PORT || process.env.NEXT_PUBLIC_SIGNALING_PORT || appPort);

const HEARTBEAT_INTERVAL_MS = Number(process.env.WS_HEARTBEAT_INTERVAL_MS || 25_000);
const WS_IDLE_TIMEOUT_MS = Number(process.env.WS_IDLE_TIMEOUT_MS || 240_000);

const app = next({ dev, hostname: host, port: appPort });
const handle = app.getRequestHandler();

/**
 * 内蔵シグナリング (ws://<host>:<signalPort>/ws)
 *
 * - Video: {type:"join", roomId, role} / {type:"offer"|"answer"|"ice-candidate", roomId, ...}
 * - Audio(teleco用): query で room を指定（.../ws?room=test）し、
 *   label付きメッセージ（callAudioRequest 等）を同一room内で中継
 */
const rooms = new Map(); // room -> Set<WebSocket>

function getRoomFromReq(req) {
    try {
        const u = new URL(req.url, "http://localhost");
        return u.searchParams.get("room") || null;
    } catch {
        return null;
    }
}

function joinRoom(ws, room) {
    if (!room) return;
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(ws);
    ws.__room = room;
}

function leaveRoom(ws) {
    const room = ws.__room;
    if (!room) return;

    const set = rooms.get(room);
    if (!set) return;

    set.delete(ws);
    if (set.size === 0) rooms.delete(room);
    ws.__room = null;
}

function markAlive(ws) {
    ws.__lastSeenAt = Date.now();
}

await app.prepare();

const appServer = http.createServer((req, res) => handle(req, res));
appServer.keepAliveTimeout = 75_000;
appServer.headersTimeout = 76_000;

let signalingServer = appServer;
if (signalingPort !== appPort) {
    signalingServer = http.createServer((req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("teleco-gui signaling server");
    });
    signalingServer.keepAliveTimeout = 75_000;
    signalingServer.headersTimeout = 76_000;
}

const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
});

wss.on("connection", (ws, req) => {
    markAlive(ws);

    ws.on("pong", () => {
        markAlive(ws);
    });

    const roomFromQuery = getRoomFromReq(req);
    if (roomFromQuery) joinRoom(ws, roomFromQuery);

    ws.on("message", (data) => {
        markAlive(ws);

        const text = typeof data === "string" ? data : data.toString();

        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch {
            // JSON以外はそのままrelay
        }

        if (parsed?.type === "__ping" || parsed?.type === "ping" || parsed?.type === "keepalive") {
            if (ws.readyState === ws.OPEN) {
                try {
                    ws.send(JSON.stringify({ type: "__pong", ts: Date.now() }));
                } catch {
                    // noop
                }
            }
            return;
        }

        if (parsed?.type === "join" && typeof parsed.roomId === "string") {
            if (ws.__room && ws.__room !== parsed.roomId) {
                leaveRoom(ws);
            }
            joinRoom(ws, parsed.roomId);
            return;
        }

        const room = ws.__room;
        if (!room) return;

        const peers = rooms.get(room);
        if (!peers) return;

        for (const peer of peers) {
            if (peer !== ws && peer.readyState === peer.OPEN) {
                try {
                    peer.send(text);
                } catch {
                    // send失敗はcloseで回収
                }
            }
        }
    });

    ws.on("close", () => {
        leaveRoom(ws);
    });

    ws.on("error", () => {
        leaveRoom(ws);
    });
});

const heartbeatTimer = setInterval(() => {
    const now = Date.now();

    for (const ws of wss.clients) {
        if (ws.readyState !== ws.OPEN) continue;

        const lastSeen = ws.__lastSeenAt || 0;
        const idleFor = now - lastSeen;

        // 余裕を持って判定（短い瞬断で落としにくくする）
        if (idleFor > WS_IDLE_TIMEOUT_MS) {
            leaveRoom(ws);
            try {
                ws.terminate();
            } catch {
                // noop
            }
            continue;
        }

        try {
            ws.ping();
        } catch {
            leaveRoom(ws);
            try {
                ws.terminate();
            } catch {
                // noop
            }
        }
    }
}, HEARTBEAT_INTERVAL_MS);

function handleUpgrade(req, socket, head) {
    try {
        const u = new URL(req.url, "http://localhost");
        if (u.pathname !== "/ws") {
            socket.destroy();
            return;
        }
    } catch {
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
    });
}

appServer.on("upgrade", handleUpgrade);
if (signalingServer !== appServer) {
    signalingServer.on("upgrade", handleUpgrade);
}

wss.on("close", () => {
    clearInterval(heartbeatTimer);
});

appServer.on("close", () => {
    clearInterval(heartbeatTimer);
});
if (signalingServer !== appServer) {
    signalingServer.on("close", () => {
        clearInterval(heartbeatTimer);
    });
}

function printAddresses() {
    const globals = getNetworkIPv4Addresses();

    console.log(`teleco-gui listening on http://localhost:${appPort}`);
    for (const ip of globals) {
        console.log(`teleco-gui listening on http://${ip}:${appPort}`);
    }

    console.log(`signaling ws: ws://localhost:${signalingPort}/ws`);
    for (const ip of globals) {
        console.log(`signaling ws: ws://${ip}:${signalingPort}/ws`);
    }

    if (signalingPort !== appPort) {
        console.log(`(app port WS fallback) ws://localhost:${appPort}/ws`);
    }
}

appServer.listen(appPort, host, () => {
    if (signalingServer === appServer) {
        printAddresses();
        return;
    }

    signalingServer.listen(signalingPort, host, () => {
        printAddresses();
    });
});
