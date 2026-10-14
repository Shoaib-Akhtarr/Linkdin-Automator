@echo off
title LinkedIn Easy Apply Automator Dashboard
echo ========================================================
echo   Starting LinkedIn Easy Apply Dashboard Server
echo ========================================================
echo.
start http://localhost:3000
node server.js
pause
