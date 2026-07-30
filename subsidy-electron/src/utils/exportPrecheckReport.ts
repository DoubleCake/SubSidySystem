/**
 * 预检报告导出工具 — 纯前端生成 Excel，不经过 IPC
 */
import * as XLSX from 'xlsx'
import type { CheckResult } from '../types'

// Sheet 选项配置
export const PRECHECK_SHEET_OPTIONS = [
  { key: 'summary', label: '汇总', hasCount: false },
  { key: 'format_errors', label: '格式错误', hasCount: true },
  { key: 'village_errors', label: '村组不存在', hasCount: true },
  { key: 'duplicate_errors', label: '重复身份证', hasCount: true },
  { key: 'gender_mismatch', label: '性别不符', hasCount: true },
  { key: 'error_library_hits', label: '错误库命中', hasCount: true },
  { key: 'area_anomalies', label: '面积异常', hasCount: true },
  { key: 'area_missing', label: '承包面积缺失', hasCount: true },
  { key: 'age_anomaly', label: '年龄异常', hasCount: true },
  { key: 'deceased_farmers', label: '死亡农户', hasCount: true },
  { key: 'restricted_farmers', label: '受限身份农户', hasCount: true },
  { key: 'household_duplicates', label: '同一家庭多成员申请', hasCount: true },
  { key: 'new_farmers', label: '新增农户', hasCount: true },
  { key: 'removed_farmers', label: '减少农户', hasCount: true },
  { key: 'changed_farmers', label: '字段变更', hasCount: true },
] as const

export type SheetKey = typeof PRECHECK_SHEET_OPTIONS[number]['key']

// 字段名中文翻译
const CN: Record<string, string> = {
  row: '行号', name: '姓名', farmer_name: '姓名', real_name: '姓名',
  id_card: '身份证号', id_card_masked: '身份证号(脱敏)',
  village: '村', group: '组', group_no: '组',
  error: '错误描述', errors: '错误详情', error_message: '错误描述',
  error_type: '错误类型', error_reason: '错误原因', source: '来源',
  anomaly_type: '异常类型', anomaly_details: '异常详情',
  contract_area: '承包面积', trust_out_area: '流出面积',
  trust_in_area: '流入面积', no_subsidy_area: '不计补贴面积',
  actual_subsidy_area: '实际补贴面积', exceed_amount: '超额(亩)',
  reference_area: '参考面积', area_source: '面积来源',
  hh_used: '户已用面积', hh_total: '户总面积',
  db_contract_area: '数据库承包面积', self_occupy: '自用面积',
  age: '年龄', birth_year: '出生年份',
  gender: '性别', excel_gender: 'Excel性别', id_card_gender: '身份证性别',
  household_id: '家庭户ID', total_count: '成员总数',
  other_members: '其他成员', excel_remark: 'Excel备注',
  db_existing_apps: '已有申请',
  note: '备注', changes: '变更内容', farmer_id: '农户ID',
  deceased_farmers: '死亡农户', restricted_farmers: '受限身份农户',
  existing_apps: '已有申请', death_date: '死亡日期',
  village_group_id: '村组ID', db_name: '数据库姓名',
  db_village: '数据库村', db_group: '数据库组',
}

function t(key: string) { return CN[key] || key }

/** 展平值：数组 → 字符串，对象 → JSON */
function flat(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join('；')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 从数组中收集所有 key 作为表头 */
function collectKeys(arr: Record<string, unknown>[]): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const item of arr) {
    for (const k of Object.keys(item)) {
      if (!seen.has(k)) { seen.add(k); keys.push(k) }
    }
  }
  return keys
}

/** 触发浏览器下载 Blob */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * 生成预检报告 Excel 并下载
 * @param result 预检结果对象
 * @param options 导出选项
 * @param fileName 文件名前缀
 */
export function exportPrecheckReportWithOptions(
  result: CheckResult,
  options: { splitByVillage: boolean; selectedSheets: SheetKey[] },
  fileName = '预检查报告',
) {
  const { splitByVillage, selectedSheets } = options
  if (!result) { alert('没有可导出的预检数据'); return }

  const wb = XLSX.utils.book_new()
  const dateStr = new Date().toISOString().slice(0, 10)

  for (const key of selectedSheets) {
    if (key === 'summary') {
      const s = result.summary || {}
      const rows = Object.entries(s).map(([k, v]) => ({
        '指标': t(k),
        '数值': typeof v === 'number' ? (v % 1 === 0 ? v : Number(v.toFixed(2))) : v,
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, '汇总')
      continue
    }

    const data = (result as unknown as Record<string, unknown>)[key] as Record<string, unknown>[] | undefined
    if (!Array.isArray(data) || data.length === 0) continue

    const sheetLabel = PRECHECK_SHEET_OPTIONS.find(o => o.key === key)?.label || key

    if (splitByVillage) {
      const byVillage: Record<string, Record<string, unknown>[]> = {}
      for (const item of data) {
        const v = String(item.village || '未知村')
        if (!byVillage[v]) byVillage[v] = []
        byVillage[v].push(item)
      }
      for (const [vname, items] of Object.entries(byVillage)) {
        const keys = collectKeys(items)
        const rows = items.map(item => {
          const row: Record<string, unknown> = {}
          for (const k of keys) row[t(k)] = flat(item[k])
          return row
        })
        const ws = XLSX.utils.json_to_sheet(rows)
        const safeName = `${vname}-${sheetLabel}`.slice(0, 31)
        XLSX.utils.book_append_sheet(wb, ws, safeName)
      }
    } else {
      const keys = collectKeys(data)
      const rows = data.map(item => {
        const row: Record<string, unknown> = {}
        for (const k of keys) row[t(k)] = flat(item[k])
        return row
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, sheetLabel.slice(0, 31))
    }
  }

  if (wb.SheetNames.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([['提示', '所选检查项没有可导出的数据']])
    XLSX.utils.book_append_sheet(wb, ws, '空')
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  downloadBlob(blob, `${fileName}_${dateStr}.xlsx`)
}

/**
 * 导出预检报告（简化版，导出所有有数据的 sheet）
 */
export function exportPrecheckReport(result: CheckResult, fileName = '预检查报告') {
  const selected = getDefaultSelectedSheets(result)
  exportPrecheckReportWithOptions(result, { splitByVillage: false, selectedSheets: selected }, fileName)
}

/**
 * 从预检结果中获取所有涉及的村名
 */
export function getVillagesFromResult(result: CheckResult): string[] {
  const villages = new Set<string>()
  const collect = (arr?: Record<string, unknown>[]) => {
    arr?.forEach(item => { if (item.village) villages.add(String(item.village)) })
  }
  for (const opt of PRECHECK_SHEET_OPTIONS) {
    if (opt.key === 'summary') continue
    collect((result as unknown as Record<string, unknown>)[opt.key] as Record<string, unknown>[] | undefined)
  }
  return Array.from(villages).sort()
}

/**
 * 获取默认选中的 sheets（有数据的 sheet）
 */
export function getDefaultSelectedSheets(result: CheckResult): SheetKey[] {
  const selected: SheetKey[] = ['summary']
  for (const opt of PRECHECK_SHEET_OPTIONS) {
    if (!opt.hasCount) continue
    const data = (result as unknown as Record<string, unknown>)[opt.key] as unknown[] | undefined
    if (data && data.length > 0) selected.push(opt.key as SheetKey)
  }
  return selected
}
