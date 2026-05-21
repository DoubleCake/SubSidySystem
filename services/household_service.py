"""
家庭户管理-业务逻辑层

职责：
  - 家庭户 CRUD 的业务逻辑
  - 面积缓存计算与管理
  - 成员管理（添加、更新、移除、迁移）
  - 分户/合户操作
  - 变更事件记录与历史快照
  - 人工确认流程

路由层（routers/households.py）只负责 HTTP 编排，业务逻辑在此实现。
"""

import json as _json
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional
from collections import defaultdict

from sqlalchemy import func, text, or_, exists
from sqlalchemy.orm import Session

from core.exceptions import NotFound, BadRequest
from models import (
    FamilyHousehold, FarmerProfile, Village,
    SubsidyApplication, SubsidyType, SubsidyPayment,
    SubsidyProxy, HouseholdAreaUsageCache, HouseholdEvent, LandTrust,
)
from utils import (
    format_group_no, parse_group_no_to_int, parse_id_card,
    mask_id_card, mask_phone, mask_bank_card,
    gen_household_code, validate_id_card, check_name, check_phone,
)

SEASON_ORDER = ["大春", "小春", "耕地地力保护", "临时"]


# ════════════════════════════════════════════════════════
#  工具函数
# ════════════════════════════════════════════════════════

def get_or_create_village(db: Session, village_name: str) -> Village:
    """查找或创建 Village 记录"""
    village = db.query(Village).filter(Village.village_name == village_name).first()
    if not village:
        village = Village(village_name=village_name)
        db.add(village)
        db.flush()
    return village


