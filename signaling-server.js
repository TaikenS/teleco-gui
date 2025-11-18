const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });

/**
 * rooms:
 *  roomId: WebSocket[]
 */
const rooms = new Map();

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        let data;
        try {
            data = JSON.parse(message.toString());
        } catch (e) {
            console.error("Invalid JSON:", message);
            return;
        }

        const { type, roomId, role, payload } = data;
        if (!roomId) return;

        // 参加
        if (type === "join") {
            ws.roomId = roomId;
            ws.role = role;
            if (!rooms.has(roomId)) rooms.set(roomId, []);
            rooms.get(roomId).push(ws);
            console.log(`[${role}] joined room ${roomId}`);
            return;
        }

        // 同じ room の他メンバーに転送
        const members = rooms.get(roomId) || [];
        for (const client of members) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(
                    JSON.stringify({
                        type,
                        form: role,
                        payload
                    })
                );
            }
        }
    });

    ws.on("close", () => {
        const roomId = ws.roomId;
        if (!roomId) return;
        const members = rooms.get(ws.roomId) || [];
        rooms.set(
            roomId,
            members.filter((m) => m !== ws)
        );
    });
});

console.log("Signaling server started on ws://localhost:8080");