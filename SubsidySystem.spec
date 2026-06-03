# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[('static', 'static')],
    hiddenimports=['uvicorn', 'uvicorn.loops.auto', 'uvicorn.protocols.http.auto', 'fastapi', 'starlette', 'sqlalchemy', 'openpyxl', 'pydantic', 'pydantic_core', 'anthropic', 'python_multipart', 'multipart', 'passlib', 'passlib.handlers.bcrypt', 'bcrypt', 'encodings', 'routers', 'services', 'core', 'models', 'database', 'schemas', 'utils', 'export_utils', 'seed_data', 'routers.farmers', 'routers.subsidies', 'routers.settings', 'routers.households', 'routers.external_links', 'routers.backup', 'routers.eligibility', 'routers.excel_templates', 'routers.land', 'routers.error_library', 'routers.household_import', 'routers.agri_tasks', 'routers.large_farmers', 'routers.project_progress', 'routers.auth', 'routers.village_contacts', 'routers.ai_analyze', 'services.subsidy_service', 'core.exceptions', 'core.response'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'unittest'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='SubsidySystem',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