def _member_out(m: FarmerProfile, db: Session) -> dict:
    """成员信息序列化（脱敏）"""
    head_id = db.query(FamilyHousehold.head_farmer_id).filter(
        FamilyHousehold.id == m.household_id
    ).scalar() if m.household_id else None

    own_village_name = None
    if m.own_village_id:
        own_village_name = db.query(Village.village_name).filter(Village.id == m.own_village_id).scalar()

    if own_village_name:
        eff_village = own_village_name
        eff_group = m.own_group_no or 1
    else:
        hh = db.get(FamilyHousehold, m.household_id) if m.household_id else None
        if hh:
            eff_village = db.query(Village.village_name).filter(Village.id == hh.village_id).scalar() or ""
            eff_group = hh.group_no or 1
        else:
            eff_village, eff_group = "", 1

    return {
        "id": m.id,
        "household_id": m.household_id,
        "real_name": m.real_name,
        "gender": m.gender,
        "id_card_masked": mask_id_card(m.id_card),
        "id_card": m.id_card,
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


# ════════════════════════════════════════════════════════
#  事件记录
# ════════════════════════════════════════════════════════

def log_event(
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
    """通用事件记录函数"""
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


def snapshot_household(db: Session, household_id: int) -> dict:
    """抓取当前家庭户完整状态快照"""
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
    member_ids = [m.id for m in members]

    # 补贴申请摘要
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

        proxy_app_ids = [r.app_id for r in rows if r.is_proxy == 1]
        proxy_map = {}
        if proxy_app_ids:
            proxy_rows = (
                db.query(
                    SubsidyProxy.application_id,
                    SubsidyProxy.beneficiary_farmer_id,
                    SubsidyProxy.proxy_farmer_id,
                    SubsidyProxy.remark,
                )
                .filter(SubsidyProxy.application_id.in_(proxy_app_ids))
                .all()
            )
            involved_ids = set()
            for pr in proxy_rows:
                involved_ids.add(pr.beneficiary_farmer_id)
                involved_ids.add(pr.proxy_farmer_id)
            farmer_names = {}
            if involved_ids:
                farmer_names = {f.id: f.real_name for f in db.query(FarmerProfile).filter(FarmerProfile.id.in_(involved_ids)).all()}
            for pr in proxy_rows:
                orig = next((r for r in rows if r.app_id == pr.application_id), None)
                if not orig:
                    continue
                if orig.farmer_id == pr.beneficiary_farmer_id:
                    proxy_map[pr.application_id] = {
                        "type": "受益",
                        "proxy_name": farmer_names.get(pr.proxy_farmer_id, "未知"),
                        "remark": pr.remark,
                    }
                elif orig.farmer_id == pr.proxy_farmer_id:
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
        "app_summary": subsidy_apps,
        "area_usage": area_info,
    }


# ════════════════════════════════════════════════════════
#  面积相关：按年份获取承包面积
# ════════════════════════════════════════════════════════

def get_contract_area_at_year(household_id: int, db: Session, year: int) -> float:
    """
    获取指定年份的承包面积，考虑 LAND_CHANGE 事件。
    - 同年度有变更 → 使用变更前的值
    - 之前有变更 → 使用变更后的值
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        return 0.0

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
        try:
            before = _json.loads(same_year_event.before_snapshot) if same_year_event.before_snapshot else {}
            if "contract_area" in before:
                return float(before["contract_area"])
            if "land_area" in before:
                return float(before["land_area"])
        except Exception:
            pass

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
        except Exception:
            pass

    return float(hh.contract_area or 0)


# ════════════════════════════════════════════════════════
#  面积缓存（单户 & 全量）
# ════════════════════════════════════════════════════════

def recalc_household_area_cache(household_id: int, db: Session) -> None:
    """重新计算指定家庭户的面积占用缓存（通过 beneficiary_id 关联）"""
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        return

    has_members = db.query(FarmerProfile.id).filter(
        FarmerProfile.household_id == household_id
    ).first() is not None
    if not has_members:
        db.query(HouseholdAreaUsageCache).filter(
            HouseholdAreaUsageCache.household_id == household_id
        ).delete()
        db.commit()
        return

    app_query = (
        db.query(
            SubsidyType.season,
            SubsidyApplication.apply_year,
            func.sum(SubsidyApplication.apply_area).label("total_area"),
        )
        .join(FarmerProfile, FarmerProfile.id == SubsidyApplication.beneficiary_id)
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(
            FarmerProfile.household_id == household_id,
            SubsidyType.count_toward_area == 1,
            SubsidyApplication.apply_area.isnot(None),
            SubsidyApplication.pay_status.in_([0, 1, 2]),
        )
        .group_by(SubsidyType.season, SubsidyApplication.apply_year)
        .all()
    )
    app_data: dict[tuple, float] = {}
    all_years = set()
    for r in app_query:
        season = r.season or "耕地地力保护"
        year = r.apply_year
        all_years.add(year)
        app_data[(year, season)] = float(r.total_area or 0)

    pay_query = (
        db.query(
            SubsidyType.season,
            SubsidyPayment.payment_year,
            func.sum(SubsidyPayment.apply_area).label("total_area"),
        )
        .join(FarmerProfile, FarmerProfile.id == SubsidyPayment.beneficiary_id)
        .join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
        .filter(
            FarmerProfile.household_id == household_id,
            SubsidyType.count_toward_area == 1,
            SubsidyPayment.apply_area.isnot(None),
        )
        .group_by(SubsidyType.season, SubsidyPayment.payment_year)
        .all()
    )
    pay_data: dict[tuple, float] = {}
    for r in pay_query:
        season = r.season or "耕地地力保护"
        year = r.payment_year
        all_years.add(year)
        pay_data[(year, season)] = float(r.total_area or 0)

    for year in all_years:
        for season in SEASON_ORDER:
            apply_area = app_data.get((year, season), 0.0)
            payment_area = pay_data.get((year, season), 0.0)
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
                db.add(HouseholdAreaUsageCache(
                    household_id=household_id, year=year, season=season,
                    apply_area=Decimal(str(apply_area)),
                    payment_area=Decimal(str(payment_area)),
                    used_area=Decimal(str(used_area)),
                ))

    db.commit()


def recalc_all_household_caches(db: Session) -> int:
    """重新计算所有家庭户的面积缓存（通过 beneficiary_id 关联），返回处理的数量"""
    all_household_ids = [
        row[0] for row in db.query(FarmerProfile.household_id)
        .filter(FarmerProfile.household_id.isnot(None))
        .distinct().all()
    ]

    if not all_household_ids:
        db.query(HouseholdAreaUsageCache).delete()
        db.commit()
        return 0

    app_data: dict[tuple[int, int, str], float] = {}
    app_query = (
        db.query(
            FarmerProfile.household_id,
            SubsidyApplication.apply_year,
            SubsidyType.season,
            func.sum(SubsidyApplication.apply_area).label("total_area"),
        )
        .join(FarmerProfile, FarmerProfile.id == SubsidyApplication.beneficiary_id)
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(
            FarmerProfile.household_id.isnot(None),
            SubsidyType.count_toward_area == 1,
            SubsidyApplication.apply_area.isnot(None),
            SubsidyApplication.pay_status.in_([0, 1, 2]),
        )
        .group_by(FarmerProfile.household_id, SubsidyApplication.apply_year, SubsidyType.season)
        .all()
    )
    for hid, year, season, area in app_query:
        s = season or "耕地地力保护"
        app_data[(hid, year, s)] = float(area or 0)

    pay_data: dict[tuple[int, int, str], float] = {}
    pay_query = (
        db.query(
            FarmerProfile.household_id,
            SubsidyPayment.payment_year,
            SubsidyType.season,
            func.sum(SubsidyPayment.apply_area).label("total_area"),
        )
        .join(FarmerProfile, FarmerProfile.id == SubsidyPayment.beneficiary_id)
        .join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
        .filter(
            FarmerProfile.household_id.isnot(None),
            SubsidyType.count_toward_area == 1,
            SubsidyPayment.apply_area.isnot(None),
        )
        .group_by(FarmerProfile.household_id, SubsidyPayment.payment_year, SubsidyType.season)
        .all()
    )
    for hid, year, season, area in pay_query:
        s = season or "耕地地力保护"
        pay_data[(hid, year, s)] = float(area or 0)

    all_combinations = set(app_data.keys()).union(set(pay_data.keys()))
    existing_cache_map: dict[tuple[int, int, str], HouseholdAreaUsageCache] = {}
    for cache in db.query(HouseholdAreaUsageCache).all():
        existing_cache_map[(cache.household_id, cache.year, cache.season)] = cache

    to_insert = []
    for hid, year, season in all_combinations:
        apply_area = app_data.get((hid, year, season), 0.0)
        payment_area = pay_data.get((hid, year, season), 0.0)
        used_area = payment_area if payment_area > 0 else apply_area

        key = (hid, year, season)
        if key in existing_cache_map:
            cache = existing_cache_map[key]
            cache.apply_area = Decimal(str(apply_area))
            cache.payment_area = Decimal(str(payment_area))
            cache.used_area = Decimal(str(used_area))
        else:
            to_insert.append(HouseholdAreaUsageCache(
                household_id=hid, year=year, season=season,
                apply_area=Decimal(str(apply_area)),
                payment_area=Decimal(str(payment_area)),
                used_area=Decimal(str(used_area)),
            ))

    used_keys = set(all_combinations)
    to_delete = [
        cache for cache in existing_cache_map.values()
        if (cache.household_id, cache.year, cache.season) not in used_keys
        and cache.household_id in all_household_ids
    ]

    for cache in to_delete:
        db.delete(cache)
    if to_insert:
        db.add_all(to_insert)

    db.commit()
    return len(all_household_ids)


# ════════════════════════════════════════════════════════
#  面积使用情况计算（从缓存读取）
# ════════════════════════════════════════════════════════

def calc_household_area_usage(
    household_id: int,
    db: Session,
    year: Optional[int] = None,
) -> dict:
    """计算家庭户的面积使用情况（含流转和历年数据）"""
    from datetime import date
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        return {}

    contracted = get_contract_area_at_year(household_id, db, year) if year else float(hh.contract_area or 0)

    # 无指定年份时，用当前年份查流转
    trust_year = year or date.today().year

    trust_out = 0.0
    trust_out_arable = 0.0
    trust_out_cash_crop = 0.0
    trust_in = 0.0
    trust_in_arable = 0.0
    trust_in_cash_crop = 0.0

    out_r = db.execute(text("""
        SELECT COALESCE(SUM(area),0) FROM land_trust
        WHERE owner_household_id=:hid AND trust_year=:yr AND is_active=1
          AND affect_subsidy_calc=1 AND trust_type!='IDLE'
          AND (operator_household_id IS NOT NULL
               OR (operator_type IN ('village','village_group') AND operator_entity_id IS NOT NULL))
    """), {"hid": household_id, "yr": trust_year}).scalar()
    trust_out = float(out_r or 0)

    out_arable_r = db.execute(text("""
        SELECT COALESCE(SUM(area),0) FROM land_trust
        WHERE owner_household_id=:hid AND trust_year=:yr AND is_active=1
          AND affect_subsidy_calc=1 AND trust_type!='IDLE'
          AND subsidy_arable=1
          AND (operator_household_id IS NOT NULL
               OR (operator_type IN ('village','village_group') AND operator_entity_id IS NOT NULL))
    """), {"hid": household_id, "yr": trust_year}).scalar()
    trust_out_arable = float(out_arable_r or 0)

    out_cash_r = db.execute(text("""
        SELECT COALESCE(SUM(area),0) FROM land_trust
        WHERE owner_household_id=:hid AND trust_year=:yr AND is_active=1
          AND affect_subsidy_calc=1 AND trust_type!='IDLE'
          AND subsidy_cash_crop=1
          AND (operator_household_id IS NOT NULL
               OR (operator_type IN ('village','village_group') AND operator_entity_id IS NOT NULL))
    """), {"hid": household_id, "yr": trust_year}).scalar()
    trust_out_cash_crop = float(out_cash_r or 0)

    in_r = db.execute(text("""
        SELECT COALESCE(SUM(area),0) FROM land_trust
        WHERE operator_household_id=:hid AND trust_year=:yr AND is_active=1
          AND affect_subsidy_calc=1
    """), {"hid": household_id, "yr": trust_year}).scalar()
    trust_in = float(in_r or 0)

    in_arable_r = db.execute(text("""
        SELECT COALESCE(SUM(area),0) FROM land_trust
        WHERE operator_household_id=:hid AND trust_year=:yr AND is_active=1
          AND affect_subsidy_calc=1 AND subsidy_arable=1
    """), {"hid": household_id, "yr": trust_year}).scalar()
    trust_in_arable = float(in_arable_r or 0)

    in_cash_r = db.execute(text("""
        SELECT COALESCE(SUM(area),0) FROM land_trust
        WHERE operator_household_id=:hid AND trust_year=:yr AND is_active=1
          AND affect_subsidy_calc=1 AND subsidy_cash_crop=1
    """), {"hid": household_id, "yr": trust_year}).scalar()
    trust_in_cash_crop = float(in_cash_r or 0)

    # 加载耕地地力保护补贴面积和不予补贴面积（优先 payment，回退 application）
    farmland_area = 0.0
    no_subsidy_area = 0.0
    farmland_st = db.query(SubsidyType).filter(
        SubsidyType.category == '耕地保护',
        SubsidyType.subsidy_year == trust_year,
        SubsidyType.season == '耕地地力保护',
    ).first()
    if farmland_st:
        pay_result = db.execute(text("""
            SELECT COALESCE(SUM(sp.apply_area), 0), COALESCE(SUM(sp.no_subsidy_area), 0)
            FROM subsidy_payment sp
            JOIN farmer_profile fp ON sp.farmer_id = fp.id
            WHERE sp.subsidy_type_id = :st_id
              AND sp.payment_year = :yr
              AND fp.household_id = :hid
        """), {"st_id": farmland_st.id, "yr": trust_year, "hid": household_id}).first()
        if pay_result and (pay_result[0] or 0) > 0:
            farmland_area = float(pay_result[0] or 0)
            no_subsidy_area = float(pay_result[1] or 0)
        else:
            app_result = db.execute(text("""
                SELECT COALESCE(SUM(sa.apply_area), 0), COALESCE(SUM(sa.no_subsidy_area), 0)
                FROM subsidy_application sa
                JOIN farmer_profile fp ON sa.farmer_id = fp.id
                WHERE sa.subsidy_type_id = :st_id
                  AND sa.apply_year = :yr
                  AND fp.household_id = :hid
            """), {"st_id": farmland_st.id, "yr": trust_year, "hid": household_id}).first()
            farmland_area = float(app_result[0] or 0)
            no_subsidy_area = float(app_result[1] or 0)

    # 每季节使用不同的参考上限
    #   大春/小春: 耕地保护面积基准 = farmland_area - trust_out_cash_crop + trust_in_cash_crop
    #   耕地地力保护/临时: 承包面积基准 = contracted - no_subsidy - trust_out_arable + trust_in_arable
    farmland_base = farmland_area if farmland_area > 0 else contracted
    contract_base = max(0.0, contracted - no_subsidy_area)
    season_reference: dict[str, float] = {}
    for s in SEASON_ORDER:
        if s in ("大春", "小春"):
            season_reference[s] = round(max(0.0, farmland_base - trust_out_cash_crop + trust_in_cash_crop), 2)
        else:
            season_reference[s] = round(max(0.0, contract_base - trust_out_arable + trust_in_arable), 2)
    cultivable = round(max(0.0, contracted - trust_out + trust_in), 2)

    cache_records = db.query(HouseholdAreaUsageCache).filter(
        HouseholdAreaUsageCache.household_id == household_id
    ).all()

    year_totals: dict[int, dict[str, float]] = {}
    year_apply_totals: dict[int, dict[str, float]] = {}
    year_payment_totals: dict[int, dict[str, float]] = {}

    for rec in cache_records:
        y = rec.year
        if y not in year_totals:
            year_totals[y] = {s: 0.0 for s in SEASON_ORDER}
            year_apply_totals[y] = {s: 0.0 for s in SEASON_ORDER}
            year_payment_totals[y] = {s: 0.0 for s in SEASON_ORDER}
        year_totals[y][rec.season] = year_totals[y].get(rec.season, 0.0) + float(rec.used_area)
        year_apply_totals[y][rec.season] = year_apply_totals[y].get(rec.season, 0.0) + float(rec.apply_area)
        year_payment_totals[y][rec.season] = year_payment_totals[y].get(rec.season, 0.0) + float(rec.payment_area)

    if year and year in year_totals:
        display_year = year
    elif year_totals:
        display_year = max(year_totals.keys())
    else:
        display_year = None

    season_breakdown: dict[str, dict] = {}
    # 不同季节不跨季累加，概览取单季最大值
    season_vals = list(year_totals.get(display_year, {}).values()) if display_year else []
    total_used = round(max(season_vals), 2) if season_vals else 0.0
    # 任一季节超该季参考上限即视为超领
    is_overdrawn_all = any(
        season_reference.get(s, 0) > 0 and round(year_totals[display_year].get(s, 0.0), 2) > season_reference.get(s, 0)
        for s in SEASON_ORDER
    ) if display_year else False

    for season in SEASON_ORDER:
        ref = season_reference.get(season, cultivable)
        used = round(year_totals.get(display_year, {}).get(season, 0.0) if display_year else 0.0, 2)
        apply_area = round(year_apply_totals.get(display_year, {}).get(season, 0.0) if display_year else 0.0, 2)
        payment_area = round(year_payment_totals.get(display_year, {}).get(season, 0.0) if display_year else 0.0, 2)
        is_season_overdrawn = ref > 0 and used > ref
        season_overdraw_amount = round(max(0, used - ref), 2) if is_season_overdrawn else 0.0
        season_breakdown[season] = {
            "used_area": used,
            "apply_area": apply_area,
            "payment_area": payment_area,
            "reference_area": ref,
            "remaining_area": max(0.0, ref - used),
            "is_overdrawn": is_season_overdrawn,
            "overdraw_amount": season_overdraw_amount,
            "subsidies": [],
        }

    return {
        "contracted_area": contracted,
        "trust_out_area": trust_out,
        "trust_out_arable_area": round(trust_out_arable, 2),
        "trust_out_cash_crop_area": round(trust_out_cash_crop, 2),
        "trust_in_area": trust_in,
        "trust_in_arable_area": round(trust_in_arable, 2),
        "trust_in_cash_crop_area": round(trust_in_cash_crop, 2),
        "farmland_area": round(farmland_area, 2),
        "no_subsidy_area": round(no_subsidy_area, 2),
        "cultivable_area": round(cultivable, 2),
        "season_reference": season_reference,
        "used_area": total_used,
        "remaining_area": round(max(0.0, cultivable - total_used), 2),
        "is_overdrawn": is_overdrawn_all,
        "overdraw_amount": round(max(0, total_used - cultivable), 2),
        "season_breakdown": season_breakdown,
        "year_totals": {
            str(y): {s: round(v, 2) for s, v in seasons.items()}
            for y, seasons in sorted(year_totals.items(), reverse=True)
        },
        "year_apply_totals": {
            str(y): {s: round(v, 2) for s, v in seasons.items()}
            for y, seasons in sorted(year_apply_totals.items(), reverse=True)
        },
        "year_payment_totals": {
            str(y): {s: round(v, 2) for s, v in seasons.items()}
            for y, seasons in sorted(year_payment_totals.items(), reverse=True)
        },
    }


# ════════════════════════════════════════════════════════
#  组选项
# ════════════════════════════════════════════════════════

def list_group_options(db: Session) -> list:
    """返回所有村+组的唯一组合"""
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


# ════════════════════════════════════════════════════════
#  家庭户列表
# ════════════════════════════════════════════════════════

def list_households(
    db: Session,
    village_name: Optional[str] = None,
    status: Optional[int] = 1,
    overdrawn_only: bool = False,
    confirmed_only: Optional[int] = None,
    search: Optional[str] = None,
    year: Optional[int] = None,
    min_app_count: Optional[int] = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """家庭户列表，含面积预警信息"""
    query = db.query(FamilyHousehold).outerjoin(Village, Village.id == FamilyHousehold.village_id)

    if village_name:
        query = query.filter(Village.village_name == village_name)
    if status is not None:
        query = query.filter(FamilyHousehold.status == status)
    if confirmed_only is not None:
        query = query.filter(FamilyHousehold.is_manually_confirmed == confirmed_only)
    if search:
        search = search.strip()
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

    if min_app_count is not None:
        hh_app_count_subq = db.query(
            FamilyHousehold.id.label("household_id"),
            func.count(SubsidyApplication.id).label("app_count")
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

    if overdrawn_only:
        if not year:
            year = db.query(func.max(SubsidyApplication.apply_year)).scalar() or 2024
        cache_summary = db.query(
            HouseholdAreaUsageCache.household_id,
            func.max(HouseholdAreaUsageCache.used_area).label("max_used")
        ).filter(
            HouseholdAreaUsageCache.year == year
        ).group_by(HouseholdAreaUsageCache.household_id).subquery()

        overdrawn_hh_ids = db.query(FamilyHousehold.id).join(
            cache_summary, cache_summary.c.household_id == FamilyHousehold.id
        ).filter(
            FamilyHousehold.contract_area.isnot(None),
            FamilyHousehold.contract_area > 0,
            cache_summary.c.max_used > FamilyHousehold.contract_area + 0.001
        ).all()
        overdrawn_hh_ids = [hid for (hid,) in overdrawn_hh_ids]

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

    household_ids = [hh.id for hh in all_households]
    head_ids = [hh.head_farmer_id for hh in all_households if hh.head_farmer_id]
    head_map = {}
    if head_ids:
        heads = db.query(FarmerProfile).filter(FarmerProfile.id.in_(head_ids)).all()
        head_map = {f.id: f for f in heads}

    member_counts = db.query(
        FarmerProfile.household_id, func.count(FarmerProfile.id).label("count")
    ).filter(FarmerProfile.household_id.in_(household_ids)).group_by(FarmerProfile.household_id).all()
    member_count_map = {hid: cnt for hid, cnt in [(mc.household_id, mc.count) for mc in member_counts]}

    items = []
    for hh in all_households:
        head = head_map.get(hh.head_farmer_id) if hh.head_farmer_id else None
        member_count = member_count_map.get(hh.id, 0)
        area_info = calc_household_area_usage(hh.id, db, year)

        items.append({
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
            "is_manually_confirmed": getattr(hh, "is_manually_confirmed", 0),
            "manually_confirmed_at": hh.manually_confirmed_at.isoformat() if hh.manually_confirmed_at else None,
            "manually_confirmed_by": hh.manually_confirmed_by,
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
        })

    return {"total": total, "page": page, "page_size": page_size, "items": items}


# ════════════════════════════════════════════════════════
#  超领预警列表
# ════════════════════════════════════════════════════════

def list_overdrawn_households(
    db: Session,
    year: Optional[int] = None,
    village_name: Optional[str] = None,
) -> dict:
    """列出所有已补贴面积 > 承包面积的家庭户"""
    if not year:
        latest = db.query(func.max(SubsidyApplication.apply_year)).scalar()
        year = latest or 2024

    query = db.query(FamilyHousehold).join(Village, Village.id == FamilyHousehold.village_id)
    if village_name:
        query = query.filter(Village.village_name == village_name)

    all_hh = query.filter(
        FamilyHousehold.contract_area.isnot(None),
        FamilyHousehold.contract_area > 0,
    ).all()

    if not all_hh:
        return {"year": year, "total": 0, "items": []}

    household_ids = [hh.id for hh in all_hh]
    head_ids = [hh.head_farmer_id for hh in all_hh if hh.head_farmer_id]
    head_map = {}
    if head_ids:
        for f in db.query(FarmerProfile).filter(FarmerProfile.id.in_(head_ids)).all():
            head_map[f.id] = f

    cache_records = db.query(HouseholdAreaUsageCache).filter(
        HouseholdAreaUsageCache.household_id.in_(household_ids)
    ).all()
    cache_map: dict[int, list] = {}
    for rec in cache_records:
        cache_map.setdefault(rec.household_id, []).append(rec)

    trust_results = db.execute(text("""
        SELECT owner_household_id, operator_household_id, COALESCE(SUM(area), 0) as area
        FROM land_trust
        WHERE trust_year = :yr AND is_active = 1 AND affect_subsidy_calc = 1
        GROUP BY owner_household_id, operator_household_id
    """), {"yr": year}).fetchall()

    trust_out_map: dict[int, float] = {}
    trust_in_map: dict[int, float] = {}
    for r in trust_results:
        out_id, in_id, area_val = r[0], r[1], float(r[2] or 0)
        trust_out_map[out_id] = trust_out_map.get(out_id, 0) + area_val
        trust_in_map[in_id] = trust_in_map.get(in_id, 0) + area_val

    overdrawn = []
    for hh in all_hh:
        contracted = float(hh.contract_area or 0)
        trust_out = trust_out_map.get(hh.id, 0)
        trust_in = trust_in_map.get(hh.id, 0)
        cultivable = round(max(0.0, contracted - trust_out), 2)

        cache_list = cache_map.get(hh.id, [])
        year_totals: dict[int, dict[str, float]] = {}
        for rec in cache_list:
            y = rec.year
            if y not in year_totals:
                year_totals[y] = {s: 0.0 for s in SEASON_ORDER}
            year_totals[y][rec.season] = year_totals[y].get(rec.season, 0.0) + float(rec.used_area)

        display_year = year if year in year_totals else (max(year_totals.keys()) if year_totals else None)

        season_overdrawn_list: list[bool] = []
        season_breakdown: dict[str, dict] = {}
        if display_year:
            for season in SEASON_ORDER:
                used = round(year_totals[display_year].get(season, 0.0), 2)
                season_od = cultivable > 0 and used > cultivable + 0.001
                season_overdrawn_list.append(season_od)
                overdraw_amt = round(max(0, used - cultivable), 2) if season_od else 0.0
                season_breakdown[season] = {
                    "used_area": used,
                    "is_overdrawn": season_od,
                    "overdraw_amount": overdraw_amt,
                }

        # 不同季节不跨季累加，任一季节超面积即超领
        season_vals = list(year_totals.get(display_year, {}).values()) if display_year else []
        total_used = round(max(season_vals), 2) if season_vals else 0.0
        is_overdrawn = cultivable > 0 and any(season_overdrawn_list)

        if is_overdrawn:
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

    overdrawn.sort(key=lambda x: -x["overdraw_amount"])
    return {"year": year, "total": len(overdrawn), "items": overdrawn}


# ════════════════════════════════════════════════════════
#  家庭户创建
# ════════════════════════════════════════════════════════

def create_household(db: Session, data: dict) -> dict:
    """创建新家庭户"""
    village_id = data.get("village_id")
    if not village_id:
        raise BadRequest("缺少 village_id")

    group_no = parse_group_no_to_int(data.get("group_no")) if data.get("group_no") else 1
    if not group_no:
        raise BadRequest("缺少 group_no")

    max_id = db.query(func.max(FamilyHousehold.id)).scalar() or 0
    code = gen_household_code(max_id + 1)

    hh = FamilyHousehold(
        household_code=code,
        household_name=data.get("household_name"),
        village_id=village_id,
        group_no=group_no,
        address=data.get("address"),
        contract_area=data.get("contract_area"),
        status=1,
        remark=data.get("remark"),
    )
    db.add(hh)
    db.flush()

    now = datetime.now()
    log_event(
        db, household_id=hh.id,
        event_type="FOUND", event_year=now.year,
        description=f"新建家庭户：{data.get('household_name', '')}",
        after=snapshot_household(db, hh.id),
        event_date=now.strftime("%Y-%m-%d"),
        date_accuracy="DAY",
    )
    db.commit()
    return {"id": hh.id}


# ════════════════════════════════════════════════════════
#  家庭户详情
# ════════════════════════════════════════════════════════

def get_household(db: Session, household_id: int, year: Optional[int] = None) -> dict:
    """家庭户详情（基础信息、成员、面积、补贴摘要）"""
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        raise NotFound("家庭户不存在")

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
            "id_card": m.id_card,
            "id_card_masked": m.id_card[:6] + "********" + m.id_card[-4:] if m.id_card else "",
            "is_head": 1 if hh.head_farmer_id == m.id else 0,
            "relation": m.relation,
            "farmer_status": m.farmer_status,
            "phone_masked": (m.phone[:3] + "****" + m.phone[-4:]) if m.phone and len(m.phone) >= 7 else m.phone,
        }
        for m in members
    ]

    area_info = calc_household_area_usage(household_id, db, year)
    app_summary = _get_household_app_summary(db, household_id)

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
        "is_manually_confirmed": getattr(hh, "is_manually_confirmed", 0),
        "manually_confirmed_at": hh.manually_confirmed_at.isoformat() if hh.manually_confirmed_at else None,
        "manually_confirmed_by": hh.manually_confirmed_by,
        "members": member_list,
        "area_usage": area_info,
        "app_summary": app_summary,
    }


def _get_household_app_summary(
    db: Session, household_id: int,
) -> list:
    """获取家庭户的补贴申请和发放记录摘要（通过 beneficiary_id 关联）"""
    app_summary = []

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
            SubsidyApplication.beneficiary_id,
            SubsidyApplication.id.label("record_id"),
        )
        .join(FarmerProfile, FarmerProfile.id == SubsidyApplication.beneficiary_id)
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(FarmerProfile.household_id == household_id)
        .order_by(SubsidyApplication.apply_year.desc())
        .all()
    )

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
            SubsidyPayment.beneficiary_id,
            SubsidyPayment.id.label("record_id"),
        )
        .join(FarmerProfile, FarmerProfile.id == SubsidyPayment.beneficiary_id)
        .join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
        .filter(FarmerProfile.household_id == household_id)
        .order_by(SubsidyPayment.payment_year.desc())
        .all()
    )

    all_rows = [("application", r) for r in app_rows] + [("payment", r) for r in pay_rows]

    # Collect all involved farmer IDs for name lookup
    all_involved_ids = set()
    for record_type, r in all_rows:
        all_involved_ids.add(r.farmer_id)
        if r.beneficiary_id:
            all_involved_ids.add(r.beneficiary_id)
    farmer_names = {}
    if all_involved_ids:
        farmer_names = {f.id: f.real_name for f in db.query(FarmerProfile).filter(FarmerProfile.id.in_(all_involved_ids)).all()}

    # Build proxy info: if is_proxy == 1 and farmer_id != beneficiary_id
    proxy_map = {}
    for record_type, r in all_rows:
        is_proxy = getattr(r, 'is_proxy', 0) or 0
        if is_proxy == 1 and r.beneficiary_id and r.beneficiary_id != r.farmer_id:
            key = (record_type, r.record_id)
            proxy_map[key] = {
                "type": "受益",
                "beneficiary_name": farmer_names.get(r.beneficiary_id, "未知"),
                "beneficiary_farmer_id": r.beneficiary_id,
                "proxy_name": farmer_names.get(r.farmer_id, "未知"),
                "proxy_farmer_id": r.farmer_id,
                "remark": "",
            }

    unique_map = {}
    for record_type, r in all_rows:
        key = (record_type, r.record_id)
        # 使用 beneficiary_id 去重，避免代领记录重复
        bid = r.beneficiary_id or r.farmer_id
        unique_key = (bid, r.subsidy_name, r.apply_year)
        if unique_key not in unique_map or record_type == "payment":
            unique_map[unique_key] = (record_type, r, key)

    for (record_type, r, key) in unique_map.values():
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

    app_summary.sort(key=lambda x: -x["apply_year"])
    return app_summary


# ════════════════════════════════════════════════════════
#  更新家庭户
# ════════════════════════════════════════════════════════

def update_household(db: Session, household_id: int, data: dict) -> dict:
    """更新家庭户信息，记录变更事件"""
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        raise NotFound("家庭户不存在")

    before = snapshot_household(db, household_id)

    village_changed = False
    old_village = f"{hh.village.village_name}{format_group_no(hh.group_no)}" if hh.village else "未知"
    new_village = old_village
    if data.get("village_id") is not None and data["village_id"] != hh.village_id:
        hh.village_id = data["village_id"]
        village_changed = True
    if data.get("group_no") is not None and data["group_no"] != hh.group_no:
        hh.group_no = data["group_no"]
        village_changed = True
    if village_changed:
        new_village = f"{hh.village.village_name}{format_group_no(hh.group_no)}" if hh.village else "未知"

    if data.get("household_name") is not None: hh.household_name = data["household_name"]
    if data.get("contract_area") is not None: hh.contract_area = Decimal(str(data["contract_area"]))
    if data.get("confirmed_area") is not None: hh.confirmed_area = Decimal(str(data["confirmed_area"]))
    if data.get("address") is not None: hh.address = data["address"]
    if data.get("status") is not None: hh.status = data["status"]
    if data.get("remark") is not None: hh.remark = data["remark"]

    after = snapshot_household(db, household_id)

    today = date.today()
    if village_changed:
        ev_type = "VILLAGE_CHANGE"
        desc = f"整户迁移：{old_village} → {new_village}"
        log_event(db, household_id, ev_type, today.year, desc,
                   before=before, after=after,
                   event_date=today, date_accuracy="EXACT")
    elif data.get("contract_area") is not None:
        ev_type = "LAND_CHANGE"
        desc = f"土地面积变更：{float(before.get('contract_area', 0))}亩 → {float(data['contract_area'] or 0)}亩"
        log_event(db, household_id, ev_type, today.year, desc,
                   before=before, after=after,
                   event_date=today, date_accuracy="EXACT")
    elif data.get("status") is not None:
        ev_type = "STATUS_CHANGE"
        desc = "更新家庭户信息"
        log_event(db, household_id, ev_type, today.year, desc,
                   before=before, after=after,
                   event_date=today, date_accuracy="EXACT")

    db.commit()
    return {"message": "更新成功"}


# ════════════════════════════════════════════════════════
#  成员管理
# ════════════════════════════════════════════════════════

def list_members(db: Session, household_id: int) -> list:
    """获取家庭户所有成员"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")
    members = (
        db.query(FarmerProfile)
          .filter(FarmerProfile.household_id == household_id)
          .order_by(
              (hh.head_farmer_id == FarmerProfile.id).desc(),
              FarmerProfile.id
          ).all()
    )
    return [_member_out(m, db) for m in members]


