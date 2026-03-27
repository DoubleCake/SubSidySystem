import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from database import engine
from models import Base
from routers import farmers, subsidies, ai_analyze, settings, precheck, households, external_links, backup, eligibility, excel_templates, land, error_library

Base.metadata.create_all(bind=engine)

# ── 轻量迁移：为已有表添加新列 ──
import sqlalchemy as sa
def _migrate():
    with engine.connect() as conn:
        cols = {r[1] for r in conn.execute(sa.text("PRAGMA table_info(subsidy_application)"))}
        if "contract_area" not in cols:
            conn.execute(sa.text("ALTER TABLE subsidy_application ADD COLUMN contract_area DECIMAL(10,2)"))
        if "trust_area" not in cols:
            conn.execute(sa.text("ALTER TABLE subsidy_application ADD COLUMN trust_area DECIMAL(10,2)"))
        if "no_subsidy_area" not in cols:
            conn.execute(sa.text("ALTER TABLE subsidy_application ADD COLUMN no_subsidy_area DECIMAL(10,2)"))
        conn.commit()
_migrate()

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
app.include_router(land.router)
app.include_router(error_library.router)

@app.get("/api/health")
def health():
    return {"status": "ok", "message": "农户补贴管理系统运行中"}

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
    print(f"  前端就绪: {'[OK]' if has_index(static_dir) else '[ERROR] 请先 npm run build'}")
    print("  接口文档:  http://localhost:8000/docs")
    print("  前端页面:  http://localhost:8000")
    print("  按 Ctrl+C 停止")
    print("=" * 50)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)





def _cn_to_int(s: str) -> int:
    """中文组号字符串转整数"""
    m = {"一组": 1, "二组": 2, "三组": 3, "四组": 4, "五组": 5,
         "六组": 6, "七组": 7, "八组": 8, "九组": 9, "十组": 10,
         "1组": 1, "2组": 2, "3组": 3, "4组": 4, "5组": 5,
         "6组": 6, "7组": 7, "8组": 8, "9组": 9, "10组": 10}
    return m.get(str(s).strip(), 1)


def migrate_db():
    """兼容旧数据库：添加新字段（如不存在）"""
    from sqlalchemy import text
    from database import engine

    with engine.connect() as conn:
        hh_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(family_household)")).fetchall()}

        # 1. 新增 village_id（可空）
        if "village_id" not in hh_cols:
            conn.execute(text("ALTER TABLE family_household ADD COLUMN village_id INTEGER"))
            conn.commit()

        # 2. 新增 group_no（存整数）
        if "group_no" not in hh_cols:
            conn.execute(text("ALTER TABLE family_household ADD COLUMN group_no INTEGER NOT NULL DEFAULT 1"))
            conn.commit()

        # 3. 回填 village_id：从 village_group.village_name 找对应 village.id
        conn.execute(text("""
            UPDATE family_household
            SET village_id = (
                SELECT v.id FROM village v
                JOIN village_group vg ON v.village_name = vg.village_name
                WHERE vg.id = family_household.village_group_id
                LIMIT 1
            )
            WHERE village_group_id IS NOT NULL
              AND (village_id IS NULL OR village_id = 0)
        """))
        conn.commit()

        # 4. 回填 group_no：从 village_group.group_no 转整数
        rows = conn.execute(text("""
            SELECT hh.id, vg.group_no
            FROM family_household hh
            JOIN village_group vg ON vg.id = hh.village_group_id
            WHERE hh.village_group_id IS NOT NULL
        """)).fetchall()
        for row in rows:
            conn.execute(
                text("UPDATE family_household SET group_no=:gno WHERE id=:id"),
                {"gno": _cn_to_int(row[1]), "id": row[0]}
            )
        conn.commit()

        # 5. 兜底：未匹配到的 village_id 设为 1
        conn.execute(text("UPDATE family_household SET village_id=1 WHERE village_id IS NULL OR village_id=0"))
        conn.commit()

    migrations = [
        "ALTER TABLE subsidy_type ADD COLUMN count_toward_area INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE subsidy_type ADD COLUMN season TEXT NOT NULL DEFAULT '全年单补'",
        "ALTER TABLE subsidy_application ADD COLUMN no_subsidy_area DECIMAL(10,2)",
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
        """CREATE TABLE IF NOT EXISTS household_event (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            household_id INTEGER NOT NULL,
            related_hh_id INTEGER,
            event_type TEXT NOT NULL,
            event_year INTEGER NOT NULL,
            event_date DATE,
            date_accuracy TEXT NOT NULL DEFAULT 'YEAR',
            before_snapshot TEXT,
            after_snapshot TEXT,
            farmer_id INTEGER,
            farmer_name TEXT,
            description TEXT NOT NULL DEFAULT '',
            evidence_type TEXT,
            evidence_note TEXT,
            operator TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS land_trust (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_household_id INTEGER NOT NULL,
            operator_household_id INTEGER,
            trust_type TEXT NOT NULL DEFAULT 'ENTRUST',
            area DECIMAL(10,2),
            trust_year INTEGER NOT NULL,
            start_date DATE,
            end_date DATE,
            annual_fee DECIMAL(10,2),
            payment_method TEXT,
            fee_note TEXT,
            parcel_desc TEXT,
            data_reliability TEXT NOT NULL DEFAULT 'VILLAGE_CONFIRM',
            affect_subsidy_calc INTEGER NOT NULL DEFAULT 1,
            verified_by TEXT,
            verified_date DATE,
            note TEXT,
            operator TEXT,
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
        """CREATE TABLE IF NOT EXISTS error_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            real_name TEXT NOT NULL,
            id_card TEXT NOT NULL,
            error_type TEXT NOT NULL,
            error_reason TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT '手动录入',
            village_name TEXT,
            group_no TEXT,
            subsidy_name TEXT,
            discovered_date TEXT,
            subsidy_type_id INTEGER,
            remark TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        "ALTER TABLE error_library ADD COLUMN village_name TEXT",
        "ALTER TABLE error_library ADD COLUMN group_no TEXT",
        "ALTER TABLE error_library ADD COLUMN subsidy_name TEXT",
        # 迁移 precheck_error_library 数据到 error_library
        """INSERT OR IGNORE INTO error_library (real_name, id_card, error_type, error_reason, source, village_name, group_no)
           SELECT real_name, id_card, '其他', COALESCE(error_reason,''), '预检发现', village_name, group_no
           FROM precheck_error_library WHERE id_card NOT IN (SELECT id_card FROM error_library)""",
        "DROP TABLE IF EXISTS precheck_error_library",
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
        "CREATE INDEX IF NOT EXISTS idx_hh_village     ON family_household(village_id)",
        # 补贴类型
        "CREATE INDEX IF NOT EXISTS idx_st_year         ON subsidy_type(subsidy_year)",
    ]
    with engine.connect() as conn:
        for sql in indexes:
            conn.execute(text(sql))
        conn.commit()
    print("  数据库索引已就绪 [OK]")




create_indexes()
