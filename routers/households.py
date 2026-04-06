"""
家庭户管理路由
功能：
  1. 家庭户列表（含承包土地面积、已补贴面积、剩余面积、超领预警）
  2. 家庭户详情（成员列表、补贴明细、面积占用情况）
  3. 更新家庭户信息（土地面积、成员关系等）
  4. 成员调整（将农户从一个家庭户移入另一个）
  5. 超领预警列表（已补贴面积 > 承包面积）
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from pydantic import BaseModel
from typing import Optional
from decimal import Decimal

from database import get_db
from models import FamilyHousehold, FarmerProfile, Village, SubsidyApplication, SubsidyType, SubsidyPayment, HouseholdAreaUsageCache
from schemas import HouseholdManualConfirm, HouseholdBatchConfirm
from utils import format_group_no, parse_group_no_to_int, parse_id_card, mask_id_card, mask_phone, mask_bank_card, gen_household_code
# 导入预检查函数
from .precheck import validate_id_card, check_name, check_phone

router = APIRouter(prefix="/api/households", tags=["家庭户管理"])


# ─────────────────────────────────────
#  辅助函数：查找或创建 Village
# ─────────────────────────────────────

def _get_or_create_village(db: Session, village_name: str) -> Village:
    """查找或创建 Village 记录"""
    village = db.query(Village).filter(Village.village_name == village_name).first()
    if not village:
        village = Village(village_name=village_name)
        db.add(village)
        db.flush()
    return village


# ─────────────────────────────────────
#  村组下拉选项（替代已废弃的 VillageGroup 表）
# ─────────────────────────────────────

@router.get("/group-options")
def list_group_options(db: Session = Depends(get_db)):
    """返回所有村+组的唯一组合，用于下拉选项"""
    rows = db.execute(text("""
        SELECT DISTINCT
            COALESCE(v.id, 0) AS village_id,
            COALESCE(v.village_name, '未知村') AS village_name,
            hh.group_no
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE hh.status = 1
        ORDER BY v.village_name, hh.group_no
    """)).fetchall()
    return [
        {
            "village_id": r.village_id,
            "village_name": r.village_name,
            "group_no": r.group_no,
            "full_name": f"{r.village_name}{format_group_no(r.group_no)}",
        }
        for r in rows
    ]


# ─────────────────────────────────────
#  请求数据结构
# ─────────────────────────────────────

class HouseholdUpdate(BaseModel):
    """更新家庭户基础信息"""
    household_name: Optional[str] = None
    contract_area: Optional[float] = None   # 承包面积（亩）
    confirmed_area: Optional[float] = None  # 确权面积（亩）
    village_id: Optional[int] = None       # 所属村（整户迁移时修改）
    group_no: Optional[int] = None         # 所属组（存整数，1=一组）
    address: Optional[str] = None
    status: Optional[int] = None
    remark: Optional[str] = None


class MemberMoveRequest(BaseModel):
    """成员调整：将 farmer_id 移入 target_household_id"""
    farmer_id: int
    target_household_id: int
    relation: Optional[str] = "成员"      # 与新户主的关系
    is_head: Optional[int] = 0            # 是否成为新户的户主


# ─────────────────────────────────────
#  核心辅助：获取指定年份的承包面积
# ─────────────────────────────────────

def get_contract_area_at_year(household_id: int, db: Session, year: int) -> float:
    """
    获取指定年份的承包面积。
    逻辑：
    - 如果在该年份有 LAND_CHANGE 事件，使用该事件之前的面积值（变更在事件发生后才生效）
    - 如果没有，找到该年份之前的最新变更，使用其之后的值
    例如：2024年12月变更 → 2024用旧值，2025用新值
    """
    import json as _json
    from models import HouseholdEvent

    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        return 0.0

    # 查找在该年份发生的 LAND_CHANGE（使用变更前的值）
    same_year_event = (
        db.query(HouseholdEvent)
          .filter(
              HouseholdEvent.household_id == household_id,
              HouseholdEvent.event_type == "LAND_CHANGE",
              HouseholdEvent.event_year == year,
          )
          .order_by(HouseholdEvent.created_at.desc())
          .first()
    )

    if same_year_event:
        # 该年份有变更，使用变更前的值
        try:
            before = _json.loads(same_year_event.before_snapshot) if same_year_event.before_snapshot else {}
            if "contract_area" in before:
                return float(before["contract_area"])
            if "land_area" in before:
                return float(before["land_area"])
        except:
            pass

    # 查找该年份之前的最新 LAND_CHANGE 事件（使用变更后的值）
    before_year_event = (
        db.query(HouseholdEvent)
          .filter(
              HouseholdEvent.household_id == household_id,
              HouseholdEvent.event_type == "LAND_CHANGE",
              HouseholdEvent.event_year < year,
          )
          .order_by(HouseholdEvent.event_year.desc(), HouseholdEvent.created_at.desc())
          .first()
    )

    if before_year_event:
        try:
            after = _json.loads(before_year_event.after_snapshot) if before_year_event.after_snapshot else {}
            if "contract_area" in after:
                return float(after["contract_area"])
            if "land_area" in after:
                return float(after["land_area"])
        except:
            pass

    return float(hh.contract_area or 0)


# ─────────────────────────────────────
#  核心辅助：重新计算并更新家庭户面积缓存
# ─────────────────────────────────────

def recalc_household_area_cache(household_id: int, db: Session) -> None:
    """
    重新计算指定家庭户的面积占用缓存。
    规则：
    1. 申报数据：pay_status in [0,1,2]（待审核、审核通过、已发放）的 apply_area
    2. 发放数据：直接从 subsidy_payment 表取 apply_area
    3. 最终使用面积 = 发放面积 if 发放面积 > 0 else 申报面积
    """
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        return

    # 获取所有成员ID
    member_ids = [m.id for m in db.query(FarmerProfile.id)
                  .filter(FarmerProfile.household_id == household_id).all()]
    if not member_ids:
        # 清除旧缓存
        db.query(HouseholdAreaUsageCache).filter(
            HouseholdAreaUsageCache.household_id == household_id
        ).delete()
        db.commit()
        return

    SEASON_ORDER = ["大春", "小春", "全年单补", "临时"]

    # 1. 从申报表计算各年/季节的申报面积
    app_query = (
        db.query(
            SubsidyType.season,
            SubsidyApplication.apply_year,
            func.sum(SubsidyApplication.apply_area).label("total_area"),
        )
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(
            SubsidyApplication.farmer_id.in_(member_ids),
            SubsidyType.calc_mode == "per_mu",
            SubsidyType.count_toward_area == 1,
            SubsidyApplication.apply_area.isnot(None),
            SubsidyApplication.pay_status.in_([0, 1, 2]),
            SubsidyApplication.is_proxy == 0,
        )
        .group_by(SubsidyType.season, SubsidyApplication.apply_year)
        .all()
    )
    app_data: dict[tuple, float] = {}
    all_years = set()
    for r in app_query:
        season = r.season or "全年单补"
        year = r.apply_year
        all_years.add(year)
        app_data[(year, season)] = float(r.total_area or 0)

    # 2. 从发放表计算各年/季节的发放面积
    pay_query = (
        db.query(
            SubsidyType.season,
            SubsidyPayment.payment_year,
            func.sum(SubsidyPayment.apply_area).label("total_area"),
        )
        .join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
        .filter(
            SubsidyPayment.farmer_id.in_(member_ids),
            SubsidyType.calc_mode == "per_mu",
            SubsidyType.count_toward_area == 1,
            SubsidyPayment.apply_area.isnot(None),
            SubsidyPayment.is_proxy == 0,
        )
        .group_by(SubsidyType.season, SubsidyPayment.payment_year)
        .all()
    )
    pay_data: dict[tuple, float] = {}
    for r in pay_query:
        season = r.season or "全年单补"
        year = r.payment_year
        all_years.add(year)
        pay_data[(year, season)] = float(r.total_area or 0)

    # 3. 更新缓存表
    for year in all_years:
        for season in SEASON_ORDER:
            apply_area = app_data.get((year, season), 0.0)
            payment_area = pay_data.get((year, season), 0.0)
            # 最终使用面积：优先用发放面积，没有则用申报面积
            used_area = payment_area if payment_area > 0 else apply_area

            existing = db.query(HouseholdAreaUsageCache).filter(
                HouseholdAreaUsageCache.household_id == household_id,
                HouseholdAreaUsageCache.year == year,
                HouseholdAreaUsageCache.season == season,
            ).first()

            if existing:
                existing.apply_area = Decimal(str(apply_area))
                existing.payment_area = Decimal(str(payment_area))
                existing.used_area = Decimal(str(used_area))
            else:
                new_cache = HouseholdAreaUsageCache(
                    household_id=household_id,
                    year=year,
                    season=season,
                    apply_area=Decimal(str(apply_area)),
                    payment_area=Decimal(str(payment_area)),
                    used_area=Decimal(str(used_area)),
                )
                db.add(new_cache)

    db.commit()


def recalc_all_household_caches(db: Session) -> int:
    """重新计算所有家庭户的面积缓存（批量更新版本），返回处理的数量"""
    from decimal import Decimal

    SEASON_ORDER = ["大春", "小春", "全年单补", "临时"]

    # 1. 一次性获取所有家庭户的成员映射：household_id -> [member_id]
    member_query = db.query(
        FarmerProfile.household_id,
        FarmerProfile.id
    ).filter(FarmerProfile.household_id.isnot(None)).all()

    household_members: dict[int, list[int]] = {}
    for hid, mid in member_query:
        if hid not in household_members:
            household_members[hid] = []
        household_members[hid].append(mid)

    all_household_ids = list(household_members.keys())

    if not all_household_ids:
        # 没有成员的家庭户，清空缓存
        db.query(HouseholdAreaUsageCache).delete()
        db.commit()
        return 0

    # 2. 一次性构建所有成员ID列表（用于后续查询）
    all_member_ids = [mid for mids in household_members.values() for mid in mids]

    # 3. 一次性获取所有申报数据（按 household_id + year + season 聚合）
    app_data: dict[tuple[int, int, str], float] = {}
    app_query = (
        db.query(
            FarmerProfile.household_id,
            SubsidyApplication.apply_year,
            SubsidyType.season,
            func.sum(SubsidyApplication.apply_area).label("total_area"),
        )
        .join(FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id)
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(
            SubsidyApplication.farmer_id.in_(all_member_ids),
            SubsidyType.calc_mode == "per_mu",
            SubsidyType.count_toward_area == 1,
            SubsidyApplication.apply_area.isnot(None),
            SubsidyApplication.pay_status.in_([0, 1, 2]),
            SubsidyApplication.is_proxy == 0,
        )
        .group_by(FarmerProfile.household_id, SubsidyApplication.apply_year, SubsidyType.season)
        .all()
    )
    for hid, year, season, area in app_query:
        s = season or "全年单补"
        app_data[(hid, year, s)] = float(area or 0)

    # 4. 一次性获取所有发放数据（按 household_id + year + season 聚合）
    pay_data: dict[tuple[int, int, str], float] = {}
    pay_query = (
        db.query(
            FarmerProfile.household_id,
            SubsidyPayment.payment_year,
            SubsidyType.season,
            func.sum(SubsidyPayment.apply_area).label("total_area"),
        )
        .join(FarmerProfile, FarmerProfile.id == SubsidyPayment.farmer_id)
        .join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
        .filter(
            SubsidyPayment.farmer_id.in_(all_member_ids),
            SubsidyType.calc_mode == "per_mu",
            SubsidyType.count_toward_area == 1,
            SubsidyPayment.apply_area.isnot(None),
            SubsidyPayment.is_proxy == 0,
        )
        .group_by(FarmerProfile.household_id, SubsidyPayment.payment_year, SubsidyType.season)
        .all()
    )
    for hid, year, season, area in pay_query:
        s = season or "全年单补"
        pay_data[(hid, year, s)] = float(area or 0)

    # 5. 收集所有需要的 (hid, year, season) 组合
    all_combinations = set(app_data.keys()).union(set(pay_data.keys()))

    # 6. 一次性查询现有缓存记录
    existing_cache_map: dict[tuple[int, int, str], HouseholdAreaUsageCache] = {}
    existing_caches = db.query(HouseholdAreaUsageCache).all()
    for cache in existing_caches:
        existing_cache_map[(cache.household_id, cache.year, cache.season)] = cache

    # 7. 批量更新/插入缓存
    to_update = []
    to_insert = []

    for hid, year, season in all_combinations:
        apply_area = app_data.get((hid, year, season), 0.0)
        payment_area = pay_data.get((hid, year, season), 0.0)
        used_area = payment_area if payment_area > 0 else apply_area

        key = (hid, year, season)
        if key in existing_cache_map:
            # 更新现有记录
            cache = existing_cache_map[key]
            cache.apply_area = Decimal(str(apply_area))
            cache.payment_area = Decimal(str(payment_area))
            cache.used_area = Decimal(str(used_area))
            to_update.append(cache)
        else:
            # 插入新记录
            new_cache = HouseholdAreaUsageCache(
                household_id=hid,
                year=year,
                season=season,
                apply_area=Decimal(str(apply_area)),
                payment_area=Decimal(str(payment_area)),
                used_area=Decimal(str(used_area)),
            )
            to_insert.append(new_cache)

    # 8. 删除不再需要的缓存记录（有成员但没有数据的组合）
    used_keys = set(all_combinations)
    to_delete = [cache for cache in existing_caches if (cache.household_id, cache.year, cache.season) not in used_keys and cache.household_id in household_members]

    # 9. 执行批量操作
    if to_delete:
        for cache in to_delete:
            db.delete(cache)

    if to_insert:
        db.add_all(to_insert)

    db.commit()

    return len(all_household_ids)


# ─────────────────────────────────────
#  核心辅助：计算家庭户面积占用情况（从缓存读取）


def calc_household_area_usage(
    household_id: int,
    db: Session,
    year: Optional[int] = None
) -> dict:
    """
    计算一个家庭户的面积使用情况（含流转）：
    - contracted_area:  承包面积（指定年份的实际面积，考虑历史变更）
    - trust_out_area:   流出面积（该年度流给他人耕种的）
    - trust_in_area:    流入面积（该年度从他人流入的代耕/流转）
    - cultivable_area:  实际可耕种面积 = 承包 - 流出 + 流入
    - season_breakdown: 按季节分组的面积占用明细（从缓存读取）
    """
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        return {}

    # 使用指定年份的承包面积（考虑历史变更）
    contracted = get_contract_area_at_year(household_id, db, year) if year else float(hh.contract_area or 0)

    # ── 流转面积（按年度）──
    trust_out = 0.0
    trust_in  = 0.0
    if year:
        out_r = db.execute(text("""
            SELECT COALESCE(SUM(area),0) FROM land_trust
            WHERE owner_household_id=:hid AND trust_year=:yr AND is_active=1
              AND affect_subsidy_calc=1 AND trust_type!='IDLE'
              AND operator_household_id IS NOT NULL
        """), {"hid": household_id, "yr": year}).scalar()
        trust_out = float(out_r or 0)

        in_r = db.execute(text("""
            SELECT COALESCE(SUM(area),0) FROM land_trust
            WHERE operator_household_id=:hid AND trust_year=:yr AND is_active=1
              AND affect_subsidy_calc=1
        """), {"hid": household_id, "yr": year}).scalar()
        trust_in = float(in_r or 0)

    cultivable = max(0.0, contracted - trust_out)

    # ── 从缓存读取所有年度数据（不按年过滤，前端用 year_totals 自行筛选）──
    SEASON_ORDER = ["大春", "小春", "全年单补", "临时"]

    cache_records = db.query(HouseholdAreaUsageCache).filter(
        HouseholdAreaUsageCache.household_id == household_id
    ).all()

    # 按年度+季节聚合，分别保存申报面积（预申请）和发放面积（已发布）
    year_totals: dict[int, dict[str, float]] = {}
    year_apply_totals: dict[int, dict[str, float]] = {}  # 预申请面积
    year_payment_totals: dict[int, dict[str, float]] = {}  # 已发布面积

    for rec in cache_records:
        y = rec.year
        if y not in year_totals:
            year_totals[y] = {s: 0.0 for s in SEASON_ORDER}
            year_apply_totals[y] = {s: 0.0 for s in SEASON_ORDER}
            year_payment_totals[y] = {s: 0.0 for s in SEASON_ORDER}
        year_totals[y][rec.season] = year_totals[y].get(rec.season, 0.0) + float(rec.used_area)
        year_apply_totals[y][rec.season] = year_apply_totals[y].get(rec.season, 0.0) + float(rec.apply_area)
        year_payment_totals[y][rec.season] = year_payment_totals[y].get(rec.season, 0.0) + float(rec.payment_area)

    # 确定展示年度：优先用请求指定年，否则取最新年
    if year and year in year_totals:
        display_year = year
    elif year_totals:
        display_year = max(year_totals.keys())
    else:
        display_year = None

    # season_breakdown 只展示 display_year 的数据（避免跨年叠加）
    season_breakdown: dict[str, dict] = {}
    total_used = round(sum(year_totals.get(display_year, {}).values()), 2) if display_year else 0.0
    remaining = cultivable - total_used
    is_overdrawn_all = cultivable > 0 and total_used > cultivable

    for season in SEASON_ORDER:
        used = round(year_totals.get(display_year, {}).get(season, 0.0) if display_year else 0.0, 2)
        apply_area = round(year_apply_totals.get(display_year, {}).get(season, 0.0) if display_year else 0.0, 2)
        payment_area = round(year_payment_totals.get(display_year, {}).get(season, 0.0) if display_year else 0.0, 2)
        # 季节级别也判断超领
        is_season_overdrawn = cultivable > 0 and used > cultivable
        season_overdraw_amount = round(max(0, used - cultivable), 2) if is_season_overdrawn else 0.0
        season_breakdown[season] = {
            "used_area": used,
            "apply_area": apply_area,  # 预申请面积
            "payment_area": payment_area,  # 已发布面积
            "remaining_area": max(0.0, cultivable - used),
            "is_overdrawn": is_season_overdrawn,
            "overdraw_amount": season_overdraw_amount,
            "subsidies": [],
        }

    return {
        "contracted_area": contracted,
        "trust_out_area": trust_out,
        "trust_in_area": trust_in,
        "cultivable_area": round(cultivable, 2),
        "used_area": total_used,
        "remaining_area": round(remaining, 2),
        "is_overdrawn": is_overdrawn_all,
        "overdraw_amount": round(max(0, total_used - contracted), 2),
        "season_breakdown": season_breakdown,
        "year_totals": {
            str(y): {s: round(v, 2) for s, v in seasons.items()}
            for y, seasons in sorted(year_totals.items(), reverse=True)
        },
    }


# ─────────────────────────────────────
#  接口：创建家庭户
# ─────────────────────────────────────

from schemas import HouseholdCreate as HouseholdCreateSchema

@router.post("")
def create_household(data: HouseholdCreateSchema, db: Session = Depends(get_db)):
    """创建新家庭户（无成员，稍后通过添加成员接口关联）"""
    from utils import gen_household_code, parse_group_no_to_int, format_group_no
    from models import HouseholdEvent
    from datetime import datetime

    # 确保 village 存在（如果传的是 village_name 而非 village_id）
    village_id = data.village_id
    if not village_id:
        raise HTTPException(status_code=400, detail="缺少 village_id")

    # group_no 存整数：传入 "1" / "一组" 均可，转换为整数存储
    group_no = parse_group_no_to_int(data.group_no) if data.group_no else 1
    if not group_no:
        raise HTTPException(status_code=400, detail="缺少 group_no")

    # 生成 household_code：取当前最大 id + 1
    max_id = db.query(func.max(FamilyHousehold.id)).scalar() or 0
    code = gen_household_code(max_id + 1)

    hh = FamilyHousehold(
        household_code=code,
        household_name=data.household_name,
        village_id=village_id,
        group_no=group_no,
        address=data.address,
        contract_area=data.contract_area,
        status=1,
        remark=data.remark,
    )
    db.add(hh)
    db.flush()

    # 记录 FOUND 事件
    now = datetime.now()
    _log_event(
        db, household_id=hh.id,
        event_type="FOUND", event_year=now.year,
        description=f"新建家庭户：{data.household_name}",
        after=_snapshot_household(db, hh.id),
        event_date=now.strftime("%Y-%m-%d"),
        date_accuracy="DAY",
    )
    db.commit()
    return {"id": hh.id}


# ─────────────────────────────────────
#  接口：家庭户列表
# ─────────────────────────────────────

@router.get("")
def list_households(
    village_name:  Optional[str] = Query(None),
    status:        Optional[int] = Query(1, description="家庭户状态：1在册 2注销 3迁出，默认仅显示在册"),
    overdrawn_only: bool         = Query(False, description="只显示超领家庭"),
    confirmed_only: Optional[int] = Query(None, description="只显示已确认/未确认的家庭户，1=已确认，0=未确认"),
    search:        Optional[str] = Query(None, description="搜索户名/户主姓名"),
    year:          Optional[int] = Query(None, description="指定年度计算面积占用"),
    min_app_count: Optional[int] = Query(None, description="最少补贴记录数"),
    page:          int           = Query(1, ge=1),
    page_size:     int           = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    家庭户列表，含面积预警信息
    """
    query = (
        db.query(FamilyHousehold)
          .outerjoin(Village, Village.id == FamilyHousehold.village_id)
    )

    if village_name:
        query = query.filter(Village.village_name == village_name)
    if status is not None:
        query = query.filter(FamilyHousehold.status == status)
    if confirmed_only is not None:
        query = query.filter(FamilyHousehold.is_manually_confirmed == confirmed_only)
    if search:
        search = search.strip()
        # 支持按户名搜索，或按任意家庭成员姓名/身份证号搜索
        from sqlalchemy import exists
        query = query.filter(
            (FamilyHousehold.household_name.like(f"%{search}%")) |
            exists().where(
                (FarmerProfile.household_id == FamilyHousehold.id) &
                (
                    (FarmerProfile.real_name.like(f"%{search}%")) |
                    (FarmerProfile.id_card.like(f"%{search}%"))
                )
            )
        )

    # min_app_count: 按家庭户补贴记录总数筛选
    if min_app_count is not None:
        from sqlalchemy import func as sql_func
        hh_app_count_subq = db.query(
            FamilyHousehold.id.label("household_id"),
            sql_func.count(SubsidyApplication.id).label("app_count")
        ).join(
            FarmerProfile, FarmerProfile.household_id == FamilyHousehold.id
        ).join(
            SubsidyApplication, SubsidyApplication.farmer_id == FarmerProfile.id
        ).group_by(FamilyHousehold.id).subquery()

        valid_hh_ids = db.query(hh_app_count_subq.c.household_id).filter(
            hh_app_count_subq.c.app_count >= min_app_count
        ).all()
        valid_hh_ids = [hid for (hid,) in valid_hh_ids]

        if valid_hh_ids:
            query = query.filter(FamilyHousehold.id.in_(valid_hh_ids))
        else:
            return {"total": 0, "page": page, "page_size": page_size, "items": []}

    # overdrawn_only: 利用缓存表预筛选超领户，避免全表扫描
    if overdrawn_only:
        # 先从缓存表找出该年度使用面积 > 承包面积的家庭户
        if not year:
            year = db.query(func.max(SubsidyApplication.apply_year)).scalar() or 2024

        # 1. 汇总缓存表中该年度每户的总使用面积
        cache_summary = db.query(
            HouseholdAreaUsageCache.household_id,
            func.sum(HouseholdAreaUsageCache.used_area).label("total_used")
        ).filter(
            HouseholdAreaUsageCache.year == year
        ).group_by(HouseholdAreaUsageCache.household_id).subquery()

        # 2. 找出总使用面积 > 承包面积的家庭户
        overdrawn_hh_ids = db.query(FamilyHousehold.id).join(
            cache_summary, cache_summary.c.household_id == FamilyHousehold.id
        ).filter(
            FamilyHousehold.contract_area.isnot(None),
            FamilyHousehold.contract_area > 0,
            cache_summary.c.total_used > FamilyHousehold.contract_area
        ).all()
        overdrawn_hh_ids = [hid for (hid,) in overdrawn_hh_ids]

        # 3. 用筛选后的 ID 过滤主查询
        if overdrawn_hh_ids:
            query = query.filter(FamilyHousehold.id.in_(overdrawn_hh_ids))
            total = query.count()
            all_households = query.order_by(FamilyHousehold.id).offset((page - 1) * page_size).limit(page_size).all()
        else:
            total = 0
            all_households = []
    else:
        total = query.count()
        all_households = query.order_by(FamilyHousehold.id).offset((page - 1) * page_size).limit(page_size).all()

    # 预加载所有关联数据（一次性 SQL 查询，避免 N+1）
    household_ids = [hh.id for hh in all_households]

    # 1. 预加载所有户主信息
    head_ids = [hh.head_farmer_id for hh in all_households if hh.head_farmer_id]
    if head_ids:
        heads = db.query(FarmerProfile).filter(FarmerProfile.id.in_(head_ids)).all()
        head_map = {f.id: f for f in heads}
    else:
        head_map = {}

    # 2. 预加载所有家庭户的成员数量（一次性聚合查询）
    member_counts = db.query(
        FarmerProfile.household_id,
        func.count(FarmerProfile.id).label("count")
    ).filter(FarmerProfile.household_id.in_(household_ids)).group_by(FarmerProfile.household_id).all()
    member_count_map = {hid: cnt for hid, cnt in [(mc.household_id, mc.count) for mc in member_counts]}

    # 3. 批量预加载面积信息
    items = []
    for hh in all_households:
        # 从预加载的数据获取信息（不触发新查询）
        head = head_map.get(hh.head_farmer_id) if hh.head_farmer_id else None
        member_count = member_count_map.get(hh.id, 0)

        area_info = calc_household_area_usage(hh.id, db, year)

        row = {
            "id": hh.id,
            "household_code": hh.household_code,
            "household_name": hh.household_name,
            "village_full_name": f"{hh.village.village_name}{format_group_no(hh.group_no)}" if hh.village else "",
            "village_name": hh.village.village_name if hh.village else "",
            "group_no": hh.group_no or 1,
            "head_name": head.real_name if head else "（无户主）",
            "member_count": member_count,
            "status": hh.status,
            "address": hh.address,
            "remark": hh.remark,
            # 人工确认字段
            "is_manually_confirmed": getattr(hh, "is_manually_confirmed", 0),
            "manually_confirmed_at": hh.manually_confirmed_at.isoformat() if hh.manually_confirmed_at else None,
            "manually_confirmed_by": hh.manually_confirmed_by,
            # 面积数据（含季节分组）
            "contracted_area": float(hh.contract_area or 0),
            "confirmed_area": float(hh.confirmed_area) if hh.confirmed_area is not None else None,
            "trust_out_area": area_info.get("trust_out_area", 0),
            "trust_in_area": area_info.get("trust_in_area", 0),
            "cultivable_area": area_info.get("cultivable_area", float(hh.contract_area or 0)),
            "used_area": area_info.get("used_area", 0),
            "remaining_area": area_info.get("remaining_area", 0),
            "is_overdrawn": area_info.get("is_overdrawn", False),
            "overdraw_amount": area_info.get("overdraw_amount", 0),
            "season_breakdown": area_info.get("season_breakdown", {}),
        }
        items.append(row)

    return {"total": total, "page": page, "page_size": page_size, "items": items}


