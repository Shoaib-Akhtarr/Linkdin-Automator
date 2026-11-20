@echo off
title Soft Touch Cold Outreach Note Generator
cd /d "%~dp0"
echo ======================================================================
echo ✉️  STEP 2: SOFT TOUCH COLD OUTREACH NOTES (24H FOLLOW-UP)
echo ======================================================================
echo.
python scripts\cold_outreach.py --recent
echo.
echo ======================================================================
echo [✓] 3-Sentence personalized notes and 1-click search links generated.
echo ======================================================================
pause
