"""预检错误历史记录路由"""
import json
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, Integer
from typing import Optional
from database import get_db
from models import PrecheckHistory, SubsidyApplication, FarmerProfile

router = APIRouter(prefix="/api/precheck-history", tags=["预检历史"])

# 预检结果中所有错误类型的提取配置
# (中文标签, [姓名字段, 身份证字段, 村字段, 组字段, 错误消息字段])
ERROR_EXTRACTORS = {
    "format_errors": ("格式错误", ["name", "id_card", "village", "group", "errors"]),
    "village_errors": ("村庄不存在", ["name", "id_card", "village", "group", "error"]),
    "duplicate_errors": ("重复身份证", ["name", "id_card", "village", "group", "error"]),
    "gender_mismatch": ("性别不符", ["name", "id_card", "village", "group", "error"]),
    "error_library_hits": ("错误库命中", ["name", "id_card", "village", "group", "error_reason"]),
    "area_anomalies": ("面积异常", ["name", "id_card", "village", "group", "anomaly_type"]),
    "area_missing": ("承包面积缺失", ["name", "id_card", "village", "group", "error"]),
    "age_anomaly": ("年龄异常", ["name", "id_card", "village", "group", "error"]),
    "deceased_farmers": ("已故农户", ["name", "id_card", "village", "group", "error"]),
    "restricted_farmers": ("受限身份", ["name", "id_card", "village", "group", "error"]),
    "household_duplicates": ("家庭重复申请", ["name", "id_card", "village", "group", "error"]),
    "new_farmers": ("新增农户", ["name", "id_card", "village", "group", None]),
    "removed_farmers": ("减少农户", ["name", "id_card", "village", "group", "note"]),
    "changed_farmers": ("字段变更", ["name", "id_card", "village", "group", "changes"]),
}


def _build_error_message(error_type_key: str, row: dict) -> str:
    """构建完整的错误描述"""
    cfg = ERROR_EXTRACTORS.get(error_type_key)
    if not cfg:
        return error_type_key
    label, fields = cfg
    msg_field = fields[4]
    msg = ""
    if msg_field and msg_field in row:
        val = row[msg_field]
        if isinstance(val, list):
            msg = "; ".join(str(v) for v in val)
        else:
            msg = str(val)
    return f"[{label}] {msg}" if msg else f"[{label}]"


class SaveHistoryReq(BaseModel):
    precheck_result: dict
    error_types: Optional[list[str]] = None  # 仅保存指定的错误类型


@router.post("")
def save_precheck_history(
    req_body: SaveHistoryReq,
    subsidy_type_id: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
):
    """保存预检结果到历史记录"""
    precheck_result = req_body.precheck_result
    batch_key = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    count = 0

    selected_types = req_body.error_types or list(ERROR_EXTRACTORS.keys())

    for error_type_key, (label, fields) in ERROR_EXTRACTORS.items():
        if error_type_key not in selected_types:
            continue
        rows = precheck_result.get(error_type_key, [])
        if not rows:
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = (row.get(fields[0]) or row.get("name") or row.get("farmer_name") or "")
            id_card = (row.get(fields[1]) or row.get("id_card") or "")
            village = (row.get(fields[2]) or row.get("village") or "")
            group = (row.get(fields[3]) or row.get("group") or row.get("group_no") or "")
            error_msg = _build_error_message(error_type_key, row)

            record = PrecheckHistory(
                subsidy_type_id=subsidy_type_id,
                year=year,
                batch_key=batch_key,
                error_type=error_type_key,
                farmer_name=str(name) if name else None,
                id_card=str(id_card) if id_card else None,
                village=str(village) if village else None,
                group_no=str(group) if group else None,
                error_message=error_msg,
                detail_json=json.dumps(row, ensure_ascii=False) if row else None,
                status="active",
            )
            db.add(record)
            count += 1

    db.commit()
    return {"saved": count, "batch_key": batch_key}


@router.get("")
def list_precheck_history(
    subsidy_type_id: int = Query(...),
    year: int = Query(...),
    status: Optional[str] = Query(None, description="筛选: active/resolved"),
    error_type: Optional[str] = Query(None, description="按错误类型筛选"),
    batch_key: Optional[str] = Query(None, description="按批次筛选"),
    search: Optional[str] = Query(None, description="搜索姓名/身份证"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """查询预检错误历史"""
    q = db.query(PrecheckHistory).filter(
        PrecheckHistory.subsidy_type_id == subsidy_type_id,
        PrecheckHistory.year == year,
    )
    if status:
        q = q.filter(PrecheckHistory.status == status)
    if error_type:
        q = q.filter(PrecheckHistory.error_type == error_type)
    if batch_key:
        q = q.filter(PrecheckHistory.batch_key == batch_key)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (PrecheckHistory.farmer_name.contains(search))
            | (PrecheckHistory.id_card.contains(search))
        )

    total = q.count()
    items = q.order_by(desc(PrecheckHistory.id)).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": r.id,
                "subsidy_type_id": r.subsidy_type_id,
                "year": r.year,
                "batch_key": r.batch_key,
                "error_type": r.error_type,
                "farmer_name": r.farmer_name,
                "id_card": r.id_card,
                "village": r.village,
                "group_no": r.group_no,
                "error_message": r.error_message,
                "detail_json": r.detail_json,
                "status": r.status,
                "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in items
        ],
    }


