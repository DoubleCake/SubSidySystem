# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 打包配置 — 农户补贴管理系统
打包命令: pyinstaller build.spec --clean
"""

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        # 前端静态文件
        ('static', 'static'),
    ],
    hiddenimports=[
        # FastAPI / Uvicorn
        'uvicorn', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan', 'uvicorn.lifespan.on',
        'fastapi', 'fastapi.middleware', 'fastapi.middleware.cors',
        'starlette', 'starlette.middleware',
        # SQLAlchemy
        'sqlalchemy', 'sqlalchemy.ext', 'sqlalchemy.ext.declarative',
        'sqlalchemy.sql', 'sqlalchemy.sql.default_comparator',
        # 项目内部模块
        'routers', 'routers.farmers', 'routers.subsidies', 'routers.ai_analyze',
        'routers.settings', 'routers.households', 'routers.external_links',
        'routers.backup', 'routers.eligibility', 'routers.excel_templates',
        'routers.land', 'routers.error_library', 'routers.household_import',
        'routers.agri_tasks', 'routers.large_farmers', 'routers.project_progress',
        'routers.auth', 'routers.village_contacts',
        'services', 'services.subsidy_service',
        'core', 'core.exceptions', 'core.response',
        'models', 'database', 'schemas', 'utils', 'seed_data', 'export_utils',
        # 第三方
        'openpyxl', 'pydantic', 'pydantic_core',
        'anthropic', 'python_multipart', 'multipart',
        'passlib', 'passlib.handlers', 'passlib.handlers.bcrypt',
        'bcrypt',
        # 系统相关
        'encodings', 'codecs',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'unittest', 'test', 'tests',
        'pydoc', 'distutils', 'setuptools',
        'pip', 'wheel',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='SubsidySystem',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # 显示控制台窗口，方便查看日志和 Ctrl+C 停止
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
