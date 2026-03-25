from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from database import get_db
from models import FarmerProfile, FamilyHousehold, VillageGroup
from schemas import FarmerCreate, FarmerUpdate
from utils import mask_id_card, mask_phone, mask_bank_card, parse_id_card, gen_household_code, resolve_village_group

router = APIRouter(prefix="/api/farmers", tags=["农户管理"])

# ══════════════════════════════════════
# 核心改动：全部用原生 SQL + LEFT JOIN，
# 完全绕开 ORM relationship lazy load，
# 无论 household 关联是否完整都能正常返回数据
# ══════════════════════════════════════

_COLS = """
    fp.id, fp.household_id, fp.real_name, fp.gender, fp.id_card,
    fp.phone, fp.bank_card, fp.bank_name, fp.is_head, fp.relation,
    fp.farmer_status, fp.remark, fp.created_at, fp.birth_date,
    hh.land_area, hh.address, hh.household_code,
    COALESCE(vg.full_name, vg.village_name || vg.group_no, '未知村组') AS village_full_name,
    vg.village_name, vg.group_no
FROM farmer_profile fp
LEFT JOIN family_household hh ON fp.household_id = hh.id
LEFT JOIN village_group    vg ON hh.village_group_id = vg.id
"""

def _to_list(r) -> dict:
    m = dict(r._mapping)
    return {
        "id":               m.get("id"),
        "household_id":     m.get("household_id") or 0,
        "real_name":        m.get("real_name") or "—",
        "gender":           m.get("gender") or 1,
        "id_card_masked":   mask_id_card(m["id_card"]) if m.get("id_card") else "—",
        "phone_masked":     mask_phone(m["phone"]) if m.get("phone") else None,
        "bank_card_masked": mask_bank_card(m["bank_card"]) if m.get("bank_card") else None,
        "bank_name":        m.get("bank_name"),
        "is_head":          m.get("is_head") or 0,
        "relation":         m.get("relation"),
        "farmer_status":    m.get("farmer_status") or 1,
        "village_full_name":m.get("village_full_name") or "—",
        "land_area":        m.get("land_area"),
        "address":          m.get("address"),
        "remark":           m.get("remark"),
        "created_at":       str(m["created_at"]) if m.get("created_at") else None,
        "birth_date":       str(m["birth_date"])  if m.get("birth_date")  else None,
        "household_code":   m.get("household_code"),
        "village_name":     m.get("village_name"),
        "group_no":         m.get("group_no"),
    }

def _to_detail(r) -> dict:
    d = _to_list(r)
    m = dict(r._mapping)
    d.update({"id_card": m.get("id_card"), "phone": m.get("phone"), "bank_card": m.get("bank_card")})
    return d