@router.get("/batches")
def list_batches(
    subsidy_type_id: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
):
    """获取所有批次列表，用于分组展示"""
    rows = (
        db.query(
            PrecheckHistory.batch_key,
            func.count(PrecheckHistory.id).label("total"),
            func.sum(
                (PrecheckHistory.status == "resolved").cast(Integer)
            ).label("resolved_count"),
            func.max(PrecheckHistory.created_at).label("latest_at"),
        )
        .filter(
            PrecheckHistory.subsidy_type_id == subsidy_type_id,
            PrecheckHistory.year == year,
        )
        .group_by(PrecheckHistory.batch_key)
        .order_by(desc(func.max(PrecheckHistory.created_at)))
        .all()
    )

    return {
        "batches": [
            {
                "batch_key": r.batch_key,
                "total": r.total,
                "resolved_count": r.resolved_count or 0,
                "latest_at": r.latest_at.isoformat() if r.latest_at else None,
            }
            for r in rows
        ]
    }


@router.put("/{record_id}/resolve")
def resolve_record(record_id: int, db: Session = Depends(get_db)):
    """标记为已解决"""
    record = db.query(PrecheckHistory).filter(PrecheckHistory.id == record_id).first()
    if not record:
        return {"error": "记录不存在"}
    record.status = "resolved"
    record.resolved_at = datetime.now()
    db.commit()
    return {"ok": True}


@router.put("/{record_id}/unresolve")
def unresolve_record(record_id: int, db: Session = Depends(get_db)):
    """取消已解决"""
    record = db.query(PrecheckHistory).filter(PrecheckHistory.id == record_id).first()
    if not record:
        return {"error": "记录不存在"}
    record.status = "active"
    record.resolved_at = None
    db.commit()
    return {"ok": True}


