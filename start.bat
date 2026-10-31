@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo An error occurred while starting the application.
    pause
)
