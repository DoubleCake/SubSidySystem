"""
数据预检查路由
功能：
  1. 接收前端上传的 Excel 数据（已由前端 xlsx 解析为 JSON）
  2. 逐行进行格式校验（姓名、身份证、村、组）
  3. 与数据库现有数据比对，找出：新增农户、减少农户、字段变更、村组不存在等问题
  4. 将检查结果按问题类型分类返回，前端可导出 Excel 报告
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
import re

from database import get_db
from models import FarmerProfile, VillageGroup, FamilyHousehold, SubsidyApplication

router = APIRouter(prefix="/api/precheck", tags=["数据预检查"])


# ─────────────────────────────────────
#  请求 / 响应数据结构
# ─────────────────────────────────────

class PreCheckRow(BaseModel):
    """Excel 中的单行数据（前端解析后传入）"""
    row_index: int                     # Excel 行号（从2开始，含表头）
    real_name: Optional[str] = None    # 姓名
    id_card: Optional[str] = None      # 身份证号
    village_name: Optional[str] = None # 村名
    group_no: Optional[str] = None     # 组号
    phone: Optional[str] = None        # 手机号（可选）
    bank_card: Optional[str] = None    # 银行卡（可选）
    land_area: Optional[float] = None  # 土地面积（可选）
    gender: Optional[str] = None       # 性别（可选，中文）
    # 其他透传字段
    extra: Optional[dict] = None


class PreCheckRequest(BaseModel):
    """预检查请求"""
    rows: list[PreCheckRow]
    compare_year: Optional[int] = None   # 要与哪一年的补贴数据对比（可不传）
    check_options: Optional[dict] = None # 保留字段，控制哪些项目需要检查


# ─────────────────────────────────────
#  身份证号格式校验工具
# ─────────────────────────────────────

def validate_id_card(id_card: str) -> tuple[bool, str]:
    """
    校验身份证号合法性
    返回: (是否合法, 错误原因)
    规则：
      - 18位
      - 前17位为数字，最后一位为数字或X
      - 出生日期合法（年月日范围）
      - 校验码正确（GB11643-1999）
    """
    if not id_card:
        return False, "身份证号为空"
    id_card = id_card.strip().upper()
    if len(id_card) != 18:
        return False, f"长度不是18位（当前{len(id_card)}位）"
    if not re.match(r'^\d{17}[\dX]$', id_card):
        return False, "格式不正确（前17位应为数字，最后一位为数字或X）"

    # 出生日期校验
    try:
        year  = int(id_card[6:10])
        month = int(id_card[10:12])
        day   = int(id_card[12:14])
        if not (1900 <= year <= 2099):
            return False, f"出生年份 {year} 不合理"
        if not (1 <= month <= 12):
            return False, f"出生月份 {month} 不合理"
        if not (1 <= day <= 31):
            return False, f"出生日期 {day} 不合理"
    except Exception:
        return False, "出生日期段解析失败"

    # 校验码（GB11643-1999 加权校验）
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    check_map = "10X98765432"
    try:
        total = sum(int(id_card[i]) * weights[i] for i in range(17))
        expected_check = check_map[total % 11]
        if id_card[17] != expected_check:
            return False, f"校验码错误（应为{expected_check}，实际为{id_card[17]}）"
    except Exception:
        return False, "校验码计算失败"

    return True, ""


def parse_gender_from_id(id_card: str) -> int:
    """从身份证解析性别：奇数=男(1)，偶数=女(2)"""
    if len(id_card) == 18:
        return 1 if int(id_card[16]) % 2 == 1 else 2
    return 0  # 无法解析


def check_name(name: str) -> tuple[bool, str]:
    """姓名格式简单校验"""
    if not name or not name.strip():
        return False, "姓名为空"
    name = name.strip()
    if len(name) < 2:
        return False, "姓名过短（少于2个字符）"
    if len(name) > 20:
        return False, "姓名过长（超过20个字符）"
    # 允许汉字、少数民族名字中的··点号
    if not re.match(r'^[\u4e00-\u9fa5·•\-]+$', name):
        return False, f"姓名包含非法字符（仅允许汉字和间隔符）"
    return True, ""


def check_phone(phone: str) -> tuple[bool, str]:
    """手机号格式校验（可选字段）"""
    if not phone or not phone.strip():
        return True, ""  # 手机号是可选的
    phone = phone.strip()
    if not re.match(r'^1[3-9]\d{9}$', phone):
        return False, f"手机号格式不正确（{phone}）"
    return True, ""


# ─────────────────────────────────────
#  主接口：执行预检查
# ─────────────────────────────────────

@router.post("/run")
def run_precheck(req: PreCheckRequest, db: Session = Depends(get_db)):
    """
    执行完整预检查，返回：
    - format_errors:    格式错误（身份证不合法、姓名为空等）
    - village_errors:   村组不存在
    - duplicate_errors: Excel 内部重复（同一身份证出现多次）
    - gender_mismatch:  性别与身份证不符
    - new_farmers:      数据库中不存在的新增农户
    - removed_farmers:  数据库中存在但本次 Excel 没有的农户
    - changed_farmers:  关键字段发生变化的农户（村组变更、姓名变更等）
    - year_compare:     与指定年度补贴记录的对比（新增/减少）
    - summary:          汇总统计
    """

    # ── 1. 加载数据库基础数据（减少循环内查询）──
    all_village_groups: dict[str, int] = {
        f"{vg.village_name}|{vg.group_no}": vg.id
        for vg in db.query(VillageGroup).all()
    }
    # 村名集合，用于模糊提示
    all_village_names: set[str] = {vg.village_name for vg in db.query(VillageGroup).all()}

    # 数据库中所有在册农户，以身份证为键
    db_farmers: dict[str, dict] = {
        f.id_card: {
            "id": f.id,
            "real_name": f.real_name,
            "village_full_name": f.household.village_group.full_name if f.household and f.household.village_group else "",
            "village_name": f.household.village_group.village_name if f.household and f.household.village_group else "",
            "group_no": f.household.village_group.group_no if f.household and f.household.village_group else "",
            "farmer_status": f.farmer_status,
        }
        for f in db.query(FarmerProfile).join(
            FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
        ).join(
            VillageGroup, VillageGroup.id == FamilyHousehold.village_group_id
        ).all()
    }

    # ── 2. 逐行检查 ──
    format_errors:    list[dict] = []   # 格式/类型错误
    village_errors:   list[dict] = []   # 村组不存在
    gender_mismatch:  list[dict] = []   # 性别与身份证不符
    duplicate_errors: list[dict] = []   # Excel 内部重复身份证
    changed_farmers:  list[dict] = []   # 与数据库比对发现字段变化
    new_farmers:      list[dict] = []   # Excel 中有、数据库中没有
    ok_rows:          list[dict] = []   # 通过所有检查的行

    seen_id_cards: dict[str, int] = {}   # 记录 Excel 内已出现的身份证 → 行号

    for row in req.rows:
        row_errors: list[str] = []
        row_no = row.row_index

        # ── 2.1 姓名检查 ──
        name = (row.real_name or "").strip()
        name_ok, name_err = check_name(name)
        if not name_ok:
            row_errors.append(f"姓名错误：{name_err}")

        # ── 2.2 身份证检查 ──
        id_card = (row.id_card or "").strip().upper()
        id_ok, id_err = validate_id_card(id_card)
        if not id_ok:
            row_errors.append(f"身份证错误：{id_err}")

        # ── 2.3 村组检查 ──
        village = (row.village_name or "").strip()
        group   = (row.group_no or "").strip()
        village_group_id = None
        if not village:
            row_errors.append("村名为空")
        elif not group:
            row_errors.append("组号为空")
        else:
            vg_key = f"{village}|{group}"
            if vg_key in all_village_groups:
                village_group_id = all_village_groups[vg_key]
            else:
                # 尝试找相近的村名给出提示
                similar = [v for v in all_village_names if village in v or v in village]
                hint = f"（相近的村名：{'、'.join(similar[:3])}）" if similar else "（数据库中无此村）"
                village_errors.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "error": f"村组「{village}{group}」在数据库中不存在 {hint}"
                })

        # ── 2.4 手机号检查（可选）──
        if row.phone:
            phone_ok, phone_err = check_phone(str(row.phone))
            if not phone_ok:
                row_errors.append(phone_err)

        # ── 2.5 土地面积合理性检查（可选）──
        if row.land_area is not None:
            try:
                area = float(row.land_area)
                if area < 0:
                    row_errors.append(f"土地面积不能为负数（{area}）")
                elif area > 9999:
                    row_errors.append(f"土地面积异常偏大（{area}亩），请核实")
            except (ValueError, TypeError):
                row_errors.append(f"土地面积格式错误（{row.land_area}）")

        # ── 2.6 格式错误汇总 ──
        if row_errors:
            format_errors.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "errors": row_errors,
                "error_count": len(row_errors),
            })
            continue  # 格式有误的行不参与后续业务比对

        # ── 2.7 Excel 内部重复身份证 ──
        if id_card in seen_id_cards:
            duplicate_errors.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "error": f"身份证号与第{seen_id_cards[id_card]}行重复"
            })
            continue
        seen_id_cards[id_card] = row_no

        # ── 2.8 性别与身份证不符 ──
        if row.gender:
            gender_text = str(row.gender).strip()
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

        # ── 2.9 与数据库比对：字段变更 ──
        if id_card in db_farmers:
            db_f = db_farmers[id_card]
            changes: list[str] = []

            # 姓名变更（可能是同音字录入错误）
            if name != db_f["real_name"]:
                changes.append(f"姓名：数据库「{db_f['real_name']}」→ Excel「{name}」")

            # 村组变更
            if village != db_f["village_name"] or group != db_f["group_no"]:
                changes.append(
                    f"村组：数据库「{db_f['village_name']}{db_f['group_no']}」"
                    f"→ Excel「{village}{group}」"
                )

            if changes:
                changed_farmers.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "db_name": db_f["real_name"],
                    "db_village": db_f["village_name"],
                    "db_group": db_f["group_no"],
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
                "village_group_id": village_group_id,
            })

    # ── 3. 数据库中存在但 Excel 中没有的：减少的农户 ──
    excel_id_cards = set(seen_id_cards.keys())
    removed_farmers: list[dict] = []
    for id_card, db_f in db_farmers.items():
        if id_card not in excel_id_cards and db_f["farmer_status"] == 1:
            removed_farmers.append({
                "id_card": id_card,
                "name": db_f["real_name"],
                "village": db_f["village_name"],
                "group": db_f["group_no"],
                "farmer_id": db_f["id"],
                "note": "在数据库中在册，但本次 Excel 中未出现",
            })

    # ── 4. 年度补贴对比（可选）──
    year_compare: dict = {}
    if req.compare_year:
        year = req.compare_year
        # 该年度已有补贴申请的农户 id_card 集合
        apps_this_year = db.query(
            FarmerProfile.id_card, FarmerProfile.real_name,
            VillageGroup.village_name, VillageGroup.group_no
        ).join(
            SubsidyApplication, SubsidyApplication.farmer_id == FarmerProfile.id
        ).join(
            FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
        ).join(
            VillageGroup, VillageGroup.id == FamilyHousehold.village_group_id
        ).filter(
            SubsidyApplication.apply_year == year
        ).distinct().all()

        db_year_ids = {r.id_card for r in apps_this_year}
        db_year_map = {r.id_card: {"name": r.real_name, "village": r.village_name, "group": r.group_no}
                       for r in apps_this_year}

        # 本次 Excel 中有补贴但上年没有 → 新增受益农户
        year_new = [
            {"id_card": ic, "name": seen_id_cards.get(ic, ic), "row": seen_id_cards.get(ic)}
            for ic in excel_id_cards if ic not in db_year_ids
        ]
        # 上年有补贴但本次 Excel 没有 → 减少受益农户
        year_removed = [
            {"id_card": ic, **db_year_map[ic]}
            for ic in db_year_ids if ic not in excel_id_cards
        ]

        year_compare = {
            "year": year,
            "db_count": len(db_year_ids),
            "excel_count": len(excel_id_cards),
            "new_count": len(year_new),
            "removed_count": len(year_removed),
            "new_farmers": year_new[:200],      # 最多返回200条，避免响应过大
            "removed_farmers": year_removed[:200],
        }

    # ── 5. 汇总 ──
    total_rows = len(req.rows)
    error_rows = len(format_errors) + len(village_errors) + len(duplicate_errors)
    summary = {
        "total_rows": total_rows,
        "ok_rows": len(ok_rows),
        "error_rows": error_rows,
        "format_errors": len(format_errors),
        "village_errors": len(village_errors),
        "duplicate_errors": len(duplicate_errors),
        "gender_mismatch": len(gender_mismatch),
        "new_farmers": len(new_farmers),
        "removed_farmers": len(removed_farmers),
        "changed_farmers": len(changed_farmers),
        "pass_rate": round((total_rows - error_rows) / total_rows * 100, 1) if total_rows else 0,
    }

    return {
        "summary": summary,
        "format_errors": format_errors,
        "village_errors": village_errors,
        "duplicate_errors": duplicate_errors,
        "gender_mismatch": gender_mismatch,
        "new_farmers": new_farmers,
        "removed_farmers": removed_farmers,
        "changed_farmers": changed_farmers,
        "year_compare": year_compare,
    }


# ─────────────────────────────────────
#  下载预检查报告模板
# ─────────────────────────────────────

@router.get("/template-headers")
def get_template_headers():
    """
    返回预检查 Excel 模板的列定义，供前端生成下载模板
    带 * 表示必填
    """
    return {
        "headers": [
            "姓名*", "身份证号*", "所在村*", "所在组*",
            "性别", "手机号", "银行卡号", "开户行",
            "土地面积(亩)", "备注"
        ],
        "example": [
            {
                "姓名*": "张国强", "身份证号*": "510123196503154231",
                "所在村*": "红星村", "所在组*": "一组",
                "性别": "男", "手机号": "13812340001",
                "银行卡号": "6222021234560001", "开户行": "农业银行",
                "土地面积(亩)": 3.5, "备注": ""
            }
        ]
    }


# ─────────────────────────────────────
#  历史错误库（黑名单）
# ─────────────────────────────────────

from pydantic import BaseModel as PM
from typing import Optional as Opt

# ── 建表 SQL（含村/组字段，兼容旧表自动迁移）──
_CREATE_ERROR_LIB_SQL = """
    CREATE TABLE IF NOT EXISTS precheck_error_library (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        id_card      TEXT NOT NULL,
        real_name    TEXT NOT NULL,
        village_name TEXT,
        group_no     TEXT,
        error_reason TEXT NOT NULL DEFAULT '',
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
"""

def _ensure_error_lib(db):
    """建表并自动补齐新字段（兼容已有旧表）"""
    from sqlalchemy import text
    db.execute(text(_CREATE_ERROR_LIB_SQL))
    # 迁移旧表：自动添加 village_name / group_no / updated_at
    for col, default in [("village_name", "NULL"), ("group_no", "NULL"), ("updated_at", "CURRENT_TIMESTAMP")]:
        try:
            db.execute(text(f"ALTER TABLE precheck_error_library ADD COLUMN {col} TEXT DEFAULT {default}"))
        except Exception:
            pass  # 字段已存在则跳过
    db.commit()


class ErrorEntry(PM):
    id_card:      str
    real_name:    str
    village_name: Opt[str] = None
    group_no:     Opt[str] = None
    error_reason: str

class ErrorEntryUpdate(PM):
    real_name:    Opt[str] = None
    village_name: Opt[str] = None
    group_no:     Opt[str] = None
    error_reason: Opt[str] = None

class ErrorMatchRequest(PM):
    rows: list[dict]   # 每行含 id_card / real_name


@router.get("/error-library")
def list_error_library(
    search:    Opt[str] = None,
    village:   Opt[str] = None,
    page:      int = 1,
    page_size: int = 50,
    db = Depends(get_db)
):
    """
    历史错误库列表，支持：
    - search：按姓名/身份证模糊搜索
    - village：按村名过滤
    - 分页（page / page_size）
    """
    from sqlalchemy import text
    _ensure_error_lib(db)

    where = "1=1"
    params: dict = {}
    if search:
        where += " AND (id_card LIKE :s OR real_name LIKE :s)"
        params["s"] = f"%{search}%"
    if village:
        where += " AND village_name = :v"
        params["v"] = village

    total = db.execute(text(f"SELECT COUNT(*) FROM precheck_error_library WHERE {where}"), params).scalar() or 0
    rows = db.execute(text(f"""
        SELECT id, id_card, real_name, village_name, group_no, error_reason, created_at, updated_at
        FROM precheck_error_library
        WHERE {where}
        ORDER BY id DESC
        LIMIT :lim OFFSET :off
    """), {**params, "lim": page_size, "off": (page - 1) * page_size}).fetchall()

    # 取村名列表（用于前端下拉筛选）
    villages = db.execute(text(
        "SELECT DISTINCT village_name FROM precheck_error_library WHERE village_name IS NOT NULL ORDER BY village_name"
    )).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r._mapping) for r in rows],
        "villages": [r[0] for r in villages if r[0]],
    }


@router.post("/error-library")
def add_error_entry(entry: ErrorEntry, db = Depends(get_db)):
    from sqlalchemy import text
    _ensure_error_lib(db)
    db.execute(text("""
        INSERT INTO precheck_error_library (id_card, real_name, village_name, group_no, error_reason)
        VALUES (:ic, :name, :vn, :gn, :reason)
    """), {
        "ic": entry.id_card.strip(),
        "name": entry.real_name.strip(),
        "vn": (entry.village_name or "").strip() or None,
        "gn": (entry.group_no or "").strip() or None,
        "reason": entry.error_reason.strip(),
    })
    db.commit()
    return {"message": "添加成功"}


@router.put("/error-library/{entry_id}")
def update_error_entry(entry_id: int, data: ErrorEntryUpdate, db = Depends(get_db)):
    """编辑历史错误库中的一条记录"""
    from sqlalchemy import text
    _ensure_error_lib(db)
    existing = db.execute(text("SELECT id FROM precheck_error_library WHERE id=:id"), {"id": entry_id}).fetchone()
    if not existing:
        from fastapi import HTTPException
        raise HTTPException(404, "记录不存在")

    updates = []
    params: dict = {"id": entry_id}
    if data.real_name    is not None: updates.append("real_name=:real_name");    params["real_name"]    = data.real_name.strip()
    if data.village_name is not None: updates.append("village_name=:vn");        params["vn"]           = data.village_name.strip() or None
    if data.group_no     is not None: updates.append("group_no=:gn");            params["gn"]           = data.group_no.strip() or None
    if data.error_reason is not None: updates.append("error_reason=:reason");    params["reason"]       = data.error_reason.strip()

    if updates:
        updates.append("updated_at=CURRENT_TIMESTAMP")
        db.execute(text(f"UPDATE precheck_error_library SET {', '.join(updates)} WHERE id=:id"), params)
        db.commit()
    return {"message": "更新成功"}


@router.delete("/error-library/{entry_id}")
def delete_error_entry(entry_id: int, db = Depends(get_db)):
    from sqlalchemy import text
    db.execute(text("DELETE FROM precheck_error_library WHERE id=:id"), {"id": entry_id})
    db.commit()
    return {"message": "删除成功"}


@router.post("/error-library/match")
def match_error_library(req: ErrorMatchRequest, db = Depends(get_db)):
    """
    把上传的名单与历史错误库交叉比对，返回命中记录。
    匹配规则（优先级顺序）：
    1. 身份证号精确匹配（最可靠）
    2. 姓名完全相同但身份证不同（可能是身份证录错了）
    """
    from sqlalchemy import text
    _ensure_error_lib(db)

    lib = db.execute(text(
        "SELECT id_card, real_name, village_name, group_no, error_reason FROM precheck_error_library"
    )).fetchall()

    # 两个索引：按身份证 + 按姓名
    lib_by_card: dict[str, dict] = {}
    lib_by_name: dict[str, list] = {}
    for r in lib:
        rd = dict(r._mapping)
        lib_by_card[rd["id_card"].strip()] = rd
        nm = rd["real_name"].strip()
        lib_by_name.setdefault(nm, []).append(rd)

    hits = []
    seen = set()

    for row in req.rows:
        ic   = str(row.get("id_card",   "")).strip()
        name = str(row.get("real_name", "") or row.get("name", "")).strip()

        # 规则1：身份证精确匹配
        if ic and ic in lib_by_card:
            lib_rec = lib_by_card[ic]
            key = f"card:{ic}"
            if key not in seen:
                seen.add(key)
                hits.append({
                    "match_type":   "id_card",          # 匹配方式
                    "match_label":  "身份证匹配",
                    "id_card":      ic,
                    "real_name":    name or lib_rec["real_name"],
                    "library_name": lib_rec["real_name"],
                    "village_name": lib_rec.get("village_name") or "",
                    "group_no":     lib_rec.get("group_no") or "",
                    "error_reason": lib_rec["error_reason"],
                })

        # 规则2：姓名精确相同但身份证不在库中（身份证可能录错）
        elif name and name in lib_by_name:
            for lib_rec in lib_by_name[name]:
                if lib_rec["id_card"].strip() != ic:  # 姓名同但身份证不同
                    key = f"name:{name}:{lib_rec['id_card']}"
                    if key not in seen:
                        seen.add(key)
                        hits.append({
                            "match_type":   "name_only",
                            "match_label":  "姓名匹配（身份证不同，请核实）",
                            "id_card":      ic,
                            "real_name":    name,
                            "library_name": lib_rec["real_name"],
                            "library_id_card": lib_rec["id_card"],  # 库中的身份证
                            "village_name": lib_rec.get("village_name") or "",
                            "group_no":     lib_rec.get("group_no") or "",
                            "error_reason": lib_rec["error_reason"],
                        })

    return {"total": len(hits), "hits": hits}


@router.post("/error-library/batch-import")
def batch_import_error_library(payload: dict, db = Depends(get_db)):
    """
    批量导入历史错误记录。
    支持字段：身份证号、姓名、村、组、错误原因。
    重复身份证：更新已有记录的错误原因（不重复插入）。
    """
    from sqlalchemy import text
    _ensure_error_lib(db)
    rows = payload.get("rows", [])
    created = updated = skipped = 0

    for r in rows:
        ic  = str(r.get("id_card","")).strip()
        nm  = str(r.get("real_name","")).strip()
        vn  = str(r.get("village_name","")).strip() or None
        gn  = str(r.get("group_no","")).strip() or None
        rsn = str(r.get("error_reason","")).strip()
        if not ic or not nm:
            skipped += 1
            continue

        existing = db.execute(text(
            "SELECT id FROM precheck_error_library WHERE id_card=:ic"
        ), {"ic": ic}).fetchone()

        if existing:
            # 已存在：更新错误原因和村组信息（不留空白）
            db.execute(text("""
                UPDATE precheck_error_library
                SET real_name=:nm,
                    village_name=COALESCE(:vn, village_name),
                    group_no=COALESCE(:gn, group_no),
                    error_reason=CASE WHEN :rsn!='' THEN :rsn ELSE error_reason END,
                    updated_at=CURRENT_TIMESTAMP
                WHERE id_card=:ic
            """), {"ic": ic, "nm": nm, "vn": vn, "gn": gn, "rsn": rsn})
            updated += 1
        else:
            db.execute(text("""
                INSERT INTO precheck_error_library (id_card, real_name, village_name, group_no, error_reason)
                VALUES (:ic, :nm, :vn, :gn, :rsn)
            """), {"ic": ic, "nm": nm, "vn": vn, "gn": gn, "rsn": rsn or "（待填写）"})
            created += 1

    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped}
