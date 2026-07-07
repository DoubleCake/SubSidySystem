@echo off
setlocal enabledelayedexpansion

set REMOTE_DIR=/opt/updates/
set SERVER=root@8.137.8.78

REM Read version from package.json
node -p "require('./package.json').version" > "%TEMP%\version.txt" 2>nul
set /p VERSION=<"%TEMP%\version.txt"
del "%TEMP%\version.txt" 2>nul

echo ========================================
echo   Deploy v%VERSION%
echo ========================================

echo.
echo [1/3] Build...
call npx electron-vite build
if %errorlevel% neq 0 ( echo FAILED & exit /b 1 )

echo [2/3] Package NSIS installer...
if exist dist rmdir /s /q dist
call npx electron-builder --win --publish never
if %errorlevel% neq 0 ( echo FAILED & exit /b 1 )

echo [3/3] Prepare release files...
if not exist dist\release mkdir dist\release

REM Find NSIS installer
set SETUP_FILE=
for %%f in (dist\SubsidySystem*.exe) do set SETUP_FILE=%%~nxf
if "%SETUP_FILE%"=="" (
  echo ERROR: NSIS installer not found!
  dir /b dist\*.exe 2>nul
  exit /b 1
)

copy /y "dist\%SETUP_FILE%" "dist\release\%SETUP_FILE%" >nul
for %%A in ("dist\release\%SETUP_FILE%") do set EXE_SIZE=%%~zA

REM Copy blockmap
set BLOCKMAP_FILE=%SETUP_FILE%.blockmap
if exist "dist\%BLOCKMAP_FILE%" (
  copy /y "dist\%BLOCKMAP_FILE%" "dist\release\%BLOCKMAP_FILE%" >nul
  echo blockmap: %BLOCKMAP_FILE%
) else (
  echo WARNING: blockmap not found
)

REM Compute SHA512 via PowerShell
echo Computing SHA512...
powershell -NoProfile -Command "[Convert]::ToBase64String((Get-FileHash -LiteralPath 'dist\release\%SETUP_FILE%' -Algorithm SHA512).Hash)" > "%TEMP%\sha512.txt"
set /p SHA512=<"%TEMP%\sha512.txt"
del "%TEMP%\sha512.txt" 2>nul
echo SHA512: %SHA512%

REM Generate latest.yml
(
echo version: %VERSION%
echo files:
echo   - url: %SETUP_FILE%
echo     sha512: %SHA512%
echo     size: %EXE_SIZE%
echo path: %SETUP_FILE%
echo sha512: %SHA512%
echo releaseDate: %DATE:~0,4%-%DATE:~5,2%-%DATE:~8,2%T00:00:00.000Z
) > dist\release\latest.yml

if exist dist\win-unpacked (
  copy /y dist\release\latest.yml dist\win-unpacked\resources\app-update.yml >nul
)

REM Copy versions.json (版本更新日志)
if exist versions.json (
  copy /y versions.json dist\release\versions.json >nul
  echo versions.json copied
)

echo.
echo ========================================
echo   Done!
echo   %SETUP_FILE% (%EXE_SIZE% bytes^)
echo ========================================
echo.
echo Upload: scp dist\release\* %SERVER%:%REMOTE_DIR%
