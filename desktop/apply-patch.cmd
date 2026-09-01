@echo off
setlocal enableextensions
REM ============================================================
REM  Modao Enterprise desktop client - apply recent-canvas patch
REM  Place app.asar.patched next to this script, then run.
REM  Close Modao Enterprise (incl. tray icon) before running.
REM  Every run appends a result line to apply-patch.log here.
REM ============================================================

set "SRC=%~dp0app.asar.patched"
set "APPVER=app-1.6.4"
set "TARGET=%LOCALAPPDATA%\modao-studio-enterprise\%APPVER%\resources\app.asar"
set "LOG=%~dp0apply-patch.log"

echo [%DATE% %TIME%] apply-patch start > "%LOG%"

if not exist "%SRC%" (
  echo [%DATE% %TIME%] ERROR: app.asar.patched not found: %SRC% >> "%LOG%"
  echo ERROR: app.asar.patched not found beside this script.
  echo   %SRC%
  goto :end
)

if not exist "%TARGET%" (
  echo [%DATE% %TIME%] ERROR: target app.asar not found: %TARGET% >> "%LOG%"
  echo ERROR: target app.asar not found.
  echo   %TARGET%
  echo   If the client version changed, edit APPVER in this script.
  goto :end
)

tasklist /FI "IMAGENAME eq Modao Enterprise.exe" 2>NUL | find /I "Modao Enterprise.exe" >NUL
if not errorlevel 1 (
  echo [%DATE% %TIME%] WARN: Modao Enterprise is running, abort. >> "%LOG%"
  echo WARN: Modao Enterprise is still running.
  echo       Close it completely, including the tray icon, then run again.
  goto :end
)

if not exist "%TARGET%.bak" (
  copy /Y "%TARGET%" "%TARGET%.bak" >NUL
  if errorlevel 1 (
    echo [%DATE% %TIME%] ERROR: backup failed. >> "%LOG%"
    echo ERROR: could not back up the original app.asar.
    goto :end
  )
  echo [%DATE% %TIME%] backed up original to %TARGET%.bak >> "%LOG%"
) else (
  echo [%DATE% %TIME%] backup already exists, skipped. >> "%LOG%"
)

copy /Y "%SRC%" "%TARGET%" >NUL
if errorlevel 1 (
  echo [%DATE% %TIME%] ERROR: replace failed, check permissions. >> "%LOG%"
  echo ERROR: failed to replace app.asar, try running as administrator.
  goto :end
)

echo [%DATE% %TIME%] OK: patch applied. >> "%LOG%"
echo.
echo Done. Recent-canvas tab bar patch applied.
echo   Original backup: %TARGET%.bak
echo   Restart Modao Enterprise to load it.

:end
echo [%DATE% %TIME%] apply-patch end. See %LOG% >> "%LOG%"
pause