# ─────────────────────────────────────
#  接口：家庭户详情
# ─────────────────────────────────────

@router.get("/alert/overdrawn")
def list_overdrawn_households(
    year: Optional[int] = Query(None, description="指定年度，不传则取最近有补贴的年度"),
    village_name: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    列出所有已补贴面积 > 承包面积的家庭户。
    这是高优先级预警，正式申请前必须全部处理。
    """
    # 如果没传年度，取数据库中最近的有补贴年度
    if not year:
        latest = db.query(func.max(SubsidyApplication.apply_year)).scalar()
        year = latest or 2024

    query = db.query(FamilyHousehold).join(
        Village, Village.id == FamilyHousehold.village_id
    )
    if village_name:
        query = query.filter(Village.village_name == village_name)

    all_hh = query.filter(
        FamilyHousehold.contract_area.isnot(None),
        FamilyHousehold.contract_area > 0,
    ).all()

    if not all_hh:
        return {"year": year, "total": 0, "items": []}

    household_ids = [hh.id for hh in all_hh]

    # 1. 预加载所有户主信息（避免 N+1）
    head_ids = [hh.head_farmer_id for hh in all_hh if hh.head_farmer_id]
    head_map = {}
    if head_ids:
        heads = db.query(FarmerProfile).filter(FarmerProfile.id.in_(head_ids)).all()
        head_map = {f.id: f for f in heads}

    # 2. 批量预加载所有缓存记录（一次性查询）
    cache_records = db.query(HouseholdAreaUsageCache).filter(
        HouseholdAreaUsageCache.household_id.in_(household_ids)
    ).all()

    # 3. 构建缓存映射表
    cache_map: dict[int, list] = {}
    for rec in cache_records:
        if rec.household_id not in cache_map:
            cache_map[rec.household_id] = []
        cache_map[rec.household_id].append(rec)

    # 4. 批量预加载所有流转数据（一次性查询）
    trust_out_map: dict[int, float] = {}
    trust_in_map: dict[int, float] = {}
    trust_results = db.execute(text("""
        SELECT owner_household_id, operator_household_id, COALESCE(SUM(area), 0) as area
        FROM land_trust
        WHERE trust_year = :yr AND is_active = 1 AND affect_subsidy_calc = 1
        GROUP BY owner_household_id, operator_household_id
    """), {"yr": year}).fetchall()

    for hid, _, area in [(r[0], r[1], float(r[2] or 0)) for r in trust_results]:
        trust_out_map[hid] = trust_out_map.get(hid, 0) + area
    for _, hid, area in [(r[0], r[1], float(r[2] or 0)) for r in trust_results]:
        trust_in_map[hid] = trust_in_map.get(hid, 0) + area

    # 5. 在内存中计算每户的超领状态
    SEASON_ORDER = ["大春", "小春", "全年单补", "临时"]
    overdrawn = []

    for hh in all_hh:
        # 计算可耕种面积
        contracted = float(hh.contract_area or 0)
        trust_out = trust_out_map.get(hh.id, 0)
        trust_in = trust_in_map.get(hh.id, 0)
        cultivable = max(0.0, contracted - trust_out)

        # 从缓存计算年度使用面积
        cache_list = cache_map.get(hh.id, [])
        year_totals: dict[int, dict[str, float]] = {}
        for rec in cache_list:
            y = rec.year
            if y not in year_totals:
                year_totals[y] = {s: 0.0 for s in SEASON_ORDER}
            year_totals[y][rec.season] = year_totals[y].get(rec.season, 0.0) + float(rec.used_area)

        display_year = year if year in year_totals else (max(year_totals.keys()) if year_totals else None)
        total_used = round(sum(year_totals.get(display_year, {}).values()), 2) if display_year else 0.0
        is_overdrawn = cultivable > 0 and total_used > cultivable

        # 检查是否有任意一个季节超领或全年超领
        has_season_overdrawn = False
        season_breakdown: dict[str, dict] = {}
        if display_year:
            for season in SEASON_ORDER:
                used = round(year_totals[display_year].get(season, 0.0), 2)
                season_overdrawn = cultivable > 0 and used > cultivable
                overdraw_amt = round(max(0, used - cultivable), 2) if season_overdrawn else 0.0
                if season_overdrawn:
                    has_season_overdrawn = True
                season_breakdown[season] = {
                    "used_area": used,
                    "is_overdrawn": season_overdrawn,
                    "overdraw_amount": overdraw_amt,
                }

        if is_overdrawn or has_season_overdrawn:
            head = head_map.get(hh.head_farmer_id) if hh.head_farmer_id else None
            overdrawn.append({
                "household_id": hh.id,
                "household_code": hh.household_code,
                "household_name": hh.household_name,
                "head_name": head.real_name if head else "—",
                "village": f"{hh.village.village_name}{format_group_no(hh.group_no)}" if hh.village else "",
                "contracted_area": contracted,
                "cultivable_area": cultivable,
                "used_area": total_used,
                "overdraw_amount": round(max(0, total_used - cultivable), 2),
                "season_breakdown": season_breakdown,
                "year": year,
            })

    # 按超领面积降序
    overdrawn.sort(key=lambda x: -x["overdraw_amount"])

    return {
        "year": year,
        "total": len(overdrawn),
        "items": overdrawn,
    }


# ═══════════════════════════════════════════════════════════════
#  成员管理 CRUD（在已有路由文件中追加）
# ═══════════════════════════════════════════════════════════════

from schemas import FarmerCreate, FarmerUpdate
from utils import mask_id_card, mask_phone, mask_bank_card, parse_id_card, gen_household_code


class MemberCreate(BaseModel):
    """向家庭户新增成员（可以是已有农户或全新农户）"""
    # --- 新农户信息 ---
    real_name: str
    id_card: str
    gender: Optional[int] = None          # 不传则从身份证推断
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    relation: Optional[str] = "成员"      # 与户主关系
    is_head: Optional[int] = 0
    farmer_status: Optional[int] = 1
    remark: Optional[str] = None


class MemberUpdate(BaseModel):
    """更新成员信息"""
    real_name: Optional[str] = None
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    relation: Optional[str] = None
    is_head: Optional[int] = None       # 是否设为户主
    farmer_status: Optional[int] = None
    remark: Optional[str] = None
    event_date: Optional[str] = None    # 快照时间（YYYY-MM-DD），用于补录
    village_id: Optional[int] = None    # 所在村变更
    group_no: Optional[int] = None      # 所在组变更


def _member_out(m: FarmerProfile, db: Session) -> dict:
    """成员信息序列化（脱敏）"""
    head_id = db.query(FamilyHousehold.head_farmer_id).filter(FamilyHousehold.id == m.household_id).scalar() if m.household_id else None
    # 有效村组：优先取农户个人村组，无则取家庭户村组
    own_village_name: str | None = None
    if m.own_village_id:
        own_village_name = db.query(Village.village_name).filter(Village.id == m.own_village_id).scalar()
    if own_village_name:
        eff_village = own_village_name
        eff_group   = m.own_group_no or 1
    else:
        hh = db.get(FamilyHousehold, m.household_id) if m.household_id else None
        if hh:
            eff_village = db.query(Village.village_name).filter(Village.id == hh.village_id).scalar() or ""
            eff_group   = hh.group_no or 1
        else:
            eff_village, eff_group = "", 1
    return {
        "id": m.id,
        "household_id": m.household_id,
        "real_name": m.real_name,
        "gender": m.gender,
        "id_card_masked": mask_id_card(m.id_card),
        "id_card": m.id_card,              # 详情页需要完整号（设置页读取）
        "phone_masked": mask_phone(m.phone) if m.phone else None,
        "bank_card_masked": mask_bank_card(m.bank_card) if m.bank_card else None,
        "bank_name": m.bank_name,
        "is_head": 1 if head_id == m.id else 0,
        "relation": m.relation,
        "farmer_status": m.farmer_status,
        "remark": m.remark,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "own_village_id": m.own_village_id,
        "own_group_no": m.own_group_no,
        "village_full_name": f"{eff_village}{format_group_no(eff_group)}" if eff_village else "",
    }




@router.get("/{household_id}")
def get_household(
    household_id: int,
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """
    家庭户详情：
    - 基础信息
    - 所有成员列表（含状态）
    - 面积占用详情（分补贴项目、分年度）
    - 该户所有补贴申请摘要
    """
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        raise HTTPException(status_code=404, detail="家庭户不存在")

    # 所有成员
    members = db.query(FarmerProfile).filter(
        FarmerProfile.household_id == household_id
    ).order_by(
        (hh.head_farmer_id == FarmerProfile.id).desc(),
        FarmerProfile.id
    ).all()

    member_list = [
        {
            "id": m.id,
            "real_name": m.real_name,
            "gender": m.gender,
            "id_card_masked": m.id_card[:6] + "********" + m.id_card[-4:] if m.id_card else "",
            "is_head": 1 if hh.head_farmer_id == m.id else 0,
            "relation": m.relation,
            "farmer_status": m.farmer_status,
            "phone_masked": (m.phone[:3] + "****" + m.phone[-4:]) if m.phone and len(m.phone) >= 7 else m.phone,
        }
        for m in members
    ]

    # 面积占用详情
    area_info = calc_household_area_usage(household_id, db, year)

    # 所有成员的补贴申请摘要（按年度）
    member_ids = [m.id for m in members]
    app_summary = []
    if member_ids:
        # 第一步：查询补贴申请记录
        app_rows = (
            db.query(
                SubsidyApplication.apply_year,
                SubsidyApplication.farmer_id,
                FarmerProfile.real_name,
                SubsidyType.subsidy_name,
                SubsidyType.calc_mode,
                SubsidyApplication.apply_area,
                SubsidyApplication.apply_amount,
                SubsidyApplication.actual_amount,
                SubsidyApplication.pay_status,
                SubsidyApplication.apply_village_name,
                SubsidyApplication.apply_group_display,
                SubsidyApplication.is_proxy,
                SubsidyApplication.id.label("record_id"),
            )
            .join(FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id)
            .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
            .filter(SubsidyApplication.farmer_id.in_(member_ids))
            .order_by(SubsidyApplication.apply_year.desc())
            .all()
        )

        # 查询补贴发放记录
        from models import SubsidyPayment
        pay_rows = (
            db.query(
                SubsidyPayment.payment_year.label("apply_year"),
                SubsidyPayment.farmer_id,
                FarmerProfile.real_name,
                SubsidyType.subsidy_name,
                SubsidyType.calc_mode,
                SubsidyPayment.apply_area,
                SubsidyPayment.amount.label("apply_amount"),
                SubsidyPayment.amount.label("actual_amount"),
                (SubsidyPayment.pay_status or 2).label("pay_status"),
                SubsidyPayment.payment_village_name.label("apply_village_name"),
                SubsidyPayment.payment_group_display.label("apply_group_display"),
                SubsidyPayment.is_proxy,
                SubsidyPayment.id.label("record_id"),
            )
            .join(FarmerProfile, FarmerProfile.id == SubsidyPayment.farmer_id)
            .join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
            .filter(SubsidyPayment.farmer_id.in_(member_ids))
            .order_by(SubsidyPayment.payment_year.desc())
            .all()
        )

        # 合并申请和发放记录
        all_rows = []
        for r in app_rows:
            all_rows.append(("application", r))
        for r in pay_rows:
            all_rows.append(("payment", r))

        # 第二步：查询代领详情（同时查询申请和发放的代领关系）
        proxy_map = {}  # (record_type, record_id) -> proxy_info
        proxy_app_ids = [(typ, r.record_id) for typ, r in all_rows if r.is_proxy == 1]

        if proxy_app_ids:
            # 分别提取申请和发放的ID
            app_ids_for_proxy = [rid for typ, rid in proxy_app_ids if typ == "application"]
            pay_ids_for_proxy = [rid for typ, rid in proxy_app_ids if typ == "payment"]

            # 查询申请记录的代领关系
            proxy_app_rows = []
            if app_ids_for_proxy:
                proxy_app_rows = (
                    db.query(
                        SubsidyProxy.application_id.label("link_id"),
                        SubsidyProxy.proxy_type,
                        SubsidyProxy.beneficiary_farmer_id,
                        SubsidyProxy.proxy_farmer_id,
                        SubsidyProxy.remark,
                    )
                    .filter(SubsidyProxy.application_id.in_(app_ids_for_proxy))
                    .all()
                )

            # 查询发放记录的代领关系
            proxy_pay_rows = []
            if pay_ids_for_proxy:
                proxy_pay_rows = (
                    db.query(
                        SubsidyProxy.payment_id.label("link_id"),
                        SubsidyProxy.proxy_type,
                        SubsidyProxy.beneficiary_farmer_id,
                        SubsidyProxy.proxy_farmer_id,
                        SubsidyProxy.remark,
                    )
                    .filter(SubsidyProxy.payment_id.in_(pay_ids_for_proxy))
                    .all()
                )

            # 批量查询相关农户姓名
            involved_farmer_ids = set()
            for pr in proxy_app_rows + proxy_pay_rows:
                involved_farmer_ids.add(pr.beneficiary_farmer_id)
                involved_farmer_ids.add(pr.proxy_farmer_id)
            farmer_names = {f.id: f.real_name for f in db.query(FarmerProfile).filter(FarmerProfile.id.in_(involved_farmer_ids)).all()} if involved_farmer_ids else {}

            # 处理申请记录的代领关系
            for pr in proxy_app_rows:
                key = ("application", pr.link_id)
                # 找到原始记录判断角色
                orig_row = next((r for typ, r in all_rows if typ == "application" and r.record_id == pr.link_id), None)
                if orig_row:
                    if orig_row.farmer_id == pr.beneficiary_farmer_id:
                        proxy_map[key] = {
                            "type": "被代领",
                            "proxy_name": farmer_names.get(pr.proxy_farmer_id, "未知"),
                            "remark": pr.remark,
                        }
                    elif orig_row.farmer_id == pr.proxy_farmer_id:
                        proxy_map[key] = {
                            "type": "代领",
                            "beneficiary_name": farmer_names.get(pr.beneficiary_farmer_id, "未知"),
                            "remark": pr.remark,
                        }

            # 处理发放记录的代领关系
            for pr in proxy_pay_rows:
                key = ("payment", pr.link_id)
                orig_row = next((r for typ, r in all_rows if typ == "payment" and r.record_id == pr.link_id), None)
                if orig_row:
                    if orig_row.farmer_id == pr.beneficiary_farmer_id:
                        proxy_map[key] = {
                            "type": "被代领",
                            "proxy_name": farmer_names.get(pr.proxy_farmer_id, "未知"),
                            "remark": pr.remark,
                        }
                    elif orig_row.farmer_id == pr.proxy_farmer_id:
                        proxy_map[key] = {
                            "type": "代领",
                            "beneficiary_name": farmer_names.get(pr.beneficiary_farmer_id, "未知"),
                            "remark": pr.remark,
                        }

        # 第三步：构建结果
        app_summary = []
        for record_type, r in all_rows:
            key = (record_type, r.record_id)
            app_summary.append({
                "apply_year": r.apply_year,
                "farmer_id": r.farmer_id,
                "farmer_name": r.real_name,
                "subsidy_name": r.subsidy_name,
                "calc_mode": r.calc_mode,
                "apply_area": float(r.apply_area) if r.apply_area else None,
                "apply_amount": float(r.apply_amount) if r.apply_amount else None,
                "actual_amount": float(r.actual_amount) if r.actual_amount else None,
                "pay_status": r.pay_status,
                "apply_village_name": r.apply_village_name or "",
                "apply_group_display": r.apply_group_display or "",
                "is_proxy": r.is_proxy or 0,
                "proxy_info": proxy_map.get(key),
            })

        # 按年度倒序排序
        app_summary.sort(key=lambda x: -x["apply_year"])

    return {
        "id": hh.id,
        "household_code": hh.household_code,
        "household_name": hh.household_name,
        "village_full_name": f"{hh.village.village_name}{format_group_no(hh.group_no)}" if hh.village else "",
        "village_id": hh.village_id,
        "group_no": hh.group_no or 1,
        "address": hh.address,
        "contracted_area": float(hh.contract_area or 0),
        "confirmed_area": float(hh.confirmed_area) if hh.confirmed_area is not None else None,
        "status": hh.status,
        "remark": hh.remark,
        # 人工确认字段
        "is_manually_confirmed": getattr(hh, "is_manually_confirmed", 0),
        "manually_confirmed_at": hh.manually_confirmed_at.isoformat() if hh.manually_confirmed_at else None,
        "manually_confirmed_by": hh.manually_confirmed_by,
        "members": member_list,
        "area_usage": area_info,
        "app_summary": app_summary,
    }


# ─────────────────────────────────────
#  接口：更新家庭户
# ─────────────────────────────────────

@router.put("/{household_id}")
def update_household(
    household_id: int,
    data: HouseholdUpdate,
    db: Session = Depends(get_db)
):
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        raise HTTPException(status_code=404, detail="家庭户不存在")

    from datetime import date as _date
    from utils import format_group_no
    before = _snapshot_household(db, household_id)

    # 村组变更（整户迁移）
    village_changed = False
    old_village = f"{hh.village.village_name}{format_group_no(hh.group_no)}" if hh.village else "未知"
    new_village = old_village
    if data.village_id is not None and data.village_id != hh.village_id:
        hh.village_id = data.village_id
        village_changed = True
    if data.group_no is not None and data.group_no != hh.group_no:
        hh.group_no = data.group_no
        village_changed = True
    if village_changed:
        new_village = f"{hh.village.village_name}{format_group_no(hh.group_no)}" if hh.village else "未知"

    if data.household_name is not None: hh.household_name = data.household_name
    if data.contract_area is not None: hh.contract_area = Decimal(str(data.contract_area))
    if data.confirmed_area is not None: hh.confirmed_area = Decimal(str(data.confirmed_area))
    if data.address        is not None: hh.address        = data.address
    if data.status         is not None: hh.status         = data.status
    if data.remark         is not None: hh.remark         = data.remark

    after = _snapshot_household(db, household_id)

    # 确定事件类型和描述
    if village_changed:
        ev_type = "VILLAGE_CHANGE"
        desc = f"整户迁移：{old_village} → {new_village}"
        _log_event(db, household_id, ev_type, _date.today().year, desc,
                   before=before, after=after,
                   event_date=_date.today(), date_accuracy="EXACT")
    elif data.contract_area is not None:
        ev_type = "LAND_CHANGE"
        desc = f"土地面积变更：{float(before.get('contract_area', 0))}亩 → {float(data.contract_area or 0)}亩"
        _log_event(db, household_id, ev_type, _date.today().year, desc,
                   before=before, after=after,
                   event_date=_date.today(), date_accuracy="EXACT")
    elif data.status is not None:
        ev_type = "STATUS_CHANGE"
        desc = f"更新家庭户信息"
        _log_event(db, household_id, ev_type, _date.today().year, desc,
                   before=before, after=after,
                   event_date=_date.today(), date_accuracy="EXACT")

    db.commit()
    return {"message": "更新成功"}


# ─────────────────────────────────────
#  接口：批量导入确权面积
# ─────────────────────────────────────

class ConfirmedAreaRow(BaseModel):
    real_name: str
    id_card: str
    confirmed_area: float

class ConfirmedAreaImportRequest(BaseModel):
    rows: list[ConfirmedAreaRow]

@router.post("/import-confirmed-area")
def import_confirmed_area(req: ConfirmedAreaImportRequest, db: Session = Depends(get_db)):
    """
    批量导入确权面积。
    通过身份证号找到农户，更新所在家庭户的 confirmed_area。
    输入字段：real_name, id_card, confirmed_area
    """
    from utils import mask_id_card as _mask
    results = {"success": 0, "not_found": [], "mismatch_name": [], "errors": []}

    for row in req.rows:
        id_card = row.id_card.strip()
        real_name = row.real_name.strip()

        farmer = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
        if not farmer:
            results["not_found"].append({"id_card": _mask(id_card), "real_name": real_name})
            continue

        if farmer.real_name != real_name:
            results["mismatch_name"].append({
                "id_card": _mask(id_card),
                "input_name": real_name,
                "db_name": farmer.real_name,
            })
            continue  # 姓名不符，拒绝导入

        hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == farmer.household_id).first()
        if not hh:
            results["errors"].append({"id_card": _mask(id_card), "reason": "农户无关联家庭户"})
            continue

        hh.confirmed_area = Decimal(str(row.confirmed_area))
        results["success"] += 1

    db.commit()
    return results


@router.get("/export-confirmed-area-diff")
def export_confirmed_area_diff_endpoint(db: Session = Depends(get_db)):
    """导出全部家庭户的确权面积与承包面积对比 Excel"""
    from fastapi.responses import StreamingResponse
    from export_utils import export_confirmed_area_diff
    from utils import check_confirmed_vs_contract, format_group_no

    rows_q = db.execute(text("""
        SELECT hh.id, hh.household_name, hh.contract_area, hh.confirmed_area,
               hh.group_no,
               v.village_name,
               (SELECT fp.real_name FROM farmer_profile fp WHERE fp.id = hh.head_farmer_id) AS head_name
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE hh.status = 1
        ORDER BY v.village_name, hh.group_no, hh.household_name
    """)).fetchall()

    data = []
    for r in rows_q:
        cmp = check_confirmed_vs_contract(
            float(r.contract_area) if r.contract_area is not None else None,
            float(r.confirmed_area) if r.confirmed_area is not None else None,
        )
        data.append({
            "household_name": r.household_name,
            "village_full_name": f"{r.village_name or ''}{format_group_no(r.group_no)}",
            "head_name": r.head_name or "",
            "contract_area": float(r.contract_area) if r.contract_area is not None else "",
            "confirmed_area": float(r.confirmed_area) if r.confirmed_area is not None else "",
            "diff": cmp["diff"] if cmp["diff"] is not None else "",
            "label": cmp["label"],
            "status": cmp["status"],
        })

    output = export_confirmed_area_diff(data)
    headers = {"Content-Disposition": "attachment; filename*=UTF-8''%E7%A1%AE%E6%9D%83%E9%9D%A2%E7%A7%AF%E5%AF%B9%E6%AF%94.xlsx"}
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


# ─────────────────────────────────────
#  接口：成员调整（将成员移入另一户）
# ─────────────────────────────────────

@router.post("/member/move")
def move_member(req: MemberMoveRequest, db: Session = Depends(get_db)):
    """
    将农户移入另一个家庭户。
    如果 is_head=1，会将目标户原户主降为普通成员。
    """
    farmer = db.query(FarmerProfile).filter(FarmerProfile.id == req.farmer_id).first()
    if not farmer:
        raise HTTPException(status_code=404, detail="农户不存在")

    target_hh = db.query(FamilyHousehold).filter(
        FamilyHousehold.id == req.target_household_id
    ).first()
    if not target_hh:
        raise HTTPException(status_code=404, detail="目标家庭户不存在")

    old_household_id = farmer.household_id

    from datetime import date as _date
    old_before = _snapshot_household(db, old_household_id)
    new_before = _snapshot_household(db, req.target_household_id)

    # 如果要成为新户主，先把原户主降级
    if req.is_head == 1:
        old_head = db.get(FarmerProfile, target_hh.head_farmer_id) if target_hh.head_farmer_id else None
        if old_head:
            old_head.relation = "成员"

    farmer.household_id = req.target_household_id
    farmer.relation     = req.relation

    # 如果是户主，更新目标户的 head_farmer_id
    if req.is_head == 1:
        target_hh.head_farmer_id = farmer.id

    # 记录事件
    today = _date.today()
    if old_household_id != req.target_household_id:
        old_after = _snapshot_household(db, old_household_id)
        _log_event(db, old_household_id, "MEMBER_REMOVE", today.year,
                   f"移出成员「{farmer.real_name}」至「{target_hh.household_name}」",
                   before=old_before, after=old_after,
                   farmer_id=farmer.id, farmer_name=farmer.real_name,
                   related_hh_id=req.target_household_id,
                   event_date=today, date_accuracy="EXACT")
    new_after = _snapshot_household(db, req.target_household_id)
    _log_event(db, req.target_household_id, "MEMBER_ADD", today.year,
               f"新增成员「{farmer.real_name}」（从原户移入）",
               before=new_before, after=new_after,
               farmer_id=farmer.id, farmer_name=farmer.real_name,
               related_hh_id=old_household_id,
               event_date=today, date_accuracy="EXACT")

    db.commit()
    return {"message": f"已将「{farmer.real_name}」移入「{target_hh.household_name}」"}


# ─────────────────────────────────────
#  接口：超领预警列表
# ─────────────────────────────────────

@router.get("/{household_id}/members")
def list_members(household_id: int, db: Session = Depends(get_db)):
    """获取家庭户所有成员"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")
    members = (
        db.query(FarmerProfile)
          .filter(FarmerProfile.household_id == household_id)
          .order_by(
              (hh.head_farmer_id == FarmerProfile.id).desc(),
              FarmerProfile.id
          )
          .all()
    )
    return [_member_out(m, db) for m in members]


