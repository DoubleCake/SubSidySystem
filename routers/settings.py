from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from pydantic import BaseModel
from typing import Optional, List
from database import get_db
from models import FamilyHousehold, Village, VillageGroup, FarmerProfile, ProjectProgress, SubsidyApplication, SubsidyPayment, LargeFarmer, LandTrust, VillageContact, VillageLandInfo
from utils import format_group_no

router = APIRouter(prefix="/api/settings", tags=["基础设置"])


# ─────────────────────────────────────────
#  Village CRUD
# ─────────────────────────────────────────

class VillageCreate(BaseModel):
    village_name: str
    leader_name: Optional[str] = None
    leader_phone: Optional[str] = None

class VillageUpdate(BaseModel):
    village_name: Optional[str] = None
    leader_name: Optional[str] = None
    leader_phone: Optional[str] = None

@router.get("/villages")
def list_villages(db: Session = Depends(get_db)):
    items = db.query(Village).order_by(Village.village_name).all()
    return [
        {
            "id": v.id,
            "village_name": v.village_name,
            "leader_name": v.leader_name or "",
            "leader_phone": v.leader_phone or "",
            "household_count": len(v.households),
        }
        for v in items
    ]

@router.post("/villages")
def create_village(data: VillageCreate, db: Session = Depends(get_db)):
    exists = db.query(Village).filter(Village.village_name == data.village_name).first()
    if exists:
        raise HTTPException(status_code=400, detail=f"村「{data.village_name}」已存在")
    v = Village(village_name=data.village_name, leader_name=data.leader_name, leader_phone=data.leader_phone)
    db.add(v)
    db.commit()
    db.refresh(v)
    return {"id": v.id, "message": "创建成功"}

@router.put("/villages/{village_id}")
def update_village(village_id: int, data: VillageUpdate, db: Session = Depends(get_db)):
    v = db.get(Village, village_id)
    if not v:
        raise HTTPException(status_code=404, detail="村不存在")
    if data.village_name is not None:
        v.village_name = data.village_name
    if data.leader_name is not None:
        v.leader_name = data.leader_name
    if data.leader_phone is not None:
        v.leader_phone = data.leader_phone
    db.commit()
    return {"message": "更新成功"}

@router.get("/villages/{village_id}/references")
def check_village_references(village_id: int, db: Session = Depends(get_db)):
    """查看该村被哪些数据引用"""
    refs = {}
    refs["family_household"] = db.query(FamilyHousehold).filter(FamilyHousehold.village_id == village_id).count()
    refs["farmer_profile"] = db.query(FarmerProfile).filter(FarmerProfile.own_village_id == village_id).count()
    refs["village_group"] = db.query(VillageGroup).filter(VillageGroup.village_id == village_id).count()
    refs["project_progress"] = db.query(ProjectProgress).filter(ProjectProgress.village_id == village_id).count()
    refs["subsidy_application"] = db.query(SubsidyApplication).filter(SubsidyApplication.apply_village_id == village_id).count()
    refs["subsidy_payment"] = db.query(SubsidyPayment).filter(SubsidyPayment.payment_village_id == village_id).count()
    refs["large_farmer"] = db.query(LargeFarmer).filter(LargeFarmer.village_id == village_id).count()
    refs["land_trust_owner"] = db.query(LandTrust).filter(LandTrust.owner_household_id.isnot(None)).count()  # indirect
    total = sum(refs.values())
    return {"village_id": village_id, "references": refs, "total": total, "can_delete": total == 0}


