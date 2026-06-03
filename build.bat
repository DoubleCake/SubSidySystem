@echo off
chcp 65001 >nul
echo ========================================
echo   SubsidySystem Build Script
echo ========================================
echo.
echo [1/2] Building frontend...
cd /d "%~dp0frontend"
call npx vite build --outDir ..\static
if %ERRORLEVEL% NEQ 0 (
    echo Frontend build failed!
    pause
    exit /b 1
)
echo.
echo [2/2] Packaging EXE with PyInstaller...
cd /d "%~dp0"
pyinstaller --onefile --add-data "static;static" --name SubsidySystem --clean --noconfirm --hidden-import uvicorn --hidden-import uvicorn.loops.auto --hidden-import uvicorn.protocols.http.auto --hidden-import fastapi --hidden-import starlette --hidden-import sqlalchemy --hidden-import openpyxl --hidden-import pydantic --hidden-import pydantic_core --hidden-import anthropic --hidden-import python_multipart --hidden-import multipart --hidden-import passlib --hidden-import passlib.handlers.bcrypt --hidden-import bcrypt --hidden-import encodings --hidden-import routers --hidden-import services --hidden-import core --hidden-import models --hidden-import database --hidden-import schemas --hidden-import utils --hidden-import export_utils --hidden-import seed_data --hidden-import routers.farmers --hidden-import routers.subsidies --hidden-import routers.settings --hidden-import routers.households --hidden-import routers.external_links --hidden-import routers.backup --hidden-import routers.eligibility --hidden-import routers.excel_templates --hidden-import routers.land --hidden-import routers.error_library --hidden-import routers.household_import --hidden-import routers.agri_tasks --hidden-import routers.large_farmers --hidden-import routers.project_progress --hidden-import routers.auth --hidden-import routers.village_contacts --hidden-import routers.ai_analyze --hidden-import services.subsidy_service --hidden-import core.exceptions --hidden-import core.response --exclude-module tkinter --exclude-module unittest main.py

echo.
echo ========================================
echo   Build Complete!
echo   Output: dist\SubsidySystem.exe
echo ========================================
pause