@router.post("/{household_id}/members")
def add_member(household_id: int, data: MemberCreate, db: Session = Depends(get_db)):
    """
    向家庭户新增成员。
    - 如果身份证已存在于其他家庭户，直接将其迁入（改变 household_id）
    - 如果身份证全新，创建新 FarmerProfile
    - 如果 is_head=1，原户主降为普通成员
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    from datetime import date as _date
    before = _snapshot_household(db, household_id)

    id_card_clean = data.id_card.strip().upper()

    # 检查身份证是否已存在
    existing = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card_clean).first()

    if existing:
        if existing.household_id == household_id:
            raise HTTPException(400, f"「{existing.real_name}」已是本户成员")
        # 从原家庭户迁入
        existing.household_id = household_id
        existing.relation = data.relation or "成员"
        member = existing
    else:
        # 从身份证推断性别
        parsed = parse_id_card(id_card_clean)
        gender = data.gender if data.gender is not None else (parsed.get("gender", 1) if parsed else 1)

        member = FarmerProfile(
            household_id=household_id,
            real_name=data.real_name,
            gender=gender,
            id_card=id_card_clean,
            phone=data.phone,
            bank_card=data.bank_card,
            bank_name=data.bank_name,
            relation=data.relation,
            farmer_status=data.farmer_status or 1,
            remark=data.remark,
        )
        db.add(member)

    # 如果新成员是户主，更新 head_farmer_id
    if data.is_head == 1:
        hh.head_farmer_id = member.id

    # 如果家庭户是消亡状态，但新增了在册成员，则恢复为在册状态
    if hh.status == 3 and (data.farmer_status or 1) == 1:
        hh.status = 1

    after = _snapshot_household(db, household_id)
    today = _date.today()
    _log_event(db, household_id, "MEMBER_ADD", today.year,
               f"新增成员「{member.real_name}」",
               before=before, after=after,
               farmer_id=member.id, farmer_name=member.real_name,
               event_date=today, date_accuracy="EXACT")

    db.commit()
    db.refresh(member)
    return {"message": "添加成功", "member": _member_out(member, db)}


@router.put("/{household_id}/members/{farmer_id}")
def update_member(household_id: int, farmer_id: int, data: MemberUpdate, db: Session = Depends(get_db)):
    """更新成员信息（姓名、电话、银行卡、关系、状态等）"""
    try:
        member = db.query(FarmerProfile).filter(
            FarmerProfile.id == farmer_id,
            FarmerProfile.household_id == household_id
        ).first()
        if not member:
            raise HTTPException(404, "成员不存在或不属于该家庭户")

        hh = db.get(FamilyHousehold, household_id)

        from datetime import date as _date

        # 解析事件时间（支持补录）
        event_date = _date.today()
        date_accuracy = "EXACT"
        if getattr(data, 'event_date', None):
            try:
                event_date = _date.fromisoformat(data.event_date)
                date_accuracy = "DAY"
            except (ValueError, TypeError):
                pass

        before = _snapshot_household(db, household_id)

        # 如果要设为户主，更新 household 的 head_farmer_id
        if getattr(data, 'is_head', None) == 1 and hh:
            hh.head_farmer_id = member.id

        # 如果设成员为"死亡"（4）且该成员是户主，自动转移户主或标记消亡
        old_status = member.farmer_status
        if data.farmer_status == 4 and old_status != 4 and hh and hh.head_farmer_id == member.id:
            # 找另一个在册成员接任户主
            successor = db.query(FarmerProfile).filter(
                FarmerProfile.household_id == household_id,
                FarmerProfile.id != farmer_id,
                FarmerProfile.farmer_status == 1
            ).first()
            if successor:
                hh.head_farmer_id = successor.id
            else:
                # 没有在册成员了，标记为消亡户
                hh.status = 3

        if data.real_name    is not None: member.real_name    = data.real_name
        if data.phone        is not None: member.phone        = data.phone or None
        if data.bank_card    is not None: member.bank_card    = data.bank_card or None
        if data.bank_name    is not None: member.bank_name    = data.bank_name or None
        if data.relation     is not None: member.relation     = data.relation
        if data.farmer_status is not None: member.farmer_status = data.farmer_status
        if data.remark       is not None: member.remark       = data.remark or None

        # 村组变更写入农户个人字段（出嫁/迁居等），不修改家庭户
        if data.village_id is not None:
            member.own_village_id = data.village_id if data.village_id != 0 else None
        if data.group_no is not None:
            member.own_group_no = data.group_no if data.group_no != 0 else None

        after = _snapshot_household(db, household_id)
        today = _date.today()
        if data.farmer_status is not None:
            ev_type = "MEMBER_STATUS"
            status_map = {1: "在册", 2: "注销", 3: "迁出", 4: "死亡"}
            old_label = status_map.get(old_status, str(old_status))
            new_label = status_map.get(data.farmer_status, str(data.farmer_status))
            desc = f"成员「{member.real_name}」状态变更：{old_label} → {new_label}"
        else:
            ev_type = "MEMBER_STATUS"
            desc = f"更新成员「{member.real_name}」信息"
        _log_event(db, household_id, ev_type, today.year, desc,
                   before=before, after=after,
                   farmer_id=farmer_id, farmer_name=member.real_name,
                   event_date=event_date, date_accuracy=date_accuracy)

        db.commit()
        return {"message": "更新成功", "member": _member_out(member, db)}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"更新失败: {type(e).__name__}: {str(e)}")


@router.delete("/{household_id}/members/{farmer_id}")
def remove_member(
    household_id: int,
    farmer_id: int,
    action: str = Query("detach", description="detach=迁出, delete=彻底删除（需无补贴记录）"),
    db: Session = Depends(get_db)
):
    """
    从家庭户移除成员。
    - action=detach：将成员标记为"迁出"（farmer_status=3），但保留数据
    - action=delete：彻底删除（仅允许无任何补贴记录的成员）
    注意：户主不能被移除，需先将其他成员设为户主。
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    member = db.query(FarmerProfile).filter(
        FarmerProfile.id == farmer_id,
        FarmerProfile.household_id == household_id
    ).first()
    if not member:
        raise HTTPException(404, "成员不存在")
    if hh.head_farmer_id == member.id:
        raise HTTPException(400, "户主不能被移除，请先将其他成员设为户主后再操作")

    from datetime import date as _date
    before = _snapshot_household(db, household_id)
    fname = member.real_name

    if action == "delete":
        # 检查是否有补贴记录
        app_count = db.query(func.count(SubsidyApplication.id)).filter(
            SubsidyApplication.farmer_id == farmer_id
        ).scalar() or 0
        if app_count > 0:
            raise HTTPException(400, f"该成员有 {app_count} 条补贴记录，不能彻底删除，请使用「迁出」操作")
        db.delete(member)
        msg = "已彻底删除"
    else:
        # 标记迁出
        member.farmer_status = 3
        msg = "已标记为迁出"

    # 检查是否还有在册成员，没有则标记为消亡户
    remaining = db.query(FarmerProfile).filter(
        FarmerProfile.household_id == household_id,
        FarmerProfile.farmer_status == 1
    ).count()
    if remaining == 0 and hh.status == 1:
        hh.status = 3  # 消亡户

    after = _snapshot_household(db, household_id)
    today = _date.today()
    _log_event(db, household_id, "MEMBER_REMOVE", today.year,
               f"移出成员「{fname}」({msg})",
               before=before, after=after,
               farmer_id=farmer_id, farmer_name=fname,
               event_date=today, date_accuracy="EXACT")

    db.commit()
    return {"message": msg}


