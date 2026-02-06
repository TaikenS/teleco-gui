## teleco-gui

### 起動

```bash
npm install
npm run dev
# または
npm run build
npm run start
```

### 主要ページ

- `/gui` : オペレーターGUI
- `/sender` : Video Sender
- `/audio` : Audio Receiver
- `/audio/sender` : Audio Sender

---

## 環境変数（`.env.local`）

同一PCで複数インスタンスを動かす場合は、ポートとデフォルト値を分けてください。

```bash
# HTTPポート
PORT=3000

# Signaling WSポート（未指定なら PORT を使用）
SIGNAL_PORT=3000

# クライアント側でSignal先を固定したい場合（任意）
# NEXT_PUBLIC_SIGNALING_URL=ws://localhost:3000/ws
# またはポートだけ固定（任意）
# NEXT_PUBLIC_SIGNALING_PORT=3000

# デフォルト値
NEXT_PUBLIC_DEFAULT_VIDEO_ROOM=room1
NEXT_PUBLIC_DEFAULT_AUDIO_ROOM=audio1
NEXT_PUBLIC_DEFAULT_RECEIVER_ID=rover003

# teleco-main 接続先
NEXT_PUBLIC_TELECO_HTTP_URL=http://localhost:11920/
NEXT_PUBLIC_TELECO_COMMAND_WS_URL=ws://localhost:11920/command
```

`server.mjs` は起動時に以下を表示します。

- `teleco-gui listening on http://localhost:<PORT>`
- `teleco-gui listening on http://<LAN_IP>:<PORT>`
- `signaling ws: ws://localhost:<SIGNAL_PORT>/ws`
- `signaling ws: ws://<LAN_IP>:<SIGNAL_PORT>/ws`

複数台/複数環境での接続テストに使えます。
