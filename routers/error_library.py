from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from database import get_db
from models import ErrorLibrary
from schemas import ErrorLibraryCreate, ErrorLibraryOut

router = APIRouter(prefix="/api/error-library", tags=["错误库"])


@router.get("")
def list_error_library(
    search: Optional[str] = Query(None, description="搜索姓名或身份证"),
    error_type: Optional[str] = Query(None, description="错误类型筛选"),
    village_name: Optional[str] = Query(None, description="村名筛选"),
    subsidy_name: Optional[str] = Query(None, description="补贴分类筛选"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(ErrorLibrary)
    if search:
        q = q.filter(or_(
            ErrorLibrary.real_name.contains(search),
            ErrorLibrary.id_card.contains(search),
        ))
    if error_type:
        q = q.filter(ErrorLibrary.error_type == error_type)
    if village_name:
        q = q.filter(ErrorLibrary.village_name == village_name)
    if subsidy_name:
        q = q.filter(ErrorLibrary.subsidy_name == subsidy_name)
    total = q.count()
    items = q.order_by(ErrorLibrary.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": r.id,
                "real_name": r.real_name,
                "id_card": r.id_card,
                "error_type": r.error_type,
                "error_reason": r.error_reason,
                "source": r.source,
                "village_name": r.village_name,
                "group_no": r.group_no,
                "subsidy_name": r.subsidy_name,
                "discovered_date": r.discovered_date,
                "subsidy_type_id": r.subsidy_type_id,
                "remark": r.remark,
                "created_at": str(r.created_at) if r.created_at else None,
            }
            for r in items
        ],
    }


@router.get("/stats")
def error_library_stats(db: Session = Depends(get_db)):
    """返回各错误类型的数量统计"""
    from sqlalchemy import func as sa_func
    rows = db.query(ErrorLibrary.error_type, sa_func.count(ErrorLibrary.id)).group_by(ErrorLibrary.error_type).all()
    stats = {r[0]: r[1] for r in rows}
    total = sum(stats.values())
    return {"total": total, "by_type": stats}


@router.get("/filter-options")
def error_library_filter_options(db: Session = Depends(get_db)):
    """返回筛选下拉选项：村名列表、补贴分类列表"""
    villages = [r[0] for r in db.query(ErrorLibrary.village_name).distinct().filter(ErrorLibrary.village_name.isnot(None)).all() if r[0]]
    subsidies = [r[0] for r in db.query(ErrorLibrary.subsidy_name).distinct().filter(ErrorLibrary.subsidy_name.isnot(None)).all() if r[0]]
    return {"villages": sorted(villages), "subsidies": sorted(subsidies)}


@router.post("")
def create_error_library(data: ErrorLibraryCreate, db: Session = Depends(get_db)):
    item = ErrorLibrary(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "message": "创建成功"}


@router.post("/batch-import")
def batch_import_error_library(payload: dict, db: Session = Depends(get_db)):
    rows = payload.get("rows", [])
    if not rows or not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="缺少 rows 列表")
    created, skipped = 0, 0
    for row in rows:
        name = (row.get("real_name") or row.get("姓名") or "").strip()
        id_card = (row.get("id_card") or row.get("身份证号") or "").strip()
        error_type = (row.get("error_type") or row.get("错误类型") or "").strip()
        error_reason = (row.get("error_reason") or row.get("错误原因") or "").strip()
        if not name or not id_card or not error_type or not error_reason:
            skipped += 1
            continue
        item = ErrorLibrary(
            real_name=name,
            id_card=id_card,
            error_type=error_type,
            error_reason=error_reason,
            source=(row.get("source") or row.get("来源") or "手动录入").strip(),
            village_name=row.get("village_name") or row.get("村"),
            group_no=row.get("group_no") or row.get("组"),
            subsidy_name=row.get("subsidy_name") or row.get("补贴分类"),
            discovered_date=row.get("discovered_date") or row.get("发现日期"),
            subsidy_type_id=row.get("subsidy_type_id"),
            remark=row.get("remark") or row.get("备注"),
        )
        db.add(item)
        created += 1
    db.commit()
    return {"created": created, "skipped": skipped}


@router.put("/{item_id}")
def update_error_library(item_id: int, data: ErrorLibraryCreate, db: Session = Depends(get_db)):
    item = db.get(ErrorLibrary, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    for k, v in data.model_dump().items():
        setattr(item, k, v)
    db.commit()
    return {"message": "更新成功"}


@router.delete("/{item_id}")
def delete_error_library(item_id: int, db: Session = Depends(get_db)):
    item = db.get(ErrorLibrary, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    db.delete(item)
    db.commit()
    return {"message": "删除成功"}


@router.post("/batch-delete")
def batch_delete_error_library(payload: dict, db: Session = Depends(get_db)):
    ids = payload.get("ids", [])
    if not ids or not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="缺少 ids 列表")
    from sqlalchemy import text
    ids_str = ','.join(str(int(i)) for i in ids)
    result = db.execute(text(f"DELETE FROM error_library WHERE id IN ({ids_str})"))
    db.commit()
    return {"deleted": result.rowcount}


@router.post("/match")
def match_error_library(payload: dict, db: Session = Depends(get_db)):
    """
    把上传的名单与历史错误库交叉比对，返回命中记录。
    匹配规则：
    1. 身份证号精确匹配（最可靠）
    2. 姓名完全相同但身份证不同（可能是身份证录错了）
    """
    rows = payload.get("rows", [])
    if not rows:
        return {"total": 0, "hits": []}

    lib = db.query(ErrorLibrary).all()

    lib_by_card: dict[str, ErrorLibrary] = {}
    lib_by_name: dict[str, list[ErrorLibrary]] = {}
    for r in lib:
        lib_by_card[r.id_card.strip()] = r
        lib_by_name.setdefault(r.real_name.strip(), []).append(r)

    hits = []
    seen = set()

    for row in rows:
        ic = str(row.get("id_card", "")).strip()
        name = str(row.get("real_name", "") or row.get("name", "")).strip()

        if ic and ic in lib_by_card:
            lib_rec = lib_by_card[ic]
            key = f"card:{ic}"
            if key not in seen:
                seen.add(key)
                hits.append({
                    "match_type": "id_card",
                    "match_label": "身份证匹配",
                    "id_card": ic,
                    "real_name": name or lib_rec.real_name,
                    "library_name": lib_rec.real_name,
                    "village_name": lib_rec.village_name or "",
                    "group_no": lib_rec.group_no or "",
                    "error_type": lib_rec.error_type,
                    "error_reason": lib_rec.error_reason,
                })
        elif name and name in lib_by_name:
            for lib_rec in lib_by_name[name]:
                if lib_rec.id_card.strip() != ic:
                    key = f"name:{name}:{lib_rec.id_card}"
                    if key not in seen:
                        seen.add(key)
                        hits.append({
                            "match_type": "name_only",
                            "match_label": "姓名匹配（身份证不同，请核实）",
                            "id_card": ic,
                            "real_name": name,
                            "library_name": lib_rec.real_name,
                            "library_id_card": lib_rec.id_card,
                            "village_name": lib_rec.village_name or "",
                            "group_no": lib_rec.group_no or "",
                            "error_type": lib_rec.error_type,
                            "error_reason": lib_rec.error_reason,
                        })

    return {"total": len(hits), "hits": hits}
