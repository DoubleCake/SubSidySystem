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

from core.exceptions import NotFound, BadRequest, Conflict
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

SEASON_ORDER = ["大春", "小春", "全年单补", "临时"]


# ═══════════════════════════════════════════
#  面积缓存
# ═══════════════════════════════════════════

def recalc_household_cache(db: Session, household_ids: list[int]) -> None:
    """
    重新计算指定家庭户的面积缓存。
    代领逻辑：本户成员作为代领人的不计入面积；作为受益人的要计入面积。
    """
    for household_id in household_ids:
        hh = db.get(FamilyHousehold, household_id)
        if not hh:
            continue

        member_ids = [
            m.id for m in db.query(FarmerProfile.id)
            .filter(FarmerProfile.household_id == household_id).all()
        ]
        if not member_ids:
            db.query(HouseholdAreaUsageCache).filter(
                HouseholdAreaUsageCache.household_id == household_id
            ).delete()
            continue

        # 本户成员作为代领人（不计入面积）
        proxy_as_proxy: dict[tuple, bool] = {}
        for pr in db.query(SubsidyProxy).filter(
            SubsidyProxy.proxy_farmer_id.in_(member_ids)
        ).all():
            if pr.application_id:
                proxy_as_proxy[('app', pr.application_id)] = True
            if pr.payment_id:
                proxy_as_proxy[('pay', pr.payment_id)] = True

        # 本户成员作为受益人（需计入面积）
        proxy_as_beneficiary_app: dict[tuple, list[float]] = {}
        proxy_as_beneficiary_pay: dict[tuple, list[float]] = {}
        for pr in db.query(SubsidyProxy).filter(
            SubsidyProxy.beneficiary_farmer_id.in_(member_ids)
        ).all():
            if pr.application_id:
                app = db.get(SubsidyApplication, pr.application_id)
                if app and app.apply_area:
                    st = db.get(SubsidyType, app.subsidy_type_id)
                    if st and st.calc_mode == "per_mu" and st.count_toward_area == 1:
                        season = st.season or "全年单补"
                        key = (app.apply_year, season)
                        proxy_as_beneficiary_app.setdefault(key, []).append(float(app.apply_area))
            if pr.payment_id:
                pay = db.get(SubsidyPayment, pr.payment_id)
                if pay and pay.apply_area:
                    st = db.get(SubsidyType, pay.subsidy_type_id)
                    if st and st.calc_mode == "per_mu" and st.count_toward_area == 1:
                        season = st.season or "全年单补"
                        key = (pay.payment_year, season)
                        proxy_as_beneficiary_pay.setdefault(key, []).append(float(pay.apply_area))

        # 申报表计算
        app_query = (
            db.query(
                SubsidyType.season, SubsidyApplication.apply_year,
                SubsidyApplication.apply_area, SubsidyApplication.id,
            )
            .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
            .filter(
                SubsidyApplication.farmer_id.in_(member_ids),
                SubsidyType.calc_mode == "per_mu",
                SubsidyType.count_toward_area == 1,
                SubsidyApplication.apply_area.isnot(None),
                SubsidyApplication.pay_status.in_([0, 1, 2]),
            ).all()
        )
        app_data: dict[tuple, float] = {}
        all_years: set[int] = set()
        for r in app_query:
            if ('app', r.id) in proxy_as_proxy:
                continue
            season = r.season or "全年单补"
            key = (r.apply_year, season)
            app_data[key] = app_data.get(key, 0.0) + float(r.apply_area or 0)
            all_years.add(r.apply_year)

        for key, areas in proxy_as_beneficiary_app.items():
            all_years.add(key[0])
            app_data[key] = app_data.get(key, 0.0) + sum(areas)

        # 发放表计算
        pay_query = (
            db.query(
                SubsidyType.season, SubsidyPayment.payment_year,
                SubsidyPayment.apply_area, SubsidyPayment.id,
            )
            .join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
            .filter(
                SubsidyPayment.farmer_id.in_(member_ids),
                SubsidyType.calc_mode == "per_mu",
                SubsidyType.count_toward_area == 1,
                SubsidyPayment.apply_area.isnot(None),
            ).all()
        )
        pay_data: dict[tuple, float] = {}
        for r in pay_query:
            if ('pay', r.id) in proxy_as_proxy:
                continue
            season = r.season or "全年单补"
            key = (r.payment_year, season)
            pay_data[key] = pay_data.get(key, 0.0) + float(r.apply_area or 0)
            all_years.add(r.payment_year)

        for key, areas in proxy_as_beneficiary_pay.items():
            all_years.add(key[0])
            pay_data[key] = pay_data.get(key, 0.0) + sum(areas)

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
    db.execute(text("DELETE FROM subsidy_application WHERE subsidy_type_id = :id"), {"id": type_id})
    db.execute(text("DELETE FROM subsidy_type WHERE id = :id"), {"id": type_id})
    db.commit()


