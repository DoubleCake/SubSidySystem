export interface VillageGroup {
  id: number
  village_name: string
  group_no: string
  full_name: string
}

export interface FarmerOut {
  id: number
  household_id: number
  real_name: string
  gender: number
  id_card_masked: string
  phone_masked: string | null
  bank_card_masked: string | null
  bank_name: string | null
  is_head: number
  relation: string | null
  farmer_status: number
  village_full_name: string
  land_area: string | null
  address: string | null
  remark: string | null
  created_at: string | null
  // detail only
  id_card?: string
  phone?: string
  bank_card?: string
}

export interface FarmerCreate {
  real_name: string
  gender: number
  id_card: string
  phone?: string
  bank_card?: string
  bank_name?: string
  village_group_id: number
  address?: string
  land_area?: number
  farmer_status: number
  remark?: string
}

export interface SubsidyType {
  id: number
  subsidy_name: string
  subsidy_year: number
  calc_mode: 'fixed' | 'per_mu'   // fixed=固定金额  per_mu=按亩
  standard_amount: string | null   // fixed模式: 每户/人金额; per_mu模式: 每亩金额
  standard_unit: string | null
  fund_source: string | null
  category: string | null
  apply_deadline: string | null
  pay_status: number
  description: string | null
}

export interface SubsidyTypeCreate {
  subsidy_name: string
  subsidy_year: number
  calc_mode: 'fixed' | 'per_mu'
  standard_amount?: number
  standard_unit?: string
  fund_source?: string
  category?: string
  apply_deadline?: string
  description?: string
  pay_status?: number
  count_toward_area?: number  // 1=累计入家庭承包面积 0=不计入
}

export interface ApplicationOut {
  id: number
  farmer_id: number
  farmer_name: string
  village?: string
  subsidy_type_id: number
  subsidy_name: string
  calc_mode?: 'fixed' | 'per_mu'
  apply_year: number
  apply_amount: string | null
  actual_amount: string | null
  apply_area: string | null
  pay_status: number
  pay_date: string | null
  remark: string | null
}

// 用于预检的扩展应用接口
export interface ApplicationForPrecheck {
  id: number
  farmer_id: number
  farmer_name: string
  village?: string
  subsidy_type_id: number
  subsidy_name: string
  calc_mode?: 'fixed' | 'per_mu'
  apply_year: number
  apply_amount: string | null
  actual_amount: string | null
  apply_area: string | null
  pay_status: number
  pay_date: string | null
  remark: string | null
  // 预检特定字段
  id_card_masked?: string
  id_card?: string
  real_name?: string // 对应 API 返回的 farmer_name
  village_full_name?: string // 对应 API 返回的 village
  group_no?: string
}

// API搜索返回的应用程序类型（独立接口，不继承ApplicationOut）
export interface ApplicationSearchResult {
  id: number
  farmer_id: number
  farmer_name: string
  id_card_masked?: string
  village?: string
  subsidy_type_id: number
  subsidy_name: string
  calc_mode?: string
  apply_year: number
  apply_area: string | null
  apply_amount: string | null
  actual_amount: string | null
  pay_status: number
  pay_date: string | null
  remark: string | null
}

export interface ApplicationCreate {
  farmer_id: number
  subsidy_type_id: number
  apply_year: number
  apply_amount?: number
  actual_amount?: number
  apply_area?: number
  pay_status: number
  pay_date?: string
  remark?: string
}

export interface PageResult<T> {
  total: number
  page: number
  page_size: number
  items: T[]
}

export interface YearCompare {
  current_year: { year: number; total_amount: number; farmer_count: number; application_count: number }
  last_year:    { year: number; total_amount: number; farmer_count: number; application_count: number }
  new_farmers:  { id: number; name: string; village: string; status: number }[]
  exit_farmers: { id: number; name: string; village: string; status: number }[]
  amount_diff: number
  amount_diff_pct: number | null
}

export interface VillageSummary {
  village_name: string
  beneficiaries: number
  total_amount: number
  application_count: number
}

// Excel 导入行
export interface ExcelFarmerRow {
  姓名: string
  身份证号: string
  手机号?: string
  性别?: string
  所在村?: string
  所在组?: string
  银行卡号?: string
  开户行?: string
  地址?: string
  土地面积?: number | string
  状态?: string
  [key: string]: unknown
}

// ── 资格规则 ──
export interface EligibilityRule {
  id: number; subsidy_type_id: number; rule_name: string; rule_desc: string | null
  require_farmer_status: number | null
  require_age_min: number | null; require_age_max: number | null
  require_land_type: string | null
  require_min_area: number | null; require_max_area: number | null
  require_not_idle: number; require_contract_valid: number
  can_combine_with_others: number; exclusive_with: number[]
  is_active: number
}

// ── Excel模板 ──
export interface ColumnMappingItem {
  excel_column: string; system_field: string | null
  aliases?: string[]; required?: boolean; transform?: string
}
export interface ExcelColumnTemplate {
  id: number; template_name: string; template_year: number | null
  region_name: string | null; business_type: string; subsidy_type_id: number | null
  column_mapping: ColumnMappingItem[]; skip_rules: unknown[]; value_mapping: Record<string, unknown>
  use_count: number; last_used_at: string | null
}
