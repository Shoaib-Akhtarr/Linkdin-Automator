@echo off
title LinkedIn Automator - 24/7 Smart Autopilot
color 0A

echo ================================================================
echo           LINKEDIN 24/7 SMART AUTOPILOT ENGINE
echo ================================================================
echo.
echo  [1/3] Checking Google Chrome Debugging Session...

netstat -ano | findstr 9222 >nul
if %errorlevel% neq 0 (
    echo  [-] Starting Chrome with persistent profile on port 9222...
    set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
    if not exist %CHROME_PATH% (
        set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    )
    start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\LinkedInAutomationChromeProfile" --no-first-run --no-default-browser-check --disable-quic --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling https://www.linkedin.com/feed/
    timeout /t 3 /nobreak >nul
) else (
    echo  [+] Chrome Debugging Session is already ACTIVE on port 9222.
)

echo  [2/4] Checking Local Ollama AI Engine (Port 11434)...

netstat -ano | findstr 11434 >nul
if %errorlevel% neq 0 (
    echo  [-] Starting Local Ollama LLM Service...
    set OLLAMA_IGPU_ENABLE=1
    start /b "" "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve >nul 2>&1
    timeout /t 3 /nobreak >nul
) else (
    echo  [+] Local Ollama AI Engine is ACTIVE on port 11434.
)

echo  [3/4] Opening Control Dashboard...
timeout /t 1 >nul
start http://localhost:3000

echo  [4/4] Launching 24/7 Autopilot Automation Loop...
echo.
echo  ================================================================
echo   STATUS: AUTOPILOT ARMED AND RUNNING!
echo   - Target: Applying to 10 jobs every 2 hours automatically
echo   - Resume: Synthesizing customized ATS single-column vector CVs
echo   - Reports: Automatically emailing summary to onlyshoaib158@gmail.com
echo  ================================================================
echo.
echo  Keep this window open or minimized. Press Ctrl+C to stop anytime.
echo.

node server.js

pause