def add_member(db: Session, household_id: int, data: dict) -> dict:
    """向家庭户新增成员"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    before = snapshot_household(db, household_id)
    id_card_clean = data["id_card"].strip().upper()
    existing = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card_clean).first()

    if existing:
        if existing.household_id == household_id:
            raise BadRequest(f"「{existing.real_name}」已是本户成员")
        existing.household_id = household_id
        existing.relation = data.get("relation") or "成员"
        member = existing
    else:
        parsed = parse_id_card(id_card_clean)
        gender = data.get("gender") or (parsed.get("gender", 1) if parsed else 1)
        member = FarmerProfile(
            household_id=household_id,
            real_name=data["real_name"],
            gender=gender,
            id_card=id_card_clean,
            phone=data.get("phone"),
            bank_card=data.get("bank_card"),
            bank_name=data.get("bank_name"),
            relation=data.get("relation"),
            farmer_status=data.get("farmer_status", 1),
            remark=data.get("remark"),
        )
        db.add(member)

    if data.get("is_head") == 1:
        hh.head_farmer_id = member.id
    if hh.status == 3 and (data.get("farmer_status", 1)) == 1:
        hh.status = 1

    after = snapshot_household(db, household_id)
    today = date.today()
    log_event(db, household_id, "MEMBER_ADD", today.year,
               f"新增成员「{member.real_name}」",
               before=before, after=after,
               farmer_id=member.id, farmer_name=member.real_name,
               event_date=today, date_accuracy="EXACT")

    db.commit()
    db.refresh(member)
    recalc_household_area_cache(household_id, db)
    return {"message": "添加成功", "member": _member_out(member, db)}


def update_member(db: Session, household_id: int, farmer_id: int, data: dict) -> dict:
    """更新成员信息"""
    member = db.query(FarmerProfile).filter(
        FarmerProfile.id == farmer_id,
        FarmerProfile.household_id == household_id
    ).first()
    if not member:
        raise NotFound("成员不存在或不属于该家庭户")

    hh = db.get(FamilyHousehold, household_id)

    event_date_obj = date.today()
    date_accuracy = "EXACT"
    if data.get("event_date"):
        try:
            event_date_obj = date.fromisoformat(data["event_date"])
            date_accuracy = "DAY"
        except (ValueError, TypeError):
            pass

    before = snapshot_household(db, household_id)

    if data.get("is_head") == 1 and hh:
        hh.head_farmer_id = member.id

    old_status = member.farmer_status
    if data.get("farmer_status") == 4 and old_status != 4 and hh and hh.head_farmer_id == member.id:
        successor = db.query(FarmerProfile).filter(
            FarmerProfile.household_id == household_id,
            FarmerProfile.id != farmer_id,
            FarmerProfile.farmer_status == 1
        ).first()
        if successor:
            hh.head_farmer_id = successor.id
        else:
            hh.status = 3

    if data.get("real_name") is not None: member.real_name = data["real_name"]
    if data.get("phone") is not None: member.phone = data["phone"] or None
    if data.get("bank_card") is not None: member.bank_card = data["bank_card"] or None
    if data.get("bank_name") is not None: member.bank_name = data["bank_name"] or None
    if data.get("relation") is not None: member.relation = data["relation"]
    if data.get("farmer_status") is not None: member.farmer_status = data["farmer_status"]
    if data.get("remark") is not None: member.remark = data["remark"] or None
    if data.get("village_id") is not None:
        member.own_village_id = data["village_id"] if data["village_id"] != 0 else None
    if data.get("group_no") is not None:
        member.own_group_no = data["group_no"] if data["group_no"] != 0 else None

    after = snapshot_household(db, household_id)
    today = date.today()

    if data.get("farmer_status") is not None:
        status_map = {1: "在册", 2: "注销", 3: "迁出", 4: "死亡"}
        old_label = status_map.get(old_status, str(old_status))
        new_label = status_map.get(data["farmer_status"], str(data["farmer_status"]))
        desc = f"成员「{member.real_name}」状态变更：{old_label} → {new_label}"
    else:
        desc = f"更新成员「{member.real_name}」信息"

    log_event(db, household_id, "MEMBER_STATUS", today.year, desc,
               before=before, after=after,
               farmer_id=farmer_id, farmer_name=member.real_name,
               event_date=event_date_obj, date_accuracy=date_accuracy)

    db.commit()
    recalc_household_area_cache(household_id, db)
    return {"message": "更新成功", "member": _member_out(member, db)}


def remove_member(
    db: Session, household_id: int, farmer_id: int, action: str = "detach",
) -> dict:
    """从家庭户移除成员"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    member = db.query(FarmerProfile).filter(
        FarmerProfile.id == farmer_id,
        FarmerProfile.household_id == household_id
    ).first()
    if not member:
        raise NotFound("成员不存在")
    if hh.head_farmer_id == member.id:
        raise BadRequest("户主不能被移除，请先将其他成员设为户主后再操作")

    before = snapshot_household(db, household_id)
    fname = member.real_name

    if action == "delete":
        app_count = db.query(func.count(SubsidyApplication.id)).filter(
            SubsidyApplication.farmer_id == farmer_id
        ).scalar() or 0
        if app_count > 0:
            raise BadRequest(f"该成员有 {app_count} 条补贴记录，不能彻底删除，请使用「迁出」操作")
        db.delete(member)
        msg = "已彻底删除"
    else:
        member.farmer_status = 3
        msg = "已标记为迁出"

    remaining = db.query(FarmerProfile).filter(
        FarmerProfile.household_id == household_id,
        FarmerProfile.farmer_status == 1
    ).count()
    if remaining == 0 and hh.status == 1:
        hh.status = 3

    after = snapshot_household(db, household_id)
    today = date.today()
    log_event(db, household_id, "MEMBER_REMOVE", today.year,
               f"移出成员「{fname}」({msg})",
               before=before, after=after,
               farmer_id=farmer_id, farmer_name=fname,
               event_date=today, date_accuracy="EXACT")

    db.commit()
    recalc_household_area_cache(household_id, db)
    return {"message": msg}


