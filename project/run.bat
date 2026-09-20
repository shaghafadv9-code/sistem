@echo off
REM Smart Secretary - Windows launcher (double-click this file)
title Smart Secretary
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Please install Node.js LTS 20+ from https://nodejs.org then run again.
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0])<20?1:0)"
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required.
  echo Download it from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/4] First-time setup: installing components...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Setup failed - check internet connection and retry.
    pause
    exit /b 1
  )
)

if not exist node_modules\electron\dist\electron.exe (
  echo [2/4] Fixing Electron installation...
  call npm install --no-audit --no-fund -D electron@33
  if errorlevel 1 (
    echo Electron install failed.
    pause
    exit /b 1
  )
)

if not exist client\dist (
  echo [3/4] First-time setup: building interface...
  call npm run build:client
  if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
  )
)

echo [4/4] Starting Smart Secretary...
set USE_BUILD=1
call npx electron .
if errorlevel 1 (
  echo.
  echo [ERROR] App closed unexpectedly.
  echo See log file: data\api.log
)
pause
