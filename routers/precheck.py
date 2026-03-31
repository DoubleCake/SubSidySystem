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
from models import FarmerProfile, Village, FamilyHousehold, SubsidyApplication, SubsidyType, ErrorLibrary
from utils import format_group_no, parse_group_no_to_int

router = APIRouter(prefix="/api/precheck", tags=["数据预检查"])


# ─────────────────────────────────────
#  请求 / 响应数据结构
# ─────────────────────────────────────

class PreCheckRow(BaseModel):
    
    """Excel 中的单行数据（前端解析后传入）"""
    row_index: int                          # Excel 行号（从2开始，含表头）
    real_name: Optional[str] = None         # 姓名
    id_card: Optional[str] = None           # 身份证号
    village_name: Optional[str] = None      # 村名
    group_no: Optional[str] = None          # 组号
    phone: Optional[str] = None             # 手机号（可选）
    bank_card: Optional[str] = None         # 银行卡（可选）
    bank_name: Optional[str] = None         # 开户行（可选）
    actual_subsidy_area: Optional[float] = None # 实际补贴面积（亩，由申报方直接填写）
    contract_area: Optional[float] = None      # 承包地总面积（亩）---主要是一个记录 不一定准确
    trust_area: Optional[float] = None         # 流转出面积（亩，给出去的）
    trust_in_area: Optional[float] = None      # 代耕代种进面积（亩，接收进来的）
    no_subsidy_area: Optional[float] = None    # 不补贴面积（亩）
    gender: Optional[str] = None               # 性别（可选，中文）
    address: Optional[str] = None              # 家庭地址（可选）
    remark: Optional[str] = None               # 备注（可选）
    extra: Optional[dict] = None               #

VALID_SEASONS = {"大春", "小春", "全年单补", "临时"}

