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
from utils import normalize_group_no, resolve_village_group

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


@router.get("/types/comparable")
def list_comparable_types(
    category: str = Query(..., description="项目分类"),
    current_type_id: int = Query(..., description="当前项目ID，排除自身"),
    db: Session = Depends(get_db),
):
    """
    获取同分类下的可对比项目列表（排除当前项目）
    """
    types = db.query(SubsidyType).filter(
        SubsidyType.category == category,
        SubsidyType.id != current_type_id
    ).order_by(SubsidyType.subsidy_year.desc()).all()
    
    return [{"id": t.id, "subsidy_name": t.subsidy_name, "subsidy_year": t.subsidy_year} for t in types]


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


@router.delete("/types/{type_id}")
def delete_subsidy_type(type_id: int, db: Session = Depends(get_db)):
    """删除补贴项目（会级联删除相关的补贴申请记录）"""
    from sqlalchemy import text
    
    # 检查项目是否存在
    st = db.get(SubsidyType, type_id)
    if not st:
        raise HTTPException(status_code=404, detail="补贴项目不存在")
    
    # 删除相关的补贴申请记录
    db.execute(text("DELETE FROM subsidy_application WHERE subsidy_type_id = :type_id"), {"type_id": type_id})
    
    # 删除补贴项目
    db.execute(text("DELETE FROM subsidy_type WHERE id = :type_id"), {"type_id": type_id})
    
    db.commit()
    return {"message": "删除成功"}


# 批量导入申请记录
@router.post("/applications/batch-import")
def batch_import_applications(payload: dict, db: Session = Depends(get_db)):
    from datetime import date as date_type
    from utils import parse_id_card, gen_household_code
    rows = payload.get("rows", [])
    created, skipped, errors = 0, 0, []
    new_farmers_created = 0

    def get_or_create_farmer(id_card: str, real_name: str, village_name: str = "", group_no: str = "") -> FarmerProfile | None:
        """按身份证查找农户，不存在则自动创建（含家庭户）；已存在则检查村组一致性"""
        nonlocal new_farmers_created
        from models import FamilyHousehold, VillageGroup

        # 解析村组
        vg, vg_err = resolve_village_group(db, village_name, group_no)

        fp = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
        if fp:
            # 已存在的农户：检查村组是否与数据库一致，不一致则报错（不允许在补贴导入中静默修改）
            if vg and fp.household_id:
                hh = db.get(FamilyHousehold, fp.household_id)
                if hh and hh.village_group_id != vg.id:
                    db_vg = db.get(VillageGroup, hh.village_group_id)
                    db_vg_name = f"{db_vg.village_name}{db_vg.group_no}" if db_vg else "未知"
                    errors.append(f"{real_name}（{id_card}）：数据库中所在村组为「{db_vg_name}」，导入数据为「{village_name}{group_no}」不一致，请先在农户管理中修改")
                    return None
            return fp

        if not vg:
            errors.append(f"{real_name}（{id_card}）：{vg_err}，无法创建农户")
            return None

        parsed = parse_id_card(id_card) or {}
        fp = FarmerProfile(
            household_id=0, real_name=real_name, gender=parsed.get("gender", 1),
            id_card=id_card, birth_date=parsed.get("birth_date"),
            is_head=1, relation="本人", farmer_status=1,
        )
        db.add(fp); db.flush()
        hh = FamilyHousehold(
            household_code=gen_household_code(fp.id),
            household_name=f"{real_name}户", head_farmer_id=fp.id,
            village_group_id=vg.id, status=1, member_count=1,
        )
        db.add(hh); db.flush()
        fp.household_id = hh.id
        new_farmers_created += 1
        return fp

    for row in rows:
        try:
            # 支持两种模式：传 farmer_id 或 传 id_card+real_name
            farmer = None
            if row.get("farmer_id"):
                farmer = db.get(FarmerProfile, row["farmer_id"])
            elif row.get("id_card") and row.get("real_name"):
                farmer = get_or_create_farmer(
                    str(row["id_card"]).strip(), str(row["real_name"]).strip(),
                    str(row.get("village_name", "")).strip(), str(row.get("group_no", "")).strip()
                )
            if not farmer:
                errors.append(f"{row.get('real_name','?')}：找不到农户且无法创建（缺少身份证或姓名）")
                continue
            row = dict(row)
            row["farmer_id"] = farmer.id
            exists = db.query(SubsidyApplication).filter(
                SubsidyApplication.farmer_id == farmer.id,
                SubsidyApplication.subsidy_type_id == row["subsidy_type_id"],
                SubsidyApplication.apply_year == row["apply_year"],
            ).first()
            if exists:
                skipped += 1
                continue
            # 关键修复：pay_date 字符串转 Python date 对象
            clean_row = {k: v for k, v in row.items() if k not in ("bank_card_snapshot", "id_card", "real_name", "village_name", "group_no", "bank_card")}
            if clean_row.get("pay_date") and isinstance(clean_row["pay_date"], str):
                try:
                    clean_row["pay_date"] = date_type.fromisoformat(clean_row["pay_date"])
                except ValueError:
                    clean_row["pay_date"] = None
            # 面积自动求和：实际补贴面积 = 承包地面积 + 代耕代种面积
            ca = float(clean_row.get("contract_area") or 0)
            ta = float(clean_row.get("trust_area") or 0)
            if ca or ta:
                clean_row["apply_area"] = round(ca + ta, 2)
                clean_row["contract_area"] = ca or None
                clean_row["trust_area"] = ta or None
            app = SubsidyApplication(
                **clean_row,
                bank_card_snapshot=f"****{farmer.bank_card[-4:]}" if farmer and farmer.bank_card else None,
            )
            db.add(app)
            created += 1
        except Exception as e:
            errors.append(str(e))
    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors, "new_farmers": new_farmers_created}


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
            "contract_area": a.contract_area,
            "trust_area": a.trust_area,
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

    data_dict = data.model_dump()
    if data_dict.get("pay_date") and isinstance(data_dict["pay_date"], str):
        from datetime import date as date_type
        try: data_dict["pay_date"] = date_type.fromisoformat(data_dict["pay_date"])
        except ValueError: data_dict["pay_date"] = None
    app = SubsidyApplication(
        **data_dict,
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
               st.category, st.apply_deadline, st.pay_status, st.description,
               st.count_toward_area,
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
    pay_status:       Optional[str] = Query(None,  description="支付状态，支持逗号分隔多值如 '1,2'"),
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
    if pay_status is not None:
        statuses = [int(s.strip()) for s in pay_status.split(',') if s.strip().isdigit()]
        if len(statuses) == 1:
            q = q.filter(SubsidyApplication.pay_status == statuses[0])
        elif len(statuses) > 1:
            q = q.filter(SubsidyApplication.pay_status.in_(statuses))
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
            "phone":           f.phone        if f  else None,
            "village":         vg.full_name   if vg else "—",
            "subsidy_type_id": a.subsidy_type_id,
            "subsidy_name":    st.subsidy_name if st else "—",
            "calc_mode":       st.calc_mode    if st else "fixed",
            "apply_year":      a.apply_year,
            "apply_area":      a.apply_area,
            "contract_area":   a.contract_area,
            "trust_area":      a.trust_area,
            "no_subsidy_area": a.no_subsidy_area,
            "apply_amount":    a.apply_amount,
            "actual_amount":   a.actual_amount,
            "pay_status":      a.pay_status,
            "pay_date":        str(a.pay_date) if a.pay_date else None,
            "remark":          a.remark,
        })
    return {"total": total, "page": page, "page_size": page_size, "items": rows}


