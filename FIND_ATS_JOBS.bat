@echo off
title Direct ATS Job Finder & Dorking Pipeline
cd /d "%~dp0"
echo ======================================================================
echo 🎯 DIRECT ATS JOB FINDER (Greenhouse, Ashby, Lever, Workday)
echo ======================================================================
echo.
python scripts\ats_finder.py --show-dorks --sync
echo.
echo ======================================================================
echo [✓] Discovered jobs have been saved to data\ats_discovered_jobs.csv
echo [✓] Jobs synced to AutoApply pipeline (data\ats_jobs.json)
echo ======================================================================
pause
