from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from database import get_db
from models import FarmerProfile, FamilyHousehold, Village
from schemas import FarmerCreate, FarmerUpdate
from utils import mask_id_card, mask_phone, mask_bank_card, parse_id_card, gen_household_code, parse_group_no_to_int, format_group_no

router = APIRouter(prefix="/api/farmers", tags=["农户管理"])

# ══════════════════════════════════════
# 核心改动：全部用原生 SQL + LEFT JOIN，
# 完全绕开 ORM relationship lazy load，
# 无论 household 关联是否完整都能正常返回数据
# ══════════════════════════════════════

_COLS = """
    fp.id, fp.household_id, fp.real_name, fp.gender, fp.id_card,
    fp.phone, fp.bank_card, fp.bank_name, fp.relation,
    fp.farmer_status, fp.remark, fp.created_at,
    hh.contract_area, hh.address, hh.household_code, hh.head_farmer_id,
    fp.own_village_id, fp.own_group_no,
    COALESCE(fv.village_name, v.village_name, '未知村') || format_group_no(COALESCE(fp.own_group_no, hh.group_no, 1)) AS village_full_name,
    COALESCE(fv.village_name, v.village_name) AS village_name,
    COALESCE(fp.own_group_no, hh.group_no) AS group_no
FROM farmer_profile fp
LEFT JOIN family_household hh ON fp.household_id = hh.id
LEFT JOIN village v ON hh.village_id = v.id
LEFT JOIN village fv ON fp.own_village_id = fv.id
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
        "is_head":          1 if m.get("head_farmer_id") and m.get("id") == m.get("head_farmer_id") else 0,
        "relation":         m.get("relation"),
        "farmer_status":    m.get("farmer_status") or 1,
        "village_full_name":m.get("village_full_name") or "—",
        "contract_area":    m.get("contract_area"),
        "address":          m.get("address"),
        "remark":           m.get("remark"),
        "created_at":       str(m["created_at"]) if m.get("created_at") else None,
        "household_code":   m.get("household_code"),
        "village_name":     m.get("village_name"),
        "group_no":         m.get("group_no"),
        "own_village_id":   m.get("own_village_id"),
        "own_group_no":     m.get("own_group_no"),
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
        where.append("v.village_name = :vn");  params["vn"] = village_name
    if incomplete:
        # 信息不完善：手机、银行卡、土地面积缺任意一项
        where.append("(fp.phone IS NULL OR fp.bank_card IS NULL OR hh.contract_area IS NULL OR hh.contract_area=0)")

    w = ("WHERE " + " AND ".join(where)) if where else ""
    total = db.execute(text(
        f"SELECT COUNT(*) FROM farmer_profile fp "
        f"LEFT JOIN family_household hh ON fp.household_id=hh.id "
        f"LEFT JOIN village v ON hh.village_id=v.id {w}"
    ), params).scalar() or 0

    params["lim"] = page_size
    params["off"] = (page - 1) * page_size
    rows = db.execute(text(
        f"SELECT {_COLS} {w} ORDER BY fp.id DESC LIMIT :lim OFFSET :off"
    ), params).fetchall()

    return {"total": total, "page": page, "page_size": page_size,
            "items": [_to_list(r) for r in rows]}

# ── 多户主家庭查询（预览需结合Excel数据）────
def list_multi_head_households(
    village_names: str = Query(None, description="村庄名，逗号分隔"),
    db: Session = Depends(get_db)
):
    """
    查询指定村庄中有多户主的家庭（供前端确认哪些需要拆分）
    village_names: 如 "村1,村2"

    注意：此API仅返回数据库中有多户主的家庭。
    前端预览时应使用 /households-with-multi-head-preview 接口，
    该接口会结合Excel数据判断是否真正需要拆分。
    """
    if village_names:
        names = [n.strip() for n in village_names.split(",") if n.strip()]
    else:
        names = []

    village_ids = [v.id for v in db.query(Village).filter(Village.village_name.in_(names)).all()] if names else []

    if not village_ids:
        return {"households": []}

    households = db.query(FamilyHousehold).filter(FamilyHousehold.village_id.in_(village_ids)).all()
    hh_ids = [h.id for h in households]

    members = db.query(FarmerProfile).filter(FarmerProfile.household_id.in_(hh_ids)).all()

    hh_members: dict[int, list] = {}
    for m in members:
        if m.household_id not in hh_members:
            hh_members[m.household_id] = []
        hh_members[m.household_id].append({
            "id": m.id,
            "real_name": m.real_name,
            "relation": m.relation,
            "id_card_masked": mask_id_card(m.id_card) if m.id_card else None,
        })

    result = []
    for hh in households:
        members_list = hh_members.get(hh.id, [])
        heads = [m for m in members_list if m.get("relation") == "head"]
        if len(heads) > 1:
            result.append({
                "household_id": hh.id,
                "household_name": hh.household_name,
                "village_name": hh.village.village_name if hh.village else "",
                "head_count": len(heads),
                "heads": heads,
                "all_members": members_list,
            })

    return {"households": result}

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
            SELECT fp.id, fp.real_name, fp.gender, fp.relation, fp.farmer_status,
                   SUBSTR(fp.id_card,1,6)||'********'||SUBSTR(fp.id_card,-4) AS id_card_masked,
                   CASE WHEN hh.head_farmer_id = fp.id THEN 1 ELSE 0 END AS is_head
            FROM farmer_profile fp
            LEFT JOIN family_household hh ON fp.household_id = hh.id
            WHERE fp.household_id = :hid AND fp.id != :fid
            ORDER BY is_head DESC, fp.id
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

    # 解析 village_id：优先用传入的整数，否则按 village_name 查 Village 表
    village_id = data.village_id
    if not village_id and data.village_name:
        v = db.query(Village).filter(Village.village_name == data.village_name).first()
        if not v:
            v = Village(village_name=data.village_name)
            db.add(v); db.flush()
        village_id = v.id
    if not village_id:
        raise HTTPException(status_code=400, detail="缺少 village_id 或 village_name")

    # 解析 group_no
    group_no = data.group_no
    if not group_no and data.group_no_str:
        group_no = parse_group_no_to_int(data.group_no_str)
    if not group_no:
        raise HTTPException(status_code=400, detail="缺少 group_no")

    parsed = parse_id_card(data.id_card) or {}
    farmer = FarmerProfile(
        household_id=0, real_name=data.real_name,
        gender=parsed.get("gender") or data.gender,
        id_card=data.id_card,
        phone=data.phone, bank_card=data.bank_card, bank_name=data.bank_name,
        relation="本人", farmer_status=data.farmer_status, remark=data.remark,
    )
    db.add(farmer); db.flush()
    hh = FamilyHousehold(
        household_code=gen_household_code(farmer.id),
        household_name=f"{data.real_name}户", head_farmer_id=farmer.id,
        village_id=village_id, group_no=group_no, address=data.address,
        contract_area=data.contract_area, status=data.farmer_status,
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

    hh = db.get(FamilyHousehold, farmer.household_id)

    # village_id / group_no 写入农户个人字段（出嫁/迁居等），不修改家庭户
    new_village_id = upd.pop("village_id", None)
    new_group_no = upd.pop("group_no", None)

    hh_fields = {k: upd.pop(k) for k in ("address","contract_area") if k in upd}
    for k, v in upd.items():
        setattr(farmer, k, v)
    if hh_fields and hh:
        for k, v in hh_fields.items(): setattr(hh, k, v)
    if new_village_id is not None:
        farmer.own_village_id = new_village_id if new_village_id != 0 else None
    if new_group_no is not None:
        farmer.own_group_no = new_group_no if new_group_no != 0 else None

    # 如果设农户为"死亡"（4）且该农户是户主，自动转移户主或标记消亡
    old_status = farmer.farmer_status
    if data.farmer_status == 4 and old_status != 4 and hh and hh.head_farmer_id == farmer.id:
        successor = db.query(FarmerProfile).filter(
            FarmerProfile.household_id == farmer.household_id,
            FarmerProfile.id != farmer_id,
            FarmerProfile.farmer_status == 1
        ).first()
        if successor:
            hh.head_farmer_id = successor.id
        else:
            hh.status = 3  # 没有在册成员了，标记为消亡户

    db.commit(); return {"message": "更新成功"}

# ── 批量导入 ──
@router.post("/batch-import")
def batch_import_farmers(payload: dict, db: Session = Depends(get_db)):
    rows = payload.get("rows", [])
    overwrite = payload.get("overwrite", False)
    created, updated, skipped, errors = 0, 0, 0, []

    for row in rows:
        try:
            ic = str(row.get("id_card", "")).strip()
            if not ic: errors.append(f"{row.get('real_name','?')}: 缺少身份证号"); continue

            # 查找已存在的农户
            existing = db.execute(text("SELECT id FROM farmer_profile WHERE id_card=:ic"), {"ic": ic}).fetchone()
            if existing:
                if not overwrite:
                    skipped += 1; continue
                # 覆盖模式：更新现有农户信息
                fp = db.get(FarmerProfile, existing.id)
                if not fp:
                    skipped += 1; continue
                try:
                    if row.get("real_name"): fp.real_name = str(row["real_name"]).strip()
                    if row.get("phone"): fp.phone = str(row["phone"]).strip() or None
                    if row.get("bank_card"): fp.bank_card = str(row["bank_card"]).strip() or None
                    if row.get("bank_name"): fp.bank_name = str(row["bank_name"]).strip() or None
                    if "gender" in row: fp.gender = int(row["gender"])
                    if "farmer_status" in row: fp.farmer_status = int(row["farmer_status"])
                    if row.get("remark") is not None: fp.remark = str(row["remark"]).strip() or None
                    # 更新家庭户信息
                    hh_upd = db.get(FamilyHousehold, fp.household_id) if fp.household_id else None
                    if hh_upd:
                        if row.get("contract_area") is not None: hh_upd.contract_area = float(row["contract_area"])
                        if row.get("address"): hh_upd.address = str(row["address"]).strip()
                        if "farmer_status" in row: hh_upd.status = int(row["farmer_status"])
                    updated += 1
                except Exception as e:
                    errors.append(f"{fp.real_name}：更新失败 {e}")
                continue

            # 支持 village_id（整数）或 village_name（字符串）
            vid = row.get("village_id")
            vn_raw = row.get("village_name")
            gn_raw = row.get("group_no")
            if not vid and not vn_raw:
                errors.append(f"{row.get('real_name','?')}: 缺少 village_id 或 village_name"); continue
            if gn_raw is None:
                errors.append(f"{row.get('real_name','?')}: 缺少 group_no"); continue

            # 解析 village_id：优先用传入的整数，否则按 village_name 查 Village 表
            if vid:
                village_id = int(vid)
            else:
                village_name_str = str(vn_raw).strip()
                v = db.query(Village).filter(Village.village_name == village_name_str).first()
                if not v:
                    v = Village(village_name=village_name_str)
                    db.add(v); db.flush()
                village_id = v.id

            gno = parse_group_no_to_int(gn_raw)

            parsed = parse_id_card(ic) or {}
            farmer = FarmerProfile(
                household_id=0, real_name=row.get("real_name"), gender=parsed.get("gender") or row.get("gender", 1),
                id_card=ic, phone=row.get("phone"),
                bank_card=row.get("bank_card"), bank_name=row.get("bank_name"),
                relation="本人", farmer_status=row.get("farmer_status", 1),
            )
            db.add(farmer); db.flush()
            hh = FamilyHousehold(
                household_code=gen_household_code(farmer.id),
                household_name=f"{row.get('real_name','未知')}户", head_farmer_id=farmer.id,
                village_id=village_id, group_no=gno, address=row.get("address"),
                contract_area=row.get("contract_area"), status=row.get("farmer_status", 1),
            )
            db.add(hh); db.flush()
            farmer.household_id = hh.id; created += 1
        except Exception as e:
            try: db.rollback()
            except: pass
            errors.append(f"{row.get('real_name','?')}: {e}")
    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors}

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
            hh_upd = db.get(FamilyHousehold, fp.household_id) if fp.household_id else None
            if row.get("contract_area") and hh_upd:
                hh_upd.contract_area = float(row["contract_area"])
            if row.get("address") and hh_upd:
                hh_upd.address = str(row["address"]).strip()
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


# ════════════════════════════════════════════════════════════════
#  家庭关系导入 & 多户主拆分
# ════════════════════════════════════════════════════════════════

from pydantic import BaseModel
from datetime import date


class FamilyRelationRow(BaseModel):
    """Excel 中的一行家庭关系数据"""
    row_index: int                     # Excel行号
    real_name: Optional[str] = None    # 姓名
    id_card: Optional[str] = None      # 身份证号
    relation: Optional[str] = None     # 与户主关系
    age: Optional[int] = None         # 年龄
    address: Optional[str] = None      # 地址


class ImportFamilyRelationsRequest(BaseModel):
    """批量导入家庭关系请求"""
    rows: list[FamilyRelationRow]
    # 可选：仅对这些村庄执行多户主拆分（为空则不拆分）
    split_villages: Optional[list[str]] = None


class MultiHeadPreviewRequest(BaseModel):
    """预览多户主拆分请求"""
    village_names: list[str]
    excel_rows: list[FamilyRelationRow]  # Excel数据，用于判断哪些人在Excel中被标记为户主


@router.post("/households-with-multi-head-preview")
def preview_multi_head_households(
    req: MultiHeadPreviewRequest,
    db: Session = Depends(get_db)
):
    """
    预览多户主拆分（结合Excel数据判断）

    只有当Excel数据中同一家庭户有2个及以上被标记为"户主"时，才会被列入拆分预览。
    """
    village_names = req.village_names
    excel_rows = req.excel_rows

    # 1. 获取指定村庄的数据库家庭户
    village_ids = [v.id for v in db.query(Village).filter(Village.village_name.in_(village_names)).all()] if village_names else []
    if not village_ids:
        return {"households": []}

    households = db.query(FamilyHousehold).filter(FamilyHousehold.village_id.in_(village_ids)).all()
    hh_ids = [h.id for h in households]

    # 2. 获取所有成员
    members = db.query(FarmerProfile).filter(FarmerProfile.household_id.in_(hh_ids)).all()
    hh_members: dict[int, list] = {}
    for m in members:
        if m.household_id not in hh_members:
            hh_members[m.household_id] = []
        hh_members[m.household_id].append({
            "id": m.id,
            "real_name": m.real_name,
            "relation": m.relation,
            "id_card": m.id_card,
            "id_card_masked": mask_id_card(m.id_card) if m.id_card else None,
        })

    # 3. 构建身份证号 → household_id 映射（仅针对Excel中的数据）
    id_card_to_hh_id: dict[str, int] = {}
    for m in members:
        if m.id_card:
            id_card_to_hh_id[m.id_card.upper()] = m.household_id

    # 4. 统计每个家庭户在Excel中被标记为"户主"的人数
    excel_head_count_per_hh: dict[int, list] = {}  # household_id -> [{id, real_name, id_card}]
    for row in excel_rows:
        if not row.id_card:
            continue
        id_card_upper = row.id_card.strip().upper()
        hh_id = id_card_to_hh_id.get(id_card_upper)
        if hh_id is None:
            continue  # Excel中的身份证号不在数据库中

        # 检查Excel中这行是否是"户主"
        if row.relation and row.relation.strip() in ("户主", "head"):
            if hh_id not in excel_head_count_per_hh:
                excel_head_count_per_hh[hh_id] = []
            # 找到该成员的详细信息
            member_info = next((m for m in hh_members.get(hh_id, []) if m["id_card"] and m["id_card"].upper() == id_card_upper), None)
            if member_info:
                excel_head_count_per_hh[hh_id].append(member_info)

    # 5. 返回Excel中有2个及以上户主的家庭
    result = []
    for hh in households:
        excel_heads = excel_head_count_per_hh.get(hh.id, [])
        if len(excel_heads) < 2:
            continue  # Excel中不是多户主，跳过

        members_list = hh_members.get(hh.id, [])
        result.append({
            "household_id": hh.id,
            "household_name": hh.household_name,
            "village_name": hh.village.village_name if hh.village else "",
            "head_count": len(excel_heads),
            "heads": excel_heads,
            "all_members": members_list,
        })

    return {"households": result}


# 关系映射：Excel值 → farmer_profile.relation 值
RELATION_MAP = {
    "户主": "head",
    "妻子": "spouse",
    "夫": "spouse",
    "父亲": "parent",
    "母亲": "parent",
    "长子": "child",
    "次子": "child",
    "三子": "child",
    "四子": "child",
    "子": "child",
    "长女": "child",
    "次女": "child",
    "三女": "child",
    "女": "child",
    "儿媳": "child",
    "女婿": "child",
    "孙子": "grandchild",
    "孙女": "grandchild",
    "外孙子": "grandchild",
    "外孙女": "grandchild",
    "孙": "grandchild",
    "外孙": "grandchild",
}


def _parse_birth_year(id_card: str) -> Optional[int]:
    """从身份证号提取出生年份"""
    if not id_card or len(id_card) < 14:
        return None
    try:
        return int(id_card[6:10])
    except:
        return None


def _get_age_from_id_card(id_card: str, ref_year: int = 2026) -> Optional[int]:
    """从身份证号估算年龄"""
    birth_year = _parse_birth_year(id_card)
    if birth_year:
        return ref_year - birth_year
    return None



@router.post("/import-relations")
def import_family_relations(req: ImportFamilyRelationsRequest, db: Session = Depends(get_db)):
    """
    阶段一：导入家庭关系
    - 根据身份证号匹配农户，更新 relation 字段
    - 如果指定了 split_villages，执行阶段二：多户主家庭拆分
    """
    updated = 0
    not_found = []
    relation_errors = []

    # 构建身份证号 → farmer 映射
    id_cards = [r.id_card for r in req.rows if r.id_card]
    id_card_to_farmer: dict[str, FarmerProfile] = {}
    if id_cards:
        farmers = db.query(FarmerProfile).filter(FarmerProfile.id_card.in_(id_cards)).all()
        id_card_to_farmer = {f.id_card: f for f in farmers}

    # 阶段一：更新关系字段
    for row in req.rows:
        if not row.id_card:
            relation_errors.append(f"行{row.row_index}：缺少身份证号")
            continue
        farmer = id_card_to_farmer.get(row.id_card)
        if not farmer:
            not_found.append(f"{row.real_name or '未知'}({row.id_card[:6]}***): 未找到")
            continue

        # 映射关系
        raw_relation = row.relation
        if raw_relation:
            mapped = RELATION_MAP.get(raw_relation.strip())
            if mapped:
                farmer.relation = mapped
            else:
                # 尝试直接保存原始值
                farmer.relation = raw_relation.strip()
        else:
            farmer.relation = None

        # 临时存储年龄（用于后续拆分）
        if row.age:
            farmer._relation_age = row.age

        updated += 1

    db.commit()

    result = {
        "stage1_updated": updated,
        "stage1_not_found": not_found,
        "stage1_relation_errors": relation_errors,
    }

    # 阶段二：多户主拆分
    if req.split_villages and req.split_villages:
        split_result = _split_multi_head_households(db, req.split_villages)
        result["stage2_split"] = split_result

    return result


def _split_multi_head_households(db: Session, village_names: list[str]) -> dict:
    """
    阶段二：拆分指定村庄的多户主家庭

    规则：
    1. 同一家庭中多个"户主" → 拆分成多个家庭
    2. 年龄最大的户主留在原家庭，其他户主分出去
    3. 次要户主的直系亲属（配偶、子女）跟随该户主迁移
    4. 其他人（父母、祖父母）留在原家庭

    简化假设：在多户主家庭中，配偶和子女跟随他们所属的户主
    """
    # 查询指定村庄的所有家庭户
    village_ids = [v.id for v in db.query(Village).filter(Village.village_name.in_(village_names)).all()]
    if not village_ids:
        return {"skipped": "未找到指定的村庄", "details": []}

    households = db.query(FamilyHousehold).filter(FamilyHousehold.village_id.in_(village_ids)).all()
    hh_ids = [h.id for h in households]

    # 查询所有成员
    members = db.query(FarmerProfile).filter(FarmerProfile.household_id.in_(hh_ids)).all()

    # 按家庭户分组
    hh_members: dict[int, list[FarmerProfile]] = {}
    for m in members:
        if m.household_id not in hh_members:
            hh_members[m.household_id] = []
        hh_members[m.household_id].append(m)

    split_details = []
    split_count = 0
    created_households = 0
    migrated_members = 0

    for hh in households:
        members_list = hh_members.get(hh.id, [])

        # 找出所有户主
        heads = [m for m in members_list if m.relation == "head"]
        if len(heads) <= 1:
            continue

        # 按年龄排序，选择最年长的为主要户主
        def get_farmer_age(f: FarmerProfile) -> int:
            age = getattr(f, '_relation_age', None)
            if age:
                return age
            return _get_age_from_id_card(f.id_card) or 0

        heads_sorted = sorted(heads, key=get_farmer_age, reverse=True)
        main_head = heads_sorted[0]
        other_heads = heads_sorted[1:]

        # 为每个次要户主创建新家庭
        for other_head in other_heads:
            # 创建新家庭户
            new_hh = FamilyHousehold(
                household_code=hh.household_code + f"_S{created_households + 1}",
                household_name=hh.household_name,
                village_id=hh.village_id,
                group_no=hh.group_no,
                address=hh.address,
                contract_area=hh.contract_area,
                confirmed_area=hh.confirmed_area,
                status=hh.status,
            )
            db.add(new_hh)
            db.flush()

            # 移动该户主到新家庭
            other_head.household_id = new_hh.id
            other_head.relation = "head"
            new_hh.head_farmer_id = other_head.id
            migrated_count = 1

            # 移动该户主的直系亲属（配偶、子女）
            for m in members_list:
                if m.id == other_head.id:
                    continue
                # 配偶和子女跟随户主迁移
                if m.relation in ("spouse", "child"):
                    m.household_id = new_hh.id
                    migrated_count += 1

            migrated_members += migrated_count
            created_households += 1
            split_details.append({
                "原家庭": f"{hh.household_name}(ID:{hh.id})",
                "新家庭": f"{hh.household_name}_分户(ID:{new_hh.id})",
                "新户主": other_head.real_name,
                "迁移人数": migrated_count,
            })

        split_count += 1

    db.commit()
    return {
        "split_count": split_count,
        "created_households": created_households,
        "migrated_members": migrated_members,
        "details": split_details,
    }
