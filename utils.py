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


# ───────────── 村组解析 ─────────────
def resolve_village_group(db, village_name: str, group_no: str):
    """根据村名+组号查找或创建村组，返回 (VillageGroup | None, error_msg | None)"""
    from models import VillageGroup
    if not village_name or not group_no:
        return None, "缺少村组信息"
    group_no = normalize_group_no(group_no)
    vg = db.query(VillageGroup).filter_by(village_name=village_name, group_no=group_no).first()
    if not vg:
        # 尝试模糊匹配
        vg = db.query(VillageGroup).filter(
            VillageGroup.village_name.like(f"%{village_name}%"),
            VillageGroup.group_no == group_no,
        ).first()
    if not vg:
        # 自动创建新村组
        vg = VillageGroup(village_name=village_name, group_no=group_no, full_name=f"{village_name}{group_no}")
        db.add(vg)
        db.flush()
    return vg, None
