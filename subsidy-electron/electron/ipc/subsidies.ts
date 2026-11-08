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
               hh.id as household_id,
               st.subsidy_name, st.season, st.calc_mode,
               COALESCE(NULLIF(sa.apply_village_name,''), v.village_name) as village,
               COALESCE(NULLIF(sa.apply_group_display,''), CAST(hh.group_no AS TEXT)) as group_no
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
      // 统计口径：全部记录都算，不按 pay_status 过滤
      // 理由：反映「今年确定要发多少钱」，而非「已发出去多少钱」；
      //       与 summaryByVillage / summaryBySeason 保持口径一致，三处金额之和必须对得上。
      // 当年统计
      const current = db().getRaw<{ total_amount: number; farmer_count: number; application_count: number }>(`
        SELECT COALESCE(SUM(sa.actual_amount), 0) as total_amount,
               COUNT(DISTINCT sa.beneficiary_id) as farmer_count,
               COUNT(*) as application_count
        FROM subsidy_application sa
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        WHERE sa.apply_year = ? AND COALESCE(st.is_deleted, 0) = 0
      `, year)

      // 上一年统计（同样全量口径，保证同比可比）
      const prev = db().getRaw<{ total_amount: number; farmer_count: number; application_count: number }>(`
        SELECT COALESCE(SUM(sa.actual_amount), 0) as total_amount,
               COUNT(DISTINCT sa.beneficiary_id) as farmer_count,
               COUNT(*) as application_count
        FROM subsidy_application sa
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        WHERE sa.apply_year = ? AND COALESCE(st.is_deleted, 0) = 0
      `, year - 1)

      // 当年受益农户ID（统计基础与总额一致：全量）
      const curFarmers = db().allRaw<{ beneficiary_id: number; id: number; real_name: string; village_name: string; farmer_status: number }>(
        `SELECT DISTINCT sa.beneficiary_id, fp.id, fp.real_name, COALESCE(sa.apply_village_name, '') as village_name, fp.farmer_status
         FROM subsidy_application sa
         JOIN farmer_profile fp ON sa.beneficiary_id = fp.id
         LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
         WHERE sa.apply_year = ? AND COALESCE(st.is_deleted, 0) = 0`, year
      )
      const curIds = new Set(curFarmers.map(f => f.beneficiary_id))

      // 上一年受益农户ID（全量，保证新增/退出农户口径与总额一致）
      const prevFarmers = db().allRaw<{ beneficiary_id: number }>(
        `SELECT DISTINCT sa.beneficiary_id
         FROM subsidy_application sa
         LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
         WHERE sa.apply_year = ? AND COALESCE(st.is_deleted, 0) = 0`, year - 1
      )
      const prevIds = new Set(prevFarmers.map(f => f.beneficiary_id))

      // 新增农户：当年有，上年无
      const newFarmers = curFarmers
        .filter(f => !prevIds.has(f.beneficiary_id))
        .map(f => ({ id: f.id, name: f.real_name, village: f.village_name, status: f.farmer_status }))

      // 退出农户：上年有，当年无
      const exitFarmers = prevFarmers
        .filter(f => !curIds.has(f.beneficiary_id))
        .map(f => {
          const fp = db().getRaw<{ id: number; real_name: string; village_name: string; farmer_status: number }>(
            `SELECT id, real_name, COALESCE(apply_village_name, '') as village_name, farmer_status
             FROM farmer_profile fp
             LEFT JOIN subsidy_application sa ON sa.beneficiary_id = fp.id AND sa.apply_year = ?
             WHERE fp.id = ? LIMIT 1`, year, f.beneficiary_id
          )
          return { id: f.beneficiary_id, name: fp?.real_name ?? '未知', village: fp?.village_name ?? '', status: fp?.farmer_status ?? 0 }
        })

      const curAmount = current?.total_amount ?? 0
      const prevAmount = prev?.total_amount ?? 0
      const amountDiff = curAmount - prevAmount
      const amountDiffPct = prevAmount > 0 ? Math.round((amountDiff / prevAmount) * 10000) / 100 : null

      return success({
        current_year: { year, total_amount: curAmount, farmer_count: current?.farmer_count ?? 0, application_count: current?.application_count ?? 0 },
        last_year: { year: year - 1, total_amount: prevAmount, farmer_count: prev?.farmer_count ?? 0, application_count: prev?.application_count ?? 0 },
        new_farmers: newFarmers,
        exit_farmers: exitFarmers,
        amount_diff: amountDiff,
        amount_diff_pct: amountDiffPct,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('subsidies:summaryByVillage', (_e, year: number) => {
    try {
      // 统计口径：全部记录都算，不按 pay_status 过滤（与 yearCompare 一致）
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
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        WHERE sa.apply_year = ? AND COALESCE(st.is_deleted, 0) = 0
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
      // 统计口径：全部记录都算，不按 pay_status 过滤（与 yearCompare 一致）
      const rows = db().allRaw(`
        SELECT st.season,
               COUNT(DISTINCT st.id) as project_count,
               COUNT(DISTINCT sa.beneficiary_id) as farmer_count,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount,
               COALESCE(SUM(sa.apply_area), 0) as total_area,
               COUNT(*) as application_count
        FROM subsidy_application sa
        JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        WHERE sa.apply_year = ? AND COALESCE(st.is_deleted, 0) = 0
        GROUP BY st.season
      `, year)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ═══════════════════ 批量导入申请 ═══════════════════

  // subsidy_application 表允许的列
  const APP_COLS = new Set([
    'farmer_id', 'beneficiary_id', 'subsidy_type_id', 'apply_year',
    'apply_amount', 'actual_amount', 'apply_area', 'apply_area_no_calc',
    'contract_area', 'trust_area', 'no_subsidy_area',
    'pay_status', 'pay_date', 'apply_village_id', 'apply_group_no',
    'apply_village_id', 'apply_group_no',
    'apply_village_name', 'apply_group_display', 'bank_card_snapshot',
    'operator_id', 'remark', 'is_proxy',
  ])

  ipcMain.handle('subsidies:batchImportApplications', (_e, payload: any) => {
    try {
      if (!payload || !Array.isArray(payload.rows)) {
        console.error('[batchImportApplications] 无效的payload:', JSON.stringify(payload))
        return errorResponse('导入数据格式异常：缺少 rows 数组，请联系管理员')
      }
      const { rows } = payload
      const inserted: number[] = []
      const updated: number[] = []
      const errors: { row: number; message: string }[] = []

      db().beginTransaction()
      try {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          if (!row || typeof row !== 'object') {
            errors.push({ row: i, message: `第${i+1}条数据格式异常` })
            continue
          }
          // 过滤掉表中不存在的列
          const safe: Record<string, unknown> = {}
          for (const k of Object.keys(row)) {
            if (APP_COLS.has(k)) safe[k] = row[k]
          }
          try {
            // 检查是否已存在：同一年度、同一补贴类型、同一受益人
            const existing = db().getRaw<Record<string, unknown>>(`
              SELECT id FROM subsidy_application
              WHERE apply_year = ? AND subsidy_type_id = ? AND beneficiary_id = ?
            `, safe.apply_year, safe.subsidy_type_id, safe.beneficiary_id)

            if (existing) {
              const keys = Object.keys(safe).filter(k => safe[k] !== undefined && k !== 'id')
              const sets = keys.map(k => `${k} = ?`).join(', ')
              db().runRaw(`UPDATE subsidy_application SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...keys.map(k => safe[k]), existing.id)
              updated.push(existing.id as number)
            } else {
              const cols = Object.keys(safe).filter(k => safe[k] !== undefined).join(', ')
              const vals = Object.keys(safe).filter(k => safe[k] !== undefined).map(k => safe[k])
              db().runRaw(`INSERT INTO subsidy_application (${cols}) VALUES (${vals.map(() => '?').join(',')})`, ...vals)
              inserted.push(db().getRaw<{ id: number }>('SELECT last_insert_rowid() as id')?.id ?? 0)
            }
          } catch (rowErr) {
            errors.push({ row: i + 1, message: String(rowErr) })
          }
        }
      } finally {
        db().commitTransaction()
      }

      return success({
        total: rows.length,
        created: inserted.length,
        updated: updated.length,
        skipped: 0,
        errors: errors.map(e => `第${e.row}行：${e.message}`),
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
          COALESCE(SUM(sa.apply_area_no_calc), 0) as total_apply_area_no_calc,
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
        total_apply_area_no_calc: rows.reduce((s, r) => s + Number(r.total_apply_area_no_calc || 0), 0),
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
  // 存于 subsidy_type.check_config（JSON 文本）。未配置时返回空配置，由前端套用默认值。
  ipcMain.handle('subsidies:getCheckConfig', (_e, typeId: number) => {
    try {
      const raw = db().getRaw<{ check_config: string | null }>(
        'SELECT check_config FROM subsidy_type WHERE id = ?', typeId
      )
      if (!raw?.check_config) return success({ check_config: { checks: {} }, raw: null })
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.check_config)
      } catch {
        // 历史脏数据：按未配置处理，不阻塞编辑
        return success({ check_config: { checks: {} }, raw: raw.check_config })
      }
      return success({ check_config: parsed, raw: raw.check_config })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:updateCheckConfig', (_e, payload: { typeId: number; config: unknown }) => {
    try {
      const typeId = Number(payload?.typeId)
      if (!typeId) return errorResponse('缺少类型ID')
      const text = payload?.config == null ? null : JSON.stringify(payload.config)
      db().runRaw(
        'UPDATE subsidy_type SET check_config = ? WHERE id = ?',
        text, typeId
      )
      return success(null, '预检方案已保存')
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
      const rows = db().allRaw(`
        SELECT sa.*, fp.real_name as farmer_name, fp.id_card, fp.phone,
               COALESCE(NULLIF(sa.apply_village_name,''), v.village_name) as village,
               COALESCE(NULLIF(sa.apply_group_display,''), CAST(hh.group_no AS TEXT)) as group_no
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE sa.subsidy_type_id = ?
      `, subsidyTypeId)
      return success({ items: rows })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:exportPayments', (_e, subsidyTypeId: number) => {
    try {
      const rows = db().allRaw(`
        SELECT sp.*, fp.real_name as farmer_name, fp.id_card, fp.phone,
               COALESCE(NULLIF(sp.payment_village_name,''), v.village_name) as village,
               COALESCE(NULLIF(sp.payment_group_display,''), CAST(hh.group_no AS TEXT)) as group_no
        FROM subsidy_payment sp
        LEFT JOIN farmer_profile fp ON sp.beneficiary_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE sp.subsidy_type_id = ?
      `, subsidyTypeId)
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
      // 注意：subsidy_payment 表没有 apply_amount 列，金额只在 amount 中；
      // apply_amount 与 actual_amount 都映射到 sp.amount，避免点表头排序时 SQL 报错
      const PAY_SORT_MAP: Record<string, string> = {
        apply_area: 'sp.apply_area', apply_area_no_calc: 'sp.apply_area_no_calc',
        contract_area: 'sp.contract_area',
        trust_area: 'sp.trust_area', no_subsidy_area: 'sp.no_subsidy_area',
        apply_amount: 'sp.amount', actual_amount: 'sp.amount',
      }
      const sortField = params.sort_field as string || ''
      const sortDir = (params.sort_dir as string || 'desc') === 'asc' ? 'ASC' : 'DESC'
      let orderClause = 'ORDER BY sp.id DESC'
      if (sortField && PAY_SORT_MAP[sortField]) {
        orderClause = `ORDER BY ${PAY_SORT_MAP[sortField]} ${sortDir}, sp.id DESC`
      }

      const paymentJoins = ' FROM subsidy_payment sp LEFT JOIN farmer_profile fp ON sp.beneficiary_id=fp.id LEFT JOIN family_household hh ON fp.household_id=hh.id LEFT JOIN village v ON hh.village_id = v.id'
      const countRow = db().getRaw<{ cnt: number }>(`SELECT COUNT(*) as cnt${paymentJoins} ${where}`, ...vals)
      const rows = db().allRaw(`SELECT sp.*, fp.real_name as farmer_name, hh.id as household_id,
        hh.household_name, hh.household_code,
        COALESCE(NULLIF(sp.payment_village_name,''), v.village_name) as village,
        COALESCE(NULLIF(sp.payment_group_display,''), CAST(hh.group_no AS TEXT)) as group_no
        ${paymentJoins} ${where} ${orderClause} LIMIT ? OFFSET ?`, ...vals, pageSize, offset)
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
        const result = db().runRaw('DELETE FROM subsidy_application WHERE subsidy_type_id=?', payload.subsidy_type_id)
        return success({ deleted: result.changes, message: `已全部删除 ${result.changes} 条` })
      }
      for (const id of (payload.ids || [])) db().runRaw('DELETE FROM subsidy_application WHERE id=?', id)
      return success({ deleted: (payload.ids||[]).length, message: `已删除 ${(payload.ids||[]).length} 条` })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('subsidies:batchDeletePayments', (_e, payload: any) => {
    try {
      if (payload.delete_all) {
        const result = db().runRaw('DELETE FROM subsidy_payment WHERE subsidy_type_id=?', payload.subsidy_type_id)
        return success({ deleted: result.changes, message: `已全部删除 ${result.changes} 条` })
      }
      for (const id of (payload.ids || [])) db().runRaw('DELETE FROM subsidy_payment WHERE id=?', id)
      return success({ deleted: (payload.ids||[]).length, message: `已删除 ${(payload.ids||[]).length} 条` })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 预申请转发放 ──
  ipcMain.handle('subsidies:convertToPayment', (_e, payload: any) => {
    try {
      const ids: number[] = Array.isArray(payload?.application_ids) ? payload.application_ids : []
      if (ids.length === 0) return errorResponse('请提供要转换的预申请记录ID列表')

      let created = 0
      let skipped = 0
      const errors: string[] = []

      db().beginTransaction()
      try {
        for (const appId of ids) {
          const app = db().getRaw<any>('SELECT * FROM subsidy_application WHERE id=?', appId)
          if (!app) { errors.push(`记录#${appId}：预申请不存在`); continue }
          const farmer = db().getRaw<any>('SELECT * FROM farmer_profile WHERE id=?', app.farmer_id)
          if (!farmer) { errors.push(`记录#${appId}：农户不存在`); continue }

          // 发放记录唯一键：农户 + 补贴类型 + 年度
          const exist = db().getRaw<{ id: number }>(
            'SELECT id FROM subsidy_payment WHERE farmer_id=? AND subsidy_type_id=? AND payment_year=?',
            app.farmer_id, app.subsidy_type_id, app.apply_year
          )
          if (exist) {
            skipped++
            if (Number(app.pay_status) !== 2) {
              db().runRaw("UPDATE subsidy_application SET pay_status=2, updated_at=datetime('now','localtime') WHERE id=?", appId)
            }
            continue
          }

          db().runRaw(`INSERT INTO subsidy_payment (
              farmer_id, beneficiary_id, subsidy_type_id, payment_year, amount, payment_date,
              payment_village_id, payment_group_no, payment_village_name, payment_group_display,
              apply_area, apply_area_no_calc, contract_area, trust_area, no_subsidy_area,
              bank_card, bank_name, remark, pay_status, is_proxy
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            app.farmer_id, app.beneficiary_id || app.farmer_id, app.subsidy_type_id, app.apply_year,
            app.actual_amount ?? app.apply_amount, app.pay_date,
            app.apply_village_id, app.apply_group_no, app.apply_village_name, app.apply_group_display,
            app.apply_area, app.apply_area_no_calc, app.contract_area, app.trust_area, app.no_subsidy_area,
            app.bank_card_snapshot ?? farmer.bank_card, farmer.bank_name, app.remark, 2, app.is_proxy ?? 0
          )
          db().runRaw("UPDATE subsidy_application SET pay_status=2, updated_at=datetime('now','localtime') WHERE id=?", appId)
          created++
        }
      } finally {
        db().commitTransaction()
      }

      return success({
        created,
        skipped,
        errors,
        message: `成功转换 ${created} 条，跳过 ${skipped} 条${errors.length ? `，失败 ${errors.length} 条` : ''}`,
      })
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
      const { subsidy_type_id, year, data_source } = params || {}
      const table = data_source === 'payment' ? 'subsidy_payment' : 'subsidy_application'
      const yearCol = data_source === 'payment' ? 'payment_year' : 'apply_year'
      const nameCol = data_source === 'payment' ? 'payment_village_name' : 'apply_village_name'
      const groupCol = data_source === 'payment' ? 'payment_group_display' : 'apply_group_display'
      const rows = db().allRaw(`SELECT sa.${nameCol} as village_name, sa.${groupCol} as group_display, COUNT(*) as cnt FROM ${table} sa WHERE sa.subsidy_type_id=? ${year?`AND sa.${yearCol}=?`:''} GROUP BY sa.${nameCol}, sa.${groupCol} ORDER BY sa.${nameCol}`, subsidy_type_id, ...(year?[year]:[]))
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 批量导入发放记录 ──
  // subsidy_payment 表允许的列
  const PAYMENT_COLS = new Set([
    'farmer_id', 'beneficiary_id', 'subsidy_type_id', 'payment_year',
    'amount', 'payment_date', 'payment_village_id', 'payment_group_no',
    'payment_village_name', 'payment_group_display',
    'apply_area', 'apply_area_no_calc', 'contract_area', 'trust_area', 'no_subsidy_area',
    'bank_card', 'bank_name', 'operator_id', 'remark', 'proxy_remark', 'pay_status', 'is_proxy',
  ])

  ipcMain.handle('subsidies:batchImportPayments', (_e, payload: any) => {
    try {
      if (!payload || !Array.isArray(payload.rows)) {
        console.error('[batchImportPayments] 无效的payload:', JSON.stringify(payload))
        return errorResponse('导入数据格式异常：缺少 rows 数组，请联系管理员')
      }
      const { rows, overwrite } = payload
      let created = 0, skipped = 0

      db().beginTransaction()
      try {
        for (const row of rows) {
          if (!row || typeof row !== 'object') { skipped++; continue }
          const safe: Record<string, unknown> = {}
          for (const k of Object.keys(row)) {
            if (PAYMENT_COLS.has(k)) safe[k] = row[k]
          }
          if (overwrite) {
            const exist = db().getRaw<{ id: number }>(
              'SELECT id FROM subsidy_payment WHERE subsidy_type_id=? AND beneficiary_id=? AND payment_year=?',
              safe.subsidy_type_id, safe.beneficiary_id, safe.payment_year)
            if (exist) { db().runRaw('DELETE FROM subsidy_payment WHERE id=?', exist.id); skipped++ }
          }
          const cols = Object.keys(safe).filter(k => safe[k] !== undefined).join(',')
          const vals = Object.keys(safe).filter(k => safe[k] !== undefined).map(k => safe[k])
          db().runRaw(`INSERT INTO subsidy_payment (${cols}) VALUES (${vals.map(() => '?').join(',')})`, ...vals)
          created++
        }
      } finally {
        db().commitTransaction()
      }
      return success({ message: `导入完成：新增${created}，覆盖${skipped}`, created, skipped, errors: [] })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 预检查／数据验证（委托给 precheck.ts 处理，此处保留兼容旧调用） ──
  // subsidies:precheck 现在由 precheck.ts 的 registerPrecheckHandlers 注册

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
      const { result, file_name, split_by_village, selected_sheets } = params || {}
      if (!result) return errorResponse('无预检结果数据')

      const XLSX = require('xlsx')
      const wb = XLSX.utils.book_new()

      // 中文名 → 英文字段映射
      const NAME_TO_FIELD: Record<string, string> = {
        '汇总': 'summary', '格式错误': 'format_errors', '村组不存在': 'village_errors',
        '重复身份证': 'duplicate_errors', '性别不符': 'gender_mismatch',
        '错误库命中': 'error_library_hits', '面积异常': 'area_anomalies',
        '承包面积缺失': 'area_missing', '年龄异常': 'age_anomaly',
        '死亡农户': 'deceased_farmers', '受限身份农户': 'restricted_farmers',
        '同一家庭多成员申请': 'household_duplicates', '新增农户': 'new_farmers',
        '减少农户': 'removed_farmers', '字段变更': 'changed_farmers',
      }

      // 从数组中提取字段名作为表头
      const getHeaders = (arr: any[]): string[] => {
        if (!arr || arr.length === 0) return []
        const seen = new Set<string>()
        const keys: string[] = []
        for (const item of arr) {
          for (const k of Object.keys(item)) {
            if (!seen.has(k)) { seen.add(k); keys.push(k) }
          }
        }
        return keys
      }

      // 字段中文名映射
      const FIELD_CN: Record<string, string> = {
        row: '行号', name: '姓名', farmer_name: '姓名', real_name: '姓名',
        id_card: '身份证号', id_card_masked: '身份证号(脱敏)',
        village: '村', group: '组', group_no: '组',
        error: '错误描述', error_message: '错误描述', errors: '错误列表',
        error_type: '错误类型', error_reason: '错误原因',
        source: '来源', anomaly_type: '异常类型', anomaly_details: '异常详情',
        contract_area: '承包面积(亩)', trust_out_area: '流出面积',
        trust_in_area: '流入面积', no_subsidy_area: '不计补贴面积',
        actual_subsidy_area: '实际补贴面积', self_occupy: '自用面积',
        hh_used: '户已用面积', hh_total: '户总面积',
        db_contract_area: '数据库承包面积', exceed_amount: '超额面积',
        reference_area: '参考面积', area_source: '面积来源',
        age: '年龄', birth_year: '出生年份',
        gender: '性别', excel_gender: 'Excel性别', id_card_gender: '身份证性别',
        household_id: '家庭户ID', total_count: '成员总数',
        other_members: '其他成员', excel_remark: 'Excel备注',
        db_existing_apps: '已有申请', note: '备注',
        db_name: '数据库姓名', db_village: '数据库村', db_group: '数据库组',
        changes: '变更内容', farmer_id: '农户ID',
        deceased_farmers: '死亡农户',
      }

      const translateHeader = (k: string) => FIELD_CN[k] || k

      const sheets = selected_sheets || Object.keys(NAME_TO_FIELD)

      for (const sheetName of sheets) {
        const field = NAME_TO_FIELD[sheetName]
        if (!field) continue

        if (field === 'summary') {
          // 汇总表：键值对格式
          const s = result.summary || {}
          const rows = Object.entries(s).map(([k, v]) => ({
            '指标': translateHeader(k),
            '数值': typeof v === 'number' ? (v % 1 === 0 ? v : Number(v.toFixed(2))) : v,
          }))
          const ws = XLSX.utils.json_to_sheet(rows)
          XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
          continue
        }

        let data = result[field]
        if (!Array.isArray(data) || data.length === 0) continue

        if (split_by_village) {
          // 按村分组
          const byVillage: Record<string, any[]> = {}
          for (const item of data) {
            const v = item.village || '未知村'
            if (!byVillage[v]) byVillage[v] = []
            byVillage[v].push(item)
          }
          for (const [vname, items] of Object.entries(byVillage)) {
            const headers = getHeaders(items)
            const rows = items.map(item => {
              const row: Record<string, unknown> = {}
              for (const h of headers) {
                const val = item[h]
                row[translateHeader(h)] = Array.isArray(val) ? val.join('；') : (val ?? '')
              }
              return row
            })
            const ws = XLSX.utils.json_to_sheet(rows)
            const safeName = `${vname}-${sheetName}`.slice(0, 31)
            XLSX.utils.book_append_sheet(wb, ws, safeName)
          }
        } else {
          const headers = getHeaders(data)
          const rows = data.map(item => {
            const row: Record<string, unknown> = {}
            for (const h of headers) {
              const val = item[h]
              row[translateHeader(h)] = Array.isArray(val) ? val.join('；') : (val ?? '')
            }
            return row
          })
          const ws = XLSX.utils.json_to_sheet(rows)
          XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
        }
      }

      // 如果没有任何工作表，放一个空汇总
      if (wb.SheetNames.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([['提示', '没有可导出的数据']])
        XLSX.utils.book_append_sheet(wb, ws, '空')
      }

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
      const base64 = (buf as Buffer).toString('base64')
      const dateStr = new Date().toISOString().slice(0, 10)
      const ext = '.xlsx'  // 分村模式也用多sheet，不需要zip
      return success({
        file_data: base64,
        filename: `${file_name || '预检查报告'}_${dateStr}${ext}`,
      })
    } catch (e) {
      console.error('[exportPrecheck]', e)
      return errorResponse(String(e))
    }
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

      // 面积超支家庭户：该户成员申请总面积 > 承包面积
      let overdrawn = 0
      if (year) {
        overdrawn = db().getRaw<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM (
            SELECT fp.household_id
            FROM subsidy_application sa
            JOIN farmer_profile fp ON sa.beneficiary_id = fp.id
            JOIN family_household hh ON fp.household_id = hh.id
            WHERE sa.apply_year = ?
            GROUP BY fp.household_id
            HAVING SUM(COALESCE(sa.apply_area, 0)) > COALESCE(hh.contract_area, 0)
          )`, year
        )?.cnt ?? 0
      }

      return success({
        incomplete_projects: incompleteProjects?.cnt ?? 0,
        pending_records: pendingRecords,
        overdrawn_households: overdrawn,
        id_card_errors: idCardErrors?.cnt ?? 0,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

}
