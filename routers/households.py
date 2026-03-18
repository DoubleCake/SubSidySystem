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
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from decimal import Decimal

from database import get_db
from models import FamilyHousehold, FarmerProfile, VillageGroup, SubsidyApplication, SubsidyType

router = APIRouter(prefix="/api/households", tags=["家庭户管理"])


# ─────────────────────────────────────
#  请求数据结构
# ─────────────────────────────────────

class HouseholdUpdate(BaseModel):
    """更新家庭户基础信息"""
    household_name: Optional[str] = None
    land_area: Optional[float] = None      # 承包土地总面积（亩）
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
#  核心辅助：计算家庭户面积占用情况
# ─────────────────────────────────────

def calc_household_area_usage(
    household_id: int,
    db: Session,
    year: Optional[int] = None
) -> dict:
    """
    计算一个家庭户的面积使用情况：
    - contracted_area: 承包面积（来自 family_household.land_area）
    - used_area:       已被 per_mu 类型补贴占用的面积（当年各项之和）
    - remaining_area:  剩余可申请面积
    - is_overdrawn:    是否超领（used_area > contracted_area）
    - overdraw_amount: 超领面积
    - subsidy_breakdown: 各补贴项目占用面积明细
    """
    hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
    if not hh:
        return {}

    contracted = float(hh.land_area or 0)

    # 查询该户所有成员
    member_ids = [
        f.id for f in db.query(FarmerProfile.id)
                         .filter(FarmerProfile.household_id == household_id)
                         .all()
    ]
    if not member_ids:
        return {
            "contracted_area": contracted, "used_area": 0,
            "remaining_area": contracted, "is_overdrawn": False,
            "overdraw_amount": 0, "subsidy_breakdown": []
        }

    # 查询 per_mu（按亩计算）类型的补贴申请，按年度汇总面积
    query = (
        db.query(
            SubsidyType.subsidy_name,
            SubsidyApplication.apply_year,
            func.sum(SubsidyApplication.apply_area).label("total_area"),
            func.sum(SubsidyApplication.actual_amount).label("total_amount"),
            func.count(SubsidyApplication.id).label("app_count"),
        )
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(
            SubsidyApplication.farmer_id.in_(member_ids),
            SubsidyType.calc_mode == "per_mu",                 # 只统计按亩计算的
            SubsidyApplication.apply_area.isnot(None),
            SubsidyApplication.pay_status.in_([0, 1, 2]),      # 排除驳回的
        )
    )
    if year:
        query = query.filter(SubsidyApplication.apply_year == year)

    results = query.group_by(SubsidyType.subsidy_name, SubsidyApplication.apply_year).all()

    # 按年度汇总
    breakdown: list[dict] = []
    total_used = 0.0
    year_totals: dict[int, float] = {}

    for r in results:
        area = float(r.total_area or 0)
        breakdown.append({
            "subsidy_name": r.subsidy_name,
            "apply_year": r.apply_year,
            "used_area": round(area, 2),
            "total_amount": float(r.total_amount or 0),
            "app_count": r.app_count,
        })
        year_totals[r.apply_year] = year_totals.get(r.apply_year, 0) + area

    # 如果查了特定年度，就用那年的；否则取所有年度各自最大的（不叠加不同年度）
    if year:
        total_used = year_totals.get(year, 0)
    else:
        # 不同年度的面积不叠加（每年独立补贴），取最近年度
        total_used = max(year_totals.values()) if year_totals else 0

    remaining = contracted - total_used
    is_overdrawn = contracted > 0 and total_used > contracted

    return {
        "contracted_area": contracted,
        "used_area": round(total_used, 2),
        "remaining_area": round(remaining, 2),
        "is_overdrawn": is_overdrawn,
        "overdraw_amount": round(max(0, total_used - contracted), 2),
        "subsidy_breakdown": sorted(breakdown, key=lambda x: -x["apply_year"]),
        "year_totals": {str(y): round(v, 2) for y, v in sorted(year_totals.items(), reverse=True)},
    }


# ─────────────────────────────────────
#  接口：家庭户列表
# ─────────────────────────────────────

