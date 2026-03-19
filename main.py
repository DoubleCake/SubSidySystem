import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from database import engine
from models import Base
from routers import farmers, subsidies, ai_analyze, settings, precheck, households, external_links, backup, eligibility, excel_templates

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="农户补贴管理系统",
    description="内网本地部署版 · Python FastAPI + SQLite",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(farmers.router)
app.include_router(subsidies.router)
app.include_router(ai_analyze.router)
app.include_router(settings.router)
app.include_router(precheck.router)
app.include_router(households.router)
app.include_router(external_links.router)
app.include_router(backup.router)
app.include_router(eligibility.router)
app.include_router(excel_templates.router)

@app.get("/api/health")
def health():
    return {"status": "ok", "message": "农户补贴管理系统运行中"}

@app.get("/api/village-groups")
def get_village_groups():
    from database import SessionLocal
    from models import VillageGroup
    session = SessionLocal()
    items = session.query(VillageGroup).all()
    result = [{"id": v.id, "village_name": v.village_name, "group_no": v.group_no, "full_name": v.full_name} for v in items]
    session.close()
    return result

# ── 托管前端静态文件 ──
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

def has_index(d: str) -> bool:
    return os.path.isfile(os.path.join(d, "index.html"))

if has_index(static_dir):
    # 先挂载 assets 等静态资源
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets") if os.path.isdir(os.path.join(static_dir, "assets")) else static_dir), name="assets")

    # 所有非 /api 路由都返回 index.html（SPA 路由支持）
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # /api/* 路由若走到这里说明接口不存在，返回 JSON 404 而不是 HTML
        if full_path.startswith("api"):
            return JSONResponse(
                status_code=404,
                content={"detail": f"接口不存在: /{full_path}"}
            )
        index_file = os.path.join(static_dir, "index.html")
        requested = os.path.join(static_dir, full_path)
        if os.path.isfile(requested):
            return FileResponse(requested)
        return FileResponse(index_file)
else:
    @app.get("/")
    def root():
        return JSONResponse({
            "message": "后端运行正常 ✅，但前端文件未找到",
            "api_docs": "http://localhost:8000/docs",
            "fix": f"请确认 {static_dir} 目录中存在 index.html",
            "static_dir": static_dir,
        })


if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("  农户补贴管理系统启动中...")
    print(f"  静态文件目录: {static_dir}")
    print(f"  前端就绪: {'✅' if has_index(static_dir) else '❌ 请先 npm run build'}")
    print("  接口文档:  http://localhost:8000/docs")
    print("  前端页面:  http://localhost:8000")
    print("  按 Ctrl+C 停止")
    print("=" * 50)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)





def migrate_db():
    """兼容旧数据库：添加新字段（如不存在）"""
    from sqlalchemy import text
    from database import engine
    migrations = [
        "ALTER TABLE subsidy_type ADD COLUMN count_toward_area INTEGER NOT NULL DEFAULT 1",
        # Chapter 6 & 7 新表（用 CREATE TABLE IF NOT EXISTS 而不是 ALTER，避免冲突）
        """CREATE TABLE IF NOT EXISTS subsidy_eligibility_rule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subsidy_type_id INTEGER NOT NULL,
            rule_name TEXT NOT NULL,
            rule_desc TEXT,
            require_farmer_status INTEGER DEFAULT 1,
            require_age_min INTEGER,
            require_age_max INTEGER,
            require_land_type TEXT,
            require_min_area DECIMAL(10,2),
            require_max_area DECIMAL(10,2),
            require_not_idle INTEGER NOT NULL DEFAULT 0,
            require_contract_valid INTEGER NOT NULL DEFAULT 0,
            can_combine_with_others INTEGER NOT NULL DEFAULT 1,
            exclusive_with TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS excel_column_template (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_name TEXT NOT NULL,
            template_year INTEGER,
            region_name TEXT,
            business_type TEXT NOT NULL DEFAULT 'SUBSIDY',
            subsidy_type_id INTEGER,
            header_row INTEGER NOT NULL DEFAULT 1,
            data_start_row INTEGER NOT NULL DEFAULT 2,
            skip_footer_rows INTEGER NOT NULL DEFAULT 0,
            column_mapping TEXT NOT NULL DEFAULT '[]',
            skip_rules TEXT,
            value_mapping TEXT,
            use_count INTEGER NOT NULL DEFAULT 0,
            last_used_at DATETIME,
            created_by TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS excel_import_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER,
            template_name TEXT,
            file_name TEXT NOT NULL,
            file_hash TEXT,
            business_type TEXT NOT NULL,
            region_name TEXT,
            import_year INTEGER,
            total_rows INTEGER NOT NULL DEFAULT 0,
            valid_rows INTEGER NOT NULL DEFAULT 0,
            created_count INTEGER NOT NULL DEFAULT 0,
            updated_count INTEGER NOT NULL DEFAULT 0,
            skipped_count INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0,
            warning_count INTEGER NOT NULL DEFAULT 0,
            rule_failed_count INTEGER NOT NULL DEFAULT 0,
            error_detail TEXT,
            warning_detail TEXT,
            rule_fail_detail TEXT,
            column_mapping_used TEXT,
            operator TEXT,
            import_duration_ms INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
                print(f"  迁移完成：{sql[:60]}…")
            except Exception:
                pass  # 字段已存在则跳过

migrate_db()

def create_indexes():
    """创建性能索引，首次启动自动执行"""
    from sqlalchemy import text
    from database import engine
    indexes = [
        # 补贴申请表的高频查询字段
        "CREATE INDEX IF NOT EXISTS idx_sa_year         ON subsidy_application(apply_year)",
        "CREATE INDEX IF NOT EXISTS idx_sa_farmer       ON subsidy_application(farmer_id)",
        "CREATE INDEX IF NOT EXISTS idx_sa_type         ON subsidy_application(subsidy_type_id)",
        "CREATE INDEX IF NOT EXISTS idx_sa_year_farmer  ON subsidy_application(apply_year, farmer_id)",
        "CREATE INDEX IF NOT EXISTS idx_sa_year_type    ON subsidy_application(apply_year, subsidy_type_id)",
        # 农户表
        "CREATE INDEX IF NOT EXISTS idx_fp_household    ON farmer_profile(household_id)",
        "CREATE INDEX IF NOT EXISTS idx_fp_id_card      ON farmer_profile(id_card)",
        "CREATE INDEX IF NOT EXISTS idx_fp_status       ON farmer_profile(farmer_status)",
        "CREATE INDEX IF NOT EXISTS idx_fp_name         ON farmer_profile(real_name)",
        # 家庭户
        "CREATE INDEX IF NOT EXISTS idx_hh_vg           ON family_household(village_group_id)",
        # 补贴类型
        "CREATE INDEX IF NOT EXISTS idx_st_year         ON subsidy_type(subsidy_year)",
    ]
    with engine.connect() as conn:
        for sql in indexes:
            conn.execute(text(sql))
        conn.commit()
    print("  数据库索引已就绪 ✅")




create_indexes()
