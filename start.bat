@echo off
setlocal

REM このbatファイルがあるフォルダ（=プロジェクトルート）に移動
cd /d "%~dp0"

REM サーバー起動（別ウィンドウで実行して残す）
start "Node Server" cmd /k "npm run start"

echo Waiting for http://localhost:3000 ...

:wait_loop
powershell -NoProfile -Command "try { $r=Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200){ exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait_loop
)

start "" "http://localhost:3000"
endlocal