# ── 删除补贴申请记录 ──
@router.delete("/applications/{app_id}")
def delete_application(app_id: int, db: Session = Depends(get_db)):
    from sqlalchemy import text
    app = db.execute(text("SELECT id FROM subsidy_application WHERE id=:id"), {"id": app_id}).fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="记录不存在")
    db.execute(text("DELETE FROM subsidy_application WHERE id=:id"), {"id": app_id})
    db.commit()
    return {"message": "删除成功"}


# ── 批量删除补贴申请记录 ──
@router.post("/applications/batch-delete")
def batch_delete_applications(payload: dict, db: Session = Depends(get_db)):
    from sqlalchemy import text
    ids = payload.get("ids", [])
    if not ids or not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="缺少 ids 列表")
    ids_str = ','.join(str(int(i)) for i in ids)
    result = db.execute(text(f"DELETE FROM subsidy_application WHERE id IN ({ids_str})"))
    db.commit()
    return {"deleted": result.rowcount}


# ── 批量标记已发放 ──
@router.post("/applications/batch-pay")
def batch_pay_applications(payload: dict, db: Session = Depends(get_db)):
    from sqlalchemy import text
    from datetime import date as date_type
    type_id  = payload.get("subsidy_type_id")
    app_ids  = payload.get("application_ids")
    pay_date_raw = payload.get("pay_date")
    status   = payload.get("pay_status", 2)

    # pay_date 转为 date 对象
    if pay_date_raw and isinstance(pay_date_raw, str):
        try:
            pay_date = date_type.fromisoformat(pay_date_raw)
        except ValueError:
            pay_date = date_type.today()
    else:
        pay_date = date_type.today()

    if app_ids and isinstance(app_ids, list) and len(app_ids) > 0:
        # 按指定的 application_ids 批量更新
        ids_str = ','.join(str(int(i)) for i in app_ids)
        result = db.execute(text(f"""
            UPDATE subsidy_application
            SET pay_status = :status, pay_date = :pay_date
            WHERE id IN ({ids_str})
        """), {"status": status, "pay_date": pay_date})
        db.commit()
        return {"updated": result.rowcount}

    if not type_id:
        raise HTTPException(status_code=400, detail="缺少 subsidy_type_id 或 application_ids")
    # 按 subsidy_type_id 批量更新
    result = db.execute(text("""
        UPDATE subsidy_application
        SET pay_status = :status, pay_date = :pay_date
        WHERE subsidy_type_id = :type_id
    """), {"status": status, "pay_date": pay_date, "type_id": type_id})
    db.commit()
    return {"updated": result.rowcount}