# ═══════════════════════════════════════════
#  补贴申请 - 批量导入
# ═══════════════════════════════════════════

def batch_import_applications(
    db: Session, rows: list[dict]
) -> dict:
    """
    批量导入补贴申请记录。
    返回 {created, skipped, errors, new_farmers, affected_households}
    """
    created, skipped, errors = 0, 0, []
    new_farmers_created = 0
    affected_households: set[int] = set()

    for row in rows:
        sp = db.begin_nested()
        try:
            farmer = _resolve_farmer_for_import(db, row, errors)
            if not farmer:
                sp.rollback()
                continue

            row["farmer_id"] = farmer.id

            # 检查完全相同的记录
            if _exists_duplicate_application(db, farmer, row):
                sp.rollback()
                skipped += 1
                continue

            # 处理导入数据
            app = _build_application_from_row(db, farmer, row, errors)
            if app is None:
                sp.rollback()
                continue

            db.add(app)
            sp.commit()
            affected_households.add(farmer.household_id)
            created += 1
        except Exception as e:
            sp.rollback()
            errors.append(str(e))

    db.commit()
    if affected_households:
        recalc_household_cache(db, list(affected_households))

    return {
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "new_farmers": new_farmers_created,
    }


def _resolve_farmer_for_import(
    db: Session, row: dict, errors: list
) -> FarmerProfile | None:
    """按 farmer_id 或 id_card 查找/创建农户"""
    if row.get("farmer_id"):
        return db.get(FarmerProfile, row["farmer_id"])

    id_card = str(row.get("id_card", "")).strip()
    real_name = str(row.get("real_name", "")).strip()
    if not id_card or not real_name:
        errors.append(f"{row.get('real_name', '?')}：缺少身份证或姓名")
        return None

    # 查找已有
    farmer = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
    if farmer:
        return farmer

    # 自动创建新农户+家庭户
    village_name = str(row.get("village_name", "")).strip()
    group_no = str(row.get("group_no", "")).strip()
    if not village_name:
        errors.append(f"{real_name}（{id_card}）：缺少村名")
        return None

    return _auto_create_farmer(db, id_card, real_name, village_name, group_no, errors)


def _auto_create_farmer(
    db: Session, id_card: str, real_name: str,
    village_name: str, group_no: str, errors: list,
) -> FarmerProfile | None:
    """导入时自动创建农户及家庭户"""
    gno_int = parse_group_no_to_int(group_no) if group_no else 1
    village = db.query(Village).filter(Village.village_name == village_name).first()
    if not village:
        village = Village(village_name=village_name)
        db.add(village)
        db.flush()

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


def _exists_duplicate_application(db: Session, farmer: FarmerProfile, row: dict) -> bool:
    """检查数据库中是否已有完全相同的申请记录"""
    exists = db.query(SubsidyApplication).filter(
        SubsidyApplication.farmer_id == farmer.id,
        SubsidyApplication.subsidy_type_id == row["subsidy_type_id"],
        SubsidyApplication.apply_year == row["apply_year"],
        SubsidyApplication.pay_status == row.get("pay_status", 0),
        SubsidyApplication.apply_area == (
            float(row.get("apply_area")) if row.get("apply_area") is not None else None
        ),
        SubsidyApplication.contract_area == (
            float(row.get("contract_area")) if row.get("contract_area") is not None else None
        ),
        SubsidyApplication.trust_area == (
            float(row.get("trust_area")) if row.get("trust_area") is not None else None
        ),
        SubsidyApplication.no_subsidy_area == (
            float(row.get("no_subsidy_area")) if row.get("no_subsidy_area") is not None else None
        ),
        SubsidyApplication.remark == row.get("remark"),
    ).first()
    return exists is not None


