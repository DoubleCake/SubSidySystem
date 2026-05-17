from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional, List
from database import get_db
from models import FamilyHousehold, Village, VillageGroup

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


# ─────────────────────────────────────────
#  VillageGroup CRUD（村组定义）
# ─────────────────────────────────────────

@router.get("/village-groups")
def list_village_groups(db: Session = Depends(get_db)):
    """
    返回所有村及其下辖组，含各组农户数、面积统计。
    没有组的村也会出现（groups=[]）。
    """
    # 各村下的组 + 农户数 + 承包面积合计
    group_sql = text("""
        SELECT vg.id, vg.village_id, vg.group_no,
               vg.retained_land, vg.population,
               v.village_name,
               v.village_name || vg.group_no AS full_name,
               COUNT(hh.id) AS household_count,
               COALESCE(SUM(hh.contract_area), 0) AS farmer_land_total
        FROM village_group vg
        JOIN village v ON v.id = vg.village_id
        LEFT JOIN family_household hh
               ON hh.village_id = vg.village_id
              AND format_group_no(hh.group_no) = vg.group_no
              AND hh.status = 1
        GROUP BY vg.id, vg.village_id, vg.group_no, v.village_name, vg.retained_land, vg.population
        ORDER BY v.village_name, vg.group_no
    """)
    rows = db.execute(group_sql).mappings().all()

    # 流转面积统计（按组汇总）
    trust_sql = text("""
        SELECT hh.village_id, format_group_no(hh.group_no) AS group_no_str,
               COALESCE(SUM(CASE WHEN lt.owner_household_id = hh.id
                                  AND lt.operator_household_id IS NOT NULL
                                  AND lt.is_active = 1 AND lt.trust_type != 'IDLE'
                                 THEN lt.area END), 0) AS trust_out,
               COALESCE(SUM(CASE WHEN lt.operator_household_id = hh.id
                                  AND lt.is_active = 1 AND lt.trust_type != 'IDLE'
                                 THEN lt.area END), 0) AS trust_in
        FROM family_household hh
        LEFT JOIN land_trust lt ON lt.owner_household_id = hh.id OR lt.operator_household_id = hh.id
        WHERE hh.status = 1
        GROUP BY hh.village_id, hh.group_no
    """)
    trust_rows = db.execute(trust_sql).fetchall()
    trust_map: dict[tuple[int, str], tuple[float, float]] = {}
    for r in trust_rows:
        key = (r.village_id, r.group_no_str)
        trust_map[key] = (float(r.trust_out or 0), float(r.trust_in or 0))

    # 返回平铺列表（前端按 village_name 再分组）
    result = []
    for r in rows:
        key = (r["village_id"], r["group_no"])
        trust_out, trust_in = trust_map.get(key, (0.0, 0.0))
        retained = float(r["retained_land"] or 0)
        farmer_land = float(r["farmer_land_total"] or 0)
        result.append({
            "id":              r["id"],
            "village_id":      r["village_id"],
            "village_name":    r["village_name"],
            "group_no":        r["group_no"],
            "full_name":       r["full_name"],
            "household_count": r["household_count"] or 0,
            "retained_land":   retained,
            "population":      r["population"],
            "farmer_land_total":   farmer_land,
            "trust_out_total":     round(trust_out, 2),
            "trust_in_total":      round(trust_in, 2),
            "total_land":          round(retained + farmer_land + trust_out + trust_in, 2),
        })
    return result


class GroupCreate(BaseModel):
    village_name: str
    group_no: str

class GroupBatchCreate(BaseModel):
    rows: List[GroupCreate]

class GroupUpdate(BaseModel):
    village_name: Optional[str] = None
    group_no: Optional[str] = None
    retained_land: Optional[float] = None
    population: Optional[int] = None


@router.post("/village-groups")
def create_village_group(data: GroupCreate, db: Session = Depends(get_db)):
    """新增村组（村不存在时自动创建）"""
    vname = data.village_name.strip()
    gno   = data.group_no.strip()
    if not vname or not gno:
        raise HTTPException(status_code=400, detail="村名和组号不能为空")

    # 找或建村
    v = db.query(Village).filter(Village.village_name == vname).first()
    if not v:
        v = Village(village_name=vname)
        db.add(v); db.flush()

    # 检查重复
    exists = db.query(VillageGroup).filter(
        VillageGroup.village_id == v.id,
        VillageGroup.group_no == gno
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail=f"「{vname}{gno}」已存在")

    g = VillageGroup(village_id=v.id, group_no=gno)
    db.add(g); db.commit(); db.refresh(g)
    return {"id": g.id, "message": "创建成功"}


@router.post("/village-groups/batch")
def batch_create_village_groups(data: GroupBatchCreate, db: Session = Depends(get_db)):
    """批量新增村组"""
    created = skipped = 0
    for row in data.rows:
        vname = row.village_name.strip(); gno = row.group_no.strip()
        if not vname or not gno:
            continue
        v = db.query(Village).filter(Village.village_name == vname).first()
        if not v:
            v = Village(village_name=vname); db.add(v); db.flush()
        exists = db.query(VillageGroup).filter(
            VillageGroup.village_id == v.id,
            VillageGroup.group_no == gno
        ).first()
        if exists:
            skipped += 1
        else:
            db.add(VillageGroup(village_id=v.id, group_no=gno))
            created += 1
    db.commit()
    return {"created": created, "skipped": skipped}


@router.put("/village-groups/{group_id}")
def update_village_group(group_id: int, data: GroupUpdate, db: Session = Depends(get_db)):
    g = db.get(VillageGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="村组不存在")

    if data.village_name and data.village_name != g.village.village_name:
        v = db.query(Village).filter(Village.village_name == data.village_name.strip()).first()
        if not v:
            v = Village(village_name=data.village_name.strip()); db.add(v); db.flush()
        g.village_id = v.id

    if data.group_no:
        g.group_no = data.group_no.strip()

    if data.retained_land is not None:
        if data.retained_land < 0:
            raise HTTPException(status_code=400, detail="村留存土地不能为负数")
        g.retained_land = data.retained_land

    if data.population is not None:
        if data.population < 0:
            raise HTTPException(status_code=400, detail="人口数不能为负数")
        g.population = data.population

    db.commit()
    return {"message": "更新成功"}


@router.delete("/village-groups/{group_id}")
def delete_village_group(group_id: int, db: Session = Depends(get_db)):
    g = db.get(VillageGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="村组不存在")
    hh_count = db.query(FamilyHousehold).filter(
        FamilyHousehold.village_id == g.village_id
    ).count()
    if hh_count > 0:
        raise HTTPException(status_code=400, detail=f"该村下有 {hh_count} 户农户，无法删除组")
    db.delete(g); db.commit()
    return {"message": "删除成功"}