# ── 待办事项统计（首页用）──
@router.get("/dashboard/todos")
def get_todos(year: int = Query(...), db: Session = Depends(get_db)):
    from sqlalchemy import text
    # 未完成项目数
    incomplete_projects = db.execute(text(
        "SELECT COUNT(*) FROM subsidy_type WHERE subsidy_year=:y AND pay_status!=2"
    ), {"y": year}).scalar() or 0

    # 待发放记录数
    pending_records = db.execute(text(
        "SELECT COUNT(*) FROM subsidy_application sa "
        "JOIN subsidy_type st ON sa.subsidy_type_id=st.id "
        "WHERE st.subsidy_year=:y AND sa.pay_status=0"
    ), {"y": year}).scalar() or 0

    # 超领预警户数
    overdrawn = db.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT hh.id,
                   CAST(hh.land_area AS FLOAT) AS contracted,
                   SUM(CAST(sa.apply_area AS FLOAT)) AS used
            FROM family_household hh
            JOIN farmer_profile fp ON fp.household_id=hh.id
            JOIN subsidy_application sa ON sa.farmer_id=fp.id
            JOIN subsidy_type st ON sa.subsidy_type_id=st.id
            WHERE st.calc_mode='per_mu' AND st.subsidy_year=:y
              AND sa.pay_status!=3 AND hh.land_area IS NOT NULL
            GROUP BY hh.id
            HAVING used > contracted
        )
    """), {"y": year}).scalar() or 0

    # 格式错误身份证（简单检查长度）
    id_errors = db.execute(text(
        "SELECT COUNT(*) FROM farmer_profile WHERE LENGTH(id_card)!=18"
    )).scalar() or 0

    return {
        "incomplete_projects": int(incomplete_projects),
        "pending_records":     int(pending_records),
        "overdrawn_households":int(overdrawn),
        "id_card_errors":      int(id_errors),
    }


# ── 补贴项目统计（全部数据，不分页）──
@router.get("/applications/stats")
def get_application_stats(
    subsidy_type_id: int = Query(...),
    year: int = Query(...),
    compare_type_id: Optional[int] = Query(None, description="对比项目ID，用于计算新增/减少农户"),
    db: Session = Depends(get_db)
):
    """
    获取补贴项目的完整统计数据（不分页）
    返回：总额、各村分布、年度对比数据
    """
    from sqlalchemy import func, text
    from collections import defaultdict

    # 获取全部数据（不分页）
    q = db.query(SubsidyApplication).filter(
        SubsidyApplication.subsidy_type_id == subsidy_type_id,
        SubsidyApplication.apply_year == year
    )
    
    apps = q.all()
    
    if not apps:
        return {
            "totalAmount": 0,
            "totalFarmers": 0,
            "villageDistribution": [],
            "yearComparison": None
        }
    
    # 总额和总人数
    # 如果actual_amount为空，使用apply_amount作为备选
    total_amount = sum(float(app.actual_amount or app.apply_amount or 0) for app in apps)
    farmer_ids = [app.farmer_id for app in apps]
    
    # 各村统计
    village_stats = defaultdict(lambda: {"amount": 0, "count": 0})
    
    for app in apps:
        # 获取农户信息
        farmer = db.get(FarmerProfile, app.farmer_id)
        if farmer and farmer.household and farmer.household.village_group:
            village = farmer.household.village_group.village_name
        else:
            village = "未知村"
        
        amount = float(app.actual_amount or app.apply_amount or 0)
        village_stats[village]["amount"] += amount
        village_stats[village]["count"] += 1
    
    # 转换为列表并排序
    village_distribution = [
        {"village": village, **data}
        for village, data in village_stats.items()
    ]
    village_distribution.sort(key=lambda x: x["amount"], reverse=True)

    # 年度对比
    year_comparison = None
    if compare_type_id:
        # 获取对比项目的信息
        compare_type = db.get(SubsidyType, compare_type_id)
        if compare_type:
            # 获取对比项目的数据
            compare_apps = db.query(SubsidyApplication).filter(
                SubsidyApplication.subsidy_type_id == compare_type_id
            ).all()

            compare_farmer_ids = [app.farmer_id for app in compare_apps]

            # 计算新增和减少的农户
            new_farmers = list(set(farmer_ids) - set(compare_farmer_ids))
            removed_farmers = list(set(compare_farmer_ids) - set(farmer_ids))

            # 申报总面积和总人数
            total_apply_area = sum(float(app.apply_area or 0) for app in apps)

            year_comparison = {
                "current_year": year,
                "compare_year": compare_type.subsidy_year,
                "compare_type_id": compare_type_id,
                "compare_type_name": compare_type.subsidy_name,
                "new_farmers_count": len(new_farmers),
                "removed_farmers_count": len(removed_farmers),
                "new_farmers": new_farmers[:100],
                "removed_farmers": removed_farmers[:100],
                "total_apply_area": round(total_apply_area, 2),
                "total_farmers": len(farmer_ids)
            }

    return {
        "totalAmount": round(total_amount, 2),
        "totalFarmers": len(farmer_ids),
        "villageDistribution": village_distribution,
        "yearComparison": year_comparison
    }
