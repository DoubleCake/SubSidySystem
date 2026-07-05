/**
 * 户籍管理页常量
 */
import { FARMER_STATUS, PAY_STATUS } from '../utils'

export { FARMER_STATUS, PAY_STATUS }

// ── 样式常量 ──
export const COLORS = {
  primary: {
    50: 'bg-emerald-50',
    100: 'bg-emerald-100',
    500: 'bg-emerald-500',
    600: 'bg-emerald-600',
    700: 'bg-emerald-700',
    text: 'text-emerald-600',
    textHover: 'hover:text-emerald-700',
    border: 'border-emerald-600',
    borderLight: 'border-emerald-200',
  },
  secondary: {
    50: 'bg-blue-50',
    500: 'bg-blue-500',
    600: 'bg-blue-600',
    text: 'text-blue-600',
    border: 'border-blue-600',
    borderLight: 'border-blue-200',
  },
  warning: {
    50: 'bg-amber-50',
    100: 'bg-amber-100',
    500: 'bg-amber-500',
    text: 'text-amber-600',
  },
  danger: {
    50: 'bg-red-50',
    500: 'bg-red-500',
    text: 'text-red-600',
    borderLight: 'border-red-200',
  },
  neutral: {
    50: 'bg-slate-50',
    100: 'bg-slate-100',
    200: 'bg-slate-200',
    text: 'text-slate-600',
    textMuted: 'text-slate-400',
    border: 'border-slate-200',
  }
}

// ── 事件类型配置 ──
export const EVENT_TYPE_CFG: Record<string, { label: string; color: string; icon: string }> = {
  ORIGINAL:       { label: '原始数据',   color: 'bg-slate-100 text-slate-600',     icon: '📌' },
  FOUND:          { label: '建档登记',   color: 'bg-blue-100 text-blue-700',       icon: '📝' },
  MEMBER_ADD:     { label: '成员新增',   color: 'bg-emerald-100 text-emerald-700', icon: '➕' },
  MEMBER_REMOVE:  { label: '成员移出',   color: 'bg-amber-100 text-amber-700',     icon: '➖' },
  MEMBER_STATUS:  { label: '状态变更',   color: 'bg-slate-100 text-slate-600',     icon: '🔄' },
  HEAD_CHANGE:    { label: '户主变更',   color: 'bg-purple-100 text-purple-700',   icon: '👤' },
  SPLIT:          { label: '分户',       color: 'bg-orange-100 text-orange-700',   icon: '🔀' },
  MERGE:          { label: '合户',       color: 'bg-teal-100 text-teal-700',       icon: '🔗' },
  LAND_CHANGE:    { label: '土地变更',   color: 'bg-green-100 text-green-700',     icon: '🌾' },
  STATUS_CHANGE:  { label: '户籍变更',   color: 'bg-red-100 text-red-700',         icon: '📋' },
  VILLAGE_CHANGE: { label: '整户迁移',   color: 'bg-cyan-100 text-cyan-700',       icon: '🏠' },
  MANUAL_CONFIRM: { label: '人工确认',   color: 'bg-blue-100 text-blue-700',       icon: '✅' },
  REMARK:         { label: '备注说明',   color: 'bg-slate-100 text-slate-500',     icon: '💬' },
}

export const GENDER = (g: number) => g === 1 ? '男' : '女'

export const calcAge = (birth?: string | null) => {
  if (!birth) return null
  const b = new Date(birth)
  const now = new Date()
  return now.getFullYear() - b.getFullYear() - (now < new Date(now.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
}

// ── 农户导入模板 ──
export const FARMER_TEMPLATE_HEADERS = ['姓名*', '身份证号*', '所在村*', '所在组*', '手机号', '银行卡号', '开户行', '地址', '承包土地面积', '状态']
export const FARMER_TEMPLATE_EXAMPLE = [
  { '姓名*': '张国强', '身份证号*': '510123196503154231', '所在村*': '红星村', '所在组*': '一组', '手机号': '13812340001', '银行卡号': '6222021234560001', '开户行': '农业银行红星支行', '地址': '红星村一组12号', '承包土地面积': 3.5, '状态': '在册' },
]

export const FARMER_SYSTEM_FIELDS = [
  { field: 'real_name',     label: '姓名',     required: true,  type: 'string' },
  { field: 'id_card',       label: '身份证号', required: true,  type: 'id_card' },
  { field: 'village_name',  label: '所在村',   required: true,  type: 'string' },
  { field: 'group_no',      label: '所在组',   required: true,  type: 'string' },
  { field: 'phone',         label: '手机号',   required: false, type: 'phone' },
  { field: 'bank_card',     label: '银行卡号', required: false, type: 'string' },
  { field: 'bank_name',     label: '开户行',   required: false, type: 'string' },
  { field: 'address',       label: '地址',     required: false, type: 'string' },
  { field: 'land_area',     label: '承包土地面积', required: false, type: 'decimal' },
  { field: 'farmer_status', label: '状态',     required: false, type: 'status' },
]

// ── 成员导入列名映射 ──
export const MEMBER_IMPORT_ALIAS: Record<string, string> = {
  '身份证号*': 'id_card', '身份证号': 'id_card',
  '姓名*': 'real_name', '姓名': 'real_name',
  '是否户主': 'is_head',
  '与户主关系': 'relation',
  '手机号': 'phone',
  '银行卡号': 'bank_card',
  '开户行': 'bank_name',
  '状态': 'farmer_status',
}
