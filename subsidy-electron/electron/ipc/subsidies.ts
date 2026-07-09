import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
// 系统内查询：明文显示，不做打码处理
import { parsePagination, successList, success, errorResponse } from './response'

export function registerSubsidyHandlers(): void {
  const db = () => getDb()

  // ═══════════════════ 补贴类型 ═══════════════════

  // ── 补贴类型列表（不含已删除）──
  ipcMain.handle('subsidies:listTypes', (_e, payload: any) => {
    try {
      const year = typeof payload === 'object' && payload !== null ? payload.year : undefined
      const status = typeof payload === 'object' && payload !== null ? payload.status : undefined
      const showDeleted = typeof payload === 'object' && payload !== null ? payload.deleted : undefined
      let query = "SELECT * FROM subsidy_type WHERE COALESCE(is_deleted,0) = 0"
      const sqlParams: unknown[] = []
      if (showDeleted == 1) { query = "SELECT * FROM subsidy_type WHERE is_deleted = 1" }
      else if (year) { query += ' AND subsidy_year = ?'; sqlParams.push(year) }
      if (status !== undefined && status !== null) { query += ' AND pay_status = ?'; sqlParams.push(status) }
      query += ' ORDER BY subsidy_year DESC'
      return success(db().allRaw(query, ...sqlParams))
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 补贴类型列表含统计（不含已删除）──
  ipcMain.handle('subsidies:listTypesWithStats', (_e, year?: any) => {
    try {
      const params: unknown[] = []
      let stWhere = ' WHERE COALESCE(st.is_deleted,0) = 0'
      let saWhere = ''
      if (year) {
        stWhere += ' AND st.subsidy_year = ?'
        saWhere = ' AND sa.apply_year = ?'
        params.push(year, year)
      }
      const rows = db().allRaw(`
        SELECT st.*,
               COUNT(sa.id) as app_count,
               COUNT(DISTINCT sa.beneficiary_id) as beneficiary_count,
               COALESCE(SUM(sa.apply_amount), 0) as total_apply,
               COALESCE(SUM(sa.actual_amount), 0) as total_actual
        FROM subsidy_type st
        LEFT JOIN subsidy_application sa ON st.id = sa.subsidy_type_id${saWhere}
        ${stWhere}
        GROUP BY st.id
        ORDER BY st.subsidy_year DESC
      `, ...params)
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 新建补贴类型 ──
  ipcMain.handle('subsidies:createType', (_e, data: Record<string, unknown>) => {
    try {
      const safeData: Record<string, unknown> = {
        pay_status: 1,
        count_toward_area: 1,
        season: '全年单补',
        calc_mode: 'fixed',
        is_deleted: 0,
        ...data,
      }
      const keys = Object.keys(safeData).filter(k =>
        safeData[k] !== undefined && safeData[k] !== null && safeData[k] !== ''
      )
      const cols = keys.join(', ')
      const placeholders = keys.map(() => '?').join(', ')
      const values = keys.map(k => safeData[k])
      const result = db().runRaw(`INSERT INTO subsidy_type (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
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
        SELECT sa.*, fp.real_name as farmer_name, fp.id_card, fp.phone,
               st.subsidy_name, st.season, st.calc_mode,
               v.village_name as village, hh.group_no
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        ${where}
        ORDER BY sa.id DESC
        LIMIT ? OFFSET ?
      `, ...values, pageSize, offset)

      // 系统内查询：返回明文，不做打码
      const items = rows.map(r => ({ ...r }))

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
      const subsidyTypeId = params.subsidy_type_id ? Number(params.subsidy_type_id) : 0
      const search = (params.search as string)?.trim() || ''

      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (subsidyTypeId) { where += ' AND sp.subsidy_type_id = ?'; vals.push(subsidyTypeId) }
      if (search) {
        where += ' AND (bf.real_name LIKE ? OR pf.real_name LIKE ? OR bf.id_card LIKE ? OR pf.id_card LIKE ?)'
        vals.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
      }

      const rows = db().allRaw(`
        SELECT sp.*,
               bf.real_name as beneficiary_farmer_name, bf.id_card as beneficiary_id_card,
               pf.real_name as proxy_farmer_name, pf.id_card as proxy_id_card,
               st.subsidy_name
        FROM subsidy_proxy sp
        LEFT JOIN farmer_profile bf ON sp.beneficiary_farmer_id = bf.id
        LEFT JOIN farmer_profile pf ON sp.proxy_farmer_id = pf.id
        LEFT JOIN subsidy_type st ON sp.subsidy_type_id = st.id
        ${where}
        ORDER BY sp.id DESC
      `, ...vals)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:createProxy', (_e, data: Record<string, unknown>) => {
    try {
      const beneficiaryId = Number(data.beneficiary_farmer_id)
      const proxyId = Number(data.proxy_farmer_id)
      const subsidyTypeId = Number(data.subsidy_type_id) || 0
      const applicationId = data.application_id ? Number(data.application_id) : null
      const paymentId = data.payment_id ? Number(data.payment_id) : null

      // 更新关联的补贴申请：将代领人的申请改为受益人
      if (applicationId) {
        db().runRaw(
          'UPDATE subsidy_application SET beneficiary_id = ?, is_proxy = 1 WHERE id = ?',
          beneficiaryId, applicationId
        )
      } else if (paymentId) {
        db().runRaw(
          'UPDATE subsidy_payment SET beneficiary_id = ?, is_proxy = 1 WHERE id = ?',
          beneficiaryId, paymentId
        )
      } else if (subsidyTypeId) {
        // 批量更新该补贴项目下代领人的所有申请
        db().runRaw(
          'UPDATE subsidy_application SET beneficiary_id = ?, is_proxy = 1 WHERE farmer_id = ? AND subsidy_type_id = ?',
          beneficiaryId, proxyId, subsidyTypeId
        )
        db().runRaw(
          'UPDATE subsidy_payment SET beneficiary_id = ?, is_proxy = 1 WHERE farmer_id = ? AND subsidy_type_id = ?',
          beneficiaryId, proxyId, subsidyTypeId
        )
      }

      // 创建代领关系记录
      const result = db().runRaw(`
        INSERT INTO subsidy_proxy (subsidy_type_id, application_id, payment_id, beneficiary_farmer_id, proxy_farmer_id, proxy_type, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, subsidyTypeId || null, applicationId, paymentId, beneficiaryId, proxyId, data.proxy_type || '代领', data.remark || '')

      return success({ id: result.lastInsertRowid, message: '代领关系创建成功' })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:deleteProxy', (_e, id: number) => {
    try {
      const proxy = db().getRaw<{ application_id: number; payment_id: number; subsidy_type_id: number; beneficiary_farmer_id: number; proxy_farmer_id: number }>(
        'SELECT * FROM subsidy_proxy WHERE id = ?', id
      )
      if (proxy) {
        // 恢复关联的补贴申请/发放记录
        if (proxy.application_id) {
          db().runRaw("UPDATE subsidy_application SET beneficiary_id = farmer_id, is_proxy = 0 WHERE id = ?", proxy.application_id)
        } else if (proxy.payment_id) {
          db().runRaw("UPDATE subsidy_payment SET beneficiary_id = farmer_id, is_proxy = 0 WHERE id = ?", proxy.payment_id)
        } else if (proxy.subsidy_type_id) {
          db().runRaw("UPDATE subsidy_application SET beneficiary_id = farmer_id, is_proxy = 0 WHERE farmer_id = ? AND subsidy_type_id = ?",
            proxy.proxy_farmer_id, proxy.subsidy_type_id)
          db().runRaw("UPDATE subsidy_payment SET beneficiary_id = farmer_id, is_proxy = 0 WHERE farmer_id = ? AND subsidy_type_id = ?",
            proxy.proxy_farmer_id, proxy.subsidy_type_id)
        }
      }
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

  // ── 软删除：移入回收站 ──
  ipcMain.handle('subsidies:deleteType', (_e, typeId: number) => {
    try {
      db().runRaw("UPDATE subsidy_type SET is_deleted = 1 WHERE id = ?", typeId)
      return success({ message: '已移入回收站' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 对比项目列表（排除已删除）──
  ipcMain.handle('subsidies:comparableTypes', (_e, payload: any) => {
    try {
      const { category, current_type_id } = payload
      let query = "SELECT id, subsidy_name, subsidy_year FROM subsidy_type WHERE COALESCE(is_deleted,0) = 0"
      const params: unknown[] = []
      if (category) { query += ' AND category = ?'; params.push(category) }
      if (current_type_id) { query += ' AND id != ?'; params.push(current_type_id) }
      query += ' ORDER BY subsidy_year DESC'
      return success(db().allRaw(query, ...params))
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 恢复：从回收站还原 ──
  ipcMain.handle('subsidies:restoreType', (_e, typeId: number) => {
    try {
      db().runRaw("UPDATE subsidy_type SET is_deleted = 0 WHERE id = ?", typeId)
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

  // ── 补贴发放列表（分页）──
  ipcMain.handle('subsidies:listPayments', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const subsidyTypeId = Number(params.subsidy_type_id) || 0
      const paymentYear = Number(params.payment_year) || 0
      const search = (params.search as string) || ''

      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (subsidyTypeId) { where += ' AND sp.subsidy_type_id=?'; vals.push(subsidyTypeId) }
      if (paymentYear) { where += ' AND sp.payment_year=?'; vals.push(paymentYear) }
      if (search) { where += ' AND (fp.real_name LIKE ? OR hh.household_name LIKE ?)'; vals.push(`%${search}%`, `%${search}%`) }

      const countRow = db().getRaw<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM subsidy_payment sp LEFT JOIN farmer_profile fp ON sp.beneficiary_id=fp.id LEFT JOIN family_household hh ON fp.household_id=hh.id ${where}`, ...vals)
      const rows = db().allRaw(`SELECT sp.*, fp.real_name as farmer_name, hh.household_name, hh.household_code FROM subsidy_payment sp LEFT JOIN farmer_profile fp ON sp.beneficiary_id=fp.id LEFT JOIN family_household hh ON fp.household_id=hh.id ${where} ORDER BY sp.id DESC LIMIT ? OFFSET ?`, ...vals, pageSize, offset)
      return successList(rows, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 删除申请 ──
  ipcMain.handle('subsidies:deleteApplication', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM subsidy_application WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 删除发放 ──
  ipcMain.handle('subsidies:deletePayment', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM subsidy_payment WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 批量删除 ──
  ipcMain.handle('subsidies:batchDeleteApplications', (_e, payload: any) => {
    try {
      if (payload.delete_all) {
        db().runRaw('DELETE FROM subsidy_application WHERE subsidy_type_id=?', payload.subsidy_type_id)
        return success({ message: '已全部删除' })
      }
      for (const id of (payload.ids || [])) db().runRaw('DELETE FROM subsidy_application WHERE id=?', id)
      return success({ message: `已删除 ${(payload.ids||[]).length} 条` })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:batchDeletePayments', (_e, payload: any) => {
    try {
      if (payload.delete_all) {
        db().runRaw('DELETE FROM subsidy_payment WHERE subsidy_type_id=?', payload.subsidy_type_id)
        return success({ message: '已全部删除' })
      }
      for (const id of (payload.ids || [])) db().runRaw('DELETE FROM subsidy_payment WHERE id=?', id)
      return success({ message: `已删除 ${(payload.ids||[]).length} 条` })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 预申请转发放 ──
  ipcMain.handle('subsidies:convertToPayment', (_e, payload: any) => {
    try {
      const ids = payload.application_ids || []
      let count = 0
      for (const appId of ids) {
        const app = db().getRaw<any>('SELECT * FROM subsidy_application WHERE id=?', appId)
        if (!app) continue
        // check if payment already exists
        const exist = db().getRaw<{ id: number }>('SELECT id FROM subsidy_payment WHERE application_id=?', appId)
        if (exist) continue
        db().runRaw(`INSERT INTO subsidy_payment (subsidy_type_id, beneficiary_id, farmer_id, payment_year, applicant_name, id_card, apply_area, contract_area, trust_area, no_subsidy_area, amount, pay_status, is_proxy, payment_village_name, payment_group_display, application_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          app.subsidy_type_id, app.beneficiary_id, app.farmer_id, app.apply_year, app.applicant_name, app.id_card, app.apply_area, app.contract_area, app.trust_area, app.no_subsidy_area, app.actual_amount || app.apply_amount, 2, app.is_proxy, app.apply_village_name, app.apply_group_display, appId)
        count++
      }
      return success({ message: `已转换 ${count} 条` })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 统计 ──
  ipcMain.handle('subsidies:applicationStats', (_e, params: any) => {
    try {
      const { subsidy_type_id, year, compare_type_id } = params || {}
      const rows = db().allRaw(`SELECT sa.apply_year, COUNT(*) as cnt, COALESCE(SUM(sa.apply_area),0) as total_area, COALESCE(SUM(sa.actual_amount),0) as total_amount FROM subsidy_application sa WHERE sa.subsidy_type_id=? ${year?'AND sa.apply_year=?':''} GROUP BY sa.apply_year ORDER BY sa.apply_year`, subsidy_type_id, ...(year?[year]:[]))
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:applicationVillages', (_e, params: any) => {
    try {
      const { subsidy_type_id, year } = params || {}
      const rows = db().allRaw(`SELECT sa.apply_village_name as village_name, sa.apply_group_display as group_display, COUNT(*) as cnt FROM subsidy_application sa WHERE sa.subsidy_type_id=? ${year?'AND sa.apply_year=?':''} GROUP BY sa.apply_village_name, sa.apply_group_display ORDER BY sa.apply_village_name`, subsidy_type_id, ...(year?[year]:[]))
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 批量导入发放记录 ──
  ipcMain.handle('subsidies:batchImportPayments', (_e, payload: any) => {
    try {
      const { rows, overwrite } = payload
      let created = 0, skipped = 0
      for (const row of rows) {
        if (overwrite) {
          // check duplicate by key fields
          const exist = db().getRaw<{ id: number }>(
            'SELECT id FROM subsidy_payment WHERE subsidy_type_id=? AND beneficiary_id=? AND payment_year=?',
            row.subsidy_type_id, row.beneficiary_id, row.payment_year)
          if (exist) { db().runRaw('DELETE FROM subsidy_payment WHERE id=?', exist.id); skipped++ }
        }
        const cols = Object.keys(row).filter(k => row[k] !== undefined).join(',')
        const ph = Object.keys(row).filter(k => row[k] !== undefined).map(() => '?').join(',')
        const vals = Object.keys(row).filter(k => row[k] !== undefined).map(k => row[k])
        db().runRaw(`INSERT INTO subsidy_payment (${cols}) VALUES (${ph})`, ...vals)
        created++
      }
      return success({ message: `导入完成：新增${created}，覆盖${skipped}` })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 预检查／数据验证 ──
  ipcMain.handle('subsidies:precheck', (_e, params: any) => {
    try {
      const { subsidy_type_id, year, pay_status, village_name } = params || {}
      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (subsidy_type_id) { where += ' AND sa.subsidy_type_id=?'; vals.push(subsidy_type_id) }
      if (year) { where += ' AND sa.apply_year=?'; vals.push(year) }
      if (pay_status != null) { where += ' AND sa.pay_status=?'; vals.push(pay_status) }
      if (village_name) { where += ' AND sa.apply_village_name=?'; vals.push(village_name) }
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT sa.*, fp.real_name as farmer_name, st.subsidy_name, hh.household_name
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.beneficiary_id=fp.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id=st.id
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        ${where} ORDER BY sa.id
      `, ...vals)
      return success({ items: rows, total: rows.length })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 导出预检查报告（简化版）──
  ipcMain.handle('subsidies:exportPrecheck', (_e, params: any) => {
    try {
      const { subsidy_type_id, year, village_name } = params || {}
      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (subsidy_type_id) { where += ' AND sa.subsidy_type_id=?'; vals.push(subsidy_type_id) }
      if (year) { where += ' AND sa.apply_year=?'; vals.push(year) }
      if (village_name) { where += ' AND sa.apply_village_name=?'; vals.push(village_name) }
      const rows = db().allRaw(`
        SELECT sa.*, fp.real_name as farmer_name, st.subsidy_name, hh.household_name
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.beneficiary_id=fp.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id=st.id
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        ${where} ORDER BY sa.apply_village_name, fp.real_name
      `, ...vals)
      return success({ items: rows })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:exportPrecheckWithOptions', (_e, params: any) => {
    try {
      // same as exportPrecheck but with additional filter options
      const { subsidy_type_id, year, village_name, pay_status } = params || {}
      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (subsidy_type_id) { where += ' AND sa.subsidy_type_id=?'; vals.push(subsidy_type_id) }
      if (year) { where += ' AND sa.apply_year=?'; vals.push(year) }
      if (village_name) { where += ' AND sa.apply_village_name=?'; vals.push(village_name) }
      if (pay_status != null) { where += ' AND sa.pay_status=?'; vals.push(pay_status) }
      const rows = db().allRaw(`
        SELECT sa.*, fp.real_name as farmer_name, st.subsidy_name, hh.household_name, hh.household_code
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.beneficiary_id=fp.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id=st.id
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        ${where} ORDER BY sa.apply_village_name, fp.real_name
      `, ...vals)
      return success({ items: rows })
    } catch (e) { return errorResponse(String(e)) }
  })
}
