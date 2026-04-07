import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from database import engine
from models import Base
from routers import farmers, subsidies, ai_analyze, settings, precheck, households, external_links, backup, eligibility, excel_templates, land, error_library, household_import

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
        "ALTER TABLE subsidy_application ADD COLUMN beneficiary_id INTEGER REFERENCES farmer_profile(id)",
        "ALTER TABLE subsidy_payment ADD COLUMN beneficiary_id INTEGER REFERENCES farmer_profile(id)",
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

        # 数据迁移：回填 beneficiary_id 字段
        try:
            # 1. 先处理 subsidy_application 表
            # 情况1：没有代领关系的记录（is_proxy = 0），beneficiary_id = farmer_id
            fill_beneficiary_app_normal = text("""
                UPDATE subsidy_application
                SET beneficiary_id = farmer_id
                WHERE is_proxy = 0 AND beneficiary_id IS NULL
            """)
            conn.execute(fill_beneficiary_app_normal)

            # 情况2：有代领关系的记录，通过 subsidy_proxy 表判断
            # 首先处理代领人记录（需要找到对应的受益人）
            fill_beneficiary_app_proxy = text("""
                UPDATE subsidy_application
                SET beneficiary_id = (
                    SELECT beneficiary_farmer_id
                    FROM subsidy_proxy
                    WHERE subsidy_proxy.application_id = subsidy_application.id
                )
                WHERE is_proxy > 0
                  AND beneficiary_id IS NULL
                  AND EXISTS (
                      SELECT 1 FROM subsidy_proxy
                      WHERE subsidy_proxy.application_id = subsidy_application.id
                  )
            """)
            conn.execute(fill_beneficiary_app_proxy)

            # 情况3：剩下的记录（可能是复制出来的受益人记录），beneficiary_id = farmer_id
            fill_beneficiary_app_remaining = text("""
                UPDATE subsidy_application
                SET beneficiary_id = farmer_id
                WHERE beneficiary_id IS NULL
            """)
            conn.execute(fill_beneficiary_app_remaining)

            # 2. 处理 subsidy_payment 表（类似逻辑）
            # 情况1：没有代领关系的记录
            fill_beneficiary_pay_normal = text("""
                UPDATE subsidy_payment
                SET beneficiary_id = farmer_id
                WHERE is_proxy = 0 AND beneficiary_id IS NULL
            """)
            conn.execute(fill_beneficiary_pay_normal)

            # 情况2：有代领关系的记录
            fill_beneficiary_pay_proxy = text("""
                UPDATE subsidy_payment
                SET beneficiary_id = (
                    SELECT beneficiary_farmer_id
                    FROM subsidy_proxy
                    WHERE subsidy_proxy.payment_id = subsidy_payment.id
                )
                WHERE is_proxy > 0
                  AND beneficiary_id IS NULL
                  AND EXISTS (
                      SELECT 1 FROM subsidy_proxy
                      WHERE subsidy_proxy.payment_id = subsidy_payment.id
                  )
            """)
            conn.execute(fill_beneficiary_pay_proxy)

            # 情况3：剩下的记录
            fill_beneficiary_pay_remaining = text("""
                UPDATE subsidy_payment
                SET beneficiary_id = farmer_id
                WHERE beneficiary_id IS NULL
            """)
            conn.execute(fill_beneficiary_pay_remaining)

            conn.commit()
            print("  beneficiary_id 数据回填完成 [OK]")
        except Exception as e:
            print(f"  beneficiary_id 数据回填跳过（可能已填充）: {e}")
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
        # beneficiary_id 索引（用于按受益人统计）
        "CREATE INDEX IF NOT EXISTS idx_sa_beneficiary  ON subsidy_application(beneficiary_id)",
        "CREATE INDEX IF NOT EXISTS idx_sp_beneficiary  ON subsidy_payment(beneficiary_id)",
        "CREATE INDEX IF NOT EXISTS idx_sa_year_beneficiary ON subsidy_application(apply_year, beneficiary_id)",
        "CREATE INDEX IF NOT EXISTS idx_sp_year_beneficiary ON subsidy_payment(payment_year, beneficiary_id)",
    ]
    with engine.connect() as conn:
        for sql in indexes:
            conn.execute(text(sql))
        conn.commit()
    print("  数据库索引已就绪 [OK]")


create_indexes()
