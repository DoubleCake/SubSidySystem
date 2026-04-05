export interface VillageGroup {
  id: number
  village_id: number
  village_name: string
  group_no: number
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
  contract_area: string | null
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
  village_id?: number
  village_name?: string
  group_no?: number
  group_no_str?: string
  address?: string
  contract_area?: number
  farmer_status: number
  remark?: string
}

export interface FarmerDetail {
  id: number; real_name: string; gender: number; farmer_status: number
  is_head: number; relation: string | null
  id_card_masked: string; phone_masked: string | null; bank_card_masked: string | null
  bank_name: string | null; village_full_name: string; contract_area: string | null
  address: string | null; remark: string | null; created_at: string | null
  household_id: number; birth_date?: string
  id_card?: string; phone?: string; bank_card?: string
  applications?: { id: number; apply_year: number; subsidy_name: string; calc_mode: string; apply_amount: string | null; actual_amount: string | null; apply_area: string | null; pay_status: number; pay_date: string | null; remark: string | null }[]
}

export interface SubsidyType {
  id: number
  subsidy_name: string
  subsidy_year: number
  season: string | null
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
  phone?: string | null
  village?: string
  group_no?: string
  subsidy_type_id: number
  subsidy_name: string
  calc_mode?: string
  apply_year: number
  apply_area: string | null
  contract_area: string | null
  trust_area: string | null
  no_subsidy_area: string | null
  apply_amount: string | null
  actual_amount: string | null
  pay_status: number
  pay_date: string | null
  remark: string | null
  proxy_remark?: string | null
  is_proxy?: number
}

export interface PaymentOut {
  id: number
  farmer_id: number
  farmer_name: string
  subsidy_type_id: number
  subsidy_name: string
  payment_year: number
  amount: string | null
  payment_date: string | null
  bank_card_masked: string | null
  bank_name: string | null
  remark: string | null
  proxy_remark: string | null
  is_proxy?: number
  pay_status?: number
}

export interface PaymentCreate {
  farmer_id: number
  subsidy_type_id: number
  payment_year: number
  amount?: number
  payment_date?: string
  apply_area?: number
  contract_area?: number
  trust_area?: number
  no_subsidy_area?: number
  bank_card?: string
  bank_name?: string
  remark?: string
  proxy_remark?: string
}

// 代领关系相关
export interface SubsidyProxyOut {
  id: number
  application_id?: number
  payment_id?: number
  beneficiary_farmer_id: number
  proxy_farmer_id: number
  proxy_type: string
  remark?: string
  created_at: string
  updated_at: string
  beneficiary_farmer_name?: string
  proxy_farmer_name?: string
}

export interface SubsidyProxyCreate {
  application_id?: number
  payment_id?: number
  subsidy_type_id?: number
  beneficiary_farmer_id: number
  proxy_farmer_id: number
  proxy_type: string
  remark?: string
}

// ApplicationSearchResult 扩展 is_proxy 字段
export interface ApplicationSearchResult {
  id: number
  farmer_id: number
  farmer_name: string
  id_card_masked?: string
  phone?: string | null
  village?: string
  group_no?: string
  subsidy_type_id: number
  subsidy_name: string
  calc_mode?: string
  apply_year: number
  apply_area: string | null
  contract_area: string | null
  trust_area: string | null
  no_subsidy_area: string | null
  apply_amount: string | null
  actual_amount: string | null
  pay_status: number
  pay_date: string | null
  remark: string | null
  proxy_remark?: string | null
  is_proxy?: number
}

