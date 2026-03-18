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
    from sqlalchemy import text
    last_year = year - 1

    # 一条 SQL 同时算两年的汇总，完全在数据库完成
    sql_summary = text("""
        SELECT apply_year,
               ROUND(SUM(COALESCE(actual_amount, 0)), 2) AS total_amount,
               COUNT(DISTINCT farmer_id)                 AS farmer_count,
               COUNT(*)                                  AS application_count
        FROM subsidy_application
        WHERE apply_year IN (:y, :ly)
        GROUP BY apply_year
    """)
    rows = {r.apply_year: r for r in db.execute(sql_summary, {"y": year, "ly": last_year})}
    cur_r  = rows.get(year)
    prev_r = rows.get(last_year)

    cur  = {"year": year,      "total_amount": float(cur_r.total_amount  if cur_r  else 0),
            "farmer_count": int(cur_r.farmer_count  if cur_r  else 0),
            "application_count": int(cur_r.application_count  if cur_r  else 0)}
    prev = {"year": last_year, "total_amount": float(prev_r.total_amount if prev_r else 0),
            "farmer_count": int(prev_r.farmer_count if prev_r else 0),
            "application_count": int(prev_r.application_count if prev_r else 0)}

    # 新增/退出 也用 SQL 算，只取最多 50 条避免返回太多
    sql_diff = text("""
        SELECT fp.id, fp.real_name, fp.farmer_status,
               COALESCE(vg.full_name, '') AS village
        FROM farmer_profile fp
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village_group    vg ON hh.village_group_id = vg.id
        WHERE fp.id IN (
            SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :y
        ) AND fp.id NOT IN (
            SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :ly
        )
        LIMIT 50
    """)
    sql_exit = text("""
        SELECT fp.id, fp.real_name, fp.farmer_status,
               COALESCE(vg.full_name, '') AS village
        FROM farmer_profile fp
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village_group    vg ON hh.village_group_id = vg.id
        WHERE fp.id IN (
            SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :ly
        ) AND fp.id NOT IN (
            SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :y
        )
        LIMIT 50
    """)
    new_f  = [{"id":r.id,"name":r.real_name,"village":r.village,"status":r.farmer_status}
              for r in db.execute(sql_diff, {"y":year,"ly":last_year})]
    exit_f = [{"id":r.id,"name":r.real_name,"village":r.village,"status":r.farmer_status}
              for r in db.execute(sql_exit, {"y":year,"ly":last_year})]

    amount_diff = cur["total_amount"] - prev["total_amount"]
    pct = round(amount_diff / prev["total_amount"] * 100, 1) if prev["total_amount"] else None
    return {
        "current_year": cur, "last_year": prev,
        "new_farmers": new_f, "exit_farmers": exit_f,
        "amount_diff": round(amount_diff, 2), "amount_diff_pct": pct,
    }

# ════════════════════════════════
#  按村汇总
# ════════════════════════════════

@router.get("/summary/by-village")
def summary_by_village(
    year: int = Query(...),
    db: Session = Depends(get_db),
):
    from sqlalchemy import text
    # 一条 SQL 完成：按村汇总，全在数据库算
    sql = text("""
        SELECT vg.village_name,
               COUNT(DISTINCT sa.farmer_id)              AS beneficiaries,
               ROUND(SUM(COALESCE(sa.actual_amount,0)),2) AS total_amount,
               COUNT(sa.id)                              AS application_count
        FROM subsidy_application sa
        JOIN farmer_profile   fp ON sa.farmer_id = fp.id
        JOIN family_household hh ON fp.household_id = hh.id
        JOIN village_group    vg ON hh.village_group_id = vg.id
        WHERE sa.apply_year = :year
        GROUP BY vg.village_name
        ORDER BY total_amount DESC
    """)
    return [
        {"village_name": r.village_name, "beneficiaries": r.beneficiaries,
         "total_amount": float(r.total_amount), "application_count": r.application_count}
        for r in db.execute(sql, {"year": year})
    ]

# ════════════════════════════════
#  补贴类型 + 统计数据（首页用）
# ════════════════════════════════

