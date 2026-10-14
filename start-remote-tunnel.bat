@echo off
title LinkedIn Automator - Remote Mobile Access Tunnel
echo ========================================================
echo   LinkedIn Automator - Free Remote Access Tunnel
echo   Access your Dashboard from your Phone or Anywhere!
echo ========================================================
echo.
echo Connecting your local dashboard (port 3000) to a secure public HTTPS URL...
echo Once loaded, copy the URL below and open it on your phone browser.
echo.
npx --yes localtunnel --port 3000
pause
