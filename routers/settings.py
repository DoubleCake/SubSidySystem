from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models import VillageGroup, FamilyHousehold

router = APIRouter(prefix="/api/settings", tags=["基础设置"])


class VillageGroupCreate(BaseModel):
    village_name: str
    group_no: str
    full_name: Optional[str] = None  # 不传则自动生成


class VillageGroupUpdate(BaseModel):
    village_name: Optional[str] = None
    group_no: Optional[str] = None
    full_name: Optional[str] = None


@router.get("/village-groups")
def list_village_groups(db: Session = Depends(get_db)):
    items = db.query(VillageGroup).order_by(
        VillageGroup.village_name, VillageGroup.group_no
    ).all()
    return [
        {
            "id": v.id,
            "village_name": v.village_name,
            "group_no": v.group_no,
            "full_name": v.full_name,
            "household_count": db.query(FamilyHousehold)
                .filter(FamilyHousehold.village_group_id == v.id).count(),
        }
        for v in items
    ]


@router.post("/village-groups")
def create_village_group(data: VillageGroupCreate, db: Session = Depends(get_db)):
    full_name = data.full_name or f"{data.village_name}{data.group_no}"
    # 检查重复
    exists = db.query(VillageGroup).filter(
        VillageGroup.village_name == data.village_name,
        VillageGroup.group_no == data.group_no,
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail=f"「{full_name}」已存在")
    vg = VillageGroup(
        village_name=data.village_name,
        group_no=data.group_no,
        full_name=full_name,
    )
    db.add(vg)
    db.commit()
    db.refresh(vg)
    return {"id": vg.id, "message": "创建成功"}


@router.put("/village-groups/{vg_id}")
def update_village_group(vg_id: int, data: VillageGroupUpdate, db: Session = Depends(get_db)):
    vg = db.get(VillageGroup, vg_id)
    if not vg:
        raise HTTPException(status_code=404, detail="村组不存在")
    if data.village_name: vg.village_name = data.village_name
    if data.group_no:     vg.group_no = data.group_no
    if data.full_name:    vg.full_name = data.full_name
    else:
        vg.full_name = f"{vg.village_name}{vg.group_no}"
    db.commit()
    return {"message": "更新成功"}


@router.delete("/village-groups/{vg_id}")
def delete_village_group(vg_id: int, db: Session = Depends(get_db)):
    vg = db.get(VillageGroup, vg_id)
    if not vg:
        raise HTTPException(status_code=404, detail="村组不存在")
    count = db.query(FamilyHousehold).filter(
        FamilyHousehold.village_group_id == vg_id
    ).count()
    if count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该村组下有 {count} 户农户，无法删除，请先迁移农户"
        )
    db.delete(vg)
    db.commit()
    return {"message": "删除成功"}


@router.post("/village-groups/batch")
def batch_create_village_groups(payload: dict, db: Session = Depends(get_db)):
    """批量创建村组，已存在的跳过"""
    rows = payload.get("rows", [])
    created, skipped = 0, 0
    for row in rows:
        vname = row.get("village_name", "").strip()
        gno   = row.get("group_no", "").strip()
        if not vname or not gno:
            skipped += 1
            continue
        exists = db.query(VillageGroup).filter(
            VillageGroup.village_name == vname,
            VillageGroup.group_no == gno,
        ).first()
        if exists:
            skipped += 1
            continue
        full_name = row.get("full_name") or f"{vname}{gno}"
        db.add(VillageGroup(village_name=vname, group_no=gno, full_name=full_name))
        created += 1
    db.commit()
    return {"created": created, "skipped": skipped}