def move_member(db: Session, farmer_id: int, target_household_id: int,
                relation: str = "成员", is_head: int = 0) -> dict:
    """将农户移入另一个家庭户"""
    farmer = db.query(FarmerProfile).filter(FarmerProfile.id == farmer_id).first()
    if not farmer:
        raise NotFound("农户不存在")

    target_hh = db.query(FamilyHousehold).filter(
        FamilyHousehold.id == target_household_id
    ).first()
    if not target_hh:
        raise NotFound("目标家庭户不存在")

    old_household_id = farmer.household_id
    old_before = snapshot_household(db, old_household_id)
    new_before = snapshot_household(db, target_household_id)

    if is_head == 1:
        old_head = db.get(FarmerProfile, target_hh.head_farmer_id) if target_hh.head_farmer_id else None
        if old_head:
            old_head.relation = "成员"

    farmer.household_id = target_household_id
    farmer.relation = relation

    if is_head == 1:
        target_hh.head_farmer_id = farmer.id

    today = date.today()
    if old_household_id != target_household_id:
        old_after = snapshot_household(db, old_household_id)
        log_event(db, old_household_id, "MEMBER_REMOVE", today.year,
                   f"移出成员「{farmer.real_name}」至「{target_hh.household_name}」",
                   before=old_before, after=old_after,
                   farmer_id=farmer.id, farmer_name=farmer.real_name,
                   related_hh_id=target_household_id,
                   event_date=today, date_accuracy="EXACT")

    new_after = snapshot_household(db, target_household_id)
    log_event(db, target_household_id, "MEMBER_ADD", today.year,
               f"新增成员「{farmer.real_name}」（从原户移入）",
               before=new_before, after=new_after,
               farmer_id=farmer.id, farmer_name=farmer.real_name,
               related_hh_id=old_household_id,
               event_date=today, date_accuracy="EXACT")

    db.commit()
    recalc_household_area_cache(old_household_id, db)
    if target_household_id != old_household_id:
        recalc_household_area_cache(target_household_id, db)
    return {"message": f"已将「{farmer.real_name}」移入「{target_hh.household_name}」"}


