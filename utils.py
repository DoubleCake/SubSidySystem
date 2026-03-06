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
