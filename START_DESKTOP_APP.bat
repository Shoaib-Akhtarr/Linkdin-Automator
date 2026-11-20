@echo off
cd /d "%~dp0"
title AutoApply AI - Desktop Application
color 0B

echo ================================================================
echo           AutoApply AI - Autonomous Career Suite
echo                 Native Desktop Application
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

echo [1/2] Checking desktop runtime environment...
echo [2/2] Launching AutoApply AI Native Desktop App...
echo.
echo * Running in dedicated application window
echo * System Tray enabled (runs in background when window is closed)
echo.

npx electron electron/main.js

if %errorlevel% neq 0 (
    echo.
    echo [Notice] Desktop application closed.
)
