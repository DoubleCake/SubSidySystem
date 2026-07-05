import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

export function registerExcelTemplateHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('excel-templates:list', (_e, businessType?: string) => {
    try {
      let query = 'SELECT * FROM excel_column_template WHERE is_active = 1'
      const params: unknown[] = []
      if (businessType) { query += ' AND business_type = ?'; params.push(businessType) }
      query += ' ORDER BY id DESC'
      return success(db().allRaw(query, ...params))
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('excel-templates:get', (_e, id: number) => {
    try {
      const row = db().getRaw('SELECT * FROM excel_column_template WHERE id = ?', id)
      return success(row)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('excel-templates:save', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const result = db().runRaw(`INSERT INTO excel_column_template (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 自动检测列映射 ──
  ipcMain.handle('excel-templates:detectColumns', (_e, payload: any) => {
    try {
      const { columns, business_type, sample_rows } = payload

      if (!columns || !Array.isArray(columns)) {
        return errorResponse('columns 必须为字符串数组')
      }

      // 内置关键词匹配规则
      const keywordMap: Record<string, string[]> = {
        household_name: ['户名', '家庭名称', '家庭户名称', '户主姓名'],
        real_name: ['姓名', '农户姓名', '姓名/名称'],
        id_card: ['身份证', '身份证号', '身份证号码', '公民身份号码'],
        phone: ['手机', '手机号', '联系电话', '电话'],
        gender: ['性别'],
        bank_card: ['银行卡', '银行卡号', '银行账号', '账号'],
        bank_name: ['开户行', '银行名称', '开户银行'],
        relation: ['与户主关系', '关系', '家庭关系'],
        household_code: ['户编码', '户号', '家庭编号'],
        address: ['地址', '家庭地址', '居住地址', '户籍地址'],
        village_name: ['村', '村名', '所属村', '行政村'],
        group_no: ['组', '组别', '村组', '小组'],
        contract_area: ['承包面积', '承包地面积', '地亩数'],
        confirmed_area: ['确权面积', '确权地亩'],
        remark: ['备注', '说明', '备注信息'],
        farmer_status: ['状态', '农户状态'],
        apply_year: ['年度', '年份', '补贴年度'],
        apply_area: ['补贴面积', '申请面积'],
        apply_amount: ['补贴金额', '补贴标准', '单价', '申请金额'],
        subsidy_name: ['补贴名称', '补贴项目', '补贴类型'],
      }

      const mapping: Record<string, { column: string; confidence: number }> = {}
      const unmatched: string[] = []

      for (const col of columns) {
        let bestField = ''
        let bestConfidence = 0

        for (const [field, keywords] of Object.entries(keywordMap)) {
          for (const kw of keywords) {
            if (col === kw) {
              // 精确匹配，置信度最高
              if (bestConfidence < 100) {
                bestField = field
                bestConfidence = 100
              }
            } else if (col.includes(kw) || kw.includes(col)) {
              // 部分匹配
              const score = 70
              if (score > bestConfidence) {
                bestField = field
                bestConfidence = score
              }
            }
          }
        }

        if (bestConfidence >= 70) {
          mapping[col] = { column: bestField, confidence: bestConfidence }
        } else {
          unmatched.push(col)
        }
      }

      return success({
        business_type,
        detected_count: Object.keys(mapping).length,
        unmatched_count: unmatched.length,
        mapping,
        unmatched,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })
}