@router.post("/recalc-cache")
def recalc_all_caches(db: Session = Depends(get_db)):
    """
    重新计算所有家庭户的面积占用缓存。
    在补贴申报或发放数据导入后调用此接口刷新缓存。
    """
    count = recalc_all_household_caches(db)
    return {"message": f"已重新计算 {count} 个家庭户的面积缓存"}


@router.post("/{household_id}/recalc-cache")
def recalc_single_household_cache(household_id: int, db: Session = Depends(get_db)):
    """
    重新计算指定家庭户的面积占用缓存。
    在该家庭户的补贴数据发生变化后调用。
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")
    recalc_household_area_cache(household_id, db)
    return {"message": f"已重新计算家庭户 {household_id} 的面积缓存"}


@router.get("/{household_id}/area-by-year")
def get_area_by_year(household_id: int, db: Session = Depends(get_db)):
    """
    获取该家庭户历年面积占用情况，用于前端按年度展示
    返回每个有数据的年份的面积明细（含季节分组）
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    contracted = float(hh.contract_area or 0)

    member_ids = [
        f.id for f in db.query(FarmerProfile.id)
                         .filter(FarmerProfile.household_id == household_id).all()
    ]
    if not member_ids:
        return {"contracted_area": contracted, "years": []}

    rows = (
        db.query(
            SubsidyApplication.apply_year,
            SubsidyType.subsidy_name,
            SubsidyType.season,
            func.sum(SubsidyApplication.apply_area).label("total_area"),
            func.sum(SubsidyApplication.actual_amount).label("total_amount"),
            func.count(SubsidyApplication.id).label("app_count"),
        )
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(
            SubsidyApplication.farmer_id.in_(member_ids),
            SubsidyType.calc_mode == "per_mu",
            SubsidyType.count_toward_area == 1,
            SubsidyApplication.apply_area.isnot(None),
            SubsidyApplication.pay_status.in_([0, 1, 2]),
            SubsidyApplication.is_proxy == 0,
        )
        .group_by(
            SubsidyApplication.apply_year, SubsidyType.subsidy_name, SubsidyType.season
        )
        .order_by(SubsidyApplication.apply_year.desc(), SubsidyType.season)
        .all()
    )

    SEASON_ORDER = ["大春", "小春", "全年单补", "临时"]

    # 按年份聚合
    year_map: dict = {}
    for r in rows:
        y = r.apply_year
        season = r.season or "全年单补"
        area = float(r.total_area or 0)

        if y not in year_map:
            year_map[y] = {
                "year": y,
                "season_breakdown": {s: {"used_area": 0.0, "subsidies": []} for s in SEASON_ORDER},
                "total_used": 0.0,
            }

        year_map[y]["season_breakdown"][season]["used_area"] += area
        year_map[y]["season_breakdown"][season]["subsidies"].append({
            "subsidy_name": r.subsidy_name,
            "apply_year": y,
            "used_area": round(area, 2),
            "total_amount": float(r.total_amount or 0),
            "app_count": r.app_count,
        })
        year_map[y]["total_used"] += area

    year_list = sorted(year_map.values(), key=lambda x: -x["year"])
    for y in year_list:
        y["total_used"] = round(y["total_used"], 2)
        y["contracted_area"] = contracted
        y["remaining_area"] = round(contracted - y["total_used"], 2)
        y["is_overdrawn"] = contracted > 0 and y["total_used"] > contracted
        y["overdraw_amount"] = round(max(0, y["total_used"] - contracted), 2)
        # 季节超额
        for season in SEASON_ORDER:
            sb = y["season_breakdown"][season]
            sb["used_area"] = round(sb["used_area"], 2)
            sb["remaining_area"] = round(contracted - sb["used_area"], 2)
            sb["is_overdrawn"] = contracted > 0 and sb["used_area"] > contracted
            sb["overdraw_amount"] = round(max(0, sb["used_area"] - contracted), 2)
            sb["subsidies"] = sorted(sb["subsidies"], key=lambda x: -x["used_area"])

    return {"contracted_area": contracted, "years": year_list}


