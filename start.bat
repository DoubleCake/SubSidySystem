@echo off
chcp 65001 >nul
title 农户补贴管理系统

echo ================================================
echo   农户补贴管理系统
echo ================================================
echo.

:: 设置 Claude API Key（如有需要请填入）
:: set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

:: 进入脚本所在目录
cd /d "%~dp0"

:: 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.11+
    pause
    exit /b
)

:: 安装依赖（首次运行）
if not exist ".deps_installed" (
    echo [1/3] 安装依赖包...
    pip install -r requirements.txt -q
    echo. > .deps_installed
    echo       依赖安装完成
)

:: 初始化模拟数据（首次运行）
if not exist "subsidy.db" (
    echo [2/3] 初始化数据库和模拟数据...
    python seed_data.py
) else (
    echo [2/3] 数据库已存在，跳过初始化
)

:: 延迟1秒后打开浏览器
echo [3/3] 启动服务...
start "" timeout /t 2 /nobreak >nul & start http://localhost:8000/docs

:: 启动服务
python main.py

pause
