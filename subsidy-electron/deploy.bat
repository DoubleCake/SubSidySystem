@echo off
setlocal enabledelayedexpansion

set REMOTE_DIR=/opt/updates/


for /f %%a in ('node -p "require('./package.json').version"') do set VERSION=%%a

echo ========================================
echo   Deploy v%VERSION%
echo ========================================

echo.
echo [1/3] Build...
call npx electron-vite build
if %errorlevel% neq 0 ( echo FAILED & exit /b 1 )

echo [2/3] Package...
if exist dist rmdir /s /q dist
call npx electron-builder --dir --win
if %errorlevel% neq 0 ( echo FAILED & exit /b 1 )

echo [3/3] latest.yml...
if not exist dist\release mkdir dist\release

for %%f in (dist\win-unpacked\*.exe) do set APP_EXE=%%~nxf
copy /y "dist\win-unpacked\%APP_EXE%" "dist\release\%APP_EXE%" >nul
for %%A in ("dist\release\%APP_EXE%") do set EXE_SIZE=%%~zA

(
echo version: %VERSION%
echo files:
echo   - url: %APP_EXE%
echo     sha512: SKIP
echo     size: %EXE_SIZE%
echo path: %APP_EXE%
echo sha512: SKIP
echo releaseDate: %DATE:~0,4%-%DATE:~5,2%-%DATE:~8,2%T00:00:00.000Z
) > dist\release\latest.yml

REM also copy to resources/ for electron-updater
copy /y dist\release\latest.yml dist\win-unpacked\resources\app-update.yml >nul

echo Done! %APP_EXE% (%EXE_SIZE% bytes^) latest.yml (v%VERSION%^)
echo.

#scp dist\release\* root@8.137.8.78:/opt/updates/