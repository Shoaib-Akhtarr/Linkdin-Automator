@echo off
title Connect Real Logged-In Chrome to AutoApply
color 0B
echo ================================================================
echo    LAUNCHING YOUR REAL GOOGLE CHROME (WITH DEBUGGING ENABLED)
echo ================================================================
echo.
echo [1/2] Closing existing Chrome to enable automation port 9222...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/2] Starting your real Chrome profile (onlyshoaib158@gmail.com)...
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME_PATH% set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" --profile-directory="Default" --no-first-run --no-default-browser-check https://www.linkedin.com/feed/

echo.
echo ================================================================
echo  DONE! Your REAL Chrome is now open with port 9222 enabled.
echo  Because this is your real Chrome, LinkedIn is ALREADY logged in!
echo.
echo  Now switch back to your Dashboard at:
echo  http://localhost:3000
echo  and click "Start" (or resume)!
echo ================================================================
echo.
pause
