## teleco-gui

teleco の GUI / Audio / Video をブラウザで操作するためのアプリです。

### まず使う人向け（Windows）

1. Node.js LTS をインストール（https://nodejs.org/）
2. このフォルダで `start.bat` をダブルクリック
3. 起動完了後、ブラウザが自動で開きます（例: `http://localhost:3000`）

`start.bat` が自動で行うこと:

- `node` / `npm` の存在チェック
- `node_modules` が無い場合の `npm install`
- `.env.local` / `.env` の `PORT` を読んで待機先URLを決定
- サーバー起動後にブラウザを自動オープン

停止する場合:

- サーバー用に開いた黒いウィンドウを閉じる
- またはそのウィンドウで `Ctrl + C`

### 手動起動（開発者向け）

```bash
npm install
npm run dev
```

本番モードで動作確認する場合:

```bash
npm run build
npm run start
```

### 依存関係のアップデート手順

1. 更新候補を確認

```bash
npm run deps:check
```

2. まずは安全更新（パッチ/マイナー）

```bash
npm run deps:update
```

3. 動作確認

```bash
npm run deps:verify
```

4. メジャー更新も行う場合

```bash
npm run deps:major
npm run deps:verify
```

依存関係の解決エラー（`ERESOLVE`）が出た場合は、ロックファイルと `node_modules` を再生成してください。

```bash
npm run deps:refresh
npm run deps:verify
```

補足:

- ESLint関連は `peerDependencies` の影響を受けやすいため、単体ではなく関連パッケージをまとめて更新するのが安全です。

### 主要ページ

- `/gui` : オペレーターGUI
- `/video` : Video Sender
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
# Video Sender (/video, /gui webSender)
NEXT_PUBLIC_VIDEO_SEND_SIGNALING_IP_ADDRESS=localhost
NEXT_PUBLIC_VIDEO_SEND_SIGNALING_PORT=3000

# デフォルト値
NEXT_PUBLIC_GUI_AUDIO_ROOM_ID=operator1-audio
NEXT_PUBLIC_VIDEO_SENDER_ROOM_ID=operator1-video

# 旧キー（後方互換）
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

`/gui` `/video` `/audio` `/audio/sender` は、`Signaling WS URL` の直入力ではなく、`IP Address` / `Port` / `Room ID` 入力から URL を組み立てる方式です。  
画面上の `Signaling WS URL` は確認用表示です。

## トラブルシュート

- ブラウザが開かない:
  サーバーウィンドウにエラーが出ていないか確認し、`http://localhost:3000`（または `PORT` で指定した値）へ直接アクセスしてください。
- `Node.js is not installed` が出る:
  Node.js LTS をインストール後、新しいターミナル/Explorerで再実行してください。
- 起動待機がタイムアウトする:
  使用ポートが他アプリと競合している可能性があります。`.env.local` で `PORT=3001` のように変更して再実行してください。
