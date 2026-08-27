@echo off
setlocal enableextensions
REM ============================================================
REM  Modao Enterprise desktop client - apply recent-canvas patch
REM  Put app.asar.patched in the SAME folder as this script.
REM  Close the Modao Enterprise client before running.
REM ============================================================

set "SRC=%~dp0app.asar.patched"
set "APPVER=app-1.6.4"
set "TARGET=%LOCALAPPDATA%\modao-studio-enterprise\%APPVER%\resources\app.asar"

if not exist "%SRC%" (
  echo [ERROR] app.asar.patched not found:
  echo   %SRC%
  echo Please place app.asar.patched next to this script.
  goto :end
)

if not exist "%TARGET%" (
  echo [ERROR] target not found:
  echo   %TARGET%
  echo If the client version changed, edit APPVER in this script.
  goto :end
)

tasklist /FI "IMAGENAME eq Modao Enterprise.exe" 2>NUL | find /I "Modao Enterprise.exe" >NUL
if not errorlevel 1 (
  echo [WARN] Modao Enterprise is running. Close it (including tray icon) and retry.
  goto :end
)

echo Backing up original app.asar ...
copy /Y "%TARGET%" "%TARGET%.bak" >NUL
if errorlevel 1 ( echo [ERROR] backup failed. & goto :end )

echo Applying patch ...
copy /Y "%SRC%" "%TARGET%" >NUL
if errorlevel 1 ( echo [ERROR] replace failed. & goto :end )

echo.
echo Done. Original backed up to:
echo   %TARGET%.bak
echo You can now start Modao Enterprise.

:end
pause
