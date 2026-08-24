@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0src\server.js"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
)

if errorlevel 1 (
  echo.
  echo The local collector stopped with an error. Review the message above.
  pause
)