# ─────────────────────────────────────
#  批量组建家庭户（Excel 导入）
# ─────────────────────────────────────

class HouseholdBuildRow(BaseModel):
    household_id: str          # Excel 中自定义的家庭户编号（如 HH001）
    id_card: str               # 身份证号，用于匹配已有农户
    real_name: Optional[str] = None
    is_head: Optional[int] = 0  # 1=户主 0=成员
    relation: Optional[str] = "成员"
    contract_area: Optional[float] = None   # 只有户主行填，设置到家庭户
    # 以下为可选字段，用于创建或更新农户信息
    village_name: Optional[str] = None      # 村名，如果提供则用于创建/更新家庭户
    group_no: Optional[str] = None          # 组号（字符串，如“一组”或“1”）
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    farmer_status: Optional[int] = 1        # 农户状态：1=在册，2=注销，3=迁出，4=死亡
    gender: Optional[int] = None            # 性别：1=男，2=女
    address: Optional[str] = None           # 家庭住址

class HouseholdBuildRequest(BaseModel):
    rows: list[HouseholdBuildRow]

@router.post("/batch-build")
def batch_build_households(req: HouseholdBuildRequest, db: Session = Depends(get_db)):
    """
    按 Excel 模板批量组建家庭户（增强版）：
    1. 逐行格式验证（身份证、姓名、手机号等）
    2. 按 household_id 分组
    3. 每组必须有一个户主，户主唯一
    4. 支持通过 village_name/group_no 指定村组，或从户主现有家庭户获取
    5. 更新农户信息（手机号、银行卡等）
    6. 创建或复用家庭户，将成员归入
    """
    rows = req.rows
    built, updated = 0, 0
    errors = []  # 业务错误
    format_errors = []  # 格式错误详情
    seen_id_cards = {}  # 记录 Excel 内重复身份证

    # 1. 逐行格式验证
    valid_rows = []
    for i, row in enumerate(rows):
        row_errors = []
        id_card = (row.id_card or "").strip().upper()
        real_name = (row.real_name or "").strip()
        household_id = (row.household_id or "").strip()

        # 必需字段检查
        if not household_id:
            row_errors.append("家庭户编号不能为空")
        if not id_card:
            row_errors.append("身份证号不能为空")
        else:
            # 身份证格式验证
            id_ok, id_err = validate_id_card(id_card)
            if not id_ok:
                row_errors.append(f"身份证格式错误：{id_err}")
            elif id_card in seen_id_cards:
                row_errors.append(f"身份证号与第{seen_id_cards[id_card]}行重复")
            else:
                seen_id_cards[id_card] = i + 1  # 行号从1开始

        if not real_name:
            row_errors.append("姓名不能为空")
        else:
            name_ok, name_err = check_name(real_name)
            if not name_ok:
                row_errors.append(f"姓名格式错误：{name_err}")

        # 手机号格式验证（可选）
        if row.phone:
            phone_ok, phone_err = check_phone(str(row.phone))
            if not phone_ok:
                row_errors.append(phone_err)

        # 土地面积合理性检查
        if row.contract_area is not None:
            try:
                area = float(row.contract_area)
                if area < 0:
                    row_errors.append(f"土地面积不能为负数（{area}）")
                elif area > 9999:
                    row_errors.append(f"土地面积异常偏大（{area}亩），请核实")
            except (ValueError, TypeError):
                row_errors.append(f"土地面积格式错误（{row.contract_area}）")

        if row_errors:
            format_errors.append({
                "row": i + 1,
                "household_id": household_id,
                "id_card": id_card,
                "real_name": real_name,
                "errors": row_errors
            })
        else:
            valid_rows.append(row)

    # 2. 按 household_id 分组
    from collections import defaultdict
    groups = defaultdict(list)
    for row in valid_rows:
        groups[row.household_id.strip()].append(row)

    # 3. 处理每个家庭户组
    for hh_label, members in groups.items():
        try:
            # 3.1 检查户主
            head_rows = [m for m in members if m.is_head == 1]
            if not head_rows:
                errors.append(f"家庭户 {hh_label}：没有指定户主（is_head=1）")
                continue
            if len(head_rows) > 1:
                errors.append(f"家庭户 {hh_label}：指定了多个户主，只允许一个")
                continue

            head_row = head_rows[0]

            # 3.2 确定村组信息
            # 优先使用户主行提供的 village_name/group_no
            village_id = None
            group_no_int = None

            if head_row.village_name or head_row.group_no:
                # 解析 village_id
                if head_row.village_name:
                    village = db.query(Village).filter(Village.village_name == head_row.village_name.strip()).first()
                    if not village:
                        # 创建新 Village
                        village = Village(village_name=head_row.village_name.strip())
                        db.add(village)
                        db.flush()
                    village_id = village.id

                # 解析 group_no
                if head_row.group_no:
                    group_no_int = parse_group_no_to_int(head_row.group_no)

            # 如果 village_id 或 group_no_int 仍为空，尝试从户主现有家庭户获取
            if not village_id or not group_no_int:
                # 查找户主农户
                head_farmer = db.query(FarmerProfile).filter(FarmerProfile.id_card == head_row.id_card.strip().upper()).first()
                if not head_farmer:
                    errors.append(f"家庭户 {hh_label}：户主身份证 {head_row.id_card} 找不到对应农户")
                    continue

                if head_farmer.household_id:
                    hh = db.get(FamilyHousehold, head_farmer.household_id)
                    if hh:
                        if not village_id:
                            village_id = hh.village_id
                        if not group_no_int:
                            group_no_int = hh.group_no

            # 最终检查村组完整性
            if not village_id:
                errors.append(f"家庭户 {hh_label}：无法确定村信息，请提供 village_name 或确保户主已有家庭户")
                continue
            if not group_no_int:
                errors.append(f"家庭户 {hh_label}：无法确定组信息，请提供 group_no 或确保户主已有家庭户")
                continue

            # 3.3 处理所有成员
            farmer_objs = []
            head_farmer_obj = None

            for m in members:
                ic = m.id_card.strip().upper()
                fp = db.query(FarmerProfile).filter(FarmerProfile.id_card == ic).first()
                if not fp:
                    errors.append(f"{hh_label} - {m.real_name or ic}：身份证找不到对应农户，跳过")
                    continue

                # 更新农户信息（如果提供了新值）
                if m.phone is not None:
                    fp.phone = m.phone.strip() or None
                if m.bank_card is not None:
                    fp.bank_card = m.bank_card.strip() or None
                if m.bank_name is not None:
                    fp.bank_name = m.bank_name.strip() or None
                if m.farmer_status is not None:
                    fp.farmer_status = m.farmer_status
                if m.gender is not None:
                    fp.gender = m.gender
                if m.relation is not None:
                    fp.relation = m.relation

                farmer_objs.append((fp, m))
                if m.is_head == 1:
                    head_farmer_obj = fp

            if not head_farmer_obj or not farmer_objs:
                errors.append(f"家庭户 {hh_label}：没有找到有效成员，跳过")
                continue

            # 3.4 创建或更新家庭户
            existing_hh = None
            if head_farmer_obj.household_id:
                existing_hh = db.get(FamilyHousehold, head_farmer_obj.household_id)

            if not existing_hh:
                # 创建新家庭户
                existing_hh = FamilyHousehold(
                    household_code=gen_household_code(head_farmer_obj.id),
                    household_name=f"{head_farmer_obj.real_name}户",
                    head_farmer_id=head_farmer_obj.id,
                    village_id=village_id,
                    group_no=group_no_int,
                    address=head_row.address,
                    contract_area=head_row.contract_area,
                    status=1,
                )
                db.add(existing_hh)
                db.flush()
                built += 1
            else:
                # 更新现有家庭户
                if head_row.contract_area is not None:
                    existing_hh.contract_area = head_row.contract_area
                existing_hh.head_farmer_id = head_farmer_obj.id
                # 更新村组信息（如果提供了新的）
                if village_id:
                    existing_hh.village_id = village_id
                if group_no_int:
                    existing_hh.group_no = group_no_int
                if head_row.address:
                    existing_hh.address = head_row.address
                updated += 1

            # 3.5 更新所有成员的 household_id 和 relation
            for fp, m in farmer_objs:
                fp.household_id = existing_hh.id
                fp.relation = m.relation or ("本人" if m.is_head == 1 else "成员")

            db.flush()

        except Exception as e:
            errors.append(f"家庭户 {hh_label}：处理失败 - {str(e)}")
            import traceback
            traceback.print_exc()

    db.commit()
    return {
        "built": built,
        "updated": updated,
        "errors": errors,
        "total_groups": len(groups),
        "format_errors_count": len(format_errors),
        "format_errors": format_errors
    }


# ══════════════════════════════════════════════════
#  家庭户变更事件 —— 历史记录核心
# ══════════════════════════════════════════════════

def _log_event(
    db: Session,
    household_id: int,
    event_type: str,
    event_year: int,
    description: str,
    before: dict | None = None,
    after: dict | None = None,
    farmer_id: int | None = None,
    farmer_name: str | None = None,
    related_hh_id: int | None = None,
    event_date=None,
    date_accuracy: str = "YEAR",
    evidence_type: str | None = None,
    evidence_note: str | None = None,
    operator: str | None = None,
):
    """通用事件记录函数，在所有会改变家庭户结构的操作中调用"""
    import json as _json
    from models import HouseholdEvent
    ev = HouseholdEvent(
        household_id=household_id,
        related_hh_id=related_hh_id,
        event_type=event_type,
        event_year=event_year,
        event_date=event_date,
        date_accuracy=date_accuracy,
        before_snapshot=_json.dumps(before, ensure_ascii=False, default=str) if before else None,
        after_snapshot=_json.dumps(after, ensure_ascii=False, default=str) if after else None,
        farmer_id=farmer_id,
        farmer_name=farmer_name,
        description=description,
        evidence_type=evidence_type,
        evidence_note=evidence_note,
        operator=operator,
    )
    db.add(ev)