@router.get("/types-with-stats")
def list_types_with_stats(
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    from sqlalchemy import text
    where = "WHERE st.subsidy_year = :year" if year else ""
    params = {"year": year} if year else {}

    sql = text(f"""
        SELECT st.id, st.subsidy_name, st.subsidy_year, st.calc_mode,
               st.standard_amount, st.standard_unit, st.fund_source,
               st.apply_deadline, st.pay_status, st.description,
               COUNT(sa.id)                               AS app_count,
               COUNT(DISTINCT sa.farmer_id)               AS beneficiary_count,
               ROUND(SUM(COALESCE(sa.apply_amount,0)),2)  AS total_apply,
               ROUND(SUM(COALESCE(sa.actual_amount,0)),2) AS total_actual
        FROM subsidy_type st
        LEFT JOIN subsidy_application sa ON sa.subsidy_type_id = st.id
        {where}
        GROUP BY st.id
        ORDER BY st.subsidy_year DESC, st.id
    """)
    return [dict(r._mapping) for r in db.execute(sql, params)]

# ════════════════════════════════
#  应用内补贴查询（外联查询页用）
# ════════════════════════════════

@router.get("/applications/search")
def search_applications(
    search:           Optional[str] = Query(None,  description="姓名或身份证号"),
    year:             Optional[int] = Query(None),
    subsidy_type_id:  Optional[int] = Query(None),
    village_name:     Optional[str] = Query(None),
    page:     int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """补贴申请搜索：支持姓名/身份证、年度、补贴类型、村组筛选"""
    from sqlalchemy import or_

    q = db.query(SubsidyApplication)

    if year:
        q = q.filter(SubsidyApplication.apply_year == year)
    if subsidy_type_id:
        q = q.filter(SubsidyApplication.subsidy_type_id == subsidy_type_id)
    if village_name:
        vg_ids  = [v.id for v in db.query(VillageGroup).filter(VillageGroup.village_name == village_name).all()]
        hh_ids  = [h.id for h in db.query(FamilyHousehold).filter(FamilyHousehold.village_group_id.in_(vg_ids)).all()]
        f_ids   = [f.id for f in db.query(FarmerProfile).filter(FarmerProfile.household_id.in_(hh_ids)).all()]
        q = q.filter(SubsidyApplication.farmer_id.in_(f_ids))
    if search:
        matched = db.query(FarmerProfile.id).filter(
            or_(FarmerProfile.real_name.contains(search),
                FarmerProfile.id_card.contains(search))
        ).all()
        matched_ids = [r.id for r in matched]
        q = q.filter(SubsidyApplication.farmer_id.in_(matched_ids))

    total = q.count()
    apps  = q.order_by(SubsidyApplication.apply_year.desc(), SubsidyApplication.id.desc())\
             .offset((page-1)*page_size).limit(page_size).all()

    rows = []
    for a in apps:
        f  = db.get(FarmerProfile, a.farmer_id)
        st = db.get(SubsidyType, a.subsidy_type_id)
        vg = None
        if f and f.household:
            vg = db.get(VillageGroup, f.household.village_group_id)
        rows.append({
            "id":              a.id,
            "farmer_id":       a.farmer_id,
            "farmer_name":     f.real_name    if f  else "—",
            "id_card_masked":  (f.id_card[:6] + "********" + f.id_card[-4:]) if f and f.id_card else "—",
            "village":         vg.full_name   if vg else "—",
            "subsidy_type_id": a.subsidy_type_id,
            "subsidy_name":    st.subsidy_name if st else "—",
            "calc_mode":       st.calc_mode    if st else "fixed",
            "apply_year":      a.apply_year,
            "apply_area":      a.apply_area,
            "apply_amount":    a.apply_amount,
            "actual_amount":   a.actual_amount,
            "pay_status":      a.pay_status,
            "pay_date":        str(a.pay_date) if a.pay_date else None,
            "remark":          a.remark,
        })
    return {"total": total, "page": page, "page_size": page_size, "items": rows}
