import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from database import engine
from models import Base
from routers import farmers, subsidies, ai_analyze, settings, precheck, households, external_links, backup, eligibility, excel_templates, land, error_library, household_import, agri_tasks, large_farmers

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
    expose_headers=["Content-Disposition"],
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
app.include_router(household_import.router)
app.include_router(agri_tasks.router)
app.include_router(large_farmers.router)

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





def migrate_db():
    """数据库结构迁移，每次启动时自动执行（幂等）"""
    from sqlalchemy import text
    migrations = [
        "ALTER TABLE family_household ADD COLUMN confirmed_area DECIMAL(10,2)",
        "ALTER TABLE farmer_profile ADD COLUMN own_village_id INTEGER REFERENCES village(id)",
        "ALTER TABLE farmer_profile ADD COLUMN own_group_no INTEGER",
        "ALTER TABLE subsidy_application ADD COLUMN apply_village_id INTEGER REFERENCES village(id)",
        "ALTER TABLE subsidy_application ADD COLUMN apply_group_no INTEGER",
        "ALTER TABLE subsidy_application ADD COLUMN apply_village_name VARCHAR(50)",
        "ALTER TABLE subsidy_application ADD COLUMN apply_group_display VARCHAR(20)",
        "ALTER TABLE subsidy_payment ADD COLUMN payment_village_id INTEGER REFERENCES village(id)",
        "ALTER TABLE subsidy_payment ADD COLUMN payment_group_no INTEGER",
        "ALTER TABLE subsidy_payment ADD COLUMN payment_village_name VARCHAR(50)",
        "ALTER TABLE subsidy_payment ADD COLUMN payment_group_display VARCHAR(20)",
        "ALTER TABLE family_household ADD COLUMN is_manually_confirmed SMALLINT DEFAULT 0",
        "ALTER TABLE family_household ADD COLUMN manually_confirmed_at DATETIME",
        "ALTER TABLE family_household ADD COLUMN manually_confirmed_by VARCHAR(50)",
        "ALTER TABLE family_household ADD COLUMN registered_address TEXT",
        "ALTER TABLE subsidy_payment ADD COLUMN proxy_remark TEXT",
        "ALTER TABLE subsidy_payment ADD COLUMN pay_status SMALLINT DEFAULT 2",
        "ALTER TABLE subsidy_application ADD COLUMN is_proxy SMALLINT DEFAULT 0",
        "ALTER TABLE subsidy_payment ADD COLUMN is_proxy SMALLINT DEFAULT 0",
        "ALTER TABLE subsidy_proxy ADD COLUMN subsidy_type_id INTEGER REFERENCES subsidy_type(id)",
        # 农业任务分解相关表（新表由 Base.metadata.create_all 创建）
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
            except Exception:
                pass  # 列已存在时忽略
        conn.commit()

        # 历史数据回填：用当前农户状态填充村组快照
        try:
            # 1. 回填 subsidy_application
            fill_app = text("""
                UPDATE subsidy_application
                SET apply_village_id = COALESCE(
                    (SELECT own_village_id FROM farmer_profile WHERE farmer_profile.id = subsidy_application.farmer_id),
                    (SELECT village_id FROM family_household
                     WHERE family_household.id = (SELECT household_id FROM farmer_profile WHERE farmer_profile.id = subsidy_application.farmer_id))
                ),
                apply_group_no = COALESCE(
                    (SELECT own_group_no FROM farmer_profile WHERE farmer_profile.id = subsidy_application.farmer_id),
                    (SELECT group_no FROM family_household
                     WHERE family_household.id = (SELECT household_id FROM farmer_profile WHERE farmer_profile.id = subsidy_application.farmer_id))
                )
                WHERE apply_village_id IS NULL OR apply_group_no IS NULL
            """)
            conn.execute(fill_app)

            # 2. 更新村名和组显示名
            update_names = text("""
                UPDATE subsidy_application
                SET apply_village_name = (SELECT village_name FROM village WHERE village.id = subsidy_application.apply_village_id),
                    apply_group_display = CASE subsidy_application.apply_group_no
                        WHEN 1 THEN '一组' WHEN 2 THEN '二组' WHEN 3 THEN '三组' WHEN 4 THEN '四组'
                        WHEN 5 THEN '五组' WHEN 6 THEN '六组' WHEN 7 THEN '七组' WHEN 8 THEN '八组'
                        WHEN 9 THEN '九组' WHEN 10 THEN '十组' ELSE '未知组' END
                WHERE apply_village_id IS NOT NULL AND (apply_village_name IS NULL OR apply_group_display IS NULL)
            """)
            conn.execute(update_names)

            # 3. 回填 subsidy_payment（类似逻辑）
            fill_pay = text("""
                UPDATE subsidy_payment
                SET payment_village_id = COALESCE(
                    (SELECT own_village_id FROM farmer_profile WHERE farmer_profile.id = subsidy_payment.farmer_id),
                    (SELECT village_id FROM family_household
                     WHERE family_household.id = (SELECT household_id FROM farmer_profile WHERE farmer_profile.id = subsidy_payment.farmer_id))
                ),
                payment_group_no = COALESCE(
                    (SELECT own_group_no FROM farmer_profile WHERE farmer_profile.id = subsidy_payment.farmer_id),
                    (SELECT group_no FROM family_household
                     WHERE family_household.id = (SELECT household_id FROM farmer_profile WHERE farmer_profile.id = subsidy_payment.farmer_id))
                )
                WHERE payment_village_id IS NULL OR payment_group_no IS NULL
            """)
            conn.execute(fill_pay)

            update_pay_names = text("""
                UPDATE subsidy_payment
                SET payment_village_name = (SELECT village_name FROM village WHERE village.id = subsidy_payment.payment_village_id),
                    payment_group_display = CASE subsidy_payment.payment_group_no
                        WHEN 1 THEN '一组' WHEN 2 THEN '二组' WHEN 3 THEN '三组' WHEN 4 THEN '四组'
                        WHEN 5 THEN '五组' WHEN 6 THEN '六组' WHEN 7 THEN '七组' WHEN 8 THEN '八组'
                        WHEN 9 THEN '九组' WHEN 10 THEN '十组' ELSE '未知组' END
                WHERE payment_village_id IS NOT NULL AND (payment_village_name IS NULL OR payment_group_display IS NULL)
            """)
            conn.execute(update_pay_names)

            conn.commit()
            print("  历史数据回填完成 [OK]")
        except Exception as e:
            print(f"  历史数据回填跳过（可能已填充）: {e}")
            conn.rollback()

    # 回填 village_group 表：从 family_household + subsidy_payment 提取各村现有组
    try:
        conn.execute(text("""
            INSERT OR IGNORE INTO village_group (village_id, group_no)
            SELECT DISTINCT village_id, format_group_no(group_no)
            FROM family_household
            WHERE village_id IS NOT NULL AND group_no IS NOT NULL
        """))
        conn.execute(text("""
            INSERT OR IGNORE INTO village_group (village_id, group_no)
            SELECT DISTINCT payment_village_id, format_group_no(payment_group_no)
            FROM subsidy_payment
            WHERE payment_village_id IS NOT NULL AND payment_group_no IS NOT NULL
        """))
        conn.commit()
        print("  village_group 回填完成 [OK]")
    except Exception as e:
        print(f"  village_group 回填跳过: {e}")
        conn.rollback()

    print("  数据库迁移完成 [OK]")


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
        "CREATE INDEX IF NOT EXISTS idx_sa_year_status  ON subsidy_application(apply_year, pay_status)",
        # 农户表
        "CREATE INDEX IF NOT EXISTS idx_fp_household    ON farmer_profile(household_id)",
        "CREATE INDEX IF NOT EXISTS idx_fp_id_card      ON farmer_profile(id_card)",
        "CREATE INDEX IF NOT EXISTS idx_fp_status       ON farmer_profile(farmer_status)",
        "CREATE INDEX IF NOT EXISTS idx_fp_name         ON farmer_profile(real_name)",
        # 家庭户
        "CREATE INDEX IF NOT EXISTS idx_hh_village      ON family_household(village_id)",
        "CREATE INDEX IF NOT EXISTS idx_hh_status_village ON family_household(status, village_id)",
        "CREATE INDEX IF NOT EXISTS idx_hh_confirmed    ON family_household(is_manually_confirmed)",
        # 补贴发放表
        "CREATE INDEX IF NOT EXISTS idx_sp_year          ON subsidy_payment(payment_year)",
        # 补贴类型
        "CREATE INDEX IF NOT EXISTS idx_st_year         ON subsidy_type(subsidy_year)",
    ]
    with engine.connect() as conn:
        for sql in indexes:
            conn.execute(text(sql))
        conn.commit()
    print("  数据库索引已就绪 [OK]")


create_indexes()