def _snapshot_household(db: Session, household_id: int) -> dict:
    """抓取当前家庭户完整状态快照（用于 before/after_snapshot）"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        return {}
    members = (
        db.query(FarmerProfile)
          .filter(FarmerProfile.household_id == household_id)
          .order_by(
              (hh.head_farmer_id == FarmerProfile.id).desc(),
              FarmerProfile.id
          ).all()
    )
    head = next((m for m in members if hh.head_farmer_id == m.id), None)

    # 获取该户所有成员的补贴申请摘要（保存到快照中）
    member_ids = [m.id for m in members]
    subsidy_apps = []
    if member_ids:
        rows = (
            db.query(
                SubsidyApplication.apply_year,
                SubsidyApplication.farmer_id,
                FarmerProfile.real_name,
                SubsidyType.subsidy_name,
                SubsidyType.calc_mode,
                SubsidyApplication.apply_area,
                SubsidyApplication.apply_amount,
                SubsidyApplication.actual_amount,
                SubsidyApplication.pay_status,
                SubsidyApplication.apply_village_name,
                SubsidyApplication.apply_group_display,
                SubsidyApplication.is_proxy,
                SubsidyApplication.id.label("app_id"),
            )
            .join(FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id)
            .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
            .filter(SubsidyApplication.farmer_id.in_(member_ids))
            .order_by(SubsidyApplication.apply_year.desc())
            .all()
        )

        # 只对 is_proxy=1 的记录查询代领详情
        proxy_map = {}
        proxy_app_ids = [r.app_id for r in rows if r.is_proxy == 1]
        if proxy_app_ids:
            proxy_rows = (
                db.query(
                    SubsidyProxy.application_id,
                    SubsidyProxy.proxy_type,
                    SubsidyProxy.beneficiary_farmer_id,
                    SubsidyProxy.proxy_farmer_id,
                    SubsidyProxy.remark,
                )
                .filter(SubsidyProxy.application_id.in_(proxy_app_ids))
                .all()
            )
            involved_farmer_ids = set()
            for pr in proxy_rows:
                involved_farmer_ids.add(pr.beneficiary_farmer_id)
                involved_farmer_ids.add(pr.proxy_farmer_id)
            farmer_names = {f.id: f.real_name for f in db.query(FarmerProfile).filter(FarmerProfile.id.in_(involved_farmer_ids)).all()} if involved_farmer_ids else {}
            for pr in proxy_rows:
                if pr.application_id in proxy_app_ids:
                    orig_row = next(r for r in rows if r.app_id == pr.application_id)
                    if orig_row.farmer_id == pr.beneficiary_farmer_id:
                        proxy_map[pr.application_id] = {
                            "type": "被代领",
                            "proxy_name": farmer_names.get(pr.proxy_farmer_id, "未知"),
                            "remark": pr.remark,
                        }
                    elif orig_row.farmer_id == pr.proxy_farmer_id:
                        proxy_map[pr.application_id] = {
                            "type": "代领",
                            "beneficiary_name": farmer_names.get(pr.beneficiary_farmer_id, "未知"),
                            "remark": pr.remark,
                        }

        subsidy_apps = [
            {
                "apply_year": r.apply_year,
                "farmer_id": r.farmer_id,
                "farmer_name": r.real_name,
                "subsidy_name": r.subsidy_name,
                "calc_mode": r.calc_mode,
                "apply_area": float(r.apply_area) if r.apply_area else None,
                "apply_amount": float(r.apply_amount) if r.apply_amount else None,
                "actual_amount": float(r.actual_amount) if r.actual_amount else None,
                "pay_status": r.pay_status,
                "apply_village_name": r.apply_village_name or "",
                "apply_group_display": r.apply_group_display or "",
                "is_proxy": r.is_proxy or 0,
                "proxy_info": proxy_map.get(r.app_id),
            }
            for r in rows
        ]

    # 计算面积使用情况（保存到快照中）
    area_info = calc_household_area_usage(household_id, db)

    return {
        "household_name": hh.household_name,
        "household_code": hh.household_code,
        "contract_area": float(hh.contract_area or 0),
        "status": hh.status,
        "address": hh.address,
        "remark": hh.remark,
        "head_id": head.id if head else None,
        "members": [_member_out(m, db) for m in members],
        "app_summary": subsidy_apps,  # 快照时的补贴申请摘要
        "area_usage": area_info,      # 快照时的面积使用情况
    }


@router.get("/{household_id}/events")
def list_events(
    household_id: int,
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50),
):
    """查询家庭户的所有变更事件（时间线）"""
    from models import HouseholdEvent
    from sqlalchemy import text as _text
    total = db.query(func.count(HouseholdEvent.id)).filter(
        HouseholdEvent.household_id == household_id
    ).scalar() or 0
    rows = (
        db.query(HouseholdEvent)
          .filter(HouseholdEvent.household_id == household_id)
          .order_by(HouseholdEvent.event_year.desc(), HouseholdEvent.created_at.desc())
          .offset((page-1)*page_size).limit(page_size).all()
    )
    import json as _json
    def _ev_out(e):
        return {
            "id": e.id, "event_type": e.event_type,
            "event_year": e.event_year, "event_date": str(e.event_date) if e.event_date else None,
            "date_accuracy": e.date_accuracy,
            "description": e.description,
            "farmer_id": e.farmer_id, "farmer_name": e.farmer_name,
            "related_hh_id": e.related_hh_id,
            "before_snapshot": _json.loads(e.before_snapshot) if e.before_snapshot else None,
            "after_snapshot":  _json.loads(e.after_snapshot)  if e.after_snapshot  else None,
            "evidence_type": e.evidence_type, "evidence_note": e.evidence_note,
            "operator": e.operator,
            "created_at": str(e.created_at),
            "undoable": True,
        }
    return {"total": total, "items": [_ev_out(r) for r in rows]}


@router.post("/{household_id}/events")
def add_event(household_id: int, data: dict, db: Session = Depends(get_db)):
    """手动添加一条事件记录（补录历史用）"""
    import json as _json
    from datetime import date as _date
    hh = db.get(FamilyHousehold, household_id)
    if not hh: raise HTTPException(404, "家庭户不存在")

    ev_date = data.get("event_date")
    if isinstance(ev_date, str) and ev_date:
        try: ev_date = _date.fromisoformat(ev_date)
        except: ev_date = None

    _log_event(
        db, household_id,
        event_type   = data.get("event_type", "REMARK"),
        event_year   = int(data.get("event_year", _date.today().year)),
        description  = data.get("description", ""),
        event_date   = ev_date,
        date_accuracy= data.get("date_accuracy", "YEAR"),
        evidence_type= data.get("evidence_type"),
        evidence_note= data.get("evidence_note"),
        operator     = data.get("operator"),
    )
    db.commit()
    return {"message": "事件记录已添加"}


@router.delete("/{household_id}/events/{event_id}")
def undo_event(household_id: int, event_id: int,
               action: str = Query("undo", description="undo=撤销操作"),
               db: Session = Depends(get_db)):
    """撤销一次操作：恢复到操作前状态，删除事件记录"""
    import json as _json
    from datetime import date as _date
    from models import HouseholdEvent

    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    ev = db.query(HouseholdEvent).filter(
        HouseholdEvent.id == event_id,
        HouseholdEvent.household_id == household_id
    ).first()
    if not ev:
        raise HTTPException(404, "事件不存在")

    UNSUPPORTED = ("SPLIT", "MERGE", "FOUND")
    if ev.event_type in UNSUPPORTED:
        raise HTTPException(400, f"事件类型「{ev.event_type}」不支持撤销")

    before = _json.loads(ev.before_snapshot) if ev.before_snapshot else None
    after = _json.loads(ev.after_snapshot) if ev.after_snapshot else None

    if ev.event_type == "MEMBER_ADD":
        # 删除 after_snapshot 中新增的 farmer；恢复旧户主
        if after and after.get("members"):
            before_ids = set(m["id"] for m in (before.get("members") if before else []))
            after_ids = set(m["id"] for m in after.get("members", []))
            new_ids = after_ids - before_ids
            for mid in new_ids:
                fp = db.get(FarmerProfile, mid)
                if fp and fp.household_id == household_id:
                    db.delete(fp)
        # 恢复 before_snapshot 中的 head_farmer_id
        if before and before.get("head_id"):
            hh.head_farmer_id = before["head_id"]

    elif ev.event_type == "MEMBER_REMOVE":
        # 恢复被移出的成员状态
        if ev.farmer_id:
            fp = db.get(FarmerProfile, ev.farmer_id)
            if fp:
                if before:
                    m_before = next((m for m in before.get("members", []) if m["id"] == ev.farmer_id), None)
                    if m_before:
                        fp.household_id = household_id
                        fp.farmer_status = m_before.get("farmer_status", 1)
                        fp.relation = m_before.get("relation", "成员")

    elif ev.event_type == "HEAD_CHANGE":
        # 恢复旧户主
        if before and before.get("head_id"):
            hh.head_farmer_id = before["head_id"]

    elif ev.event_type == "MEMBER_STATUS":
        # 恢复成员的 farmer_status
        if ev.farmer_id and before:
            fp = db.get(FarmerProfile, ev.farmer_id)
            if fp:
                m_before = next((m for m in before.get("members", []) if m["id"] == ev.farmer_id), None)
                if m_before:
                    fp.farmer_status = m_before.get("farmer_status", 1)

    elif ev.event_type == "LAND_CHANGE":
        # 恢复土地面积
        if before and "contract_area" in before:
            hh.contract_area = Decimal(str(before["contract_area"]))

    elif ev.event_type == "STATUS_CHANGE":
        # 恢复家庭户状态
        if before:
            if "status" in before:
                hh.status = before["status"]
            if "household_name" in before:
                hh.household_name = before["household_name"]
            if "address" in before:
                hh.address = before["address"]

    elif ev.event_type == "REMARK":
        pass  # 仅删除事件

    db.delete(ev)
    db.commit()
    return {"message": "已撤销"}


@router.get("/{household_id}/history-dates")
def get_history_dates(household_id: int, db: Session = Depends(get_db)):
    """返回事件日期列表（降序），供前端滑轨使用"""
    from datetime import timedelta, date as _date
    from models import HouseholdEvent
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    rows = (
        db.query(HouseholdEvent)
          .filter(HouseholdEvent.household_id == household_id)
          .order_by(HouseholdEvent.event_date.desc().nullslast(),
                    HouseholdEvent.event_year.desc(),
                    HouseholdEvent.created_at.desc())
          .all()
    )
    events = [
        {
            "date": str(e.event_date) if e.event_date else f"{e.event_year}-01-01",
            "event_type": e.event_type,
            "description": e.description,
            "event_id": e.id,
            "event_year": e.event_year,
        }
        for e in rows
    ]

    # 追加「原始数据」条目：最早事件的 before_snapshot
    if rows:
        earliest = rows[-1]  # 升序排列后最后一条 = 最早
        if earliest.event_date:
            origin_date = str(earliest.event_date - timedelta(days=1))
        else:
            origin_date = f"{earliest.event_year - 1}-12-31"
        events.append({
            "date": origin_date,
            "event_type": "ORIGINAL",
            "description": "原始数据（首次记录前的状态）",
            "event_id": -1,
            "event_year": earliest.event_year if earliest.event_date else earliest.event_year - 1,
        })

    return {"events": events}


@router.get("/{household_id}/snapshot-at/{date}")
def get_snapshot_at_date(
    household_id: int,
    date: str,
    db: Session = Depends(get_db)
):
    """返回指定日期的家庭状态快照"""
    import json as _json
    from datetime import date as _date
    from models import HouseholdEvent

    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    target = _date.fromisoformat(date)

    # 找到日期 <= target 的最近事件
    latest_ev = (
        db.query(HouseholdEvent)
          .filter(
              HouseholdEvent.household_id == household_id,
              HouseholdEvent.event_date <= target
          )
          .order_by(HouseholdEvent.event_date.desc(), HouseholdEvent.created_at.desc())
          .first()
    )

    # 若 target 早于所有事件日期，取最早事件的 before_snapshot（原始数据）
    if not latest_ev:
        earliest_ev = (
            db.query(HouseholdEvent)
              .filter(HouseholdEvent.household_id == household_id)
              .order_by(HouseholdEvent.event_date.asc().nullsfirst(),
                        HouseholdEvent.event_year.asc(),
                        HouseholdEvent.created_at.asc())
              .first()
        )
        if earliest_ev and earliest_ev.before_snapshot:
            try:
                snap = _json.loads(earliest_ev.before_snapshot)
                return {
                    "target_date": date,
                    "snapshot": {
                        "household_name": snap.get("household_name", hh.household_name),
                        "household_code": snap.get("household_code", hh.household_code),
                        "contract_area": snap.get("contract_area", float(hh.contract_area or 0)),
                        "status": snap.get("status", hh.status),
                        "address": snap.get("address", hh.address),
                        "remark": snap.get("remark", hh.remark),
                        "head_id": snap.get("head_id"),
                        "members": snap.get("members", []),
                    },
                    "events": [],
                }
            except:
                pass

    # 找到日期 <= target 的最近事件
    latest_ev = (
        db.query(HouseholdEvent)
          .filter(
              HouseholdEvent.household_id == household_id,
              (HouseholdEvent.event_date <= target) | (HouseholdEvent.event_date == None)
          )
          .order_by(HouseholdEvent.event_date.desc().nullslast(), HouseholdEvent.created_at.desc())
          .first()
    )

    # 确定使用哪个快照
    snapshot_data = None
    if latest_ev:
        # 检查 target 是否在 latest_ev 之后（使用 after_snapshot）或之前（使用 before_snapshot）
        if latest_ev.event_date and target >= latest_ev.event_date:
            # target 在事件日期之后，使用 after_snapshot
            if latest_ev.after_snapshot:
                try:
                    snapshot_data = _json.loads(latest_ev.after_snapshot)
                except:
                    pass
        else:
            # target 在事件日期之前（或无日期），使用 before_snapshot
            if latest_ev.before_snapshot:
                try:
                    snapshot_data = _json.loads(latest_ev.before_snapshot)
                except:
                    pass

    # 如果有快照数据，使用它；否则使用当前状态
    if snapshot_data:
        household_name = snapshot_data.get("household_name", hh.household_name)
        household_code = snapshot_data.get("household_code", hh.household_code)
        contracted_area = snapshot_data.get("contract_area", float(hh.contract_area or 0))
        status = snapshot_data.get("status", hh.status)
        address = snapshot_data.get("address", hh.address)
        remark = snapshot_data.get("remark", hh.remark)
        head_id = snapshot_data.get("head_id")
        members = snapshot_data.get("members", [])
        # 从快照中获取补贴数据和面积使用情况
        app_summary = snapshot_data.get("app_summary", [])
        area_usage = snapshot_data.get("area_usage", {})
    else:
        # 无快照，返回当前状态
        household_name = hh.household_name
        household_code = hh.household_code
        contracted_area = float(hh.contract_area or 0)
        status = hh.status
        address = hh.address
        remark = hh.remark
        head_id = None
        members_q = (
            db.query(FarmerProfile)
              .filter(FarmerProfile.household_id == household_id)
              .order_by(
                  (hh.head_farmer_id == FarmerProfile.id).desc(),
                  FarmerProfile.id
              ).all()
        )
        members = [_member_out(m, db) for m in members_q]
        # 使用当前数据
        app_summary = []
        area_usage = {}

    # 该日期发生的所有事件
    day_events = (
        db.query(HouseholdEvent)
          .filter(
              HouseholdEvent.household_id == household_id,
              HouseholdEvent.event_date == target
          )
          .order_by(HouseholdEvent.created_at)
          .all()
    )
    events_list = [
        {
            "id": e.id, "event_type": e.event_type,
            "event_date": str(e.event_date) if e.event_date else None,
            "description": e.description,
            "farmer_name": e.farmer_name,
        }
        for e in day_events
    ]

    return {
        "target_date": date,
        "snapshot": {
            "household_name": household_name,
            "household_code": household_code,
            "contract_area": contracted_area,
            "status": status,
            "address": address,
            "remark": remark,
            "head_id": head_id,
            "members": members,
        },
        "events": events_list,
    }


@router.get("/{household_id}/snapshot-by-event/{event_id}")
def get_snapshot_by_event(
    household_id: int,
    event_id: int,
    db: Session = Depends(get_db)
):
    """返回指定事件对应的家庭状态快照"""
    import json as _json
    from models import HouseholdEvent

    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    # 特殊处理 event_id = -1 (ORIGINAL 虚拟事件)
    if event_id == -1:
        # 找到最早的真实事件，使用它的 before_snapshot
        earliest_ev = (
            db.query(HouseholdEvent)
              .filter(HouseholdEvent.household_id == household_id)
              .order_by(HouseholdEvent.event_date.asc().nullsfirst(),
                        HouseholdEvent.event_year.asc(),
                        HouseholdEvent.created_at.asc())
              .first()
        )
        snapshot_data = None
        target_date_str = None
        if earliest_ev and earliest_ev.before_snapshot:
            try:
                snapshot_data = _json.loads(earliest_ev.before_snapshot)
                target_date_str = str(earliest_ev.event_date) if earliest_ev.event_date else f"{earliest_ev.event_year}-01-01"
            except:
                pass
        # 如果没有快照数据，使用当前状态
        if snapshot_data:
            household_name = snapshot_data.get("household_name", hh.household_name)
            household_code = snapshot_data.get("household_code", hh.household_code)
            contracted_area = snapshot_data.get("contract_area", float(hh.contract_area or 0))
            status = snapshot_data.get("status", hh.status)
            address = snapshot_data.get("address", hh.address)
            remark = snapshot_data.get("remark", hh.remark)
            head_id = snapshot_data.get("head_id")
            members = snapshot_data.get("members", [])
            # 从快照中获取补贴数据和面积使用情况
            app_summary = snapshot_data.get("app_summary", [])
            area_usage = snapshot_data.get("area_usage", {})
        else:
            household_name = hh.household_name
            household_code = hh.household_code
            contracted_area = float(hh.contract_area or 0)
            status = hh.status
            address = hh.address
            remark = hh.remark
            head_id = None
            members_q = (
                db.query(FarmerProfile)
                  .filter(FarmerProfile.household_id == household_id)
                  .order_by(
                      (hh.head_farmer_id == FarmerProfile.id).desc(),
                      FarmerProfile.id
                  ).all()
            )
            members = [_member_out(m, db) for m in members_q]
            # 使用当前数据
            app_summary = []
            area_usage = {}
        # 返回虚拟 ORIGINAL 事件
        events_list = [{
            "id": -1, "event_type": "ORIGINAL",
            "event_date": target_date_str,
            "description": "原始数据（首次记录前的状态）",
            "farmer_name": None,
        }]
        return {
            "target_date": target_date_str,
            "snapshot": {
                "household_name": household_name,
                "household_code": household_code,
                "contract_area": contracted_area,
                "status": status,
                "address": address,
                "remark": remark,
                "head_id": head_id,
                "members": members,
                "app_summary": app_summary,
                "area_usage": area_usage,
            },
            "events": events_list,
        }

    # 普通事件处理
    ev = db.get(HouseholdEvent, event_id)
    if not ev or ev.household_id != household_id:
        raise HTTPException(404, "事件不存在")

    # 确定使用哪个快照
    snapshot_data = None
    target_date_str = str(ev.event_date) if ev.event_date else None

    # 对于其他事件，优先使用 after_snapshot，回退到 before_snapshot
    if ev.after_snapshot:
        try:
            snapshot_data = _json.loads(ev.after_snapshot)
        except:
            pass
    if not snapshot_data and ev.before_snapshot:
        try:
            snapshot_data = _json.loads(ev.before_snapshot)
        except:
            pass

    # 如果有快照数据，使用它；否则使用当前状态
    if snapshot_data:
        household_name = snapshot_data.get("household_name", hh.household_name)
        household_code = snapshot_data.get("household_code", hh.household_code)
        contracted_area = snapshot_data.get("contract_area", float(hh.contract_area or 0))
        status = snapshot_data.get("status", hh.status)
        address = snapshot_data.get("address", hh.address)
        remark = snapshot_data.get("remark", hh.remark)
        head_id = snapshot_data.get("head_id")
        members = snapshot_data.get("members", [])
        # 从快照中获取补贴数据和面积使用情况
        app_summary = snapshot_data.get("app_summary", [])
        area_usage = snapshot_data.get("area_usage", {})
    else:
        # 无快照，返回当前状态
        household_name = hh.household_name
        household_code = hh.household_code
        contracted_area = float(hh.contract_area or 0)
        status = hh.status
        address = hh.address
        remark = hh.remark
        head_id = None
        members_q = (
            db.query(FarmerProfile)
              .filter(FarmerProfile.household_id == household_id)
              .order_by(
                  (hh.head_farmer_id == FarmerProfile.id).desc(),
                  FarmerProfile.id
              ).all()
        )
        members = [_member_out(m, db) for m in members_q]
        # 使用当前数据
        app_summary = []
        area_usage = {}

    # 返回该事件本身作为事件列表
    events_list = [{
        "id": ev.id, "event_type": ev.event_type,
        "event_date": str(ev.event_date) if ev.event_date else None,
        "description": ev.description,
        "farmer_name": ev.farmer_name,
    }]

    return {
        "target_date": target_date_str,
        "snapshot": {
            "household_name": household_name,
            "household_code": household_code,
            "contract_area": contracted_area,
            "status": status,
            "address": address,
            "remark": remark,
            "head_id": head_id,
            "members": members,
        },
        "events": events_list,
    }


# ══════════════════════════════════════════════════
#  年度历史快照 —— 回溯指定年度的家庭状态
# ══════════════════════════════════════════════════

@router.get("/{household_id}/history-years")
def get_history_years(household_id: int, db: Session = Depends(get_db)):
    """返回该家庭户有事件记录的所有年份（降序）"""
    from models import HouseholdEvent
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    years = (
        db.query(HouseholdEvent.event_year)
          .filter(HouseholdEvent.household_id == household_id)
          .distinct()
          .order_by(HouseholdEvent.event_year.desc())
          .all()
    )
    return {"years": [r[0] for r in years]}


@router.get("/{household_id}/history/{year}")
def get_history_snapshot(
    household_id: int,
    year: int,
    db: Session = Depends(get_db)
):
    """
    获取指定年度的家庭状态快照。
    通过 HouseholdEvent 的 before/after_snapshot 回溯重建：
    - 成员列表：基于当前成员 + 事件逆推
    - 土地面积：从最近的 LAND_CHANGE 事件 before_snapshot 获取
    - 当年事件列表
    """
    import json as _json
    from models import HouseholdEvent

    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    # 1. 获取该户所有事件（按时间倒序）
    all_events = (
        db.query(HouseholdEvent)
          .filter(HouseholdEvent.household_id == household_id)
          .order_by(HouseholdEvent.event_year.desc(), HouseholdEvent.created_at.desc())
          .all()
    )

    # 2. 获取当前所有成员
    current_members = (
        db.query(FarmerProfile)
          .filter(FarmerProfile.household_id == household_id)
          .order_by(
              (hh.head_farmer_id == FarmerProfile.id).desc(),
              FarmerProfile.id
          )
          .all()
    )

    # 3. 逆推：找出哪些事件发生在 target_year 之后，需要"撤销"
    #    events_after: event_year > year 的事件
    events_after = [e for e in all_events if e.event_year > year]
    #    events_in_year: event_year == year 的事件（展示用）
    events_in_year = [e for e in all_events if e.event_year == year]
    #    events_before: event_year <= year 的事件（用于获取该年度的状态）
    events_before = [e for e in all_events if e.event_year <= year]

    # 4. 重建成员列表
    #    从当前成员出发，撤销 events_after 中的操作
    member_ids_set = set(m.id for m in current_members)
    removed_member_ids = set()  # 需要恢复的成员（在 year 之后被移出的）
    added_member_ids = set()    # 需要移除的成员（在 year 之后才加入的）

    for ev in events_after:
        if ev.event_type == "MEMBER_ADD" and ev.farmer_id:
            # 该成员在 year 之后才加入，year 时不存在
            added_member_ids.add(ev.farmer_id)
        elif ev.event_type == "MEMBER_REMOVE" and ev.farmer_id:
            # 该成员在 year 之后才移出，year 时还在
            removed_member_ids.add(ev.farmer_id)
        elif ev.event_type == "SPLIT":
            # 分户事件：after_snapshot 包含被分出的成员
            try:
                after = _json.loads(ev.after_snapshot) if ev.after_snapshot else {}
                before = _json.loads(ev.before_snapshot) if ev.before_snapshot else {}
                # 分户后的成员是 before_snapshot 中的（分户前的完整成员列表）
                # 但 current 只有留下的成员，被分走的已经不在了
                # 所以需要把 before_snapshot 中、但 after 不在原户的成员加回来
                if "members" in before:
                    for bm in before["members"]:
                        bm_id = bm.get("id")
                        if bm_id and bm_id not in member_ids_set:
                            removed_member_ids.add(bm_id)
            except: pass
        elif ev.event_type == "MERGE":
            # 合户事件：after_snapshot 包含合并后的信息
            # 需要把被合并进来的成员移除（year 时还没合并）
            try:
                after = _json.loads(ev.after_snapshot) if ev.after_snapshot else {}
                if "added_members" in after:
                    for mid in after["added_members"]:
                        added_member_ids.add(mid)
            except: pass

    # 5. 构建该年度的成员列表
    snapshot_members = []
    for m in current_members:
        if m.id in added_member_ids:
            continue  # 该成员 year 之后才加入，跳过
        snapshot_members.append({
            "id": m.id,
            "real_name": m.real_name,
            "gender": m.gender,
            "id_card_masked": m.id_card[:6] + "********" + m.id_card[-4:] if m.id_card else "",
            "is_head": 1 if hh.head_farmer_id == m.id else 0,
            "relation": m.relation,
            "farmer_status": m.farmer_status,
            "phone_masked": (m.phone[:3] + "****" + m.phone[-4:]) if m.phone and len(m.phone) >= 7 else m.phone,
        })

    # 恢复被移出的成员（从 before_snapshot 中获取信息）
    for ev in events_after:
        if ev.event_type in ("MEMBER_REMOVE", "MEMBER_STATUS") and ev.farmer_id in removed_member_ids:
            try:
                before = _json.loads(ev.before_snapshot) if ev.before_snapshot else None
                if before and isinstance(before, dict):
                    snapshot_members.append({
                        "id": ev.farmer_id,
                        "real_name": before.get("real_name") or ev.farmer_name or "未知",
                        "gender": before.get("gender", 1),
                        "id_card_masked": before.get("id_card_masked", ""),
                        "is_head": before.get("is_head", 0),
                        "relation": before.get("relation", "成员"),
                        "farmer_status": 1,  # 移出前都是在册
                        "phone_masked": before.get("phone_masked"),
                    })
                else:
                    # 没有 before_snapshot，用 farmer_name
                    snapshot_members.append({
                        "id": ev.farmer_id,
                        "real_name": ev.farmer_name or "未知",
                        "gender": 1,
                        "id_card_masked": "",
                        "is_head": 0,
                        "relation": "成员",
                        "farmer_status": 1,
                        "phone_masked": None,
                    })
            except: pass

    # 恢复分户前的成员
    for ev in events_after:
        if ev.event_type == "SPLIT":
            try:
                before = _json.loads(ev.before_snapshot) if ev.before_snapshot else {}
                if "members" in before:
                    existing_ids = set(m["id"] for m in snapshot_members)
                    for bm in before["members"]:
                        if bm.get("id") and bm["id"] not in existing_ids:
                            snapshot_members.append({
                                "id": bm["id"],
                                "real_name": bm.get("real_name", "未知"),
                                "gender": bm.get("gender", 1),
                                "id_card_masked": bm.get("id_card_masked", ""),
                                "is_head": bm.get("is_head", 0),
                                "relation": bm.get("relation", "成员"),
                                "farmer_status": bm.get("farmer_status", 1),
                                "phone_masked": bm.get("phone_masked"),
                            })
            except: pass

    # 排序：户主在前
    snapshot_members.sort(key=lambda x: (-x.get("is_head", 0), x.get("id", 0)))

    # 6. 回溯土地面积
    contracted_area = float(hh.contract_area or 0)
    for ev in all_events:
        if ev.event_type == "LAND_CHANGE" and ev.event_year > year:
            try:
                before = _json.loads(ev.before_snapshot) if ev.before_snapshot else {}
                if "contract_area" in before:
                    contracted_area = float(before["contract_area"])
                    break
            except: pass
        elif ev.event_type == "SPLIT" and ev.event_year > year:
            try:
                before = _json.loads(ev.before_snapshot) if ev.before_snapshot else {}
                if "contract_area" in before:
                    contracted_area = float(before["contract_area"])
                    break
            except: pass

    # 7. 回溯面积使用情况
    area_info = calc_household_area_usage(household_id, db, year)

    # 8. 该年度的事件列表
    year_events = []
    for ev in events_in_year:
        year_events.append({
            "id": ev.id, "event_type": ev.event_type,
            "event_year": ev.event_year,
            "event_date": str(ev.event_date) if ev.event_date else None,
            "description": ev.description,
            "farmer_name": ev.farmer_name,
        })

    return {
        "year": year,
        "household_name": hh.household_name,
        "household_code": hh.household_code,
        "village_full_name": f"{hh.village.village_name}{format_group_no(hh.group_no)}" if hh.village else "",
        "contracted_area": contracted_area,
        "status": hh.status,
        "members": snapshot_members,
        "area_usage": area_info,
        "events_in_year": year_events,
    }


# ══════════════════════════════════════════════════
#  分户操作
# ══════════════════════════════════════════════════

@router.post("/{household_id}/split")
def split_household(household_id: int, data: dict, db: Session = Depends(get_db)):
    """
    分户操作：将指定成员从原家庭户分出，组建新家庭户。
    data: {
      split_year: int,          # 分户年度（必填）
      split_date: str,          # 分户日期（可选）
      new_household_name: str,  # 新户名（必填）
      member_ids: [int],        # 要分出去的成员id列表（必填，至少1人）
      new_head_id: int,         # 新户的户主id（从 member_ids 中选一个）
      new_land_area: float,     # 新户承担的土地面积（可选）
      origin_land_area: float,  # 原户调整后的土地面积（可选）
      description: str,         # 分户原因/说明
      evidence_type: str,
      evidence_note: str,
      operator: str,
    }
    """
    from datetime import date as _date, datetime

    hh = db.get(FamilyHousehold, household_id)
    if not hh: raise HTTPException(404, "家庭户不存在")

    split_year   = int(data.get("split_year", _date.today().year))
    member_ids   = data.get("member_ids", [])
    new_head_id  = data.get("new_head_id")
    new_hh_name  = data.get("new_household_name", "").strip()

    if not member_ids:
        raise HTTPException(400, "请选择要分出的成员")
    if not new_hh_name:
        raise HTTPException(400, "请填写新家庭户的名称")
    if not new_head_id or new_head_id not in member_ids:
        raise HTTPException(400, "请从分出成员中指定新户主")

    # 验证成员都属于本户
    members = db.query(FarmerProfile).filter(
        FarmerProfile.id.in_(member_ids),
        FarmerProfile.household_id == household_id
    ).all()
    if len(members) != len(member_ids):
        raise HTTPException(400, "部分成员不属于该家庭户")

    # 不能把全部成员分走
    total_members = db.query(func.count(FarmerProfile.id)).filter(
        FarmerProfile.household_id == household_id
    ).scalar() or 0
    if len(member_ids) >= total_members:
        raise HTTPException(400, "不能将所有成员分出，原户至少保留1名成员")

    # 原户户主不能被分走（除非指定了新的原户户主）
    orig_head = db.get(FarmerProfile, hh.head_farmer_id) if hh.head_farmer_id else None
    if orig_head and orig_head.id in member_ids:
        raise HTTPException(400, f"原户户主「{orig_head.real_name}」不能被分出，请先在原户指定新户主")

    # 记录分户前快照
    before_snap = {
        "household_name": hh.household_name,
        "contract_area": float(hh.contract_area or 0),
        "members": [{"id": m.id, "real_name": m.real_name, "is_head": 1 if hh.head_farmer_id == m.id else 0} for m in
                    db.query(FarmerProfile).filter(FarmerProfile.household_id == household_id).all()]
    }

    # 建新家庭户
    new_head = db.get(FarmerProfile, new_head_id)
    new_code = f"HH{int(datetime.now().timestamp())%100000:05d}"
    new_hh = FamilyHousehold(
        household_code   = new_code,
        household_name   = new_hh_name,
        head_farmer_id   = new_head_id,
        village_id       = hh.village_id,
        group_no         = hh.group_no,
        address          = hh.address,
        contract_area    = Decimal(str(data["new_land_area"])) if data.get("new_land_area") else None,
        status           = 1,
        remark           = f"由「{hh.household_name}」于{split_year}年分户组建",
    )
    db.add(new_hh); db.flush()

    # 把成员移入新户
    for m in members:
        m.household_id = new_hh.id
        if m.id == new_head_id:
            m.relation = "本人"
        else:
            pass  # relation already set appropriately

    # 更新原户面积
    if data.get("origin_land_area") is not None:
        hh.contract_area = Decimal(str(data["origin_land_area"]))

    # 分户后快照
    after_snap = {
        "original_hh": {
            "id": hh.id, "household_name": hh.household_name,
            "contract_area": float(hh.contract_area or 0),
        },
        "new_hh": {
            "id": new_hh.id, "household_name": new_hh.household_name,
            "household_code": new_code, "contract_area": float(new_hh.contract_area or 0),
            "head": new_head.real_name if new_head else None,
        }
    }

    # 给原户和新户各记录一条事件
    ev_date_raw = data.get("split_date")
    from datetime import date as _date2
    ev_date = None
    if isinstance(ev_date_raw, str) and ev_date_raw:
        try: ev_date = _date2.fromisoformat(ev_date_raw)
        except: pass

    _log_event(db, household_id, "SPLIT", split_year,
               description  = data.get("description", f"分户：将{len(member_ids)}名成员分出，组建「{new_hh_name}」"),
               before       = before_snap, after = after_snap,
               related_hh_id= new_hh.id, event_date=ev_date,
               date_accuracy= "EXACT" if ev_date else "YEAR",
               evidence_type= data.get("evidence_type"), evidence_note=data.get("evidence_note"),
               operator     = data.get("operator"))

    _log_event(db, new_hh.id, "FOUND", split_year,
               description  = f"由「{hh.household_name}」（id={household_id}）于{split_year}年分户组建",
               after        = after_snap["new_hh"],
               related_hh_id= household_id, event_date=ev_date,
               date_accuracy= "EXACT" if ev_date else "YEAR",
               operator     = data.get("operator"))

    db.commit()
    return {
        "message": f"分户成功，新家庭户「{new_hh_name}」（{new_code}）已建立",
        "new_household_id": new_hh.id,
        "new_household_code": new_code,
    }


# ══════════════════════════════════════════════════
#  成员批量导入（Excel）
# ══════════════════════════════════════════════════

@router.post("/{household_id}/members/batch-import")
def batch_import_members(household_id: int, payload: dict, db: Session = Depends(get_db)):
    """
    批量导入/更新成员信息
    rows: [{id_card, real_name, is_head, relation, phone, bank_card, farmer_status, ...}]
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh: raise HTTPException(404, "家庭户不存在")

    rows    = payload.get("rows", [])
    year    = int(payload.get("year", __import__('datetime').date.today().year))
    operator= payload.get("operator", "批量导入")
    created, updated, errors = 0, 0, []

    for i, row in enumerate(rows):
        id_card = str(row.get("id_card","")).strip().upper()
        name    = str(row.get("real_name","")).strip()
        if not id_card:
            errors.append(f"第{i+2}行：缺少身份证号"); continue
        if not name:
            errors.append(f"第{i+2}行：缺少姓名"); continue

        existing = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
        is_head_val = 1 if str(row.get("is_head","0")) in ("1","是","户主","true") else 0

        if existing:
            before = {"household_id": existing.household_id, "real_name": existing.real_name}
            if existing.household_id != household_id:
                existing.household_id = household_id
            if row.get("relation"):    existing.relation     = str(row["relation"])
            if row.get("phone"):       existing.phone        = str(row["phone"]).strip() or None
            if row.get("bank_card"):   existing.bank_card    = str(row["bank_card"]).strip() or None
            if row.get("bank_name"):   existing.bank_name    = str(row["bank_name"]).strip() or None
            status_map = {"在册":1,"正常":1,"注销":2,"迁出":3,"死亡":4}
            if row.get("farmer_status"):
                sv = row["farmer_status"]
                existing.farmer_status = status_map.get(str(sv), int(sv) if str(sv).isdigit() else 1)
            after = {"household_id": household_id, "is_head": is_head_val}
            _log_event(db, household_id, "MEMBER_ADD", year,
                       f"批量导入更新成员：{name}",
                       before=before, after=after, farmer_id=existing.id, farmer_name=name, operator=operator)
            updated += 1
        else:
            from utils import parse_id_card as _pic
            parsed = _pic(id_card) or {}
            fp = FarmerProfile(
                household_id = household_id,
                real_name    = name,
                gender       = parsed.get("gender", 1 if str(row.get("gender","男"))=="男" else 2),
                id_card      = id_card,
                phone        = str(row.get("phone","")).strip() or None,
                bank_card    = str(row.get("bank_card","")).strip() or None,
                bank_name    = str(row.get("bank_name","")).strip() or None,
                relation     = str(row.get("relation","成员")).strip() or "成员",
                farmer_status= 1,
            )
            db.add(fp); db.flush()
            _log_event(db, household_id, "MEMBER_ADD", year,
                       f"批量导入新增成员：{name}",
                       after={"id_card": id_card, "is_head": is_head_val}, farmer_id=fp.id, farmer_name=name, operator=operator)
            created += 1

    # 如果导入数据中有户主，更新 head_farmer_id
    if any(str(r.get("is_head","0")) in ("1","是","户主","true") for r in rows):
        head_row = next(r for r in rows if str(r.get("is_head","0")) in ("1","是","户主","true"))
        head_fp = db.query(FarmerProfile).filter(
            FarmerProfile.id_card == str(head_row.get("id_card","")).strip().upper()
        ).first()
        if head_fp:
            hh.head_farmer_id = head_fp.id

    db.flush()
    db.commit()
    return {"created": created, "updated": updated, "errors": errors}


