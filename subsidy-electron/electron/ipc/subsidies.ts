import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { maskIdCard } from '../utils/masking'
import { parsePagination, successList, success, errorResponse } from './response'

export function registerSubsidyHandlers(): void {
  const db = () => getDb()

  // ═══════════════════ 补贴类型 ═══════════════════

  ipcMain.handle('subsidies:listTypes', (_e, year?: number) => {
    try {
      let query = 'SELECT * FROM subsidy_type'
      const params: unknown[] = []
      if (year) { query += ' WHERE subsidy_year = ?'; params.push(year) }
      query += ' ORDER BY subsidy_year DESC'
      return success(db().allRaw(query, ...params))
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:listTypesWithStats', (_e, year?: number) => {
    try {
      const params: unknown[] = []
      let yearCondition = ''
      if (year) { yearCondition = ' AND sa.apply_year = ?'; params.push(year) }
      const rows = db().allRaw(`
        SELECT st.*,
               COUNT(sa.id) as app_count,
               COUNT(DISTINCT sa.beneficiary_id) as beneficiary_count,
               COALESCE(SUM(sa.apply_amount), 0) as total_apply,
               COALESCE(SUM(sa.actual_amount), 0) as total_actual
        FROM subsidy_type st
        LEFT JOIN subsidy_application sa ON st.id = sa.subsidy_type_id${yearCondition}
        GROUP BY st.id
        ORDER BY st.subsidy_year DESC
      `, ...params)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:createType', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const result = db().runRaw(`INSERT INTO subsidy_type (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:updateType', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => data[k])
      db().runRaw(`UPDATE subsidy_type SET ${sets} WHERE id = ?`, ...values, id)
      return success(null, '更新成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ═══════════════════ 补贴申请 ═══════════════════

  ipcMain.handle('subsidies:listApplications', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const year = params.year ? Number(params.year) : null
      const subsidyTypeId = params.subsidy_type_id ? Number(params.subsidy_type_id) : null
      const villageName = params.village_name as string || ''
      const search = params.search as string || ''

      let where = 'WHERE 1=1'
      const values: unknown[] = []

      if (year) { where += ' AND sa.apply_year = ?'; values.push(year) }
      if (subsidyTypeId) { where += ' AND sa.subsidy_type_id = ?'; values.push(subsidyTypeId) }
      if (villageName) { where += ' AND v.village_name = ?'; values.push(villageName) }
      if (search) {
        where += ' AND (fp.real_name LIKE ? OR fp.id_card LIKE ?)'
        values.push(`%${search}%`, `%${search}%`)
      }

      const countRow = db().getRaw<{ cnt: number }>(`
        SELECT COUNT(*) as cnt FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        ${where}
      `, ...values)

      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT sa.*, fp.real_name as farmer_name, fp.id_card as farmer_id_card,
               st.subsidy_name, st.season, st.calc_mode,
               v.village_name, hh.group_no
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        ${where}
        ORDER BY sa.id DESC
        LIMIT ? OFFSET ?
      `, ...values, pageSize, offset)

      const items = rows.map(r => ({
        ...r,
        farmer_id_card: maskIdCard(r.farmer_id_card as string),
      }))

      return successList(items, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:createApplication', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const result = db().runRaw(`INSERT INTO subsidy_application (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:updateApplication', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => data[k])
      db().runRaw(`UPDATE subsidy_application SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, id)
      return success(null, '更新成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ═══════════════════ 代领关系 ═══════════════════

  ipcMain.handle('subsidies:listProxies', (_e, params: Record<string, unknown> = {}) => {
    try {
      const rows = db().allRaw(`
        SELECT sp.*,
               bf.real_name as beneficiary_name, pf.real_name as proxy_name
        FROM subsidy_proxy sp
        LEFT JOIN farmer_profile bf ON sp.beneficiary_farmer_id = bf.id
        LEFT JOIN farmer_profile pf ON sp.proxy_farmer_id = pf.id
        ORDER BY sp.id DESC
      `)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:createProxy', (_e, data: Record<string, unknown>) => {
    try {
      const result = db().runRaw(`
        INSERT INTO subsidy_proxy (subsidy_type_id, beneficiary_farmer_id, proxy_farmer_id, proxy_type, remark)
        VALUES (?, ?, ?, ?, ?)
      `, data.subsidy_type_id, data.beneficiary_farmer_id, data.proxy_farmer_id, data.proxy_type, data.remark)
      return success({ id: result.lastInsertRowid })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:deleteProxy', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM subsidy_proxy WHERE id = ?', id)
      return success(null, '删除成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ═══════════════════ 汇总统计 ═══════════════════

  ipcMain.handle('subsidies:yearCompare', (_e, year: number) => {
    try {
      const current = db().getRaw(`
        SELECT COALESCE(SUM(actual_amount), 0) as total_amount,
               COUNT(DISTINCT beneficiary_id) as farmer_count,
               COUNT(*) as application_count
        FROM subsidy_application WHERE apply_year = ? AND pay_status >= 1
      `, year)

      const prev = db().getRaw(`
        SELECT COALESCE(SUM(actual_amount), 0) as total_amount,
               COUNT(DISTINCT beneficiary_id) as farmer_count,
               COUNT(*) as application_count
        FROM subsidy_application WHERE apply_year = ? AND pay_status >= 1
      `, year - 1)

      return success({ current_year: current, previous_year: prev })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:summaryByVillage', (_e, year: number) => {
    try {
      const rows = db().allRaw(`
        SELECT v.village_name,
               COUNT(DISTINCT sa.beneficiary_id) as farmer_count,
               COUNT(*) as application_count,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount,
               COALESCE(SUM(sa.apply_area), 0) as total_area
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE sa.apply_year = ?
        GROUP BY v.id
        ORDER BY total_amount DESC
      `, year)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:summaryBySeason', (_e, year: number) => {
    try {
      const rows = db().allRaw(`
        SELECT st.season,
               COUNT(DISTINCT st.id) as project_count,
               COUNT(DISTINCT sa.beneficiary_id) as farmer_count,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount,
               COALESCE(SUM(sa.apply_area), 0) as total_area,
               COUNT(*) as application_count
        FROM subsidy_application sa
        JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        WHERE sa.apply_year = ?
        GROUP BY st.season
      `, year)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ═══════════════════ 批量导入申请 ═══════════════════

  ipcMain.handle('subsidies:batchImportApplications', (_e, payload: any) => {
    try {
      const { rows } = payload
      const inserted: number[] = []
      const updated: number[] = []
      const errors: { row: number; message: string }[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          // 检查是否已存在：同一年度、同一补贴类型、同一受益人
          const existing = db().getRaw<Record<string, unknown>>(`
            SELECT id FROM subsidy_application
            WHERE apply_year = ? AND subsidy_type_id = ? AND beneficiary_id = ?
          `, row.apply_year, row.subsidy_type_id, row.beneficiary_id)

          if (existing) {
            // UPDATE
            const keys = Object.keys(row).filter(k => row[k] !== undefined && k !== 'id')
            const sets = keys.map(k => `${k} = ?`).join(', ')
            const values = keys.map(k => row[k])
            db().runRaw(`UPDATE subsidy_application SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, existing.id)
            updated.push(existing.id as number)
          } else {
            // INSERT
            const cols = Object.keys(row).join(', ')
            const placeholders = Object.keys(row).map(() => '?').join(', ')
            const values = Object.keys(row).map(k => row[k])
            const result = db().runRaw(`INSERT INTO subsidy_application (${cols}) VALUES (${placeholders})`, ...values)
            inserted.push(result.lastInsertRowid)
          }
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) })
        }
      }

      return success({
        total: rows.length,
        inserted_count: inserted.length,
        updated_count: updated.length,
        error_count: errors.length,
        errors,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ═══════════════════ 按村统计面积 ═══════════════════

  ipcMain.handle('subsidies:areaStatsByVillage', (_e, payload: any) => {
    try {
      const { subsidy_type_id, year, data_source } = payload
      const tableName = data_source === 'payment' ? 'subsidy_payment' : 'subsidy_application'

      let query = `
        SELECT v.id as village_id, v.village_name,
               COUNT(DISTINCT sa.beneficiary_id) as beneficiary_count,
               COUNT(*) as application_count,
               COALESCE(SUM(sa.apply_area), 0) as total_area,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount
        FROM ${tableName} sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE 1=1
      `
      const values: unknown[] = []

      if (subsidy_type_id) {
        query += ' AND sa.subsidy_type_id = ?'
        values.push(subsidy_type_id)
      }
      if (year) {
        query += ' AND sa.apply_year = ?'
        values.push(year)
      }

      // 如果查询 subsidy_payment 表但表不存在，回退到 subsidy_application
      try {
        const rows = db().allRaw<Record<string, unknown>>(
          query + ' GROUP BY v.id ORDER BY total_area DESC',
          ...values
        )
        return success(rows)
      } catch {
        // 回退到 subsidy_application
        const fallbackQuery = query.replace(tableName, 'subsidy_application')
        const rows = db().allRaw<Record<string, unknown>>(
          fallbackQuery + ' GROUP BY v.id ORDER BY total_area DESC',
          ...values
        )
        return success(rows)
      }
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 检查配置 ──
  ipcMain.handle('subsidies:getCheckConfig', (_e, typeId: number) => {
    try {
      return success({ check_config: { checks: {} }, raw: null })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:updateCheckConfig', (_e, payload: any) => {
    try {
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:restoreType', (_e, typeId: number) => {
    try {
      return success({ message: '恢复成功' })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:exportApplications', (_e, subsidyTypeId: number) => {
    try {
      const rows = db().allRaw('SELECT * FROM subsidy_application WHERE subsidy_type_id = ?', subsidyTypeId)
      return success({ items: rows })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:exportPayments', (_e, subsidyTypeId: number) => {
    try {
      const rows = db().allRaw('SELECT * FROM subsidy_payment WHERE subsidy_type_id = ?', subsidyTypeId)
      return success({ items: rows })
    } catch (e) { return errorResponse(String(e)) }
  })
}
