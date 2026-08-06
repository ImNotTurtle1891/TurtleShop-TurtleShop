@echo off
setlocal
title SellBot Launcher
cd /d "%~dp0"

echo ==========================================
echo   SellBot Launcher
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo         Download it from https://nodejs.org ^(version 18 or newer^) and run this again.
    echo.
    pause
    exit /b 1
)

if not exist .env if not exist .env.local (
    copy .env.example .env >nul
    echo [SETUP] No .env file was found, so one was created for you.
    echo         Open the new .env file in a text editor ^(e.g. Notepad^),
    echo         fill in your Discord and SellAuth credentials, then run this again.
    echo.
    pause
    exit /b 1
)

set RUNNINGCOUNT=0
for /f %%i in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'node*' -and $_.CommandLine -match 'dist[\\/]index\.js|src[\\/]index\.ts' } | Measure-Object).Count"') do set RUNNINGCOUNT=%%i
if not "%RUNNINGCOUNT%"=="0" (
    echo [WARNING] The bot appears to already be running ^(%RUNNINGCOUNT% instance^(s^) found^).
    echo           Running two copies at once makes the bot reply twice and log
    echo           "Unknown interaction" errors. Close the other one first
    echo           ^(e.g. stop "npm run dev" or another launcher window^).
    echo.
    choice /c YN /m "Start anyway"
    if errorlevel 2 exit /b 1
    echo.
)

echo [1/4] Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check the output above for details.
    pause
    exit /b 1
)
echo.

echo [2/4] Checking your .env configuration...
call npx tsx src/validate-env.ts
if errorlevel 1 (
    echo.
    pause
    exit /b 1
)
echo.

echo [3/4] Registering slash commands with Discord...
call npm run deploy-commands
if errorlevel 1 (
    echo.
    echo [ERROR] Command registration failed. Make sure the bot has been
    echo         invited to your server with the applications.commands scope.
    pause
    exit /b 1
)
echo.

echo [4/4] Building and starting SellBot... (press Ctrl+C to stop)
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. Check the output above for details.
    pause
    exit /b 1
)
echo.

node dist/index.js

echo.
echo SellBot has stopped.
pause