# ════════════════════════════════════════════════════════
#  批量组建家庭户
# ════════════════════════════════════════════════════════

def batch_build_households(db: Session, rows: list[dict]) -> dict:
    """按 Excel 模板批量组建家庭户"""
    built, updated = 0, 0
    errors = []
    format_errors = []
    seen_id_cards = {}

    valid_rows = []
    for i, row in enumerate(rows):
        row_errors = []
        id_card = (row.get("id_card") or "").strip().upper()
        real_name = (row.get("real_name") or "").strip()
        household_id = (row.get("household_id") or "").strip()

        if not household_id:
            row_errors.append("家庭户编号不能为空")
        if not id_card:
            row_errors.append("身份证号不能为空")
        else:
            id_ok, id_err = validate_id_card(id_card)
            if not id_ok:
                row_errors.append(f"身份证格式错误：{id_err}")
            elif id_card in seen_id_cards:
                row_errors.append(f"身份证号与第{seen_id_cards[id_card]}行重复")
            else:
                seen_id_cards[id_card] = i + 1

        if not real_name:
            row_errors.append("姓名不能为空")
        else:
            name_ok, name_err = check_name(real_name)
            if not name_ok:
                row_errors.append(f"姓名格式错误：{name_err}")

        if row.get("phone"):
            phone_ok, phone_err = check_phone(str(row["phone"]))
            if not phone_ok:
                row_errors.append(phone_err)

        if row.get("contract_area") is not None:
            try:
                area = float(row["contract_area"])
                if area < 0:
                    row_errors.append(f"土地面积不能为负数（{area}）")
                elif area > 9999:
                    row_errors.append(f"土地面积异常偏大（{area}亩），请核实")
            except (ValueError, TypeError):
                row_errors.append(f"土地面积格式错误（{row['contract_area']}）")

        if row_errors:
            format_errors.append({
                "row": i + 1, "household_id": household_id,
                "id_card": id_card, "real_name": real_name, "errors": row_errors,
            })
        else:
            valid_rows.append(row)

    groups = defaultdict(list)
    for row in valid_rows:
        groups[row["household_id"].strip()].append(row)

    for hh_label, members in groups.items():
        try:
            head_rows = [m for m in members if m.get("is_head") == 1]
            if not head_rows:
                errors.append(f"家庭户 {hh_label}：没有指定户主（is_head=1）")
                continue
            if len(head_rows) > 1:
                errors.append(f"家庭户 {hh_label}：指定了多个户主，只允许一个")
                continue

            head_row = head_rows[0]
            village_id = None
            group_no_int = None

            if head_row.get("village_name") or head_row.get("group_no"):
                if head_row.get("village_name"):
                    village = db.query(Village).filter(Village.village_name == head_row["village_name"].strip()).first()
                    if not village:
                        village = Village(village_name=head_row["village_name"].strip())
                        db.add(village)
                        db.flush()
                    village_id = village.id
                if head_row.get("group_no"):
                    group_no_int = parse_group_no_to_int(head_row["group_no"])

            if not village_id or not group_no_int:
                head_farmer = db.query(FarmerProfile).filter(
                    FarmerProfile.id_card == head_row["id_card"].strip().upper()
                ).first()
                if not head_farmer:
                    errors.append(f"家庭户 {hh_label}：户主身份证 {head_row['id_card']} 找不到对应农户")
                    continue
                if head_farmer.household_id:
                    hh = db.get(FamilyHousehold, head_farmer.household_id)
                    if hh:
                        if not village_id:
                            village_id = hh.village_id
                        if not group_no_int:
                            group_no_int = hh.group_no

            if not village_id:
                errors.append(f"家庭户 {hh_label}：无法确定村信息")
                continue
            if not group_no_int:
                errors.append(f"家庭户 {hh_label}：无法确定组信息")
                continue

            farmer_objs = []
            head_farmer_obj = None
            for m in members:
                ic = m["id_card"].strip().upper()
                fp = db.query(FarmerProfile).filter(FarmerProfile.id_card == ic).first()
                if not fp:
                    errors.append(f"{hh_label} - {m.get('real_name', ic)}：身份证找不到对应农户，跳过")
                    continue
                if m.get("phone") is not None:
                    fp.phone = m["phone"].strip() or None
                if m.get("bank_card") is not None:
                    fp.bank_card = m["bank_card"].strip() or None
                if m.get("bank_name") is not None:
                    fp.bank_name = m["bank_name"].strip() or None
                if m.get("farmer_status") is not None:
                    fp.farmer_status = m["farmer_status"]
                if m.get("gender") is not None:
                    fp.gender = m["gender"]
                if m.get("relation") is not None:
                    fp.relation = m["relation"]
                farmer_objs.append((fp, m))
                if m.get("is_head") == 1:
                    head_farmer_obj = fp

            if not head_farmer_obj or not farmer_objs:
                errors.append(f"家庭户 {hh_label}：没有找到有效成员，跳过")
                continue

            existing_hh = None
            if head_farmer_obj.household_id:
                existing_hh = db.get(FamilyHousehold, head_farmer_obj.household_id)

            if not existing_hh:
                existing_hh = FamilyHousehold(
                    household_code=gen_household_code(head_farmer_obj.id),
                    household_name=f"{head_farmer_obj.real_name}户",
                    head_farmer_id=head_farmer_obj.id,
                    village_id=village_id,
                    group_no=group_no_int,
                    address=head_row.get("address"),
                    contract_area=head_row.get("contract_area"),
                    status=1,
                )
                db.add(existing_hh)
                db.flush()
                built += 1
            else:
                if head_row.get("contract_area") is not None:
                    existing_hh.contract_area = head_row["contract_area"]
                existing_hh.head_farmer_id = head_farmer_obj.id
                if village_id:
                    existing_hh.village_id = village_id
                if group_no_int:
                    existing_hh.group_no = group_no_int
                if head_row.get("address"):
                    existing_hh.address = head_row["address"]
                updated += 1

            for fp, m in farmer_objs:
                fp.household_id = existing_hh.id
                fp.relation = m.get("relation") or ("本人" if m.get("is_head") == 1 else "成员")

            db.flush()
        except Exception as e:
            errors.append(f"家庭户 {hh_label}：处理失败 - {str(e)}")

    db.commit()
    return {
        "built": built, "updated": updated, "errors": errors,
        "total_groups": len(groups),
        "format_errors_count": len(format_errors),
        "format_errors": format_errors,
    }


# ════════════════════════════════════════════════════════
#  分户操作
# ════════════════════════════════════════════════════════

