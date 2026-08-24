@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0scripts\setup.mjs"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
)

if errorlevel 1 (
  echo.
  echo Setup did not finish successfully. Review the message above.
) else (
  echo.
  echo Setup complete. Next, double-click Start.bat.
)
pause
