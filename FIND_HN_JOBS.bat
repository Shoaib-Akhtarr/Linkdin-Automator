@echo off
title Hacker News "Who is Hiring?" Job Harvester
cd /d "%~dp0"
echo ======================================================================
echo 🚀 HACKER NEWS "WHO IS HIRING?" UNIVERSAL TECH HARVESTER
echo Direct Founder/CTO Emails & ATS Portals for Any Tech Discipline
echo ======================================================================
echo.
echo Select your target tech track:
echo   [1] Auto-detect from candidate profile.json
echo   [2] DevOps, SRE ^& Cloud Infrastructure
echo   [3] .NET, C# ^& Microsoft Enterprise Stack
echo   [4] Frontend ^& Web Development (React / Next.js / Vue)
echo   [5] Backend ^& Systems (Go / Python / Java / Rust / Node)
echo   [6] Full Stack Software Engineering
echo   [7] AI, Machine Learning ^& LLM Multi-Agent Systems
echo   [8] Data Engineering ^& Analytics
echo   [9] All Tech Disciplines
echo.
set /p choice="Enter option (1-9, default 1): "

if "%choice%"=="2" (
    set TRACK=devops
) else if "%choice%"=="3" (
    set TRACK=dotnet
) else if "%choice%"=="4" (
    set TRACK=webdev
) else if "%choice%"=="5" (
    set TRACK=backend
) else if "%choice%"=="6" (
    set TRACK=fullstack
) else if "%choice%"=="7" (
    set TRACK=ai
) else if "%choice%"=="8" (
    set TRACK=data
) else if "%choice%"=="9" (
    set TRACK=all
) else (
    set TRACK=auto
)

echo.
echo Running Hacker News harvester for track: %TRACK% ...
python scripts\hn_hiring_finder.py --track %TRACK% --sync

echo.
echo ======================================================================
echo [✓] Discovered HN jobs saved to:
echo     - data\hn_discovered_jobs.json
echo     - data\hn_discovered_jobs.csv
echo [✓] Synced to Auto-Apply pipeline (data\ats_jobs.json)
echo ======================================================================
echo.
echo Tip: Run 'npm run outreach' or 'python scripts\cold_outreach.py --hn'
echo      to generate customized cold outreach emails for these positions!
echo.
pause
