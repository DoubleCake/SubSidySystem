import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from database import engine
from models import Base
from routers import farmers, subsidies, ai_analyze, settings, households, external_links, backup, eligibility, excel_templates, land, error_library, household_import, agri_tasks, large_farmers, project_progress, auth, village_contacts, precheck_history
from core.exceptions import AppException, NotFound, BadRequest, Conflict, ValidationError, Forbidden
from core.response import error_response

Base.metadata.create_all(bind=engine)

# ── 迁移：为旧数据库补充新增字段 ──
from sqlalchemy import text as sa_text
with engine.connect() as conn:
    # 检查 check_config 列是否存在（SubsidyType 新增字段）
    from sqlalchemy import inspect
    inspector = inspect(engine)
    cols = {c['name'] for c in inspector.get_columns('subsidy_type')}
    if 'check_config' not in cols:
        conn.execute(sa_text("ALTER TABLE subsidy_type ADD COLUMN check_config TEXT"))
        conn.commit()

    # 检查 retained_land 列是否存在（VillageGroup 新增字段）
    vg_cols = {c['name'] for c in inspector.get_columns('village_group')}
    if 'retained_land' not in vg_cols:
        conn.execute(sa_text("ALTER TABLE village_group ADD COLUMN retained_land DECIMAL(10,2) DEFAULT 0.00"))
        conn.commit()
    if 'population' not in vg_cols:
        conn.execute(sa_text("ALTER TABLE village_group ADD COLUMN population INTEGER DEFAULT NULL"))
        conn.commit()

    # 检查 owner_type 列是否存在（LandTrust 新增字段：支持村/村组作为流出/流入方）
    lt_cols = {c['name'] for c in inspector.get_columns('land_trust')}
    if 'owner_type' not in lt_cols:
        conn.execute(sa_text("ALTER TABLE land_trust ADD COLUMN owner_type VARCHAR(20) NOT NULL DEFAULT 'household'"))
        conn.execute(sa_text("ALTER TABLE land_trust ADD COLUMN owner_entity_id INTEGER DEFAULT NULL"))
        conn.execute(sa_text("ALTER TABLE land_trust ADD COLUMN operator_type VARCHAR(20) NOT NULL DEFAULT 'household'"))
        conn.execute(sa_text("ALTER TABLE land_trust ADD COLUMN operator_entity_id INTEGER DEFAULT NULL"))
        conn.commit()

    # SQLite 不支持 ALTER COLUMN DROP NOT NULL，需要用重建表方式移除 owner_household_id 的 NOT NULL 约束
    ti = {r[1]: r for r in conn.execute(sa_text("PRAGMA table_info('land_trust')")).fetchall()}
    if ti.get('owner_household_id') and ti['owner_household_id'][3] == 1:  # notnull == 1
        conn.execute(sa_text("PRAGMA foreign_keys=OFF"))
        conn.execute(sa_text("""
            CREATE TABLE land_trust_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_type VARCHAR(20) NOT NULL DEFAULT 'household',
                owner_household_id INTEGER REFERENCES family_household(id),
                owner_entity_id INTEGER,
                operator_type VARCHAR(20) NOT NULL DEFAULT 'household',
                operator_household_id INTEGER REFERENCES family_household(id),
                operator_entity_id INTEGER,
                trust_type VARCHAR(20) NOT NULL DEFAULT 'ENTRUST',
                area DECIMAL(10,2),
                trust_year SMALLINT NOT NULL,
                start_date DATE,
                end_date DATE,
                annual_fee DECIMAL(10,2),
                payment_method VARCHAR(20),
                fee_note TEXT,
                parcel_desc VARCHAR(200),
                data_reliability VARCHAR(20) NOT NULL DEFAULT 'VILLAGE_CONFIRM',
                affect_subsidy_calc SMALLINT NOT NULL DEFAULT 1,
                subsidy_arable SMALLINT NOT NULL DEFAULT 1,
                subsidy_cash_crop SMALLINT NOT NULL DEFAULT 1,
                verified_by VARCHAR(50),
                verified_date DATE,
                note TEXT,
                operator VARCHAR(50),
                is_active SMALLINT NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(sa_text("""
            INSERT INTO land_trust_v2 (
                id, owner_type, owner_household_id, owner_entity_id,
                operator_type, operator_household_id, operator_entity_id,
                trust_type, area, trust_year, start_date, end_date,
                annual_fee, payment_method, fee_note, parcel_desc,
                data_reliability, affect_subsidy_calc, subsidy_arable, subsidy_cash_crop,
                verified_by, verified_date,
                note, operator, is_active, created_at, updated_at
            )
            SELECT id, COALESCE(owner_type,'household'), owner_household_id, owner_entity_id,
                   COALESCE(operator_type,'household'), operator_household_id, operator_entity_id,
                   trust_type, area, trust_year, start_date, end_date,
                   annual_fee, payment_method, fee_note, parcel_desc,
                   data_reliability, affect_subsidy_calc, 1, 1,
                   verified_by, verified_date,
                   note, operator, is_active, created_at, updated_at
            FROM land_trust
        """))
        conn.execute(sa_text("DROP TABLE land_trust"))
        conn.execute(sa_text("ALTER TABLE land_trust_v2 RENAME TO land_trust"))
        conn.commit()

    # 检查 subsidy_arable 列是否存在（LandTrust 新增字段：补贴享受类型）
    lt_cols2 = {c['name'] for c in inspector.get_columns('land_trust')}
    if 'subsidy_arable' not in lt_cols2:
        conn.execute(sa_text("ALTER TABLE land_trust ADD COLUMN subsidy_arable SMALLINT NOT NULL DEFAULT 1"))
        conn.execute(sa_text("ALTER TABLE land_trust ADD COLUMN subsidy_cash_crop SMALLINT NOT NULL DEFAULT 1"))
        conn.commit()

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

# ── 全局异常处理器 ──
# 业务异常：统一返回 JSON 格式，消除各路由中的重复 try/except
@app.exception_handler(AppException)
def app_exception_handler(request, exc: AppException):
    return error_response(exc.code, exc.message, exc.detail)


# HTTPException 保持原有行为但包装为统一格式
from fastapi.exceptions import HTTPException
from starlette.exceptions import HTTPException as StarletteHTTPException


@app.exception_handler(StarletteHTTPException)
def http_exception_handler(request, exc):
    return error_response(exc.status_code, exc.detail or "HTTP 错误")


@app.exception_handler(ValidationError)
def validation_exception_handler(request, exc: ValidationError):
    return error_response(422, exc.message, exc.detail)


@app.exception_handler(Exception)
def generic_exception_handler(request, exc: Exception):
    """兜底异常处理器，避免敏感信息泄漏"""
    return error_response(500, "服务器内部错误")


app.include_router(farmers.router)
app.include_router(subsidies.router)
app.include_router(ai_analyze.router)
app.include_router(settings.router)
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
app.include_router(project_progress.router)
app.include_router(auth.router)
app.include_router(village_contacts.router)
app.include_router(precheck_history.router)

# 启动时初始化管理员账号
from routers.auth import ensure_admin
with engine.connect() as conn:
    pass  # ensure tables exist
from database import SessionLocal
db = SessionLocal()
ensure_admin(db)
db.close()

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
        # 大户管理相关字段迁移
        "ALTER TABLE large_farmer ADD COLUMN farmer_grade VARCHAR(20)",
        "ALTER TABLE large_farmer ADD COLUMN credit_score SMALLINT",
        # large_farmer_trust 新增字段
        "ALTER TABLE large_farmer_trust ADD COLUMN parcel_village_id INTEGER REFERENCES village(id)",
        "ALTER TABLE large_farmer_trust ADD COLUMN parcel_group_no SMALLINT",
        "ALTER TABLE large_farmer_trust ADD COLUMN is_high_standard SMALLINT DEFAULT 0",
        "ALTER TABLE large_farmer_trust ADD COLUMN is_demonstration SMALLINT DEFAULT 0",
        "ALTER TABLE large_farmer_trust ADD COLUMN zone_name VARCHAR(100)",
        "ALTER TABLE large_farmer_trust ADD COLUMN reminder_sent SMALLINT DEFAULT 0",
        "ALTER TABLE large_farmer_trust ADD COLUMN reminder_days SMALLINT",
        "ALTER TABLE large_farmer_trust ADD COLUMN payment_status VARCHAR(20)",
        # 农户受限身份标记
        "ALTER TABLE farmer_profile ADD COLUMN restricted_identity SMALLINT DEFAULT 0",
        # 农户死亡日期和受限日期
        "ALTER TABLE farmer_profile ADD COLUMN death_date DATE",
        "ALTER TABLE farmer_profile ADD COLUMN restrict_date DATE",
        # 移除 subsidy_application 唯一约束（允许重复导入）
        "DROP INDEX IF EXISTS uq_farmer_subsidy_year",
        "DROP INDEX IF EXISTS uq_farmer_subsidy_year_paystatus",
        "CREATE INDEX IF NOT EXISTS ix_farmer_subsidy_year ON subsidy_application(farmer_id, subsidy_type_id, apply_year)",
        # 创建大户地块表
        """CREATE TABLE IF NOT EXISTS large_farmer_parcel (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            large_farmer_id INTEGER NOT NULL REFERENCES large_farmer(id),
            trust_id INTEGER REFERENCES large_farmer_trust(id),
            parcel_name VARCHAR(100),
            area DECIMAL(10,2) NOT NULL,
            village_id INTEGER NOT NULL REFERENCES village(id),
            group_no SMALLINT,
            parcel_location VARCHAR(200),
            boundary_east VARCHAR(100),
            boundary_west VARCHAR(100),
            boundary_south VARCHAR(100),
            boundary_north VARCHAR(100),
            is_high_standard SMALLINT DEFAULT 0,
            is_demonstration SMALLINT DEFAULT 0,
            zone_name VARCHAR(100),
            zone_type VARCHAR(50),
            soil_grade VARCHAR(20),
            soil_type VARCHAR(50),
            irrigation_level VARCHAR(20),
            map_coordinates TEXT,
            map_geojson TEXT,
            map_center_lng DECIMAL(12,8),
            map_center_lat DECIMAL(12,8),
            map_zoom SMALLINT,
            current_crop VARCHAR(50),
            planting_season VARCHAR(20),
            planting_year SMALLINT,
            is_active SMALLINT DEFAULT 1,
            remark TEXT,
            operator VARCHAR(50),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        # 创建合同到期提醒表
        """CREATE TABLE IF NOT EXISTS large_farmer_contract_reminder (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trust_id INTEGER NOT NULL REFERENCES large_farmer_trust(id),
            large_farmer_id INTEGER NOT NULL REFERENCES large_farmer(id),
            reminder_type VARCHAR(20) NOT NULL,
            reminder_date DATE NOT NULL,
            contract_end_date DATE NOT NULL,
            days_before SMALLINT,
            is_sent SMALLINT DEFAULT 0,
            sent_at DATETIME,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        # 006: 拆分 apply_area，新增不计入超限计算的补贴面积字段
        "ALTER TABLE subsidy_application ADD COLUMN apply_area_no_calc DECIMAL(10,2)",
        "ALTER TABLE subsidy_payment ADD COLUMN apply_area_no_calc DECIMAL(10,2)",
        # 大户管理新增字段
        "ALTER TABLE large_farmer ADD COLUMN responsible_person VARCHAR(100)",
        "ALTER TABLE large_farmer ADD COLUMN planting_location VARCHAR(200)",
        "ALTER TABLE large_farmer ADD COLUMN org_code VARCHAR(50)",
        # 补贴项目软删除
        "ALTER TABLE subsidy_type ADD COLUMN status SMALLINT NOT NULL DEFAULT 1",
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
            fill_beneficiary_app_normal = text("""
                UPDATE subsidy_application
                SET beneficiary_id = farmer_id
                WHERE is_proxy = 0 AND beneficiary_id IS NULL
            """)
            conn.execute(fill_beneficiary_app_normal)

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

            fill_beneficiary_app_remaining = text("""
                UPDATE subsidy_application
                SET beneficiary_id = farmer_id
                WHERE beneficiary_id IS NULL
            """)
            conn.execute(fill_beneficiary_app_remaining)

            fill_beneficiary_pay_normal = text("""
                UPDATE subsidy_payment
                SET beneficiary_id = farmer_id
                WHERE is_proxy = 0 AND beneficiary_id IS NULL
            """)
            conn.execute(fill_beneficiary_pay_normal)

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

        # 回填 village_group 表
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
