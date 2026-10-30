#!/bin/zsh
cd "$(dirname "$0")"
PORT=4321
echo "🚀 DWG Lite Studio 서버를 시작합니다 (http://127.0.0.1:$PORT)..."
(sleep 1 && open "http://127.0.0.1:$PORT") &
node server.js
