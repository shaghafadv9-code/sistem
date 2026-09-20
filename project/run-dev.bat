@echo off
REM Smart Secretary - Dev mode (Windows)
title Smart Secretary (Dev)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed: https://nodejs.org
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0])<20?1:0)"
if errorlevel 1 (
  echo [ERROR] Node.js 20+ required: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo First-time setup: installing components...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Setup failed.
    pause
    exit /b 1
  )
)

echo Starting servers...
start "Smart Secretary API" /min cmd /c "npm run server"
start "Smart Secretary Web" /min cmd /c "npm run client"
echo Waiting for servers (8 seconds)...
timeout /t 8 /nobreak >nul
echo Opening app window...
call npx electron .
pause
