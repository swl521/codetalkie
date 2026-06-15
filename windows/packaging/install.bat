@echo off
REM install.bat — no-Inno fallback installer for 答鸭 Ducky.
REM Ship this INSIDE the self-contained publish folder. Double-click to install.
REM Copies the app to %LOCALAPPDATA%\Ducky and launches it (the app then
REM registers HKCU\...\Run for login auto-start by itself). No admin needed.

setlocal
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\Ducky"

echo Installing 答鸭 Ducky to "%DEST%" ...

REM Stop a running instance so files aren't locked.
taskkill /IM Ducky.exe /F >nul 2>&1

if not exist "%DEST%" mkdir "%DEST%"
robocopy "%SRC%." "%DEST%" /E /NFL /NDL /NJH /NJS /NP >nul

if not exist "%DEST%\Ducky.exe" (
  echo ERROR: copy failed, Ducky.exe not found in "%DEST%".
  pause
  exit /b 1
)

echo Launching ...
start "" "%DEST%\Ducky.exe"

echo Done. 答鸭 Ducky is running in the system tray.
echo (It will auto-start at login from now on.)
timeout /t 3 >nul
endlocal
