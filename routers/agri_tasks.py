"""
农业任务分解模块
- 村级土地基础信息维护（VillageLandInfo）
- 农业任务创建与管理（AgriTask）
- 按村分配任务面积，支持多种分配方式：
    CONTRACT_AREA  按承包地面积比例
    PADDY_AREA     按水田面积比例
    DRY_AREA       按旱地面积比例
    ARABLE_AREA    按可耕种面积比例
    HISTORY_AREA   按历史种植面积比例（前一年度申请记录）
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional, List
from decimal import Decimal, ROUND_HALF_UP

from database import get_db
from models import AgriTask, AgriTaskAllocation, VillageLandInfo, Village

router = APIRouter(prefix="/api/agri-tasks", tags=["农业任务分解"])

# ──────────────────────────────────────────────
#  常量
# ──────────────────────────────────────────────
ALLOC_METHOD_LABEL = {
    "CONTRACT_AREA": "按承包地面积",
    "PADDY_AREA":    "按水田面积",
    "DRY_AREA":      "按旱地面积",
    "ARABLE_AREA":   "按可耕种面积",
    "HISTORY_AREA":  "按历史种植面积",
}

STATUS_LABEL = {
    "DRAFT":  "草稿",
    "ISSUED": "已下达",
    "DONE":   "完成",
}

CROP_TYPES = ["水稻", "玉米", "大豆", "油菜", "小麦", "其他"]


# ──────────────────────────────────────────────
#  工具函数
# ──────────────────────────────────────────────

def _fmt_decimal(v) -> Optional[float]:
    if v is None:
        return None
    return float(v)


def _task_row(row: dict) -> dict:
    return {
        "id":           row["id"],
        "task_name":    row["task_name"],
        "crop_type":    row["crop_type"],
        "total_area":   _fmt_decimal(row["total_area"]),
        "task_year":    row["task_year"],
        "season":       row["season"],
        "alloc_method": row["alloc_method"],
        "alloc_method_label": ALLOC_METHOD_LABEL.get(row["alloc_method"], row["alloc_method"]),
        "status":       row["status"],
        "status_label": STATUS_LABEL.get(row["status"], row["status"]),
        "description":  row["description"],
        "operator":     row["operator"],
        "created_at":   str(row["created_at"]) if row["created_at"] else None,
        "updated_at":   str(row["updated_at"]) if row["updated_at"] else None,
    }


def _alloc_row(row: dict) -> dict:
    return {
        "id":           row["id"],
        "task_id":      row["task_id"],
        "village_id":   row["village_id"],
        "village_name": row["village_name"],
        "alloc_area":   _fmt_decimal(row["alloc_area"]),
        "alloc_ratio":  _fmt_decimal(row["alloc_ratio"]),
        "basis_area":   _fmt_decimal(row["basis_area"]),
        "actual_area":  _fmt_decimal(row["actual_area"]),
        "remark":       row["remark"],
    }


def _compute_allocation(db: Session, task_year: int, alloc_method: str,
                         total_area: Decimal) -> List[dict]:
    """
    计算各村分配方案，返回列表：
    [{ village_id, village_name, basis_area, alloc_ratio, alloc_area }, ...]
    """
    # 1. 获取各村依据面积
    if alloc_method == "CONTRACT_AREA":
        sql = text("""
            SELECT hh.village_id, v.village_name,
                   SUM(COALESCE(hh.contract_area, 0)) AS basis_area
            FROM family_household hh
            JOIN village v ON v.id = hh.village_id
            WHERE hh.status = 1
            GROUP BY hh.village_id, v.village_name
            HAVING basis_area > 0
            ORDER BY v.village_name
        """)
        rows = db.execute(sql).mappings().all()

    elif alloc_method in ("PADDY_AREA", "DRY_AREA", "ARABLE_AREA"):
        field_map = {
            "PADDY_AREA":  "paddy_area",
            "DRY_AREA":    "dry_land_area",
            "ARABLE_AREA": "arable_area",
        }
        field = field_map[alloc_method]
        sql = text(f"""
            SELECT vli.village_id, v.village_name,
                   COALESCE(vli.{field}, 0) AS basis_area
            FROM village_land_info vli
            JOIN village v ON v.id = vli.village_id
            WHERE vli.{field} IS NOT NULL AND vli.{field} > 0
            ORDER BY v.village_name
        """)
        rows = db.execute(sql).mappings().all()

    elif alloc_method == "HISTORY_AREA":
        ref_year = task_year - 1
        sql = text("""
            SELECT sa.apply_village_id AS village_id,
                   COALESCE(sa.apply_village_name, v.village_name) AS village_name,
                   SUM(COALESCE(sa.apply_area, 0)) AS basis_area
            FROM subsidy_application sa
            LEFT JOIN village v ON v.id = sa.apply_village_id
            WHERE sa.apply_year = :yr AND sa.apply_village_id IS NOT NULL
            GROUP BY sa.apply_village_id, village_name
            HAVING basis_area > 0
            ORDER BY village_name
        """)
        rows = db.execute(sql, {"yr": ref_year}).mappings().all()

    else:
        raise HTTPException(status_code=400, detail=f"不支持的分配方式: {alloc_method}")

    if not rows:
        raise HTTPException(
            status_code=422,
            detail=f"分配方式「{ALLOC_METHOD_LABEL.get(alloc_method, alloc_method)}」下无有效数据，请先录入相关信息"
        )

    total_basis = sum(Decimal(str(r["basis_area"])) for r in rows)
    if total_basis == 0:
        raise HTTPException(status_code=422, detail="各村依据面积合计为0，无法分配")

    result = []
    allocated = Decimal("0")
    for i, r in enumerate(rows):
        basis = Decimal(str(r["basis_area"]))
        ratio = basis / total_basis
        if i < len(rows) - 1:
            area = (total_area * ratio).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        else:
            # 最后一村取余，确保总量精确
            area = total_area - allocated
        allocated += area
        result.append({
            "village_id":   r["village_id"],
            "village_name": r["village_name"],
            "basis_area":   float(basis),
            "alloc_ratio":  float(ratio),
            "alloc_area":   float(area),
        })

    return result


# ══════════════════════════════════════
#  村级土地信息 CRUD
# ══════════════════════════════════════

@router.get("/village-land-info")
def list_village_land_info(db: Session = Depends(get_db)):
    """获取所有村的土地基础信息（含无记录的村，方便统一录入）"""
    sql = text("""
        SELECT v.id AS village_id, v.village_name,
               vli.id, vli.survey_year,
               vli.paddy_area, vli.dry_land_area, vli.arable_area,
               vli.irrigation_level, vli.terrain_type, vli.soil_quality,
               vli.remark, vli.updated_at,
               (SELECT SUM(COALESCE(hh.contract_area,0)) FROM family_household hh
                WHERE hh.village_id = v.id AND hh.status = 1) AS contract_area_total
        FROM village v
        LEFT JOIN village_land_info vli ON vli.village_id = v.id
        ORDER BY v.village_name
    """)
    rows = db.execute(sql).mappings().all()
    return [
        {
            "village_id":       r["village_id"],
            "village_name":     r["village_name"],
            "id":               r["id"],
            "survey_year":      r["survey_year"],
            "contract_area_total": _fmt_decimal(r["contract_area_total"]),
            "paddy_area":       _fmt_decimal(r["paddy_area"]),
            "dry_land_area":    _fmt_decimal(r["dry_land_area"]),
            "arable_area":      _fmt_decimal(r["arable_area"]),
            "irrigation_level": r["irrigation_level"],
            "terrain_type":     r["terrain_type"],
            "soil_quality":     r["soil_quality"],
            "remark":           r["remark"],
            "updated_at":       str(r["updated_at"]) if r["updated_at"] else None,
        }
        for r in rows
    ]


@router.put("/village-land-info/{village_id}")
def upsert_village_land_info(
    village_id: int,
    body: dict,
    db: Session = Depends(get_db),
):
    """新增或更新村级土地信息"""
    v = db.query(Village).filter(Village.id == village_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="村不存在")

    info = db.query(VillageLandInfo).filter(VillageLandInfo.village_id == village_id).first()
    if not info:
        info = VillageLandInfo(village_id=village_id)
        db.add(info)

    for field in ("survey_year", "paddy_area", "dry_land_area", "arable_area",
                  "irrigation_level", "terrain_type", "soil_quality", "remark"):
        if field in body:
            val = body[field]
            if val == "":
                val = None
            setattr(info, field, val)

    db.commit()
    db.refresh(info)
    return {"ok": True, "id": info.id}


# ══════════════════════════════════════
#  农业任务 CRUD
# ══════════════════════════════════════

@router.get("")
def list_tasks(
    task_year:  Optional[int] = Query(None),
    status:     Optional[str] = Query(None),
    crop_type:  Optional[str] = Query(None),
    page:       int = Query(1, ge=1),
    page_size:  int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    where = "1=1"
    params: dict = {}
    if task_year:
        where += " AND task_year=:yr"; params["yr"] = task_year
    if status:
        where += " AND status=:st"; params["st"] = status
    if crop_type:
        where += " AND crop_type=:ct"; params["ct"] = crop_type

    total = db.execute(text(f"SELECT COUNT(*) FROM agri_task WHERE {where}"), params).scalar() or 0
    params["lim"] = page_size
    params["off"] = (page - 1) * page_size
    rows = db.execute(
        text(f"SELECT * FROM agri_task WHERE {where} ORDER BY task_year DESC, id DESC LIMIT :lim OFFSET :off"),
        params
    ).mappings().all()

    return {"total": total, "items": [_task_row(dict(r)) for r in rows]}


@router.post("")
def create_task(body: dict, db: Session = Depends(get_db)):
    required = ("task_name", "crop_type", "total_area", "task_year", "alloc_method")
    for f in required:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"缺少必填字段: {f}")

    if body["alloc_method"] not in ALLOC_METHOD_LABEL:
        raise HTTPException(status_code=400, detail="无效的分配方式")

    task = AgriTask(
        task_name    = body["task_name"],
        crop_type    = body["crop_type"],
        total_area   = Decimal(str(body["total_area"])),
        task_year    = int(body["task_year"]),
        season       = body.get("season") or None,
        alloc_method = body["alloc_method"],
        description  = body.get("description") or None,
        operator     = body.get("operator") or None,
        status       = "DRAFT",
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"ok": True, "id": task.id}


@router.get("/meta")
def get_meta():
    """返回前端所需枚举常量"""
    return {
        "alloc_methods": [{"value": k, "label": v} for k, v in ALLOC_METHOD_LABEL.items()],
        "statuses":      [{"value": k, "label": v} for k, v in STATUS_LABEL.items()],
        "crop_types":    CROP_TYPES,
    }


@router.get("/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT * FROM agri_task WHERE id=:id"), {"id": task_id}
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="任务不存在")

    alloc_rows = db.execute(
        text("SELECT * FROM agri_task_allocation WHERE task_id=:tid ORDER BY alloc_area DESC"),
        {"tid": task_id}
    ).mappings().all()

    data = _task_row(dict(row))
    data["allocations"] = [_alloc_row(dict(a)) for a in alloc_rows]

    # 完成率统计
    if data["allocations"]:
        total_actual = sum(a["actual_area"] or 0 for a in data["allocations"])
        data["total_actual_area"] = round(total_actual, 2)
        data["completion_rate"] = round(total_actual / data["total_area"] * 100, 1) if data["total_area"] else 0
    else:
        data["total_actual_area"] = None
        data["completion_rate"] = None

    return data


@router.put("/{task_id}")
def update_task(task_id: int, body: dict, db: Session = Depends(get_db)):
    task = db.query(AgriTask).filter(AgriTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == "DONE":
        raise HTTPException(status_code=400, detail="已完成的任务不可修改")

    for field in ("task_name", "crop_type", "total_area", "task_year",
                  "season", "alloc_method", "description", "operator"):
        if field in body:
            val = body[field]
            if val == "":
                val = None
            if field == "total_area" and val is not None:
                val = Decimal(str(val))
            setattr(task, field, val)

    db.commit()
    return {"ok": True}


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(AgriTask).filter(AgriTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == "ISSUED":
        raise HTTPException(status_code=400, detail="已下达的任务不可删除，请先撤回")
    db.delete(task)
    db.commit()
    return {"ok": True}


# ══════════════════════════════════════
#  分配计算
# ══════════════════════════════════════

@router.get("/{task_id}/preview")
def preview_allocation(task_id: int, db: Session = Depends(get_db)):
    """预览分配方案（不保存），返回各村分配明细"""
    task = db.query(AgriTask).filter(AgriTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    allocs = _compute_allocation(db, task.task_year, task.alloc_method, task.total_area)

    total_basis = sum(a["basis_area"] for a in allocs)
    return {
        "task_id":      task_id,
        "task_name":    task.task_name,
        "total_area":   float(task.total_area),
        "alloc_method": task.alloc_method,
        "alloc_method_label": ALLOC_METHOD_LABEL.get(task.alloc_method, task.alloc_method),
        "total_basis_area": round(total_basis, 2),
        "allocations":  allocs,
    }


@router.post("/{task_id}/issue")
def issue_task(task_id: int, db: Session = Depends(get_db)):
    """下达任务：计算并保存分配方案，状态改为 ISSUED"""
    task = db.query(AgriTask).filter(AgriTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == "ISSUED":
        raise HTTPException(status_code=400, detail="任务已下达，如需重新分配请先撤回")

    allocs = _compute_allocation(db, task.task_year, task.alloc_method, task.total_area)

    # 清除旧明细
    db.query(AgriTaskAllocation).filter(AgriTaskAllocation.task_id == task_id).delete()

    for a in allocs:
        db.add(AgriTaskAllocation(
            task_id      = task_id,
            village_id   = a["village_id"],
            village_name = a["village_name"],
            alloc_area   = Decimal(str(a["alloc_area"])),
            alloc_ratio  = Decimal(str(round(a["alloc_ratio"], 6))),
            basis_area   = Decimal(str(a["basis_area"])),
        ))

    task.status = "ISSUED"
    db.commit()
    return {"ok": True, "village_count": len(allocs)}


@router.post("/{task_id}/revoke")
def revoke_task(task_id: int, db: Session = Depends(get_db)):
    """撤回任务：清除分配明细，状态回到 DRAFT"""
    task = db.query(AgriTask).filter(AgriTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == "DONE":
        raise HTTPException(status_code=400, detail="已完成的任务不可撤回")

    db.query(AgriTaskAllocation).filter(AgriTaskAllocation.task_id == task_id).delete()
    task.status = "DRAFT"
    db.commit()
    return {"ok": True}


@router.put("/{task_id}/done")
def mark_done(task_id: int, db: Session = Depends(get_db)):
    """标记任务完成"""
    task = db.query(AgriTask).filter(AgriTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != "ISSUED":
        raise HTTPException(status_code=400, detail="只有已下达的任务才能标记完成")
    task.status = "DONE"
    db.commit()
    return {"ok": True}


@router.put("/{task_id}/allocations/{village_id}/actual")
def update_actual_area(
    task_id:    int,
    village_id: int,
    body: dict,
    db: Session = Depends(get_db),
):
    """填报村级实际完成面积"""
    alloc = db.query(AgriTaskAllocation).filter(
        AgriTaskAllocation.task_id == task_id,
        AgriTaskAllocation.village_id == village_id
    ).first()
    if not alloc:
        raise HTTPException(status_code=404, detail="分配记录不存在")

    actual = body.get("actual_area")
    alloc.actual_area = Decimal(str(actual)) if actual not in (None, "") else None
    if "remark" in body:
        alloc.remark = body["remark"] or None
    db.commit()
    return {"ok": True}
