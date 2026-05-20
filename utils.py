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
    ignore_trust_in: bool = True,
    farmland_protection_area: float | None = None,
    household_trust_in: float = 0,
) -> dict:
    """
    统一面积异常检查

    两种超限场景：
    情况A — 单行超限：本行申报面积(self_occupy) > 有效承包面积(承包面积 - 流转出)
    情况B — 户级累计超限：全户当季累计申报面积(hh_used + 本行) > 参考上限(reference_area)
              大春/小春 → (耕地地力保护补贴面积 or 承包面积) - 流转出 + 家庭户代耕代种进
              全年单补/临时 → 承包面积 - 流转出

    参考上限已与家庭户详情页对齐（cultivable = 承包 - 转出 + 转入）。

    Args:
        excel_contract_area: Excel填报的承包面积
        db_contract_area: 数据库中的承包面积
        apply_area: Excel填报的申请面积
        excel_trust_out: 流转出面积（从 land_trust 表汇总，减少可耕种能力）
        excel_trust_in: 单条申请的代耕代种面积（仅用于 self_occupy 计算）
        excel_no_subsidy: 不补贴面积
        actual_subsidy_area: 实际补贴面积（最终参与计算的面积）
        season: 补贴季节（大春/小春/全年单补/临时，决定累计检查的参考上限）
        hh_used: 户级同季已用面积（排除本行自身后的值，用于情况B累计判断）
        ignore_trust_in: 是否忽略代耕代种进面积（超限检查时）
        farmland_protection_area: 耕地地力保护补贴面积（大春/小春时用作参考上限）
        household_trust_in: 家庭户级别代耕代种进面积（从 land_trust 汇总，仅用于参考面积）
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

    # ── 确定户级累计的参考上限(reference_area) ──
    # 与家庭户详情页 cultivable = 承包 - 转出 + 转入 对齐：
    #   大春/小春 → 耕地地力保护补贴面积(优先)或承包面积(回退) - 流转出 + 代耕代种进
    #   全年单补/临时 → 家庭户的DB承包面积 - 流转出
    #
    # 流转出(excel_trust_out)由调用方从 land_trust 表汇总传入
    # 代耕代种进(excel_trust_in)由调用方传入
    effective_contract = max(0, db_c - excel_trust_out)
    reference_area = effective_contract
    area_source = "承包面积"

    if excel_trust_out > 0:
        area_source += f"-流转出{excel_trust_out}亩"

    if season in ("大春", "小春"):
        # 先确定基准面积（耕地补贴 or 承包），再减去流转出
        base_area = effective_contract
        base_source = area_source
        if farmland_protection_area is not None and farmland_protection_area > 0:
            base_area = max(0, farmland_protection_area - excel_trust_out)
            base_source = "耕地地力保护补贴面积"
            if excel_trust_out > 0:
                base_source += f"-流转出{excel_trust_out}亩"
        elif farmland_protection_area is not None and farmland_protection_area == 0:
            anomaly_details.append(f"该家庭户无耕地地力保护补贴记录，回退使用承包面积{db_c}亩作为参考")
        elif farmland_protection_area is None:
            anomaly_details.append(f"无耕地地力保护补贴数据，使用承包面积{db_c}亩作为参考")

        # 参考上限 = 基准面积 + 家庭户代耕代种进面积（从 land_trust 汇总）
        reference_area = base_area + household_trust_in
        area_source = base_source
        if household_trust_in > 0:
            area_source += f"+代耕代种{household_trust_in}亩"
    # ── 检查一：Excel填报承包面积 vs 数据库承包面积 ──
    #     差异>0.001亩即认为不一致，说明Excel或DB数据可能过时
    #     仅在 excel_contract_area 有值时检查
    if excel_c is not None and abs(excel_c - db_c) > 0.001:
        anomaly_type = "承包面积不一致"
        anomaly_details.append(f"Excel填报{excel_c}亩，数据库登记{db_c}亩")

    # ── 检查二：面积超限 ──
    # ── 第一步：计算"有效补贴面积"(final_subsidy) ──
    #     优先级:
    #       1. actual_subsidy_area（调用方显式传入的实际补贴面积）
    #       2. apply_area（Excel填的申请面积）
    #       3. excel_c - trust_out - no_subsidy（Excel承包面积扣减流转出和不补贴面积）
    #     在 subsidies.py 中传 actual_subsidy_area = apply_area，所以最终等于申请面积
    final_subsidy = 0.0
    if actual_subsidy_area is not None:
        final_subsidy = float(actual_subsidy_area)
    elif apply_area is not None:
        final_subsidy = float(apply_area)
    else:
        final_subsidy = round((excel_c or 0) - excel_trust_out - excel_no_subsidy, 4)

    # ── 第二步：计算"自有占用面积"(self_occupy) ──
    #     不考虑代耕代种进面积(ignore_trust_in=True)时 = final_subsidy
    #     考虑代耕代种进(ignore_trust_in=False)时 = final_subsidy - 代耕代种进面积
    if ignore_trust_in:
        self_occupy = round(final_subsidy, 4)
    else:
        self_occupy = round(final_subsidy - excel_trust_in, 4)

    # ── 情况A：单行超限 ──
    #     含义：这一条记录中，农户申报的面积超过了他个人名下的有效承包面积
    #     判断：self_occupy > effective_contract（承包面积 - 流转出）
    #     影响：这种情况比较少见，通常是Excel填错了
    if effective_contract > 0 and self_occupy > effective_contract:
        if anomaly_type:
            anomaly_type = f"{anomaly_type}+面积超限"
        else:
            anomaly_type = "面积超限"
        exceed_amount = round(self_occupy - effective_contract, 4)
        anomaly_details.append(f"单行超限{exceed_amount}亩")

    # ── 情况B：户级累计超限 ──
    #     含义：该农户所在家庭户，当季所有补贴的申报面积加总后超过了参考上限
    #     累计值 = hh_used（DB中该户当季其他记录面积）+ final_subsidy（本行面积）
    #     参考上限(reference_area)：
    #       大春/小春 → (耕地地力保护补贴面积 or 承包面积) - 流转出 + 代耕代种进
    #       全年单补/临时 → 承包面积 - 流转出
    #     ⚠️ 关键区别：情况A是个人超限，情况B是家庭户累计超限
    #     ⚠️ 若 reference_area=0（耕地补贴面积为0或未加载），累计检查跳过
    VALID_SEASONS = {"大春", "小春", "全年单补", "临时"}
    if season in VALID_SEASONS and reference_area > 0:
        hh_total = round(hh_used + final_subsidy, 4)
        if hh_total > reference_area:
            if anomaly_type:
                if "面积超限" not in anomaly_type:
                    anomaly_type = f"{anomaly_type}+面积超限"
            else:
                anomaly_type = "面积超限"
            hh_exceed = round(hh_total - reference_area, 4)
            # exceed_amount 取单行超限和累计超限中的较大值
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
