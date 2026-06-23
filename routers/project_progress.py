"""
补贴项目进度跟踪 API
"""
import json
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models import ProjectProgress, SubsidyType, Village, VillageContact

router = APIRouter(prefix="/api/project-progress", tags=["项目进度"])


@router.get("/{subsidy_type_id}")
def list_progress(
    subsidy_type_id: int,
    village_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """获取某项目下所有村的进度记录"""
    q = db.query(ProjectProgress).filter(
        ProjectProgress.subsidy_type_id == subsidy_type_id,
        ProjectProgress.village_name != "待分配",
    )
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
        # 优先从 VillageContact 取 is_agri_lead 的联系人，其次用 Village 表的 leader
        villages = db.query(Village).filter(Village.village_name != "待分配").order_by(Village.village_name).all()
        # 加载所有村的负责人（从 VillageContact）
        leads = {}
        for c in db.query(VillageContact).filter(VillageContact.is_agri_lead == True).all():
            leads[c.village_id] = c  # 每个村只保留第一个（后端逻辑保证唯一）
        created, updated = 0, 0
        for v in villages:
            lead = leads.get(v.id)
            person_name = lead.name if lead else (v.leader_name or "")
            phone = lead.phone if lead and lead.phone else (v.leader_phone or "")
            exists = db.query(ProjectProgress).filter(
                ProjectProgress.subsidy_type_id == subsidy_type_id,
                ProjectProgress.village_id == v.id,
            ).first()
            if not exists:
                db.add(ProjectProgress(
                    subsidy_type_id=subsidy_type_id,
                    village_id=v.id,
                    village_name=v.village_name,
                    person_name=person_name,
                    phone=phone,
                    stages="[]",
                ))
                created += 1
            else:
                # 同步负责人信息（从 VillageContact 覆盖）
                if person_name:
                    exists.person_name = person_name
                if phone:
                    exists.phone = phone
                updated += 1
        db.commit()
        return {"ok": True, "created": created, "updated": updated}

    if action == "batch_stage":
        # 批量设置某阶段状态
        stage_name = data.get("stage_name", "")
        status = data.get("status", "done")
        for row in db.query(ProjectProgress).filter(
            ProjectProgress.subsidy_type_id == subsidy_type_id,
            ProjectProgress.village_name != "待分配",
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
            ProjectProgress.subsidy_type_id == subsidy_type_id,
            ProjectProgress.village_name != "待分配",
        ).all():
            stages = json.loads(row.stages) if row.stages else []
            if not any(s.get("name") == stage.get("name") for s in stages):
                stages.append(stage)
            row.stages = json.dumps(stages, ensure_ascii=False)
        db.commit()
        return {"ok": True}

    if action == "sync_leaders":
        leads = {}
        for c in db.query(VillageContact).filter(VillageContact.is_agri_lead == True).all():
            leads[c.village_id] = c
        updated = 0
        for row in db.query(ProjectProgress).filter(
            ProjectProgress.subsidy_type_id == subsidy_type_id,
            ProjectProgress.village_name != "待分配",
        ).all():
            lead = leads.get(row.village_id)
            if lead:
                changed = False
                if lead.name and row.person_name != lead.name:
                    row.person_name = lead.name
                    changed = True
                if lead.phone and row.phone != lead.phone:
                    row.phone = lead.phone
                    changed = True
                if changed:
                    updated += 1
        db.commit()
        return {"ok": True, "updated": updated}

    if action == "swap_stages":
        name_a = data.get("stage_a", "")
        name_b = data.get("stage_b", "")
        if not name_a or not name_b:
            return {"error": "缺少 stage_a/stage_b"}, 400
        for row in db.query(ProjectProgress).filter(
            ProjectProgress.subsidy_type_id == subsidy_type_id,
            ProjectProgress.village_name != "待分配",
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


@router.post("/{subsidy_type_id}/batch-delete")
def batch_delete_progress(
    subsidy_type_id: int,
    data: dict,
    db: Session = Depends(get_db),
):
    """批量删除进度记录（传入 village_ids 列表）"""
    village_ids = data.get("village_ids", [])
    if not village_ids:
        return {"error": "缺少 village_ids"}, 400
    deleted = db.query(ProjectProgress).filter(
        ProjectProgress.subsidy_type_id == subsidy_type_id,
        ProjectProgress.village_id.in_(village_ids),
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": deleted}


@router.post("/{subsidy_type_id}/delete-stage")
def delete_stage(
    subsidy_type_id: int,
    data: dict,
    db: Session = Depends(get_db),
):
    """删除指定阶段（所有记录）"""
    stage_name = data.get("stage_name", "")
    if not stage_name:
        return {"error": "缺少 stage_name"}, 400

    records = db.query(ProjectProgress).filter(
        ProjectProgress.subsidy_type_id == subsidy_type_id
    ).all()

    updated = 0
    for rec in records:
        stages = json.loads(rec.stages) if rec.stages else []
        new_stages = [s for s in stages if s.get("name") != stage_name]
        if len(new_stages) != len(stages):
            rec.stages = json.dumps(new_stages, ensure_ascii=False)
            updated += 1

    db.commit()
    return {"ok": True, "updated": updated, "message": f"已从 {updated} 个村删除阶段「{stage_name}」"}


@router.post("/{subsidy_type_id}/scan-files")
def scan_files_for_progress(
    subsidy_type_id: int,
    data: dict,
    db: Session = Depends(get_db),
):
    """
    扫描本地目录，按子文件夹匹配阶段，按文件名匹配村名。
    目录结构: D:/材料/宣传动员/红星村.pdf
    data: { path: "D:/材料", stage_name: "宣传动员" }
    """
    import os
    from datetime import date as date_type

    scan_path = data.get("path", "")
    stage_name = data.get("stage_name", "")

    if not scan_path or not os.path.isdir(scan_path):
        return {"error": f"目录不存在: {scan_path}"}, 400
    if not stage_name:
        return {"error": "缺少 stage_name"}, 400

    # 查找匹配阶段名的子文件夹；若路径本身就有文件则直接使用
    stage_dir = None
    matched_stage = ""
    try:
        for entry in os.listdir(scan_path):
            full = os.path.join(scan_path, entry)
            if os.path.isdir(full):
                if stage_name in entry or entry in stage_name:
                    stage_dir = full
                    matched_stage = entry
                    break
        # 没找到子文件夹时，检查路径本身是否就直接包含了文件
        if not stage_dir:
            files_in_root = [f for f in os.listdir(scan_path) if os.path.isfile(os.path.join(scan_path, f))]
            if files_in_root:
                stage_dir = scan_path
                matched_stage = os.path.basename(scan_path)
    except Exception as e:
        return {"error": f"读取目录失败: {e}"}, 500

    if not stage_dir:
        return {"error": f"未找到匹配阶段「{stage_name}」的子文件夹，路径下也无文件"}, 400

    # 获取阶段文件夹下的文件名（不含扩展名）
    file_names: set[str] = set()
    try:
        for f in os.listdir(stage_dir):
            name, _ = os.path.splitext(f)
            file_names.add(name.strip())
    except Exception as e:
        return {"error": f"读取阶段目录失败: {e}"}, 500

    # 获取该项目的所有进度记录
    records = db.query(ProjectProgress).filter(
        ProjectProgress.subsidy_type_id == subsidy_type_id
    ).all()

    updated = 0
    today_str = date_type.today().isoformat()

    for rec in records:
        stages = json.loads(rec.stages) if rec.stages else []
        village = rec.village_name

        # 检查村名是否出现在文件名中
        found = any(village in f for f in file_names)

        # 查找或创建对应阶段
        stage_updated = False
        for s in stages:
            if s.get("name") == stage_name:
                if found and s.get("status") != "done":
                    s["status"] = "done"
                    s["date"] = today_str
                    stage_updated = True
                elif not found and s.get("status") == "done":
                    s["status"] = "none"
                    s["date"] = ""
                    stage_updated = True
                break
        else:
            status = "done" if found else "none"
            stages.append({"name": stage_name, "status": status, "date": today_str if found else "", "note": ""})
            stage_updated = True

        if stage_updated:
            rec.stages = json.dumps(stages, ensure_ascii=False)
            updated += 1

    db.commit()

    return {
        "ok": True,
        "updated": updated,
        "total": len(records),
        "scanned_files": len(file_names),
        "matched_stage_dir": matched_stage,
        "message": f"扫描完成：阶段「{matched_stage}」下 {len(file_names)} 个文件，更新 {updated}/{len(records)} 个村",
    }


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
