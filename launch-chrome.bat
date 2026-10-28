@echo off
title LinkedIn Chrome Debugger Launcher
echo ========================================================
echo   Launching Google Chrome with Remote Debugging (9222)
echo ========================================================
echo.
echo Closing existing debug sessions if any...

set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME_PATH% (
    set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

echo Starting Chrome with debugging port 9222...
start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\LinkedInAutomationChromeProfile" --no-first-run --no-default-browser-check --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling https://www.linkedin.com/jobs/

echo.
echo Chrome has been launched! 
echo Please log in to your LinkedIn account in the Chrome window if you haven't already.
echo.
pause
