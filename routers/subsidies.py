from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from database import get_db
from models import SubsidyType, SubsidyApplication, SubsidyPayment, FarmerProfile, FamilyHousehold, Village, ErrorLibrary, HouseholdAreaUsageCache, SubsidyProxy
from schemas import (
    SubsidyTypeCreate, SubsidyTypeOut,
    ApplicationCreate, ApplicationUpdate, ApplicationOut,
    PaymentCreate, PaymentOut,
    YearCompare, YearSummary,
    SubsidyProxyCreate, SubsidyProxyOut,
)
from utils import parse_group_no_to_int, format_group_no, validate_id_card, parse_gender_from_id, check_area_anomaly

router = APIRouter(prefix="/api/subsidies", tags=["补贴管理"])


# ─────────────────────────────────────
#  批量操作后更新面积缓存
# ─────────────────────────────────────

def _recalc_household_cache_after_import(db: Session, household_ids: list[int]) -> None:
    """补贴申报或发放导入后，重新计算相关家庭户的面积缓存
    代领逻辑：本户成员作为代领人的不计入面积；本户成员作为受益人的要计入面积
    """
    from sqlalchemy import text
    SEASON_ORDER = ["大春", "小春", "全年单补", "临时"]

    for household_id in household_ids:
        hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
        if not hh:
            continue

        member_ids = [m.id for m in db.query(FarmerProfile.id)
                      .filter(FarmerProfile.household_id == household_id).all()]
        if not member_ids:
            db.query(HouseholdAreaUsageCache).filter(
                HouseholdAreaUsageCache.household_id == household_id
            ).delete()
            continue

        # 获取本户所有成员作为代领人的代领关系（不计入面积）
        proxy_as_proxy = {}  # { ('app'|'pay', id): True }
        proxy_query = db.query(SubsidyProxy).filter(
            SubsidyProxy.proxy_farmer_id.in_(member_ids)
        ).all()
        for pr in proxy_query:
            if pr.application_id:
                proxy_as_proxy[('app', pr.application_id)] = True
            if pr.payment_id:
                proxy_as_proxy[('pay', pr.payment_id)] = True

        # 获取本户所有成员作为受益人的代领关系（需要计入面积）
        proxy_as_beneficiary_app = {}  # { (year, season): [area] }
        proxy_as_beneficiary_pay = {}  # { (year, season): [area] }

        beneficiary_proxy_query = db.query(SubsidyProxy).filter(
            SubsidyProxy.beneficiary_farmer_id.in_(member_ids)
        ).all()

        for pr in beneficiary_proxy_query:
            # 查找对应的申请记录
            if pr.application_id:
                app = db.get(SubsidyApplication, pr.application_id)
                if app and app.apply_area:
                    st = db.get(SubsidyType, app.subsidy_type_id)
                    if st and st.calc_mode == "per_mu" and st.count_toward_area == 1:
                        season = st.season or "全年单补"
                        key = (app.apply_year, season)
                        if key not in proxy_as_beneficiary_app:
                            proxy_as_beneficiary_app[key] = []
                        proxy_as_beneficiary_app[key].append(float(app.apply_area))

            # 查找对应的发放记录
            if pr.payment_id:
                pay = db.get(SubsidyPayment, pr.payment_id)
                if pay and pay.apply_area:
                    st = db.get(SubsidyType, pay.subsidy_type_id)
                    if st and st.calc_mode == "per_mu" and st.count_toward_area == 1:
                        season = st.season or "全年单补"
                        key = (pay.payment_year, season)
                        if key not in proxy_as_beneficiary_pay:
                            proxy_as_beneficiary_pay[key] = []
                        proxy_as_beneficiary_pay[key].append(float(pay.apply_area))

        # 从申报表计算（排除本户成员作为代领人的记录）
        app_query = (
            db.query(
                SubsidyType.season,
                SubsidyApplication.apply_year,
                SubsidyApplication.apply_area,
                SubsidyApplication.id,
            )
            .join(SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id)
            .filter(
                SubsidyApplication.farmer_id.in_(member_ids),
                SubsidyType.calc_mode == "per_mu",
                SubsidyType.count_toward_area == 1,
                SubsidyApplication.apply_area.isnot(None),
                SubsidyApplication.pay_status.in_([0, 1, 2]),
            )
            .all()
        )
        app_data: dict[tuple, float] = {}
        all_years = set()
        for r in app_query:
            # 跳过本户成员作为代领人的记录
            if ('app', r.id) in proxy_as_proxy:
                continue
            season = r.season or "全年单补"
            year = r.apply_year
            all_years.add(year)
            key = (year, season)
            if key not in app_data:
                app_data[key] = 0.0
            app_data[key] += float(r.apply_area or 0)

        # 加上本户成员作为受益人的申请记录面积
        for key, areas in proxy_as_beneficiary_app.items():
            year, season = key
            all_years.add(year)
            if key not in app_data:
                app_data[key] = 0.0
            app_data[key] += sum(areas)

        # 从发放表计算（排除本户成员作为代领人的记录）
        pay_query = (
            db.query(
                SubsidyType.season,
                SubsidyPayment.payment_year,
                SubsidyPayment.apply_area,
                SubsidyPayment.id,
            )
            .join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
            .filter(
                SubsidyPayment.farmer_id.in_(member_ids),
                SubsidyType.calc_mode == "per_mu",
                SubsidyType.count_toward_area == 1,
                SubsidyPayment.apply_area.isnot(None),
            )
            .all()
        )
        pay_data: dict[tuple, float] = {}
        for r in pay_query:
            # 跳过本户成员作为代领人的记录
            if ('pay', r.id) in proxy_as_proxy:
                continue
            season = r.season or "全年单补"
            year = r.payment_year
            all_years.add(year)
            key = (year, season)
            if key not in pay_data:
                pay_data[key] = 0.0
            pay_data[key] += float(r.apply_area or 0)

        # 加上本户成员作为受益人的发放记录面积
        for key, areas in proxy_as_beneficiary_pay.items():
            year, season = key
            all_years.add(year)
            if key not in pay_data:
                pay_data[key] = 0.0
            pay_data[key] += sum(areas)

        # 更新缓存
        for year in all_years:
            for season in SEASON_ORDER:
                apply_area = app_data.get((year, season), 0.0)
                payment_area = pay_data.get((year, season), 0.0)
                used_area = payment_area if payment_area > 0 else apply_area

                existing = db.query(HouseholdAreaUsageCache).filter(
                    HouseholdAreaUsageCache.household_id == household_id,
                    HouseholdAreaUsageCache.year == year,
                    HouseholdAreaUsageCache.season == season,
                ).first()

                if existing:
                    existing.apply_area = apply_area
                    existing.payment_area = payment_area
                    existing.used_area = used_area
                else:
                    new_cache = HouseholdAreaUsageCache(
                        household_id=household_id,
                        year=year,
                        season=season,
                        apply_area=apply_area,
                        payment_area=payment_area,
                        used_area=used_area,
                    )
                    db.add(new_cache)

    db.commit()


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
    affected_households = set()  # 追踪受影响的家庭户

    def get_or_create_farmer(id_card: str, real_name: str, village_name: str = "", group_no: str = "") -> FarmerProfile | None:
        """按身份证查找农户，不存在则自动创建（含家庭户）；已存在则检查村组一致性"""
        nonlocal new_farmers_created
        from models import FamilyHousehold, Village

        # 解析村组：直接查找或创建 Village，group_no 转为整数
        if not village_name:
            errors.append(f"{real_name}（{id_card}）：缺少村名"); return None
        gno_int = parse_group_no_to_int(group_no) if group_no else 1
        village = db.query(Village).filter(Village.village_name == village_name).first()
        if not village:
            village = Village(village_name=village_name)
            db.add(village); db.flush()
        vid = village.id

        fp = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
        if fp:
            # 已存在的农户：检查村组是否与数据库一致，不一致则报错
            if vid and fp.household_id:
                hh = db.get(FamilyHousehold, fp.household_id)
                if hh and (hh.village_id != vid or hh.group_no != gno_int):
                    db_vname = hh.village.village_name if hh.village else "未知"
                    db_gno = format_group_no(hh.group_no) if hh.group_no else ""
                    errors.append(f"{real_name}（{id_card}）：数据库中所在村组为「{db_vname}{db_gno}」，导入数据为「{village_name}{format_group_no(gno_int)}」不一致，请先在农户管理中修改")
                    return None
            return fp

        if not vid:
            errors.append(f"{real_name}（{id_card}）：村组信息不完整，无法创建农户"); return None

        parsed = parse_id_card(id_card) or {}
        fp = FarmerProfile(
            household_id=0, real_name=real_name, gender=parsed.get("gender") or 1,
            id_card=id_card, relation="本人", farmer_status=1,
        )
        db.add(fp); db.flush()
        hh = FamilyHousehold(
            household_code=gen_household_code(fp.id),
            household_name=f"{real_name}户", head_farmer_id=fp.id,
            village_id=vid, group_no=gno_int, status=1,
        )
        db.add(hh); db.flush()
        fp.household_id = hh.id
        new_farmers_created += 1
        return fp

    for row in rows:
        sp = db.begin_nested()  # savepoint：每行独立隔离，一行失败不影响其他行
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
                sp.rollback()
                errors.append(f"{row.get('real_name','?')}：找不到农户且无法创建（缺少身份证或姓名）")
                continue
            row = dict(row)
            row["farmer_id"] = farmer.id
            # 申报(pay_status=0)和发放(pay_status>0)分别独立检查重复
            row_pay_status = row.get("pay_status", 0)
            if row_pay_status == 0:
                exists = db.query(SubsidyApplication).filter(
                    SubsidyApplication.farmer_id == farmer.id,
                    SubsidyApplication.subsidy_type_id == row["subsidy_type_id"],
                    SubsidyApplication.apply_year == row["apply_year"],
                    SubsidyApplication.pay_status == 0,
                ).first()
                if exists:
                    sp.rollback()
                    skipped += 1
                    continue
            else:
                exists = db.query(SubsidyApplication).filter(
                    SubsidyApplication.farmer_id == farmer.id,
                    SubsidyApplication.subsidy_type_id == row["subsidy_type_id"],
                    SubsidyApplication.apply_year == row["apply_year"],
                    SubsidyApplication.pay_status > 0,
                ).first()
                if exists:
                    sp.rollback()
                    skipped += 1
                    continue
            # 关键修复：pay_date 字符串转 Python date 对象
            clean_row = {k: v for k, v in row.items() if k not in ("bank_card_snapshot", "id_card", "real_name", "village_name", "group_no", "bank_card")}
            if clean_row.get("pay_date") and isinstance(clean_row["pay_date"], str):
                try:
                    clean_row["pay_date"] = date_type.fromisoformat(clean_row["pay_date"])
                except ValueError:
                    clean_row["pay_date"] = None
            # 面积处理：apply_area 优先；若未提供，用 contract_area + trust_area 自动求和
            ca = float(clean_row.get("contract_area") or 0)
            ta = float(clean_row.get("trust_area") or 0)
            if ca or ta:
                if not clean_row.get("apply_area"):
                    clean_row["apply_area"] = round(ca + ta, 2)
                clean_row["contract_area"] = ca or None
                clean_row["trust_area"] = ta or None
            # 村组快照：优先使用农户个人村组，否则用家庭户村组
            hh = farmer.household
            village_id = farmer.own_village_id or (hh.village_id if hh else None)
            group_no = farmer.own_group_no or (hh.group_no if hh else None)
            village_name = None
            group_display = None

            if village_id:
                village = db.get(Village, village_id)
                village_name = village.village_name if village else None
            if group_no:
                group_display = format_group_no(group_no)

            app = SubsidyApplication(
                **clean_row,
                apply_village_id=village_id,
                apply_group_no=group_no,
                apply_village_name=village_name,
                apply_group_display=group_display,
                bank_card_snapshot=f"****{farmer.bank_card[-4:]}" if farmer and farmer.bank_card else None,
            )
            db.add(app)
            sp.commit()
            affected_households.add(farmer.household_id)
            created += 1
        except Exception as e:
            sp.rollback()
            errors.append(str(e))
    db.commit()
    # 更新相关家庭户的面积缓存
    if affected_households:
        _recalc_household_cache_after_import(db, list(affected_households))
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
        village_ids = [v.id for v in db.query(Village)
                  .filter(Village.village_name == village_name).all()]
        hh_ids = [h.id for h in db.query(FamilyHousehold)
                  .filter(FamilyHousehold.village_id.in_(village_ids)).all()]
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


