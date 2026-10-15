@echo off
cd /d "%~dp0"
title LinkedIn Job Assistant - Control Dashboard
color 0B

echo ================================================================
echo           LINKEDIN JOB APPLICATION DASHBOARD
echo ================================================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please make sure Node.js is installed.
    echo.
    pause
    exit /b 1
)

echo  Starting LinkedIn Dashboard Server...
echo  The dashboard will open automatically in your browser at:
echo  http://localhost:3000
echo.
echo ================================================================
echo  DASHBOARD RUNNING!
echo  Keep this black window open while using the dashboard.
echo  Close this window to stop the server.
echo ================================================================
echo.

node server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server stopped with an exit code: %errorlevel%
    pause
)
