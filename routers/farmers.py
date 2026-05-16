"""
农户管理路由（HTTP 编排层）
业务逻辑在 services/farmer_service.py 中实现
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel

from database import get_db
from services import farmer_service
from schemas import FarmerCreate, FarmerUpdate

router = APIRouter(prefix="/api/farmers", tags=["农户管理"])


# ── 列表 ──
@router.get("")
def list_farmers(
    search:       Optional[str]  = Query(None),
    village_name: Optional[str]  = Query(None),
    status:       Optional[int]  = Query(None),
    incomplete:   Optional[bool] = Query(None, description="True=只看信息不完善的农户"),
    page:         int = Query(1, ge=1),
    page_size:    int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return farmer_service.list_farmers(db, search, village_name, status, incomplete, page, page_size)


# ── 详情 ──
@router.get("/{farmer_id}")
def get_farmer(farmer_id: int, db: Session = Depends(get_db)):
    return farmer_service.get_farmer(db, farmer_id)


# ── 新增 ──
@router.post("/")
def create_farmer(data: FarmerCreate, db: Session = Depends(get_db)):
    return farmer_service.create_farmer(db, data.model_dump())


# ── 修改 ──
@router.put("/{farmer_id}")
def update_farmer(farmer_id: int, data: FarmerUpdate, db: Session = Depends(get_db)):
    return farmer_service.update_farmer(db, farmer_id, data.model_dump(exclude_unset=True))


# ── 批量导入 ──
@router.post("/batch-import")
def batch_import_farmers(payload: dict, db: Session = Depends(get_db)):
    rows = payload.get("rows", [])
    overwrite = payload.get("overwrite", False)
    return farmer_service.batch_import_farmers(db, rows, overwrite)


# ── 注销 ──
@router.delete("/{farmer_id}")
def deactivate_farmer(farmer_id: int, status: int = Query(2), db: Session = Depends(get_db)):
    return farmer_service.deactivate_farmer(db, farmer_id, status)


# ── 批量补全农户信息 ──
@router.post("/bulk-complete")
def bulk_complete_farmers(payload: dict, db: Session = Depends(get_db)):
    return farmer_service.bulk_complete_farmers(db, payload.get("rows", []))


# ── 批量按身份证号查找 ──
@router.post("/batch-lookup")
def batch_lookup_farmers(payload: dict, db: Session = Depends(get_db)):
    id_cards = payload.get("id_cards", [])
    return farmer_service.batch_lookup_by_id_cards(db, id_cards)


@router.post("/batch-get-id-cards")
def batch_get_id_cards(payload: dict, db: Session = Depends(get_db)):
    farmer_ids = payload.get("farmer_ids", [])
    return farmer_service.batch_get_id_cards(db, farmer_ids)


# ════════════════════════════════════════════════════════════════
#  家庭关系导入 & 多户主拆分
# ════════════════════════════════════════════════════════════════


class FamilyRelationRow(BaseModel):
    """Excel 中的一行家庭关系数据"""
    row_index: int
    real_name: Optional[str] = None
    id_card: Optional[str] = None
    relation: Optional[str] = None
    age: Optional[int] = None
    address: Optional[str] = None


class ImportFamilyRelationsRequest(BaseModel):
    """批量导入家庭关系请求"""
    rows: list[FamilyRelationRow]
    split_villages: Optional[list[str]] = None


class MultiHeadPreviewRequest(BaseModel):
    """预览多户主拆分请求"""
    village_names: list[str]
    excel_rows: list[FamilyRelationRow]


@router.post("/households-with-multi-head-preview")
def preview_multi_head_households(
    req: MultiHeadPreviewRequest,
    db: Session = Depends(get_db)
):
    return farmer_service.preview_multi_head_households(
        db, req.village_names,
        [r.model_dump() for r in req.excel_rows]
    )


@router.post("/import-relations")
def import_family_relations(req: ImportFamilyRelationsRequest, db: Session = Depends(get_db)):
    return farmer_service.import_family_relations(
        db, [r.model_dump() for r in req.rows],
        split_villages=req.split_villages
    )
