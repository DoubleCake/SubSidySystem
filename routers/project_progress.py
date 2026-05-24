"""
补贴项目进度跟踪 API
"""
import json
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models import ProjectProgress, SubsidyType, Village

router = APIRouter(prefix="/api/project-progress", tags=["项目进度"])


@router.get("/{subsidy_type_id}")
def list_progress(
    subsidy_type_id: int,
    village_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """获取某项目下所有村的进度记录"""
    q = db.query(ProjectProgress).filter(ProjectProgress.subsidy_type_id == subsidy_type_id)
    if village_id:
        q = q.filter(ProjectProgress.village_id == village_id)
    records = q.order_by(ProjectProgress.village_name).all()
    return [_serialize(r) for r in records]


@router.post("/{subsidy_type_id}")
def upsert_progress(
    subsidy_type_id: int,
    data: dict,
    db: Session = Depends(get_db),
):
    """创建或更新某村的进度记录"""
    village_id = data.get("village_id")
    if not village_id:
        return {"error": "缺少 village_id"}, 400

    record = db.query(ProjectProgress).filter(
        ProjectProgress.subsidy_type_id == subsidy_type_id,
        ProjectProgress.village_id == village_id,
    ).first()

    village = db.query(Village).get(village_id)
    village_name = village.village_name if village else str(village_id)

    if record:
        record.person_name = data.get("person_name", record.person_name)
        record.phone = data.get("phone", record.phone)
        if "stages" in data:
            record.stages = json.dumps(data["stages"], ensure_ascii=False)
        if "note" in data:
            record.note = data.get("note")
    else:
        record = ProjectProgress(
            subsidy_type_id=subsidy_type_id,
            village_id=village_id,
            village_name=village_name,
            person_name=data.get("person_name", ""),
            phone=data.get("phone", ""),
            stages=json.dumps(data.get("stages", []), ensure_ascii=False),
            note=data.get("note", ""),
        )
        db.add(record)

    db.commit()
    return _serialize(record)


@router.post("/{subsidy_type_id}/batch")
def batch_upsert(
    subsidy_type_id: int,
    data: dict,
    db: Session = Depends(get_db),
):
    """批量操作：初始化村列表 / 批量更新阶段状态"""
    action = data.get("action", "init")
    if action == "init":
        # 为所有村创建/更新进度记录，自动同步村负责人信息
        villages = db.query(Village).order_by(Village.village_name).all()
        created, updated = 0, 0
        for v in villages:
            exists = db.query(ProjectProgress).filter(
                ProjectProgress.subsidy_type_id == subsidy_type_id,
                ProjectProgress.village_id == v.id,
            ).first()
            if not exists:
                db.add(ProjectProgress(
                    subsidy_type_id=subsidy_type_id,
                    village_id=v.id,
                    village_name=v.village_name,
                    person_name=v.leader_name or "",
                    phone=v.leader_phone or "",
                    stages="[]",
                ))
                created += 1
            else:
                # 同步负责人信息（如果进度表中为空则从 Village 表补充）
                if not exists.person_name and v.leader_name:
                    exists.person_name = v.leader_name
                if not exists.phone and v.leader_phone:
                    exists.phone = v.leader_phone
                updated += 1
        db.commit()
        return {"ok": True, "created": created, "updated": updated}

    if action == "batch_stage":
        # 批量设置某阶段状态
        stage_name = data.get("stage_name", "")
        status = data.get("status", "done")
        for row in db.query(ProjectProgress).filter(
            ProjectProgress.subsidy_type_id == subsidy_type_id
        ).all():
            stages = json.loads(row.stages) if row.stages else []
            for s in stages:
                if s.get("name") == stage_name:
                    s["status"] = status
                    s["date"] = data.get("date", "")
            row.stages = json.dumps(stages, ensure_ascii=False)
        db.commit()
        return {"ok": True}

    if action == "add_stage_to_all":
        # 为所有记录添加新阶段
        stage = data.get("stage", {})
        for row in db.query(ProjectProgress).filter(
            ProjectProgress.subsidy_type_id == subsidy_type_id
        ).all():
            stages = json.loads(row.stages) if row.stages else []
            if not any(s.get("name") == stage.get("name") for s in stages):
                stages.append(stage)
            row.stages = json.dumps(stages, ensure_ascii=False)
        db.commit()
        return {"ok": True}

    if action == "swap_stages":
        name_a = data.get("stage_a", "")
        name_b = data.get("stage_b", "")
        if not name_a or not name_b:
            return {"error": "缺少 stage_a/stage_b"}, 400
        for row in db.query(ProjectProgress).filter(
            ProjectProgress.subsidy_type_id == subsidy_type_id
        ).all():
            stages = json.loads(row.stages) if row.stages else []
            i = next((idx for idx, s in enumerate(stages) if s.get("name") == name_a), -1)
            j = next((idx for idx, s in enumerate(stages) if s.get("name") == name_b), -1)
            if i >= 0 and j >= 0:
                stages[i], stages[j] = stages[j], stages[i]
            row.stages = json.dumps(stages, ensure_ascii=False)
        db.commit()
        return {"ok": True}

    return {"error": "unknown action"}, 400


@router.delete("/{subsidy_type_id}/{village_id}")
def delete_progress(
    subsidy_type_id: int,
    village_id: int,
    db: Session = Depends(get_db),
):
    record = db.query(ProjectProgress).filter(
        ProjectProgress.subsidy_type_id == subsidy_type_id,
        ProjectProgress.village_id == village_id,
    ).first()
    if record:
        db.delete(record)
        db.commit()
    return {"ok": True}


def _serialize(r: ProjectProgress) -> dict:
    return {
        "id": r.id,
        "subsidy_type_id": r.subsidy_type_id,
        "village_id": r.village_id,
        "village_name": r.village_name,
        "person_name": r.person_name or "",
        "phone": r.phone or "",
        "stages": json.loads(r.stages) if r.stages else [],
        "note": r.note or "",
        "updated_at": r.updated_at.isoformat() if r.updated_at else "",
    }
