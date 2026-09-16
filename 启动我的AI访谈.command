#!/bin/zsh
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null; then
  echo '需要先安装 Node.js 20 或更高版本。'
  read 'reply?按回车关闭'
  exit 1
fi
if curl -fsS http://localhost:5173/admin 2>/dev/null | grep -q '我的 AI 访谈'; then
  open 'http://localhost:5173/admin'
  exit 0
fi
open 'http://localhost:5173/admin'
echo '网站启动后可刷新网页。使用期间请保留此窗口，停止请按 Control+C。'
node server.mjs
read 'reply?按回车关闭'
