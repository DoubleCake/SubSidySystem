"""
补贴管理-业务逻辑层

职责：
  - 补贴申报/发放的批量导入逻辑
  - 面积缓存更新
  - 年度汇总对比
  - 代领关系处理

路由层（routers/subsidies.py）只负责 HTTP 编排，业务逻辑在此实现。
"""

from datetime import date as date_type
from typing import Optional

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from core.exceptions import NotFound, BadRequest
from models import (
    FamilyHousehold, FarmerProfile, Village,
    SubsidyType, SubsidyApplication, SubsidyPayment,
    SubsidyProxy, HouseholdAreaUsageCache, ErrorLibrary,
)
from utils import (
    parse_group_no_to_int, format_group_no,
    validate_id_card, parse_gender_from_id,
    parse_id_card, gen_household_code, check_area_anomaly,
)

SEASON_ORDER = ["大春", "小春", "耕地地力保护", "临时"]


# ═══════════════════════════════════════════
#  面积缓存
# ═══════════════════════════════════════════

def update_cache_incremental(
    db: Session, household_id: int, year: int, season: str | None,
    delta: float, count_toward: bool = True
) -> None:
    """增量更新家庭户面积缓存（单条 CRUD 用，O(1)完成，无需全量汇总）"""
    if not household_id or delta == 0 or not count_toward:
        return
    season = season or "耕地地力保护"
    existing = db.query(HouseholdAreaUsageCache).filter(
        HouseholdAreaUsageCache.household_id == household_id,
        HouseholdAreaUsageCache.year == year,
        HouseholdAreaUsageCache.season == season,
    ).first()
    if existing:
        existing.apply_area = max(0, float(existing.apply_area or 0) + delta)
        existing.used_area = float(existing.payment_area or 0) if float(existing.payment_area or 0) > 0 else float(existing.apply_area or 0)
    else:
        used = abs(delta) if delta > 0 else 0
        db.add(HouseholdAreaUsageCache(
            household_id=household_id, year=year, season=season,
            apply_area=abs(delta) if delta > 0 else 0, payment_area=0, used_area=used,
        ))
    db.commit()


def recalc_cache_for_type(db: Session, type_id: int, old_count_toward: int, new_count_toward: int) -> None:
    """项目级定向缓存更新——只重算某项目涉及的家庭户，不改其他项目数据"""
    if old_count_toward == new_count_toward:
        return
    direction = -1 if new_count_toward == 0 else 1  # 1→0 要扣减，0→1 要加上
    rows = db.execute(text("""
        SELECT fp.household_id, sa.apply_year,
               COALESCE(st.season, '耕地地力保护') AS season,
               SUM(COALESCE(sa.apply_area, 0)) AS total_area
        FROM subsidy_application sa
        JOIN farmer_profile fp ON sa.beneficiary_id = fp.id
        JOIN subsidy_type st ON st.id = sa.subsidy_type_id
        WHERE sa.subsidy_type_id = :tid AND fp.household_id IS NOT NULL
          AND sa.pay_status IN (0, 1, 2) AND sa.apply_area IS NOT NULL
        GROUP BY fp.household_id, sa.apply_year, st.season
    """), {"tid": type_id}).fetchall()
    for r in rows:
        delta = float(r.total_area or 0) * direction
        if delta == 0:
            continue
        existing = db.query(HouseholdAreaUsageCache).filter(
            HouseholdAreaUsageCache.household_id == r.household_id,
            HouseholdAreaUsageCache.year == r.apply_year,
            HouseholdAreaUsageCache.season == r.season,
        ).first()
        if existing:
            existing.apply_area = max(0, float(existing.apply_area or 0) + delta)
            existing.used_area = float(existing.payment_area or 0) if float(existing.payment_area or 0) > 0 else float(existing.apply_area or 0)
    db.commit()


