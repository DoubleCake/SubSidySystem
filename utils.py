import re
from datetime import date


# ───────────── 脱敏工具 ─────────────
def mask_id_card(id_card: str) -> str:
    """510123********4231"""
    if not id_card or len(id_card) < 15:
        return id_card
    return id_card[:6] + "********" + id_card[-4:]

def mask_phone(phone: str) -> str:
    """138****0001"""
    if not phone or len(phone) < 7:
        return phone
    return phone[:3] + "****" + phone[-4:]

def mask_bank_card(card: str) -> str:
    """****0001"""
    if not card or len(card) < 4:
        return card
    return "****" + card[-4:]

def desensitize_farmer(farmer_dict: dict) -> dict:
    """对农户字典做完整脱敏，返回新字典（不修改原数据）"""
    d = farmer_dict.copy()
    if d.get("id_card"):
        d["id_card"] = mask_id_card(d["id_card"])
    if d.get("phone"):
        d["phone"] = mask_phone(d["phone"])
    if d.get("bank_card"):
        d["bank_card"] = mask_bank_card(d["bank_card"])
    return d


# ───────────── 身份证解析 ─────────────
def parse_id_card(id_card: str) -> dict:
    """从身份证号解析出生日期和性别"""
    result = {"birth_date": None, "gender": None}
    id_card = id_card.strip()

    if len(id_card) == 18:
        try:
            year  = int(id_card[6:10])
            month = int(id_card[10:12])
            day   = int(id_card[12:14])
            result["birth_date"] = date(year, month, day)
        except ValueError:
            pass
        gender_digit = int(id_card[16])
        result["gender"] = 1 if gender_digit % 2 == 1 else 2  # 奇男偶女

    elif len(id_card) == 15:
        try:
            year  = int("19" + id_card[6:8])
            month = int(id_card[8:10])
            day   = int(id_card[10:12])
            result["birth_date"] = date(year, month, day)
        except ValueError:
            pass
        gender_digit = int(id_card[14])
        result["gender"] = 1 if gender_digit % 2 == 1 else 2

    return result


# ───────────── 家庭户编码生成 ─────────────
def gen_household_code(farmer_id: int) -> str:
    return f"HH{str(farmer_id).zfill(4)}"


# ───────────── 村组名称规范化 ─────────────
_DIGITS = '零一二三四五六七八九十'

def _arabic_to_chinese(n: int) -> str:
    """将 1~99 的整数转为中文数字"""
    if n <= 10:
        return _DIGITS[n]
    if n < 20:
        return '十' + (_DIGITS[n - 10] if n % 10 else '')
    tens, ones = divmod(n, 10)
    return _DIGITS[tens] + '十' + (_DIGITS[ones] if ones else '')

def parse_group_no_to_int(value) -> int:
    """将 '1' / '一组' / 1 等多种格式转为整数 1/2/3"""
    if value is None:
        return 1
    s = str(value).strip()
    # 纯数字字符串
    if re.match(r'^\d+$', s):
        return int(s)
    # 匹配：开头数字 + 后续文字（如 "1组"、"2大队"）
    m = re.match(r'^(\d+)(.*)$', s)
    if m:
        return int(m.group(1))
    # 中文数字：一组、二组...
    CN_MAP = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
              '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
    for cn, num in CN_MAP.items():
        if cn in s:
            return num
    return int(s) if s.isdigit() else 1

def format_group_no(n: int) -> str:
    """将整数 1→'一组'，用于显示"""
    return f"{_arabic_to_chinese(n)}组"


# ───────────── 预检查公共工具 ─────────────
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
        year = int(id_card[6:10])
        month = int(id_card[10:12])
        day = int(id_card[12:14])
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


