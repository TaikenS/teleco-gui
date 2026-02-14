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

## 環境変数（`.env` と `.env.local`）

優先順位は `.env.local` > `.env` です。  
共通値は `.env`（Git管理）に置き、個人環境の上書きだけ `.env.local` に置いてください。

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
# またはIP/ホストだけ固定（任意）
# NEXT_PUBLIC_SIGNALING_IP_ADDRESS=192.168.0.10

# 用途別Signal先（推奨）
# Audio Receiver (/audio)
NEXT_PUBLIC_AUDIO_SIGNALING_IP_ADDRESS=localhost
NEXT_PUBLIC_AUDIO_SIGNALING_PORT=3000
# Audio Sender (/audio/sender, /gui 音声送信)
NEXT_PUBLIC_AUDIO_SEND_SIGNALING_IP_ADDRESS=localhost
NEXT_PUBLIC_AUDIO_SEND_SIGNALING_PORT=3000
# Video Sender (/sender, /gui webSender)
NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS=localhost
NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT=3000

# デフォルト値
NEXT_PUBLIC_DEFAULT_VIDEO_ROOM=room1
NEXT_PUBLIC_DEFAULT_AUDIO_ROOM=audio1

# teleco-main 接続先
NEXT_PUBLIC_TELECO_IP_ADDRESS=localhost
NEXT_PUBLIC_TELECO_PORT=11920
```

`server.mjs` は起動時に以下を表示します。

- `teleco-gui listening on http://localhost:<PORT>`
- `teleco-gui listening on http://<LAN_IP>:<PORT>`
- `signaling ws: ws://localhost:<SIGNAL_PORT>/ws`
- `signaling ws: ws://<LAN_IP>:<SIGNAL_PORT>/ws`

複数台/複数環境での接続テストに使えます。

### Signaling設定UIについて

`/gui` `/sender` `/audio` `/audio/sender` は、`Signaling WS URL` の直入力ではなく、`IP Address` / `Port` / `Room ID` 入力から URL を組み立てる方式です。  
画面上の `Signaling WS URL` は確認用表示です。