def split_household(db: Session, household_id: int, data: dict) -> dict:
    """分户操作：将指定成员从原家庭户分出"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    split_year = int(data.get("split_year", date.today().year))
    member_ids = data.get("member_ids", [])
    new_head_id = data.get("new_head_id")
    new_hh_name = (data.get("new_household_name") or "").strip()

    if not member_ids:
        raise BadRequest("请选择要分出的成员")
    if not new_hh_name:
        raise BadRequest("请填写新家庭户的名称")
    if not new_head_id or new_head_id not in member_ids:
        raise BadRequest("请从分出成员中指定新户主")

    members = db.query(FarmerProfile).filter(
        FarmerProfile.id.in_(member_ids),
        FarmerProfile.household_id == household_id
    ).all()
    if len(members) != len(member_ids):
        raise BadRequest("部分成员不属于该家庭户")

    total_members = db.query(func.count(FarmerProfile.id)).filter(
        FarmerProfile.household_id == household_id
    ).scalar() or 0
    if len(member_ids) >= total_members:
        raise BadRequest("不能将所有成员分出，原户至少保留1名成员")

    orig_head = db.get(FarmerProfile, hh.head_farmer_id) if hh.head_farmer_id else None
    if orig_head and orig_head.id in member_ids:
        raise BadRequest(f"原户户主「{orig_head.real_name}」不能被分出，请先在原户指定新户主")

    before_snap = {
        "household_name": hh.household_name,
        "contract_area": float(hh.contract_area or 0),
        "members": [{"id": m.id, "real_name": m.real_name, "is_head": 1 if hh.head_farmer_id == m.id else 0}
                    for m in db.query(FarmerProfile).filter(FarmerProfile.household_id == household_id).all()],
    }

    new_head = db.get(FarmerProfile, new_head_id)
    new_code = f"HH{int(datetime.now().timestamp()) % 100000:05d}"
    new_hh = FamilyHousehold(
        household_code=new_code,
        household_name=new_hh_name,
        head_farmer_id=new_head_id,
        village_id=hh.village_id,
        group_no=hh.group_no,
        address=hh.address,
        contract_area=Decimal(str(data["new_land_area"])) if data.get("new_land_area") else None,
        status=1,
        remark=f"由「{hh.household_name}」于{split_year}年分户组建",
    )
    db.add(new_hh)
    db.flush()

    for m in members:
        m.household_id = new_hh.id
        if m.id == new_head_id:
            m.relation = "本人"

    if data.get("origin_land_area") is not None:
        hh.contract_area = Decimal(str(data["origin_land_area"]))

    after_snap = {
        "original_hh": {
            "id": hh.id, "household_name": hh.household_name,
            "contract_area": float(hh.contract_area or 0),
        },
        "new_hh": {
            "id": new_hh.id, "household_name": new_hh.household_name,
            "household_code": new_code, "contract_area": float(new_hh.contract_area or 0),
            "head": new_head.real_name if new_head else None,
        },
    }

    ev_date_raw = data.get("split_date")
    ev_date = None
    if isinstance(ev_date_raw, str) and ev_date_raw:
        try:
            ev_date = date.fromisoformat(ev_date_raw)
        except ValueError:
            pass

    log_event(db, household_id, "SPLIT", split_year,
               description=data.get("description", f"分户：将{len(member_ids)}名成员分出，组建「{new_hh_name}」"),
               before=before_snap, after=after_snap,
               related_hh_id=new_hh.id, event_date=ev_date,
               date_accuracy="EXACT" if ev_date else "YEAR",
               evidence_type=data.get("evidence_type"), evidence_note=data.get("evidence_note"),
               operator=data.get("operator"))

    log_event(db, new_hh.id, "FOUND", split_year,
               description=f"由「{hh.household_name}」（id={household_id}）于{split_year}年分户组建",
               after=after_snap["new_hh"],
               related_hh_id=household_id, event_date=ev_date,
               date_accuracy="EXACT" if ev_date else "YEAR",
               operator=data.get("operator"))

    db.commit()
    return {
        "message": f"分户成功，新家庭户「{new_hh_name}」（{new_code}）已建立",
        "new_household_id": new_hh.id,
        "new_household_code": new_code,
    }


# ════════════════════════════════════════════════════════
#  合户操作
# ════════════════════════════════════════════════════════

def merge_households(db: Session, source_id: int, target_id: int, operator: Optional[str] = None) -> dict:
    """合并家庭户"""
    source = db.get(FamilyHousehold, source_id)
    target = db.get(FamilyHousehold, target_id)
    if not source:
        raise NotFound("被合并的家庭户不存在")
    if not target:
        raise NotFound("目标家庭户不存在")
    if source.id == target.id:
        raise BadRequest("不能合并到自身")

    now_date = date.today()
    src_before = snapshot_household(db, source.id)
    tgt_before = snapshot_household(db, target.id)

    members = db.query(FarmerProfile).filter(
        FarmerProfile.household_id == source.id
    ).all()
    for m in members:
        m.household_id = target.id

    db.query(LandTrust).filter(LandTrust.owner_household_id == source.id).update({"owner_household_id": target.id})
    db.query(LandTrust).filter(LandTrust.operator_household_id == source.id).update({"operator_household_id": target.id})
    db.query(HouseholdAreaUsageCache).filter(HouseholdAreaUsageCache.household_id == source.id).delete()
    db.query(HouseholdEvent).filter(HouseholdEvent.household_id == source.id).update({"household_id": target.id})

    db.flush()
    src_name = source.household_name
    db.delete(source)
    db.flush()

    tgt_after = snapshot_household(db, target.id)
    log_event(db, target.id, "MERGE", now_date.year,
               description=f"合并家庭户「{src_name}」（{len(members)}人）入「{target.household_name}」",
               before={"source": src_before, "target": tgt_before},
               after={"merged_members": len(members), "target": tgt_after},
               event_date=now_date, date_accuracy="EXACT", operator=operator)

    db.commit()
    recalc_household_area_cache(target.id, db)

    return {
        "message": f"已合并，共迁移 {len(members)} 名成员",
        "merged_household_id": source_id,
        "target_household_id": target_id,
    }


# ════════════════════════════════════════════════════════
#  人工确认
# ════════════════════════════════════════════════════════

def manual_confirm(db: Session, household_id: int, operator: str, remark: Optional[str] = None) -> dict:
    """人工确认家庭户信息"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    before_snapshot = snapshot_household(db, household_id)
    hh.is_manually_confirmed = 1
    hh.manually_confirmed_at = datetime.now()
    hh.manually_confirmed_by = operator
    after_snapshot = snapshot_household(db, household_id)

    today = date.today()
    desc = "人工确认家庭户信息无误"
    if remark:
        desc += f"：{remark}"

    log_event(db, household_id, "MANUAL_CONFIRM", today.year, description=desc,
               before=before_snapshot, after=after_snapshot,
               event_date=today, date_accuracy="EXACT", operator=operator)

    db.commit()
    return {
        "message": "家庭户信息已确认",
        "household_id": household_id,
        "confirmed_at": hh.manually_confirmed_at.isoformat(),
        "confirmed_by": hh.manually_confirmed_by,
    }


def cancel_confirm(db: Session, household_id: int, operator: str, remark: Optional[str] = None) -> dict:
    """取消人工确认"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")
    if not getattr(hh, "is_manually_confirmed", 0):
        raise BadRequest("该家庭户尚未进行人工确认")

    before_snapshot = snapshot_household(db, household_id)
    confirmed_at = hh.manually_confirmed_at
    confirmed_by = hh.manually_confirmed_by
    hh.is_manually_confirmed = 0
    hh.manually_confirmed_at = None
    hh.manually_confirmed_by = None
    after_snapshot = snapshot_household(db, household_id)

    today = date.today()
    desc = "取消人工确认"
    if remark:
        desc += f"：{remark}"

    log_event(db, household_id, "REMARK", today.year, description=desc,
               before=before_snapshot, after=after_snapshot,
               event_date=today, date_accuracy="EXACT", operator=operator)

    db.commit()
    return {
        "message": "已取消人工确认",
        "household_id": household_id,
        "previous_confirmed_at": confirmed_at.isoformat() if confirmed_at else None,
        "previous_confirmed_by": confirmed_by,
    }


def batch_confirm(db: Session, household_ids: list[int], operator: str, remark: Optional[str] = None) -> dict:
    """批量人工确认"""
    results = []
    errors = []

    for household_id in household_ids:
        hh = db.get(FamilyHousehold, household_id)
        if not hh:
            errors.append({"household_id": household_id, "error": "家庭户不存在"})
            continue
        if getattr(hh, "is_manually_confirmed", 0) == 1:
            results.append({"household_id": household_id, "household_name": hh.household_name, "status": "skipped", "message": "已经确认过"})
            continue

        before_snapshot = snapshot_household(db, household_id)
        hh.is_manually_confirmed = 1
        hh.manually_confirmed_at = datetime.now()
        hh.manually_confirmed_by = operator
        after_snapshot = snapshot_household(db, household_id)

        today = date.today()
        desc = "批量人工确认家庭户信息无误"
        if remark:
            desc += f"：{remark}"

        log_event(db, household_id, "MANUAL_CONFIRM", today.year, description=desc,
                   before=before_snapshot, after=after_snapshot,
                   event_date=today, date_accuracy="EXACT", operator=operator)

        results.append({"household_id": household_id, "household_name": hh.household_name, "status": "confirmed", "message": "确认成功"})

    db.commit()
    confirmed = len([r for r in results if r["status"] == "confirmed"])
    skipped = len([r for r in results if r["status"] == "skipped"])
    return {
        "message": f"批量确认完成：成功{confirmed}个，跳过{skipped}个",
        "total": len(household_ids),
        "confirmed": confirmed,
        "skipped": skipped,
        "errors": errors,
        "results": results,
    }


# ════════════════════════════════════════════════════════
#  删除家庭户
# ════════════════════════════════════════════════════════

def delete_household(db: Session, household_id: int) -> dict:
    """删除家庭户（含校验）"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    member_count = db.query(func.count(FarmerProfile.id)).filter(
        FarmerProfile.household_id == household_id
    ).scalar() or 0

    app_count = db.query(func.count(SubsidyApplication.id)).join(
        FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id
    ).filter(FarmerProfile.household_id == household_id).scalar() or 0

    trust_out_count = db.query(func.count(LandTrust.id)).filter(
        LandTrust.owner_household_id == household_id
    ).scalar() or 0
    trust_in_count = db.query(func.count(LandTrust.id)).filter(
        LandTrust.operator_household_id == household_id
    ).scalar() or 0

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
        raise BadRequest(f"无法删除：该家庭户存在关联数据；{'；'.join(warnings)}。请先处理相关数据后再尝试删除。")

    db.delete(hh)
    db.commit()
    return {"message": "家庭户已删除", "household_id": household_id}


# ════════════════════════════════════════════════════════
#  批量导入成员（Excel）
# ════════════════════════════════════════════════════════

def batch_import_members(db: Session, household_id: int, rows: list[dict],
                          year: Optional[int] = None, operator: str = "批量导入") -> dict:
    """批量导入/更新成员"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    year = year or date.today().year
    created, updated, errors = 0, 0, []

    for i, row in enumerate(rows):
        id_card = str(row.get("id_card", "")).strip().upper()
        name = str(row.get("real_name", "")).strip()
        if not id_card:
            errors.append(f"第{i+2}行：缺少身份证号")
            continue
        if not name:
            errors.append(f"第{i+2}行：缺少姓名")
            continue

        existing = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
        is_head_val = 1 if str(row.get("is_head", "0")) in ("1", "是", "户主", "true") else 0

        if existing:
            before = {"household_id": existing.household_id, "real_name": existing.real_name}
            if existing.household_id != household_id:
                existing.household_id = household_id
            if row.get("relation"):
                existing.relation = str(row["relation"])
            if row.get("phone"):
                existing.phone = str(row["phone"]).strip() or None
            if row.get("bank_card"):
                existing.bank_card = str(row["bank_card"]).strip() or None
            if row.get("bank_name"):
                existing.bank_name = str(row["bank_name"]).strip() or None
            status_map = {"在册": 1, "正常": 1, "注销": 2, "迁出": 3, "死亡": 4}
            if row.get("farmer_status"):
                sv = row["farmer_status"]
                existing.farmer_status = status_map.get(str(sv), int(sv) if str(sv).isdigit() else 1)
            after = {"household_id": household_id, "is_head": is_head_val}
            log_event(db, household_id, "MEMBER_ADD", year,
                       f"批量导入更新成员：{name}",
                       before=before, after=after, farmer_id=existing.id, farmer_name=name, operator=operator)
            updated += 1
        else:
            parsed = parse_id_card(id_card) or {}
            fp = FarmerProfile(
                household_id=household_id,
                real_name=name,
                gender=parsed.get("gender", 1 if str(row.get("gender", "男")) == "男" else 2),
                id_card=id_card,
                phone=str(row.get("phone", "")).strip() or None,
                bank_card=str(row.get("bank_card", "")).strip() or None,
                bank_name=str(row.get("bank_name", "")).strip() or None,
                relation=str(row.get("relation", "成员")).strip() or "成员",
                farmer_status=1,
            )
            db.add(fp)
            db.flush()
            log_event(db, household_id, "MEMBER_ADD", year,
                       f"批量导入新增成员：{name}",
                       after={"id_card": id_card, "is_head": is_head_val}, farmer_id=fp.id, farmer_name=name, operator=operator)
            created += 1

    if any(str(r.get("is_head", "0")) in ("1", "是", "户主", "true") for r in rows):
        head_row = next(r for r in rows if str(r.get("is_head", "0")) in ("1", "是", "户主", "true"))
        head_fp = db.query(FarmerProfile).filter(
            FarmerProfile.id_card == str(head_row.get("id_card", "")).strip().upper()
        ).first()
        if head_fp:
            hh.head_farmer_id = head_fp.id

    db.flush()
    db.commit()
    recalc_household_area_cache(household_id, db)
    return {"created": created, "updated": updated, "errors": errors}


# ════════════════════════════════════════════════════════
#  确权面积导入 & 导出
# ════════════════════════════════════════════════════════

def import_confirmed_area(db: Session, rows: list[dict]) -> dict:
    """批量导入确权面积"""
    results = {"success": 0, "not_found": [], "mismatch_name": [], "errors": []}
    for row in rows:
        id_card = row["id_card"].strip()
        real_name = row["real_name"].strip()
        farmer = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
        if not farmer:
            results["not_found"].append({"id_card": mask_id_card(id_card), "real_name": real_name})
            continue
        if farmer.real_name != real_name:
            results["mismatch_name"].append({
                "id_card": mask_id_card(id_card),
                "input_name": real_name,
                "db_name": farmer.real_name,
            })
            continue
        hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == farmer.household_id).first()
        if not hh:
            results["errors"].append({"id_card": mask_id_card(id_card), "reason": "农户无关联家庭户"})
            continue
        hh.confirmed_area = Decimal(str(row["confirmed_area"]))
        results["success"] += 1

    db.commit()
    return results


def export_confirmed_area_diff_data(db: Session) -> list[dict]:
    """获取确权面积与承包面积对比数据"""
    from utils import check_confirmed_vs_contract
    rows_q = db.execute(text("""
        SELECT hh.id, hh.household_name, hh.contract_area, hh.confirmed_area,
               hh.group_no, v.village_name,
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
    return data