# ─────────────────────────────────────
#  接口：合并家庭户
# ─────────────────────────────────────

class HouseholdMergeRequest(BaseModel):
    source_household_id: int      # 被合并的户（将删除）
    target_household_id: int      # 目标户（将保留）
    operator: Optional[str] = None

@router.post("/merge")
def merge_households(req: HouseholdMergeRequest, db: Session = Depends(get_db)):
    """
    将 source 家庭户合并入 target 家庭户：
    1. 所有成员迁入 target（补贴数据随 farmer_id 自动跟随）
    2. 土地流转台账中涉及 source 的记录转移到 target
    3. source 的面积缓存清除，合并后重算 target 缓存
    4. source 家庭户删除（事件历史保留并转移到 target）
    5. 记录 MERGE 事件快照
    """
    source = db.get(FamilyHousehold, req.source_household_id)
    target = db.get(FamilyHousehold, req.target_household_id)
    if not source: raise HTTPException(404, "被合并的家庭户不存在")
    if not target: raise HTTPException(404, "目标家庭户不存在")
    if source.id == target.id: raise HTTPException(400, "不能合并到自身")

    from datetime import date as _date
    from models import HouseholdEvent, LandTrust
    now = _date.today()

    # 快照（合并前）
    src_before = _snapshot_household(db, source.id)
    tgt_before = _snapshot_household(db, target.id)

    # 1. 迁移所有成员到目标户（补贴申请记录通过 farmer_id 自动跟随）
    members = db.query(FarmerProfile).filter(
        FarmerProfile.household_id == source.id
    ).all()
    for m in members:
        m.household_id = target.id

    # 2. 转移土地流转台账中 source 作为流出方/流入方的记录
    db.query(LandTrust).filter(
        LandTrust.owner_household_id == source.id
    ).update({"owner_household_id": target.id})
    db.query(LandTrust).filter(
        LandTrust.operator_household_id == source.id
    ).update({"operator_household_id": target.id})

    # 3. 清除 source 的面积缓存（避免 FK 约束）
    db.query(HouseholdAreaUsageCache).filter(
        HouseholdAreaUsageCache.household_id == source.id
    ).delete()

    # 4. 转移 source 的事件历史到 target
    db.query(HouseholdEvent).filter(
        HouseholdEvent.household_id == source.id
    ).update({"household_id": target.id})

    db.flush()

    # 删除 source 家庭户
    src_name = source.household_name
    db.delete(source)
    db.flush()

    # 5. 记录 MERGE 事件（保留在 target）
    tgt_after = _snapshot_household(db, target.id)
    _log_event(
        db, target.id, "MERGE", now.year,
        description=f"合并家庭户「{src_name}」（{len(members)}人）入「{target.household_name}」",
        before={"source": src_before, "target": tgt_before},
        after={"merged_members": len(members), "target": tgt_after},
        event_date=now, date_accuracy="EXACT",
        operator=req.operator,
    )

    db.commit()

    # 合并后重算 target 面积缓存
    recalc_household_area_cache(target.id, db)

    return {
        "message": f"已合并，共迁移 {len(members)} 名成员",
        "merged_household_id": req.source_household_id,
        "target_household_id": req.target_household_id,
    }


