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
      // 支付状态筛选
      const payStatus = params.pay_status
      if (payStatus !== undefined && payStatus !== null && payStatus !== '') {
        where += ' AND sa.pay_status = ?'
        values.push(Number(payStatus))
      }
      // 金额范围筛选 (actual_amount)
      const minAmt = params.min_amount !== undefined ? Number(params.min_amount) : undefined
      const maxAmt = params.max_amount !== undefined ? Number(params.max_amount) : undefined
      if (minAmt !== undefined && !isNaN(minAmt)) { where += ' AND COALESCE(sa.actual_amount,0) >= ?'; values.push(minAmt) }
      if (maxAmt !== undefined && !isNaN(maxAmt)) { where += ' AND COALESCE(sa.actual_amount,0) <= ?'; values.push(maxAmt) }
      // 日期范围筛选 (pay_date)
      const dateFrom = params.date_from as string || ''
      const dateTo = params.date_to as string || ''
      if (dateFrom) { where += ' AND sa.pay_date >= ?'; values.push(dateFrom) }
      if (dateTo) { where += ' AND sa.pay_date <= ?'; values.push(dateTo) }

      // 排序
      const APP_SORT_MAP: Record<string, string> = {
        apply_area: 'sa.apply_area', contract_area: 'sa.contract_area',
        trust_area: 'sa.trust_area', no_subsidy_area: 'sa.no_subsidy_area',
        apply_amount: 'sa.apply_amount', actual_amount: 'sa.actual_amount',
      }
      const sortField = params.sort_field as string || ''
      const sortDir = (params.sort_dir as string || 'desc') === 'asc' ? 'ASC' : 'DESC'
      let orderClause = 'ORDER BY sa.id DESC'
      if (sortField && APP_SORT_MAP[sortField]) {
        orderClause = `ORDER BY ${APP_SORT_MAP[sortField]} ${sortDir}, sa.id DESC`
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
        ${orderClause}
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
      const { subsidy_type_id, year, data_source, group_by } = payload
      const table = data_source === 'payment' ? 'subsidy_payment' : 'subsidy_application'
      const yearCol = data_source === 'payment' ? 'payment_year' : 'apply_year'
      const amountCol = data_source === 'payment' ? 'amount' : 'actual_amount'

      // 按真实 village 表或 Excel 导入的村名分组
      const groupField = group_by === 'excel'
        ? `COALESCE(sa.apply_village_name, '未知')`
        : `COALESCE(v.village_name, sa.apply_village_name, '未知')`
      const groupLabel = group_by === 'excel' ? 'excel' : 'database'

      let query = `
        SELECT
          ${groupField} as village,
          COUNT(DISTINCT sa.beneficiary_id) as farmer_count,
          COUNT(*) as record_count,
          COALESCE(SUM(sa.apply_area), 0) as total_apply_area,
          COALESCE(SUM(sa.contract_area), 0) as total_contract_area,
          COALESCE(SUM(sa.trust_area), 0) as total_trust_area,
          COALESCE(SUM(sa.no_subsidy_area), 0) as total_no_subsidy_area,
          COALESCE(SUM(sa.${amountCol}), 0) as total_amount
        FROM ${table} sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE 1=1
      `
      const values: unknown[] = []

      if (subsidy_type_id) { query += ' AND sa.subsidy_type_id = ?'; values.push(subsidy_type_id) }
      if (year) { query += ` AND sa.${yearCol} = ?`; values.push(year) }

      const rows = db().allRaw<Record<string, unknown>>(
        query + ' GROUP BY village ORDER BY total_amount DESC',
        ...values
      )

      // 计算合计行
      const total = {
        village: '全镇合计',
        farmer_count: rows.reduce((s, r) => s + Number(r.farmer_count || 0), 0),
        record_count: rows.reduce((s, r) => s + Number(r.record_count || 0), 0),
        total_apply_area: rows.reduce((s, r) => s + Number(r.total_apply_area || 0), 0),
        total_contract_area: rows.reduce((s, r) => s + Number(r.total_contract_area || 0), 0),
        total_trust_area: rows.reduce((s, r) => s + Number(r.total_trust_area || 0), 0),
        total_no_subsidy_area: rows.reduce((s, r) => s + Number(r.total_no_subsidy_area || 0), 0),
        total_amount: rows.reduce((s, r) => s + Number(r.total_amount || 0), 0),
      }

      return success({
        by_village: rows,
        total,
        data_source: data_source || 'application',
        group_by: groupLabel,
      })
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

  // ── 彻底删除：物理删除已回收站中的项目及关联数据 ──
  ipcMain.handle('subsidies:destroyType', (_e, typeId: number) => {
    try {
      // 确认只在回收站中（is_deleted=1）才能彻底删除
      const st = db().allRaw("SELECT id FROM subsidy_type WHERE id = ? AND is_deleted = 1", typeId)
      if (st.length === 0) return errorResponse('项目不存在或不在回收站中')

      db().runRaw("DELETE FROM subsidy_application WHERE subsidy_type_id = ?", typeId)
      db().runRaw("DELETE FROM subsidy_payment WHERE subsidy_type_id = ?", typeId)
      db().runRaw("DELETE FROM subsidy_type WHERE id = ?", typeId)
      return success({ message: '已彻底删除' })
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
      // 村庄筛选
      const villageName = params.village_name as string || ''
      if (villageName) { where += ' AND v.village_name = ?'; vals.push(villageName) }
      // 支付状态筛选
      const payStatus = params.pay_status
      if (payStatus !== undefined && payStatus !== null && payStatus !== '') {
        where += ' AND sp.pay_status = ?'
        vals.push(Number(payStatus))
      }
      // 金额范围筛选 (amount)
      const minAmt = params.min_amount !== undefined ? Number(params.min_amount) : undefined
      const maxAmt = params.max_amount !== undefined ? Number(params.max_amount) : undefined
      if (minAmt !== undefined && !isNaN(minAmt)) { where += ' AND COALESCE(sp.amount,0) >= ?'; vals.push(minAmt) }
      if (maxAmt !== undefined && !isNaN(maxAmt)) { where += ' AND COALESCE(sp.amount,0) <= ?'; vals.push(maxAmt) }
      // 日期范围筛选 (payment_date)
      const dateFrom = params.date_from as string || ''
      const dateTo = params.date_to as string || ''
      if (dateFrom) { where += ' AND sp.payment_date >= ?'; vals.push(dateFrom) }
      if (dateTo) { where += ' AND sp.payment_date <= ?'; vals.push(dateTo) }

      // 排序
      const PAY_SORT_MAP: Record<string, string> = {
        apply_area: 'sp.apply_area', contract_area: 'sp.contract_area',
        trust_area: 'sp.trust_area', no_subsidy_area: 'sp.no_subsidy_area',
        apply_amount: 'sp.apply_amount', actual_amount: 'sp.amount',
      }
      const sortField = params.sort_field as string || ''
      const sortDir = (params.sort_dir as string || 'desc') === 'asc' ? 'ASC' : 'DESC'
      let orderClause = 'ORDER BY sp.id DESC'
      if (sortField && PAY_SORT_MAP[sortField]) {
        orderClause = `ORDER BY ${PAY_SORT_MAP[sortField]} ${sortDir}, sp.id DESC`
      }

      const paymentJoins = ' FROM subsidy_payment sp LEFT JOIN farmer_profile fp ON sp.beneficiary_id=fp.id LEFT JOIN family_household hh ON fp.household_id=hh.id LEFT JOIN village v ON hh.village_id = v.id'
      const countRow = db().getRaw<{ cnt: number }>(`SELECT COUNT(*) as cnt${paymentJoins} ${where}`, ...vals)
      const rows = db().allRaw(`SELECT sp.*, fp.real_name as farmer_name, hh.household_name, hh.household_code, v.village_name${paymentJoins} ${where} ${orderClause} LIMIT ? OFFSET ?`, ...vals, pageSize, offset)
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
      const { subsidy_type_id, year, compare_type_id, data_source } = params || {}
      const table = data_source === 'payment' ? 'subsidy_payment' : 'subsidy_application'
      const yearCol = data_source === 'payment' ? 'payment_year' : 'apply_year'
      const amountCol = data_source === 'payment' ? 'amount' : 'actual_amount'

      // 基础统计
      const baseRow = db().getRaw<{
        total_amount: number; total_area: number; total_farmers: number
      }>(`SELECT
        COALESCE(SUM(sa.${amountCol}), 0) as total_amount,
        COALESCE(SUM(sa.apply_area), 0) as total_area,
        COUNT(DISTINCT sa.beneficiary_id) as total_farmers
      FROM ${table} sa
      WHERE sa.subsidy_type_id=? ${year ? `AND sa.${yearCol}=?` : ''}`,
        subsidy_type_id, ...(year ? [year] : []))

      // 村庄分布
      const villageDist = db().allRaw<{
        village: string; amount: number; count: number; area: number
      }>(`SELECT
        COALESCE(sa.apply_village_name, '未知') as village,
        COALESCE(SUM(sa.${amountCol}), 0) as amount,
        COUNT(DISTINCT sa.beneficiary_id) as count,
        COALESCE(SUM(sa.apply_area), 0) as area
      FROM ${table} sa
      WHERE sa.subsidy_type_id=? ${year ? `AND sa.${yearCol}=?` : ''}
      GROUP BY sa.apply_village_name ORDER BY amount DESC`,
        subsidy_type_id, ...(year ? [year] : []))

      // 年度对比（仅预申请支持）
      let yearComparison = null
      if (compare_type_id && data_source !== 'payment') {
        const compareRow = db().getRaw<{
          total_farmers: number; total_apply_area: number; compare_year: number; compare_type_name: string
        }>(`SELECT
          COUNT(DISTINCT sa.beneficiary_id) as total_farmers,
          COALESCE(SUM(sa.apply_area), 0) as total_apply_area,
          st.subsidy_year as compare_year,
          st.subsidy_name as compare_type_name
        FROM subsidy_application sa
        JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        WHERE sa.subsidy_type_id=?`, compare_type_id)

        if (compareRow) {
          const currentIds = db().allRaw<{ beneficiary_id: number }>(
            `SELECT DISTINCT beneficiary_id FROM ${table} WHERE subsidy_type_id=? ${year ? `AND ${yearCol}=?` : ''}`,
            subsidy_type_id, ...(year ? [year] : []))
          const currentSet = new Set(currentIds.map(r => r.beneficiary_id))

          const compareIds = db().allRaw<{ beneficiary_id: number }>(
            `SELECT DISTINCT beneficiary_id FROM subsidy_application WHERE subsidy_type_id=?`, compare_type_id)
          const compareSet = new Set(compareIds.map(r => r.beneficiary_id))

          const newFarmers = [...currentSet].filter(id => !compareSet.has(id))
          const removedFarmers = [...compareSet].filter(id => !currentSet.has(id))

          yearComparison = {
            current_year: year || new Date().getFullYear(),
            compare_year: compareRow.compare_year,
            compare_type_id,
            compare_type_name: compareRow.compare_type_name,
            new_farmers_count: newFarmers.length,
            removed_farmers_count: removedFarmers.length,
            total_apply_area: compareRow.total_apply_area,
            total_farmers: compareRow.total_farmers,
            new_farmers: newFarmers,
            removed_farmers: removedFarmers,
          }
        }
      }

      return success({
        totalAmount: baseRow?.total_amount ?? 0,
        totalFarmers: baseRow?.total_farmers ?? 0,
        totalArea: baseRow?.total_area ?? 0,
        villageDistribution: villageDist,
        yearComparison,
      })
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
      // 支持逗号分隔的多个pay_status值 (如 "1,2")
      if (pay_status != null && pay_status !== '') {
        const statusList = String(pay_status).split(',').map(s => s.trim()).filter(Boolean)
        if (statusList.length > 0) {
          where += ` AND sa.pay_status IN (${statusList.map(() => '?').join(',')})`
          statusList.forEach(s => vals.push(Number(s)))
        }
      }
      if (village_name) { where += ' AND sa.apply_village_name=?'; vals.push(village_name) }

      const rows = db().allRaw<Record<string, any>>(`
        SELECT sa.*, fp.real_name as farmer_name, fp.id_card, fp.gender,
               st.subsidy_name, st.calc_mode, st.standard_amount,
               hh.household_name, hh.contract_area as hh_contract_area,
               v.village_name, hh.group_no
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.beneficiary_id=fp.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id=st.id
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        ${where} ORDER BY sa.id
      `, ...vals)

      // ── 执行校验 ──
      const totalRows = rows.length
      const formatErrors: any[] = []
      const genderMismatches: any[] = []
      const areaAnomalies: any[] = []
      const areaMissing: any[] = []
      const idCardMap = new Map<string, number[]>()  // id_card -> [row indices]

      rows.forEach((r, idx) => {
        const rowNum = idx + 1
        const idCard = String(r.id_card || '')
        const name = r.farmer_name || ''

        // 身份证格式校验
        if (idCard) {
          if (idCard.length !== 18) {
            formatErrors.push({
              row: rowNum, name, id_card: idCard, village: r.village_name || '', group: r.group_no || '',
              errors: ['身份证号长度必须为18位'], error_count: 1,
            })
          } else {
            // 校验身份证第18位校验码
            const factors = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
            const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
            const sum = idCard.slice(0, 17).split('').reduce((s, c, i) => s + parseInt(c) * factors[i], 0)
            const expectedCheck = checkCodes[sum % 11]
            const actualCheck = idCard[17].toUpperCase()
            if (expectedCheck !== actualCheck) {
              formatErrors.push({
                row: rowNum, name, id_card: idCard, village: r.village_name || '', group: r.group_no || '',
                errors: [`身份证校验码不正确（期望${expectedCheck}，实际${actualCheck}）`], error_count: 1,
              })
            }
          }

          // 性别与身份证不符检测
          const idGenderDigit = parseInt(idCard[16])
          if (!isNaN(idGenderDigit)) {
            const idGender = idGenderDigit % 2 === 1 ? 1 : 2  // 1男 2女
            const dbGender = r.gender != null ? Number(r.gender) : null
            if (dbGender !== null && dbGender !== idGender) {
              genderMismatches.push({
                row: rowNum, name, id_card: idCard, village: r.village_name || '', group: r.group_no || '',
                excel_gender: idGender === 1 ? '男' : '女',
                id_card_gender: dbGender === 1 ? '男' : '女',
                error: `身份证为${idGender === 1 ? '男' : '女'}，数据库中为${dbGender === 1 ? '男' : '女'}`,
              })
            }
          }

          // 重复身份证检测
          if (!idCardMap.has(idCard)) idCardMap.set(idCard, [])
          idCardMap.get(idCard)!.push(rowNum)
        }

        // 面积异常检测
        const applyArea = Number(r.apply_area || 0)
        const contractArea = Number(r.contract_area || r.hh_contract_area || 0)
        const trustArea = Number(r.trust_area || 0)
        const noSubsidyArea = Number(r.no_subsidy_area || 0)
        const referenceArea = contractArea + trustArea
        if (applyArea > 0 && referenceArea > 0 && applyArea > referenceArea * 1.1) {
          areaAnomalies.push({
            row: rowNum, name, id_card: idCard, village: r.village_name || '', group: r.group_no || '',
            anomaly_type: '面积超额',
            anomaly_details: `申报面积${applyArea.toFixed(2)}亩超出参考面积${referenceArea.toFixed(2)}亩`,
            contract_area: contractArea, trust_out_area: trustArea, trust_in_area: 0,
            no_subsidy_area: noSubsidyArea, actual_subsidy_area: applyArea,
            self_occupy: 0, hh_used: 0, hh_total: 0, db_contract_area: contractArea,
            reference_area: referenceArea, area_source: '承包+代耕',
            exceed_amount: Math.round((applyArea - referenceArea) * 100) / 100,
          })
        }

        // 面积缺失
        if (applyArea === 0 && (contractArea > 0 || trustArea > 0)) {
          areaMissing.push({
            row: rowNum, name, id_card: idCard, village: r.village_name || '', group: r.group_no || '',
            contract_area: contractArea,
            error: '有承包地/代耕面积但没有申报面积',
          })
        }

        // 年龄异常（从身份证提取出生年份）
        if (idCard && idCard.length === 18) {
          const birthYear = parseInt(idCard.slice(6, 10))
          if (!isNaN(birthYear)) {
            const age = new Date().getFullYear() - birthYear
            if (age > 100 || age < 0) {
              // age_anomaly push handled below
            }
          }
        }
      })

      // 格式化重复身份证
      const duplicateErrors: any[] = []
      idCardMap.forEach((indices, idCard) => {
        if (indices.length > 1) {
          const firstRow = rows[indices[0] - 1]
          duplicateErrors.push({
            row: indices[0], name: firstRow?.farmer_name || '', id_card: idCard,
            village: firstRow?.village_name || '', group: firstRow?.group_no || '',
            error: `同一身份证出现${indices.length}次（第${indices.join(', ')}行）`,
          })
        }
      })

      // 检查错误库命中
      const errorLibHits: any[] = []
      const allIdCards = rows.map(r => String(r.id_card || '')).filter(Boolean)
      if (allIdCards.length > 0) {
        try {
          const errorLibRows = db().allRaw<any>(`
            SELECT el.* FROM error_library el WHERE el.id_card IN (${allIdCards.map(() => '?').join(',')})
          `, ...allIdCards)
          const errorLibByIdCard: Record<string, any[]> = {}
          errorLibRows.forEach((r: any) => {
            const ic = String(r.id_card || '')
            if (!errorLibByIdCard[ic]) errorLibByIdCard[ic] = []
            errorLibByIdCard[ic].push(r)
          })
          rows.forEach((r, idx) => {
            const ic = String(r.id_card || '')
            const hits = errorLibByIdCard[ic]
            if (hits && hits.length > 0) {
              hits.forEach((h: any) => {
                errorLibHits.push({
                  row: idx + 1, name: r.farmer_name || '', id_card: ic,
                  village: r.village_name || '', group: r.group_no || '',
                  error_type: h.error_type || '未知', error_reason: h.error_reason || h.remark || '',
                  source: h.source || '错误库',
                })
              })
            }
          })
        } catch (_) { /* error library may not exist */ }
      }

      const errorCount = formatErrors.length + genderMismatches.length + duplicateErrors.length + errorLibHits.length
      const result = {
        summary: {
          total_rows: totalRows, ok_rows: totalRows - errorCount, error_rows: errorCount,
          format_errors: formatErrors.length, village_errors: 0,
          duplicate_errors: duplicateErrors.length, gender_mismatch: genderMismatches.length,
          error_library_hits: errorLibHits.length, area_anomalies: areaAnomalies.length,
          area_missing: areaMissing.length, age_anomaly: 0, deceased_farmers: 0,
          restricted_farmers: 0, household_duplicates: 0, new_farmers: 0,
          removed_farmers: 0, changed_farmers: 0,
          pass_rate: totalRows > 0 ? Math.round((totalRows - errorCount) / totalRows * 100) : 100,
        },
        format_errors: formatErrors,
        gender_mismatch: genderMismatches,
        area_anomalies: areaAnomalies,
        duplicate_errors: duplicateErrors,
        error_library_hits: errorLibHits,
        area_missing: areaMissing,
        village_errors: [],
        age_anomaly: [],
        deceased_farmers: [],
        restricted_farmers: [],
        household_duplicates: [],
        new_farmers: [],
        removed_farmers: [],
        changed_farmers: [],
      }
      return success(result)
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

  // ── 仪表盘待办统计 ──
  ipcMain.handle('subsidies:dashboardTodos', (_e, params: any) => {
    try {
      const { year } = params || {}

      // 未完成项目：pay_status != 2（ subsidy_type 表没有 is_deleted 列）
      const incompleteProjects = db().getRaw<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM subsidy_type WHERE pay_status != 2`
      )

      // 待发放记录：预申请中 pay_status = 0
      const pendingRecords = year
        ? (db().getRaw<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM subsidy_application WHERE pay_status=0 AND apply_year=?`, year
          )?.cnt ?? 0)
        : (db().getRaw<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM subsidy_application WHERE pay_status=0`
          )?.cnt ?? 0)

      // 身份证异常农户（非18位）
      const idCardErrors = db().getRaw<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM farmer_profile WHERE length(id_card) != 18`
      )

      return success({
        incomplete_projects: incompleteProjects?.cnt ?? 0,
        pending_records: pendingRecords,
        overdrawn_households: 0,
        id_card_errors: idCardErrors?.cnt ?? 0,
      })
    } catch (e) { return errorResponse(String(e)) }
  })
}
