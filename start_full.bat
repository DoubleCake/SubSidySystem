@echo off
chcp 65001 >nul
title 农户补贴管理系统 - 完整启动

echo ================================================
echo   农户补贴管理系统 - 完整启动脚本
echo   激活虚拟环境，编译前端，一键启动
echo ================================================
echo.

:: 进入脚本所在目录
cd /d "%~dp0"

:: 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.11+
    pause
    exit /b
)

:: 检查 Node.js 和 npm
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b
)
npm --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 npm，请先安装 npm
    pause
    exit /b
)

:: 设置 Python 解释器路径（优先使用虚拟环境）
set PYTHON_PATH=python
if exist "venv\Scripts\python.exe" (
    set PYTHON_PATH=venv\Scripts\python.exe
    echo [信息] 使用虚拟环境中的 Python
) else (
    echo [信息] 未找到虚拟环境，使用系统 Python
)

:: 安装后端依赖（首次运行）
if not exist ".deps_installed" (
    echo [1/5] 安装后端依赖包...
    %PYTHON_PATH% -m pip install -r requirements.txt -q
    echo. > .deps_installed
    echo       后端依赖安装完成
)

:: 初始化模拟数据（首次运行）
if not exist "subsidy.db" (
    echo [2/5] 初始化数据库和模拟数据...
    %PYTHON_PATH% seed_data.py
) else (
    echo [2/5] 数据库已存在，跳过初始化
)

:: 前端构建
echo [3/5] 检查前端依赖...
if not exist "frontend\node_modules" (
    echo       安装前端依赖...
    cd frontend
    npm install --silent
    cd ..
    echo       前端依赖安装完成
) else (
    echo       前端依赖已存在，跳过安装
)

echo [4/5] 编译前端...
cd frontend
npm run build
if errorlevel 1 (
    echo [错误] 前端编译失败，请检查错误信息
    cd ..
    pause
    exit /b
)
cd ..
echo       前端编译完成，输出到 static/ 目录

:: 延迟1秒后打开浏览器
echo [5/5] 启动服务...
start "" timeout /t 2 /nobreak >nul & start http://localhost:8000/docs

:: 启动服务
%PYTHON_PATH% main.py

pause