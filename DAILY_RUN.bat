@echo off
title AutoApply-AI — Daily Operations Console
color 0B
cd /d "%~dp0"

:MENU
cls
echo ======================================================================
echo           AutoApply-AI — Single Master Daily Console
echo ======================================================================
echo.
echo  Candidate: Shoaib Akhtar  ^|  Track: AI / LLM / Python Engineer
echo  Local Dashboard: http://localhost:3000  ^|  Port: 9222 (Chrome CDP)
echo.
echo ======================================================================
echo  SELECT OPERATION:
echo ======================================================================
echo.
echo  [1] (Recommended) FULL DAILY WORKFLOW
echo      - Step 1: Discover ATS jobs & Hacker News hiring posts
echo      - Step 2: Show system health & new opportunities
echo      - Step 3: Launch Chrome (Port 9222) & Control Dashboard (Port 3000)
echo.
echo  [2] Discover New Jobs Only (Greenhouse, Ashby, Lever, HN)
echo  [3] Process ATS Applications Queue (Apply to Curated Company Roles)
echo  [4] Launch Control Dashboard & Chrome Debugging (Port 3000)
echo  [D] Launch Native Desktop App (Electron Standalone Window)
echo  [5] Launch 24/7 Autopilot Automation Loop
echo  [6] Send Soft-Touch Outreach (Recent ATS & HN Contacts)
echo  [7] View Daily Summary & Queue Audit
echo  [8] View Deep Performance Metrics & Weekly KPIs
echo  [9] Emergency Reset & Self-Healing (Clear locks & restart)
echo  [0] Exit
echo.
echo ======================================================================
set /p opt="Enter choice [1-9, default 1]: "

if "%opt%"=="" set opt=1
if "%opt%"=="1" goto FULL_WORKFLOW
if "%opt%"=="2" goto DISCOVER_JOBS
if "%opt%"=="3" goto PROCESS_ATS
if "%opt%"=="4" goto LAUNCH_DASHBOARD
if /i "%opt%"=="D" goto LAUNCH_ELECTRON
if "%opt%"=="5" goto LAUNCH_AUTOPILOT
if "%opt%"=="6" goto COLD_OUTREACH
if "%opt%"=="7" goto SHOW_SUMMARY
if "%opt%"=="8" goto SHOW_METRICS
if "%opt%"=="9" goto RESET_SYSTEM
if "%opt%"=="0" exit /b 0

echo Invalid choice. Try again.
timeout /t 2 >nul
goto MENU


:FULL_WORKFLOW
cls
echo ======================================================================
echo [Step 1/3] Scanning Curated ATS Platforms (Ashby, Greenhouse, Lever)...
echo ======================================================================
python scripts\ats_finder.py --sync
echo.

echo ======================================================================
echo [Step 2/3] Scanning Hacker News "Who is Hiring?" for AI Roles...
echo ======================================================================
python scripts\hn_hiring_finder.py --track auto --sync
echo.

echo ======================================================================
echo [Step 3/3] Daily Health & Queue Summary
echo ======================================================================
node scripts\daily_summary.js
echo.
echo Preparing Chrome session and Control Dashboard...
timeout /t 2 /nobreak >nul
goto LAUNCH_DASHBOARD


:DISCOVER_JOBS
cls
echo ======================================================================
echo Discovering New Jobs (ATS & Hacker News)...
echo ======================================================================
python scripts\ats_finder.py --show-dorks --sync
echo.
python scripts\hn_hiring_finder.py --track auto --sync
echo.
node scripts\daily_summary.js
echo.
pause
goto MENU


:PROCESS_ATS
cls
echo ======================================================================
echo Processing Direct Company ATS Queue...
echo ======================================================================
echo.
netstat -ano | findstr 9222 >nul
if %errorlevel% neq 0 (
    echo [-] Launching Chrome on port 9222 with Profile 4...
    set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
    if not exist %CHROME_PATH% set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\AutoApply Data" --profile-directory="Profile 4" --no-first-run --no-default-browser-check https://www.linkedin.com/feed/
    timeout /t 3 /nobreak >nul
)
node scripts\process_ats_queue.js
echo.
pause
goto MENU


:LAUNCH_ELECTRON
cls
echo ======================================================================
echo Launching Native Electron Desktop App...
echo ======================================================================
echo.
npx electron electron\main.js
goto MENU


:LAUNCH_DASHBOARD
cls
echo ======================================================================
echo Launching Google Chrome & Dashboard Server...
echo ======================================================================
echo.
netstat -ano | findstr 9222 >nul
if %errorlevel% neq 0 (
    echo [-] Launching Chrome on port 9222 with Profile 4...
    set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
    if not exist %CHROME_PATH% set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\AutoApply Data" --profile-directory="Profile 4" --no-first-run --no-default-browser-check https://www.linkedin.com/feed/
    timeout /t 3 /nobreak >nul
) else (
    echo [+] Chrome Debugging session is already running on port 9222.
)

netstat -ano | findstr 11434 >nul
if %errorlevel% neq 0 (
    echo [-] Starting Local Ollama AI Engine...
    set OLLAMA_IGPU_ENABLE=1
    start /b "" "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve >nul 2>&1
    timeout /t 2 /nobreak >nul
) else (
    echo [+] Ollama AI Engine is ACTIVE on port 11434.
)

echo.
echo [+] Opening Dashboard: http://localhost:3000
start http://localhost:3000
echo.
echo Keep this window open while using the system.
node server.js
pause
goto MENU


:LAUNCH_AUTOPILOT
cls
call START_24-7_AUTOPILOT.bat
goto MENU


:COLD_OUTREACH
cls
echo ======================================================================
echo Generating Soft-Touch Cold Outreach Notes...
echo ======================================================================
python scripts\cold_outreach.py --recent
echo.
python scripts\cold_outreach.py --hn
echo.
pause
goto MENU


:SHOW_SUMMARY
cls
node scripts\daily_summary.js
pause
goto MENU


:SHOW_METRICS
cls
node scripts\performance_metrics.js
pause
goto MENU


:RESET_SYSTEM
cls
echo ======================================================================
echo Running Self-Healing System Reset...
echo ======================================================================
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq LinkedIn Job Assistant*" >nul 2>&1
timeout /t 1 /nobreak >nul
del /F /Q "%LOCALAPPDATA%\Google\Chrome\AutoApply Data\lockfile" >nul 2>&1
echo [✓] Locks cleared and processes reset.
echo.
pause
goto MENU
