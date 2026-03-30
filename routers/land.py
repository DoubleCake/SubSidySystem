"""
土地信息维护模块
- 流转台账 CRUD（一年一签，按年度管理）
- 面积汇总：计算家庭户的实际可耕种面积（承包 + 净流入）
- 超领重算：纳入流转后的精确超领预警

设计原则：所有字段尽量可选，基础信息不完善也能录入
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from datetime import date as date_type, datetime
from decimal import Decimal

from database import get_db
from models import LandTrust, FamilyHousehold

router = APIRouter(prefix="/api/land", tags=["土地信息"])

TRUST_TYPE_LABEL = {
    "ENTRUST":    "代耕代种",
    "RENT":       "出租",
    "TRANSFER":   "流转",
    "IDLE":       "撂荒",
    "COLLECTIVE": "集体统一经营",
}

RELIABILITY_LABEL = {
    "CERTIFIED":       "有书面合同",
    "VILLAGE_CONFIRM": "村委确认",
    "SELF_REPORT":     "农户自报",
    "SUSPECTED":       "存疑",
}


# ══════════════════════════════════════
#  流转台账 CRUD
# ══════════════════════════════════════

@router.get("/trusts")
def list_trusts(
    household_id: Optional[int] = Query(None, description="家庭户id（流出或流入方）"),
    year:         Optional[int] = Query(None, description="流转年度"),
    trust_type:   Optional[str] = Query(None),
    page:         int = Query(1, ge=1),
    page_size:    int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """
    查询流转记录。可按家庭户（不区分流出/流入方向）、年度、类型筛选。
    """
    base_where = "lt.is_active = 1"
    params: dict = {}

    if household_id:
        base_where += " AND (lt.owner_household_id=:hid OR lt.operator_household_id=:hid)"
        params["hid"] = household_id
    if year:
        base_where += " AND lt.trust_year=:yr"
        params["yr"] = year
    if trust_type:
        base_where += " AND lt.trust_type=:tt"
        params["tt"] = trust_type

    count_sql = f"SELECT COUNT(*) FROM land_trust lt WHERE {base_where}"
    total = db.execute(text(count_sql), params).scalar() or 0

    sql = f"""
        SELECT lt.*,
               oh.household_name AS owner_name,
               oh.household_code AS owner_code,
               op.household_name AS operator_name,
               op.household_code AS operator_code
        FROM land_trust lt
        LEFT JOIN family_household oh ON oh.id = lt.owner_household_id
        LEFT JOIN family_household op ON op.id = lt.operator_household_id
        WHERE {base_where}
        ORDER BY lt.trust_year DESC, lt.id DESC
        LIMIT :lim OFFSET :off
    """
    rows = db.execute(text(sql), {**params, "lim": page_size, "off": (page-1)*page_size}).fetchall()

    return {
        "total": total,
        "items": [_trust_out(r) for r in rows],
    }


@router.get("/trusts/{trust_id}")
def get_trust(trust_id: int, db: Session = Depends(get_db)):
    t = db.get(LandTrust, trust_id)
    if not t or not t.is_active:
        raise HTTPException(404, "记录不存在")
    row = db.execute(text("""
        SELECT lt.*,
               oh.household_name AS owner_name, oh.household_code AS owner_code,
               op.household_name AS operator_name, op.household_code AS operator_code
        FROM land_trust lt
        LEFT JOIN family_household oh ON oh.id = lt.owner_household_id
        LEFT JOIN family_household op ON op.id = lt.operator_household_id
        WHERE lt.id = :id
    """), {"id": trust_id}).fetchone()
    return _trust_out(row)


@router.post("/trusts")
def create_trust(data: dict, db: Session = Depends(get_db)):
    # 验证流出方必须存在
    owner_id = data.get("owner_household_id")
    if not owner_id:
        raise HTTPException(400, "请指定流出方（承包人家庭户）")
    if not db.get(FamilyHousehold, owner_id):
        raise HTTPException(404, "流出方家庭户不存在")

    year = data.get("trust_year")
    if not year:
        raise HTTPException(400, "请指定流转年度")

    # operator 可以为空（撂荒/集体时）
    op_id = data.get("operator_household_id")
    if op_id and not db.get(FamilyHousehold, op_id):
        raise HTTPException(404, "流入方家庭户不存在")

    # 日期处理
    start = data.get("start_date")
    end   = data.get("end_date")
    if isinstance(start, str) and start:
        try: start = date_type.fromisoformat(start)
        except: start = None
    if isinstance(end, str) and end:
        try: end = date_type.fromisoformat(end)
        except: end = None

    trust = LandTrust(
        owner_household_id    = owner_id,
        operator_household_id = op_id,
        trust_type            = data.get("trust_type", "ENTRUST"),
        area                  = Decimal(str(data["area"])) if data.get("area") else None,
        trust_year            = int(year),
        start_date            = start,
        end_date              = end,
        annual_fee            = Decimal(str(data["annual_fee"])) if data.get("annual_fee") else None,
        payment_method        = data.get("payment_method"),
        fee_note              = data.get("fee_note"),
        parcel_desc           = data.get("parcel_desc"),
        data_reliability      = data.get("data_reliability", "VILLAGE_CONFIRM"),
        affect_subsidy_calc   = int(data.get("affect_subsidy_calc", 1)),
        note                  = data.get("note"),
        operator              = data.get("operator"),
    )
    db.add(trust); db.commit(); db.refresh(trust)
    return {"id": trust.id, "message": "创建成功"}


@router.put("/trusts/{trust_id}")
def update_trust(trust_id: int, data: dict, db: Session = Depends(get_db)):
    trust = db.get(LandTrust, trust_id)
    if not trust or not trust.is_active:
        raise HTTPException(404, "记录不存在")

    updatable = ["trust_type", "area", "trust_year", "start_date", "end_date",
                 "annual_fee", "payment_method", "fee_note", "parcel_desc",
                 "data_reliability", "affect_subsidy_calc", "note",
                 "owner_household_id", "operator_household_id",
                 "verified_by", "verified_date"]

    for k in updatable:
        if k not in data: continue
        v = data[k]
        if k in ("area", "annual_fee") and v is not None:
            v = Decimal(str(v))
        if k in ("start_date", "end_date", "verified_date") and isinstance(v, str) and v:
            try: v = date_type.fromisoformat(v)
            except: v = None
        setattr(trust, k, v)

    db.commit()
    return {"message": "更新成功"}


@router.delete("/trusts/{trust_id}")
def delete_trust(trust_id: int, db: Session = Depends(get_db)):
    trust = db.get(LandTrust, trust_id)
    if not trust: raise HTTPException(404, "记录不存在")
    trust.is_active = 0; db.commit()
    return {"message": "已删除"}


def _trust_out(row) -> dict:
    d = dict(row._mapping)
    d["trust_type_label"]    = TRUST_TYPE_LABEL.get(d.get("trust_type",""), d.get("trust_type",""))
    d["reliability_label"]   = RELIABILITY_LABEL.get(d.get("data_reliability",""), "")
    # 数值字段转 float
    for f in ("area", "annual_fee"):
        if d.get(f) is not None:
            d[f] = float(d[f])
    return d


# ══════════════════════════════════════
#  面积汇总接口（含流转）
# ══════════════════════════════════════

@router.get("/area-summary/{household_id}")
def get_area_summary(
    household_id: int,
    year: int = Query(..., description="查询年度"),
    db: Session = Depends(get_db),
):
    """
    计算家庭户在指定年度的完整面积情况：
    
    承包面积：来自 family_household.contract_area（权属面积，不变）
    流出面积：该年度流转给他人的面积之和（减少可耕种面积，不影响承包权）
    流入面积：该年度从他人流入的面积之和（增加可耕种面积）
    可耕种面积 = 承包面积 - 流出面积 + 流入面积
    
    已申报补贴面积：当年所有按亩补贴的申请面积之和
    超领判断：已申报面积 > 可耕种面积
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh: raise HTTPException(404, "家庭户不存在")

    contracted = float(hh.contract_area or 0)

    # ── 流出面积（该户是 owner，把地给别人种）──
    out_rows = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS total_out,
               COUNT(*) AS cnt,
               GROUP_CONCAT(trust_type) AS types
        FROM land_trust
        WHERE owner_household_id = :hid
          AND trust_year = :yr
          AND is_active = 1
          AND affect_subsidy_calc = 1
          AND trust_type != 'IDLE'       -- 撂荒不算流出（地还是自己的，只是没种）
          AND operator_household_id IS NOT NULL  -- 有明确接收方才算流出
    """), {"hid": household_id, "yr": year}).fetchone()
    total_out = float(out_rows.total_out or 0)

    # ── 流入面积（该户是 operator，从别人那接过来种）──
    in_rows = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS total_in,
               COUNT(*) AS cnt,
               GROUP_CONCAT(oh.household_name) AS from_names
        FROM land_trust lt
        LEFT JOIN family_household oh ON oh.id = lt.owner_household_id
        WHERE lt.operator_household_id = :hid
          AND lt.trust_year = :yr
          AND lt.is_active = 1
          AND lt.affect_subsidy_calc = 1
    """), {"hid": household_id, "yr": year}).fetchone()
    total_in = float(in_rows.total_in or 0)

    # ── 撂荒面积（流出但没有接收方，或显式标记 IDLE）──
    idle_rows = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS total_idle
        FROM land_trust
        WHERE owner_household_id = :hid
          AND trust_year = :yr
          AND is_active = 1
          AND (trust_type = 'IDLE' OR operator_household_id IS NULL)
    """), {"hid": household_id, "yr": year}).fetchone()
    total_idle = float(idle_rows.total_idle or 0)

    cultivable = contracted - total_out + total_in
    cultivable = max(0.0, cultivable)  # 不能为负

    # ── 当年已申报的按亩补贴面积 ──
    member_ids = db.execute(text(
        "SELECT id FROM farmer_profile WHERE household_id=:hid"
    ), {"hid": household_id}).fetchall()
    mid_list = [r[0] for r in member_ids]

    applied = 0.0
    subsidy_detail = []
    if mid_list:
        app_rows = db.execute(text(f"""
            SELECT st.subsidy_name, st.count_toward_area,
                   COALESCE(SUM(sa.apply_area),0) AS applied_area,
                   COALESCE(SUM(sa.actual_amount),0) AS actual_amount,
                   COUNT(sa.id) AS cnt
            FROM subsidy_application sa
            JOIN subsidy_type st ON sa.subsidy_type_id = st.id
            WHERE sa.farmer_id IN ({','.join(str(i) for i in mid_list)})
              AND sa.apply_year = :yr
              AND sa.apply_area IS NOT NULL
              AND sa.pay_status != 3
              AND st.calc_mode = 'per_mu'
              AND st.count_toward_area = 1
            GROUP BY st.id
        """), {"yr": year}).fetchall()

        for r in app_rows:
            area = float(r.applied_area or 0)
            applied += area
            subsidy_detail.append({
                "subsidy_name":  r.subsidy_name,
                "applied_area":  round(area, 2),
                "actual_amount": float(r.actual_amount or 0),
                "count":         r.cnt,
            })

    is_overdrawn   = cultivable > 0 and applied > cultivable
    overdraw_amount = max(0.0, applied - cultivable) if is_overdrawn else 0.0

    # ── 流转记录明细 ──
    trust_detail = db.execute(text("""
        SELECT lt.id, lt.trust_type, lt.area, lt.data_reliability,
               lt.parcel_desc, lt.annual_fee, lt.payment_method,
               oh.household_name AS owner_name,
               op.household_name AS operator_name
        FROM land_trust lt
        LEFT JOIN family_household oh ON oh.id = lt.owner_household_id
        LEFT JOIN family_household op ON op.id = lt.operator_household_id
        WHERE (lt.owner_household_id=:hid OR lt.operator_household_id=:hid)
          AND lt.trust_year=:yr AND lt.is_active=1
        ORDER BY lt.trust_type, lt.id
    """), {"hid": household_id, "yr": year}).fetchall()

    return {
        "household_id":   household_id,
        "year":           year,
        # 面积三件套
        "contracted_area": contracted,          # 承包面积（权属）
        "trust_out_area":  round(total_out, 2), # 流出面积
        "trust_in_area":   round(total_in, 2),  # 流入面积
        "idle_area":       round(total_idle, 2), # 撂荒面积
        "cultivable_area": round(cultivable, 2), # 实际可耕种面积（用于超领判断）
        # 补贴申报
        "applied_area":    round(applied, 2),    # 当年已申报面积
        "is_overdrawn":    is_overdrawn,
        "overdraw_amount": round(overdraw_amount, 2),
        # 明细
        "subsidy_breakdown": subsidy_detail,
        "trust_records":     [dict(r._mapping) for r in trust_detail],
        # 提示
        "has_trust_data":    len(trust_detail) > 0,
        "cultivable_note":   f"承包{contracted}亩 - 流出{total_out}亩 + 流入{total_in}亩 = 可耕{cultivable:.2f}亩"
                             if contracted > 0 else "承包面积未设置",
    }


# ══════════════════════════════════════
#  批量查询多个家庭户的流转面积
# ══════════════════════════════════════

@router.get("/trust-summary-by-year")
def trust_summary_by_year(year: int = Query(...), db: Session = Depends(get_db)):
    """按年度汇总所有流转关系，供首页/预警使用"""
    rows = db.execute(text("""
        SELECT
            lt.trust_type,
            COUNT(*) AS cnt,
            COALESCE(SUM(lt.area), 0) AS total_area,
            COUNT(CASE WHEN lt.data_reliability='SELF_REPORT' THEN 1 END) AS unverified_cnt
        FROM land_trust lt
        WHERE lt.trust_year = :yr AND lt.is_active = 1
        GROUP BY lt.trust_type
    """), {"yr": year}).fetchall()

    return {
        "year": year,
        "summary": [{
            "trust_type": r.trust_type,
            "label": TRUST_TYPE_LABEL.get(r.trust_type, r.trust_type),
            "count": r.cnt,
            "total_area": float(r.total_area),
            "unverified_count": r.unverified_cnt,
        } for r in rows]
    }


# ══════════════════════════════════════
#  家庭户搜索（用于选择流入/流出方）
# ══════════════════════════════════════

@router.get("/search-household")
def search_household(q: str = Query("", min_length=0), db: Session = Depends(get_db)):
    """快速搜索家庭户，用于流转记录的流入/流出方选择"""
    rows = db.execute(text("""
        SELECT hh.id, hh.household_code, hh.household_name, hh.contract_area,
               fp.real_name AS head_name,
               COALESCE(v.village_name, '') AS village_name,
               COALESCE(hh.group_no, 1) AS group_no
        FROM family_household hh
        LEFT JOIN farmer_profile fp ON fp.id = hh.head_farmer_id
        LEFT JOIN village v ON v.id = hh.village_id
        WHERE hh.status = 1
          AND (hh.household_name LIKE :q OR hh.household_code LIKE :q OR fp.real_name LIKE :q)
        LIMIT 20
    """), {"q": f"%{q}%"}).fetchall()
    from utils import format_group_no
    return [
        {**dict(r._mapping), "village_full_name": f"{r.village_name or ''}{format_group_no(r.group_no)}"}
        for r in rows
    ]