# ════════════════════════════════════════════════════════
#  事件 & 历史查询
# ════════════════════════════════════════════════════════

def list_events(db: Session, household_id: int, page: int = 1, page_size: int = 50) -> dict:
    """查询家庭户的所有变更事件"""
    total = db.query(func.count(HouseholdEvent.id)).filter(
        HouseholdEvent.household_id == household_id
    ).scalar() or 0

    rows = (
        db.query(HouseholdEvent)
          .filter(HouseholdEvent.household_id == household_id)
          .order_by(HouseholdEvent.event_year.desc(), HouseholdEvent.created_at.desc())
          .offset((page - 1) * page_size).limit(page_size).all()
    )

    def _ev_out(e):
        return {
            "id": e.id, "event_type": e.event_type,
            "event_year": e.event_year, "event_date": str(e.event_date) if e.event_date else None,
            "date_accuracy": e.date_accuracy,
            "description": e.description,
            "farmer_id": e.farmer_id, "farmer_name": e.farmer_name,
            "related_hh_id": e.related_hh_id,
            "before_snapshot": _json.loads(e.before_snapshot) if e.before_snapshot else None,
            "after_snapshot": _json.loads(e.after_snapshot) if e.after_snapshot else None,
            "evidence_type": e.evidence_type, "evidence_note": e.evidence_note,
            "operator": e.operator,
            "created_at": str(e.created_at),
            "undoable": True,
        }

    return {"total": total, "items": [_ev_out(r) for r in rows]}


def add_event(db: Session, household_id: int, data: dict) -> dict:
    """手动添加一条事件记录（补录历史用）"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    ev_date = data.get("event_date")
    if isinstance(ev_date, str) and ev_date:
        try:
            ev_date = date.fromisoformat(ev_date)
        except ValueError:
            ev_date = None

    log_event(
        db, household_id,
        event_type=data.get("event_type", "REMARK"),
        event_year=int(data.get("event_year", date.today().year)),
        description=data.get("description", ""),
        event_date=ev_date,
        date_accuracy=data.get("date_accuracy", "YEAR"),
        evidence_type=data.get("evidence_type"),
        evidence_note=data.get("evidence_note"),
        operator=data.get("operator"),
    )
    db.commit()
    return {"message": "事件记录已添加"}


def undo_event(db: Session, household_id: int, event_id: int) -> dict:
    """撤销一次操作"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    ev = db.query(HouseholdEvent).filter(
        HouseholdEvent.id == event_id,
        HouseholdEvent.household_id == household_id
    ).first()
    if not ev:
        raise NotFound("事件不存在")

    UNSUPPORTED = ("SPLIT", "MERGE", "FOUND")
    if ev.event_type in UNSUPPORTED:
        raise BadRequest(f"事件类型「{ev.event_type}」不支持撤销")

    before = _json.loads(ev.before_snapshot) if ev.before_snapshot else None
    after = _json.loads(ev.after_snapshot) if ev.after_snapshot else None

    if ev.event_type == "MEMBER_ADD":
        if after and after.get("members"):
            before_ids = set(m["id"] for m in (before.get("members") if before else []))
            after_ids = set(m["id"] for m in after.get("members", []))
            new_ids = after_ids - before_ids
            for mid in new_ids:
                fp = db.get(FarmerProfile, mid)
                if fp and fp.household_id == household_id:
                    db.delete(fp)
        if before and before.get("head_id"):
            hh.head_farmer_id = before["head_id"]

    elif ev.event_type == "MEMBER_REMOVE":
        if ev.farmer_id:
            fp = db.get(FarmerProfile, ev.farmer_id)
            if fp and before:
                m_before = next((m for m in before.get("members", []) if m["id"] == ev.farmer_id), None)
                if m_before:
                    fp.household_id = household_id
                    fp.farmer_status = m_before.get("farmer_status", 1)
                    fp.relation = m_before.get("relation", "成员")

    elif ev.event_type == "HEAD_CHANGE":
        if before and before.get("head_id"):
            hh.head_farmer_id = before["head_id"]

    elif ev.event_type == "MEMBER_STATUS":
        if ev.farmer_id and before:
            fp = db.get(FarmerProfile, ev.farmer_id)
            if fp:
                m_before = next((m for m in before.get("members", []) if m["id"] == ev.farmer_id), None)
                if m_before:
                    fp.farmer_status = m_before.get("farmer_status", 1)

    elif ev.event_type == "LAND_CHANGE":
        if before and "contract_area" in before:
            hh.contract_area = Decimal(str(before["contract_area"]))

    elif ev.event_type == "STATUS_CHANGE":
        if before:
            if "status" in before:
                hh.status = before["status"]
            if "household_name" in before:
                hh.household_name = before["household_name"]
            if "address" in before:
                hh.address = before["address"]

    elif ev.event_type == "REMARK":
        pass

    db.delete(ev)
    db.commit()
    return {"message": "已撤销"}


def get_history_dates(db: Session, household_id: int) -> dict:
    """返回事件日期列表"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

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

    if rows:
        earliest = rows[-1]
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


def get_history_years(db: Session, household_id: int) -> list:
    """返回该家庭户有事件记录的所有年份"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    years = (
        db.query(HouseholdEvent.event_year)
          .filter(HouseholdEvent.household_id == household_id)
          .distinct()
          .order_by(HouseholdEvent.event_year.desc())
          .all()
    )
    return [r[0] for r in years]


def get_history_snapshot(db: Session, household_id: int, year: int) -> dict:
    """获取指定年度的家庭状态快照"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    all_events = (
        db.query(HouseholdEvent)
          .filter(HouseholdEvent.household_id == household_id)
          .order_by(HouseholdEvent.event_year.desc(), HouseholdEvent.created_at.desc())
          .all()
    )

    current_members = (
        db.query(FarmerProfile)
          .filter(FarmerProfile.household_id == household_id)
          .order_by((hh.head_farmer_id == FarmerProfile.id).desc(), FarmerProfile.id)
          .all()
    )

    events_after = [e for e in all_events if e.event_year > year]
    events_in_year = [e for e in all_events if e.event_year == year]
    events_before = [e for e in all_events if e.event_year <= year]

    member_ids_set = set(m.id for m in current_members)
    removed_member_ids = set()
    added_member_ids = set()

    for ev in events_after:
        if ev.event_type == "MEMBER_ADD" and ev.farmer_id:
            added_member_ids.add(ev.farmer_id)
        elif ev.event_type == "MEMBER_REMOVE" and ev.farmer_id:
            removed_member_ids.add(ev.farmer_id)
        elif ev.event_type == "SPLIT":
            try:
                after_snap = _json.loads(ev.after_snapshot) if ev.after_snapshot else {}
                before_snap = _json.loads(ev.before_snapshot) if ev.before_snapshot else {}
                if "members" in before_snap:
                    for bm in before_snap["members"]:
                        bm_id = bm.get("id")
                        if bm_id and bm_id not in member_ids_set:
                            removed_member_ids.add(bm_id)
            except Exception:
                pass
        elif ev.event_type == "MERGE":
            try:
                after_snap = _json.loads(ev.after_snapshot) if ev.after_snapshot else {}
                if "added_members" in after_snap:
                    for mid in after_snap["added_members"]:
                        added_member_ids.add(mid)
            except Exception:
                pass

    snapshot_members = []
    for m in current_members:
        if m.id in added_member_ids:
            continue
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

    for ev in events_after:
        if ev.event_type in ("MEMBER_REMOVE", "MEMBER_STATUS") and ev.farmer_id in removed_member_ids:
            try:
                before_snap = _json.loads(ev.before_snapshot) if ev.before_snapshot else None
                if before_snap and isinstance(before_snap, dict):
                    snapshot_members.append({
                        "id": ev.farmer_id,
                        "real_name": before_snap.get("real_name") or ev.farmer_name or "未知",
                        "gender": before_snap.get("gender", 1),
                        "id_card_masked": before_snap.get("id_card_masked", ""),
                        "is_head": before_snap.get("is_head", 0),
                        "relation": before_snap.get("relation", "成员"),
                        "farmer_status": 1,
                        "phone_masked": before_snap.get("phone_masked"),
                    })
                else:
                    snapshot_members.append({
                        "id": ev.farmer_id, "real_name": ev.farmer_name or "未知",
                        "gender": 1, "id_card_masked": "", "is_head": 0,
                        "relation": "成员", "farmer_status": 1, "phone_masked": None,
                    })
            except Exception:
                pass

    for ev in events_after:
        if ev.event_type == "SPLIT":
            try:
                before_snap = _json.loads(ev.before_snapshot) if ev.before_snapshot else {}
                if "members" in before_snap:
                    existing_ids = set(m["id"] for m in snapshot_members)
                    for bm in before_snap["members"]:
                        if bm.get("id") and bm["id"] not in existing_ids:
                            snapshot_members.append({
                                "id": bm["id"], "real_name": bm.get("real_name", "未知"),
                                "gender": bm.get("gender", 1), "id_card_masked": bm.get("id_card_masked", ""),
                                "is_head": bm.get("is_head", 0), "relation": bm.get("relation", "成员"),
                                "farmer_status": bm.get("farmer_status", 1), "phone_masked": bm.get("phone_masked"),
                            })
            except Exception:
                pass

    snapshot_members.sort(key=lambda x: (-x.get("is_head", 0), x.get("id", 0)))

    contracted_area = float(hh.contract_area or 0)
    for ev in all_events:
        if ev.event_type == "LAND_CHANGE" and ev.event_year > year:
            try:
                before_snap = _json.loads(ev.before_snapshot) if ev.before_snapshot else {}
                if "contract_area" in before_snap:
                    contracted_area = float(before_snap["contract_area"])
                    break
            except Exception:
                pass
        elif ev.event_type == "SPLIT" and ev.event_year > year:
            try:
                before_snap = _json.loads(ev.before_snapshot) if ev.before_snapshot else {}
                if "contract_area" in before_snap:
                    contracted_area = float(before_snap["contract_area"])
                    break
            except Exception:
                pass

    area_info = calc_household_area_usage(household_id, db, year)
    year_events = [
        {
            "id": e.id, "event_type": e.event_type,
            "event_year": e.event_year,
            "event_date": str(e.event_date) if e.event_date else None,
            "description": e.description,
            "farmer_name": e.farmer_name,
        }
        for e in events_in_year
    ]

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


def get_snapshot_at_date(db: Session, household_id: int, target_date_str: str) -> dict:
    """返回指定日期的家庭状态快照"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    target = date.fromisoformat(target_date_str)

    latest_ev = (
        db.query(HouseholdEvent)
          .filter(
              HouseholdEvent.household_id == household_id,
              HouseholdEvent.event_date <= target
          )
          .order_by(HouseholdEvent.event_date.desc(), HouseholdEvent.created_at.desc())
          .first()
    )

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
                    "target_date": target_date_str,
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
            except Exception:
                pass

    latest_ev = (
        db.query(HouseholdEvent)
          .filter(
              HouseholdEvent.household_id == household_id,
              (HouseholdEvent.event_date <= target) | (HouseholdEvent.event_date == None)
          )
          .order_by(HouseholdEvent.event_date.desc().nullslast(), HouseholdEvent.created_at.desc())
          .first()
    )

    snapshot_data = None
    if latest_ev:
        if latest_ev.event_date and target >= latest_ev.event_date:
            if latest_ev.after_snapshot:
                try:
                    snapshot_data = _json.loads(latest_ev.after_snapshot)
                except Exception:
                    pass
        else:
            if latest_ev.before_snapshot:
                try:
                    snapshot_data = _json.loads(latest_ev.before_snapshot)
                except Exception:
                    pass

    if snapshot_data:
        household_name = snapshot_data.get("household_name", hh.household_name)
        household_code = snapshot_data.get("household_code", hh.household_code)
        contracted_area = snapshot_data.get("contract_area", float(hh.contract_area or 0))
        status = snapshot_data.get("status", hh.status)
        address = snapshot_data.get("address", hh.address)
        remark = snapshot_data.get("remark", hh.remark)
        head_id = snapshot_data.get("head_id")
        members = snapshot_data.get("members", [])
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
              .order_by((hh.head_farmer_id == FarmerProfile.id).desc(), FarmerProfile.id).all()
        )
        members = [_member_out(m, db) for m in members_q]
        app_summary = []
        area_usage = {}

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
        {"id": e.id, "event_type": e.event_type,
         "event_date": str(e.event_date) if e.event_date else None,
         "description": e.description, "farmer_name": e.farmer_name}
        for e in day_events
    ]

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


