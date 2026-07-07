"""
数据工具 — 导出类接口
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import FamilyHousehold, FarmerProfile, SubsidyApplication, SubsidyPayment, SubsidyType

router = APIRouter(prefix="/api/export", tags=["数据导出"])


@router.post("/household-subsidies")
def export_household_subsidies(payload: dict, db: Session = Depends(get_db)):
    """
    按身份证号查询所属家庭户的所有补贴记录，导出为结构化 JSON。
    同一家庭户的多个身份证不重复导出。
    发放记录优先：有发放则只导出发放记录，无发放则导出预申请。
    """
    id_cards = payload.get("id_cards", [])
    if not id_cards or not isinstance(id_cards, list):
        return {"error": "请提供身份证号列表"}, 400

    # 1. 查农户 → 收集家庭户ID（去重）
    farmers = db.query(FarmerProfile).filter(
        FarmerProfile.id_card.in_(id_cards),
        FarmerProfile.farmer_status == 1,
    ).all()

    household_ids = set()
    farmer_map: dict[str, FarmerProfile] = {}
    for f in farmers:
        farmer_map[f.id_card] = f
        if f.household_id:
            household_ids.add(f.household_id)

    if not household_ids:
        return {"households": [], "total_records": 0, "total_households": 0}

    # 2. 加载家庭户信息
    households = db.query(FamilyHousehold).filter(
        FamilyHousehold.id.in_(list(household_ids))
    ).all()
    hh_map = {hh.id: hh for hh in households}

    # 3. 查出这些家庭户下的所有农户
    hh_farmers = db.query(FarmerProfile).filter(
        FarmerProfile.household_id.in_(household_ids),
        FarmerProfile.farmer_status == 1,
    ).all()
    hh_farmer_ids = [f.id for f in hh_farmers]
    hh_farmer_lookup = {f.id: f for f in hh_farmers}

    # 4. 统计各家庭户下有发放的年份（补贴类型+年份）
    #    发放表
    payments = db.query(SubsidyPayment).filter(
        SubsidyPayment.farmer_id.in_(hh_farmer_ids),
    ).all()
    # 预申请表
    applications = db.query(SubsidyApplication).filter(
        SubsidyApplication.farmer_id.in_(hh_farmer_ids),
    ).all()

    # 加载补贴类型名称
    st_ids = set()
    for p in payments:
        st_ids.add(p.subsidy_type_id)
    for a in applications:
        st_ids.add(a.subsidy_type_id)
    st_map = {}
    if st_ids:
        for st in db.query(SubsidyType).filter(SubsidyType.id.in_(list(st_ids))).all():
            st_map[st.id] = st

    # 5. 按家庭户组织数据
    result_households = []
    total_records = 0

    for hh_id in household_ids:
        hh = hh_map.get(hh_id)
        if not hh:
            continue

        # 该家庭户的农户列表
        hh_members = [f for f in hh_farmers if f.household_id == hh_id]
        member_names = [f.real_name for f in hh_members]
        hh_farmer_id_set = {f.id for f in hh_members}

        # 收集该户所有补贴记录：先看发放
        hh_payments = [p for p in payments if p.farmer_id in hh_farmer_id_set]
        hh_apps = [a for a in applications if a.farmer_id in hh_farmer_id_set]

        # 发放记录：按 (subsidy_type_id, payment_year) 去重
        payment_key_set = set()
        payment_records = []
        for p in hh_payments:
            key = (p.subsidy_type_id, p.payment_year)
            if key not in payment_key_set:
                payment_key_set.add(key)
                farmer = hh_farmer_lookup.get(p.farmer_id)
                st = st_map.get(p.subsidy_type_id)
                payment_records.append({
                    "farmer_name": farmer.real_name if farmer else "",
                    "id_card": farmer.id_card if farmer else "",
                    "subsidy_name": st.subsidy_name if st else "",
                    "subsidy_year": p.payment_year,
                    "apply_area": float(p.apply_area or 0),
                    "apply_area_no_calc": float(p.apply_area_no_calc or 0),
                    "contract_area": float(p.contract_area or 0),
                    "trust_area": float(p.trust_area or 0),
                    "amount": float(p.amount or 0),
                    "pay_status": _pay_status_label(p.pay_status),
                    "pay_date": str(p.payment_date) if p.payment_date else "",
                    "source": "发放",
                })

        # 预申请记录：排除有发放的（subsidy_type_id, apply_year）
        app_records = []
        for a in hh_apps:
            key = (a.subsidy_type_id, a.apply_year)
            if key not in payment_key_set:
                farmer = hh_farmer_lookup.get(a.farmer_id)
                st = st_map.get(a.subsidy_type_id)
                app_records.append({
                    "farmer_name": farmer.real_name if farmer else "",
                    "id_card": farmer.id_card if farmer else "",
                    "subsidy_name": st.subsidy_name if st else "",
                    "subsidy_year": a.apply_year,
                    "apply_area": float(a.apply_area or 0),
                    "apply_area_no_calc": float(a.apply_area_no_calc or 0),
                    "contract_area": float(a.contract_area or 0),
                    "trust_area": float(a.trust_area or 0),
                    "amount": float(a.actual_amount or a.apply_amount or 0),
                    "pay_status": _application_pay_status_label(a.pay_status),
                    "pay_date": str(a.pay_date) if a.pay_date else "",
                    "source": "预申请",
                })

        records = payment_records + app_records
        total_records += len(records)

        result_households.append({
            "household_name": hh.household_name,
            "household_code": hh.household_code,
            "village_name": _get_village_name(db, hh.village_id),
            "group_no": _format_group_no(hh.group_no) if hh.group_no else "",
            "members": member_names,
            "records": records,
        })

    return {
        "households": result_households,
        "total_records": total_records,
        "total_households": len(result_households),
    }


def _pay_status_label(status: int) -> str:
    return {0: "待发放", 1: "部分发放", 2: "已发放", 3: "驳回"}.get(status, "未知")


def _application_pay_status_label(status: int) -> str:
    return {0: "待审核", 1: "审核通过", 2: "已发放", 3: "驳回"}.get(status, "未知")


def _get_village_name(db: Session, village_id: int) -> str:
    from models import Village
    v = db.get(Village, village_id)
    return v.village_name if v else ""


def _format_group_no(n) -> str:
    from utils import format_group_no
    try:
        return format_group_no(int(n))
    except (ValueError, TypeError):
        return str(n) if n else ""
