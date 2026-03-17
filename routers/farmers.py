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
    # 逐层安全获取，防止 NoneType 错误
    household = farmer.household
    village_full_name = "未划定村组"
    land_area = 0
    address = "地址缺失"

    if household:
        land_area = household.land_area
        address = household.address
        # 尝试获取村组信息
        vg = db.get(VillageGroup, household.village_group_id)
        if vg:
            village_full_name = vg.full_name

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
        "village_full_name": village_full_name, # 如果没组，就显示“未划定村组”
        "land_area": land_area,
        "address": address,
        "remark": farmer.remark,
        "created_at": farmer.created_at,
    }

# ─── 查询列表 ───
@router.get("/")
def list_farmers(
    search: Optional[str] = Query(None),
    village_name: Optional[str] = Query(None),
    status: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    # 【核心修改】使用 outerjoin，保证即便 household_id=0 或关联失效，人也能显示出来
    query = db.query(FarmerProfile).outerjoin(
        FamilyHousehold, FarmerProfile.household_id == FamilyHousehold.id
    ).outerjoin(
        VillageGroup, FamilyHousehold.village_group_id == VillageGroup.id
    )

    # 搜索过滤
    if search:
        query = query.filter(or_(
            FarmerProfile.real_name.contains(search),
            FarmerProfile.id_card.contains(search),
        ))

    # 状态过滤：如果前端传了 status 就过滤，不传就显示所有（含死亡、注销）
    if status is not None:
        query = query.filter(FarmerProfile.farmer_status == status)

    # 村庄名称过滤
    if village_name:
        query = query.filter(VillageGroup.village_name == village_name)

    total = query.count()
    farmers = query.order_by(FarmerProfile.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # 使用 db 实例传递给 _to_out 辅助函数
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

# ─── 批量导入（支持自动创建新村组） ───
@router.post("/batch-import")
def batch_import_farmers(payload: dict, db: Session = Depends(get_db)):
    rows = payload.get("rows", [])
    created, skipped, errors = 0, 0, []
    
    for row in rows:
        try:
            # 1. 身份证唯一性检查
            if db.query(FarmerProfile).filter(FarmerProfile.id_card == row["id_card"]).first():
                skipped += 1
                continue

            # 2. 【核心修改】动态获取或创建村组 ID
            vg_id = row.get("village_group_id")
            
            # 如果前端没匹配到 ID，但传了村名和组名
            if not vg_id and row.get("village_name") and row.get("group_name"):
                v_name = str(row["village_name"]).strip()
                g_name = str(row["group_name"]).strip()
                
                # 去数据库查一下这个组是否存在
                vg = db.query(VillageGroup).filter(
                    VillageGroup.village_name == v_name,
                    VillageGroup.group_no == g_name
                ).first()
                
                if not vg:
                    # 不存在则自动创建一个新的村组
                    new_vg = VillageGroup(
                        village_name=v_name,
                        group_no=g_name,
                        full_name=f"{v_name}{g_name}"
                    )
                    db.add(new_vg)
                    db.flush() # 立即获取 ID
                    vg_id = new_vg.id
                else:
                    vg_id = vg.id

            # 如果到这里还是没有 vg_id，说明 Excel 数据缺失村组信息，记录错误
            if not vg_id:
                errors.append(f"{row.get('real_name','?')}: 缺失有效的村组信息")
                continue

            # 3. 解析身份证信息
            parsed = parse_id_card(row["id_card"])
            
            # 4. 创建农户档案
            farmer = FarmerProfile(
                household_id=0,
                real_name=row["real_name"],
                gender=parsed["gender"] or row.get("gender", 1),
                id_card=row["id_card"],
                birth_date=parsed["birth_date"],
                phone=row.get("phone"),
                bank_card=row.get("bank_card"),
                bank_name=row.get("bank_name"),
                is_head=1, 
                relation="本人",
                farmer_status=row.get("farmer_status", 1),
                remark=row.get("remark"),
            )
            db.add(farmer)
            db.flush()

            # 5. 创建关联的家庭户
            hh = FamilyHousehold(
                household_code=gen_household_code(farmer.id),
                household_name=f"{row['real_name']}户",
                head_farmer_id=farmer.id,
                village_group_id=vg_id, # 使用上面获取到的 vg_id
                address=row.get("address"),
                land_area=row.get("land_area"),
                status=row.get("farmer_status", 1),
                member_count=1,
            )
            db.add(hh)
            db.flush()

            # 6. 回填农户的家庭户 ID
            farmer.household_id = hh.id
            created += 1

        except Exception as e:
            db.rollback() # 出错回滚本条记录
            errors.append(f"{row.get('real_name','?')}: {str(e)}")
            
    db.commit() # 统一提交
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

@router.post("/{farmer_id}/assign-group")
def assign_village_group(
    farmer_id: int, 
    village_group_id: int, 
    db: Session = Depends(get_db)
):
    farmer = db.get(FarmerProfile, farmer_id)
    if not farmer:
        raise HTTPException(status_code=404, detail="农户不存在")

    # 1. 检查或补全家庭户 (FamilyHousehold)
    if not farmer.household or farmer.household_id == 0:
        # 如果是彻彻底底的游离人员，新建一个家庭户
        new_hh = FamilyHousehold(
            household_code=gen_household_code(farmer.id),
            household_name=f"{farmer.real_name}户",
            head_farmer_id=farmer.id,
            village_group_id=village_group_id,
            status=1,
            member_count=1
        )
        db.add(new_hh)
        db.flush()
        farmer.household_id = new_hh.id
    else:
        # 如果已有家庭户，只是想换个村组
        farmer.household.village_group_id = village_group_id

    db.commit()
    return {"message": "归籍成功", "village_group_id": village_group_id}