@router.delete("/villages/{village_id}")
def delete_village(village_id: int, db: Session = Depends(get_db)):
    v = db.get(Village, village_id)
    if not v:
        raise HTTPException(status_code=404, detail="村不存在")
    # 检查所有引用
    refs = {}
    refs["家庭户"] = db.query(FamilyHousehold).filter(FamilyHousehold.village_id == village_id).count()
    refs["农户个人村"] = db.query(FarmerProfile).filter(FarmerProfile.own_village_id == village_id).count()
    refs["村组"] = db.query(VillageGroup).filter(VillageGroup.village_id == village_id).count()
    refs["项目进度"] = db.query(ProjectProgress).filter(ProjectProgress.village_id == village_id).count()
    refs["补贴申请"] = db.query(SubsidyApplication).filter(SubsidyApplication.apply_village_id == village_id).count()
    refs["补贴发放"] = db.query(SubsidyPayment).filter(SubsidyPayment.payment_village_id == village_id).count()
    refs["大户"] = db.query(LargeFarmer).filter(LargeFarmer.village_id == village_id).count()
    blockers = {k: v for k, v in refs.items() if v > 0}
    if blockers:
        detail = "；".join(f"{k}:{v}条" for k, v in blockers.items())
        raise HTTPException(status_code=400, detail=f"无法删除：{detail}")
    db.delete(v)
    db.commit()
    return {"message": "删除成功"}


@router.get("/villages/{village_id}/detail")
def get_village_detail(village_id: int, db: Session = Depends(get_db)):
    """获取村庄综合详情：干部+组+土地信息"""
    v = db.get(Village, village_id)
    if not v:
        raise HTTPException(status_code=404, detail="村不存在")

    # 联系人（按职务排序）
    pos_order = {"书记": 0, "副书记": 1, "副主任": 2, "文书": 3}
    contacts = db.query(VillageContact).filter(
        VillageContact.village_id == village_id
    ).all()
    contacts_out = []
    for c in contacts:
        # 尝试通过姓名查找农户
        farmer_id = None
        farmer = db.query(FarmerProfile).filter(
            FarmerProfile.real_name == c.name,
            FarmerProfile.own_village_id == village_id
        ).first()
        if farmer:
            farmer_id = farmer.id
        contacts_out.append({
            "id": c.id,
            "name": c.name,
            "phone": c.phone or "",
            "position": c.position or "",
            "is_agri_lead": bool(c.is_agri_lead),
            "sort_order": c.sort_order,
            "remark": c.remark or "",
            "farmer_id": farmer_id,
        })
    contacts_out.sort(key=lambda c: pos_order.get(c["position"], 99))

    # 村组（按组号排序），用 raw SQL 统计户数和面积（因为需要 format_group_no 匹配）
    group_stats_sql = text("""
        SELECT vg.id,
               COUNT(hh.id) AS household_count,
               COALESCE(SUM(hh.contract_area), 0) AS contract_area_total
        FROM village_group vg
        LEFT JOIN family_household hh
               ON hh.village_id = vg.village_id
              AND format_group_no(hh.group_no) = vg.group_no
              AND hh.status = 1
        WHERE vg.village_id = :vid
        GROUP BY vg.id
    """)
    stats_rows = db.execute(group_stats_sql, {"vid": village_id}).mappings().all()
    stats_map = {r["id"]: r for r in stats_rows}

    groups = db.query(VillageGroup).filter(
        VillageGroup.village_id == village_id
    ).order_by(VillageGroup.group_no).all()

    # 最新年度补贴统计（按组汇总）
    subsidy_group_sql = text("""
        SELECT format_group_no(hh.group_no) AS group_no_str,
               COUNT(DISTINCT hh.id) AS hh_count,
               COALESCE(SUM(sa.apply_area), 0) AS total_apply_area,
               COALESCE(SUM(sa.actual_amount), 0) AS total_amount,
               MAX(sa.apply_year) AS latest_year
        FROM family_household hh
        JOIN farmer_profile fp ON fp.household_id = hh.id
        JOIN subsidy_application sa ON sa.farmer_id = fp.id
        WHERE hh.village_id = :vid AND hh.status = 1
        GROUP BY hh.group_no
    """)
    sub_rows = db.execute(subsidy_group_sql, {"vid": village_id}).mappings().all()
    sub_map: dict = {}
    for r in sub_rows:
        key = r["group_no_str"] or ""
        sub_map[key] = {
            "subsidy_hh_count": r["hh_count"] or 0,
            "total_apply_area": round(float(r["total_apply_area"] or 0), 2),
            "total_amount": round(float(r["total_amount"] or 0), 2),
            "latest_year": r["latest_year"],
        }

    groups_out = []
    for g in groups:
        st = stats_map.get(g.id, {})
        hh_count = st.get("household_count", 0) or 0
        contract_area = float(st.get("contract_area_total", 0) or 0)
        sub = sub_map.get(g.group_no, {})

        # 组长关联农户
        leader_farmer_id = None
        if g.leader_name:
            f = db.query(FarmerProfile).filter(
                FarmerProfile.real_name == g.leader_name,
                FarmerProfile.own_village_id == village_id
            ).first()
            if f:
                leader_farmer_id = f.id

        groups_out.append({
            "id": g.id,
            "group_no": g.group_no,
            "leader_name": g.leader_name or "",
            "leader_phone": g.leader_phone or "",
            "leader_farmer_id": leader_farmer_id,
            "household_count": hh_count,
            "retained_land": float(g.retained_land or 0),
            "population": g.population or 0,
            "contract_area": contract_area,
            "subsidy_hh_count": sub.get("subsidy_hh_count", 0),
            "total_apply_area": sub.get("total_apply_area", 0),
            "total_amount": sub.get("total_amount", 0),
            "latest_year": sub.get("latest_year"),
        })

    # 土地基础信息
    land = db.query(VillageLandInfo).filter(
        VillageLandInfo.village_id == village_id
    ).first()
    land_out = None
    if land:
        land_out = {
            "id": land.id,
            "survey_year": land.survey_year,
            "paddy_area": float(land.paddy_area) if land.paddy_area else None,
            "dry_land_area": float(land.dry_land_area) if land.dry_land_area else None,
            "arable_area": float(land.arable_area) if land.arable_area else None,
            "irrigation_level": land.irrigation_level,
            "terrain_type": land.terrain_type,
            "soil_quality": land.soil_quality,
            "remark": land.remark,
        }

    return {
        "village_id": v.id,
        "village_name": v.village_name,
        "leader_name": v.leader_name or "",
        "leader_phone": v.leader_phone or "",
        "household_count": len(v.households),
        "contacts": contacts_out,
        "groups": groups_out,
        "land_info": land_out,
    }


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
               vg.leader_name, vg.leader_phone,
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
        GROUP BY vg.id, vg.village_id, vg.group_no, v.village_name, vg.retained_land, vg.population, vg.leader_name, vg.leader_phone
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
            "leader_name":     r["leader_name"] or "",
            "leader_phone":    r["leader_phone"] or "",
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
    leader_name: Optional[str] = None
    leader_phone: Optional[str] = None

