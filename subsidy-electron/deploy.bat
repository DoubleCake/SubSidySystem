@echo off
setlocal enabledelayedexpansion

set "REMOTE_DIR=/opt/updates/"
set "SERVER=root@8.137.8.78"

for /f %%a in ('node -p "require('./package.json').version"') do set VERSION=%%a
set "SETUP_GLOB=SubsidySystem Setup %VERSION%"

echo ========================================
echo   Deploy v%VERSION%
echo ========================================

echo.
echo [1/4] Build...
call npx electron-vite build
if %errorlevel% neq 0 ( echo FAILED & exit /b 1 )

echo [2/4] Package NSIS installer...
if exist dist rmdir /s /q dist
REM --win 生成 NSIS 安装包（不带 --dir，确保生成完整的安装包而非散装目录）
call npx electron-builder --win --publish never
if %errorlevel% neq 0 ( echo FAILED & exit /b 1 )

echo [3/4] Prepare release files...
if not exist dist\release mkdir dist\release

REM 查找 NSIS 安装包（文件名包含版本号）
set "SETUP_FILE="
for %%f in (dist\"%SETUP_GLOB%.exe") do set "SETUP_FILE=%%~nxf"
if "%SETUP_FILE%"=="" (
  echo ERROR: NSIS installer not found! Expected: dist\%SETUP_GLOB%.exe
  echo Files in dist\:
  dir /b dist\*.exe 2>nul
  exit /b 1
)

copy /y "dist\%SETUP_FILE%" "dist\release\%SETUP_FILE%" >nul
for %%A in ("dist\release\%SETUP_FILE%") do set EXE_SIZE=%%~zA

REM 复制 blockmap（用于差量更新，大幅加速后续更新下载）
set "BLOCKMAP_FILE=%SETUP_FILE%.blockmap"
if exist "dist\%BLOCKMAP_FILE%" (
  copy /y "dist\%BLOCKMAP_FILE%" "dist\release\%BLOCKMAP_FILE%" >nul
  echo blockmap: %BLOCKMAP_FILE%
) else (
  echo WARNING: blockmap not found, differential updates disabled
)

REM 计算 SHA512 (base64) — electron-updater 用这个做完整性校验 + 差量更新
echo Computing SHA512...
for /f "delims=" %%h in ('powershell -NoProfile -Command "[Convert]::ToBase64String((Get-FileHash -LiteralPath 'dist\release\%SETUP_FILE%' -Algorithm SHA512).Hash)"') do set SHA512=%%h
echo SHA512: %SHA512%

REM 生成 latest.yml（electron-updater 标准格式）
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

REM 复制到 resources/ 作为 app-update.yml
if exist dist\win-unpacked (
  copy /y dist\release\latest.yml dist\win-unpacked\resources\app-update.yml >nul
)

echo [4/4] Done!
echo.
echo   Setup:  %SETUP_FILE% (%EXE_SIZE% bytes^)
echo   latest.yml (v%VERSION%^)
echo   SHA512:  %SHA512%
echo.
echo Upload manually:
echo   scp dist\release\%SETUP_FILE% dist\release\%BLOCKMAP_FILE% dist\release\latest.yml %SERVER%:%REMOTE_DIR%
echo.