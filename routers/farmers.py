from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional

from database import get_db
from models import FarmerProfile, FamilyHousehold, VillageGroup
from schemas import FarmerCreate, FarmerUpdate, FarmerOut, FarmerDetail
from utils import mask_id_card, mask_phone, mask_bank_card, parse_id_card, gen_household_code

router = APIRouter(prefix="/api/farmers", tags=["农户管理"])


def _to_out(farmer: FarmerProfile, db: Session) -> dict:
    """把 ORM 对象转成响应字典"""
    vg = db.get(VillageGroup, farmer.household.village_group_id) if farmer.household else None
    return {
        "id": farmer.id,
        "household_id": farmer.household_id,
        "real_name": farmer.real_name,
        "gender": farmer.gender,
        "id_card_masked": mask_id_card(farmer.id_card),
        "phone_masked": mask_phone(farmer.phone) if farmer.phone else None,
        "bank_card_masked": mask_bank_card(farmer.bank_card) if farmer.bank_card else None,
        "bank_name": farmer.bank_name,
        "is_head": farmer.is_head,
        "relation": farmer.relation,
        "farmer_status": farmer.farmer_status,
        "village_full_name": vg.full_name if vg else "",
        "land_area": farmer.household.land_area if farmer.household else None,
        "address": farmer.household.address if farmer.household else None,
        "remark": farmer.remark,
        "created_at": farmer.created_at,
    }


# ─── 查询列表 ───
@router.get("/")
def list_farmers(
    search: Optional[str] = Query(None, description="姓名或身份证"),
    village_name: Optional[str] = Query(None),
    status: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(FarmerProfile)

    if search:
        q = q.filter(or_(
            FarmerProfile.real_name.contains(search),
            FarmerProfile.id_card.contains(search),
        ))
    if status is not None:
        q = q.filter(FarmerProfile.farmer_status == status)
    if village_name:
        vg_ids = [
            vg.id for vg in db.query(VillageGroup)
            .filter(VillageGroup.village_name == village_name).all()
        ]
        hh_ids = [
            h.id for h in db.query(FamilyHousehold)
            .filter(FamilyHousehold.village_group_id.in_(vg_ids)).all()
        ]
        q = q.filter(FarmerProfile.household_id.in_(hh_ids))

    total = q.count()
    farmers = q.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_to_out(f, db) for f in farmers],
    }


# ─── 查询详情（含完整敏感字段） ───
@router.get("/{farmer_id}")
def get_farmer(farmer_id: int, db: Session = Depends(get_db)):
    farmer = db.get(FarmerProfile, farmer_id)
    if not farmer:
        raise HTTPException(status_code=404, detail="农户不存在")
    vg = db.get(VillageGroup, farmer.household.village_group_id) if farmer.household else None
    base = _to_out(farmer, db)
    # 详情额外返回完整敏感字段
    base.update({
        "id_card": farmer.id_card,
        "phone": farmer.phone,
        "bank_card": farmer.bank_card,
    })
    return base


# ─── 新增农户（自动创建独立家庭户） ───
@router.post("/")
def create_farmer(data: FarmerCreate, db: Session = Depends(get_db)):
    # 身份证唯一检查
    if db.query(FarmerProfile).filter(FarmerProfile.id_card == data.id_card).first():
        raise HTTPException(status_code=400, detail="该身份证号已存在")

    # 从身份证解析性别和出生日期
    parsed = parse_id_card(data.id_card)
    gender = parsed["gender"] or data.gender
    birth_date = parsed["birth_date"]

    # 1. 先创建农户（拿到 id）
    farmer = FarmerProfile(
        household_id=0,          # 临时占位，下面更新
        real_name=data.real_name,
        gender=gender,
        id_card=data.id_card,
        birth_date=birth_date,
        phone=data.phone,
        bank_card=data.bank_card,
        bank_name=data.bank_name,
        is_head=1,
        relation="本人",
        farmer_status=data.farmer_status,
        remark=data.remark,
    )
    db.add(farmer)
    db.flush()  # 获得 farmer.id，但不提交

    # 2. 自动创建独立家庭户
    household = FamilyHousehold(
        household_code=gen_household_code(farmer.id),
        household_name=f"{data.real_name}户",
        head_farmer_id=farmer.id,
        village_group_id=data.village_group_id,
        address=data.address,
        land_area=data.land_area,
        status=data.farmer_status,
        member_count=1,
    )
    db.add(household)
    db.flush()

    # 3. 回填 household_id
    farmer.household_id = household.id
    db.commit()
    db.refresh(farmer)

    return {"id": farmer.id, "household_id": household.id, "message": "创建成功"}


# ─── 修改农户 ───
@router.put("/{farmer_id}")
def update_farmer(farmer_id: int, data: FarmerUpdate, db: Session = Depends(get_db)):
    farmer = db.get(FarmerProfile, farmer_id)
    if not farmer:
        raise HTTPException(status_code=404, detail="农户不存在")

    update_data = data.model_dump(exclude_unset=True)

    # 村组/地址/面积更新到家庭户
    hh_fields = {}
    if "village_group_id" in update_data:
        hh_fields["village_group_id"] = update_data.pop("village_group_id")
    if "address" in update_data:
        hh_fields["address"] = update_data.pop("address")
    if "land_area" in update_data:
        hh_fields["land_area"] = update_data.pop("land_area")

    for k, v in update_data.items():
        setattr(farmer, k, v)

    if hh_fields and farmer.household:
        for k, v in hh_fields.items():
            setattr(farmer.household, k, v)

    db.commit()
    return {"message": "更新成功"}


# ─── 批量导入 ───
@router.post("/batch-import")
def batch_import_farmers(payload: dict, db: Session = Depends(get_db)):
    rows = payload.get("rows", [])
    created, skipped, errors = 0, 0, []
    for row in rows:
        try:
            if db.query(FarmerProfile).filter(FarmerProfile.id_card == row["id_card"]).first():
                skipped += 1
                continue
            parsed = parse_id_card(row["id_card"])
            farmer = FarmerProfile(
                household_id=0,
                real_name=row["real_name"],
                gender=parsed["gender"] or row.get("gender", 1),
                id_card=row["id_card"],
                birth_date=parsed["birth_date"],
                phone=row.get("phone"),
                bank_card=row.get("bank_card"),
                bank_name=row.get("bank_name"),
                is_head=1, relation="本人",
                farmer_status=row.get("farmer_status", 1),
                remark=row.get("remark"),
            )
            db.add(farmer)
            db.flush()
            hh = FamilyHousehold(
                household_code=gen_household_code(farmer.id),
                household_name=f"{row['real_name']}户",
                head_farmer_id=farmer.id,
                village_group_id=row["village_group_id"],
                address=row.get("address"),
                land_area=row.get("land_area"),
                status=row.get("farmer_status", 1),
                member_count=1,
            )
            db.add(hh)
            db.flush()
            farmer.household_id = hh.id
            created += 1
        except Exception as e:
            errors.append(f"{row.get('real_name','?')}: {str(e)}")
    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


# ─── 注销农户 ───
@router.delete("/{farmer_id}")
def deactivate_farmer(
    farmer_id: int,
    status: int = Query(2, description="2注销 3迁出 4死亡"),
    db: Session = Depends(get_db),
):
    farmer = db.get(FarmerProfile, farmer_id)
    if not farmer:
        raise HTTPException(status_code=404, detail="农户不存在")
    farmer.farmer_status = status
    if farmer.household:
        farmer.household.status = status
    db.commit()
    return {"message": "状态已更新"}
