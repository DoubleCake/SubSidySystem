/**
 * 预检报告导出工具
 * 用于 PreCheckPage 和 SubsidyProjectsPage 的预检结果导出
 */
import * as XLSX from 'xlsx'
import type { CheckResult } from '../types'

/**
 * 导出预检报告到 Excel
 * @param result 预检结果
 * @param fileName 文件名（不含扩展名）
 */
export function exportPrecheckReport(result: CheckResult, fileName = '预检查报告') {
  const wb = XLSX.utils.book_new()

  const addSheet = (name: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }

  // 汇总
  addSheet('汇总', [{
    '检查总行数': result.summary.total_rows,
    '通过行数': result.summary.ok_rows,
    '错误行数': result.summary.error_rows,
    '通过率': result.summary.pass_rate + '%',
    '格式错误': result.summary.format_errors,
    '村组不存在': result.summary.village_errors,
    '重复身份证': result.summary.duplicate_errors,
    '性别不符': result.summary.gender_mismatch,
    '错误库命中': result.summary.error_library_hits,
    '面积异常': result.summary.area_anomalies,
    '新增农户': result.summary.new_farmers,
    '减少农户': result.summary.removed_farmers,
    '字段变更': result.summary.changed_farmers,
  }])

  addSheet('错误库命中', (result.error_library_hits || []).map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group,
    '错误类型': r.error_type, '错误原因': r.error_reason, '来源': r.source,
  })))

  addSheet('格式错误', (result.format_errors || []).map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group,
    '错误内容': Array.isArray(r.errors) ? r.errors.join('；') : String(r.errors || ''),
  })))

  addSheet('村组不存在', (result.village_errors || []).map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group, '错误信息': r.error,
  })))

  addSheet('重复身份证', (result.duplicate_errors || []).map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card, '错误信息': r.error,
  })))

  addSheet('性别不符', (result.gender_mismatch || []).map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    'Excel性别': r.excel_gender, '身份证性别': r.id_card_gender,
  })))

  addSheet('面积异常', (result.area_anomalies || []).map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group,
    '异常类型': r.anomaly_type,
    '异常详情': r.anomaly_details,
    'Excel承包地面积': r.contract_area,
    '数据库承包面积': r.db_contract_area,
    '流转出面积': r.trust_out_area,
    '代耕代种进': r.trust_in_area,
    '不补贴面积': r.no_subsidy_area,
    '实际补贴面积': r.actual_subsidy_area,
    '自有承包地占用': r.self_occupy,
    '户级当季已有申请': r.hh_used,
    '户级合计': r.hh_total,
    '超出面积': r.exceed_amount,
  })))

  addSheet('新增农户', (result.new_farmers || []).map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group, '说明': '数据库中不存在，将新增',
  })))

  addSheet('减少农户', (result.removed_farmers || []).map(r => ({
    '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group, '说明': r.note,
  })))

  addSheet('字段变更', (result.changed_farmers || []).map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '变更内容': Array.isArray(r.changes) ? r.changes.join('；') : String(r.changes || ''),
  })))

  if (result.year_compare && (result.year_compare as { year?: number }).year) {
    const yc = result.year_compare as any
    addSheet('年度对比', [{
      '对比年度': yc.year,
      '数据库已有': yc.db_count,
      '本次Excel': yc.excel_count,
      '新增受益': yc.new_count,
      '减少受益': yc.removed_count,
    }])
    if (yc.new_farmers?.length) {
      addSheet('新增受益', yc.new_farmers.slice(0, 1000).map((r: any) => ({
        '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
      })))
    }
    if (yc.removed_farmers?.length) {
      addSheet('减少受益', yc.removed_farmers.slice(0, 1000).map((r: any) => ({
        '姓名': r.name, '身份证号': r.id_card,
        '所在村': r.village, '所在组': r.group,
      })))
    }
  }

  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}