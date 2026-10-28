@echo off
title LinkedIn Easy Apply Automator Dashboard
echo ========================================================
echo   Starting LinkedIn Easy Apply Dashboard Server
echo ========================================================
echo Checking Local Ollama AI Engine (Port 11434)...
netstat -ano | findstr 11434 >nul
if %errorlevel% neq 0 (
    echo Starting Local Ollama LLM Service...
    set OLLAMA_IGPU_ENABLE=1
    start /b "" "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve >nul 2>&1
    timeout /t 3 /nobreak >nul
) else (
    echo Local Ollama AI Engine is ACTIVE.
)
echo.
start http://localhost:3000
node server.js
pause
