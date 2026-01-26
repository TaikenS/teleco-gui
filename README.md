npm run dev

/sender
/gui

node signaling-server.js

送りたいPC
http://localhost:3000/sender
を開く。
.env.local
NEXT_PUBLIC_SIGNALING_URL=ws://localhost:8080
を変更する。
受け取るPC
node signaling-server.js
もする。