# ── 列表 ──
@router.get("")
def list_farmers(
    search:       Optional[str]  = Query(None),
    village_name: Optional[str]  = Query(None),
    status:       Optional[int]  = Query(None),
    incomplete:   Optional[bool] = Query(None, description="True=只看信息不完善的农户"),
    page:         int = Query(1, ge=1),
    page_size:    int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    where, params = [], {}
    if search:
        where.append("(fp.real_name LIKE :s OR fp.id_card LIKE :s)")
        params["s"] = f"%{search}%"
    if status is not None:
        where.append("fp.farmer_status = :st"); params["st"] = status
    if village_name:
        where.append("vg.village_name = :vn");  params["vn"] = village_name
    if incomplete:
        # 信息不完善：手机、银行卡、土地面积缺任意一项
        where.append("(fp.phone IS NULL OR fp.bank_card IS NULL OR hh.land_area IS NULL OR hh.land_area=0)")

    w = ("WHERE " + " AND ".join(where)) if where else ""
    total = db.execute(text(
        f"SELECT COUNT(*) FROM farmer_profile fp "
        f"LEFT JOIN family_household hh ON fp.household_id=hh.id "
        f"LEFT JOIN village_group vg ON hh.village_group_id=vg.id {w}"
    ), params).scalar() or 0

    params["lim"] = page_size
    params["off"] = (page - 1) * page_size
    rows = db.execute(text(
        f"SELECT {_COLS} {w} ORDER BY fp.id DESC LIMIT :lim OFFSET :off"
    ), params).fetchall()

    return {"total": total, "page": page, "page_size": page_size,
            "items": [_to_list(r) for r in rows]}

# ── 详情 ──
@router.get("/{farmer_id}")
def get_farmer(farmer_id: int, db: Session = Depends(get_db)):
    row = db.execute(text(f"SELECT {_COLS} WHERE fp.id = :id"), {"id": farmer_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="农户不存在")
    detail = _to_detail(row)
    hh_id = dict(row._mapping).get("household_id")

    # 补贴记录
    apps = db.execute(text("""
        SELECT sa.id, sa.apply_year, sa.apply_amount, sa.actual_amount,
               sa.apply_area, sa.pay_status, sa.pay_date, sa.remark,
               st.subsidy_name, st.calc_mode
        FROM subsidy_application sa
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        WHERE sa.farmer_id = :fid
        ORDER BY sa.apply_year DESC, sa.id DESC
    """), {"fid": farmer_id}).fetchall()
    detail["applications"] = [dict(a._mapping) for a in apps]

    # 同户成员
    if hh_id:
        mems = db.execute(text("""
            SELECT id, real_name, gender, is_head, relation, farmer_status,
                   birth_date,
                   SUBSTR(id_card,1,6)||'********'||SUBSTR(id_card,-4) AS id_card_masked
            FROM farmer_profile
            WHERE household_id = :hid AND id != :fid
            ORDER BY is_head DESC, id
        """), {"hid": hh_id, "fid": farmer_id}).fetchall()
        detail["household_members"] = [dict(m._mapping) for m in mems]
    else:
        detail["household_members"] = []

    return detail

# ── 新增 ──
@router.post("/")
def create_farmer(data: FarmerCreate, db: Session = Depends(get_db)):
    if db.execute(text("SELECT id FROM farmer_profile WHERE id_card=:ic"), {"ic": data.id_card}).fetchone():
        raise HTTPException(status_code=400, detail="该身份证号已存在")
    parsed = parse_id_card(data.id_card) or {}
    farmer = FarmerProfile(
        household_id=0, real_name=data.real_name,
        gender=parsed.get("gender") or data.gender,
        id_card=data.id_card, birth_date=parsed.get("birth_date"),
        phone=data.phone, bank_card=data.bank_card, bank_name=data.bank_name,
        is_head=1, relation="本人", farmer_status=data.farmer_status, remark=data.remark,
    )
    db.add(farmer); db.flush()
    hh = FamilyHousehold(
        household_code=gen_household_code(farmer.id),
        household_name=f"{data.real_name}户", head_farmer_id=farmer.id,
        village_group_id=data.village_group_id, address=data.address,
        land_area=data.land_area, status=data.farmer_status, member_count=1,
    )
    db.add(hh); db.flush()
    farmer.household_id = hh.id; db.commit()
    return {"id": farmer.id, "household_id": hh.id, "message": "创建成功"}

# ── 修改 ──
@router.put("/{farmer_id}")
def update_farmer(farmer_id: int, data: FarmerUpdate, db: Session = Depends(get_db)):
    farmer = db.get(FarmerProfile, farmer_id)
    if not farmer: raise HTTPException(status_code=404, detail="农户不存在")
    upd = data.model_dump(exclude_unset=True)
    hh_fields = {k: upd.pop(k) for k in ("village_group_id","address","land_area") if k in upd}
    for k, v in upd.items(): setattr(farmer, k, v)
    if hh_fields:
        hh = db.get(FamilyHousehold, farmer.household_id)
        if hh:
            for k, v in hh_fields.items(): setattr(hh, k, v)
    db.commit(); return {"message": "更新成功"}

# ── 批量导入 ──
@router.post("/batch-import")
def batch_import_farmers(payload: dict, db: Session = Depends(get_db)):
    rows = payload.get("rows", [])
    created, skipped, errors = 0, 0, []

    for row in rows:
        try:
            ic = str(row.get("id_card", "")).strip()
            if not ic: errors.append(f"{row.get('real_name','?')}: 缺少身份证号"); continue
            if db.execute(text("SELECT id FROM farmer_profile WHERE id_card=:ic"), {"ic": ic}).fetchone():
                skipped += 1; continue

            vg_id = row.get("village_group_id")
            if not vg_id:
                vn = str(row.get("village_name", "")).strip()
                gn = str(row.get("group_no",   "")).strip()
                if not vn or not gn: errors.append(f"{row.get('real_name','?')}: 缺少村组"); continue
                vg, vg_err = resolve_village_group(db, vn, gn)
                if vg_err: errors.append(f"{row.get('real_name','?')}: {vg_err}"); continue
                vg_id = vg.id

            parsed = parse_id_card(ic) or {}
            farmer = FarmerProfile(
                household_id=0, real_name=row.get("real_name"), gender=parsed.get("gender") or row.get("gender", 1),
                id_card=ic, birth_date=parsed.get("birth_date"), phone=row.get("phone"),
                bank_card=row.get("bank_card"), bank_name=row.get("bank_name"),
                is_head=1, relation="本人", farmer_status=row.get("farmer_status", 1),
            )
            db.add(farmer); db.flush()
            hh = FamilyHousehold(
                household_code=gen_household_code(farmer.id),
                household_name=f"{row.get('real_name','未知')}户", head_farmer_id=farmer.id,
                village_group_id=vg_id, address=row.get("address"),
                land_area=row.get("land_area"), status=row.get("farmer_status", 1), member_count=1,
            )
            db.add(hh); db.flush()
            farmer.household_id = hh.id; created += 1
        except Exception as e:
            try: db.rollback()
            except: pass
            errors.append(f"{row.get('real_name','?')}: {e}")
    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}

# ── 注销 ──
@router.delete("/{farmer_id}")
def deactivate_farmer(farmer_id: int, status: int = Query(2), db: Session = Depends(get_db)):
    farmer = db.get(FarmerProfile, farmer_id)
    if not farmer: raise HTTPException(status_code=404, detail="农户不存在")
    farmer.farmer_status = status
    hh = db.get(FamilyHousehold, farmer.household_id)
    if hh: hh.status = status
    db.commit(); return {"message": "状态已更新"}


# ── 批量补全农户信息 ──
@router.post("/bulk-complete")
def bulk_complete_farmers(payload: dict, db: Session = Depends(get_db)):
    """批量更新农户基础信息（用于补全不完善字段）"""
    rows = payload.get("rows", [])
    updated, errors = 0, []
    for row in rows:
        fid = row.get("id")
        ic  = str(row.get("id_card", "")).strip()
        # 支持按 id 或按身份证号定位
        if fid:
            fp = db.get(FarmerProfile, fid)
        elif ic:
            fp = db.query(FarmerProfile).filter(FarmerProfile.id_card == ic).first()
        else:
            errors.append(f"缺少id或身份证号"); continue
        if not fp:
            errors.append(f"{row.get('real_name','?')}：农户不存在"); continue
        try:
            if row.get("phone"):      fp.phone     = str(row["phone"]).strip()
            if row.get("bank_card"):  fp.bank_card = str(row["bank_card"]).strip()
            if row.get("bank_name"):  fp.bank_name = str(row["bank_name"]).strip()
            if row.get("land_area") and fp.household:
                fp.household.land_area = float(row["land_area"])
            if row.get("address") and fp.household:
                fp.household.address = str(row["address"]).strip()
            updated += 1
        except Exception as e:
            errors.append(f"{fp.real_name}：{e}")
    db.commit()
    return {"updated": updated, "errors": errors}


# ── 批量按身份证号查找农户 ──
@router.post("/batch-lookup")
def batch_lookup_farmers(payload: dict, db: Session = Depends(get_db)):
    """接收身份证号列表，返回 id_card → farmer_id 映射"""
    id_cards = payload.get("id_cards", [])
    if not id_cards:
        return {"results": {}}
    # 去重 + 清洗
    clean = list({str(ic).strip() for ic in id_cards if str(ic).strip()})
    rows = db.query(FarmerProfile.id, FarmerProfile.id_card)\
             .filter(FarmerProfile.id_card.in_(clean)).all()
    return {"results": {r.id_card: r.id for r in rows}}


@router.post("/batch-get-id-cards")
def batch_get_id_cards(payload: dict, db: Session = Depends(get_db)):
    """接收 farmer_id 列表，返回 farmer_id → id_card 映射"""
    farmer_ids = payload.get("farmer_ids", [])
    if not farmer_ids:
        return {"results": {}}
    clean = list({int(fid) for fid in farmer_ids if str(fid).strip().isdigit()})
    rows = db.query(FarmerProfile.id, FarmerProfile.id_card)\
             .filter(FarmerProfile.id.in_(clean)).all()
    return {"results": {str(r.id): r.id_card for r in rows}}
