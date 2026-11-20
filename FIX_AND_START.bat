@echo off
title AutoApply Fix & Self-Healing Launcher
color 0A
echo ========================================================
echo   AutoApply AI: Complete Self-Healing & System Reset
echo ========================================================
echo.
echo [1/4] Stopping any hanging Chrome or Node processes...
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq LinkedIn Job Assistant*" >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/4] Clearing orphaned browser locks...
del /F /Q "%LOCALAPPDATA%\Google\Chrome\AutoApply Data\lockfile" >nul 2>&1

echo [3/4] Launching Google Chrome in Visible Debug Mode on Port 9222...
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME_PATH% set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\AutoApply Data" --profile-directory="Profile 4" --no-first-run --no-default-browser-check --disable-blink-features=AutomationControlled https://www.linkedin.com/feed/

timeout /t 2 /nobreak >nul

echo [4/4] Starting Dashboard Server at http://localhost:3000...
start http://localhost:3000
node server.js
pause
