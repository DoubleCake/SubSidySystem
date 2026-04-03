"""
家庭户批量导入路由
功能：
  1. 接收前端上传的 Excel 解析行（姓名、身份证号、家庭住址、户主关系）
  2. 按家庭住址聚合分组，同一地址 → 同一家庭户
  3. 用身份证号在数据库中比对已有家庭户 / 个人信息：
     - 匹配 0 个家庭户 → 新建
     - 匹配 1 个家庭户 → 并入该家庭户（更新户主、补充成员）
     - 匹配 N 个家庭户 → 合并（保留户主所在户或最大户，其余注销，面积求和）
  4. 村组信息来源：优先使用匹配到的原 DB 记录，无则写入"待分配"占位村
  5. 所有历史变更写入 HouseholdEvent
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from database import get_db
from models import FamilyHousehold, FarmerProfile, Village, HouseholdEvent
from utils import format_group_no, gen_household_code, parse_gender_from_id, validate_id_card

router = APIRouter(prefix="/api/household-import", tags=["家庭户批量导入"])

# ──────────────────────────────────────────────────────────
#  请求 Schema
# ──────────────────────────────────────────────────────────

class ImportRow(BaseModel):
    real_name: str
    id_card: str
    address: str                        # 家庭住址（分组依据）
    head_relation: Optional[str] = None # 户主关系，含"户主"→ 是户主
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    gender: Optional[str] = None        # "男"/"女"，空则从身份证推断


class ImportRequest(BaseModel):
    rows: List[ImportRow]


# ──────────────────────────────────────────────────────────
#  内部工具
# ──────────────────────────────────────────────────────────

def _normalize_address(addr: str) -> str:
    """标准化地址：去首尾空格，全角→半角空格"""
    return addr.strip().replace("\u3000", " ").replace("  ", " ")


def _parse_gender(id_card: str, gender_str: Optional[str]) -> int:
    if gender_str:
        return 1 if str(gender_str).strip() in ("男", "1", "male") else 2
    g = parse_gender_from_id(id_card)
    return g if g else 1


def _get_or_create_pending_village(db: Session) -> Village:
    """获取或创建'待分配'占位村"""
    v = db.query(Village).filter(Village.village_name == "待分配").first()
    if not v:
        v = Village(village_name="待分配")
        db.add(v)
        db.flush()
    return v


def _hh_info(hh: FamilyHousehold, village_name: str) -> dict:
    return {
        "id": hh.id,
        "household_code": hh.household_code,
        "household_name": hh.household_name,
        "village_name": village_name,
        "group_display": format_group_no(hh.group_no) if hh.group_no else "",
        "contract_area": float(hh.contract_area) if hh.contract_area else None,
    }


# ──────────────────────────────────────────────────────────
#  核心：解析 + 匹配逻辑（preview & execute 共用）
# ──────────────────────────────────────────────────────────

def _analyze_groups(rows: List[ImportRow], db: Session) -> List[dict]:
    """
    解析所有行，按地址分组，对每组做 DB 匹配分析。
    返回结构化的 group 列表，供预览和执行使用。
    """
    # ── 预加载数据库数据 ──
    all_farmers: dict[str, FarmerProfile] = {
        f.id_card: f for f in db.query(FarmerProfile).all()
    }
    all_households: dict[int, FamilyHousehold] = {
        hh.id: hh for hh in db.query(FamilyHousehold).filter(FamilyHousehold.status == 1).all()
    }
    village_name_map: dict[int, str] = {
        v.id: v.village_name for v in db.query(Village).all()
    }

    # ── 逐行解析 ──
    parsed = []
    row_errors = []
    for idx, row in enumerate(rows):
        name = (row.real_name or "").strip()
        id_card = (row.id_card or "").strip().upper()
        address = _normalize_address(row.address or "")
        relation = (row.head_relation or "").strip()

        errs = []
        if not name:
            errs.append("姓名为空")
        if not id_card:
            errs.append("身份证号为空")
        else:
            ok, err_msg = validate_id_card(id_card)
            if not ok:
                errs.append(f"身份证格式错误: {err_msg}")
        if not address:
            errs.append("家庭住址为空")

        if errs:
            row_errors.append({"row": idx + 1, "name": name, "errors": errs})

        parsed.append({
            "real_name": name,
            "id_card": id_card,
            "address": address,
            "head_relation": relation,
            "is_head": "户主" in relation,
            "phone": row.phone,
            "bank_card": row.bank_card,
            "bank_name": row.bank_name,
            "gender": _parse_gender(id_card, row.gender),
            "has_errors": bool(errs),
        })

    # ── 按地址分组 ──
    groups_map: dict[str, list] = {}
    for p in parsed:
        if p["address"]:
            groups_map.setdefault(p["address"], []).append(p)

    groups = []
    for address, members in groups_map.items():
        # 找户主
        heads = [m for m in members if m["is_head"]]
        warnings = []
        if len(heads) == 0:
            warnings.append("未找到户主标记，将以第一个成员作为户主")
            head = members[0]
        elif len(heads) > 1:
            warnings.append(f"存在 {len(heads)} 个户主标记，将以第一个作为户主")
            head = heads[0]
        else:
            head = heads[0]

        # 用所有成员的身份证号在 DB 中查找已有家庭户
        matched_hh_ids: set[int] = set()
        member_db_info: list[dict] = []
        for m in members:
            existing_farmer = all_farmers.get(m["id_card"])
            if existing_farmer:
                matched_hh_ids.add(existing_farmer.household_id)
                hh = all_households.get(existing_farmer.household_id)
                member_db_info.append({
                    "id_card": m["id_card"],
                    "farmer_id": existing_farmer.id,
                    "household_id": existing_farmer.household_id,
                    "village_id": hh.village_id if hh else None,
                    "group_no": hh.group_no if hh else None,
                })

        # 确定村组信息：优先用户主已有家庭户，否则用任意匹配户
        target_village_id = None
        target_group_no = 1
        head_existing = all_farmers.get(head["id_card"])
        if head_existing:
            hh = all_households.get(head_existing.household_id)
            if hh:
                target_village_id = hh.village_id
                target_group_no = hh.group_no
        elif member_db_info:
            first = member_db_info[0]
            target_village_id = first["village_id"]
            target_group_no = first["group_no"] or 1

        # 合并场景判断
        matched_hh_ids_list = list(matched_hh_ids)
        if len(matched_hh_ids) == 0:
            action = "create"
        elif len(matched_hh_ids) == 1:
            action = "merge_one"
        else:
            action = "merge_multi"
            warnings.append(f"涉及 {len(matched_hh_ids)} 个已有家庭户，将执行合并")

        # 计算合并后面积（均值）
        # 家庭户合并只是档案层面的操作，同一块地不会因为档案分合而增减
        area_values = [
            float(all_households[hid].contract_area)
            for hid in matched_hh_ids
            if hid in all_households and all_households[hid].contract_area
        ]
        total_area = round(sum(area_values) / len(area_values), 2) if area_values else None

        matched_hh_info = [
            _hh_info(all_households[hid], village_name_map.get(all_households[hid].village_id, ""))
            for hid in matched_hh_ids
            if hid in all_households
        ]

        groups.append({
            "address": address,
            "head": head,
            "members": members,
            "member_count": len(members),
            "action": action,                           # create / merge_one / merge_multi
            "matched_hh_ids": matched_hh_ids_list,
            "matched_hh_info": matched_hh_info,
            "target_village_id": target_village_id,
            "target_group_no": target_group_no,
            "target_village_name": village_name_map.get(target_village_id, "") if target_village_id else "",
            "total_area_after_merge": total_area,
            "warnings": warnings,
            "has_errors": any(m["has_errors"] for m in members),
            # 供执行时用
            "_all_farmers": all_farmers,
            "_all_households": all_households,
            "_village_name_map": village_name_map,
        })

    return groups, row_errors


# ──────────────────────────────────────────────────────────
#  预览接口
# ──────────────────────────────────────────────────────────

@router.post("/preview")
def preview_import(req: ImportRequest, db: Session = Depends(get_db)):
    """预览导入结果，不写入数据库"""
    groups, row_errors = _analyze_groups(req.rows, db)

    preview_groups = []
    for g in groups:
        preview_groups.append({
            "address": g["address"],
            "action": g["action"],
            "head_name": g["head"]["real_name"],
            "head_id_card": g["head"]["id_card"],
            "member_count": g["member_count"],
            "members": [
                {
                    "real_name": m["real_name"],
                    "id_card": m["id_card"],
                    "is_head": m["is_head"],
                    "in_db": m["id_card"] in g["_all_farmers"],
                    "has_errors": m["has_errors"],
                }
                for m in g["members"]
            ],
            "matched_hh_info": g["matched_hh_info"],
            "target_village_name": g["target_village_name"],
            "target_group_display": format_group_no(g["target_group_no"]) if g["target_group_no"] else "",
            "total_area_after_merge": g["total_area_after_merge"],
            "warnings": g["warnings"],
            "has_errors": g["has_errors"],
        })

    action_counts = {"create": 0, "merge_one": 0, "merge_multi": 0}
    for g in groups:
        action_counts[g["action"]] = action_counts.get(g["action"], 0) + 1

    return {
        "groups": preview_groups,
        "row_errors": row_errors,
        "summary": {
            "total_rows": len(req.rows),
            "total_groups": len(groups),
            "new_households": action_counts["create"],
            "merge_single": action_counts["merge_one"],
            "merge_multi": action_counts["merge_multi"],
            "error_rows": len(row_errors),
        },
    }


# ──────────────────────────────────────────────────────────
#  执行接口
# ──────────────────────────────────────────────────────────

@router.post("/execute")
def execute_import(req: ImportRequest, db: Session = Depends(get_db)):
    """执行导入，写入数据库"""
    groups, row_errors = _analyze_groups(req.rows, db)

    now = datetime.now()
    year_now = now.year

    created_hh = 0
    merged_hh = 0
    created_farmers = 0
    skipped_farmers = 0
    import_errors = [f"第{e['row']}行({e['name']}): {'; '.join(e['errors'])}" for e in row_errors]

    # 获取最大 household id，用于生成 household_code
    max_hh_id = db.query(sqlfunc.max(FamilyHousehold.id)).scalar() or 0
    hh_counter = 0

    for g in groups:
        if g["has_errors"]:
            import_errors.append(f"地址「{g['address']}」存在格式错误行，该组已跳过")
            continue

        all_farmers = g["_all_farmers"]
        all_households = g["_all_households"]
        members = g["members"]
        head = g["head"]
        action = g["action"]

        # ── 确定目标家庭户 ──
        if action == "create":
            # 新建家庭户（先不设 head_farmer_id，稍后更新）
            vid = g["target_village_id"]
            if not vid:
                pending_v = _get_or_create_pending_village(db)
                vid = pending_v.id

            hh_counter += 1
            new_hh = FamilyHousehold(
                household_code=gen_household_code(max_hh_id + hh_counter),
                household_name=f"{head['real_name']}户",
                head_farmer_id=None,
                village_id=vid,
                group_no=g["target_group_no"] or 1,
                registered_address=g["address"],
                status=1,
            )
            db.add(new_hh)
            db.flush()
            target_hh = new_hh
            created_hh += 1

            db.add(HouseholdEvent(
                household_id=target_hh.id,
                event_type="FOUND",
                event_year=year_now,
                description=f"批量导入建档，来源住址：{g['address']}",
                operator="批量导入",
            ))

        elif action == "merge_one":
            # 并入已有的唯一家庭户
            target_hh = all_households[g["matched_hh_ids"][0]]
            if not target_hh.registered_address:
                target_hh.registered_address = g["address"]
            merged_hh += 1

            db.add(HouseholdEvent(
                household_id=target_hh.id,
                event_type="MEMBER_ADD",
                event_year=year_now,
                description=f"批量导入：并入来自住址「{g['address']}」的成员",
                operator="批量导入",
            ))

        else:  # merge_multi
            # 找出保留的家庭户：户主已有记录 → 优先用户主所在户
            head_existing = all_farmers.get(head["id_card"])
            if head_existing and head_existing.household_id in all_households:
                keep_id = head_existing.household_id
            else:
                # 用成员数最多的
                keep_id = max(
                    g["matched_hh_ids"],
                    key=lambda hid: len([f for f in all_farmers.values() if f.household_id == hid])
                )

            target_hh = all_households[keep_id]
            if not target_hh.registered_address:
                target_hh.registered_address = g["address"]

            # 面积取均值（同一块地，档案合并不改变实际面积）
            total_area = g["total_area_after_merge"]
            if total_area is not None:
                target_hh.contract_area = total_area

            # 将其他家庭户的成员移入，并注销其他户
            discard_ids = [hid for hid in g["matched_hh_ids"] if hid != keep_id]
            for discard_id in discard_ids:
                db.query(FarmerProfile).filter(
                    FarmerProfile.household_id == discard_id
                ).update({"household_id": keep_id})

                discard_hh = all_households[discard_id]
                discard_hh.status = 2  # 注销

                db.add(HouseholdEvent(
                    household_id=discard_id,
                    event_type="MERGE",
                    related_hh_id=keep_id,
                    event_year=year_now,
                    description=f"批量导入合并：并入家庭户 {target_hh.household_code}（{target_hh.household_name}），本户注销",
                    operator="批量导入",
                ))

            db.add(HouseholdEvent(
                household_id=target_hh.id,
                event_type="MERGE",
                event_year=year_now,
                description=f"批量导入合并：吸收 {len(discard_ids)} 个家庭户，来源住址：{g['address']}",
                operator="批量导入",
            ))
            merged_hh += 1

        # ── 添加/跳过成员 ──
        for m in members:
            if m["id_card"] in all_farmers:
                # 已存在：不覆盖信息，但确保 household_id 更新到目标户（仅限 merge 场景）
                if action != "create":
                    existing_f = all_farmers[m["id_card"]]
                    if existing_f.household_id != target_hh.id:
                        existing_f.household_id = target_hh.id
                skipped_farmers += 1
                continue

            # 新建成员
            relation = "户主" if m["is_head"] else (m["head_relation"] or "成员")
            new_f = FarmerProfile(
                household_id=target_hh.id,
                real_name=m["real_name"],
                gender=m["gender"],
                id_card=m["id_card"],
                phone=m["phone"] or None,
                bank_card=m["bank_card"] or None,
                bank_name=m["bank_name"] or None,
                relation=relation,
                farmer_status=1,
            )
            db.add(new_f)
            db.flush()
            all_farmers[m["id_card"]] = new_f
            created_farmers += 1

            # 设置户主
            if m["is_head"] and target_hh.head_farmer_id is None:
                target_hh.head_farmer_id = new_f.id
            elif m["is_head"] and action != "create":
                # merge 场景：切换户主
                old_head_id = target_hh.head_farmer_id
                target_hh.head_farmer_id = new_f.id
                db.add(HouseholdEvent(
                    household_id=target_hh.id,
                    event_type="HEAD_CHANGE",
                    farmer_id=new_f.id,
                    farmer_name=new_f.real_name,
                    event_year=year_now,
                    description=f"批量导入：户主变更（原户主ID:{old_head_id} → {new_f.real_name}）",
                    operator="批量导入",
                ))

        # 若 create 但无人被标为户主，用第一个成员
        if action == "create" and target_hh.head_farmer_id is None:
            first_farmer = all_farmers.get(members[0]["id_card"])
            if first_farmer:
                target_hh.head_farmer_id = first_farmer.id

    db.commit()

    return {
        "created_households": created_hh,
        "merged_households": merged_hh,
        "created_farmers": created_farmers,
        "skipped_farmers": skipped_farmers,
        "errors": import_errors,
    }
