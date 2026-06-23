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


class MatchPeopleRow(BaseModel):
    name: Optional[str] = None
    real_name: Optional[str] = None
    village: Optional[str] = None
    village_name: Optional[str] = None
    phone: Optional[str] = None
    # 支持中文列名
    姓名: Optional[str] = None
    名字: Optional[str] = None
    村名: Optional[str] = None
    村: Optional[str] = None
    电话号码: Optional[str] = None
    电话: Optional[str] = None
    手机: Optional[str] = None


class MatchPeopleRequest(BaseModel):
    rows: list[dict]


@router.post("/match-people")
def match_people(req: MatchPeopleRequest, db: Session = Depends(get_db)):
    """人员模糊匹配：输入姓名+村名+电话，匹配数据库中的农户"""
    return farmer_service.match_people(db, req.rows)


@router.post("/verify-names")
def verify_names(payload: dict, db: Session = Depends(get_db)):
    """
    数据验证：比对输入姓名+身份证号与数据库是否一致。
    输入: { rows: [{ name: "张三", id_card: "510123..." }] }
    """
    from models import FarmerProfile
    rows = payload.get("rows", [])
    results = []
    for i, row in enumerate(rows):
        name = (row.get("name") or "").strip()
        ic = (row.get("id_card") or "").strip()
        if not ic or len(ic) != 18:
            results.append({"row": i + 1, "input_name": name, "input_id_card": ic, "db_name": None, "db_village": None, "match": "invalid"})
            continue
        fp = db.query(FarmerProfile).filter(FarmerProfile.id_card == ic).first()
        if not fp:
            results.append({"row": i + 1, "input_name": name, "input_id_card": ic, "db_name": None, "db_village": None, "match": "not_found"})
            continue
        db_village = fp.household.village.village_name if fp.household and fp.household.village else ""
        name_match = name and (name == fp.real_name or fp.real_name in name or name in fp.real_name)
        results.append({
            "row": i + 1, "input_name": name, "input_id_card": ic,
            "db_name": fp.real_name, "db_village": db_village,
            "match": "ok" if name_match else "mismatch",
        })
    return {"results": results, "total": len(results)}
