from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models import FamilyHousehold, Village

router = APIRouter(prefix="/api/settings", tags=["基础设置"])


# ─────────────────────────────────────────
#  Village CRUD
# ─────────────────────────────────────────

class VillageCreate(BaseModel):
    village_name: str

class VillageUpdate(BaseModel):
    village_name: Optional[str] = None

@router.get("/villages")
def list_villages(db: Session = Depends(get_db)):
    items = db.query(Village).order_by(Village.village_name).all()
    return [
        {
            "id": v.id,
            "village_name": v.village_name,
            "household_count": len(v.households),
        }
        for v in items
    ]

@router.post("/villages")
def create_village(data: VillageCreate, db: Session = Depends(get_db)):
    exists = db.query(Village).filter(Village.village_name == data.village_name).first()
    if exists:
        raise HTTPException(status_code=400, detail=f"村「{data.village_name}」已存在")
    v = Village(village_name=data.village_name)
    db.add(v)
    db.commit()
    db.refresh(v)
    return {"id": v.id, "message": "创建成功"}

@router.put("/villages/{village_id}")
def update_village(village_id: int, data: VillageUpdate, db: Session = Depends(get_db)):
    v = db.get(Village, village_id)
    if not v:
        raise HTTPException(status_code=404, detail="村不存在")
    if data.village_name:
        v.village_name = data.village_name
    db.commit()
    return {"message": "更新成功"}

@router.delete("/villages/{village_id}")
def delete_village(village_id: int, db: Session = Depends(get_db)):
    v = db.get(Village, village_id)
    if not v:
        raise HTTPException(status_code=404, detail="村不存在")
    hh_count = db.query(FamilyHousehold).filter(FamilyHousehold.village_id == village_id).count()
    if hh_count > 0:
        raise HTTPException(status_code=400, detail=f"该村下有 {hh_count} 户，无法删除")
    db.delete(v)
    db.commit()
    return {"message": "删除成功"}
