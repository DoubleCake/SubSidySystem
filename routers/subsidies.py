from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from database import get_db
from models import SubsidyType, SubsidyApplication, FarmerProfile, FamilyHousehold, VillageGroup
from schemas import (
    SubsidyTypeCreate, SubsidyTypeOut,
    ApplicationCreate, ApplicationUpdate, ApplicationOut,
    YearCompare, YearSummary,
)

router = APIRouter(prefix="/api/subsidies", tags=["补贴管理"])


# ════════════════════════════════
#  补贴类型
# ════════════════════════════════

@router.get("/types")
def list_subsidy_types(
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(SubsidyType)
    if year:
        q = q.filter(SubsidyType.subsidy_year == year)
    return q.order_by(SubsidyType.subsidy_year.desc()).all()


@router.post("/types")
def create_subsidy_type(data: SubsidyTypeCreate, db: Session = Depends(get_db)):
    st = SubsidyType(**data.model_dump())
    db.add(st)
    db.commit()
    db.refresh(st)
    return {"id": st.id, "message": "创建成功"}


@router.put("/types/{type_id}")
def update_subsidy_type(type_id: int, data: dict, db: Session = Depends(get_db)):
    st = db.get(SubsidyType, type_id)
    if not st:
        raise HTTPException(status_code=404, detail="补贴类型不存在")
    for k, v in data.items():
        if hasattr(st, k):
            setattr(st, k, v)
    db.commit()
    return {"message": "更新成功"}


# 批量导入申请记录
@router.post("/applications/batch-import")
def batch_import_applications(payload: dict, db: Session = Depends(get_db)):
    rows = payload.get("rows", [])
    created, skipped, errors = 0, 0, []
    for row in rows:
        try:
            exists = db.query(SubsidyApplication).filter(
                SubsidyApplication.farmer_id == row["farmer_id"],
                SubsidyApplication.subsidy_type_id == row["subsidy_type_id"],
                SubsidyApplication.apply_year == row["apply_year"],
            ).first()
            if exists:
                skipped += 1
                continue
            farmer = db.get(FarmerProfile, row["farmer_id"])
            app = SubsidyApplication(
                **{k: v for k, v in row.items() if k != "bank_card_snapshot"},
                bank_card_snapshot=f"****{farmer.bank_card[-4:]}" if farmer and farmer.bank_card else None,
            )
            db.add(app)
            created += 1
        except Exception as e:
            errors.append(str(e))
    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


# ════════════════════════════════
#  补贴申请记录
# ════════════════════════════════

@router.get("/applications")
def list_applications(
    year: Optional[int] = Query(None),
    farmer_id: Optional[int] = Query(None),
    village_name: Optional[str] = Query(None),
    pay_status: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(SubsidyApplication)

    if year:
        q = q.filter(SubsidyApplication.apply_year == year)
    if farmer_id:
        q = q.filter(SubsidyApplication.farmer_id == farmer_id)
    if pay_status is not None:
        q = q.filter(SubsidyApplication.pay_status == pay_status)
    if village_name:
        vg_ids = [v.id for v in db.query(VillageGroup)
                  .filter(VillageGroup.village_name == village_name).all()]
        hh_ids = [h.id for h in db.query(FamilyHousehold)
                  .filter(FamilyHousehold.village_group_id.in_(vg_ids)).all()]
        farmer_ids = [f.id for f in db.query(FarmerProfile)
                      .filter(FarmerProfile.household_id.in_(hh_ids)).all()]
        q = q.filter(SubsidyApplication.farmer_id.in_(farmer_ids))

    total = q.count()
    apps = q.offset((page - 1) * page_size).limit(page_size).all()

    result = []
    for a in apps:
        result.append({
            "id": a.id,
            "farmer_id": a.farmer_id,
            "farmer_name": a.farmer.real_name if a.farmer else "-",
            "subsidy_type_id": a.subsidy_type_id,
            "subsidy_name": a.subsidy_type.subsidy_name if a.subsidy_type else "-",
            "apply_year": a.apply_year,
            "apply_amount": a.apply_amount,
            "actual_amount": a.actual_amount,
            "apply_area": a.apply_area,
            "pay_status": a.pay_status,
            "pay_date": a.pay_date,
            "remark": a.remark,
        })

    return {"total": total, "page": page, "page_size": page_size, "items": result}


@router.post("/applications")
def create_application(data: ApplicationCreate, db: Session = Depends(get_db)):
    # 唯一性检查
    exists = db.query(SubsidyApplication).filter(
        SubsidyApplication.farmer_id == data.farmer_id,
        SubsidyApplication.subsidy_type_id == data.subsidy_type_id,
        SubsidyApplication.apply_year == data.apply_year,
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="该农户本年度该补贴已存在记录")

    # 快照银行卡
    farmer = db.get(FarmerProfile, data.farmer_id)
    if not farmer:
        raise HTTPException(status_code=404, detail="农户不存在")

    app = SubsidyApplication(
        **data.model_dump(),
        bank_card_snapshot=f"****{farmer.bank_card[-4:]}" if farmer.bank_card else None,
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return {"id": app.id, "message": "创建成功"}


@router.put("/applications/{app_id}")
def update_application(app_id: int, data: ApplicationUpdate, db: Session = Depends(get_db)):
    app = db.get(SubsidyApplication, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="记录不存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(app, k, v)
    db.commit()
    return {"message": "更新成功"}


# ════════════════════════════════
#  年度汇总对比
# ════════════════════════════════

@router.get("/summary/compare")
def year_compare(
    year: int = Query(..., description="当前年度"),
    db: Session = Depends(get_db),
):
    last_year = year - 1

    def get_summary(y: int) -> dict:
        apps = db.query(SubsidyApplication).filter(SubsidyApplication.apply_year == y).all()
        total = sum(float(a.actual_amount or 0) for a in apps)
        farmers = set(a.farmer_id for a in apps)
        return {
            "year": y,
            "total_amount": round(total, 2),
            "farmer_count": len(farmers),
            "application_count": len(apps),
            "farmer_ids": farmers,
        }

    cur  = get_summary(year)
    prev = get_summary(last_year)

    # 新增：今年有、去年没有
    new_ids  = cur["farmer_ids"] - prev["farmer_ids"]
    exit_ids = prev["farmer_ids"] - cur["farmer_ids"]

    def id_to_info(fid):
        f = db.get(FarmerProfile, fid)
        if not f:
            return {"id": fid, "name": "未知"}
        vg = db.get(VillageGroup, f.household.village_group_id) if f.household else None
        return {
            "id": f.id,
            "name": f.real_name,
            "village": vg.full_name if vg else "",
            "status": f.farmer_status,
        }

    amount_diff = cur["total_amount"] - prev["total_amount"]
    pct = round(amount_diff / prev["total_amount"] * 100, 1) if prev["total_amount"] else None

    return {
        "current_year": {k: v for k, v in cur.items() if k != "farmer_ids"},
        "last_year":    {k: v for k, v in prev.items() if k != "farmer_ids"},
        "new_farmers":  [id_to_info(i) for i in new_ids],
        "exit_farmers": [id_to_info(i) for i in exit_ids],
        "amount_diff": round(amount_diff, 2),
        "amount_diff_pct": pct,
    }


# ════════════════════════════════
#  按村汇总
# ════════════════════════════════

@router.get("/summary/by-village")
def summary_by_village(
    year: int = Query(...),
    db: Session = Depends(get_db),
):
    villages = db.query(VillageGroup.village_name).distinct().all()
    result = []

    for (vname,) in villages:
        vg_ids    = [v.id for v in db.query(VillageGroup).filter(VillageGroup.village_name == vname).all()]
        hh_ids    = [h.id for h in db.query(FamilyHousehold).filter(FamilyHousehold.village_group_id.in_(vg_ids)).all()]
        f_ids     = [f.id for f in db.query(FarmerProfile).filter(FarmerProfile.household_id.in_(hh_ids)).all()]
        apps      = db.query(SubsidyApplication).filter(
            SubsidyApplication.apply_year == year,
            SubsidyApplication.farmer_id.in_(f_ids),
        ).all()
        total     = sum(float(a.actual_amount or 0) for a in apps)
        beneficiaries = len(set(a.farmer_id for a in apps))

        result.append({
            "village_name": vname,
            "beneficiaries": beneficiaries,
            "total_amount": round(total, 2),
            "application_count": len(apps),
        })

    return sorted(result, key=lambda x: x["total_amount"], reverse=True)
