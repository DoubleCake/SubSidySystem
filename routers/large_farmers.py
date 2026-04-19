"""
种植大户/家庭农场/合作社管理模块
- 大户信息 CRUD
- 大户与普通农户代耕代种关联管理
- 大户面积汇总统计
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from datetime import date as date_type, datetime
from decimal import Decimal

from database import get_db
from models import LargeFarmer, LargeFarmerTrust, FamilyHousehold, LandTrust, Village

router = APIRouter(prefix="/api/large-farmers", tags=["大户管理"])

OPERATOR_TYPE_LABEL = {
    "FAMILY_FARM": "家庭农场",
    "COOPERATIVE": "合作社",
    "LARGE_PLANTER": "种植大户",
    "OTHER": "其他",
}

FARMER_GRADE_LABEL = {
    "PROVINCIAL": "省级",
    "MUNICIPAL": "市级",
    "COUNTY": "县级",
    "ORDINARY": "普通",
}

SOIL_GRADE_LABEL = {
    "EXCELLENT": "优等",
    "GOOD": "良",
    "MEDIUM": "中",
    "POOR": "差",
}

PAYMENT_STATUS_LABEL = {
    "UNPAID": "未支付",
    "PARTIAL": "部分支付",
    "PAID": "已支付",
}

ZONE_TYPE_LABEL = {
    "HIGH_STANDARD": "高标准农田",
    "DEMONSTRATION": "示范片区",
    "ORDINARY": "普通片区",
}

TRUST_TYPE_LABEL = {
    "ENTRUST": "代耕代种",
    "RENT": "出租",
    "TRANSFER": "流转",
}

RELIABILITY_LABEL = {
    "CERTIFIED": "有书面合同",
    "VILLAGE_CONFIRM": "村委确认",
    "SELF_REPORT": "农户自报",
    "SUSPECTED": "存疑",
}


# ══════════════════════════════════════
#  大户信息 CRUD
# ══════════════════════════════════════

@router.get("")
def list_large_farmers(
    village_id: Optional[int] = Query(None, description="所属村ID"),
    operator_type: Optional[str] = Query(None, description="主体类型"),
    status: Optional[int] = Query(1, description="状态：1正常 2注销"),
    keyword: Optional[str] = Query(None, description="搜索关键词"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """查询大户列表"""
    base_where = "lf.status = :status"
    params = {"status": status}

    if village_id:
        base_where += " AND lf.village_id = :village_id"
        params["village_id"] = village_id
    if operator_type:
        base_where += " AND lf.operator_type = :operator_type"
        params["operator_type"] = operator_type
    if keyword:
        base_where += " AND (lf.operator_name LIKE :keyword OR lf.id_card LIKE :keyword OR lf.phone LIKE :keyword)"
        params["keyword"] = f"%{keyword}%"

    count_sql = f"SELECT COUNT(*) FROM large_farmer lf WHERE {base_where}"
    total = db.execute(text(count_sql), params).scalar() or 0

    sql = f"""
        SELECT lf.*,
               v.village_name,
               COALESCE((SELECT SUM(area) FROM large_farmer_trust WHERE large_farmer_id = lf.id AND is_active = 1), 0) AS total_trust_in_area
        FROM large_farmer lf
        LEFT JOIN village v ON v.id = lf.village_id
        WHERE {base_where}
        ORDER BY lf.created_at DESC
        LIMIT :lim OFFSET :off
    """
    rows = db.execute(text(sql), {**params, "lim": page_size, "off": (page-1)*page_size}).fetchall()

    return {
        "total": total,
        "items": [_large_farmer_out(r) for r in rows],
    }


@router.get("/{farmer_id}")
def get_large_farmer(farmer_id: int, db: Session = Depends(get_db)):
    """获取大户详情"""
    row = db.execute(text("""
        SELECT lf.*, v.village_name
        FROM large_farmer lf
        LEFT JOIN village v ON v.id = lf.village_id
        WHERE lf.id = :id
    """), {"id": farmer_id}).fetchone()

    if not row:
        raise HTTPException(404, "大户信息不存在")

    return _large_farmer_out(row)


@router.post("")
def create_large_farmer(data: dict, db: Session = Depends(get_db)):
    """创建大户信息"""
    # 验证所属村必须存在
    village_id = data.get("village_id")
    if not village_id:
        raise HTTPException(400, "请指定所属村")
    if not db.get(Village, village_id):
        raise HTTPException(404, "所属村不存在")

    # 日期处理
    registration_date = data.get("registration_date")
    if isinstance(registration_date, str) and registration_date:
        try:
            registration_date = date_type.fromisoformat(registration_date)
        except:
            registration_date = None

    verified_date = data.get("verified_date")
    if isinstance(verified_date, str) and verified_date:
        try:
            verified_date = date_type.fromisoformat(verified_date)
        except:
            verified_date = None

    farmer = LargeFarmer(
        operator_name=data.get("operator_name"),
        operator_type=data.get("operator_type", "FAMILY_FARM"),
        id_card=data.get("id_card"),
        phone=data.get("phone"),
        bank_card=data.get("bank_card"),
        bank_name=data.get("bank_name"),
        village_id=village_id,
        group_no=data.get("group_no"),
        address=data.get("address"),
        total_managed_area=Decimal(str(data["total_managed_area"])) if data.get("total_managed_area") else None,
        own_contract_area=Decimal(str(data["own_contract_area"])) if data.get("own_contract_area") else None,
        trust_in_area=Decimal(str(data["trust_in_area"])) if data.get("trust_in_area") else None,
        main_crops=data.get("main_crops"),
        registration_no=data.get("registration_no"),
        registration_date=registration_date,
        status=data.get("status", 1),
        is_verified=data.get("is_verified", 0),
        verified_by=data.get("verified_by"),
        verified_date=verified_date,
        remark=data.get("remark"),
        operator=data.get("operator"),
    )
    db.add(farmer)
    db.commit()
    db.refresh(farmer)
    return {"id": farmer.id, "message": "创建成功"}


@router.put("/{farmer_id}")
def update_large_farmer(farmer_id: int, data: dict, db: Session = Depends(get_db)):
    """更新大户信息"""
    farmer = db.get(LargeFarmer, farmer_id)
    if not farmer:
        raise HTTPException(404, "大户信息不存在")

    updatable = [
        "operator_name", "operator_type", "id_card", "phone", "bank_card", "bank_name",
        "village_id", "group_no", "address", "total_managed_area", "own_contract_area",
        "trust_in_area", "main_crops", "registration_no", "registration_date", "status",
        "is_verified", "verified_by", "verified_date", "remark", "operator"
    ]

    for k in updatable:
        if k not in data:
            continue
        v = data[k]
        if k in ("total_managed_area", "own_contract_area", "trust_in_area") and v is not None:
            v = Decimal(str(v))
        if k in ("registration_date", "verified_date") and isinstance(v, str) and v:
            try:
                v = date_type.fromisoformat(v)
            except:
                v = None
        setattr(farmer, k, v)

    db.commit()
    return {"message": "更新成功"}


@router.delete("/{farmer_id}")
def delete_large_farmer(farmer_id: int, db: Session = Depends(get_db)):
    """删除大户信息（软删除）"""
    farmer = db.get(LargeFarmer, farmer_id)
    if not farmer:
        raise HTTPException(404, "大户信息不存在")
    farmer.status = 2
    db.commit()
    return {"message": "已删除"}


def _large_farmer_out(row) -> dict:
    d = dict(row._mapping)
    d["operator_type_label"] = OPERATOR_TYPE_LABEL.get(d.get("operator_type", ""), d.get("operator_type", ""))
    for f in ("total_managed_area", "own_contract_area", "trust_in_area", "total_trust_in_area"):
        if d.get(f) is not None:
            d[f] = float(d[f])
    return d


# ══════════════════════════════════════
#  大户代耕代种关联管理
# ══════════════════════════════════════

@router.get("/{farmer_id}/trusts")
def list_large_farmer_trusts(
    farmer_id: int,
    year: Optional[int] = Query(None, description="流转年度"),
    db: Session = Depends(get_db),
):
    """查询大户的代耕代种关联列表"""
    # 验证大户存在
    if not db.get(LargeFarmer, farmer_id):
        raise HTTPException(404, "大户信息不存在")

    base_where = "lft.large_farmer_id = :farmer_id AND lft.is_active = 1"
    params = {"farmer_id": farmer_id}

    if year:
        base_where += " AND lft.trust_year = :year"
        params["year"] = year

    sql = f"""
        SELECT lft.*,
               oh.household_name AS owner_household_name,
               oh.household_code AS owner_household_code
        FROM large_farmer_trust lft
        LEFT JOIN family_household oh ON oh.id = lft.owner_household_id
        WHERE {base_where}
        ORDER BY lft.trust_year DESC, lft.id DESC
    """
    rows = db.execute(text(sql), params).fetchall()

    return {
        "items": [_large_farmer_trust_out(r) for r in rows],
    }


@router.post("/{farmer_id}/trusts")
def create_large_farmer_trust(farmer_id: int, data: dict, db: Session = Depends(get_db)):
    """创建大户代耕代种关联"""
    # 验证大户存在
    if not db.get(LargeFarmer, farmer_id):
        raise HTTPException(404, "大户信息不存在")

    # 验证流出方必须存在
    owner_household_id = data.get("owner_household_id")
    if not owner_household_id:
        raise HTTPException(400, "请指定流出方（承包人家庭户）")
    if not db.get(FamilyHousehold, owner_household_id):
        raise HTTPException(404, "流出方家庭户不存在")

    # 验证关联的土地流转记录（如果有）
    land_trust_id = data.get("land_trust_id")
    if land_trust_id and not db.get(LandTrust, land_trust_id):
        raise HTTPException(404, "关联的土地流转记录不存在")

    trust_year = data.get("trust_year")
    if not trust_year:
        raise HTTPException(400, "请指定流转年度")

    area = data.get("area")
    if not area:
        raise HTTPException(400, "请指定流转面积")

    # 日期处理
    start_date = data.get("start_date")
    if isinstance(start_date, str) and start_date:
        try:
            start_date = date_type.fromisoformat(start_date)
        except:
            start_date = None

    end_date = data.get("end_date")
    if isinstance(end_date, str) and end_date:
        try:
            end_date = date_type.fromisoformat(end_date)
        except:
            end_date = None

    trust = LargeFarmerTrust(
        large_farmer_id=farmer_id,
        owner_household_id=owner_household_id,
        land_trust_id=land_trust_id,
        trust_year=int(trust_year),
        area=Decimal(str(area)),
        trust_type=data.get("trust_type", "ENTRUST"),
        parcel_desc=data.get("parcel_desc"),
        parcel_location=data.get("parcel_location"),
        contract_no=data.get("contract_no"),
        start_date=start_date,
        end_date=end_date,
        annual_fee=Decimal(str(data["annual_fee"])) if data.get("annual_fee") else None,
        total_fee=Decimal(str(data["total_fee"])) if data.get("total_fee") else None,
        payment_method=data.get("payment_method"),
        data_reliability=data.get("data_reliability", "VILLAGE_CONFIRM"),
        is_active=data.get("is_active", 1),
        affect_subsidy_calc=data.get("affect_subsidy_calc", 1),
        note=data.get("note"),
        operator=data.get("operator"),
    )
    db.add(trust)
    db.commit()
    db.refresh(trust)

    # 自动更新大户的流入面积
    _update_large_farmer_trust_in_area(farmer_id, db)

    return {"id": trust.id, "message": "创建成功"}


@router.put("/{farmer_id}/trusts/{trust_id}")
def update_large_farmer_trust(farmer_id: int, trust_id: int, data: dict, db: Session = Depends(get_db)):
    """更新大户代耕代种关联"""
    trust = db.get(LargeFarmerTrust, trust_id)
    if not trust or trust.large_farmer_id != farmer_id:
        raise HTTPException(404, "代耕代种关联不存在")

    updatable = [
        "owner_household_id", "land_trust_id", "trust_year", "area", "trust_type",
        "parcel_desc", "parcel_location", "contract_no", "start_date", "end_date",
        "annual_fee", "total_fee", "payment_method", "data_reliability", "is_active",
        "affect_subsidy_calc", "note", "operator"
    ]

    for k in updatable:
        if k not in data:
            continue
        v = data[k]
        if k in ("area", "annual_fee", "total_fee") and v is not None:
            v = Decimal(str(v))
        if k in ("start_date", "end_date") and isinstance(v, str) and v:
            try:
                v = date_type.fromisoformat(v)
            except:
                v = None
        setattr(trust, k, v)

    db.commit()

    # 自动更新大户的流入面积
    _update_large_farmer_trust_in_area(farmer_id, db)

    return {"message": "更新成功"}


@router.delete("/{farmer_id}/trusts/{trust_id}")
def delete_large_farmer_trust(farmer_id: int, trust_id: int, db: Session = Depends(get_db)):
    """删除大户代耕代种关联（软删除）"""
    trust = db.get(LargeFarmerTrust, trust_id)
    if not trust or trust.large_farmer_id != farmer_id:
        raise HTTPException(404, "代耕代种关联不存在")
    trust.is_active = 0
    db.commit()

    # 自动更新大户的流入面积
    _update_large_farmer_trust_in_area(farmer_id, db)

    return {"message": "已删除"}


def _large_farmer_trust_out(row) -> dict:
    d = dict(row._mapping)
    d["trust_type_label"] = TRUST_TYPE_LABEL.get(d.get("trust_type", ""), d.get("trust_type", ""))
    d["reliability_label"] = RELIABILITY_LABEL.get(d.get("data_reliability", ""), "")
    for f in ("area", "annual_fee", "total_fee"):
        if d.get(f) is not None:
            d[f] = float(d[f])
    return d


def _update_large_farmer_trust_in_area(farmer_id: int, db: Session):
    """更新大户的流入面积统计"""
    result = db.execute(text("""
        SELECT COALESCE(SUM(area), 0) AS total
        FROM large_farmer_trust
        WHERE large_farmer_id = :farmer_id AND is_active = 1
    """), {"farmer_id": farmer_id}).fetchone()

    total = float(result.total or 0)
    db.execute(text("""
        UPDATE large_farmer
        SET trust_in_area = :total, updated_at = CURRENT_TIMESTAMP
        WHERE id = :farmer_id
    """), {"total": total, "farmer_id": farmer_id})
    db.commit()


# ══════════════════════════════════════
#  大户统计汇总
# ══════════════════════════════════════

@router.get("/summary/by-village")
def summary_by_village(
    year: int = Query(..., description="统计年度"),
    db: Session = Depends(get_db),
):
    """按村统计大户数量和面积"""
    rows = db.execute(text("""
        SELECT
            v.id AS village_id,
            v.village_name,
            COUNT(lf.id) AS large_farmer_count,
            COALESCE(SUM(lf.total_managed_area), 0) AS total_managed_area,
            COALESCE(SUM(lf.trust_in_area), 0) AS total_trust_in_area,
            COUNT(DISTINCT lft.owner_household_id) AS linked_household_count
        FROM village v
        LEFT JOIN large_farmer lf ON lf.village_id = v.id AND lf.status = 1
        LEFT JOIN large_farmer_trust lft ON lft.large_farmer_id = lf.id AND lft.is_active = 1 AND lft.trust_year = :year
        GROUP BY v.id, v.village_name
        ORDER BY v.id
    """), {"year": year}).fetchall()

    return {
        "year": year,
        "items": [
            {
                "village_id": r.village_id,
                "village_name": r.village_name,
                "large_farmer_count": r.large_farmer_count,
                "total_managed_area": float(r.total_managed_area or 0),
                "total_trust_in_area": float(r.total_trust_in_area or 0),
                "linked_household_count": r.linked_household_count,
            }
            for r in rows
        ],
    }


@router.get("/{farmer_id}/area-summary")
def get_large_farmer_area_summary(
    farmer_id: int,
    year: int = Query(..., description="统计年度"),
    db: Session = Depends(get_db),
):
    """获取大户面积详情汇总"""
    # 验证大户存在
    farmer_row = db.execute(text("""
        SELECT lf.*, v.village_name
        FROM large_farmer lf
        LEFT JOIN village v ON v.id = lf.village_id
        WHERE lf.id = :id
    """), {"id": farmer_id}).fetchone()

    if not farmer_row:
        raise HTTPException(404, "大户信息不存在")

    # 获取该年度的代耕代种明细
    trust_rows = db.execute(text("""
        SELECT lft.*,
               oh.household_name AS owner_household_name,
               oh.household_code AS owner_household_code,
               v.village_name AS owner_village_name
        FROM large_farmer_trust lft
        LEFT JOIN family_household oh ON oh.id = lft.owner_household_id
        LEFT JOIN village v ON v.id = oh.village_id
        WHERE lft.large_farmer_id = :farmer_id
          AND lft.trust_year = :year
          AND lft.is_active = 1
        ORDER BY lft.id DESC
    """), {"farmer_id": farmer_id, "year": year}).fetchall()

    # 统计数据
    total_trust_area = sum(float(r.area or 0) for r in trust_rows)
    own_area = float(farmer_row.own_contract_area or 0)
    total_managed = own_area + total_trust_area

    return {
        "farmer_id": farmer_id,
        "year": year,
        "operator_name": farmer_row.operator_name,
        "operator_type_label": OPERATOR_TYPE_LABEL.get(farmer_row.operator_type, ""),
        "village_name": farmer_row.village_name,
        "own_contract_area": own_area,
        "trust_in_area_year": total_trust_area,
        "total_managed_area": total_managed,
        "trust_count": len(trust_rows),
        "trust_details": [_large_farmer_trust_out(r) for r in trust_rows],
    }


# ══════════════════════════════════════
#  地块管理 API
# ══════════════════════════════════════

@router.get("/{farmer_id}/parcels")
def list_large_farmer_parcels(
    farmer_id: int,
    village_id: Optional[int] = Query(None, description="所属村ID"),
    is_high_standard: Optional[int] = Query(None, description="是否高标准农田"),
    is_demonstration: Optional[int] = Query(None, description="是否示范片区"),
    db: Session = Depends(get_db),
):
    """获取大户的地块列表"""
    # 验证大户存在
    if not db.get(LargeFarmer, farmer_id):
        raise HTTPException(404, "大户信息不存在")

    base_where = "lfp.large_farmer_id = :farmer_id AND lfp.is_active = 1"
    params = {"farmer_id": farmer_id}

    if village_id:
        base_where += " AND lfp.village_id = :village_id"
        params["village_id"] = village_id
    if is_high_standard is not None:
        base_where += " AND lfp.is_high_standard = :is_high_standard"
        params["is_high_standard"] = is_high_standard
    if is_demonstration is not None:
        base_where += " AND lfp.is_demonstration = :is_demonstration"
        params["is_demonstration"] = is_demonstration

    sql = f"""
        SELECT lfp.*,
               v.village_name,
               lf.operator_name
        FROM large_farmer_parcel lfp
        LEFT JOIN village v ON v.id = lfp.village_id
        LEFT JOIN large_farmer lf ON lf.id = lfp.large_farmer_id
        WHERE {base_where}
        ORDER BY lfp.id DESC
    """
    rows = db.execute(text(sql), params).fetchall()

    return {
        "items": [_parcel_out(r) for r in rows],
    }


@router.post("/{farmer_id}/parcels")
def create_large_farmer_parcel(farmer_id: int, data: dict, db: Session = Depends(get_db)):
    """添加大户地块"""
    # 验证大户存在
    if not db.get(LargeFarmer, farmer_id):
        raise HTTPException(404, "大户信息不存在")

    village_id = data.get("village_id")
    if not village_id:
        raise HTTPException(400, "请指定地块所属村")
    if not db.get(Village, village_id):
        raise HTTPException(404, "地块所属村不存在")

    area = data.get("area")
    if not area:
        raise HTTPException(400, "请填写地块面积")

    # 日期处理
    start_date = data.get("start_date")
    if isinstance(start_date, str) and start_date:
        try:
            start_date = date_type.fromisoformat(start_date)
        except:
            start_date = None

    end_date = data.get("end_date")
    if isinstance(end_date, str) and end_date:
        try:
            end_date = date_type.fromisoformat(end_date)
        except:
            end_date = None

    from models import LargeFarmerParcel
    parcel = LargeFarmerParcel(
        large_farmer_id=farmer_id,
        trust_id=data.get("trust_id"),
        parcel_name=data.get("parcel_name"),
        area=Decimal(str(area)),
        village_id=village_id,
        group_no=data.get("group_no"),
        parcel_location=data.get("parcel_location"),
        boundary_east=data.get("boundary_east"),
        boundary_west=data.get("boundary_west"),
        boundary_south=data.get("boundary_south"),
        boundary_north=data.get("boundary_north"),
        is_high_standard=data.get("is_high_standard", 0),
        is_demonstration=data.get("is_demonstration", 0),
        zone_name=data.get("zone_name"),
        zone_type=data.get("zone_type"),
        soil_grade=data.get("soil_grade"),
        soil_type=data.get("soil_type"),
        irrigation_level=data.get("irrigation_level"),
        map_coordinates=data.get("map_coordinates"),
        map_geojson=data.get("map_geojson"),
        map_center_lng=Decimal(str(data["map_center_lng"])) if data.get("map_center_lng") else None,
        map_center_lat=Decimal(str(data["map_center_lat"])) if data.get("map_center_lat") else None,
        map_zoom=data.get("map_zoom"),
        current_crop=data.get("current_crop"),
        planting_season=data.get("planting_season"),
        planting_year=data.get("planting_year"),
        is_active=data.get("is_active", 1),
        remark=data.get("remark"),
        operator=data.get("operator"),
    )
    db.add(parcel)
    db.commit()
    db.refresh(parcel)
    return {"id": parcel.id, "message": "创建成功"}


@router.put("/parcels/{parcel_id}")
def update_large_farmer_parcel(parcel_id: int, data: dict, db: Session = Depends(get_db)):
    """更新大户地块"""
    from models import LargeFarmerParcel
    parcel = db.get(LargeFarmerParcel, parcel_id)
    if not parcel:
        raise HTTPException(404, "地块不存在")

    updatable = [
        "trust_id", "parcel_name", "area", "village_id", "group_no", "parcel_location",
        "boundary_east", "boundary_west", "boundary_south", "boundary_north",
        "is_high_standard", "is_demonstration", "zone_name", "zone_type",
        "soil_grade", "soil_type", "irrigation_level",
        "map_coordinates", "map_geojson", "map_center_lng", "map_center_lat", "map_zoom",
        "current_crop", "planting_season", "planting_year",
        "is_active", "remark", "operator"
    ]

    for k in updatable:
        if k not in data:
            continue
        v = data[k]
        if k in ("area", "map_center_lng", "map_center_lat") and v is not None:
            v = Decimal(str(v))
        setattr(parcel, k, v)

    db.commit()
    return {"message": "更新成功"}


@router.delete("/parcels/{parcel_id}")
def delete_large_farmer_parcel(parcel_id: int, db: Session = Depends(get_db)):
    """删除大户地块（软删除）"""
    from models import LargeFarmerParcel
    parcel = db.get(LargeFarmerParcel, parcel_id)
    if not parcel:
        raise HTTPException(404, "地块不存在")
    parcel.is_active = 0
    db.commit()
    return {"message": "已删除"}


def _parcel_out(row) -> dict:
    d = dict(row._mapping)
    d["soil_grade_label"] = SOIL_GRADE_LABEL.get(d.get("soil_grade", ""), d.get("soil_grade", ""))
    for f in ("area", "map_center_lng", "map_center_lat"):
        if d.get(f) is not None:
            d[f] = float(d[f])
    return d


# ══════════════════════════════════════
#  合同到期提醒 API
# ══════════════════════════════════════

@router.get("/contract-reminders")
def get_contract_reminders(
    days_before: int = Query(30, description="提前天数"),
    db: Session = Depends(get_db),
):
    """获取合同到期提醒列表"""
    from datetime import timedelta

    today = date_type.today()
    future_date = today + timedelta(days=days_before)

    sql = """
        SELECT lft.*,
               lf.operator_name,
               oh.household_name AS owner_household_name,
               v.village_name
        FROM large_farmer_trust lft
        LEFT JOIN large_farmer lf ON lf.id = lft.large_farmer_id
        LEFT JOIN family_household oh ON oh.id = lft.owner_household_id
        LEFT JOIN village v ON v.id = lft.parcel_village_id
        WHERE lft.is_active = 1
          AND lft.end_date IS NOT NULL
          AND lft.end_date BETWEEN :today AND :future_date
        ORDER BY lft.end_date ASC
    """
    rows = db.execute(text(sql), {"today": today, "future_date": future_date}).fetchall()

    expired_sql = """
        SELECT lft.*,
               lf.operator_name,
               oh.household_name AS owner_household_name,
               v.village_name
        FROM large_farmer_trust lft
        LEFT JOIN large_farmer lf ON lf.id = lft.large_farmer_id
        LEFT JOIN family_household oh ON oh.id = lft.owner_household_id
        LEFT JOIN village v ON v.id = lft.parcel_village_id
        WHERE lft.is_active = 1
          AND lft.end_date IS NOT NULL
          AND lft.end_date < :today
        ORDER BY lft.end_date DESC
    """
    expired_rows = db.execute(text(expired_sql), {"today": today}).fetchall()

    return {
        "expiring": [_large_farmer_trust_out(r) for r in rows],
        "expired": [_large_farmer_trust_out(r) for r in expired_rows],
        "today": today.isoformat(),
        "future_date": future_date.isoformat(),
    }


# ══════════════════════════════════════
#  统计分析 API
# ══════════════════════════════════════

@router.get("/summary/by-grade")
def summary_by_grade(db: Session = Depends(get_db)):
    """按大户等级统计"""
    rows = db.execute(text("""
        SELECT
            farmer_grade,
            COUNT(*) AS count,
            COALESCE(SUM(total_managed_area), 0) AS total_area
        FROM large_farmer
        WHERE status = 1
        GROUP BY farmer_grade
        ORDER BY farmer_grade
    """)).fetchall()

    return {
        "items": [
            {
                "grade": r.farmer_grade,
                "grade_label": FARMER_GRADE_LABEL.get(r.farmer_grade, r.farmer_grade or "未评级"),
                "count": r.count,
                "total_area": float(r.total_area or 0),
            }
            for r in rows
        ],
    }


@router.get("/summary/by-zone")
def summary_by_zone(year: int = Query(..., description="统计年度"), db: Session = Depends(get_db)):
    """按片区类型统计代耕代种面积"""
    rows = db.execute(text("""
        SELECT
            is_high_standard,
            is_demonstration,
            COUNT(*) AS count,
            COALESCE(SUM(area), 0) AS total_area
        FROM large_farmer_trust
        WHERE is_active = 1
          AND trust_year = :year
        GROUP BY is_high_standard, is_demonstration
    """), {"year": year}).fetchall()

    return {
        "year": year,
        "items": [
            {
                "is_high_standard": bool(r.is_high_standard),
                "is_demonstration": bool(r.is_demonstration),
                "zone_type": "高标准+示范" if r.is_high_standard and r.is_demonstration
                          else "高标准农田" if r.is_high_standard
                          else "示范片区" if r.is_demonstration
                          else "普通片区",
                "count": r.count,
                "total_area": float(r.total_area or 0),
            }
            for r in rows
        ],
    }


@router.get("/summary/by-parcel-village")
def summary_by_parcel_village(year: int = Query(..., description="统计年度"), db: Session = Depends(get_db)):
    """按地块所属村统计代耕代种面积（跨村统计）"""
    rows = db.execute(text("""
        SELECT
            lft.parcel_village_id,
            v.village_name,
            COUNT(*) AS trust_count,
            COALESCE(SUM(lft.area), 0) AS total_area,
            COUNT(DISTINCT lft.large_farmer_id) AS large_farmer_count
        FROM large_farmer_trust lft
        LEFT JOIN village v ON v.id = lft.parcel_village_id
        WHERE lft.is_active = 1
          AND lft.trust_year = :year
          AND lft.parcel_village_id IS NOT NULL
        GROUP BY lft.parcel_village_id, v.village_name
        ORDER BY total_area DESC
    """), {"year": year}).fetchall()

    return {
        "year": year,
        "items": [
            {
                "village_id": r.parcel_village_id,
                "village_name": r.village_name,
                "trust_count": r.trust_count,
                "total_area": float(r.total_area or 0),
                "large_farmer_count": r.large_farmer_count,
            }
            for r in rows
        ],
    }