def check_area_anomaly(
    excel_contract_area: float | None,
    db_contract_area: float | None,
    apply_area: float | None,
    trust_out_arable: float = 0,
    excel_trust_in: float = 0,
    no_subsidy_area: float = 0,
    actual_subsidy_area: float | None = None,
    season: str | None = None,
    hh_used: float = 0,
    ignore_trust_in: bool = True,
    farmland_protection_area: float | None = None,
    household_trust_in_arable: float = 0,
) -> dict:
    """
    统一面积异常检查

    两种超限场景：
    情况A — 单行超限：本行自有占用面积 > 本季有效参考上限
    情况B — 户级累计超限：全户当季累计申报面积(hh_used + 本行) > 参考上限(reference_area)
              大春/小春 → 耕地地力保护补贴面积 - trust_out_arable + household_trust_in_arable
              耕地地力保护/临时 → 承包面积 - 不予补贴面积 - trust_out_arable + household_trust_in_arable

    流转面积是否计入取决于 land_trust.subsidy_arable 字段（补贴是否由流入方享受）。

    Args:
        excel_contract_area: Excel填报的承包面积
        db_contract_area: 数据库中的承包面积
        apply_area: Excel填报的申请面积
        trust_out_arable: 家庭户流转出面积（land_trust 汇总，subsidy_arable=1，扣减）
        excel_trust_in: 单条申请的代耕代种面积（仅用于 self_occupy 计算）
        no_subsidy_area: 家庭户不予补贴面积（从耕地保护补贴记录汇总）
        actual_subsidy_area: 实际补贴面积（最终参与计算的面积）
        season: 补贴季节（大春/小春/耕地地力保护/临时，决定参考上限公式）
        hh_used: 户级同季已用面积（排除本行自身后的值，用于情况B累计判断）
        ignore_trust_in: 是否忽略代耕代种进面积（超限检查时）
        farmland_protection_area: 耕地地力保护补贴面积（大春/小春时用作参考基准）
        household_trust_in_arable: 家庭户代耕代种进面积（land_trust 汇总，subsidy_arable=1，增加）
    """
    anomaly_type = None
    anomaly_details = []
    exceed_amount = 0.0
    self_occupy = 0.0
    hh_total = 0.0

    # ── 兜底：缺少DB承包面积时无法做任何面积比较，直接跳过 ──
    if db_contract_area is None:
        return {
            "anomaly_type": None,
            "anomaly_details": [],
            "exceed_amount": 0.0,
            "self_occupy": 0.0,
            "hh_total": 0.0,
            "reference_area": 0.0,
            "area_source": "",
        }

    db_c = float(db_contract_area)
    # excel_contract_area 缺失时仍可进行 Case A/B 超限检查（使用 apply_area），仅跳过承包面积一致性
    excel_c = float(excel_contract_area) if excel_contract_area is not None else None

    # ── 确定参考上限(reference_area) ──
    #   大春/小春: farmland_base - trust_out_arable + household_trust_in_arable
    #   耕地地力保护/临时: contract_base - trust_out_arable + household_trust_in_arable
    #   流转出/入是否计入取决于 land_trust.subsidy_arable（补贴是否由流入方享受）
    farmland_base = farmland_protection_area if (farmland_protection_area is not None and farmland_protection_area > 0) else db_c
    contract_base = max(0, db_c - no_subsidy_area)
    if season in ("大春", "小春"):
        base_area = farmland_base
        base_source = "耕地地力保护补贴面积" if (farmland_protection_area is not None and farmland_protection_area > 0) else "承包面积"
        if farmland_protection_area is not None and farmland_protection_area == 0:
            anomaly_details.append(f"该家庭户无耕地地力保护补贴记录，回退使用承包面积{db_c}亩作为参考")
        elif farmland_protection_area is None:
            anomaly_details.append(f"无耕地地力保护补贴数据，使用承包面积{db_c}亩作为参考")
    else:
        base_area = contract_base
        base_source = "承包面积"
        if no_subsidy_area > 0:
            base_source += f"-不予补贴{no_subsidy_area}亩"

    reference_area = max(0, base_area - trust_out_arable + household_trust_in_arable)
    area_source = base_source
    if trust_out_arable > 0:
        area_source += f"-流转出{trust_out_arable}亩"
    if household_trust_in_arable > 0:
        area_source += f"+代耕代种{household_trust_in_arable}亩"

    # Case A 的有效面积基准：同季节公式但不加 household_trust_in_arable（逐行检查自有占用）
    effective_contract = max(0, base_area - trust_out_arable)

    # ── 检查一：Excel填报承包面积 vs 数据库承包面积 ──
    if excel_c is not None and abs(excel_c - db_c) > 0.001:
        anomaly_type = "承包面积不一致"
        anomaly_details.append(f"Excel填报{excel_c}亩，数据库登记{db_c}亩")

    # ── 检查二：面积超限 ──
    final_subsidy = 0.0
    if actual_subsidy_area is not None:
        final_subsidy = float(actual_subsidy_area)
    elif apply_area is not None:
        final_subsidy = float(apply_area)
    else:
        final_subsidy = round((excel_c or 0) - trust_out_arable - no_subsidy_area, 4)

    if ignore_trust_in:
        self_occupy = round(final_subsidy, 4)
    else:
        self_occupy = round(final_subsidy - excel_trust_in, 4)

    # ── 情况A：单行超限 ──
    #     本行自有占用面积 > 本季有效参考上限（不含代耕代种进）
    if effective_contract > 0 and self_occupy > effective_contract:
        if anomaly_type:
            anomaly_type = f"{anomaly_type}+面积超限"
        else:
            anomaly_type = "面积超限"
        exceed_amount = round(self_occupy - effective_contract, 4)
        anomaly_details.append(f"单行超限{exceed_amount}亩")

    # ── 情况B：户级累计超限 ──
    #     全户当季已用面积 + 本行 > 参考上限（含代耕代种进）
    VALID_SEASONS = {"大春", "小春", "耕地地力保护", "临时"}
    if season in VALID_SEASONS and reference_area > 0:
        hh_total = round(hh_used + final_subsidy, 4)
        if hh_total > reference_area:
            if anomaly_type:
                if "面积超限" not in anomaly_type:
                    anomaly_type = f"{anomaly_type}+面积超限"
            else:
                anomaly_type = "面积超限"
            hh_exceed = round(hh_total - reference_area, 4)
            exceed_amount = max(exceed_amount, hh_exceed)
            detail = f"累计超限{hh_exceed}亩（参考{area_source}:{reference_area}亩）"
            if detail not in anomaly_details:
                anomaly_details.append(detail)

    return {
        "anomaly_type": anomaly_type,
        "anomaly_details": anomaly_details,
        "exceed_amount": exceed_amount,
        "self_occupy": self_occupy,
        "hh_total": hh_total,
        "final_subsidy": final_subsidy,
        "db_contract_area": db_c,
        "hh_used": hh_used,
        "reference_area": reference_area,
        "area_source": area_source,
    }


def check_confirmed_vs_contract(
    contract_area: float | None,
    confirmed_area: float | None,
) -> dict:
    """
    比较承包面积与确权面积的大小关系。

    Returns:
        dict with:
          - diff: confirmed_area - contract_area（正=确权大，负=承包大）
          - status: "match" | "confirmed_larger" | "contract_larger" | "missing"
          - label: 人类可读描述
    """
    if contract_area is None or confirmed_area is None:
        return {"diff": None, "status": "missing", "label": "数据缺失"}

    c = round(float(contract_area), 2)
    f = round(float(confirmed_area), 2)
    diff = round(f - c, 2)

    if abs(diff) <= 0.001:
        return {"diff": 0.0, "status": "match", "label": "一致"}
    elif diff > 0:
        return {"diff": diff, "status": "confirmed_larger", "label": f"确权多{diff}亩"}
    else:
        return {"diff": diff, "status": "contract_larger", "label": f"承包多{abs(diff)}亩"}
