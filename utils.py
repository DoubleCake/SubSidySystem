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
    excel_trust_out: float = 0,
    excel_trust_in: float = 0,
    excel_no_subsidy: float = 0,
    actual_subsidy_area: float | None = None,
    season: str | None = None,
    hh_used: float = 0,
    ignore_trust_in: bool = True
) -> dict:
    """
    统一面积异常检查

    Args:
        excel_contract_area: Excel填报的承包面积
        db_contract_area: 数据库中的承包面积
        apply_area: 申请面积
        excel_trust_out: 流转出面积
        excel_trust_in: 代耕代种进面积
        excel_no_subsidy: 不补贴面积
        actual_subsidy_area: 实际补贴面积
        season: 补贴季节
        hh_used: 户级已用面积
        ignore_trust_in: 是否忽略代耕代种进面积（超限检查时）

    Returns:
        dict with anomaly_type, anomaly_details, exceed_amount, self_occupy, hh_total
    """
    anomaly_type = None
    anomaly_details = []
    exceed_amount = 0.0
    self_occupy = 0.0
    hh_total = 0.0

    if excel_contract_area is None or db_contract_area is None:
        return {
            "anomaly_type": None,
            "anomaly_details": [],
            "exceed_amount": 0.0,
            "self_occupy": 0.0,
            "hh_total": 0.0,
        }

    excel_c = float(excel_contract_area)
    db_c = float(db_contract_area)

    # 检查一：Excel承包面积与数据库承包面积不一致
    if abs(excel_c - db_c) > 0.001:
        anomaly_type = "承包面积不一致"
        anomaly_details.append(f"Excel填报{excel_c}亩，数据库登记{db_c}亩")

    # 检查二：面积超限
    # 计算有效补贴面积
    final_subsidy = 0.0
    if actual_subsidy_area is not None:
        final_subsidy = float(actual_subsidy_area)
    else:
        final_subsidy = round(excel_c - excel_trust_out - excel_no_subsidy, 4)

    # 计算自有占用面积（忽略代耕代种进面积）
    if ignore_trust_in:
        self_occupy = round(final_subsidy, 4)
    else:
        self_occupy = round(final_subsidy - excel_trust_in, 4)

    # 情况A：单行超限
    if db_c > 0 and self_occupy > db_c:
        if anomaly_type:
            anomaly_type = f"{anomaly_type}+面积超限"
        else:
            anomaly_type = "面积超限"
        exceed_amount = round(self_occupy - db_c, 4)
        anomaly_details.append(f"单行超限{exceed_amount}亩")

    # 情况B：户级累计超限（需要season）
    VALID_SEASONS = {"大春", "小春", "全年单补", "临时"}
    if season in VALID_SEASONS and db_c > 0:
        hh_total = round(hh_used + final_subsidy, 4)
        if hh_total > db_c:
            if anomaly_type:
                if "面积超限" not in anomaly_type:
                    anomaly_type = f"{anomaly_type}+面积超限"
            else:
                anomaly_type = "面积超限"
            hh_exceed = round(hh_total - db_c, 4)
            exceed_amount = max(exceed_amount, hh_exceed)
            if f"累计超限{hh_exceed}亩" not in anomaly_details:
                anomaly_details.append(f"累计超限{hh_exceed}亩")

    return {
        "anomaly_type": anomaly_type,
        "anomaly_details": anomaly_details,
        "exceed_amount": exceed_amount,
        "self_occupy": self_occupy,
        "hh_total": hh_total,
        "final_subsidy": final_subsidy,
    }
