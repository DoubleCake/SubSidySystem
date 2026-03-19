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
