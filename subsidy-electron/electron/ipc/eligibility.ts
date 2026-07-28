import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'
import { safeInsert, safeUpdate } from '../utils/sql-guard'

const ELIGIBILITY_COLS = [
  'subsidy_type_id', 'rule_name', 'rule_desc',
  'require_farmer_status', 'require_age_min', 'require_age_max',
  'require_land_type', 'require_min_area', 'require_max_area',
  'is_active',
]

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
      const id = safeInsert('subsidy_eligibility_rule', data, ELIGIBILITY_COLS)
      return success({ id })
    } catch (e) { return errorResponse('创建规则失败') }
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
    } catch (e) { return errorResponse('资格检查失败') }
  })

  ipcMain.handle('eligibility:update', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      if (!id) return errorResponse('缺少规则ID')
      safeUpdate('subsidy_eligibility_rule', id, data, ELIGIBILITY_COLS)
      return success(null, '更新成功')
    } catch (e) { return errorResponse('更新规则失败') }
  })

  ipcMain.handle('eligibility:delete', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM subsidy_eligibility_rule WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse('删除规则失败') }
  })

  ipcMain.handle('eligibility:ruleTemplates', () => {
    try {
      const templates = [
        { name: '面积异常', desc: '申请面积超过承包地面积2倍以上', preset: { require_max_area: 0 } },
        { name: '年龄不符', desc: '发放给非适龄农户（18-65）', preset: { require_age_min: 18, require_age_max: 65 } },
        { name: '在册农户', desc: '仅允许在册状态农户', preset: { require_farmer_status: 1 } },
      ]
      return success(templates)
    } catch (e) { return errorResponse('获取模板失败') }
  })
}
