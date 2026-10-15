@echo off
cd /d "%~dp0"
title LinkedIn Job Assistant - Control Dashboard
color 0B

echo ================================================================
echo           LINKEDIN JOB APPLICATION DASHBOARD
echo ================================================================
echo.
echo  [1/2] Checking Chrome Debugging Session...

netstat -ano | findstr 9222 >nul
if %errorlevel% neq 0 (
    echo  [-] Starting Chrome with debugging profile on port 9222...
    set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
    if not exist %CHROME_PATH% (
        set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    )
    start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\LinkedInAutomationChromeProfile" --no-first-run --no-default-browser-check --disable-quic https://www.linkedin.com/jobs/
    timeout /t 3 /nobreak >nul
) else (
    echo  [+] Chrome is already active.
)

echo  [2/2] Opening Dashboard: http://localhost:3000
timeout /t 1 >nul
start http://localhost:3000

echo.
echo ================================================================
echo  DASHBOARD READY!
echo  Click "Start" on http://localhost:3000 whenever you want to apply.
echo  No automatic background scheduling. You have full manual control.
echo ================================================================
echo.

node server.js

pause