class GroupBatchCreate(BaseModel):
    rows: List[GroupCreate]

class GroupUpdate(BaseModel):
    village_name: Optional[str] = None
    group_no: Optional[str] = None
    leader_name: Optional[str] = None
    leader_phone: Optional[str] = None
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

    g = VillageGroup(village_id=v.id, group_no=gno,
                     leader_name=data.leader_name, leader_phone=data.leader_phone)
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
            db.add(VillageGroup(village_id=v.id, group_no=gno,
                               leader_name=row.leader_name, leader_phone=row.leader_phone))
            created += 1
    db.commit()
    return {"created": created, "skipped": skipped}


class LeaderBatchRow(BaseModel):
    village_name: str
    group_no: str
    leader_name: str = ""
    leader_phone: str = ""

class LeaderBatchCreate(BaseModel):
    rows: List[LeaderBatchRow]


@router.post("/village-groups/batch-leaders")
def batch_update_leaders(data: LeaderBatchCreate, db: Session = Depends(get_db)):
    """批量更新村组负责人"""
    updated = 0
    for row in data.rows:
        vname = row.village_name.strip(); gno = row.group_no.strip()
        if not vname or not gno: continue
        v = db.query(Village).filter(Village.village_name == vname).first()
        if not v: continue
        g = db.query(VillageGroup).filter(
            VillageGroup.village_id == v.id,
            VillageGroup.group_no == gno,
        ).first()
        if g:
            g.leader_name = row.leader_name or None
            g.leader_phone = row.leader_phone or None
            updated += 1
    db.commit()
    return {"updated": updated}


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

    if data.leader_name is not None:
        g.leader_name = data.leader_name
    if data.leader_phone is not None:
        g.leader_phone = data.leader_phone

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
