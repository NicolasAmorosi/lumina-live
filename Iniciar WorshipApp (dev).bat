@echo off
REM Dev launcher only — the packaged app installs its own Start Menu shortcut
REM via electron-builder's NSIS installer, so this is not needed once WorshipApp
REM is installed. %~dp0 resolves to this file's own folder, fixing the legacy
REM script's hardcoded "C:\Users\emili\Downloads\WorshipApp" path that only
REM worked on one specific machine.
cd /d "%~dp0"
call npm run dev
pause
