@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist config.json (
  copy config.example.json config.json >nul
  echo [提示] 已生成 config.json，可修改 targets / apiKey
)

if not exist dist\index.html (
  echo [错误] 未找到 dist，请先执行: npm install ^&^& npm run build
  pause
  exit /b 1
)

start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8090'"
node server.mjs
pause