def recalc_household_cache(db: Session, household_ids: list[int]) -> None:
    """
    重新计算指定家庭户的面积缓存。
    通过 beneficiary_id 关联农户，代领记录直接按受益人归属计算面积。
    """
    for household_id in household_ids:
        hh = db.get(FamilyHousehold, household_id)
        if not hh:
            continue

        has_members = db.query(FarmerProfile.id).filter(
            FarmerProfile.household_id == household_id
        ).first() is not None
        if not has_members:
            db.query(HouseholdAreaUsageCache).filter(
                HouseholdAreaUsageCache.household_id == household_id
            ).delete()
            continue

        # 申报表计算（通过 beneficiary_id 关联到家庭户）
        app_query = (
            db.query(
                SubsidyType.season, SubsidyApplication.apply_year,
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
        ).all()
        app_data: dict[tuple, float] = {}
        all_years: set[int] = set()
        for r in app_query:
            season = r.season or "耕地地力保护"
            key = (r.apply_year, season)
            app_data[key] = app_data.get(key, 0.0) + float(r.total_area or 0)
            all_years.add(r.apply_year)

        # 发放表计算（通过 beneficiary_id 关联到家庭户）
        pay_query = (
            db.query(
                SubsidyType.season, SubsidyPayment.payment_year,
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
        ).all()
        pay_data: dict[tuple, float] = {}
        for r in pay_query:
            season = r.season or "耕地地力保护"
            key = (r.payment_year, season)
            pay_data[key] = pay_data.get(key, 0.0) + float(r.total_area or 0)
            all_years.add(r.payment_year)

        # 写缓存
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
                    existing.apply_area = apply_area
                    existing.payment_area = payment_area
                    existing.used_area = used_area
                else:
                    db.add(HouseholdAreaUsageCache(
                        household_id=household_id, year=year, season=season,
                        apply_area=apply_area, payment_area=payment_area, used_area=used_area,
                    ))

    db.commit()


def ensure_village_and_group(
    db: Session, village_name: str, group_no: str = ""
) -> tuple[int, int, str, str]:
    """
    解析村组信息，自动创建不存在的村。
    返回 (village_id, group_no_int, village_name, group_display)
    """
    if not village_name:
        raise BadRequest("缺少村名")
    gno_int = parse_group_no_to_int(group_no) if group_no else 1
    village = db.query(Village).filter(Village.village_name == village_name).first()
    if not village:
        village = Village(village_name=village_name)
        db.add(village)
        db.flush()
    return village.id, gno_int, village_name, format_group_no(gno_int)


def get_village_snapshot(farmer: FarmerProfile) -> dict:
    """
    获取农户的村组快照：优先使用个人村组，否则用家庭户村组。
    返回 {village_id, group_no, village_name, group_display}
    """
    hh = farmer.household
    village_id = farmer.own_village_id or (hh.village_id if hh else None)
    group_no = farmer.own_group_no or (hh.group_no if hh else None)
    village_name = None
    group_display = None
    if village_id:
        v = db.execute(text("SELECT village_name FROM village WHERE id=:id"), {"id": village_id}).fetchone()
        village_name = v[0] if v else None
        # 这里不传 db 参数，需要从外部传入，我们用 db.query
    # 此处用 db 重新查
    return {"village_id": village_id, "group_no": group_no, "village_name": village_name, "group_display": group_display}


# 使用 SQL 一次性获取村组快照
def get_village_snapshot_simple(db: Session, farmer: FarmerProfile) -> dict:
    """用 SQL 查村组快照，避免 lazy load"""
    hh_id = farmer.household_id
    own_vid = farmer.own_village_id
    own_gn = farmer.own_group_no

    # 查家庭户
    row = db.execute(
        text("SELECT village_id, group_no FROM family_household WHERE id=:id"),
        {"id": hh_id},
    ).fetchone() if hh_id else None

    hh_vid = row[0] if row else None
    hh_gn = row[1] if row else None

    village_id = own_vid or hh_vid
    group_no_int = own_gn or hh_gn or 1

    # 查村名
    vname = None
    if village_id:
        vr = db.execute(
            text("SELECT village_name FROM village WHERE id=:id"), {"id": village_id}
        ).fetchone()
        vname = vr[0] if vr else None

    return {
        "village_id": village_id,
        "group_no": group_no_int,
        "village_name": vname,
        "group_display": format_group_no(group_no_int) if group_no_int else None,
    }


# ═══════════════════════════════════════════
#  补贴类型
# ═══════════════════════════════════════════

def list_types(db: Session, year: Optional[int] = None) -> list:
    q = db.query(SubsidyType)
    if year:
        q = q.filter(SubsidyType.subsidy_year == year)
    return q.order_by(SubsidyType.subsidy_year.desc()).all()


def create_type(db: Session, data: dict) -> SubsidyType:
    st = SubsidyType(**data)
    db.add(st)
    db.commit()
    db.refresh(st)
    return st


def update_type(db: Session, type_id: int, data: dict) -> SubsidyType:
    st = db.get(SubsidyType, type_id)
    if not st:
        raise NotFound("补贴类型不存在")
    for k, v in data.items():
        if hasattr(st, k):
            setattr(st, k, v)
    db.commit()
    return st


def delete_type(db: Session, type_id: int) -> None:
    st = db.get(SubsidyType, type_id)
    if not st:
        raise NotFound("补贴项目不存在")
    # 先查出受影响的家庭户
    affected = db.execute(text("""
        SELECT DISTINCT fp.household_id
        FROM subsidy_application sa
        JOIN farmer_profile fp ON sa.beneficiary_id = fp.id
        WHERE sa.subsidy_type_id = :type_id AND fp.household_id IS NOT NULL
    """), {"type_id": type_id}).fetchall()
    hh_ids = [r[0] for r in affected if r[0]]
    db.execute(text("DELETE FROM subsidy_application WHERE subsidy_type_id = :id"), {"id": type_id})
    db.execute(text("DELETE FROM subsidy_type WHERE id = :id"), {"id": type_id})
    db.commit()
    if hh_ids:
        recalc_household_cache(db, hh_ids)


# ═══════════════════════════════════════════
#  补贴申请 - 批量导入
# ═══════════════════════════════════════════

def batch_import_applications(
    db: Session, rows: list[dict], defer_cache: bool = False,
    overwrite: bool = False,
) -> dict:
    """
    批量导入补贴申请记录（优化版：Village缓存 + 批量查重）。
    defer_cache=True 时跳过缓存重算，返回 affected_households 由调用方统一处理。
    overwrite=True 时覆盖更新已有记录（相同农户+项目+年度+状态）。
    """
    if not rows:
        return {"created": 0, "updated": 0, "skipped": 0, "errors": [], "new_farmers": 0, "affected_households": []}

    created, updated, skipped = 0, 0, 0
    errors: list[str] = []
    new_farmers_created = 0
    affected_households: set[int] = set()

    # ── Phase 1: 预加载 Village 缓存 ──
    village_cache: dict[str, Village] = {}
    unique_villages: set[str] = set()
    for row in rows:
        vname = str(row.get("village_name", "")).strip()
        if vname:
            unique_villages.add(vname)
    for vname in unique_villages:
        v = db.query(Village).filter(Village.village_name == vname).first()
        if not v:
            v = Village(village_name=vname)
            db.add(v)
            db.flush()
        village_cache[vname] = v

    # ── Phase 2: 批量加载已有农户 ──
    all_id_cards = [str(r.get("id_card", "")).strip() for r in rows if str(r.get("id_card", "")).strip() and not r.get("farmer_id")]
    existing_farmers: dict[str, FarmerProfile] = {}
    if all_id_cards:
        for f in db.query(FarmerProfile).filter(FarmerProfile.id_card.in_(all_id_cards)).all():
            existing_farmers[f.id_card] = f

    # ── Phase 3: 逐行解析农户 ──
    row_farmers: dict[int, FarmerProfile | None] = {}
    for idx, row in enumerate(rows):
        row_no = idx + 2
        if row.get("farmer_id"):
            row_farmers[idx] = db.get(FarmerProfile, row["farmer_id"])
            continue
        id_card = str(row.get("id_card", "")).strip()
        real_name = str(row.get("real_name", "")).strip()
        if not id_card or not real_name:
            errors.append(f"第{row_no}行 {real_name or '?'}：缺少身份证或姓名")
            row_farmers[idx] = None
            continue
        if id_card in existing_farmers:
            row_farmers[idx] = existing_farmers[id_card]
            continue
        village_name = str(row.get("village_name", "")).strip()
        group_no = str(row.get("group_no", "")).strip()
        if not village_name:
            errors.append(f"第{row_no}行 {real_name}（{id_card}）：缺少村名")
            row_farmers[idx] = None
            continue
        try:
            farmer = _auto_create_farmer(db, id_card, real_name, village_name, group_no, village_cache)
            row_farmers[idx] = farmer
            existing_farmers[id_card] = farmer
            new_farmers_created += 1
        except Exception as e:
            errors.append(f"第{row_no}行 {real_name}（{id_card}）：创建农户失败 - {e}")
            row_farmers[idx] = None

    # ── Phase 4: 批量查重 ──
    dup_check_keys: set[tuple] = set()
    farmer_by_idx: dict[int, FarmerProfile] = {}
    for idx, farmer in row_farmers.items():
        if farmer is None:
            continue
        row = rows[idx]
        farmer_by_idx[idx] = farmer
        dup_check_keys.add((farmer.id, row.get("subsidy_type_id"), row.get("apply_year"), (row.get("pay_status") or 0)))
    duplicate_set: set[tuple] = set()
    if dup_check_keys:
        existing = db.query(
            SubsidyApplication.farmer_id, SubsidyApplication.subsidy_type_id,
            SubsidyApplication.apply_year, SubsidyApplication.pay_status,
        ).filter(SubsidyApplication.farmer_id.in_([k[0] for k in dup_check_keys])).all()
        duplicate_set = {(e.farmer_id, e.subsidy_type_id, e.apply_year, e.pay_status) for e in existing}

    # ── Phase 5: 构建并插入 ──
    seen_in_batch: set[tuple] = set()
    for idx, farmer in farmer_by_idx.items():
        row = rows[idx]
        row_no = idx + 2
        try:
            if getattr(farmer, 'restricted_identity', 0) == 1:
                errors.append(f"第{row_no}行 {farmer.real_name}（{farmer.id_card}）：受限制身份")
                continue
            key = (farmer.id, row.get("subsidy_type_id"), row.get("apply_year"), (row.get("pay_status") or 0))
            if key in duplicate_set or key in seen_in_batch:
                if overwrite and key in duplicate_set:
                    # ── 覆盖更新现有记录 ──
                    exist_app = db.query(SubsidyApplication).filter(
                        SubsidyApplication.farmer_id == key[0],
                        SubsidyApplication.subsidy_type_id == key[1],
                        SubsidyApplication.apply_year == key[2],
                        SubsidyApplication.pay_status == key[3],
                    ).first()
                    if exist_app:
                        row["farmer_id"] = farmer.id
                        # 更新非空字段
                        for fld in ("apply_amount", "actual_amount", "apply_area",
                                    "apply_area_no_calc", "contract_area", "trust_area", "no_subsidy_area",
                                    "pay_date", "remark", "pay_status"):
                            val = row.get(fld)
                            if val is not None and val != '':
                                setattr(exist_app, fld, val)
                        affected_households.add(farmer.household_id)
                        updated += 1
                else:
                    skipped += 1
                continue
            row["farmer_id"] = farmer.id
            app = _build_application_from_row(db, farmer, row, village_cache)
            if app is None:
                continue
            db.add(app)
            seen_in_batch.add(key)
            affected_households.add(farmer.household_id)
            created += 1
        except Exception as e:
            errors.append(f"第{row_no}行 {farmer.real_name}（{farmer.id_card}）：{e}")

    db.commit()
    if affected_households and not defer_cache:
        recalc_household_cache(db, list(affected_households))

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
        "new_farmers": new_farmers_created,
        "affected_households": list(affected_households),
    }


def _auto_create_farmer(
    db: Session, id_card: str, real_name: str,
    village_name: str, group_no: str, village_cache: dict,
) -> FarmerProfile:
    """导入时自动创建农户及家庭户（使用预加载的 village_cache）"""
    gno_int = parse_group_no_to_int(group_no) if group_no else 1
    village = village_cache.get(village_name)
    if not village:
        village = Village(village_name=village_name)
        db.add(village)
        db.flush()
        village_cache[village_name] = village

    parsed = parse_id_card(id_card) or {}
    farmer = FarmerProfile(
        household_id=0, real_name=real_name,
        gender=parsed.get("gender") or 1,
        id_card=id_card, relation="本人", farmer_status=1,
    )
    db.add(farmer)
    db.flush()

    hh = FamilyHousehold(
        household_code=gen_household_code(farmer.id),
        household_name=f"{real_name}户", head_farmer_id=farmer.id,
        village_id=village.id, group_no=gno_int, status=1,
    )
    db.add(hh)
    db.flush()
    farmer.household_id = hh.id
    return farmer


def _build_application_from_row(
    db: Session, farmer: FarmerProfile, row: dict, village_cache: dict,
) -> SubsidyApplication | None:
    """从导入行构建 SubsidyApplication 对象（使用预加载的 village_cache）"""
    excel_village_name = str(row.get("village_name", "")).strip()
    excel_group_no_str = str(row.get("group_no", "")).strip()
    excel_group_no_int = parse_group_no_to_int(excel_group_no_str) if excel_group_no_str else 1

    clean_row = {
        k: v for k, v in row.items()
        if k not in ("bank_card_snapshot", "id_card", "real_name", "village_name", "group_no", "bank_card")
    }

    if clean_row.get("pay_date") and isinstance(clean_row["pay_date"], str):
        try:
            clean_row["pay_date"] = date_type.fromisoformat(clean_row["pay_date"])
        except ValueError:
            clean_row["pay_date"] = None

    ca = float(clean_row.get("contract_area") or 0)
    ta = float(clean_row.get("trust_area") or 0)
    if ca or ta:
        if not clean_row.get("apply_area"):
            clean_row["apply_area"] = round(ca + ta, 2)
        clean_row["contract_area"] = ca or None
        clean_row["trust_area"] = ta or None

    village_id = None
    village_name = None
    if excel_village_name:
        village = village_cache.get(excel_village_name)
        village_id = village.id if village else None
        village_name = excel_village_name

    return SubsidyApplication(
        **clean_row,
        beneficiary_id=farmer.id,
        apply_village_id=village_id,
        apply_group_no=excel_group_no_int,
        apply_village_name=village_name,
        apply_group_display=format_group_no(excel_group_no_int),
        bank_card_snapshot=f"****{farmer.bank_card[-4:]}" if farmer and farmer.bank_card else None,
    )


# ═══════════════════════════════════════════
#  补贴申请 - 单条创建
# ═══════════════════════════════════════════

def create_application(db: Session, data: dict) -> SubsidyApplication:
    farmer = db.get(FarmerProfile, data.get("farmer_id"))
    if not farmer:
        raise NotFound("农户不存在")

    snapshot = get_village_snapshot_simple(db, farmer)

    app = SubsidyApplication(
        **{k: v for k, v in data.items() if k != "farmer_id"},
        farmer_id=farmer.id,
        beneficiary_id=farmer.id,
        apply_village_id=snapshot["village_id"],
        apply_group_no=snapshot["group_no"],
        apply_village_name=snapshot["village_name"],
        apply_group_display=snapshot["group_display"],
        bank_card_snapshot=f"****{farmer.bank_card[-4:]}" if farmer.bank_card else None,
    )
    db.add(app)
    db.commit()
    db.refresh(app)

    # 增量更新缓存（O(1)，无需全量汇总）
    if farmer.household_id:
        st = db.get(SubsidyType, data.get("subsidy_type_id"))
        if st:
            update_cache_incremental(
                db, farmer.household_id, app.apply_year, st.season,
                float(app.apply_area or 0), bool(st.count_toward_area)
            )
    return app


# ═══════════════════════════════════════════
#  补贴申请 - 更新
# ═══════════════════════════════════════════

def update_application(db: Session, app_id: int, data: dict) -> SubsidyApplication:
    app = db.get(SubsidyApplication, app_id)
    if not app:
        raise NotFound("记录不存在")

    # 记录更新前的状态用于增量计算
    old_area = float(app.apply_area or 0)
    old_pay_status = app.pay_status
    area_changed = "apply_area" in data or "pay_status" in data

    for k, v in data.items():
        setattr(app, k, v)
    db.commit()

    if area_changed:
        farmer = db.get(FarmerProfile, app.farmer_id)
        if farmer and farmer.household_id:
            st = db.get(SubsidyType, app.subsidy_type_id)
            if st:
                new_area = float(app.apply_area or 0)
                # 支付状态变更处理：3=已驳回不计入缓存
                was_counted = old_pay_status in (0, 1, 2) and old_area > 0
                is_counted = app.pay_status in (0, 1, 2) and new_area > 0
                if was_counted and not is_counted:
                    delta = -old_area
                elif not was_counted and is_counted:
                    delta = new_area
                else:
                    delta = new_area - old_area
                update_cache_incremental(
                    db, farmer.household_id, app.apply_year, st.season,
                    delta, bool(st.count_toward_area)
                )
    return app


# ═══════════════════════════════════════════
#  年度汇总对比
# ═══════════════════════════════════════════

def get_year_compare(db: Session, year: int) -> dict:
    last_year = year - 1

    # 两条 SQL：年度汇总 + 新增退出农户
    sql_summary = text("""
        SELECT apply_year,
               ROUND(SUM(COALESCE(actual_amount, 0)), 2) AS total_amount,
               COUNT(DISTINCT farmer_id) AS farmer_count,
               COUNT(*) AS application_count
        FROM subsidy_application
        WHERE apply_year IN (:y, :ly)
        GROUP BY apply_year
    """)
    rows = {r.apply_year: r for r in db.execute(sql_summary, {"y": year, "ly": last_year})}

    cur_r = rows.get(year)
    prev_r = rows.get(last_year)
    cur = {
        "year": year,
        "total_amount": float(cur_r.total_amount if cur_r else 0),
        "farmer_count": int(cur_r.farmer_count if cur_r else 0),
        "application_count": int(cur_r.application_count if cur_r else 0),
    }
    prev = {
        "year": last_year,
        "total_amount": float(prev_r.total_amount if prev_r else 0),
        "farmer_count": int(prev_r.farmer_count if prev_r else 0),
        "application_count": int(prev_r.application_count if prev_r else 0),
    }

    sql_diff = text("""
        SELECT fp.id, fp.real_name, fp.farmer_status,
               COALESCE(v.village_name, '') AS village_name, COALESCE(hh.group_no, 1) AS group_no
        FROM farmer_profile fp
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE fp.id IN (SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :y)
          AND fp.id NOT IN (SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :ly)
        LIMIT 50
    """)
    sql_exit = text("""
        SELECT fp.id, fp.real_name, fp.farmer_status,
               COALESCE(v.village_name, '') AS village_name, COALESCE(hh.group_no, 1) AS group_no
        FROM farmer_profile fp
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE fp.id IN (SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :ly)
          AND fp.id NOT IN (SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :y)
        LIMIT 50
    """)

    def fmt_village(r):
        vn = r.village_name or ''
        gn = format_group_no(r.group_no) if r.group_no else '一组'
        return f"{vn}{gn}"

    new_f = [
        {"id": r.id, "name": r.real_name, "village": fmt_village(r), "status": r.farmer_status}
        for r in db.execute(sql_diff, {"y": year, "ly": last_year})
    ]
    exit_f = [
        {"id": r.id, "name": r.real_name, "village": fmt_village(r), "status": r.farmer_status}
        for r in db.execute(sql_exit, {"y": year, "ly": last_year})
    ]

    amount_diff = cur["total_amount"] - prev["total_amount"]
    pct = round(amount_diff / prev["total_amount"] * 100, 1) if prev["total_amount"] else None
    return {
        "current_year": cur, "last_year": prev,
        "new_farmers": new_f, "exit_farmers": exit_f,
        "amount_diff": round(amount_diff, 2), "amount_diff_pct": pct,
    }


# ═══════════════════════════════════════════
#  补贴发放 - 批量导入
# ═══════════════════════════════════════════

def batch_import_payments(db: Session, rows: list[dict], overwrite: bool = False) -> dict:
    """批量导入发放记录（优化版：批量查农户+批量查重）。overwrite=True 时覆盖更新已有记录。"""
    if not rows:
        return {"created": 0, "updated": 0, "skipped": 0, "errors": []}

    created, updated, skipped = 0, 0, 0
    errors: list[str] = []
    affected_households: set[int] = set()

    # Phase 1: 批量加载已有农户
    all_id_cards = [str(r.get("id_card", "")).strip() for r in rows if str(r.get("id_card", "")).strip() and not r.get("farmer_id")]
    existing_farmers: dict[str, FarmerProfile] = {}
    if all_id_cards:
        for f in db.query(FarmerProfile).filter(FarmerProfile.id_card.in_(all_id_cards)).all():
            existing_farmers[f.id_card] = f

    # Phase 2: 逐行解析农户 + 批量查重
    dup_check_keys: set[tuple] = set()
    row_farmers: dict[int, FarmerProfile | None] = {}
    for idx, row in enumerate(rows):
        row_no = idx + 2
        farmer_id = row.get("farmer_id")
        subsidy_type_id = row.get("subsidy_type_id")
        payment_year = row.get("payment_year")
        id_card = str(row.get("id_card", "")).strip()
        real_name = str(row.get("real_name", "")).strip()

        if not subsidy_type_id or not payment_year:
            errors.append(f"第{row_no}行 {real_name or id_card or '?'}：缺少必要字段")
            row_farmers[idx] = None
            continue

        if farmer_id:
            f = db.get(FarmerProfile, farmer_id)
        elif id_card and id_card in existing_farmers:
            f = existing_farmers[id_card]
        elif id_card:
            f = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
        else:
            errors.append(f"第{row_no}行 {real_name or '?'}：缺少身份证或农户ID")
            row_farmers[idx] = None
            continue

        if not f:
            errors.append(f"第{row_no}行 {real_name or id_card or '?'}：农户不存在")
            row_farmers[idx] = None
            continue

        row_farmers[idx] = f
        dup_check_keys.add((f.id, subsidy_type_id, payment_year))

    # Phase 3: 批量查重
    duplicate_set: set[tuple] = set()
    if dup_check_keys:
        existing = db.query(
            SubsidyPayment.farmer_id, SubsidyPayment.subsidy_type_id, SubsidyPayment.payment_year
        ).filter(SubsidyPayment.farmer_id.in_([k[0] for k in dup_check_keys])).all()
        duplicate_set = {(e.farmer_id, e.subsidy_type_id, e.payment_year) for e in existing}

    # Phase 4: 构建并插入
    seen_in_batch: set[tuple] = set()
    for idx, row in enumerate(rows):
        farmer = row_farmers.get(idx)
        if farmer is None:
            continue
        row_no = idx + 2
        try:
            subsidy_type_id = row.get("subsidy_type_id")
            payment_year = row.get("payment_year")
            key = (farmer.id, subsidy_type_id, payment_year)
            if key in duplicate_set or key in seen_in_batch:
                if overwrite and key in duplicate_set and key not in seen_in_batch:
                    # ── 覆盖更新现有发放记录 ──
                    exist_pay = db.query(SubsidyPayment).filter(
                        SubsidyPayment.farmer_id == key[0],
                        SubsidyPayment.subsidy_type_id == key[1],
                        SubsidyPayment.payment_year == key[2],
                    ).first()
                    if exist_pay:
                        for fld in ("amount", "payment_date", "apply_area",
                                    "apply_area_no_calc", "contract_area", "trust_area", "no_subsidy_area",
                                    "bank_card", "bank_name", "remark", "proxy_remark"):
                            val = row.get(fld)
                            if val is not None and val != '':
                                setattr(exist_pay, fld, val)
                        if farmer.household_id:
                            affected_households.add(farmer.household_id)
                        updated += 1
                else:
                    skipped += 1
                continue

            snapshot = get_village_snapshot_simple(db, farmer)
            payment = SubsidyPayment(
                farmer_id=farmer.id,
                subsidy_type_id=subsidy_type_id,
                payment_year=payment_year,
                beneficiary_id=farmer.id,
                amount=row.get("amount"),
                payment_date=row.get("payment_date"),
                payment_village_id=snapshot["village_id"],
                payment_group_no=snapshot["group_no"],
                payment_village_name=snapshot["village_name"],
                payment_group_display=snapshot["group_display"],
                apply_area=row.get("apply_area"),
                apply_area_no_calc=row.get("apply_area_no_calc"),
                contract_area=row.get("contract_area"),
                trust_area=row.get("trust_area"),
                no_subsidy_area=row.get("no_subsidy_area"),
                bank_card=row.get("bank_card"),
                bank_name=row.get("bank_name"),
                remark=row.get("remark"),
                proxy_remark=row.get("proxy_remark"),
            )
            db.add(payment)
            seen_in_batch.add(key)
            if farmer.household_id:
                affected_households.add(farmer.household_id)
            _sync_application_pay_status(db, farmer.id, subsidy_type_id, payment_year)
            created += 1
        except Exception as e:
            errors.append(f"第{row_no}行 {farmer.real_name}（{farmer.id_card}）：{e}")

    db.commit()
    if affected_households:
        recalc_household_cache(db, list(affected_households))
    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors}


