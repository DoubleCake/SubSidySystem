import * as XLSX from 'xlsx'
import type { VillageAreaStats, AreaStatsResponse } from '../api'

export function exportAreaStatsToExcel(
  data: AreaStatsResponse,
  subsidyName: string,
  year: number
) {
  const wb = XLSX.utils.book_new()

  // 准备数据
  const allData = [
    ...data.by_village,
    data.total
  ]

  const worksheetData = allData.map(row => ({
    '村名': row.village,
    '农户数': row.farmer_count,
    '记录数': row.record_count,
    '计入超限面积(亩)': row.total_apply_area,
    '不计超限面积(亩)': row.total_apply_area_no_calc,
    '承包地面积(亩)': row.total_contract_area,
    '代耕代种面积(亩)': row.total_trust_area,
    '不予补贴面积(亩)': row.total_no_subsidy_area,
    '补贴金额(元)': row.total_amount
  }))

  const ws = XLSX.utils.json_to_sheet(worksheetData)

  // 设置列宽
  const colWidths = [
    { wch: 15 },  // 村名
    { wch: 8 },   // 农户数
    { wch: 8 },   // 记录数
    { wch: 15 },  // 计入超限面积
    { wch: 15 },  // 不计超限面积
    { wch: 15 },  // 承包地面积
    { wch: 15 },  // 代耕代种面积
    { wch: 15 },  // 不予补贴面积
    { wch: 15 },  // 补贴金额
  ]
  ws['!cols'] = colWidths

  // 添加工作表
  XLSX.utils.book_append_sheet(wb, ws, '面积统计')

  // 下载
  const fileName = `${subsidyName}_${year}年_面积统计.xlsx`
  XLSX.writeFile(wb, fileName)
}
