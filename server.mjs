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
const HEARTBEAT_MS = 25_000;

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

await app.prepare();

const server = http.createServer((req, res) => handle(req, res));
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
    // heartbeat
    ws.isAlive = true;
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    // 1) query param の room があればそれに参加（audio test 等）
    const roomFromQuery = getRoomFromReq(req);
    if (roomFromQuery) joinRoom(ws, roomFromQuery);

    ws.on("message", (data) => {
        const text = typeof data === "string" ? data : data.toString();

        // 2) join メッセージなら roomId を room として採用（video / audio page 用）
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch {
            // JSONじゃなくても relay はできるが、ここでは JSON 前提
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
                peer.send(text);
            }
        }
    });

    ws.on("close", () => {
        leaveRoom(ws);
    });
});

// ping/pong heartbeat
const heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) {
            leaveRoom(ws);
            ws.terminate();
            continue;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch {
            leaveRoom(ws);
            ws.terminate();
        }
    }
}, HEARTBEAT_MS);

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
