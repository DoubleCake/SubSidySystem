@echo off
chcp 65001 >nul
REM ══════════════════════════════════════════════════════
REM  发布更新到服务器 (Windows 版)
REM  用法: deploy.bat
REM ══════════════════════════════════════════════════════

REM ── 配置 ──
set SERVER=root@8.137.8.78
set REMOTE_DIR=/opt/updates/
set SERVER_URL=http://8.137.8.78:8080/

REM ── 读取版本号 ──
for /f "tokens=2 delims=: " %%a in ('node -p "require('./package.json').version"') do set VERSION=%%a
set VERSION=%VERSION:"=%
set VERSION=%VERSION: =%

echo ========================================
echo   发布更新 v%VERSION%
echo   目标: %SERVER%:%REMOTE_DIR%
echo ========================================

REM ── 1. 构建 ──
echo.
echo [1/4] 构建应用...
call npx electron-vite build
if %errorlevel% neq 0 ( echo ❌ 构建失败 && exit /b 1 )
echo ✅ 构建完成

REM ── 2. 打包 ──
echo.
echo [2/4] 打包...
rmdir /s /q dist 2>nul
call npx electron-builder --dir --win
if %errorlevel% neq 0 ( echo ❌ 打包失败 && exit /b 1 )
echo ✅ 打包完成

REM ── 3. 准备文件 ──
echo.
echo [3/4] 准备上传文件...

set APP_EXE=农户补贴管理系统.exe
set RELEASE_DIR=dist\release
mkdir %RELEASE_DIR% 2>nul

REM 复制 exe
copy "dist\win-unpacked\%APP_EXE%" "%RELEASE_DIR%\%APP_EXE%" >nul

REM 获取文件大小
for %%A in ("%RELEASE_DIR%\%APP_EXE%") do set EXE_SIZE=%%~zA

REM 生成 latest.yml（文件名自动对齐）
(
echo version: %VERSION%
echo files:
echo   - url: %APP_EXE%
echo     sha512: SKIP
echo     size: %EXE_SIZE%
echo path: %APP_EXE%
echo sha512: SKIP
echo releaseDate: %DATE:~0,4%-%DATE:~5,2%-%DATE:~8,2%T00:00:00.000Z
) > "%RELEASE_DIR%\latest.yml"

echo ✅ 准备完成:
echo    %APP_EXE% (%EXE_SIZE% bytes)
echo    latest.yml (version: %VERSION%)

REM ── 4. 上传 ──
echo.
echo [4/4] 上传到 %SERVER%:%REMOTE_DIR%
scp "%RELEASE_DIR%\%APP_EXE%" "%RELEASE_DIR%\latest.yml" %SERVER%:%REMOTE_DIR%

if %errorlevel% equ 0 (
  echo.
  echo ========================================
  echo   发布完成!
  echo   验证: curl %SERVER_URL%latest.yml
  echo ========================================
) else (
  echo ❌ 上传失败
)