@router.get("/applications/villages")
def list_application_villages(
    subsidy_type_id: int = Query(...),
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """
    获取某补贴项目（及年度）下涉及的所有村庄列表
    """
    q = db.query(
        Village.village_name
    ).join(
        FamilyHousehold, FamilyHousehold.village_id == Village.id
    ).join(
        FarmerProfile, FarmerProfile.household_id == FamilyHousehold.id
    ).join(
        SubsidyApplication, SubsidyApplication.farmer_id == FarmerProfile.id
    ).filter(
        SubsidyApplication.subsidy_type_id == subsidy_type_id
    )
    if year:
        q = q.filter(SubsidyApplication.apply_year == year)

    # DISTINCT by village_name
    rows = q.distinct().all()
    villages = sorted(set(r[0] for r in rows if r[0]))

    return {"villages": villages}


@router.post("/applications")
def create_application(data: ApplicationCreate, db: Session = Depends(get_db)):
    # 唯一性检查：申报(pay_status=0)和发放(pay_status>0)分别独立检查
    # 即同一农户同一年度同一补贴类型可以同时有申报记录和发放记录
    if data.pay_status == 0:
        # 申报记录：只检查是否已有申报记录
        exists = db.query(SubsidyApplication).filter(
            SubsidyApplication.farmer_id == data.farmer_id,
            SubsidyApplication.subsidy_type_id == data.subsidy_type_id,
            SubsidyApplication.apply_year == data.apply_year,
            SubsidyApplication.pay_status == 0,
        ).first()
        if exists:
            raise HTTPException(status_code=400, detail="该农户本年度该补贴已存在申报记录")
    else:
        # 发放记录：只检查是否已有发放记录（pay_status>0）
        exists = db.query(SubsidyApplication).filter(
            SubsidyApplication.farmer_id == data.farmer_id,
            SubsidyApplication.subsidy_type_id == data.subsidy_type_id,
            SubsidyApplication.apply_year == data.apply_year,
            SubsidyApplication.pay_status > 0,
        ).first()
        if exists:
            raise HTTPException(status_code=400, detail="该农户本年度该补贴已存在发放记录")

    # 快照银行卡
    farmer = db.get(FarmerProfile, data.farmer_id)
    if not farmer:
        raise HTTPException(status_code=404, detail="农户不存在")

    data_dict = data.model_dump()
    if data_dict.get("pay_date") and isinstance(data_dict["pay_date"], str):
        from datetime import date as date_type
        try: data_dict["pay_date"] = date_type.fromisoformat(data_dict["pay_date"])
        except ValueError: data_dict["pay_date"] = None

    # 村组快照：优先使用农户个人村组，否则用家庭户村组
    hh = farmer.household
    village_id = farmer.own_village_id or (hh.village_id if hh else None)
    group_no = farmer.own_group_no or (hh.group_no if hh else None)
    village_name = None
    group_display = None

    if village_id:
        village = db.get(Village, village_id)
        village_name = village.village_name if village else None
    if group_no:
        group_display = format_group_no(group_no)

    app = SubsidyApplication(
        **data_dict,
        apply_village_id=village_id,
        apply_group_no=group_no,
        apply_village_name=village_name,
        apply_group_display=group_display,
        bank_card_snapshot=f"****{farmer.bank_card[-4:]}" if farmer.bank_card else None,
    )
    db.add(app)
    db.commit()
    db.refresh(app)

    # 触发面积缓存更新
    if farmer.household_id:
        _recalc_household_cache_after_import(db, [farmer.household_id])

    return {"id": app.id, "message": "创建成功"}


@router.put("/applications/{app_id}")
def update_application(app_id: int, data: ApplicationUpdate, db: Session = Depends(get_db)):
    app = db.get(SubsidyApplication, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="记录不存在")
    upd = data.model_dump(exclude_unset=True)
    area_changed = "apply_area" in upd or "pay_status" in upd
    for k, v in upd.items():
        setattr(app, k, v)
    db.commit()

    # 面积或状态变动时更新缓存
    if area_changed:
        farmer = db.get(FarmerProfile, app.farmer_id)
        if farmer and farmer.household_id:
            _recalc_household_cache_after_import(db, [farmer.household_id])

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
               COALESCE(v.village_name, '') AS village_name, COALESCE(hh.group_no, 1) AS group_no
        FROM farmer_profile fp
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE fp.id IN (
            SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :y
        ) AND fp.id NOT IN (
            SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :ly
        )
        LIMIT 50
    """)
    sql_exit = text("""
        SELECT fp.id, fp.real_name, fp.farmer_status,
               COALESCE(v.village_name, '') AS village_name, COALESCE(hh.group_no, 1) AS group_no
        FROM farmer_profile fp
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE fp.id IN (
            SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :ly
        ) AND fp.id NOT IN (
            SELECT DISTINCT farmer_id FROM subsidy_application WHERE apply_year = :y
        )
        LIMIT 50
    """)
    def _fmt_village(r):
        vn = r.village_name or ''
        gn = format_group_no(r.group_no) if r.group_no else '一组'
        return f"{vn}{gn}"
    new_f  = [{"id":r.id,"name":r.real_name,"village":_fmt_village(r),"status":r.farmer_status}
              for r in db.execute(sql_diff, {"y":year,"ly":last_year})]
    exit_f = [{"id":r.id,"name":r.real_name,"village":_fmt_village(r),"status":r.farmer_status}
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
        SELECT v.village_name,
               COUNT(DISTINCT sa.farmer_id)              AS beneficiaries,
               ROUND(SUM(COALESCE(sa.actual_amount,0)),2) AS total_amount,
               COUNT(sa.id)                              AS application_count
        FROM subsidy_application sa
        JOIN farmer_profile   fp ON sa.farmer_id = fp.id
        JOIN family_household hh ON fp.household_id = hh.id
        JOIN village v ON hh.village_id = v.id
        WHERE sa.apply_year = :year
        GROUP BY v.village_name
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
        SELECT st.id, st.subsidy_name, st.subsidy_year, st.season, st.calc_mode,
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
#  按季节汇总（首页用）
# ════════════════════════════════

@router.get("/summary/by-season")
def summary_by_season(year: int = Query(...), db: Session = Depends(get_db)):
    from sqlalchemy import text
    sql = text("""
        SELECT
            COALESCE(st.season, '全年单补') AS season,
            COUNT(DISTINCT st.id)                         AS project_count,
            COUNT(DISTINCT sa.farmer_id)                  AS farmer_count,
            ROUND(SUM(COALESCE(sa.actual_amount, 0)), 2)  AS total_amount,
            ROUND(SUM(COALESCE(sa.apply_area, 0)), 2)     AS total_area,
            COUNT(sa.id)                                  AS application_count
        FROM subsidy_type st
        LEFT JOIN subsidy_application sa
               ON sa.subsidy_type_id = st.id AND sa.apply_year = :year
        WHERE st.subsidy_year = :year
        GROUP BY COALESCE(st.season, '全年单补')
    """)
    rows = {r.season: r for r in db.execute(sql, {"year": year})}
    season_order = ["大春", "小春", "全年单补", "临时"]
    result = []
    for s in season_order:
        if s in rows:
            r = rows[s]
            result.append({
                "season": s,
                "project_count": int(r.project_count or 0),
                "farmer_count": int(r.farmer_count or 0),
                "total_amount": float(r.total_amount or 0),
                "total_area": float(r.total_area or 0),
                "application_count": int(r.application_count or 0),
            })
    return result


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
        v_ids  = [v.id for v in db.query(Village).filter(Village.village_name == village_name).all()]
        hh_ids  = [h.id for h in db.query(FamilyHousehold).filter(FamilyHousehold.village_id.in_(v_ids)).all()]
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
        vname, gno = "", ""
        if f and f.household:
            if f.household.village:
                vname = f.household.village.village_name
            gno = format_group_no(f.household.group_no) if f.household.group_no else "一组"
        rows.append({
            "id":              a.id,
            "farmer_id":       a.farmer_id,
            "farmer_name":     f.real_name    if f  else "—",
            "id_card_masked":  (f.id_card[:6] + "********" + f.id_card[-4:]) if f and f.id_card else "—",
            "phone":           f.phone        if f  else None,
            "village":         vname,
            "group_no":        gno,
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
            "proxy_remark":    None,
            "is_proxy":        a.is_proxy,
        })
    return {"total": total, "page": page, "page_size": page_size, "items": rows}


# ── 补贴申请数据预检（后端直接处理，不走前端中转）──
@router.post("/applications/precheck")
def precheck_applications(
    subsidy_typeId: int = Query(..., description="补贴类型ID"),
    payStatus: Optional[int] = Query(None, description="支付状态筛选"),
    villageName: Optional[str] = Query(None, description="村名筛选"),
    year: Optional[int] = Query(None, description="年度筛选"),
    db: Session = Depends(get_db),
):
    """
    后端直接执行补贴申请数据预检：
    - 在数据库端处理，无需传输敏感数据到前端
    - 支持分页批量处理大数据量
    """
    from sqlalchemy import or_
    from routers.precheck import validate_id_card, parse_gender_from_id

    # 获取补贴类型信息（season等）
    subsidy_type = db.query(SubsidyType).filter(SubsidyType.id == subsidy_typeId).first()
    season = subsidy_type.season if subsidy_type else None
    compare_year = year or (subsidy_type.subsidy_year if subsidy_type else None)

    # 1. 加载数据库基础数据
    all_village_names: set[str] = {v.village_name for v in db.query(Village).all()}
    village_name_to_id: dict[str, int] = {v.village_name: v.id for v in db.query(Village).all()}

    # 加载数据库中本年度、本季、本补贴类型的家庭户申请记录（含备注）
    db_hh_existing_apps: dict[int, list[dict]] = {}  # household_id → [申请记录列表]
    if season and compare_year:
        existing_apps = db.query(
            FarmerProfile.household_id,
            FarmerProfile.real_name,
            FarmerProfile.id_card,
            SubsidyApplication.remark,
            SubsidyType.subsidy_name,
            SubsidyType.season
        ).join(
            FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id
        ).join(
            SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id
        ).filter(
            SubsidyApplication.apply_year == compare_year,
            SubsidyType.season == season,
        ).all()

        for app in existing_apps:
            if app.household_id not in db_hh_existing_apps:
                db_hh_existing_apps[app.household_id] = []
            db_hh_existing_apps[app.household_id].append({
                "real_name": app.real_name,
                "id_card": app.id_card,
                "remark": app.remark,
                "subsidy_name": app.subsidy_name,
                "season": app.season
            })

    # 错误库（用于错误库命中检查）
    error_lib: dict[tuple[str, str], dict] = {}
    for e in db.query(ErrorLibrary).all():
        if e.id_card and e.real_name:
            error_lib[(e.id_card.strip(), e.real_name.strip())] = e

    # 数据库中所有在册农户（用于比对）
    db_farmers: dict[str, dict] = {}
    for f in db.query(FarmerProfile).join(
        FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
    ).join(Village, Village.id == FamilyHousehold.village_id).all():
        if f.id_card:
            db_farmers[f.id_card] = {
                "id": f.id,
                "real_name": f.real_name,
                "village_name": f.household.village.village_name if f.household and f.household.village else "",
                "group_no": f.household.group_no if f.household else 1,
                "contract_area": f.household.contract_area if f.household and f.household.contract_area else 0,
                "farmer_status": f.farmer_status,  # 1=在册, 0=离世
                "household_id": f.household_id,
            }

    # 按 household_id 分组，用于检测同一家庭多成员申请
    household_members: dict[int, list[dict]] = {}
    for f in db.query(FarmerProfile).filter(FarmerProfile.household_id.isnot(None)).all():
        if f.id_card and f.household_id:
            if f.household_id not in household_members:
                household_members[f.household_id] = []
            household_members[f.household_id].append({
                "id_card": f.id_card,
                "real_name": f.real_name,
                "farmer_id": f.id,
            })

    # 2. 查询符合条件的申请记录（分批处理）
    q = db.query(SubsidyApplication)
    if year:
        q = q.filter(SubsidyApplication.apply_year == year)
    q = q.filter(SubsidyApplication.subsidy_type_id == subsidy_typeId)
    if payStatus is not None:
        q = q.filter(SubsidyApplication.pay_status == payStatus)
    if villageName:
        v_ids = [v.id for v in db.query(Village).filter(Village.village_name == villageName).all()]
        hh_ids = [h.id for h in db.query(FamilyHousehold).filter(FamilyHousehold.village_id.in_(v_ids)).all()]
        f_ids = [f.id for f in db.query(FarmerProfile).filter(FarmerProfile.household_id.in_(hh_ids)).all()]
        q = q.filter(SubsidyApplication.farmer_id.in_(f_ids))

    total = q.count()

    # 分批处理，每批500条
    BATCH_SIZE = 500
    rows_data: list[dict] = []

    for offset in range(0, total, BATCH_SIZE):
        apps_batch = q.offset(offset).limit(BATCH_SIZE).all()
        for a in apps_batch:
            f = db.get(FarmerProfile, a.farmer_id)
            if not f or not f.id_card:
                continue
            vname = ""
            gno = 1
            db_contract_area = 0
            if f.household:
                if f.household.village:
                    vname = f.household.village.village_name
                gno = f.household.group_no or 1
                db_contract_area = f.household.contract_area or 0
            rows_data.append({
                "row_index": len(rows_data) + 2,
                "real_name": f.real_name,
                "id_card": f.id_card,
                "gender": f.gender,
                "village_name": vname,
                "group_no": format_group_no(gno) if isinstance(gno, int) else str(gno),
                "contract_area": a.contract_area,
                "db_contract_area": db_contract_area,
                "farmer_id": f.id,
                "household_id": f.household_id,
                "remark": a.remark,  # 补贴申请记录的备注
            })

    # 3. 执行预检逻辑
    format_errors: list[dict] = []
    village_errors: list[dict] = []
    duplicate_errors: list[dict] = []
    error_library_hits: list[dict] = []
    gender_mismatch: list[dict] = []
    area_anomalies: list[dict] = []
    area_missing: list[dict] = []        # 承包面积缺失
    age_anomaly: list[dict] = []          # 年龄异常
    deceased_farmers: list[dict] = []     # 死亡农户
    household_duplicates: list[dict] = [] # 同一家庭多成员申请
    changed_farmers: list[dict] = []
    new_farmers: list[dict] = []
    removed_farmers: list[dict] = []
    ok_rows: list[dict] = []
    seen_id_cards: dict[str, int] = {}
    seen_household_members: dict[int, list[dict]] = {}  # household_id -> [{id_card, row_no, name}]

    for row in rows_data:
        row_errors: list[str] = []
        row_no = row["row_index"]
        name = row["real_name"]
        id_card = row["id_card"]
        village = row["village_name"]
        group = row["group_no"]
        land_area = row["contract_area"]  # Excel中的申请面积（映射后字段名）
        db_contract_area_val = row["db_contract_area"]  # 数据库中的承包面积

        # 姓名检查
        if not name or not name.strip():
            row_errors.append("姓名为空")

        # 身份证检查
        id_ok, id_err = validate_id_card(id_card)
        if not id_ok:
            row_errors.append(f"身份证错误：{id_err}")

        # 村组检查
        if not village:
            row_errors.append("村名为空")
        elif village not in all_village_names:
            similar = [v for v in all_village_names if village in v or v in village]
            hint = f"（相近的村名：{'、'.join(similar[:3])}）" if similar else "（数据库中无此村）"
            village_errors.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "error": f"村「{village}」在数据库中不存在 {hint}"
            })

        if row_errors:
            format_errors.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "errors": row_errors,
                "error_count": len(row_errors),
            })
            continue

        # Excel内部重复身份证
        if id_card in seen_id_cards:
            duplicate_errors.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "error": f"身份证号与第{seen_id_cards[id_card]}行重复"
            })
            continue
        seen_id_cards[id_card] = row_no

        # 错误库交叉比对（身份证+姓名同时匹配）
        if (id_card.strip().upper(), name.strip()) in error_lib:
            lib_rec = error_lib[(id_card.strip().upper(), name.strip())]
            error_library_hits.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "error_type": lib_rec.error_type,
                "error_reason": lib_rec.error_reason,
                "source": lib_rec.source,
            })

        # 性别与身份证不符
        gender_text = row.get("gender", "")
        if gender_text:
            gender_from_id = parse_gender_from_id(id_card)
            gender_from_excel = 1 if gender_text in ("男", "1", "male") else (2 if gender_text in ("女", "2", "female") else 0)
            if gender_from_excel != 0 and gender_from_id != 0 and gender_from_excel != gender_from_id:
                gender_mismatch.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "excel_gender": gender_text,
                    "id_card_gender": "男" if gender_from_id == 1 else "女",
                    "error": f"Excel中性别为「{gender_text}」，但身份证显示为「{'男' if gender_from_id == 1 else '女'}」"
                })

        # 面积异常检查：使用统一的 check_area_anomaly 函数
        excel_contract_area = float(land_area) if land_area is not None else None
        # db_contract_area_val 已经在上面从 row["db_contract_area"] 获取了，这里确保是 float
        db_contract_area_val = float(db_contract_area_val) if db_contract_area_val is not None else None

        # 调用统一的面积异常检查函数
        anomaly_result = check_area_anomaly(
            excel_contract_area=excel_contract_area,
            db_contract_area=db_contract_area_val,
            apply_area=excel_contract_area,
            excel_trust_out=0,
            excel_trust_in=0,
            excel_no_subsidy=0,
            actual_subsidy_area=excel_contract_area,
            season=None,
            hh_used=0,
            ignore_trust_in=True
        )

        if anomaly_result["anomaly_type"]:
            area_anomalies.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "anomaly_type": anomaly_result["anomaly_type"],
                "anomaly_details": "；".join(anomaly_result["anomaly_details"]),
                "contract_area": excel_contract_area,     # Excel填报承包地面积
                "trust_out_area": 0.0,                     # 流转出
                "trust_in_area": 0.0,                      # 代耕代种进
                "no_subsidy_area": 0.0,                    # 不补贴
                "actual_subsidy_area": anomaly_result.get("final_subsidy", excel_contract_area),  # 实际补贴面积
                "self_occupy": anomaly_result["self_occupy"],           # 自有承包地占用（不含代耕代种）
                "hh_used": anomaly_result["hh_used"],                     # 户级当季已有申请面积
                "hh_total": anomaly_result["hh_total"],                    # 户级累计（已有+本行）
                "db_contract_area": anomaly_result["db_contract_area"] if "db_contract_area" in anomaly_result else db_contract_area_val,  # 数据库承包地（基准）
                "exceed_amount": anomaly_result["exceed_amount"],         # 超出量（如果有）
            })

        # 承包面积缺失检查
        if land_area is not None and (db_contract_area_val is None or db_contract_area_val == 0):
            area_missing.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "contract_area": float(land_area),
                "error": "有申请面积但数据库中无承包面积记录",
            })

        # 年龄异常检查（从身份证提取）
        if len(id_card) == 18:
            try:
                birth_year = int(id_card[6:10])
                age = 2026 - birth_year
                if age < 16 or age > 100:
                    age_anomaly.append({
                        "row": row_no, "name": name, "id_card": id_card,
                        "village": village, "group": group,
                        "age": age,
                        "birth_year": birth_year,
                        "error": f"年龄异常：{age}岁（{birth_year}年生）",
                    })
            except Exception:
                pass

        # 死亡农户检查
        if id_card in db_farmers and db_farmers[id_card].get("farmer_status") == 0:
            deceased_farmers.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "error": "该农户已标记为离世，不应出现在补贴名单中",
            })

        # 同一家庭多成员申请检测
        household_id = row.get("household_id")
        if household_id:
            if household_id not in seen_household_members:
                seen_household_members[household_id] = []
            seen_household_members[household_id].append({
                "id_card": id_card,
                "name": name,
                "row": row_no,
                "village": village,
                "group": group,
                "remark": row.get("remark"),  # Excel行备注
            })

        # 与数据库比对
        if id_card in db_farmers:
            db_f = db_farmers[id_card]
            changes: list[str] = []

            if name.strip() != db_f["real_name"].strip():
                changes.append(f"姓名：数据库「{db_f['real_name']}」→ Excel「{name}」")

            # 注：村组信息不进行比对，允许因嫁娶等原因导致户籍地址与领取地址不一致

            if changes:
                changed_farmers.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "db_name": db_f["real_name"],
                    "db_village": db_f["village_name"],
                    "db_group": format_group_no(db_f["group_no"]) if isinstance(db_f["group_no"], int) else str(db_f["group_no"]),
                    "changes": changes,
                    "farmer_id": db_f["id"],
                })
            else:
                ok_rows.append({"row": row_no, "name": name, "id_card": id_card})
        else:
            # 数据库中没有，本次是新增
            new_farmers.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
            })

    # 数据库中存在但Excel中没有的：减少的农户
    excel_id_cards = set(seen_id_cards.keys())
    for id_card, db_f in db_farmers.items():
        if id_card not in excel_id_cards and db_f.get("farmer_status") == 1:
            removed_farmers.append({
                "id_card": id_card,
                "name": db_f["real_name"],
                "village": db_f["village_name"],
                "group": db_f["group_no"],
                "farmer_id": db_f["id"],
            })

    # 同一家庭多成员申请（同一household有多条申请记录）
    for household_id, members in seen_household_members.items():
        if len(members) > 1:
            # 获取该家庭户在数据库中的已有申请记录（含备注）
            db_existing = db_hh_existing_apps.get(household_id, [])
            for m in members:
                household_duplicates.append({
                    "row": m["row"],
                    "name": m["name"],
                    "id_card": m["id_card"],
                    "village": m.get("village", ""),
                    "group": m.get("group", ""),
                    "household_id": household_id,
                    "total_count": len(members),
                    "other_members": [mem["name"] for mem in members if mem["id_card"] != m["id_card"]],
                    "excel_remark": m.get("remark"),  # Excel行备注
                    "db_existing_apps": db_existing,  # 数据库中已有申请记录（含备注）
                    "error": f"同一家庭户有{len(members)}人同时申请",
                })

    error_rows = (
        len(format_errors) + len(village_errors) + len(duplicate_errors)
        + len(gender_mismatch) + len(error_library_hits) + len(area_anomalies)
        + len(area_missing) + len(age_anomaly) + len(deceased_farmers) + len(household_duplicates)
    )
    summary = {
        "total_rows": len(rows_data),
        "ok_rows": len(ok_rows),
        "error_rows": error_rows,
        "format_errors": len(format_errors),
        "village_errors": len(village_errors),
        "duplicate_errors": len(duplicate_errors),
        "gender_mismatch": len(gender_mismatch),
        "error_library_hits": len(error_library_hits),
        "area_anomalies": len(area_anomalies),
        "area_missing": len(area_missing),
        "age_anomaly": len(age_anomaly),
        "deceased_farmers": len(deceased_farmers),
        "household_duplicates": len(household_duplicates),
        "new_farmers": len(new_farmers),
        "removed_farmers": len(removed_farmers),
        "changed_farmers": len(changed_farmers),
        "pass_rate": round((len(ok_rows) / len(rows_data) * 100), 1) if rows_data else 0,
    }

    return {
        "summary": summary,
        "format_errors": format_errors,
        "village_errors": village_errors,
        "duplicate_errors": duplicate_errors,
        "gender_mismatch": gender_mismatch,
        "error_library_hits": error_library_hits,
        "area_anomalies": area_anomalies,
        "area_missing": area_missing,
        "age_anomaly": age_anomaly,
        "deceased_farmers": deceased_farmers,
        "household_duplicates": household_duplicates,
        "new_farmers": new_farmers,
        "removed_farmers": removed_farmers,
        "changed_farmers": changed_farmers,
        "year_compare": {},
    }


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
        # 先查出受影响的家庭户
        affected = db.execute(text(f"""
            SELECT DISTINCT fp.household_id
            FROM subsidy_application sa
            JOIN farmer_profile fp ON fp.id = sa.farmer_id
            WHERE sa.id IN ({ids_str}) AND fp.household_id > 0
        """)).fetchall()
        result = db.execute(text(f"""
            UPDATE subsidy_application
            SET pay_status = :status, pay_date = :pay_date
            WHERE id IN ({ids_str})
        """), {"status": status, "pay_date": pay_date})
        db.commit()
        hh_ids = [r[0] for r in affected]
        if hh_ids:
            _recalc_household_cache_after_import(db, hh_ids)
        return {"updated": result.rowcount}

    if not type_id:
        raise HTTPException(status_code=400, detail="缺少 subsidy_type_id 或 application_ids")
    # 按 subsidy_type_id 批量更新，先查出受影响家庭户
    affected = db.execute(text("""
        SELECT DISTINCT fp.household_id
        FROM subsidy_application sa
        JOIN farmer_profile fp ON fp.id = sa.farmer_id
        WHERE sa.subsidy_type_id = :type_id AND fp.household_id > 0
    """), {"type_id": type_id}).fetchall()
    result = db.execute(text("""
        UPDATE subsidy_application
        SET pay_status = :status, pay_date = :pay_date
        WHERE subsidy_type_id = :type_id
    """), {"status": status, "pay_date": pay_date, "type_id": type_id})
    db.commit()
    hh_ids = [r[0] for r in affected]
    if hh_ids:
        _recalc_household_cache_after_import(db, hh_ids)
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
                   CAST(hh.contract_area AS FLOAT) AS contracted,
                   SUM(CAST(sa.apply_area AS FLOAT)) AS used
            FROM family_household hh
            JOIN farmer_profile fp ON fp.household_id=hh.id
            JOIN subsidy_application sa ON sa.farmer_id=fp.id
            JOIN subsidy_type st ON sa.subsidy_type_id=st.id
            WHERE st.calc_mode='per_mu' AND st.subsidy_year=:y
              AND sa.pay_status!=3 AND hh.contract_area IS NOT NULL
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
    返回：总额、总人数、总面积、各村分布、年度对比数据
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
            "totalArea": 0,
            "villageDistribution": [],
            "yearComparison": None
        }

    # 总额、总面积、去重农户数
    total_amount = sum(float(app.actual_amount or app.apply_amount or 0) for app in apps)
    total_area = sum(float(app.apply_area or 0) for app in apps)
    unique_farmer_ids = set(app.farmer_id for app in apps)

    # 各村统计
    village_stats = defaultdict(lambda: {"amount": 0, "count": 0, "area": 0})

    for app in apps:
        # 获取农户信息
        farmer = db.get(FarmerProfile, app.farmer_id)
        if farmer and farmer.household and farmer.household.village:
            village = farmer.household.village.village_name
        else:
            village = "未知村"

        amount = float(app.actual_amount or app.apply_amount or 0)
        area = float(app.apply_area or 0)
        village_stats[village]["amount"] += amount
        village_stats[village]["count"] += 1
        village_stats[village]["area"] += area

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
            compare_unique_farmer_ids = set(compare_farmer_ids)

            # 计算新增和减少的农户
            new_farmers = list(unique_farmer_ids - compare_unique_farmer_ids)
            removed_farmers = list(compare_unique_farmer_ids - unique_farmer_ids)

            # 申报总面积和总人数
            total_apply_area = sum(float(app.apply_area or 0) for app in apps)

            year_comparison = {
                "current_year": year,
                "compare_year": compare_type.subsidy_year,
                "compare_type_id": compare_type_id,
                "compare_type_name": compare_type.subsidy_name,
                "new_farmers_count": len(new_farmers),
                "removed_farmers_count": len(removed_farmers),
                "new_farmers": list(new_farmers)[:100],
                "removed_farmers": list(removed_farmers)[:100],
                "total_apply_area": round(total_apply_area, 2),
                "total_farmers": len(unique_farmer_ids)
            }

    return {
        "totalAmount": round(total_amount, 2),
        "totalFarmers": len(unique_farmer_ids),
        "totalArea": round(total_area, 2),
        "villageDistribution": village_distribution,
        "yearComparison": year_comparison
    }


# ════════════════════════════════
#  补贴发放记录（独立于申报表）
# ════════════════════════════════

@router.get("/payments")
def list_payments(
    year: Optional[int] = Query(None),
    subsidy_type_id: Optional[int] = Query(None),
    village_name: Optional[str] = Query(None),
    farmer_id: Optional[int] = Query(None),
    pay_status: Optional[int] = Query(None),
    search: Optional[str] = Query(None, description="姓名或身份证号"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """查询补贴发放记录"""
    from sqlalchemy import or_ as sql_or

    q = db.query(
        SubsidyPayment, FarmerProfile.real_name, SubsidyType.subsidy_name,
        Village.village_name, FamilyHousehold.group_no
    )
    q = q.join(FarmerProfile, FarmerProfile.id == SubsidyPayment.farmer_id)
    q = q.join(SubsidyType, SubsidyType.id == SubsidyPayment.subsidy_type_id)
    q = q.join(FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id)
    q = q.join(Village, Village.id == FamilyHousehold.village_id)

    if year:
        q = q.filter(SubsidyPayment.payment_year == year)
    if subsidy_type_id:
        q = q.filter(SubsidyPayment.subsidy_type_id == subsidy_type_id)
    if farmer_id:
        q = q.filter(SubsidyPayment.farmer_id == farmer_id)
    if village_name:
        q = q.filter(Village.village_name == village_name)
    if pay_status is not None:
        q = q.filter(SubsidyPayment.pay_status == pay_status)
    if search:
        q = q.filter(
            sql_or(
                FarmerProfile.real_name.contains(search),
                FarmerProfile.id_card.contains(search)
            )
        )

    total = q.count()
    offset = (page - 1) * page_size
    rows = q.order_by(SubsidyPayment.payment_year.desc(), SubsidyPayment.id.desc()).offset(offset).limit(page_size).all()

    # 查询代领关系，自动同步备注信息
    payment_ids = [p[0].id for p in rows]
    proxy_map = {}
    if payment_ids:
        proxy_rows = (
            db.query(
                SubsidyProxy.payment_id,
                SubsidyProxy.proxy_type,
                SubsidyProxy.beneficiary_farmer_id,
                SubsidyProxy.proxy_farmer_id,
                SubsidyProxy.remark,
            )
            .filter(SubsidyProxy.payment_id.in_(payment_ids))
            .all()
        )
        # 批量查询相关农户姓名和身份证
        involved_farmer_ids = set()
        for pr in proxy_rows:
            involved_farmer_ids.add(pr.beneficiary_farmer_id)
            involved_farmer_ids.add(pr.proxy_farmer_id)
        farmer_info = {}
        if involved_farmer_ids:
            farmers = db.query(FarmerProfile).filter(FarmerProfile.id.in_(involved_farmer_ids)).all()
            for f in farmers:
                id_card_masked = ""
                if f.id_card and len(f.id_card) == 18:
                    id_card_masked = f.id_card[:6] + "********" + f.id_card[-4:]
                farmer_info[f.id] = {"name": f.real_name, "id_card_masked": id_card_masked}

        for pr in proxy_rows:
            beneficiary_info = farmer_info.get(pr.beneficiary_farmer_id, {"name": "未知", "id_card_masked": ""})
            proxy_info = farmer_info.get(pr.proxy_farmer_id, {"name": "未知", "id_card_masked": ""})
            # 构建代领备注信息
            auto_remark = f"{pr.proxy_type}: {beneficiary_info['name']}({beneficiary_info['id_card_masked']}) 由 {proxy_info['name']}({proxy_info['id_card_masked']}) 代领"
            if pr.remark:
                auto_remark += f" | 备注: {pr.remark}"
            proxy_map[pr.payment_id] = auto_remark

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": p[0].id,
                "farmer_id": p[0].farmer_id,
                "farmer_name": p[1],
                "subsidy_type_id": p[0].subsidy_type_id,
                "subsidy_name": p[2],
                "village_name": p[3],
                "group_no": format_group_no(p[4]) if p[4] else "一组",
                "payment_year": p[0].payment_year,
                "amount": p[0].amount,
                "payment_date": p[0].payment_date,
                "apply_area": p[0].apply_area,
                "contract_area": p[0].contract_area,
                "trust_area": p[0].trust_area,
                "no_subsidy_area": p[0].no_subsidy_area,
                "bank_card_masked": f"****{p[0].bank_card[-4:]}" if p[0].bank_card else None,
                "bank_name": p[0].bank_name,
                "remark": p[0].remark,
                "proxy_remark": proxy_map.get(p[0].id, p[0].proxy_remark),
                "pay_status": p[0].pay_status,
                "is_proxy": p[0].is_proxy,
            }
            for p in rows
        ]
    }


@router.post("/payments")
def create_payment(data: PaymentCreate, db: Session = Depends(get_db)):
    """新增发放记录"""
    from models import SubsidyPayment

    # 唯一性检查
    exists = db.query(SubsidyPayment).filter(
        SubsidyPayment.farmer_id == data.farmer_id,
        SubsidyPayment.subsidy_type_id == data.subsidy_type_id,
        SubsidyPayment.payment_year == data.payment_year,
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="该农户该年度该补贴已存在发放记录")

    farmer = db.get(FarmerProfile, data.farmer_id)
    if not farmer:
        raise HTTPException(status_code=404, detail="农户不存在")

    # 村组快照：优先使用农户个人村组，否则用家庭户村组
    hh = farmer.household
    village_id = farmer.own_village_id or (hh.village_id if hh else None)
    group_no = farmer.own_group_no or (hh.group_no if hh else None)
    village_name = None
    group_display = None

    if village_id:
        village = db.get(Village, village_id)
        village_name = village.village_name if village else None
    if group_no:
        from utils import format_group_no
        group_display = format_group_no(group_no)

    payment = SubsidyPayment(
        farmer_id=data.farmer_id,
        subsidy_type_id=data.subsidy_type_id,
        payment_year=data.payment_year,
        amount=data.amount,
        payment_date=data.payment_date,
        payment_village_id=village_id,
        payment_group_no=group_no,
        payment_village_name=village_name,
        payment_group_display=group_display,
        apply_area=data.apply_area,
        contract_area=data.contract_area,
        trust_area=data.trust_area,
        no_subsidy_area=data.no_subsidy_area,
        bank_card=data.bank_card,
        bank_name=data.bank_name,
        remark=data.remark,
        proxy_remark=data.proxy_remark,
        pay_status=data.pay_status,
    )
    db.add(payment)

    # 同步对应申报记录的 pay_status → 已发放
    app = db.query(SubsidyApplication).filter(
        SubsidyApplication.farmer_id == data.farmer_id,
        SubsidyApplication.subsidy_type_id == data.subsidy_type_id,
        SubsidyApplication.apply_year == data.payment_year,
        SubsidyApplication.pay_status.in_([0, 1]),
    ).first()
    if app:
        app.pay_status = 2

    db.commit()

    # 重算面积缓存
    if farmer.household_id:
        _recalc_household_cache_after_import(db, [farmer.household_id])

    return {"id": payment.id, "message": "发放记录创建成功"}


@router.put("/payments/{payment_id}")
def update_payment(payment_id: int, data: dict, db: Session = Depends(get_db)):
    """更新发放记录"""
    payment = db.get(SubsidyPayment, payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="发放记录不存在")

    # 更新字段
    update_fields = ["amount", "payment_date", "apply_area", "contract_area",
                     "trust_area", "no_subsidy_area", "bank_card", "bank_name",
                     "remark", "proxy_remark", "pay_status"]
    for k, v in data.items():
        if k in update_fields and hasattr(payment, k):
            setattr(payment, k, v)

    db.commit()
    return {"message": "更新成功"}


@router.delete("/payments/{payment_id}")
def delete_payment(payment_id: int, db: Session = Depends(get_db)):
    """删除发放记录"""
    payment = db.get(SubsidyPayment, payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="发放记录不存在")

    farmer = db.get(FarmerProfile, payment.farmer_id)
    household_id = farmer.household_id if farmer else None

    # 回滚对应申报记录的 pay_status → 审核通过（1）
    app = db.query(SubsidyApplication).filter(
        SubsidyApplication.farmer_id == payment.farmer_id,
        SubsidyApplication.subsidy_type_id == payment.subsidy_type_id,
        SubsidyApplication.apply_year == payment.payment_year,
        SubsidyApplication.pay_status == 2,
    ).first()
    if app:
        app.pay_status = 1

    db.delete(payment)
    db.commit()

    # 重算面积缓存
    if household_id:
        _recalc_household_cache_after_import(db, [household_id])

    return {"message": "删除成功"}


@router.post("/payments/batch-import")
def batch_import_payments(payload: dict, db: Session = Depends(get_db)):
    """批量导入发放记录"""
    rows = payload.get("rows", [])
    created, skipped, errors = 0, 0, []
    affected_households = set()  # 追踪受影响的家庭户

    for row in rows:
        try:
            farmer_id = row.get("farmer_id")
            subsidy_type_id = row.get("subsidy_type_id")
            payment_year = row.get("payment_year")
            id_card = row.get("id_card", "").strip()
            real_name = row.get("real_name", "").strip()

            if not subsidy_type_id or not payment_year:
                errors.append(f"{real_name or id_card or '?'}：缺少必要字段")
                continue

            # 如果 farmer_id 为 0 或空，尝试用 id_card 查找农户
            farmer = None
            if not farmer_id and id_card:
                farmer = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
                if farmer:
                    farmer_id = farmer.id
                else:
                    errors.append(f"{real_name}（{id_card}）：农户不存在，请先在农户管理中添加")
                    continue
            elif farmer_id:
                farmer = db.get(FarmerProfile, farmer_id)
            if not farmer_id or not farmer:
                errors.append(f"{real_name or '?'}：缺少农户ID或身份证号")
                continue

            # 追踪受影响的家庭户
            if farmer.household_id:
                affected_households.add(farmer.household_id)

            # 唯一性检查
            exists = db.query(SubsidyPayment).filter(
                SubsidyPayment.farmer_id == farmer_id,
                SubsidyPayment.subsidy_type_id == subsidy_type_id,
                SubsidyPayment.payment_year == payment_year,
            ).first()
            if exists:
                skipped += 1
                continue

            # 村组快照：优先使用农户个人村组，否则用家庭户村组
            hh = farmer.household
            village_id = farmer.own_village_id or (hh.village_id if hh else None)
            group_no = farmer.own_group_no or (hh.group_no if hh else None)
            village_name = None
            group_display = None

            if village_id:
                village = db.get(Village, village_id)
                village_name = village.village_name if village else None
            if group_no:
                from utils import format_group_no
                group_display = format_group_no(group_no)

            payment = SubsidyPayment(
                farmer_id=farmer_id,
                subsidy_type_id=subsidy_type_id,
                payment_year=payment_year,
                amount=row.get("amount"),
                payment_date=row.get("payment_date"),
                payment_village_id=village_id,
                payment_group_no=group_no,
                payment_village_name=village_name,
                payment_group_display=group_display,
                apply_area=row.get("apply_area"),
                contract_area=row.get("contract_area"),
                trust_area=row.get("trust_area"),
                no_subsidy_area=row.get("no_subsidy_area"),
                bank_card=row.get("bank_card"),
                bank_name=row.get("bank_name"),
                remark=row.get("remark"),
                proxy_remark=row.get("proxy_remark"),
            )
            db.add(payment)
            # 同步对应申报记录的 pay_status → 已发放
            app = db.query(SubsidyApplication).filter(
                SubsidyApplication.farmer_id == farmer_id,
                SubsidyApplication.subsidy_type_id == subsidy_type_id,
                SubsidyApplication.apply_year == payment_year,
                SubsidyApplication.pay_status.in_([0, 1]),
            ).first()
            if app:
                app.pay_status = 2
            created += 1
        except Exception as e:
            errors.append(str(e))

    db.commit()
    # 更新相关家庭户的面积缓存
    if affected_households:
        _recalc_household_cache_after_import(db, list(affected_households))
    return {"created": created, "skipped": skipped, "errors": errors}


@router.post("/payments/sync-pay-status")
def sync_payment_status(db: Session = Depends(get_db)):
    """
    一次性修复：将 SubsidyPayment 表中已有发放记录对应的 SubsidyApplication.pay_status 同步为 2（已发放）。
    历史数据导入后调用一次即可。
    """
    payments = db.query(SubsidyPayment).all()
    synced = 0
    for p in payments:
        app = db.query(SubsidyApplication).filter(
            SubsidyApplication.farmer_id == p.farmer_id,
            SubsidyApplication.subsidy_type_id == p.subsidy_type_id,
            SubsidyApplication.apply_year == p.payment_year,
            SubsidyApplication.pay_status.in_([0, 1]),
        ).first()
        if app:
            app.pay_status = 2
            synced += 1
    db.commit()
    return {"synced": synced, "message": f"已同步 {synced} 条申报记录的发放状态"}




# ════════════════════════════════
#  代领关系管理
# ════════════════════════

@router.get("/proxies")
def list_proxies(
    application_id: Optional[int] = Query(None),
    payment_id: Optional[int] = Query(None),
    beneficiary_farmer_id: Optional[int] = Query(None),
    proxy_farmer_id: Optional[int] = Query(None),
    subsidy_type_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None, description="被代领人/代领人姓名"),
    db: Session = Depends(get_db),
):
    """查询代领关系列表"""
    from models import SubsidyProxy, SubsidyApplication, SubsidyPayment, FarmerProfile
    from sqlalchemy.orm import aliased
    from sqlalchemy import or_ as sql_or

    BeneficiaryFarmer = aliased(FarmerProfile)
    ProxyFarmer = aliased(FarmerProfile)

    q = db.query(SubsidyProxy)

    if application_id:
        q = q.filter(SubsidyProxy.application_id == application_id)
    if payment_id:
        q = q.filter(SubsidyProxy.payment_id == payment_id)
    if beneficiary_farmer_id:
        q = q.filter(SubsidyProxy.beneficiary_farmer_id == beneficiary_farmer_id)
    if proxy_farmer_id:
        q = q.filter(SubsidyProxy.proxy_farmer_id == proxy_farmer_id)

    # 按补贴类型筛选（直接使用存储的 subsidy_type_id）
    if subsidy_type_id:
        q = q.filter(SubsidyProxy.subsidy_type_id == subsidy_type_id)

    # 按姓名搜索（被代领人或代领人）
    if search:
        q = q.join(BeneficiaryFarmer, BeneficiaryFarmer.id == SubsidyProxy.beneficiary_farmer_id)\
             .join(ProxyFarmer, ProxyFarmer.id == SubsidyProxy.proxy_farmer_id)\
             .filter(
                 sql_or(
                     BeneficiaryFarmer.real_name.contains(search),
                     ProxyFarmer.real_name.contains(search)
                 )
             )

    results = q.order_by(SubsidyProxy.created_at.desc()).all()

    # 附加受益人、代领人信息（姓名和完整身份证）
    proxy_list = []
    for proxy in results:
        proxy_dict = {
            **proxy.__dict__,
            'beneficiary_farmer_name': None,
            'beneficiary_id_card_masked': None,
            'beneficiary_id_card': None,
            'proxy_farmer_name': None,
            'proxy_id_card_masked': None,
            'proxy_id_card': None,
        }
        beneficiary = db.get(FarmerProfile, proxy.beneficiary_farmer_id)
        if beneficiary:
            proxy_dict['beneficiary_farmer_name'] = beneficiary.real_name
            proxy_dict['beneficiary_id_card'] = beneficiary.id_card
            if beneficiary.id_card and len(beneficiary.id_card) == 18:
                proxy_dict['beneficiary_id_card_masked'] = beneficiary.id_card[:6] + "********" + beneficiary.id_card[-4:]
        proxy_farmer = db.get(FarmerProfile, proxy.proxy_farmer_id)
        if proxy_farmer:
            proxy_dict['proxy_farmer_name'] = proxy_farmer.real_name
            proxy_dict['proxy_id_card'] = proxy_farmer.id_card
            if proxy_farmer.id_card and len(proxy_farmer.id_card) == 18:
                proxy_dict['proxy_id_card_masked'] = proxy_farmer.id_card[:6] + "********" + proxy_farmer.id_card[-4:]
        # 移除 SQLAlchemy 内部字段
        proxy_dict.pop('_sa_instance_state', None)
        proxy_list.append(proxy_dict)

    return {"items": proxy_list, "total": len(proxy_list)}


@router.post("/proxies")
def create_proxy(data: SubsidyProxyCreate, db: Session = Depends(get_db)):
    """创建代领关系"""
    from models import SubsidyProxy, SubsidyApplication, SubsidyPayment, FarmerProfile

    # 验证农户存在
    beneficiary = db.get(FarmerProfile, data.beneficiary_farmer_id)
    if not beneficiary:
        raise HTTPException(status_code=404, detail="受益人不存在")
    proxy = db.get(FarmerProfile, data.proxy_farmer_id)
    if not proxy:
        raise HTTPException(status_code=404, detail="代领人不存在")

    # 检查重复：同一受益人 + 同一补贴项目类型已存在代领关系
    if data.subsidy_type_id:
        existing = db.query(SubsidyProxy).filter(
            SubsidyProxy.beneficiary_farmer_id == data.beneficiary_farmer_id,
            SubsidyProxy.subsidy_type_id == data.subsidy_type_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="该受益人已有此项目的代领关系，请勿重复创建")

    # 验证关联的补贴记录存在
    subsidy_type_id = data.subsidy_type_id
    if data.application_id:
        app = db.get(SubsidyApplication, data.application_id)
        if not app:
            raise HTTPException(status_code=404, detail="补贴申请记录不存在")
        # 更新申请记录的 is_proxy 标记
        app.is_proxy = 1
        # 同步补贴项目类型
        if not subsidy_type_id:
            subsidy_type_id = app.subsidy_type_id
    elif data.payment_id:
        pay = db.get(SubsidyPayment, data.payment_id)
        if not pay:
            raise HTTPException(status_code=404, detail="补贴发放记录不存在")
        # 同步补贴项目类型
        if not subsidy_type_id:
            subsidy_type_id = pay.subsidy_type_id
        # 注意：先不设置 is_proxy，等 proxy_rel 创建后再更新
    else:
        # 当没有指定具体记录时，自动查找代领人的发放记录并复制给受益人
        if subsidy_type_id:
            # 自动查找代领人在该补贴项目下的发放记录
            # 查找最近一年的发放记录
            pay_to_copy = db.query(SubsidyPayment).filter(
                SubsidyPayment.farmer_id == data.proxy_farmer_id,
                SubsidyPayment.subsidy_type_id == subsidy_type_id,
            ).order_by(SubsidyPayment.payment_year.desc()).first()

            if pay_to_copy:
                # 找到发放记录，标记稍后复制
                data._pay_to_copy = pay_to_copy

            # 同时标记已有的申请记录
            apps_to_update = db.query(SubsidyApplication).filter(
                SubsidyApplication.farmer_id == data.proxy_farmer_id,
                SubsidyApplication.subsidy_type_id == subsidy_type_id,
                SubsidyApplication.is_proxy == 0,
            ).all()
            for app in apps_to_update:
                app.is_proxy = 1

    # 创建代领关系
    proxy_rel = SubsidyProxy(
        **data.model_dump(exclude={'subsidy_type_id'}),
        subsidy_type_id=subsidy_type_id,
    )
    db.add(proxy_rel)
    db.flush()  # 获取 proxy_rel.id

    # 复制发放记录给受益人
    pay_source = None
    if data.payment_id:
        pay_source = db.get(SubsidyPayment, data.payment_id)
    elif hasattr(data, '_pay_to_copy') and data._pay_to_copy:
        pay_source = data._pay_to_copy

    if pay_source:
        # 创建复制记录，farmer_id 改为受益人
        pay_copy = SubsidyPayment(
            farmer_id=data.beneficiary_farmer_id,
            subsidy_type_id=pay_source.subsidy_type_id,
            payment_year=pay_source.payment_year,
            amount=pay_source.amount,
            payment_date=pay_source.payment_date,
            payment_village_id=pay_source.payment_village_id,
            payment_group_no=pay_source.payment_group_no,
            payment_village_name=pay_source.payment_village_name,
            payment_group_display=pay_source.payment_group_display,
            apply_area=pay_source.apply_area,
            contract_area=pay_source.contract_area,
            trust_area=pay_source.trust_area,
            no_subsidy_area=pay_source.no_subsidy_area,
            bank_card=pay_source.bank_card,
            bank_name=pay_source.bank_name,
            operator_id=pay_source.operator_id,
            remark=pay_source.remark,
            proxy_remark=data.remark or pay_source.proxy_remark,
            pay_status=pay_source.pay_status,
            is_proxy=proxy_rel.id,  # 指向代领关系
        )
        db.add(pay_copy)
        # 更新原记录的 is_proxy（标记为这是代领方的记录）
        pay_source.is_proxy = proxy_rel.id

    db.commit()
    db.refresh(proxy_rel)

    # 触发面积缓存更新
    affected_households = set()
    if beneficiary.household_id:
        affected_households.add(beneficiary.household_id)
    if proxy.household_id:
        affected_households.add(proxy.household_id)
    if affected_households:
        _recalc_household_cache_after_import(db, list(affected_households))

    return {"id": proxy_rel.id, "message": "代领关系创建成功"}


@router.get("/applications/stats-by-village")
def get_stats_by_village(
    subsidy_type_id: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db)
):
    """
    按村统计面积数据（实际补贴面积、承包地面积、代耕代种面积、不予补贴面积）
    代领关系处理：代领人的记录不计入，只计入受益人的记录（避免重复计算）
    """
    from sqlalchemy import text

    # 主统计SQL - 按村统计，使用子查询排除重复的代领人记录
    stats_sql = text("""
        WITH exclude_applications AS (
            SELECT DISTINCT sa.id
            FROM subsidy_application sa
            JOIN subsidy_proxy pr ON sa.farmer_id = pr.proxy_farmer_id
                AND sa.subsidy_type_id = pr.subsidy_type_id
            WHERE sa.subsidy_type_id = :subsidy_type_id
                AND sa.apply_year = :year
                AND sa.is_proxy > 0
                AND EXISTS (
                    SELECT 1 FROM subsidy_application sa2
                    WHERE sa2.farmer_id = pr.beneficiary_farmer_id
                        AND sa2.subsidy_type_id = pr.subsidy_type_id
                        AND sa2.apply_year = :year
                )
        )
        SELECT
            v.village_name,
            COUNT(DISTINCT fp.id) as farmer_count,
            COUNT(DISTINCT sa.id) as record_count,
            ROUND(SUM(COALESCE(sa.apply_area, 0)), 2) as total_apply_area,
            ROUND(SUM(COALESCE(sa.contract_area, 0)), 2) as total_contract_area,
            ROUND(SUM(COALESCE(sa.trust_area, 0)), 2) as total_trust_area,
            ROUND(SUM(COALESCE(sa.no_subsidy_area, 0)), 2) as total_no_subsidy_area,
            ROUND(SUM(COALESCE(sa.actual_amount, sa.apply_amount, 0)), 2) as total_amount
        FROM subsidy_application sa
        JOIN farmer_profile fp ON sa.farmer_id = fp.id
        JOIN family_household hh ON fp.household_id = hh.id
        JOIN village v ON hh.village_id = v.id
        WHERE sa.subsidy_type_id = :subsidy_type_id
            AND sa.apply_year = :year
            AND sa.id NOT IN (SELECT id FROM exclude_applications)
        GROUP BY v.village_name
        ORDER BY v.village_name
    """)

    # 发放表统计（如果有发放数据的话）
    payment_stats_sql = text("""
        WITH exclude_payments AS (
            SELECT DISTINCT sp.id
            FROM subsidy_payment sp
            JOIN subsidy_proxy pr ON sp.farmer_id = pr.proxy_farmer_id
                AND sp.subsidy_type_id = pr.subsidy_type_id
            WHERE sp.subsidy_type_id = :subsidy_type_id
                AND sp.payment_year = :year
                AND sp.is_proxy > 0
                AND EXISTS (
                    SELECT 1 FROM subsidy_payment sp2
                    WHERE sp2.farmer_id = pr.beneficiary_farmer_id
                        AND sp2.subsidy_type_id = pr.subsidy_type_id
                        AND sp2.payment_year = :year
                )
        )
        SELECT
            v.village_name,
            COUNT(DISTINCT fp.id) as farmer_count,
            COUNT(DISTINCT sp.id) as record_count,
            ROUND(SUM(COALESCE(sp.apply_area, 0)), 2) as total_apply_area,
            ROUND(SUM(COALESCE(sp.contract_area, 0)), 2) as total_contract_area,
            ROUND(SUM(COALESCE(sp.trust_area, 0)), 2) as total_trust_area,
            ROUND(SUM(COALESCE(sp.no_subsidy_area, 0)), 2) as total_no_subsidy_area,
            ROUND(SUM(COALESCE(sp.amount, 0)), 2) as total_amount
        FROM subsidy_payment sp
        JOIN farmer_profile fp ON sp.farmer_id = fp.id
        JOIN family_household hh ON fp.household_id = hh.id
        JOIN village v ON hh.village_id = v.id
        WHERE sp.subsidy_type_id = :subsidy_type_id
            AND sp.payment_year = :year
            AND sp.id NOT IN (SELECT id FROM exclude_payments)
        GROUP BY v.village_name
        ORDER BY v.village_name
    """)

    # 先查有没有发放数据
    payment_count = db.query(func.count(SubsidyPayment.id)).filter(
        SubsidyPayment.subsidy_type_id == subsidy_type_id,
        SubsidyPayment.payment_year == year
    ).scalar()

    use_payment = payment_count > 0
    sql = payment_stats_sql if use_payment else stats_sql

    params = {
        "subsidy_type_id": subsidy_type_id,
        "year": year
    }

    rows = db.execute(sql, params).fetchall()

    village_stats = []
    totals = {
        "village": "合计",
        "farmer_count": 0,
        "record_count": 0,
        "total_apply_area": 0.0,
        "total_contract_area": 0.0,
        "total_trust_area": 0.0,
        "total_no_subsidy_area": 0.0,
        "total_amount": 0.0
    }

    for r in rows:
        stat = {
            "village": r.village_name,
            "farmer_count": r.farmer_count,
            "record_count": r.record_count,
            "total_apply_area": float(r.total_apply_area or 0),
            "total_contract_area": float(r.total_contract_area or 0),
            "total_trust_area": float(r.total_trust_area or 0),
            "total_no_subsidy_area": float(r.total_no_subsidy_area or 0),
            "total_amount": float(r.total_amount or 0)
        }
        village_stats.append(stat)

        totals["farmer_count"] += stat["farmer_count"]
        totals["record_count"] += stat["record_count"]
        totals["total_apply_area"] += stat["total_apply_area"]
        totals["total_contract_area"] += stat["total_contract_area"]
        totals["total_trust_area"] += stat["total_trust_area"]
        totals["total_no_subsidy_area"] += stat["total_no_subsidy_area"]
        totals["total_amount"] += stat["total_amount"]

    # 对合计值进行四舍五入
    for key in ["total_apply_area", "total_contract_area", "total_trust_area", "total_no_subsidy_area", "total_amount"]:
        totals[key] = round(totals[key], 2)

    return {
        "by_village": village_stats,
        "total": totals,
        "data_source": "payment" if use_payment else "application"
    }


@router.delete("/proxies/{proxy_id}")
def delete_proxy(proxy_id: int, db: Session = Depends(get_db)):
    """删除代领关系"""
    from models import SubsidyProxy, SubsidyApplication, SubsidyPayment

    proxy_rel = db.get(SubsidyProxy, proxy_id)
    if not proxy_rel:
        raise HTTPException(status_code=404, detail="代领关系不存在")

    # 清除相关补贴记录的 is_proxy 标记
    affected_households = set()

    # 处理 application_id 的情况
    if proxy_rel.application_id:
        app = db.get(SubsidyApplication, proxy_rel.application_id)
        if app:
            app.is_proxy = 0
            # 获取受益人家庭户
            beneficiary = db.get(FarmerProfile, proxy_rel.beneficiary_farmer_id)
            if beneficiary and beneficiary.household_id:
                affected_households.add(beneficiary.household_id)

    # 处理 payment_id 的情况：删除为受益人生成的复制记录，恢复原记录的 is_proxy
    if proxy_rel.payment_id:
        # 查找并删除受益人的复制记录（is_proxy = proxy_id 且 farmer_id = beneficiary_farmer_id）
        copied_pays = db.query(SubsidyPayment).filter(
            SubsidyPayment.is_proxy == proxy_id,
            SubsidyPayment.farmer_id == proxy_rel.beneficiary_farmer_id,
        ).all()
        for cp in copied_pays:
            db.delete(cp)
            # 获取受益人家庭户
            beneficiary = db.get(FarmerProfile, cp.farmer_id)
            if beneficiary and beneficiary.household_id:
                affected_households.add(beneficiary.household_id)

        # 恢复原记录的 is_proxy
        original_pay = db.get(SubsidyPayment, proxy_rel.payment_id)
        if original_pay:
            original_pay.is_proxy = 0
            # 获取代领人家庭户
            proxy_farmer = db.get(FarmerProfile, proxy_rel.proxy_farmer_id)
            if proxy_farmer and proxy_farmer.household_id:
                affected_households.add(proxy_farmer.household_id)

    # 删除代领关系
    db.delete(proxy_rel)
    db.commit()

    # 触发面积缓存更新
    if affected_households:
        _recalc_household_cache_after_import(db, list(affected_households))

    return {"message": "代领关系删除成功"}
