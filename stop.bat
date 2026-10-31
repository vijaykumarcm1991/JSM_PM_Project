@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo An error occurred while stopping the application.
    pause
)