class PreCheckRequest(BaseModel):
    """预检查请求"""
    rows: list[PreCheckRow]
    season: Optional[str] = None         # 本次导入的补贴分类：大春|小春|全年单补|临时
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
    # 村名集合，用于模糊提示（新的 Village 表）
    all_village_names: set[str] = {v.village_name for v in db.query(Village).all()}
    # 村名→Village id 映射
    village_name_to_id: dict[str, int] = {v.village_name: v.id for v in db.query(Village).all()}

    # 数据库中所有在册农户，以身份证为键
    db_farmers: dict[str, dict] = {
        f.id_card: {
            "id": f.id,
            "real_name": f.real_name,
            "village_full_name": (f"{f.household.village.village_name}{format_group_no(f.household.group_no)}" if f.household and f.household.village else ""),
            "village_name": f.household.village.village_name if f.household and f.household.village else "",
            "group_no": f.household.group_no if f.household else 1,
            "farmer_status": f.farmer_status,
        }
        for f in db.query(FarmerProfile).join(
            FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
        ).join(
            Village, Village.id == FamilyHousehold.village_id
        ).all()
    }

    # 加载错误库（按身份证+姓名索引，要求两者都匹配）
    error_lib: dict[tuple[str, str], ErrorLibrary] = {
        (e.id_card.strip(), e.real_name.strip()): e for e in db.query(ErrorLibrary).all()
    }

    # 加载数据库农户的承包面积（按身份证索引）以及 household_id 映射
    db_land_areas: dict[str, float] = {}      # id_card → 承包面积
    db_household_ids: dict[str, int] = {}     # id_card → household_id
    for f in db.query(FarmerProfile).join(
        FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
    ).all():
        if f.id_card and f.household:
            db_household_ids[f.id_card] = f.household_id
            if f.household.contract_area:
                db_land_areas[f.id_card] = float(f.household.contract_area)

    # 加载当季家庭户已有的补贴申请面积（按 household_id 索引），用于检测户级超限
    # 只在指定了 season 且 compare_year 时加载
    season = (req.season or "").strip()
    db_hh_season_used: dict[int, float] = {}  # household_id → 当季已用面积
    if season in VALID_SEASONS and req.compare_year:
        rows_used = db.query(
            SubsidyApplication.household_id,
            func.sum(SubsidyApplication.apply_area).label("total_area")
        ).join(
            SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id
        ).filter(
            SubsidyApplication.apply_year == req.compare_year,
            SubsidyType.season == season,
        ).group_by(SubsidyApplication.household_id).all()
        db_hh_season_used = {r.household_id: float(r.total_area or 0) for r in rows_used}

    # ── 2. 逐行检查 ──
    format_errors:       list[dict] = []   # 格式/类型错误
    village_errors:      list[dict] = []   # 村组不存在
    gender_mismatch:     list[dict] = []   # 性别与身份证不符
    duplicate_errors:    list[dict] = []   # Excel 内部重复身份证
    changed_farmers:     list[dict] = []   # 与数据库比对发现字段变化
    new_farmers:         list[dict] = []   # Excel 中有、数据库中没有
    error_library_hits:  list[dict] = []   # 错误库命中
    area_exceeds:        list[dict] = []   # 面积超限
    area_missing:        list[dict] = []   # 承包面积缺失
    age_anomaly:         list[dict] = []   # 年龄异常
    deceased_farmers:    list[dict] = []   # 死亡农户
    household_duplicates: list[dict] = []  # 同一家庭多成员申请
    ok_rows:             list[dict] = []   # 通过所有检查的行

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
        village_id = None
        if not village:
            row_errors.append("村名为空")
        else:
            # 检查村名是否存在
            village_id = village_name_to_id.get(village)
            if not village_id:
                # 尝试找相近的村名给出提示
                similar = [v for v in all_village_names if village in v or v in village]
                hint = f"（相近的村名：{'、'.join(similar[:3])}）" if similar else "（数据库中无此村）"
                village_errors.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "error": f"村「{village}」在数据库中不存在 {hint}"
                })

        # ── 2.4 手机号检查（可选）──
        if row.phone:
            phone_ok, phone_err = check_phone(str(row.phone))
            if not phone_ok:
                row_errors.append(phone_err)

        # ── 2.5 土地面积合理性检查（可选）──
        contract_area_val    = None
        trust_area_val       = None
        trust_in_area_val    = None
        no_subsidy_area_val  = None
        actual_subsidy_area_val = None

        def _parse_area(val, label) -> tuple[float | None, str | None]:
            if val is None:
                return None, None
            try:
                f = float(val)
                if f < 0:
                    return f, f"{label}不能为负数（{f}）"
                return f, None
            except (ValueError, TypeError):
                return None, f"{label}格式错误（{val}）"

        contract_area_val,   err = _parse_area(row.contract_area,   "承包地面积")
        if err: row_errors.append(err)
        if contract_area_val is not None and contract_area_val > 9999:
            row_errors.append(f"承包地面积异常偏大（{contract_area_val}亩），请核实")
        trust_area_val,      err = _parse_area(row.trust_area,      "流转出面积")
        if err: row_errors.append(err)

        trust_in_area_val,   err = _parse_area(row.trust_in_area,   "代耕代种进面积")
        if err: row_errors.append(err)

        no_subsidy_area_val, err = _parse_area(row.no_subsidy_area, "不补贴面积")
        if err: row_errors.append(err)

        actual_subsidy_area_val, err = _parse_area(row.actual_subsidy_area, "实际补贴面积")
        if err: row_errors.append(err)

        # 面积逻辑关系校验：流转出+不补贴 不能超过承包地
        if contract_area_val is not None:
            deduct = (trust_area_val or 0) + (no_subsidy_area_val or 0)
            if deduct > contract_area_val:
                row_errors.append(
                    f"流转出面积({trust_area_val or 0}亩)+不补贴面积({no_subsidy_area_val or 0}亩)"
                    f"={deduct}亩 超过承包地面积({contract_area_val}亩)"
                )

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

        # ── 2.8 错误库交叉比对（身份证+姓名同时匹配）──
        if (id_card, name) in error_lib:
            lib_rec = error_lib[(id_card, name)]
            error_library_hits.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "error_type": lib_rec.error_type,
                "error_reason": lib_rec.error_reason,
                "source": lib_rec.source,
            })

        # ── 2.9 性别与身份证不符 ──
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

        # ── 2.10 面积超限双重检查 ──
        # 情况一：本行实际补贴面积 - 流转出 - 代耕代种进 + 不补贴 > 数据库承包地面积（单行本身逻辑越界）
        #         即：承包地上自己实际占用的补贴面积 > 承包地面积
        # 情况二：若指定了 season+compare_year，家庭户在该季下数据库已有申请面积 + 本行面积 > 承包地面积（累计超限）
        if contract_area_val is not None and id_card in db_land_areas:
            db_contracted   = db_land_areas[id_card]         # 数据库登记的承包地面积（基准）
            t_out           = trust_area_val      or 0       # 流转出（给出去，减少自有种植）
            t_in            = trust_in_area_val   or 0       # 代耕代种进（接收进来）
            ns_area         = no_subsidy_area_val or 0       # 不补贴面积
            # 有效补贴面积 = 实际补贴面积 - 流转出 - 代耕代种进 + 不补贴
            # 优先用申报方直填的实际补贴面积，否则用计算值
            final_subsidy   = actual_subsidy_area_val if actual_subsidy_area_val is not None \
                              else round(contract_area_val - t_out - ns_area, 4)
            # 本行在自有承包地上占用的面积（去掉代耕代种进来的部分）
            self_occupy     = round(final_subsidy - t_in, 4)
            # 家庭户当季数据库已有申请面积
            hh_id           = db_household_ids.get(id_card)
            hh_used         = db_hh_season_used.get(hh_id, 0) if hh_id else 0

            exceed_type = None
            exceed_amount = 0.0

            # 情况一：本行自有承包地占用 > 数据库承包地
            if db_contracted > 0 and self_occupy > db_contracted:
                exceed_type   = "单行超限"
                exceed_amount = round(self_occupy - db_contracted, 4)

            # 情况二：户级累计超限（需要 season + compare_year）
            hh_total = round(hh_used + final_subsidy, 4)
            if season in VALID_SEASONS and hh_id and db_contracted > 0 and hh_total > db_contracted:
                if exceed_type:
                    exceed_type = "单行超限+累计超限"
                else:
                    exceed_type   = "累计超限"
                exceed_amount = max(exceed_amount, round(hh_total - db_contracted, 4))

            if exceed_type:
                area_exceeds.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "exceed_type":         exceed_type,           # 超限类型
                    "contract_area":       contract_area_val,     # Excel填报承包地面积
                    "trust_out_area":      t_out,                 # 流转出
                    "trust_in_area":       t_in,                  # 代耕代种进
                    "no_subsidy_area":     ns_area,               # 不补贴
                    "actual_subsidy_area": final_subsidy,         # 实际补贴面积
                    "self_occupy":         self_occupy,           # 自有承包地占用
                    "hh_used":             hh_used,               # 户级当季已有申请面积
                    "hh_total":            hh_total,              # 户级累计（已有+本行）
                    "db_contract_area":    db_contracted,         # 数据库承包地（基准）
                    "exceed_amount":       exceed_amount,         # 超出量
                })

        # ── 2.11 与数据库比对：字段变更 ──
        if id_card in db_farmers:
            db_f = db_farmers[id_card]
            changes: list[str] = []

            # 姓名变更（可能是同音字录入错误）
            if name != db_f["real_name"]:
                changes.append(f"姓名：数据库「{db_f['real_name']}」→ Excel「{name}」")

            # 村组变更（组号需归一化后比较：4="四组"="4组"均视为同一组）
            db_group_int = db_f["group_no"]  # 数据库存的是整数 1,2,3
            excel_group_int = parse_group_no_to_int(group)  # Excel 可能是"四组"、"4组"等
            if village != db_f["village_name"] or db_group_int != excel_group_int:
                db_group_display = format_group_no(db_group_int) if isinstance(db_group_int, int) else str(db_group_int)
                changes.append(
                    f"村组：数据库「{db_f['village_name']}{db_group_display}」"
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
                "village_id": village_id,
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
            Village.village_name, FamilyHousehold.group_no
        ).join(
            SubsidyApplication, SubsidyApplication.farmer_id == FarmerProfile.id
        ).join(
            FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
        ).join(
            Village, Village.id == FamilyHousehold.village_id
        ).filter(
            SubsidyApplication.apply_year == year
        ).distinct().all()

        db_year_ids = {r.id_card for r in apps_this_year}
        db_year_map = {r.id_card: {"name": r.real_name, "village": r.village_name,
                       "group": format_group_no(r.group_no) if r.group_no else "一组"}
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
    error_rows = (
        len(format_errors) + len(village_errors) + len(duplicate_errors)
        + len(gender_mismatch) + len(error_library_hits) + len(area_exceeds)
        + len(area_missing) + len(age_anomaly) + len(deceased_farmers) + len(household_duplicates)
    )
    summary = {
        "total_rows": total_rows,
        "ok_rows": len(ok_rows),
        "error_rows": error_rows,
        "format_errors": len(format_errors),
        "village_errors": len(village_errors),
        "duplicate_errors": len(duplicate_errors),
        "gender_mismatch": len(gender_mismatch),
        "error_library_hits": len(error_library_hits),
        "area_exceeds": len(area_exceeds),
        "area_missing": len(area_missing),
        "age_anomaly": len(age_anomaly),
        "deceased_farmers": len(deceased_farmers),
        "household_duplicates": len(household_duplicates),
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
        "error_library_hits": error_library_hits,
        "area_exceeds": area_exceeds,
        "area_missing": area_missing,
        "age_anomaly": age_anomaly,
        "deceased_farmers": deceased_farmers,
        "household_duplicates": household_duplicates,
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
            "承包地面积(亩)", "流转出面积(亩)", "不补贴面积(亩)",
            "家庭地址", "备注"
        ],
        "example": [
            {
                "姓名*": "张国强", "身份证号*": "510123196503154231",
                "所在村*": "红星村", "所在组*": "一组",
                "性别": "男", "手机号": "13812340001",
                "银行卡号": "6222021234560001", "开户行": "农业银行",
                "承包地面积(亩)": 3.5, "流转出面积(亩)": 0.5, "不补贴面积(亩)": 0,
                "家庭地址": "红星村一组12号", "备注": ""
            }
        ]
    }