def _build_application_from_row(
    db: Session, farmer: FarmerProfile, row: dict, errors: list
) -> SubsidyApplication | None:
    """从导入行构建 SubsidyApplication 对象"""
    # 提取村组信息
    excel_village_name = str(row.get("village_name", "")).strip()
    excel_group_no_str = str(row.get("group_no", "")).strip()
    excel_group_no_int = parse_group_no_to_int(excel_group_no_str) if excel_group_no_str else 1

    # 清理不需要的字段
    clean_row = {
        k: v for k, v in row.items()
        if k not in ("bank_card_snapshot", "id_card", "real_name", "village_name", "group_no", "bank_card")
    }

    # pay_date 字符串转 date
    if clean_row.get("pay_date") and isinstance(clean_row["pay_date"], str):
        try:
            clean_row["pay_date"] = date_type.fromisoformat(clean_row["pay_date"])
        except ValueError:
            clean_row["pay_date"] = None

    # 面积自动求和
    ca = float(clean_row.get("contract_area") or 0)
    ta = float(clean_row.get("trust_area") or 0)
    if ca or ta:
        if not clean_row.get("apply_area"):
            clean_row["apply_area"] = round(ca + ta, 2)
        clean_row["contract_area"] = ca or None
        clean_row["trust_area"] = ta or None

    # 村组快照
    village_id = None
    village_name = None
    if excel_village_name:
        village = db.query(Village).filter(Village.village_name == excel_village_name).first()
        if not village:
            village = Village(village_name=excel_village_name)
            db.add(village)
            db.flush()
        village_id = village.id
        village_name = excel_village_name

    return SubsidyApplication(
        **clean_row,
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
        apply_village_id=snapshot["village_id"],
        apply_group_no=snapshot["group_no"],
        apply_village_name=snapshot["village_name"],
        apply_group_display=snapshot["group_display"],
        bank_card_snapshot=f"****{farmer.bank_card[-4:]}" if farmer.bank_card else None,
    )
    db.add(app)
    db.commit()
    db.refresh(app)

    if farmer.household_id:
        recalc_household_cache(db, [farmer.household_id])
    return app


# ═══════════════════════════════════════════
#  补贴申请 - 更新
# ═══════════════════════════════════════════

def update_application(db: Session, app_id: int, data: dict) -> SubsidyApplication:
    app = db.get(SubsidyApplication, app_id)
    if not app:
        raise NotFound("记录不存在")
    area_changed = "apply_area" in data or "pay_status" in data
    for k, v in data.items():
        setattr(app, k, v)
    db.commit()

    if area_changed:
        farmer = db.get(FarmerProfile, app.farmer_id)
        if farmer and farmer.household_id:
            recalc_household_cache(db, [farmer.household_id])
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

def batch_import_payments(db: Session, rows: list[dict]) -> dict:
    """批量导入发放记录"""
    created, skipped, errors = 0, 0, []
    affected_households: set[int] = set()

    for row in rows:
        try:
            farmer_id = row.get("farmer_id")
            subsidy_type_id = row.get("subsidy_type_id")
            payment_year = row.get("payment_year")
            id_card = str(row.get("id_card", "")).strip()
            real_name = str(row.get("real_name", "")).strip()

            if not subsidy_type_id or not payment_year:
                errors.append(f"{real_name or id_card or '?'}：缺少必要字段")
                continue

            # 查找农户
            farmer = _resolve_farmer_for_payment(db, farmer_id, id_card, real_name)
            if not farmer:
                errors.append(f"{real_name or '?'}：农户不存在")
                continue

            if farmer.household_id:
                affected_households.add(farmer.household_id)

            # 唯一性检查
            exists = db.query(SubsidyPayment).filter(
                SubsidyPayment.farmer_id == farmer.id,
                SubsidyPayment.subsidy_type_id == subsidy_type_id,
                SubsidyPayment.payment_year == payment_year,
            ).first()
            if exists:
                skipped += 1
                continue

            snapshot = get_village_snapshot_simple(db, farmer)
            payment = SubsidyPayment(
                farmer_id=farmer.id,
                subsidy_type_id=subsidy_type_id,
                payment_year=payment_year,
                amount=row.get("amount"),
                payment_date=row.get("payment_date"),
                payment_village_id=snapshot["village_id"],
                payment_group_no=snapshot["group_no"],
                payment_village_name=snapshot["village_name"],
                payment_group_display=snapshot["group_display"],
                apply_area=row.get("apply_area"),
                contract_area=row.get("contract_area"),
                trust_area=row.get("trust_area"),
                no_subsidy_area=row.get("no_subsidy_area"),
                bank_card=row.get("bank_card"),
                bank_name=row.get("bank_name"),
                remark=row.get("remark"),
                proxy_remark=row.get("proxy_remark"),
            )
            db.add(payment)

            # 同步申报记录状态
            _sync_application_pay_status(db, farmer.id, subsidy_type_id, payment_year)
            created += 1
        except Exception as e:
            errors.append(str(e))

    db.commit()
    if affected_households:
        recalc_household_cache(db, list(affected_households))
    return {"created": created, "skipped": skipped, "errors": errors}


