node signaling-server.js

node server.js

node server.js（8080）

タブA：http://localhost:8080/client.html?room=test

Connect WS

タブB：teleco-gui の画面

WebSocket URL：ws://localhost:8080/?room=test

WebSocket接続

WebRTC送信開始

これで client.html 側の Remote Audio に音が入れば成功です。