@router.delete("/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db)):
    """真实删除单条记录"""
    record = db.query(PrecheckHistory).filter(PrecheckHistory.id == record_id).first()
    if not record:
        return {"error": "记录不存在"}
    db.delete(record)
    db.commit()
    return {"ok": True}


@router.post("/auto-resolve")
def auto_resolve(
    subsidy_type_id: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
):
    """自动比对：重新执行预检逻辑，对每条 active 记录做针对性检查，确认是否已修复"""
    from models import Village, ErrorLibrary, FamilyHousehold
    from utils import validate_id_card, parse_gender_from_id

    active_records = (
        db.query(PrecheckHistory)
        .filter(
            PrecheckHistory.subsidy_type_id == subsidy_type_id,
            PrecheckHistory.year == year,
            PrecheckHistory.status == "active",
        )
        .all()
    )

    if not active_records:
        return {"resolved_count": 0, "total": 0}

    # ── 加载参照数据 ──
    all_village_names = {v.village_name for v in db.query(Village).all()}

    error_lib: dict[tuple[str, str], object] = {}
    for e in db.query(ErrorLibrary).all():
        if e.id_card and e.real_name:
            error_lib[(e.id_card.strip(), e.real_name.strip())] = e

    # ── 加载当前项目申请数据 ──
    current_apps = db.query(SubsidyApplication).filter(
        SubsidyApplication.subsidy_type_id == subsidy_type_id,
        SubsidyApplication.apply_year == year,
    ).all()

    current_farmer_ids = {a.farmer_id for a in current_apps}
    current_farmers = (
        db.query(FarmerProfile)
        .filter(FarmerProfile.id.in_(current_farmer_ids))
        .all()
    )

    # 索引构建
    farmer_by_id_card: dict[str, FarmerProfile] = {}
    id_card_counts: dict[str, int] = {}
    farmer_status_map: dict[str, int] = {}
    restricted_map: dict[str, int] = {}
    household_members: dict[int, list[str]] = {}
    farmer_contract: dict[str, float] = {}

    for f in current_farmers:
        if f.id_card:
            farmer_by_id_card[f.id_card] = f
            id_card_counts[f.id_card] = id_card_counts.get(f.id_card, 0) + 1
            farmer_status_map[f.id_card] = f.farmer_status or 1
            restricted_map[f.id_card] = getattr(f, 'restricted_identity', 0) or 0
            if f.household_id:
                household_members.setdefault(f.household_id, []).append(f.id_card)
            # 承包面积
            if f.household and f.household.contract_area:
                farmer_contract[f.id_card] = float(f.household.contract_area)

    # farmer_id → farmer 映射
    farmer_by_id: dict[int, FarmerProfile] = {f.id: f for f in current_farmers}

    # applicant id_card 集合
    current_id_cards = set(farmer_by_id_card.keys())

    # ── 开始针对性比对 ──
    now = datetime.now()
    resolved_count = 0

    for record in active_records:
        should_resolve = False

        if not record.id_card:
            # 无身份证 → 按姓名模糊判断
            still_exists = any(
                f.real_name and record.farmer_name
                and record.farmer_name in f.real_name
                for f in current_farmers
            )
            if not still_exists:
                should_resolve = True
        elif record.id_card not in current_id_cards:
            # 身份证已不在当前项目中
            should_resolve = True
        else:
            # 仍在项目中 → 按错误类型做针对性检查
            et = record.error_type

            if et == "format_errors":
                id_ok, _ = validate_id_card(record.id_card)
                if id_ok:
                    should_resolve = True

            elif et == "village_errors":
                if record.village and record.village in all_village_names:
                    should_resolve = True

            elif et == "duplicate_errors":
                if id_card_counts.get(record.id_card, 0) <= 1:
                    should_resolve = True

            elif et == "gender_mismatch":
                farmer = farmer_by_id_card.get(record.id_card)
                if farmer:
                    gender_from_id = parse_gender_from_id(record.id_card)
                    farmer_gender = (
                        1 if farmer.gender in ("男", "1", "male") else
                        2 if farmer.gender in ("女", "2", "female") else 0
                    ) if farmer.gender else 0
                    if farmer_gender == gender_from_id or gender_from_id == 0:
                        should_resolve = True
                else:
                    should_resolve = True

            elif et == "error_library_hits":
                farmer = farmer_by_id_card.get(record.id_card)
                if farmer and farmer.real_name:
                    key = (record.id_card.strip(), farmer.real_name.strip())
                    if key not in error_lib:
                        should_resolve = True
                else:
                    should_resolve = True

            elif et == "area_missing":
                if farmer_contract.get(record.id_card, 0) > 0:
                    should_resolve = True

            elif et == "age_anomaly":
                if len(record.id_card) == 18:
                    try:
                        birth_year = int(record.id_card[6:10])
                        age = 2026 - birth_year
                        if 16 <= age <= 100:
                            should_resolve = True
                    except ValueError:
                        pass
                else:
                    should_resolve = True

            elif et == "deceased_farmers":
                if farmer_status_map.get(record.id_card) != 4:
                    should_resolve = True

            elif et == "restricted_farmers":
                if restricted_map.get(record.id_card, 0) != 1:
                    should_resolve = True

            elif et == "household_duplicates":
                farmer = farmer_by_id_card.get(record.id_card)
                if farmer and farmer.household_id:
                    if len(household_members.get(farmer.household_id, [])) <= 1:
                        should_resolve = True
                else:
                    should_resolve = True

            elif et in ("new_farmers", "removed_farmers", "changed_farmers"):
                # 这类比对型错误：记录在当前项目中 → 已不再是"新增/减少/变更"
                should_resolve = True

            elif et == "area_anomalies":
                farmer = farmer_by_id_card.get(record.id_card)
                if farmer:
                    db_contract = farmer_contract.get(record.id_card, 0)
                    for app in current_apps:
                        if app.farmer_id == farmer.id:
                            app_area = float(app.apply_area or 0)
                            if app_area <= db_contract or db_contract == 0:
                                should_resolve = True
                            break
                    else:
                        should_resolve = True
                else:
                    should_resolve = True

        if should_resolve:
            record.status = "resolved"
            record.resolved_at = now
            resolved_count += 1

    db.commit()
    return {"resolved_count": resolved_count, "total": len(active_records)}


# 错误类型对应颜色（前端用）
ERROR_TYPE_COLORS = {
    "format_errors": "red",
    "village_errors": "red",
    "duplicate_errors": "red",
    "gender_mismatch": "amber",
    "error_library_hits": "red",
    "area_anomalies": "orange",
    "area_missing": "orange",
    "age_anomaly": "amber",
    "deceased_farmers": "red",
    "restricted_farmers": "red",
    "household_duplicates": "amber",
    "new_farmers": "blue",
    "removed_farmers": "blue",
    "changed_farmers": "purple",
}