export interface ApplicationCreate {
  farmer_id: number
  subsidy_type_id: number
  apply_year: number
  apply_amount?: number
  actual_amount?: number
  apply_area?: number
  contract_area?: number
  trust_area?: number
  no_subsidy_area?: number
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

// ── 错误库 ──
export interface ErrorLibraryItem {
  id: number
  real_name: string
  id_card: string
  error_type: string
  error_reason: string
  source: string
  village_name: string | null
  group_no: string | null
  subsidy_name: string | null
  discovered_date: string | null
  subsidy_type_id: number | null
  remark: string | null
  created_at: string | null
}

export interface ErrorLibraryCreate {
  real_name: string
  id_card: string
  error_type: string
  error_reason: string
  source?: string
  village_name?: string
  group_no?: string
  subsidy_name?: string
  discovered_date?: string
  subsidy_type_id?: number
  remark?: string
}

// ── 家庭户 ──
export interface SeasonUsage {
  used_area: number; remaining_area: number
  is_overdrawn: boolean; overdraw_amount: number
  subsidies: { subsidy_name: string; apply_year: number; used_area: number; total_amount: number; app_count: number }[]
}

export interface HH {
  id: number; household_code: string; household_name: string
  village_full_name: string; village_name: string; head_name: string
  contracted_area: number; confirmed_area?: number | null
  trust_out_area?: number; trust_in_area?: number; cultivable_area?: number
  used_area: number; remaining_area: number
  is_overdrawn: boolean; overdraw_amount: number
  season_breakdown?: Record<string, SeasonUsage>
  member_count: number; status: number; address: string | null; remark: string | null
  is_manually_confirmed: number
  manually_confirmed_at: string | null
  manually_confirmed_by: string | null
}

export interface HHMember {
  id: number; real_name: string; gender: number; id_card_masked: string
  is_head: number; relation: string | null; farmer_status: number; phone_masked?: string | null
  own_village_id?: number | null; own_group_no?: number | null
  village_full_name?: string
}

export interface HHDetail {
  id: number; household_code: string; household_name: string
  village_full_name: string; village_id: number; group_no: number
  contracted_area: number; confirmed_area?: number | null; status: number
  address: string | null; remark: string | null
  is_manually_confirmed: number
  manually_confirmed_at: string | null
  manually_confirmed_by: string | null
  members: HHMember[]
  area_usage: {
    contracted_area: number; trust_out_area?: number; trust_in_area?: number
    cultivable_area?: number; used_area: number; remaining_area: number
    is_overdrawn: boolean; overdraw_amount?: number; has_trust_data?: boolean
    season_breakdown?: Record<string, SeasonUsage>
    subsidy_breakdown: { subsidy_name: string; apply_area: number; calc_mode: string }[]
    year_totals?: Record<string, Record<string, number>>
  }
  app_summary: {
    apply_year: number; farmer_name: string; subsidy_name: string
    calc_mode: string; apply_area: number | null; actual_amount: number | null; pay_status: number
  }[]
}

export interface HHEvent {
  id: number; event_type: string; event_year: number; event_date: string | null
  date_accuracy: string; description: string
  farmer_id: number | null; farmer_name: string | null
  related_hh_id: number | null; evidence_type: string | null; evidence_note: string | null
  operator: string | null; created_at: string
  before_snapshot: unknown; after_snapshot: unknown
  undoable: boolean
}

export interface HistoryDateEvent {
  date: string; event_type: string; description: string
  event_id: number; event_year: number
}

export interface SnapshotMember {
  id: number
  real_name: string
  gender: number
  id_card_masked: string
  is_head: number
  relation: string | null
  farmer_status: number
  phone_masked?: string | null
  id_card?: string
  phone?: string
  bank_card?: string
  bank_name?: string
  remark?: string
  created_at?: string | null
  household_id?: number
}

export interface SnapshotAtResponse {
  target_date: string
  snapshot: {
    household_name: string; household_code: string
    contract_area: number; status: number
    address: string | null; remark: string | null
    head_id: number | null
    members: SnapshotMember[]
    app_summary?: Array<{
      apply_year: number; farmer_name: string; subsidy_name: string
      calc_mode: string; apply_area: number | null; actual_amount: number | null; pay_status: number
    }>
    area_usage?: {
      contracted_area: number; used_area: number; remaining_area: number
      is_overdrawn: boolean; overdraw_amount?: number
      subsidy_breakdown: Array<{ subsidy_name: string; apply_area: number; calc_mode: string }>
    }
  } | null
  events: Array<{
    id: number
    event_type: string
    event_date: string | null
    description: string
    farmer_name: string | null
  }>
}

export interface HouseholdCreate {
  household_name: string
  village_group_id: number
  village_id?: number
  group_no?: number
  address?: string
  contract_area?: number
  remark?: string
}

export interface MemberCreate {
  real_name: string
  id_card: string
  gender?: number
  phone?: string
  bank_card?: string
  bank_name?: string
  relation?: string
  is_head?: number
  farmer_status?: number
  remark?: string
}

export interface MemberUpdate {
  real_name?: string
  phone?: string
  bank_card?: string
  bank_name?: string
  relation?: string
  is_head?: number
  farmer_status?: number
  remark?: string
  event_date?: string
  village_id?: number
  group_no?: number
}

export interface MemberMoveRequest {
  farmer_id: number
  target_household_id: number
}

export interface HouseholdBuildRow {
  household_id: string
  id_card: string
  real_name?: string
  is_head?: number
  relation?: string
  contract_area?: number
}

// ── 预检结果 ──
export interface CheckResult {
  summary: {
    total_rows: number
    ok_rows: number
    error_rows: number
    format_errors: number
    village_errors: number
    duplicate_errors: number
    gender_mismatch: number
    error_library_hits: number
    area_anomalies: number
    area_missing: number
    age_anomaly: number
    deceased_farmers: number
    household_duplicates: number
    new_farmers: number
    removed_farmers: number
    changed_farmers: number
    pass_rate: number
  }
  format_errors: Array<{ row: number; name: string; id_card: string; village: string; group: string; errors: string[]; error_count: number }>
  village_errors: Array<{ row: number; name: string; id_card: string; village: string; group: string; error: string }>
  duplicate_errors: Array<{ row: number; name: string; id_card: string; village: string; group: string; error: string }>
  gender_mismatch: Array<{ row: number; name: string; id_card: string; village: string; group: string; excel_gender: string; id_card_gender: string; error: string }>
  error_library_hits: Array<{ row: number; name: string; id_card: string; village: string; group: string; error_type: string; error_reason: string; source: string }>
  area_anomalies: Array<{ row: number; name: string; id_card: string; village: string; group: string; anomaly_type: string; anomaly_details: string; contract_area: number; trust_out_area: number; trust_in_area: number; no_subsidy_area: number; actual_subsidy_area: number; self_occupy: number; hh_used: number; hh_total: number; db_contract_area: number; exceed_amount: number }>
  area_missing: Array<{ row: number; name: string; id_card: string; village: string; group: string; contract_area: number; error: string }>
  age_anomaly: Array<{ row: number; name: string; id_card: string; village: string; group: string; age: number; birth_year: number; error: string }>
  deceased_farmers: Array<{ row: number; name: string; id_card: string; village: string; group: string; error: string }>
  household_duplicates: Array<{ row: number; name: string; id_card: string; household_id: number; other_members: string[]; error: string }>
  new_farmers: Array<{ row: number; name: string; id_card: string; village: string; group: string; village_group_id: number | null }>
  removed_farmers: Array<{ id_card: string; name: string; village: string; group: string; farmer_id: number; note: string }>
  changed_farmers: Array<{ row: number; name: string; id_card: string; village: string; group: string; db_name: string; db_village: string; db_group: string; changes: string[]; farmer_id: number }>
  year_compare: Record<string, unknown>
}
