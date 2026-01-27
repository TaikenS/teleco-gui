import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 超簡易サーバ
 * - http://localhost:8080/  -> client.html を返す
 * - ws://localhost:8080/?room=test の WebSocket を提供
 * - 同じ room の接続同士でメッセージを「文字列として」中継する（重要：Blob化を防ぐ）
 */
const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const pathname = u.pathname;

    const p = pathname === "/" ? "/client.html" : pathname;
    const filePath = path.join(__dirname, p);

    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
    }

    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // room -> Set<WebSocket>

wss.on("connection", (ws, req) => {
    const u = new URL(req.url, "http://localhost");
    const room = u.searchParams.get("room") || "default";

    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(ws);

    ws.on("message", (data) => {
        // ★重要：必ず文字列化して送る（ブラウザ側で Blob にならず JSON.parse できる）
        const text = typeof data === "string" ? data : data.toString();

        for (const peer of rooms.get(room)) {
            if (peer !== ws && peer.readyState === peer.OPEN) {
                peer.send(text);
            }
        }
    });

    ws.on("close", () => {
        const set = rooms.get(room);
        if (!set) return;
        set.delete(ws);
        if (set.size === 0) rooms.delete(room);
    });
});

server.listen(8081, () => {
    console.log("Signaling server running:");
    console.log("  http://localhost:8081/client.html?room=test");
    console.log("  ws://localhost:8081/?room=test");
});
