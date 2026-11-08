/**
 * 主体管理 - 编辑操作支撑
 *
 * 集中放各弹窗的初始状态与提交逻辑，避免主页面继续膨胀。
 */
import * as api from '../../api'
import type { HHDetail, HHMember, VillageGroup } from '../../types'

export const emptyMemberForm = {
  real_name: '',
  id_card: '',
  gender: '1',
  relation: '成员',
  is_head: false,
  phone: '',
  bank_card: '',
  bank_name: '',
  farmer_status: '1',
  restricted_identity: '0',
  event_date: '',
  village_id: 0,
  group_no: 1,
  village_name: '',
  group_name: '',
}

export type MemberFormState = typeof emptyMemberForm

export const emptySplitForm = {
  household_name: '',
  split_year: String(new Date().getFullYear()),
  split_date: '',
  new_land_area: '',
  origin_land_area: '',
  description: '',
  evidence_type: '',
  evidence_note: '',
}

export type SplitFormState = typeof emptySplitForm

/** 由家庭户详情生成编辑表单初值 */
export function buildEditForm(detail: HHDetail) {
  return {
    household_name: detail.household_name || '',
    contract_area: detail.contracted_area != null ? String(detail.contracted_area) : '',
    village_id: detail.village_id,
    group_no: detail.group_no,
    address: detail.address || '',
    remark: detail.remark || '',
  }
}

/** 提交家庭户编辑 */
export async function submitEditHousehold(
  householdId: number,
  form: { household_name: string; contract_area: string; village_id: number; group_no: number; address: string; remark: string }
) {
  await api.updateHousehold(householdId, {
    household_name: form.household_name.trim(),
    contract_area: form.contract_area ? Number(form.contract_area) : 0,
    village_id: form.village_id,
    group_no: form.group_no,
    address: form.address || undefined,
    remark: form.remark || undefined,
  } as never)
}

/** 提交成员新增 / 编辑 */
export async function submitMember(
  householdId: number,
  target: HHMember | null,
  form: MemberFormState
) {
  if (!form.real_name.trim()) throw new Error('请填写姓名')
  if (!target && !form.id_card.trim()) throw new Error('请填写身份证号')

  const base: Record<string, unknown> = {
    real_name: form.real_name.trim(),
    relation: form.relation || undefined,
    is_head: form.is_head ? 1 : 0,
    phone: form.phone || undefined,
    bank_card: form.bank_card || undefined,
    bank_name: form.bank_name || undefined,
    farmer_status: Number(form.farmer_status),
    restricted_identity: Number(form.restricted_identity) || 0,
    event_date: form.event_date || undefined,
    village_id: form.village_id || undefined,
    group_no: form.group_no || undefined,
  }
  if (!target) base.id_card = form.id_card.trim()

  if (target) await api.updateHouseholdMember(householdId, target.id, base as never)
  else await api.addHouseholdMember(householdId, base as never)
}

/** 手动确认 / 取消确认 */
export async function submitConfirm(
  householdId: number,
  type: 'manual_confirm' | 'cancel_confirm',
  form: { operator: string; remark: string }
) {
  const data = { operator: form.operator || undefined, remark: form.remark || undefined }
  return type === 'manual_confirm'
    ? api.manualConfirmHousehold(householdId, data)
    : api.cancelManualConfirm(householdId, data)
}

/** 分户提交 */
export async function submitSplit(
  householdId: number,
  selected: number[],
  newHead: number | null,
  form: SplitFormState
) {
  if (selected.length === 0) throw new Error('请选择要分出的成员')
  if (newHead == null) throw new Error('请指定新户户主')
  return api.splitHousehold(householdId, {
    member_ids: selected,
    new_head_member_id: newHead,
    household_name: form.household_name,
    split_year: Number(form.split_year) || new Date().getFullYear(),
    split_date: form.split_date || undefined,
    new_land_area: form.new_land_area ? Number(form.new_land_area) : undefined,
    origin_land_area: form.origin_land_area ? Number(form.origin_land_area) : undefined,
    description: form.description || undefined,
    evidence_type: form.evidence_type || undefined,
    evidence_note: form.evidence_note || undefined,
  })
}

/** 合户（把 source 并入 target） */
export async function submitMerge(sourceId: number, targetId: number, operator?: string) {
  return api.mergeHouseholds({ source_household_id: sourceId, target_household_id: targetId, operator })
}

/** 移出成员 */
export async function submitRemoveMember(householdId: number, farmerId: number) {
  return api.removeHouseholdMember(householdId, farmerId)
}

/** 删除家庭户 */
export async function submitDeleteHousehold(householdId: number) {
  return api.deleteHousehold(householdId)
}

/** 新建农户 */
export async function submitCreateFarmer(form: {
  real_name: string; id_card: string; gender: 1 | 2; phone: string
  village_name: string; group_no: string; address: string; contract_area: string; remark: string
}, villages: VillageGroup[]) {
  if (!form.real_name.trim()) throw new Error('请填写姓名')
  if (!form.id_card.trim()) throw new Error('请填写身份证号')
  const g = villages.find(v => v.village_name === form.village_name)
  return api.createFarmer({
    real_name: form.real_name.trim(),
    id_card: form.id_card.trim(),
    gender: form.gender,
    phone: form.phone || undefined,
    village_id: g?.village_id,
    village_name: form.village_name || undefined,
    group_no: form.group_no ? Number(form.group_no.replace(/[^0-9]/g, '')) : undefined,
    address: form.address || undefined,
    contract_area: form.contract_area ? Number(form.contract_area) : undefined,
    farmer_status: 1,
    remark: form.remark || undefined,
  })
}

/** 编辑农户 */
export async function submitUpdateFarmer(id: number, form: {
  real_name: string; phone: string; address: string; remark: string; farmer_status: number
}, villages: VillageGroup[], villageName: string, groupNo: string) {
  const g = villages.find(v => v.village_name === villageName)
  return api.updateFarmer(id, {
    real_name: form.real_name.trim(),
    phone: form.phone || undefined,
    address: form.address || undefined,
    remark: form.remark || undefined,
    farmer_status: form.farmer_status,
    village_id: g?.village_id,
    group_no: groupNo ? Number(groupNo.replace(/[^0-9]/g, '')) : undefined,
  } as never)
}
