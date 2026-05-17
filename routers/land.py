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
from models import LandTrust, FamilyHousehold, Village, VillageGroup

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

OPERATOR_TYPE_LABEL = {
    "FAMILY_FARM": "家庭农场",
    "COOPERATIVE": "合作社",
    "LARGE_PLANTER": "种植大户",
    "OTHER": "其他",
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
               oh.household_name AS hh_owner_name,
               oh.household_code AS hh_owner_code,
               ov.village_name AS v_owner_name,
               vg.village_name || vgg.group_no AS vg_owner_name,
               op.household_name AS hh_operator_name,
               op.household_code AS hh_operator_code,
               opv.village_name AS v_operator_name,
               opvg.village_name || opvgg.group_no AS vg_operator_name
        FROM land_trust lt
        LEFT JOIN family_household oh ON oh.id = lt.owner_household_id
        LEFT JOIN village ov ON ov.id = lt.owner_entity_id
        LEFT JOIN village_group vgg ON vgg.id = lt.owner_entity_id
        LEFT JOIN village vg ON vg.id = vgg.village_id
        LEFT JOIN family_household op ON op.id = lt.operator_household_id
        LEFT JOIN village opv ON opv.id = lt.operator_entity_id
        LEFT JOIN village_group opvgg ON opvgg.id = lt.operator_entity_id
        LEFT JOIN village opvg ON opvg.id = opvgg.village_id
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
               oh.household_name AS hh_owner_name,
               oh.household_code AS hh_owner_code,
               ov.village_name AS v_owner_name,
               vg.village_name || vgg.group_no AS vg_owner_name,
               op.household_name AS hh_operator_name,
               op.household_code AS hh_operator_code,
               opv.village_name AS v_operator_name,
               opvg.village_name || opvgg.group_no AS vg_operator_name
        FROM land_trust lt
        LEFT JOIN family_household oh ON oh.id = lt.owner_household_id
        LEFT JOIN village ov ON ov.id = lt.owner_entity_id
        LEFT JOIN village_group vgg ON vgg.id = lt.owner_entity_id
        LEFT JOIN village vg ON vg.id = vgg.village_id
        LEFT JOIN family_household op ON op.id = lt.operator_household_id
        LEFT JOIN village opv ON opv.id = lt.operator_entity_id
        LEFT JOIN village_group opvgg ON opvgg.id = lt.operator_entity_id
        LEFT JOIN village opvg ON opvg.id = opvgg.village_id
        WHERE lt.id = :id
    """), {"id": trust_id}).fetchone()
    return _trust_out(row)


@router.post("/trusts")
def create_trust(data: dict, db: Session = Depends(get_db)):
    owner_type = data.get("owner_type", "household")
    operator_type = data.get("operator_type", "household")

    # 验证流出方
    if owner_type == "household":
        owner_id = data.get("owner_household_id")
        if not owner_id:
            raise HTTPException(400, "家庭户流出方请指定家庭户")
        if not db.get(FamilyHousehold, owner_id):
            raise HTTPException(404, "流出方家庭户不存在")
        owner_entity_id = None
    elif owner_type == "village":
        owner_entity_id = data.get("owner_entity_id")
        if not owner_entity_id:
            raise HTTPException(400, "请指定流出方村")
        if not db.get(Village, owner_entity_id):
            raise HTTPException(404, "流出方村不存在")
        owner_id = None
    elif owner_type == "village_group":
        owner_entity_id = data.get("owner_entity_id")
        if not owner_entity_id:
            raise HTTPException(400, "请指定流出方村组")
        if not db.get(VillageGroup, owner_entity_id):
            raise HTTPException(404, "流出方村组不存在")
        owner_id = None
    else:
        raise HTTPException(400, f"不支持的流出方类型: {owner_type}")

    year = data.get("trust_year")
    if not year:
        raise HTTPException(400, "请指定流转年度")

    # 验证流入方
    op_id = None
    op_entity_id = None
    if operator_type == "household":
        op_id = data.get("operator_household_id")
        if op_id and not db.get(FamilyHousehold, op_id):
            raise HTTPException(404, "流入方家庭户不存在")
    elif operator_type == "village":
        op_entity_id = data.get("operator_entity_id")
        if op_entity_id and not db.get(Village, op_entity_id):
            raise HTTPException(404, "流入方村不存在")
    elif operator_type == "village_group":
        op_entity_id = data.get("operator_entity_id")
        if op_entity_id and not db.get(VillageGroup, op_entity_id):
            raise HTTPException(404, "流入方村组不存在")

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
        owner_type            = owner_type,
        owner_household_id    = owner_id,
        owner_entity_id       = owner_entity_id,
        operator_type         = operator_type,
        operator_household_id = op_id,
        operator_entity_id    = op_entity_id,
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
        subsidy_arable        = int(data.get("subsidy_arable", 1)),
        subsidy_cash_crop     = int(data.get("subsidy_cash_crop", 1)),
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
                 "data_reliability", "affect_subsidy_calc",
                 "subsidy_arable", "subsidy_cash_crop", "note",
                 "owner_type", "owner_household_id", "owner_entity_id",
                 "operator_type", "operator_household_id", "operator_entity_id",
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
    # 根据 owner_type 解析流出方显示名称
    ot = d.get("owner_type", "household")
    if ot == "village":
        d["owner_name"] = d.pop("v_owner_name", "") or ""
        d["owner_code"] = ""
    elif ot == "village_group":
        d["owner_name"] = d.pop("vg_owner_name", "") or ""
        d["owner_code"] = ""
    else:
        d["owner_name"] = d.pop("hh_owner_name", "") or ""
        d["owner_code"] = d.pop("hh_owner_code", "") or ""

    # 根据 operator_type 解析流入方显示名称
    opt = d.get("operator_type", "household")
    if opt == "village":
        d["operator_name"] = d.pop("v_operator_name", "") or ""
        d["operator_code"] = ""
    elif opt == "village_group":
        d["operator_name"] = d.pop("vg_operator_name", "") or ""
        d["operator_code"] = ""
    else:
        d["operator_name"] = d.pop("hh_operator_name", "") or ""
        d["operator_code"] = d.pop("hh_operator_code", "") or ""

    # 清理残留的原始列
    for k in ("hh_owner_name", "hh_owner_code", "v_owner_name", "vg_owner_name",
              "hh_operator_name", "hh_operator_code", "v_operator_name", "vg_operator_name"):
        d.pop(k, None)

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

    # ── 流出面积（该户是 owner，把地给别人种，接收方可以是家庭户/村/村组）──
    out_rows = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS total_out,
               COUNT(*) AS cnt,
               GROUP_CONCAT(trust_type) AS types
        FROM land_trust
        WHERE owner_household_id = :hid
          AND trust_year = :yr
          AND is_active = 1
          AND affect_subsidy_calc = 1
          AND trust_type != 'IDLE'
          AND (operator_household_id IS NOT NULL
               OR (operator_type IN ('village', 'village_group') AND operator_entity_id IS NOT NULL))
    """), {"hid": household_id, "yr": year}).fetchone()
    total_out = float(out_rows.total_out or 0)

    # ── 流入面积（该户是 operator，从别人那接过来种）──
    in_rows = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS total_in,
               COUNT(*) AS cnt,
               GROUP_CONCAT(oh.household_name) AS from_names
        FROM land_trust lt
        LEFT JOIN family_household oh ON oh.id = lt.owner_household_id
        WHERE lt.operator_type = 'household'
          AND lt.operator_household_id = :hid
          AND lt.trust_year = :yr
          AND lt.is_active = 1
          AND lt.affect_subsidy_calc = 1
    """), {"hid": household_id, "yr": year}).fetchone()
    total_in = float(in_rows.total_in or 0)

    # ── 流入面积细分：耕地地力补贴享受（计入单领面积）──
    in_arable = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS arable_area
        FROM land_trust
        WHERE operator_type = 'household'
          AND operator_household_id = :hid
          AND trust_year = :yr
          AND is_active = 1
          AND affect_subsidy_calc = 1
          AND subsidy_arable = 1
    """), {"hid": household_id, "yr": year}).scalar() or 0

    # ── 流入面积细分：经济作物补贴享受（计入大春小春）──
    in_cash_crop = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS cash_crop_area
        FROM land_trust
        WHERE operator_type = 'household'
          AND operator_household_id = :hid
          AND trust_year = :yr
          AND is_active = 1
          AND affect_subsidy_calc = 1
          AND subsidy_cash_crop = 1
    """), {"hid": household_id, "yr": year}).scalar() or 0

    # ── 撂荒面积（流出但没有接收方，或显式标记 IDLE）──
    idle_rows = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS total_idle
        FROM land_trust
        WHERE owner_household_id = :hid
          AND trust_year = :yr
          AND is_active = 1
          AND (trust_type = 'IDLE'
               OR (operator_type = 'household' AND operator_household_id IS NULL
                   AND operator_entity_id IS NULL))
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
               lt.subsidy_arable, lt.subsidy_cash_crop,
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
        "trust_in_area":      round(total_in, 2),      # 流入面积
        "trust_in_arable_area":     round(float(in_arable or 0), 2),      # 流入面积（耕地地力补贴）
        "trust_in_cash_crop_area":  round(float(in_cash_crop or 0), 2),   # 流入面积（经济作物补贴）
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

@router.get("/search-village")
def search_village(q: str = Query("", min_length=0), db: Session = Depends(get_db)):
    """搜索村，用于流转记录的流出/流入方选择"""
    rows = db.execute(text("""
        SELECT id, village_name
        FROM village
        WHERE village_name LIKE :q
        ORDER BY village_name
        LIMIT 20
    """), {"q": f"%{q}%"}).fetchall()
    return [dict(r._mapping) for r in rows]


@router.get("/search-village-group")
def search_village_group(q: str = Query("", min_length=0), db: Session = Depends(get_db)):
    """搜索村组，用于流转记录的流出/流入方选择"""
    rows = db.execute(text("""
        SELECT vg.id, v.village_name, vg.group_no,
               v.village_name || vg.group_no AS full_name
        FROM village_group vg
        JOIN village v ON v.id = vg.village_id
        WHERE v.village_name || vg.group_no LIKE :q
        ORDER BY v.village_name, vg.group_no
        LIMIT 20
    """), {"q": f"%{q}%"}).fetchall()
    return [dict(r._mapping) for r in rows]


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


# ══════════════════════════════════════
#  全量流转记录汇总（包含大户）
# ══════════════════════════════════════

@router.get("/all-trusts")
def list_all_trusts(
    year:         Optional[int] = Query(None, description="流转年度"),
    trust_type:   Optional[str] = Query(None),
    source_type:  Optional[str] = Query(None, description="来源类型：normal普通大户 large_farmer"),
    page:         int = Query(1, ge=1),
    page_size:    int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """
    查询所有流转记录，包含普通流转和大户流转。
    source_type: normal=普通家庭户流转, large_farmer=大户流转, 不传=全部
    """
    all_items = []
    total = 0

    # 1. 查询普通家庭户流转
    if source_type is None or source_type == "normal":
        normal_where = "lt.is_active = 1"
        params: dict = {}

        if year:
            normal_where += " AND lt.trust_year=:yr"
            params["yr"] = year
        if trust_type:
            normal_where += " AND lt.trust_type=:tt"
            params["tt"] = trust_type

        normal_count_sql = f"SELECT COUNT(*) FROM land_trust lt WHERE {normal_where}"
        normal_total = db.execute(text(normal_count_sql), params).scalar() or 0

        normal_sql = f"""
            SELECT lt.*,
                   oh.household_name AS hh_owner_name,
                   oh.household_code AS hh_owner_code,
                   ov.village_name AS v_owner_name,
                   vg.village_name || vgg.group_no AS vg_owner_name,
                   op.household_name AS hh_operator_name,
                   op.household_code AS hh_operator_code,
                   opv.village_name AS v_operator_name,
                   opvg.village_name || opvgg.group_no AS vg_operator_name,
                   'normal' AS source_type,
                   '' AS large_farmer_name,
                   '' AS large_farmer_type
            FROM land_trust lt
            LEFT JOIN family_household oh ON oh.id = lt.owner_household_id
            LEFT JOIN village ov ON ov.id = lt.owner_entity_id
            LEFT JOIN village_group vgg ON vgg.id = lt.owner_entity_id
            LEFT JOIN village vg ON vg.id = vgg.village_id
            LEFT JOIN family_household op ON op.id = lt.operator_household_id
            LEFT JOIN village opv ON opv.id = lt.operator_entity_id
            LEFT JOIN village_group opvgg ON opvgg.id = lt.operator_entity_id
            LEFT JOIN village opvg ON opvg.id = opvgg.village_id
            WHERE {normal_where}
            ORDER BY lt.trust_year DESC, lt.id DESC
        """
        normal_rows = db.execute(text(normal_sql), params).fetchall()

        for r in normal_rows:
            all_items.append(_trust_out(r))
        total += normal_total

    # 2. 查询大户流转
    if source_type is None or source_type == "large_farmer":
        large_where = "lft.is_active = 1"
        params: dict = {}

        if year:
            large_where += " AND lft.trust_year=:yr"
            params["yr"] = year
        if trust_type:
            large_where += " AND lft.trust_type=:tt"
            params["tt"] = trust_type

        large_count_sql = f"SELECT COUNT(*) FROM large_farmer_trust lft WHERE {large_where}"
        large_total = db.execute(text(large_count_sql), params).scalar() or 0

        large_sql = f"""
            SELECT lft.*,
                   oh.household_name AS owner_name,
                   oh.household_code AS owner_code,
                   lf.operator_name AS large_farmer_name,
                   lf.operator_type AS large_farmer_type,
                   'large_farmer' AS source_type,
                   '' AS operator_name,
                   '' AS operator_code
            FROM large_farmer_trust lft
            LEFT JOIN family_household oh ON oh.id = lft.owner_household_id
            LEFT JOIN large_farmer lf ON lf.id = lft.large_farmer_id
            WHERE {large_where}
            ORDER BY lft.trust_year DESC, lft.id DESC
        """
        large_rows = db.execute(text(large_sql), params).fetchall()

        for r in large_rows:
            d = dict(r._mapping)
            d["trust_type_label"] = TRUST_TYPE_LABEL.get(d.get("trust_type",""), d.get("trust_type",""))
            d["reliability_label"] = RELIABILITY_LABEL.get(d.get("data_reliability",""), "")
            d["large_farmer_type_label"] = OPERATOR_TYPE_LABEL.get(d.get("large_farmer_type",""), d.get("large_farmer_type",""))
            for f in ("area", "annual_fee", "total_fee"):
                if d.get(f) is not None:
                    d[f] = float(d[f])
            all_items.append(d)
        total += large_total

    # 按年度和ID排序后分页
    all_items.sort(key=lambda x: (-x.get("trust_year", 0), -x.get("id", 0)))
    paginated_items = all_items[(page-1)*page_size:page*page_size]

    return {
        "total": total,
        "items": paginated_items,
    }


@router.get("/trust-summary-with-large")
def trust_summary_with_large(
    year: int = Query(..., description="流转年度"),
    db: Session = Depends(get_db),
):
    """
    按年度汇总所有流转记录，包含普通流转和大户流转
    """
    # 普通流转汇总
    normal_rows = db.execute(text("""
        SELECT
            lt.trust_type,
            COUNT(*) AS cnt,
            COALESCE(SUM(lt.area), 0) AS total_area
        FROM land_trust lt
        WHERE lt.trust_year = :yr AND lt.is_active = 1
        GROUP BY lt.trust_type
    """), {"yr": year}).fetchall()

    # 大户流转汇总
    large_rows = db.execute(text("""
        SELECT
            lft.trust_type,
            COUNT(*) AS cnt,
            COALESCE(SUM(lft.area), 0) AS total_area
        FROM large_farmer_trust lft
        WHERE lft.trust_year = :yr AND lft.is_active = 1
        GROUP BY lft.trust_type
    """), {"yr": year}).fetchall()

    # 合并汇总
    summary_map = {}
    for r in normal_rows:
        t = r.trust_type
        if t not in summary_map:
            summary_map[t] = {"trust_type": t, "label": TRUST_TYPE_LABEL.get(t, t), "normal_count": 0, "normal_area": 0, "large_count": 0, "large_area": 0, "total_count": 0, "total_area": 0}
        summary_map[t]["normal_count"] = r.cnt
        summary_map[t]["normal_area"] = float(r.total_area or 0)
        summary_map[t]["total_count"] += r.cnt
        summary_map[t]["total_area"] += float(r.total_area or 0)

    for r in large_rows:
        t = r.trust_type
        if t not in summary_map:
            summary_map[t] = {"trust_type": t, "label": TRUST_TYPE_LABEL.get(t, t), "normal_count": 0, "normal_area": 0, "large_count": 0, "large_area": 0, "total_count": 0, "total_area": 0}
        summary_map[t]["large_count"] = r.cnt
        summary_map[t]["large_area"] = float(r.total_area or 0)
        summary_map[t]["total_count"] += r.cnt
        summary_map[t]["total_area"] += float(r.total_area or 0)

    return {
        "year": year,
        "summary": list(summary_map.values()),
    }