def _sync_application_pay_status(
    db: Session, farmer_id: int, subsidy_type_id: int, payment_year: int
) -> None:
    """同步申报记录的支付状态为已发放"""
    app = db.query(SubsidyApplication).filter(
        SubsidyApplication.farmer_id == farmer_id,
        SubsidyApplication.subsidy_type_id == subsidy_type_id,
        SubsidyApplication.apply_year == payment_year,
        SubsidyApplication.pay_status.in_([0, 1]),
    ).first()
    if app:
        app.pay_status = 2


# ═══════════════════════════════════════════
#  代领关系
# ═══════════════════════════════════════════

def create_proxy_relation(db: Session, data: dict) -> dict:
    """创建代领关系（新方案：不复制记录，使用 beneficiary_id）"""
    from models import SubsidyProxy

    beneficiary = db.get(FarmerProfile, data["beneficiary_farmer_id"])
    if not beneficiary:
        raise NotFound("受益人不存在")
    proxy_farmer = db.get(FarmerProfile, data["proxy_farmer_id"])
    if not proxy_farmer:
        raise NotFound("代领人不存在")

    subsidy_type_id = data.get("subsidy_type_id")

    if data.get("application_id"):
        app = db.get(SubsidyApplication, data["application_id"])
        if not app:
            raise NotFound("补贴申请记录不存在")
        if not subsidy_type_id:
            subsidy_type_id = app.subsidy_type_id
        app.beneficiary_id = data["beneficiary_farmer_id"]
        app.is_proxy = 1
    elif data.get("payment_id"):
        pay = db.get(SubsidyPayment, data["payment_id"])
        if not pay:
            raise NotFound("发放记录不存在")
        if not subsidy_type_id:
            subsidy_type_id = pay.subsidy_type_id
        pay.beneficiary_id = data["beneficiary_farmer_id"]
        pay.is_proxy = 1
    else:
        if subsidy_type_id:
            apps_to_update = db.query(SubsidyApplication).filter(
                SubsidyApplication.farmer_id == data["proxy_farmer_id"],
                SubsidyApplication.subsidy_type_id == subsidy_type_id,
            ).all()
            for app in apps_to_update:
                app.beneficiary_id = data["beneficiary_farmer_id"]
                app.is_proxy = 1

            pays_to_update = db.query(SubsidyPayment).filter(
                SubsidyPayment.farmer_id == data["proxy_farmer_id"],
                SubsidyPayment.subsidy_type_id == subsidy_type_id,
            ).all()
            for pay in pays_to_update:
                pay.beneficiary_id = data["beneficiary_farmer_id"]
                pay.is_proxy = 1

    proxy_rel = SubsidyProxy(
        beneficiary_farmer_id=data["beneficiary_farmer_id"],
        proxy_farmer_id=data["proxy_farmer_id"],
        application_id=data.get("application_id"),
        payment_id=data.get("payment_id"),
        subsidy_type_id=subsidy_type_id,
        proxy_type=data.get("proxy_type", "代领"),
        remark=data.get("remark", ""),
    )
    db.add(proxy_rel)
    db.commit()
    db.refresh(proxy_rel)

    # Trigger cache recalculation for both households
    affected = set()
    if beneficiary.household_id:
        affected.add(beneficiary.household_id)
    if proxy_farmer.household_id:
        affected.add(proxy_farmer.household_id)
    if affected:
        recalc_household_cache(db, list(affected))

    return {"id": proxy_rel.id, "message": "代领关系创建成功"}
