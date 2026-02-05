// server.js (ESM)

import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8081 });

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
    } catch {
      console.error("Invalid JSON:", message.toString());
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
            from: role, // クライアント側が "form" 前提なら "form" に戻してください
            payload,
          }),
        );
      }
    }
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    if (!roomId) return;

    const members = rooms.get(roomId) || [];
    const updated = members.filter((m) => m !== ws);

    if (updated.length === 0) rooms.delete(roomId);
    else rooms.set(roomId, updated);
  });
});

console.log("Signaling server started on ws://localhost:8080");

// 必要なら ESM でエクスポート
export { wss, rooms };