@router.get("")
def list_households(
    village_name:  Optional[str] = Query(None),
    status:        Optional[int] = Query(None),
    overdrawn_only: bool         = Query(False, description="只显示超领家庭"),
    search:        Optional[str] = Query(None, description="搜索户名/户主姓名"),
    year:          Optional[int] = Query(None, description="指定年度计算面积占用"),
    page:          int           = Query(1, ge=1),
    page_size:     int           = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    家庭户列表，含面积预警信息
    """
    query = (
        db.query(FamilyHousehold)
          .join(VillageGroup, VillageGroup.id == FamilyHousehold.village_group_id)
    )

    if village_name:
        query = query.filter(VillageGroup.village_name == village_name)
    if status is not None:
        query = query.filter(FamilyHousehold.status == status)
    if search:
        # 支持按户名搜索，或按户主姓名搜索
        query = query.outerjoin(
            FarmerProfile,
            (FarmerProfile.household_id == FamilyHousehold.id) & (FarmerProfile.is_head == 1)
        ).filter(
            (FamilyHousehold.household_name.like(f"%{search}%")) |
            (FarmerProfile.real_name.like(f"%{search}%"))
        )

    total = query.count()
    households = query.order_by(FamilyHousehold.id).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for hh in households:
        # 户主信息
        head = db.query(FarmerProfile).filter(
            FarmerProfile.household_id == hh.id,
            FarmerProfile.is_head == 1
        ).first()

        # 成员数
        member_count = db.query(func.count(FarmerProfile.id)).filter(
            FarmerProfile.household_id == hh.id
        ).scalar() or 0

        # 面积信息
        area_info = calc_household_area_usage(hh.id, db, year)

        row = {
            "id": hh.id,
            "household_code": hh.household_code,
            "household_name": hh.household_name,
            "village_full_name": hh.village_group.full_name if hh.village_group else "",
            "village_name": hh.village_group.village_name if hh.village_group else "",
            "head_name": head.real_name if head else "（无户主）",
            "member_count": member_count,
            "status": hh.status,
            "address": hh.address,
            "remark": hh.remark,
            # 面积数据
            "contracted_area": float(hh.land_area or 0),
            "used_area": area_info.get("used_area", 0),
            "remaining_area": area_info.get("remaining_area", 0),
            "is_overdrawn": area_info.get("is_overdrawn", False),
            "overdraw_amount": area_info.get("overdraw_amount", 0),
        }
        items.append(row)

    # 超领过滤（在 Python 层面做，避免复杂 SQL）
    if overdrawn_only:
        items = [i for i in items if i["is_overdrawn"]]
        # 同步更新 total
        total = len(items)

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
        VillageGroup, VillageGroup.id == FamilyHousehold.village_group_id
    )
    if village_name:
        query = query.filter(VillageGroup.village_name == village_name)

    all_hh = query.filter(
        FamilyHousehold.land_area.isnot(None),
        FamilyHousehold.land_area > 0,
    ).all()

    overdrawn = []
    for hh in all_hh:
        area_info = calc_household_area_usage(hh.id, db, year)
        if area_info.get("is_overdrawn"):
            head = db.query(FarmerProfile).filter(
                FarmerProfile.household_id == hh.id,
                FarmerProfile.is_head == 1
            ).first()
            overdrawn.append({
                "household_id": hh.id,
                "household_code": hh.household_code,
                "household_name": hh.household_name,
                "head_name": head.real_name if head else "—",
                "village": hh.village_group.full_name if hh.village_group else "",
                "contracted_area": float(hh.land_area),
                "used_area": area_info["used_area"],
                "overdraw_amount": area_info["overdraw_amount"],
                "subsidy_breakdown": area_info["subsidy_breakdown"],
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
    is_head: Optional[int] = None
    farmer_status: Optional[int] = None
    remark: Optional[str] = None


def _member_out(m: FarmerProfile) -> dict:
    """成员信息序列化（脱敏）"""
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
        "is_head": m.is_head,
        "relation": m.relation,
        "farmer_status": m.farmer_status,
        "remark": m.remark,
        "created_at": m.created_at.isoformat() if m.created_at else None,
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
    ).order_by(FarmerProfile.is_head.desc()).all()

    member_list = [
        {
            "id": m.id,
            "real_name": m.real_name,
            "gender": m.gender,
            "id_card_masked": m.id_card[:6] + "********" + m.id_card[-4:] if m.id_card else "",
            "is_head": m.is_head,
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
            )
            .join(FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id)
            .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
            .filter(SubsidyApplication.farmer_id.in_(member_ids))
            .order_by(SubsidyApplication.apply_year.desc())
            .all()
        )
        app_summary = [
            {
                "apply_year": r.apply_year,
                "farmer_name": r.real_name,
                "subsidy_name": r.subsidy_name,
                "calc_mode": r.calc_mode,
                "apply_area": float(r.apply_area) if r.apply_area else None,
                "apply_amount": float(r.apply_amount) if r.apply_amount else None,
                "actual_amount": float(r.actual_amount) if r.actual_amount else None,
                "pay_status": r.pay_status,
            }
            for r in rows
        ]

    return {
        "id": hh.id,
        "household_code": hh.household_code,
        "household_name": hh.household_name,
        "village_full_name": hh.village_group.full_name if hh.village_group else "",
        "address": hh.address,
        "contracted_area": float(hh.land_area or 0),
        "status": hh.status,
        "remark": hh.remark,
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

    if data.household_name is not None: hh.household_name = data.household_name
    if data.land_area      is not None: hh.land_area      = Decimal(str(data.land_area))
    if data.address        is not None: hh.address        = data.address
    if data.status         is not None: hh.status         = data.status
    if data.remark         is not None: hh.remark         = data.remark

    db.commit()
    return {"message": "更新成功"}


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

    # 如果要成为新户主，先把原户主降级
    if req.is_head == 1:
        old_head = db.query(FarmerProfile).filter(
            FarmerProfile.household_id == req.target_household_id,
            FarmerProfile.is_head == 1
        ).first()
        if old_head:
            old_head.is_head = 0
            old_head.relation = "成员"

    farmer.household_id = req.target_household_id
    farmer.relation     = req.relation
    farmer.is_head      = req.is_head or 0

    # 更新目标户成员数
    target_hh.member_count = db.query(func.count(FarmerProfile.id)).filter(
        FarmerProfile.household_id == req.target_household_id
    ).scalar() or 0 + 1  # +1 因为还没提交

    # 更新原户成员数
    if old_household_id != req.target_household_id:
        old_hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == old_household_id).first()
        if old_hh:
            old_hh.member_count = max(0, (old_hh.member_count or 1) - 1)

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
          .order_by(FarmerProfile.is_head.desc(), FarmerProfile.id)
          .all()
    )
    return [_member_out(m) for m in members]


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

    id_card_clean = data.id_card.strip().upper()

    # 检查身份证是否已存在
    existing = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card_clean).first()

    if existing:
        if existing.household_id == household_id:
            raise HTTPException(400, f"「{existing.real_name}」已是本户成员")
        # 从原家庭户迁入
        old_hh = db.get(FamilyHousehold, existing.household_id)
        existing.household_id = household_id
        existing.relation = data.relation or "成员"
        if data.is_head == 1:
            existing.is_head = 1
        # 更新原户成员计数
        if old_hh:
            old_hh.member_count = max(0, (old_hh.member_count or 1) - 1)
        member = existing
    else:
        # 从身份证推断性别和生日
        parsed = parse_id_card(id_card_clean)
        gender = data.gender if data.gender is not None else (parsed.get("gender", 1) if parsed else 1)

        member = FarmerProfile(
            household_id=household_id,
            real_name=data.real_name,
            gender=gender,
            id_card=id_card_clean,
            birth_date=parsed.get("birth_date") if parsed else None,
            phone=data.phone,
            bank_card=data.bank_card,
            bank_name=data.bank_name,
            relation=data.relation,
            is_head=data.is_head or 0,
            farmer_status=data.farmer_status or 1,
            remark=data.remark,
        )
        db.add(member)

    # 如果新成员是户主，原户主降级
    if (data.is_head == 1):
        old_head = (
            db.query(FarmerProfile)
              .filter(FarmerProfile.household_id == household_id,
                      FarmerProfile.is_head == 1)
              .first()
        )
        if old_head and old_head.id != (existing.id if existing else -1):
            old_head.is_head = 0
            old_head.relation = "成员"

    # 更新户成员计数
    db.flush()
    hh.member_count = db.query(func.count(FarmerProfile.id)).filter(
        FarmerProfile.household_id == household_id
    ).scalar() or 1

    db.commit()
    db.refresh(member)
    return {"message": "添加成功", "member": _member_out(member)}


@router.put("/{household_id}/members/{farmer_id}")
def update_member(household_id: int, farmer_id: int, data: MemberUpdate, db: Session = Depends(get_db)):
    """更新成员信息（姓名、电话、银行卡、关系、状态等）"""
    member = db.query(FarmerProfile).filter(
        FarmerProfile.id == farmer_id,
        FarmerProfile.household_id == household_id
    ).first()
    if not member:
        raise HTTPException(404, "成员不存在或不属于该家庭户")

    # 如果要设为户主，先把原户主降级
    if data.is_head == 1 and member.is_head != 1:
        old_head = db.query(FarmerProfile).filter(
            FarmerProfile.household_id == household_id,
            FarmerProfile.is_head == 1
        ).first()
        if old_head:
            old_head.is_head = 0
            old_head.relation = "成员"

    if data.real_name    is not None: member.real_name    = data.real_name
    if data.phone        is not None: member.phone        = data.phone or None
    if data.bank_card    is not None: member.bank_card    = data.bank_card or None
    if data.bank_name    is not None: member.bank_name    = data.bank_name or None
    if data.relation     is not None: member.relation     = data.relation
    if data.is_head      is not None: member.is_head      = data.is_head
    if data.farmer_status is not None: member.farmer_status = data.farmer_status
    if data.remark       is not None: member.remark       = data.remark or None

    db.commit()
    return {"message": "更新成功", "member": _member_out(member)}


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
    member = db.query(FarmerProfile).filter(
        FarmerProfile.id == farmer_id,
        FarmerProfile.household_id == household_id
    ).first()
    if not member:
        raise HTTPException(404, "成员不存在")
    if member.is_head == 1:
        raise HTTPException(400, "户主不能被移除，请先将其他成员设为户主后再操作")

    hh = db.get(FamilyHousehold, household_id)

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

    if hh:
        hh.member_count = max(0, (hh.member_count or 1) - 1)

    db.commit()
    return {"message": msg}


@router.get("/{household_id}/area-by-year")
def get_area_by_year(household_id: int, db: Session = Depends(get_db)):
    """
    获取该家庭户历年面积占用情况，用于前端按年度展示
    返回每个有数据的年份的面积明细
    """
    hh = db.get(FamilyHousehold, household_id)
    if not hh:
        raise HTTPException(404, "家庭户不存在")

    member_ids = [
        f.id for f in db.query(FarmerProfile.id)
                         .filter(FarmerProfile.household_id == household_id).all()
    ]
    if not member_ids:
        return {"contracted_area": float(hh.land_area or 0), "years": []}

    rows = (
        db.query(
            SubsidyApplication.apply_year,
            SubsidyType.subsidy_name,
            SubsidyType.calc_mode,
            func.sum(SubsidyApplication.apply_area).label("total_area"),
            func.sum(SubsidyApplication.actual_amount).label("total_amount"),
            func.count(SubsidyApplication.id).label("app_count"),
        )
        .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
        .filter(
            SubsidyApplication.farmer_id.in_(member_ids),
            SubsidyType.calc_mode == "per_mu",
            SubsidyApplication.apply_area.isnot(None),
            SubsidyApplication.pay_status.in_([0, 1, 2]),
        )
        .group_by(SubsidyApplication.apply_year, SubsidyType.subsidy_name, SubsidyType.calc_mode)
        .order_by(SubsidyApplication.apply_year.desc())
        .all()
    )

    # 按年份聚合
    year_map: dict = {}
    contracted = float(hh.land_area or 0)
    for r in rows:
        y = r.apply_year
        if y not in year_map:
            year_map[y] = {"year": y, "total_used": 0.0, "details": []}
        area = float(r.total_area or 0)
        year_map[y]["total_used"] = round(year_map[y]["total_used"] + area, 2)
        year_map[y]["details"].append({
            "subsidy_name": r.subsidy_name,
            "used_area": round(area, 2),
            "total_amount": float(r.total_amount or 0),
            "app_count": r.app_count,
        })

    year_list = sorted(year_map.values(), key=lambda x: -x["year"])
    for y in year_list:
        y["contracted_area"] = contracted
        y["remaining_area"]  = round(contracted - y["total_used"], 2)
        y["is_overdrawn"]    = contracted > 0 and y["total_used"] > contracted
        y["overdraw_amount"] = round(max(0, y["total_used"] - contracted), 2)

    return {"contracted_area": contracted, "years": year_list}
