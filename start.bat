@echo off
setlocal EnableDelayedExpansion

REM このbatファイルがあるフォルダ（=プロジェクトルート）に移動
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install Node.js LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not available.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo node_modules not found. Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

for /f "delims=" %%P in ('powershell -NoProfile -Command "$port='3000'; foreach($f in @('.env','.env.local')){ if(Test-Path $f){ $match=Get-Content $f | Select-String -Pattern '^\s*PORT\s*=\s*(.+)\s*$' | Select-Object -Last 1; if($match){ $raw=$match.Matches[0].Groups[1].Value.Trim(); $raw=$raw.Trim([char]34); $raw=$raw.Trim([char]39); if($raw){ $port=$raw } } } }; Write-Output $port"') do set "APP_PORT=%%P"

if not defined APP_PORT set "APP_PORT=3000"

echo Running production build...
call npm run build
if errorlevel 1 (
  echo [ERROR] npm run build failed.
  pause
  exit /b 1
)

REM サーバー起動（別ウィンドウで実行して残す）
start "teleco-gui prod server" cmd /k "npm run start"

echo Waiting for http://localhost:%APP_PORT% ...
set "WAIT_COUNT=0"
set "WAIT_LIMIT=180"

:wait_loop
powershell -NoProfile -Command "try { $r=Invoke-WebRequest 'http://localhost:%APP_PORT%' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200){ exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  set /a WAIT_COUNT+=1
  if !WAIT_COUNT! geq !WAIT_LIMIT! (
    echo [ERROR] Startup timeout. Check the server window for errors.
    pause
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  goto wait_loop
)

start "" "http://localhost:%APP_PORT%"
endlocal
