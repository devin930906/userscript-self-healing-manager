@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js 24 is required. & exit /b 1)
where npm >nul 2>&1 || (echo npm is required. & exit /b 1)
echo [1/6] npm install (locks declared dependencies)
call npm install || exit /b 1
echo [2/6] npm test
call npm test || exit /b 1
echo [3/6] npm run build
call npm run build || exit /b 1
echo [4/6] npm run dist:win (Setup.exe and Portable.exe)
call npm run dist:win || exit /b 1
echo [5/6] CreateFromDirectory full win-unpacked ZIP, not Portable EXE alone
echo [6/6] Get-FileHash SHA256 for all three files
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-windows.ps1" || exit /b 1
echo Windows preview files and checksums saved under release folder.
exit /b 0