def get_snapshot_by_event(db: Session, household_id: int, event_id: int) -> dict:
    """返回指定事件对应的家庭状态快照"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    if event_id == -1:
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
            except Exception:
                pass

        if snapshot_data:
            hh_name = snapshot_data.get("household_name", hh.household_name)
            hh_code = snapshot_data.get("household_code", hh.household_code)
            ca = snapshot_data.get("contract_area", float(hh.contract_area or 0))
            st = snapshot_data.get("status", hh.status)
            addr = snapshot_data.get("address", hh.address)
            rmk = snapshot_data.get("remark", hh.remark)
            head_id = snapshot_data.get("head_id")
            members = snapshot_data.get("members", [])
            app_summary = snapshot_data.get("app_summary", [])
            area_usage = snapshot_data.get("area_usage", {})
        else:
            hh_name = hh.household_name
            hh_code = hh.household_code
            ca = float(hh.contract_area or 0)
            st = hh.status
            addr = hh.address
            rmk = hh.remark
            head_id = None
            members_q = (
                db.query(FarmerProfile)
                  .filter(FarmerProfile.household_id == household_id)
                  .order_by((hh.head_farmer_id == FarmerProfile.id).desc(), FarmerProfile.id).all()
            )
            members = [_member_out(m, db) for m in members_q]
            app_summary = []
            area_usage = {}

        return {
            "target_date": target_date_str,
            "snapshot": {
                "household_name": hh_name, "household_code": hh_code,
                "contract_area": ca, "status": st, "address": addr,
                "remark": rmk, "head_id": head_id, "members": members,
                "app_summary": app_summary, "area_usage": area_usage,
            },
            "events": [{"id": -1, "event_type": "ORIGINAL", "event_date": target_date_str,
                        "description": "原始数据（首次记录前的状态）", "farmer_name": None}],
        }

    ev = db.get(HouseholdEvent, event_id)
    if not ev or ev.household_id != household_id:
        raise NotFound("事件不存在")

    snapshot_data = None
    target_date_str = str(ev.event_date) if ev.event_date else None

    if ev.after_snapshot:
        try:
            snapshot_data = _json.loads(ev.after_snapshot)
        except Exception:
            pass
    if not snapshot_data and ev.before_snapshot:
        try:
            snapshot_data = _json.loads(ev.before_snapshot)
        except Exception:
            pass

    if snapshot_data:
        hh_name = snapshot_data.get("household_name", hh.household_name)
        hh_code = snapshot_data.get("household_code", hh.household_code)
        ca = snapshot_data.get("contract_area", float(hh.contract_area or 0))
        st = snapshot_data.get("status", hh.status)
        addr = snapshot_data.get("address", hh.address)
        rmk = snapshot_data.get("remark", hh.remark)
        head_id = snapshot_data.get("head_id")
        members = snapshot_data.get("members", [])
        app_summary = snapshot_data.get("app_summary", [])
        area_usage = snapshot_data.get("area_usage", {})
    else:
        hh_name = hh.household_name
        hh_code = hh.household_code
        ca = float(hh.contract_area or 0)
        st = hh.status
        addr = hh.address
        rmk = hh.remark
        head_id = None
        members_q = (
            db.query(FarmerProfile)
              .filter(FarmerProfile.household_id == household_id)
              .order_by((hh.head_farmer_id == FarmerProfile.id).desc(), FarmerProfile.id).all()
        )
        members = [_member_out(m, db) for m in members_q]
        app_summary = []
        area_usage = {}

    return {
        "target_date": target_date_str,
        "snapshot": {
            "household_name": hh_name, "household_code": hh_code,
            "contract_area": ca, "status": st, "address": addr,
            "remark": rmk, "head_id": head_id, "members": members,
        },
        "events": [{
            "id": ev.id, "event_type": ev.event_type,
            "event_date": str(ev.event_date) if ev.event_date else None,
            "description": ev.description, "farmer_name": ev.farmer_name,
        }],
    }


# ════════════════════════════════════════════════════════
#  历年面积占用
# ════════════════════════════════════════════════════════

def get_area_by_year(db: Session, household_id: int) -> dict:
    """获取该家庭户历年面积占用情况（通过 beneficiary_id 关联）"""
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise NotFound("家庭户不存在")

    contracted = float(hh.contract_area or 0)
    has_members = db.query(FarmerProfile.id).filter(
        FarmerProfile.household_id == household_id
    ).first() is not None
    if not has_members:
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
        .join(FarmerProfile, FarmerProfile.id == SubsidyApplication.beneficiary_id)
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(
            FarmerProfile.household_id == household_id,
            SubsidyType.count_toward_area == 1,
            SubsidyApplication.apply_area.isnot(None),
            SubsidyApplication.pay_status.in_([0, 1, 2]),
        )
        .group_by(SubsidyApplication.apply_year, SubsidyType.subsidy_name, SubsidyType.season)
        .order_by(SubsidyApplication.apply_year.desc(), SubsidyType.season)
        .all()
    )

    year_map: dict = {}
    for r in rows:
        y = r.apply_year
        season = r.season or "耕地地力保护"
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
        for season in SEASON_ORDER:
            sb = y["season_breakdown"][season]
            sb["used_area"] = round(sb["used_area"], 2)
            sb["remaining_area"] = round(contracted - sb["used_area"], 2)
            sb["is_overdrawn"] = contracted > 0 and sb["used_area"] > contracted
            sb["overdraw_amount"] = round(max(0, sb["used_area"] - contracted), 2)
            sb["subsidies"] = sorted(sb["subsidies"], key=lambda x: -x["used_area"])

    return {"contracted_area": contracted, "years": year_list}


# ════════════════════════════════════════════════════════
#  重新计算未确认家庭户承包地面积
# ════════════════════════════════════════════════════════

def recalc_unconfirmed_contract_area(db: Session) -> dict:
    """重新计算未确认家庭户的承包地面积"""
    from sqlalchemy import text as _text

    unconfirmed_households = db.query(FamilyHousehold).filter(
        FamilyHousehold.is_manually_confirmed == 0
    ).all()

    if not unconfirmed_households:
        return {"message": "没有未确认的家庭户需要计算", "total": 0, "updated": 0}

    updated_count = 0
    results = []

    for hh in unconfirmed_households:
        sql_2025 = _text("""
            SELECT ROUND(SUM(COALESCE(sp.contract_area, 0)), 2) as total_contract_area
            FROM subsidy_payment sp
            JOIN farmer_profile fp ON sp.beneficiary_id = fp.id
            WHERE fp.household_id = :household_id
                AND sp.payment_year = 2025
        """)
        result_2025 = db.execute(sql_2025, {"household_id": hh.id}).fetchone()
        area_2025 = float(result_2025[0]) if result_2025 and result_2025[0] else 0.0

        if area_2025 > 0:
            hh.contract_area = area_2025
            updated_count += 1
            results.append({"household_id": hh.id, "household_name": hh.household_name, "year_used": 2025, "contract_area": area_2025})
        else:
            sql_2024 = _text("""
                SELECT ROUND(SUM(COALESCE(sp.contract_area, 0)), 2) as total_contract_area
                FROM subsidy_payment sp
                JOIN farmer_profile fp ON sp.beneficiary_id = fp.id
                WHERE fp.household_id = :household_id
                    AND sp.payment_year = 2024
            """)
            result_2024 = db.execute(sql_2024, {"household_id": hh.id}).fetchone()
            area_2024 = float(result_2024[0]) if result_2024 and result_2024[0] else 0.0

            if area_2024 > 0:
                hh.contract_area = area_2024
                updated_count += 1
                results.append({"household_id": hh.id, "household_name": hh.household_name, "year_used": 2024, "contract_area": area_2024})
            else:
                results.append({"household_id": hh.id, "household_name": hh.household_name, "year_used": None, "contract_area": None, "message": "2024和2025年都没有补贴数据"})

    db.commit()
    return {
        "message": f"重新计算完成：共处理{len(unconfirmed_households)}个未确认家庭户，更新{updated_count}个",
        "total": len(unconfirmed_households),
        "updated": updated_count,
        "results": results,
    }
