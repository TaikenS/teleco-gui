import http from "http";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

/**
 * 内蔵シグナリング (ws://<host>/ws)
 *
 * - Video: {type:"join", roomId, role} / {type:"offer"|"answer"|"ice-candidate", roomId, ...}
 * - Audio(teleco用): query で room を指定（.../ws?room=test）し、
 *   label付きメッセージ（callAudioRequest 等）を同一room内で中継
 *
 * 両方を「room単位で中継」するだけの超単純リレー。
 */
const rooms = new Map(); // room -> Set<WebSocket>

const HEARTBEAT_INTERVAL_MS = 20_000;
const WS_IDLE_TIMEOUT_MS = 120_000;

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

const server = http.createServer((req, res) => handle(req, res));
server.keepAliveTimeout = 75_000;
server.headersTimeout = 76_000;

const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
});

wss.on("connection", (ws, req) => {
    markAlive(ws);

    ws.on("pong", () => {
        markAlive(ws);
    });

    // 1) query param の room があればそれに参加（audio test 等）
    const roomFromQuery = getRoomFromReq(req);
    if (roomFromQuery) joinRoom(ws, roomFromQuery);

    ws.on("message", (data) => {
        markAlive(ws);

        const text = typeof data === "string" ? data : data.toString();

        // 2) join メッセージなら roomId を room として採用（video / audio page 用）
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch {
            // JSONじゃない場合はそのままrelay（room参加済み前提）
        }

        // keepalive メッセージは中継しない
        if (
            parsed?.type === "__ping" ||
            parsed?.type === "ping" ||
            parsed?.type === "keepalive"
        ) {
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
            // 既に別roomにいた場合は抜ける
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

wss.on("close", () => {
    clearInterval(heartbeatTimer);
});

server.on("upgrade", (req, socket, head) => {
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
});

server.on("close", () => {
    clearInterval(heartbeatTimer);
});

server.listen(port, () => {
    console.log(`teleco-gui listening on http://localhost:${port}`);
    console.log(`signaling ws: ws://localhost:${port}/ws`);
});
