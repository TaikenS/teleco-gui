import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = http.createServer((req, res) => {
    // ★ クエリを除去
    const u = new URL(req.url, "http://localhost");
    const pathname = u.pathname;

    const p = pathname === "/" ? "/client.html" : pathname;
    const filePath = path.join(__dirname, p);

    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end("Not Found");
    }

    const data = fs.readFileSync(filePath);
    res.writeHead(200);
    res.end(data);
});

const wss = new WebSocketServer({ server });

const rooms = new Map();

wss.on("connection", (ws, req) => {
    const u = new URL(req.url, "http://localhost");
    const room = u.searchParams.get("room") || "default";

    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(ws);

    ws.on("message", (buf) => {
        for (const peer of rooms.get(room)) {
            if (peer !== ws && peer.readyState === peer.OPEN) {
                peer.send(buf);
            }
        }
    });

    ws.on("close", () => {
        rooms.get(room).delete(ws);
        if (rooms.get(room).size === 0) rooms.delete(room);
    });
});

server.listen(8080, () => {
    console.log("Open: http://localhost:8080/client.html?room=test");
});
