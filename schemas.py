from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


# ───────────── 村 / 组 ─────────────
class VillageOut(BaseModel):
    id: int
    village_name: str

    class Config:
        from_attributes = True


class GroupOut(BaseModel):
    id: int
    village_id: int
    group_no: str
    full_name: str  # village_name + group_no，计算字段

    class Config:
        from_attributes = True


# ───────────── 家庭户 ─────────────
class HouseholdCreate(BaseModel):
    household_name: str
    village_id: int       # 村 FK
    group_no: int         # 组号数字：1=一组，2=二组
    address: Optional[str] = None
    land_area: Optional[Decimal] = None
    remark: Optional[str] = None


class HouseholdOut(BaseModel):
    id: int
    household_code: str
    household_name: str
    head_farmer_id: Optional[int]
    village_id: int
    group_no: int         # 组号数字
    address: Optional[str]
    land_area: Optional[Decimal]
    status: int
    member_count: int     # 动态计算，不存库
    remark: Optional[str]

    class Config:
        from_attributes = True


# ───────────── 农户 ─────────────
class FarmerCreate(BaseModel):
    real_name: str
    gender: int                        # 1男 2女
    id_card: str
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    village_id: Optional[int] = None    # 村 FK（优先用）
    village_name: Optional[str] = None  # 也可传 village_name，由后端解析为 id
    group_no: Optional[int] = None      # 组号数字：1=一组，2=二组
    group_no_str: Optional[str] = None  # 也可传 "一组" 字符串
    address: Optional[str] = None
    land_area: Optional[Decimal] = None
    farmer_status: int = 1
    remark: Optional[str] = None

class FarmerUpdate(BaseModel):
    real_name: Optional[str] = None
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    village_id: Optional[int] = None
    group_no: Optional[int] = None
    address: Optional[str] = None
    land_area: Optional[Decimal] = None
    farmer_status: Optional[int] = None
    remark: Optional[str] = None

class FarmerOut(BaseModel):
    id: int
    household_id: int
    real_name: str
    gender: int
    id_card_masked: str                # 脱敏后身份证
    phone_masked: Optional[str]        # 脱敏后手机
    bank_card_masked: Optional[str]    # 脱敏后银行卡
    bank_name: Optional[str]
    is_head: int                     # 动态计算：household.head_farmer_id == id
    relation: Optional[str]
    farmer_status: int
    village_full_name: str             # 冗余展示用
    land_area: Optional[Decimal]
    address: Optional[str]
    remark: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

class FarmerDetail(FarmerOut):
    """详情接口，额外返回完整字段（权限控制后可开放）"""
    id_card: str
    phone: Optional[str]
    bank_card: Optional[str]


# ───────────── 补贴类型 ─────────────
class SubsidyTypeCreate(BaseModel):
    subsidy_name: str
    subsidy_year: int
    calc_mode: str = "fixed"
    standard_amount: Optional[Decimal] = None
    standard_unit: Optional[str] = None
    fund_source: Optional[str] = None
    category: Optional[str] = None
    apply_deadline: Optional[date] = None
    description: Optional[str] = None
    pay_status: Optional[int] = 0
    count_toward_area: Optional[int] = 1

class SubsidyTypeOut(BaseModel):
    id: int
    subsidy_name: str
    subsidy_year: int
    standard_amount: Optional[Decimal]
    standard_unit: Optional[str]
    fund_source: Optional[str]
    category: Optional[str]
    pay_status: int
    apply_deadline: Optional[date]
    description: Optional[str]

    class Config:
        from_attributes = True


# ───────────── 补贴申请 ─────────────
class ApplicationCreate(BaseModel):
    farmer_id: int
    subsidy_type_id: int
    apply_year: int
    apply_amount: Optional[Decimal] = None
    actual_amount: Optional[Decimal] = None
    apply_area: Optional[Decimal] = None
    contract_area: Optional[Decimal] = None
    trust_area: Optional[Decimal] = None
    no_subsidy_area: Optional[Decimal] = None
    pay_status: int = 0
    pay_date: Optional[date] = None
    remark: Optional[str] = None

class ApplicationUpdate(BaseModel):
    actual_amount: Optional[Decimal] = None
    apply_area: Optional[Decimal] = None
    contract_area: Optional[Decimal] = None
    trust_area: Optional[Decimal] = None
    no_subsidy_area: Optional[Decimal] = None
    pay_status: Optional[int] = None
    pay_date: Optional[date] = None
    remark: Optional[str] = None

class ApplicationOut(BaseModel):
    id: int
    farmer_id: int
    farmer_name: str
    subsidy_type_id: int
    subsidy_name: str
    apply_year: int
    apply_amount: Optional[Decimal]
    actual_amount: Optional[Decimal]
    apply_area: Optional[Decimal]
    contract_area: Optional[Decimal] = None
    trust_area: Optional[Decimal] = None
    no_subsidy_area: Optional[Decimal] = None
    pay_status: int
    pay_date: Optional[date]
    remark: Optional[str]

    class Config:
        from_attributes = True


# ───────────── 补贴发放 ─────────────
class PaymentCreate(BaseModel):
    farmer_id: int
    subsidy_type_id: int
    payment_year: int
    amount: Optional[Decimal] = None
    payment_date: Optional[date] = None
    apply_area: Optional[Decimal] = None
    contract_area: Optional[Decimal] = None
    trust_area: Optional[Decimal] = None
    no_subsidy_area: Optional[Decimal] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    remark: Optional[str] = None


class PaymentOut(BaseModel):
    id: int
    farmer_id: int
    farmer_name: str
    subsidy_type_id: int
    subsidy_name: str
    payment_year: int
    amount: Optional[Decimal]
    payment_date: Optional[date]
    bank_card_masked: Optional[str]
    bank_name: Optional[str]
    remark: Optional[str]

    class Config:
        from_attributes = True


# ───────────── 年度汇总 ─────────────
class YearSummary(BaseModel):
    year: int
    total_amount: float
    farmer_count: int
    application_count: int

class YearCompare(BaseModel):
    current_year: YearSummary
    last_year: YearSummary
    new_farmers: list[dict]     # 今年有、去年没有
    exit_farmers: list[dict]    # 去年有、今年没有
    amount_diff: float
    amount_diff_pct: Optional[float]


# ───────────── AI 分析 ─────────────
class AIAnalyzeRequest(BaseModel):
    year: int
    village_name: Optional[str] = None   # 为空则分析全部
    question: Optional[str] = "请分析本年度补贴发放情况，指出异常并与上年对比"

class AIAnalyzeResponse(BaseModel):
    result: str
    data_preview: dict   # 发给AI的脱敏数据预览


# ───────────── 错误库 ─────────────
class ErrorLibraryCreate(BaseModel):
    real_name: str
    id_card: str
    error_type: str
    error_reason: str
    source: str = "手动录入"
    village_name: Optional[str] = None
    group_no: Optional[str] = None
    subsidy_name: Optional[str] = None
    discovered_date: Optional[str] = None
    subsidy_type_id: Optional[int] = None
    remark: Optional[str] = None

class ErrorLibraryOut(ErrorLibraryCreate):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
