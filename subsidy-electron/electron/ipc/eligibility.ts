import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

export function registerEligibilityHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('eligibility:list', (_e, subsidyTypeId?: number) => {
    try {
      let query = 'SELECT * FROM subsidy_eligibility_rule WHERE is_active = 1'
      const params: unknown[] = []
      if (subsidyTypeId) { query += ' AND subsidy_type_id = ?'; params.push(subsidyTypeId) }
      const rows = db().allRaw(query, ...params)
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('eligibility:create', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const result = db().runRaw(`INSERT INTO subsidy_eligibility_rule (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 批量资格检查 ──
  ipcMain.handle('eligibility:check', (_e, data: any) => {
    try {
      const { subsidy_type_id, year, rows } = data || {}
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return success({ passed_list: [], failed_list: [], total: 0 })
      }

      // 读取激活的规则
      const rules = db().allRaw(
        `SELECT * FROM subsidy_eligibility_rule WHERE is_active = 1 AND (subsidy_type_id = ? OR subsidy_type_id IS NULL)`, subsidy_type_id
      )

      const passed: unknown[] = []
      const failed: unknown[] = []

      for (const row of rows) {
        const issues: string[] = []
        const idCard = (row.id_card || '').trim()
        const realName = (row.real_name || '').trim()

        // 基础校验（无需规则也执行）
        if (!idCard || idCard.length !== 18) issues.push('身份证号无效')
        if (!realName) issues.push('姓名为空')

        // 规则校验
        for (const r of rules) {
          const rule = r as Record<string, any>
          try {
            if (rule.require_farmer_status && row.farmer_status != null && Number(row.farmer_status) !== Number(rule.require_farmer_status)) {
              issues.push(rule.rule_name || '农户状态不符')
            }
            if (rule.require_min_area && Number(row.apply_area || 0) < Number(rule.require_min_area)) {
              issues.push(rule.rule_name || '面积不达标')
            }
            if (rule.require_max_area && Number(row.apply_area || 0) > Number(rule.require_max_area)) {
              issues.push(rule.rule_name || '面积超限')
            }
            if (rule.require_age_min || rule.require_age_max) {
              const birth = idCard.substring(6, 14)
              const age = new Date().getFullYear() - parseInt(birth.substring(0, 4))
              if (rule.require_age_min && age < Number(rule.require_age_min)) issues.push(rule.rule_name || '年龄不符')
              if (rule.require_age_max && age > Number(rule.require_age_max)) issues.push(rule.rule_name || '年龄不符')
            }
          } catch { /* 规则字段缺失，跳过 */ }
        }

        if (issues.length > 0) {
          failed.push({ _row_index: row._row_index, real_name: realName, id_card_masked: idCard.slice(0, 6) + '****' + idCard.slice(-4), issues })
        } else {
          passed.push({ _row_index: row._row_index })
        }
      }

      return success({ passed_list: passed, failed_list: failed, total: rows.length })
    } catch (e) { return errorResponse(String(e)) }
  })
}
