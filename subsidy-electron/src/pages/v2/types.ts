/** 主体管理 - 跨组件共享的数据类型 */

export interface LargeFarmer {
  id: number; operator_name: string; operator_type: string; operator_type_label: string
  id_card: string | null; phone: string | null; village_id: number; village_name: string
  group_no: number | null; address: string | null
  total_managed_area: number | null; own_contract_area: number | null; trust_in_area: number | null
  /** 扩展字段（迁移新增，老数据为空） */
  legal_person?: string | null
  contact_person?: string | null
  public_account?: string | null
  public_bank?: string | null
  doc_folder?: string | null
}

export interface LargeFarmerTrust {
  id: number; owner_household_name: string; owner_household_code: string
  trust_year: number; area: number; trust_type_label: string
  start_date: string | null; end_date: string | null
  /** 流转对手方（可自由填写，后续支持导入） */
  trust_type?: string
  counterparty_type?: string
  counterparty_name?: string
  counterparty_village?: string
  counterparty_group?: string
  trust_days?: number | null
  planted_area?: number | null
  own_area?: number | null
  crop_type?: string | null
}

export interface VillageRow {
  id: number; village_name: string
  leader_name?: string | null; leader_phone?: string | null
}

export interface VillageDetail {
  id: number; village_name: string
  leader_name?: string; leader_phone?: string
  groups?: { id: number; group_no: number; leader_name?: string | null }[]
  contacts?: { id: number; leader_name: string; leader_phone: string; start_year: number; end_year: number | null }[]
}

export const OPERATOR_LABEL: Record<string, string> = {
  FAMILY_FARM: '家庭农场', COOPERATIVE: '合作社', LARGE_PLANTER: '种植大户', OTHER: '其他',
}