def _resolve_farmer_for_payment(
    db: Session, farmer_id: int | None, id_card: str, real_name: str
) -> FarmerProfile | None:
    """按 ID 或身份证查找农户"""
    if farmer_id:
        return db.get(FarmerProfile, farmer_id)
    if id_card:
        return db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
    return None


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
    """创建代领关系（含发放记录复制逻辑）"""
    from models import SubsidyProxy

    beneficiary = db.get(FarmerProfile, data["beneficiary_farmer_id"])
    if not beneficiary:
        raise NotFound("受益人不存在")
    proxy_person = db.get(FarmerProfile, data["proxy_farmer_id"])
    if not proxy_person:
        raise NotFound("代领人不存在")

    subsidy_type_id = data.get("subsidy_type_id")

    # 重复检查
    if subsidy_type_id:
        existing = db.query(SubsidyProxy).filter(
            SubsidyProxy.beneficiary_farmer_id == data["beneficiary_farmer_id"],
            SubsidyProxy.subsidy_type_id == subsidy_type_id,
        ).first()
        if existing:
            raise Conflict("该受益人已有此项目的代领关系")

    # 关联申请记录
    if data.get("application_id"):
        app = db.get(SubsidyApplication, data["application_id"])
        if not app:
            raise NotFound("补贴申请记录不存在")
        app.is_proxy = 1
        if not subsidy_type_id:
            subsidy_type_id = app.subsidy_type_id

    # 关联发放记录
    pay_source = None
    if data.get("payment_id"):
        pay_source = db.get(SubsidyPayment, data["payment_id"])
        if not pay_source:
            raise NotFound("补贴发放记录不存在")
        if not subsidy_type_id:
            subsidy_type_id = pay_source.subsidy_type_id
    else:
        # 自动查找代领人的发放记录
        if subsidy_type_id:
            pay_source = db.query(SubsidyPayment).filter(
                SubsidyPayment.farmer_id == data["proxy_farmer_id"],
                SubsidyPayment.subsidy_type_id == subsidy_type_id,
            ).order_by(SubsidyPayment.payment_year.desc()).first()

        # 标记申请记录
        for app in db.query(SubsidyApplication).filter(
            SubsidyApplication.farmer_id == data["proxy_farmer_id"],
            SubsidyApplication.subsidy_type_id == subsidy_type_id,
            SubsidyApplication.is_proxy == 0,
        ).all():
            app.is_proxy = 1

    # 创建代领关系
    proxy_rel = SubsidyProxy(
        **{k: v for k, v in data.items() if k != "subsidy_type_id"},
        subsidy_type_id=subsidy_type_id,
    )
    db.add(proxy_rel)
    db.flush()

    # 复制发放记录
    if pay_source:
        pay_copy = SubsidyPayment(
            farmer_id=data["beneficiary_farmer_id"],
            subsidy_type_id=pay_source.subsidy_type_id,
            payment_year=pay_source.payment_year,
            amount=pay_source.amount,
            payment_date=pay_source.payment_date,
            payment_village_id=pay_source.payment_village_id,
            payment_group_no=pay_source.payment_group_no,
            payment_village_name=pay_source.payment_village_name,
            payment_group_display=pay_source.payment_group_display,
            apply_area=pay_source.apply_area,
            contract_area=pay_source.contract_area,
            trust_area=pay_source.trust_area,
            no_subsidy_area=pay_source.no_subsidy_area,
            bank_card=pay_source.bank_card,
            bank_name=pay_source.bank_name,
            remark=pay_source.remark,
            proxy_remark=data.get("remark") or pay_source.proxy_remark,
            pay_status=pay_source.pay_status,
            is_proxy=proxy_rel.id,
        )
        db.add(pay_copy)
        pay_source.is_proxy = proxy_rel.id

    db.commit()
    db.refresh(proxy_rel)

    # 更新面积缓存
    hh_ids = set()
    if beneficiary.household_id:
        hh_ids.add(beneficiary.household_id)
    if proxy_person.household_id:
        hh_ids.add(proxy_person.household_id)
    if hh_ids:
        recalc_household_cache(db, list(hh_ids))

    return {"id": proxy_rel.id, "message": "代领关系创建成功"}
