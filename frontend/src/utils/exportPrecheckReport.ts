/**
 * 预检报告导出工具（调用后端API）
 * 用于 PreCheckPage 和 SubsidyProjectsPage 的预检结果导出
 */
import type { CheckResult } from '../types'

// Sheet 选项配置（与后端 export_utils.py 中的 SHEET_CONFIGS 保持一致）
export const PRECHECK_SHEET_OPTIONS = [
  { key: 'summary', label: '汇总', hasCount: false },
  { key: 'format_errors', label: '格式错误', hasCount: true },
  { key: 'village_errors', label: '村组不存在', hasCount: true },
  { key: 'duplicate_errors', label: '重复身份证', hasCount: true },
  { key: 'db_duplicate_apps', label: '数据库已有申请记录', hasCount: true },
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

// 后端支持的 sheet 映射（英文key -> 中文名称）
const SHEET_KEY_TO_NAME: Record<SheetKey, string> = {
  summary: '汇总',
  format_errors: '格式错误',
  village_errors: '村组不存在',
  duplicate_errors: '重复身份证',
  db_duplicate_apps: '数据库已有申请记录',
  gender_mismatch: '性别不符',
  error_library_hits: '错误库命中',
  area_anomalies: '面积异常',
  area_missing: '承包面积缺失',
  age_anomaly: '年龄异常',
  deceased_farmers: '死亡农户',
  restricted_farmers: '受限身份农户',
  household_duplicates: '同一家庭多成员申请',
  new_farmers: '新增农户',
  removed_farmers: '减少农户',
  changed_farmers: '字段变更',
}

// 后端实际支持的 sheet 名称（export_precheck_report_with_options 中的 all_sheets）
const BACKEND_SUPPORTED_SHEETS = new Set([
  '汇总',
  '错误库命中',
  '格式错误',
  '村组不存在',
  '重复身份证',
  '数据库已有申请记录',
  '性别不符',
  '面积异常',
  '承包面积缺失',
  '年龄异常',
  '死亡农户',
  '受限身份农户',
  '同一家庭多成员申请',
  '新增农户',
  '减少农户',
  '字段变更',
])

/**
 * 将英文 sheet key 转换为后端支持的中文名称
 * 过滤掉后端不支持的 sheet
 */
function mapSheetsToBackend(selectedSheets: SheetKey[]): string[] {
  const mapped = selectedSheets
    .map(key => SHEET_KEY_TO_NAME[key])
    .filter(name => BACKEND_SUPPORTED_SHEETS.has(name))
  return mapped.length > 0 ? mapped : ['汇总']
}

/**
 * 导出预检报告到 Excel（通过后端API，使用 openpyxl 生成，样式更美观）
 * @param result 预检结果
 * @param fileName 文件名（不含扩展名和日期）
 */
export async function exportPrecheckReport(result: CheckResult, fileName = '预检查报告') {
  try {
    const response = await fetch('/api/subsidies/applications/precheck/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result,
        file_name: fileName
      })
    })

    if (!response.ok) {
      throw new Error('导出失败')
    }

    // 从响应头获取文件名
    const contentDisposition = response.headers.get('Content-Disposition')
    let downloadFileName = `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch && filenameMatch[1]) {
        downloadFileName = filenameMatch[1].replace(/['"]/g, '')
      }
    }

    // 创建下载链接
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = downloadFileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('导出失败:', error)
    alert('导出失败，请重试')
  }
}

/**
 * 带选项导出预检报告
 * @param result 预检结果
 * @param options 导出选项
 * @param fileName 文件名（不含扩展名和日期）
 */
export async function exportPrecheckReportWithOptions(
  result: CheckResult,
  options: {
    splitByVillage: boolean
    selectedSheets: SheetKey[]
  },
  fileName = '预检查报告'
) {
  try {
    // 映射 sheet key 为后端支持的中文名称
    const backendSheets = mapSheetsToBackend(options.selectedSheets)

    const response = await fetch('/api/subsidies/applications/precheck/export-with-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result,
        file_name: fileName,
        split_by_village: options.splitByVillage,
        selected_sheets: backendSheets
      })
    })

    if (!response.ok) {
      throw new Error('导出失败')
    }

    // 从响应头获取文件名
    const contentDisposition = response.headers.get('Content-Disposition')
    const dateStr = new Date().toISOString().slice(0, 10)
    let downloadFileName = options.splitByVillage
      ? `${fileName}_${dateStr}.zip`
      : `${fileName}_${dateStr}.xlsx`

    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch && filenameMatch[1]) {
        downloadFileName = filenameMatch[1].replace(/['"]/g, '')
      }
    }

    // 创建下载链接
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = downloadFileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('导出失败:', error)
    alert('导出失败，请重试')
  }
}

/**
 * 从预检结果中获取所有涉及的村名
 */
export function getVillagesFromResult(result: CheckResult): string[] {
  const villages = new Set<string>()

  // 从各类错误中收集村名
  const collectFromArray = (arr: any[] | undefined) => {
    if (!arr) return
    arr.forEach((item: any) => {
      if (item.village) villages.add(item.village)
    })
  }

  collectFromArray(result.format_errors as any[])
  collectFromArray(result.village_errors as any[])
  collectFromArray(result.duplicate_errors as any[])
  collectFromArray(result.gender_mismatch as any[])
  collectFromArray(result.error_library_hits as any[])
  collectFromArray(result.area_anomalies as any[])
  collectFromArray(result.area_missing as any[])
  collectFromArray(result.age_anomaly as any[])
  collectFromArray(result.deceased_farmers as any[])
  collectFromArray(result.restricted_farmers as any[])
  collectFromArray(result.household_duplicates as any[])
  collectFromArray(result.new_farmers as any[])
  collectFromArray(result.removed_farmers as any[])
  collectFromArray(result.changed_farmers as any[])

  return Array.from(villages).sort()
}

/**
 * 获取默认选中的 sheets（有数据的 sheet）
 */
export function getDefaultSelectedSheets(result: CheckResult): SheetKey[] {
  const selected: SheetKey[] = ['summary']

  PRECHECK_SHEET_OPTIONS.forEach(opt => {
    if (!opt.hasCount) return
    const data = result[opt.key as keyof CheckResult] as any[] | undefined
    if (data && data.length > 0) {
      selected.push(opt.key as SheetKey)
    }
  })

  return selected
}