# ─────────────────────────────────────
#  接口：人工确认家庭户信息
# ─────────────────────────────────────

@router.post("/{household_id}/manual-confirm")
def manual_confirm_household(
    household_id: int,
    req: HouseholdManualConfirm,
    db: Session = Depends(get_db)
):
    """
    人工确认家庭户信息：
    1. 更新家庭户的确认状态
    2. 记录 MANUAL_CONFIRM 事件并保存快照
    """
    from datetime import datetime, date as _date

    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    # 快照（确认前）
    before_snapshot = _snapshot_household(db, household_id)

    # 更新确认状态
    hh.is_manually_confirmed = 1
    hh.manually_confirmed_at = datetime.now()
    hh.manually_confirmed_by = req.operator

    # 快照（确认后）
    after_snapshot = _snapshot_household(db, household_id)

    # 记录事件
    today = _date.today()
    desc = "人工确认家庭户信息无误"
    if req.remark:
        desc += f"：{req.remark}"

    _log_event(
        db, household_id, "MANUAL_CONFIRM", today.year,
        description=desc,
        before=before_snapshot,
        after=after_snapshot,
        event_date=today,
        date_accuracy="EXACT",
        operator=req.operator,
    )

    db.commit()

    return {
        "message": "家庭户信息已确认",
        "household_id": household_id,
        "confirmed_at": hh.manually_confirmed_at.isoformat(),
        "confirmed_by": hh.manually_confirmed_by,
    }


@router.post("/{household_id}/cancel-confirm")
def cancel_manual_confirm(
    household_id: int,
    req: HouseholdManualConfirm,
    db: Session = Depends(get_db)
):
    """
    取消人工确认家庭户信息
    """
    from datetime import date as _date

    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    if not getattr(hh, "is_manually_confirmed", 0):
        raise HTTPException(400, "该家庭户尚未进行人工确认")

    # 快照（取消前）
    before_snapshot = _snapshot_household(db, household_id)

    # 更新确认状态
    hh.is_manually_confirmed = 0
    confirmed_at = hh.manually_confirmed_at
    confirmed_by = hh.manually_confirmed_by
    hh.manually_confirmed_at = None
    hh.manually_confirmed_by = None

    # 快照（取消后）
    after_snapshot = _snapshot_household(db, household_id)

    # 记录事件
    today = _date.today()
    desc = "取消人工确认"
    if req.remark:
        desc += f"：{req.remark}"

    _log_event(
        db, household_id, "REMARK", today.year,
        description=desc,
        before=before_snapshot,
        after=after_snapshot,
        event_date=today,
        date_accuracy="EXACT",
        operator=req.operator,
    )

    db.commit()

    return {
        "message": "已取消人工确认",
        "household_id": household_id,
        "previous_confirmed_at": confirmed_at.isoformat() if confirmed_at else None,
        "previous_confirmed_by": confirmed_by,
    }


@router.post("/batch-confirm")
def batch_confirm_households(
    req: HouseholdBatchConfirm,
    db: Session = Depends(get_db)
):
    """
    批量人工确认家庭户信息
    """
    from datetime import datetime, date as _date

    # 获取需要确认的家庭户ID列表（从请求体中）
    household_ids = req.household_ids if hasattr(req, 'household_ids') and req.household_ids else []
    if not household_ids:
        raise HTTPException(400, "未提供要确认的家庭户ID列表")

    results = []
    errors = []

    for household_id in household_ids:
        hh = db.get(FamilyHousehold, household_id)
        if not hh:
            errors.append({"household_id": household_id, "error": "家庭户不存在"})
            continue

        # 如果已经确认，跳过
        if getattr(hh, "is_manually_confirmed", 0) == 1:
            results.append({
                "household_id": household_id,
                "household_name": hh.household_name,
                "status": "skipped",
                "message": "已经确认过"
            })
            continue

        # 快照（确认前）
        before_snapshot = _snapshot_household(db, household_id)

        # 更新确认状态
        hh.is_manually_confirmed = 1
        hh.manually_confirmed_at = datetime.now()
        hh.manually_confirmed_by = req.operator

        # 快照（确认后）
        after_snapshot = _snapshot_household(db, household_id)

        # 记录事件
        today = _date.today()
        desc = "批量人工确认家庭户信息无误"
        if req.remark:
            desc += f"：{req.remark}"

        _log_event(
            db, household_id, "MANUAL_CONFIRM", today.year,
            description=desc,
            before=before_snapshot,
            after=after_snapshot,
            event_date=today,
            date_accuracy="EXACT",
            operator=req.operator,
        )

        results.append({
            "household_id": household_id,
            "household_name": hh.household_name,
            "status": "confirmed",
            "message": "确认成功"
        })

    db.commit()

    return {
        "message": f"批量确认完成：成功{len([r for r in results if r['status'] == 'confirmed'])}个，跳过{len([r for r in results if r['status'] == 'skipped'])}个",
        "total": len(household_ids),
        "confirmed": len([r for r in results if r['status'] == 'confirmed']),
        "skipped": len([r for r in results if r['status'] == 'skipped']),
        "errors": errors,
        "results": results,
    }


@router.delete("/{household_id}")
def delete_household(
    household_id: int,
    db: Session = Depends(get_db)
):
    """
    删除家庭户（含校验）：
    1. 检查是否存在补贴申请记录
    2. 检查是否存在土地流转记录
    3. 检查成员数量
    4. 如有重要数据则阻止删除
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    # 校验1：检查是否有成员
    member_count = db.query(func.count(FarmerProfile.id)).filter(
        FarmerProfile.household_id == household_id
    ).scalar() or 0

    # 校验2：检查是否有补贴申请记录
    from models import SubsidyApplication
    app_count = db.query(func.count(SubsidyApplication.id)).join(
        FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id
    ).filter(
        FarmerProfile.household_id == household_id
    ).scalar() or 0

    # 校验3：检查是否有土地流转记录（作为转出方或转入方）
    from models import LandTrust
    trust_out_count = db.query(func.count(LandTrust.id)).filter(
        LandTrust.owner_household_id == household_id
    ).scalar() or 0
    trust_in_count = db.query(func.count(LandTrust.id)).filter(
        LandTrust.operator_household_id == household_id
    ).scalar() or 0

    # 校验4：检查是否有家庭户变更事件
    from models import HouseholdEvent
    event_count = db.query(func.count(HouseholdEvent.id)).filter(
        HouseholdEvent.household_id == household_id
    ).scalar() or 0

    warnings = []
    if member_count > 0:
        warnings.append(f"该家庭户仍有 {member_count} 名成员未迁出")
    if app_count > 0:
        warnings.append(f"该家庭户已有 {app_count} 条补贴申请记录")
    if trust_out_count > 0:
        warnings.append(f"该家庭户已有 {trust_out_count} 条土地转出记录")
    if trust_in_count > 0:
        warnings.append(f"该家庭户已有 {trust_in_count} 条土地转入记录")
    if event_count > 0:
        warnings.append(f"该家庭户已有 {event_count} 条变更事件记录")

    if warnings:
        raise HTTPException(
            400,
            f"无法删除：该家庭户存在关联数据；{'; '.join(warnings)}。请先处理相关数据后再尝试删除。"
        )

    # 执行删除（硬删除）
    db.delete(hh)
    db.commit()

    return {
        "message": "家庭户已删除",
        "household_id": household_id,
    }


class HouseholdBatchConfirm(BaseModel):
    """批量确认家庭户请求"""
    household_ids: list[int]
    operator: Optional[str] = None


@router.post("/refresh-cache")
def refresh_area_cache(
    household_id: Optional[int] = Query(None, description="指定家庭户ID，不传则刷新所有"),
    db: Session = Depends(get_db)
):
    """
    强制刷新家庭户面积占用缓存。
    - 如果传了 household_id，只刷新该家庭户
    - 如果不传，刷新所有家庭户
    """
    if household_id:
        # 刷新单个家庭户
        hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
        if not hh:
            raise HTTPException(404, "家庭户不存在")
        recalc_household_area_cache(household_id, db)
        return {
            "message": f"已刷新家庭户 {hh.household_name} 的面积缓存",
            "household_id": household_id,
            "household_name": hh.household_name
        }
    else:
        # 刷新所有家庭户
        count = recalc_all_household_caches(db)
        return {
            "message": f"已刷新全部 {count} 个家庭户的面积缓存",
            "total": count
        }
    remark: Optional[str] = None
