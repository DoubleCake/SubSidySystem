import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { parsePagination, successList, success, errorResponse } from './response'
import { maskIdCard } from '../utils/masking'
import { formatGroupNo } from '../utils/format'

// 类型标签映射
const TRUST_TYPE_LABEL: Record<string, string> = {
  ENTRUST: '代耕代种', RENT: '出租', TRANSFER: '流转', IDLE: '撂荒', COLLECTIVE: '集体统一',
}
const RELIABILITY_LABEL: Record<string, string> = {
  CERTIFIED: '有书面合同', VILLAGE_CONFIRM: '村委确认', SELF_REPORT: '农户自报', SUSPECTED: '存疑',
}
const OPERATOR_TYPE_LABEL: Record<string, string> = {
  FAMILY_FARM: '家庭农场', COOPERATIVE: '合作社', LARGE_PLANTER: '种植大户', OTHER: '其他',
}

// land_trust 可写入的白名单列
const LAND_TRUST_COLS = [
  'owner_type', 'owner_household_id', 'owner_entity_id',
  'operator_type', 'operator_household_id', 'operator_entity_id',
  'trust_type', 'area', 'trust_year', 'trust_end_year',
  'start_date', 'end_date', 'annual_fee', 'payment_method',
  'parcel_desc', 'data_reliability', 'affect_subsidy_calc',
  'subsidy_arable', 'subsidy_cash_crop', 'note',
]

export function registerLandHandlers(): void {
  const db = () => getDb()

  // ═══════════════════════════════════════════
  //  普通流转 land_trust
  // ═══════════════════════════════════════════

  ipcMain.handle('land:list', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const year = params.year ? Number(params.year) : 0
      const trustType = params.trust_type ? String(params.trust_type) : ''
      const search = params.search ? String(params.search).trim() : ''

      // 联表查询公共 SELECT 片段：把 owner/operator 名称解析出来
      // 注意：SQLite 不支持 CONCAT，字符串拼接用 ||
      const selectOwnerName = `
        CASE
          WHEN lt.owner_type = 'village' THEN (SELECT v.village_name FROM village v WHERE v.id = lt.owner_entity_id)
          WHEN lt.owner_type = 'village_group' THEN (SELECT v.village_name || '-' || vg.group_no FROM village_group vg JOIN village v ON vg.village_id = v.id WHERE vg.id = lt.owner_entity_id)
          ELSE hh_o.household_name
        END AS owner_name`
      const selectOperatorName = `
        CASE
          WHEN lt.operator_type = 'village' THEN (SELECT v.village_name FROM village v WHERE v.id = lt.operator_entity_id)
          WHEN lt.operator_type = 'village_group' THEN (SELECT v.village_name || '-' || vg.group_no FROM village_group vg JOIN village v ON vg.village_id = v.id WHERE vg.id = lt.operator_entity_id)
          ELSE hh_op.household_name
        END AS operator_name`

      const base = `
        FROM land_trust lt
        LEFT JOIN family_household hh_o ON lt.owner_type = 'household' AND hh_o.id = lt.owner_household_id
        LEFT JOIN family_household hh_op ON lt.operator_type = 'household' AND hh_op.id = lt.operator_household_id
      `

      // 过滤条件（普通流转）
      const conds: string[] = []
      const cParams: unknown[] = []
      if (year) { conds.push('lt.trust_year = ?'); cParams.push(year) }
      if (trustType) { conds.push('lt.trust_type = ?'); cParams.push(trustType) }
      if (search) {
        conds.push(`(
          hh_o.household_name LIKE ? OR hh_op.household_name LIKE ? OR
          (SELECT v.village_name FROM village v WHERE v.id = lt.owner_entity_id) LIKE ? OR
          (SELECT v.village_name FROM village v WHERE v.id = lt.operator_entity_id) LIKE ?
        )`)
        cParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
      }
      const whereNormal = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

      // 普通流转：显式列（与大户流转 UNION 列对齐，禁止 lt.* 以免列数不一致）
      const normalSql = `
        SELECT lt.id, lt.owner_type, lt.owner_household_id, lt.owner_entity_id,
               lt.operator_type, lt.operator_household_id, lt.operator_entity_id,
               lt.trust_type, lt.area, lt.trust_year, lt.trust_end_year,
               lt.start_date, lt.end_date, lt.annual_fee, lt.payment_method,
               lt.parcel_desc, lt.data_reliability, lt.affect_subsidy_calc,
               lt.subsidy_arable, lt.subsidy_cash_crop,
               lt.note, lt.operator, lt.is_active, lt.created_at, lt.updated_at,
               'normal' AS source_type,
               NULL AS large_farmer_name, NULL AS large_farmer_type,
               NULL AS large_farmer_type_label, NULL AS parcel_village_name,
               NULL AS parcel_group_no, NULL AS is_high_standard, NULL AS is_demonstration,
               ${selectOwnerName},
               CASE WHEN lt.owner_type = 'household' THEN hh_o.household_code END AS owner_code,
               ${selectOperatorName},
               CASE WHEN lt.operator_type = 'household' THEN hh_op.household_code END AS operator_code
        ${base} ${whereNormal}
      `

      // 大户流转：large_farmer_trust 关联 large_farmer，operator 为大户
      const largeConds: string[] = []
      const largeParams: unknown[] = []
      if (year) { largeConds.push('lft.trust_year = ?'); largeParams.push(year) }
      if (trustType) { largeConds.push('lft.trust_type = ?'); largeParams.push(trustType) }
      if (search) {
        largeConds.push(`(hh_o.household_name LIKE ? OR lf.operator_name LIKE ?)`)
        largeParams.push(`%${search}%`, `%${search}%`)
      }
      const whereLarge = largeConds.length ? `WHERE ${largeConds.join(' AND ')}` : ''

      const largeSql = `
        SELECT lft.id,
               'household' AS owner_type, lft.owner_household_id, NULL AS owner_entity_id,
               'large_farmer' AS operator_type, NULL AS operator_household_id, NULL AS operator_entity_id,
               lft.trust_type, lft.area, lft.trust_year, NULL AS trust_end_year,
               lft.start_date, lft.end_date, lft.annual_fee, lft.payment_method,
               lft.parcel_desc, lft.data_reliability, lft.affect_subsidy_calc,
               NULL AS subsidy_arable, NULL AS subsidy_cash_crop,
               lft.note, lft.operator, lft.is_active, lft.created_at, lft.updated_at,
               'large_farmer' AS source_type,
               lf.operator_name AS large_farmer_name, lf.operator_type AS large_farmer_type,
               NULL AS large_farmer_type_label,
               (SELECT v.village_name FROM village v WHERE v.id = lft.parcel_village_id) AS parcel_village_name,
               lft.parcel_group_no, lft.is_high_standard, lft.is_demonstration,
               hh_o.household_name AS owner_name,
               hh_o.household_code AS owner_code,
               lf.operator_name AS operator_name,
               NULL AS operator_code
        FROM large_farmer_trust lft
        LEFT JOIN family_household hh_o ON hh_o.id = lft.owner_household_id
        LEFT JOIN large_farmer lf ON lf.id = lft.large_farmer_id
        ${whereLarge}
      `

      // UNION 后整体排序分页（整个 UNION 作为 FROM 子查询）
      const unionBody = `${normalSql} UNION ALL ${largeSql}`
      const fullSql = `SELECT * FROM (${unionBody}) ORDER BY id DESC LIMIT ? OFFSET ?`
      const countSql = `SELECT COUNT(*) as cnt FROM (${unionBody})`

      const rows = db().allRaw<Record<string, unknown>>(fullSql, ...cParams, ...largeParams, pageSize, offset)
      const countRow = db().getRaw<{ cnt: number }>(countSql, ...cParams, ...largeParams)

      const items = rows.map(r => ({
        ...r,
        trust_type_label: TRUST_TYPE_LABEL[String(r.trust_type)] || r.trust_type,
        reliability_label: RELIABILITY_LABEL[String(r.data_reliability)] || r.data_reliability,
        large_farmer_type_label: r.large_farmer_type ? (OPERATOR_TYPE_LABEL[String(r.large_farmer_type)] || r.large_farmer_type) : null,
      }))
      return successList(items, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:create', (_e, data: Record<string, unknown>) => {
    try {
      // 按白名单过滤
      const payload: Record<string, unknown> = {}
      for (const k of LAND_TRUST_COLS) {
        if (data[k] !== undefined && data[k] !== null) payload[k] = data[k]
      }

      // 家庭户类型：无 household_id 时尝试用身份证自动关联建档
      if (payload.owner_type === 'household' && !payload.owner_household_id) {
        const idCard = String(data.owner_id_card || '').trim()
        if (idCard) {
          const fp = db().getRaw<{ household_id: number | null }>(
            'SELECT household_id FROM farmer_profile WHERE id_card = ?', idCard)
          if (!fp || !fp.household_id) {
            return errorResponse(`未找到该身份证(${maskIdCard(idCard)})对应的农户，请先在农户管理建档`)
          }
          payload.owner_household_id = fp.household_id
        } else {
          return errorResponse('请搜索或输入流出方信息')
        }
      }
      if (payload.owner_type !== 'household' && !payload.owner_entity_id) {
        return errorResponse('请选择流出方（村/村组）')
      }
      // 流入方：家庭户类型且无 id 时用身份证匹配
      if (payload.operator_type === 'household' && !payload.operator_household_id) {
        const idCard = String(data.operator_id_card || '').trim()
        if (idCard) {
          const fp = db().getRaw<{ household_id: number | null }>(
            'SELECT household_id FROM farmer_profile WHERE id_card = ?', idCard)
          if (!fp || !fp.household_id) {
            return errorResponse(`未找到该身份证(${maskIdCard(idCard)})对应的农户，请先在农户管理建档`)
          }
          payload.operator_household_id = fp.household_id
        }
      }
      if (payload.operator_type !== 'household' && payload.operator_type && !payload.operator_entity_id) {
        // 流入方选村/村组但未选择——允许忽略（流入方可不填）
        delete payload.operator_type
      }
      if (!payload.trust_year) return errorResponse('请选择流转年度')

      const cols = Object.keys(payload).join(', ')
      const placeholders = Object.keys(payload).map(() => '?').join(', ')
      const values = Object.keys(payload).map(k => payload[k])
      const result = db().runRaw(`INSERT INTO land_trust (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:update', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      if (!id) return errorResponse('缺少记录 id')
      // 按白名单过滤；关联字段允许传 null 清空，其余字段忽略 null
      const nullableCols = ['owner_household_id', 'operator_household_id', 'owner_entity_id', 'operator_entity_id', 'trust_end_year', 'end_date']
      const allowed: Record<string, unknown> = {}
      for (const k of LAND_TRUST_COLS) {
        if (data[k] === undefined) continue
        if (data[k] === null && !nullableCols.includes(k)) continue
        allowed[k] = data[k]
      }
      // 编辑时也支持身份证重新关联（更新家庭户）
      if (data.owner_id_card) {
        const idCard = String(data.owner_id_card).trim()
        const fp = db().getRaw<{ household_id: number | null }>(
          'SELECT household_id FROM farmer_profile WHERE id_card = ?', idCard)
        if (fp?.household_id) allowed.owner_household_id = fp.household_id
      }
      if (data.operator_id_card) {
        const idCard = String(data.operator_id_card).trim()
        const fp = db().getRaw<{ household_id: number | null }>(
          'SELECT household_id FROM farmer_profile WHERE id_card = ?', idCard)
        if (fp?.household_id) allowed.operator_household_id = fp.household_id
      }
      const keys = Object.keys(allowed)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => allowed[k])
      db().runRaw(`UPDATE land_trust SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:delete', (_e, id: number) => {
    try {
      if (!id) return errorResponse('缺少记录 id')
      db().runRaw('DELETE FROM land_trust WHERE id = ?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════════════════════════════════════════
  //  搜索 / 解析
  // ═══════════════════════════════════════════

  ipcMain.handle('land:searchHousehold', (_e, payload: unknown) => {
    try {
      const q = typeof payload === 'string' ? payload : (payload as any)?.q || ''
      if (!q) return success([])
      const rows = db().allRaw<Record<string, unknown>>(
        `SELECT hh.id, hh.household_code, hh.household_name, hh.group_no,
                (SELECT real_name FROM farmer_profile WHERE id = hh.head_farmer_id) as head_name,
                v.village_name,
                MAX(COALESCE(hh.confirmed_area, 0), COALESCE(hh.contract_area, 0)) as land_area
         FROM family_household hh
         LEFT JOIN village v ON hh.village_id = v.id
         LEFT JOIN farmer_profile head ON head.id = hh.head_farmer_id
         WHERE hh.household_name LIKE ? OR hh.household_code LIKE ? OR head.real_name LIKE ?
           OR EXISTS (SELECT 1 FROM farmer_profile fp WHERE fp.household_id = hh.id AND fp.real_name LIKE ?)
         ORDER BY hh.id
         LIMIT 20`,
        `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`
      )
      // 拼装 village_full_name：村名 + 中文组号
      return success(rows.map(r => ({
        ...r,
        village_full_name: r.village_name
          ? `${r.village_name}${formatGroupNo(Number(r.group_no) || null)}`
          : (formatGroupNo(Number(r.group_no) || null) || '未知村组'),
      })))
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:searchVillage', (_e, payload: unknown) => {
    try {
      const q = typeof payload === 'string' ? payload : (payload as any)?.q || ''
      if (!q) return success([])
      const rows = db().allRaw<Record<string, unknown>>(
        'SELECT id, village_name FROM village WHERE village_name LIKE ? ORDER BY village_name LIMIT 20',
        `%${q}%`
      )
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:searchVillageGroup', (_e, payload: unknown) => {
    try {
      const q = typeof payload === 'string' ? payload : (payload as any)?.q || ''
      if (!q) return success([])
      const rows = db().allRaw<Record<string, unknown>>(
        `SELECT vg.id, v.village_name || '-' || vg.group_no as full_name
         FROM village_group vg
         JOIN village v ON vg.village_id = v.id
         WHERE v.village_name LIKE ? OR vg.group_no LIKE ?
         ORDER BY v.village_name, vg.group_no LIMIT 20`,
        `%${q}%`, `%${q}%`
      )
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:resolveByIdCard', (_e, idCard: unknown) => {
    try {
      const card = typeof idCard === 'string' ? idCard.trim() : String(idCard || '').trim()
      if (card.length < 15) return success({ found: false, farmer_name: null, household_id: null, household_name: null })
      const fp = db().getRaw<{ real_name: string; household_id: number | null; household_name: string | null }>(
        `SELECT fp.real_name, fp.household_id, hh.household_name
         FROM farmer_profile fp
         LEFT JOIN family_household hh ON fp.household_id = hh.id
         WHERE fp.id_card = ?`, card)
      if (!fp) return success({ found: false, farmer_name: null, household_id: null, household_name: null })
      return success({
        found: true,
        farmer_name: fp.real_name,
        household_id: fp.household_id,
        household_name: fp.household_name,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════════════════════════════════════════
  //  面积汇总 / 超领预警
  // ═══════════════════════════════════════════

  ipcMain.handle('land:areaSummary', (_e, payload: any = {}) => {
    try {
      const householdId = Number(payload.householdId || 0)
      const year = Number(payload.year || new Date().getFullYear())
      if (!householdId) return errorResponse('缺少家庭户 id')

      const hh = db().getRaw<{ household_name: string; contract_area: number | null; confirmed_area: number | null }>(
        'SELECT household_name, contract_area, confirmed_area FROM family_household WHERE id = ?', householdId)
      if (!hh) return errorResponse('家庭户不存在')

      const contractedArea = Math.max(Number(hh.confirmed_area || 0), Number(hh.contract_area || 0))

      // 流出面积（不含撂荒）
      const trustOutRow = db().getRaw<{ total: number | null }>(
        `SELECT SUM(area) as total FROM land_trust
         WHERE owner_household_id = ? AND trust_year = ? AND trust_type != 'IDLE' AND affect_subsidy_calc = 1 AND is_active = 1`,
        householdId, year)
      const trustOutArea = Number(trustOutRow?.total ?? 0) || 0

      // 流入面积（纳入计算的）
      const trustInRow = db().getRaw<{ total: number | null; arable: number | null; cash: number | null }>(
        `SELECT SUM(area) as total,
                SUM(CASE WHEN subsidy_arable = 1 THEN area ELSE 0 END) as arable,
                SUM(CASE WHEN subsidy_cash_crop = 1 THEN area ELSE 0 END) as cash
         FROM land_trust
         WHERE operator_household_id = ? AND trust_year = ? AND affect_subsidy_calc = 1 AND is_active = 1`,
        householdId, year)
      const trustInArea = Number(trustInRow?.total ?? 0) || 0
      const trustInArable = Number(trustInRow?.arable ?? 0) || 0
      const trustInCashCrop = Number(trustInRow?.cash ?? 0) || 0

      const cultivableArea = Math.round((contractedArea - trustOutArea + trustInArea) * 100) / 100

      // 当年该户成员的申报面积合计
      const appRow = db().getRaw<{ total: number | null }>(
        `SELECT COALESCE(SUM(sa.apply_area), 0) as total
         FROM subsidy_application sa
         JOIN farmer_profile fp ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp.id
         WHERE fp.household_id = ? AND sa.apply_year = ?`, householdId, year)
      const appliedArea = Number(appRow?.total ?? 0) || 0

      // 补贴明细（按补贴类型分组）
      const breakdown = db().allRaw<{ subsidy_name: string; applied_area: number | null; actual_amount: number | null }>(
        `SELECT st.subsidy_name, SUM(sa.apply_area) as applied_area, SUM(sa.actual_amount) as actual_amount
         FROM subsidy_application sa
         JOIN farmer_profile fp ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp.id
         JOIN subsidy_type st ON sa.subsidy_type_id = st.id
         WHERE fp.household_id = ? AND sa.apply_year = ?
         GROUP BY st.id, st.subsidy_name`, householdId, year)

      const trustRecords = db().allRaw<Record<string, unknown>>(
        `SELECT * FROM land_trust
         WHERE (owner_household_id = ? OR operator_household_id = ?) AND trust_year = ? AND is_active = 1
         ORDER BY id DESC`, householdId, householdId, year)

      const isOverdrawn = cultivableArea > 0 && appliedArea > cultivableArea + 0.001
      const overdrawAmount = isOverdrawn ? Math.round((appliedArea - cultivableArea) * 100) / 100 : 0

      return success({
        contracted_area: contractedArea,
        trust_out_area: trustOutArea,
        trust_in_area: trustInArea,
        trust_in_arable_area: trustInArable,
        trust_in_cash_crop_area: trustInCashCrop,
        cultivable_area: cultivableArea,
        applied_area: appliedArea,
        is_overdrawn: isOverdrawn,
        overdraw_amount: overdrawAmount,
        cultivable_note: trustOutArea === 0 && trustInArea === 0
          ? '暂无流转记录，按承包面积计算'
          : '',
        has_trust_data: trustRecords.length > 0,
        subsidy_breakdown: breakdown,
        trust_records: trustRecords,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════════════════════════════════════════
  //  批量操作
  // ═══════════════════════════════════════════

  ipcMain.handle('land:batchRenew', (_e, ids: number[]) => {
    try {
      const list = Array.isArray(ids) ? ids : []
      let created = 0
      for (const id of list) {
        const t = db().getRaw<Record<string, unknown>>('SELECT * FROM land_trust WHERE id = ?', id)
        if (!t) continue
        const newYear = Number(t.trust_year) + 1
        // 下一年已有相同流出方+类型则跳过
        const exist = db().getRaw<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM land_trust
           WHERE owner_household_id = ? AND trust_year = ? AND trust_type = ? AND is_active = 1`,
          t.owner_household_id, newYear, t.trust_type)
        if ((exist?.cnt ?? 0) > 0) continue
        const cols = LAND_TRUST_COLS.join(', ')
        const placeholders = LAND_TRUST_COLS.map(() => '?').join(', ')
        const values = LAND_TRUST_COLS.map(k => k === 'trust_year' ? newYear : t[k] ?? null)
        db().runRaw(`INSERT INTO land_trust (${cols}) VALUES (${placeholders})`, ...values)
        created++
      }
      return success({ created })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:batchImportIdle', (_e, rows: Record<string, unknown>[]) => {
    try {
      const list = Array.isArray(rows) ? rows : []
      let created = 0, skipped = 0
      const errors: string[] = []
      for (const [i, r] of list.entries()) {
        const rowNo = i + 2 // 表头占第 1 行
        const name = String(r.owner_name || '').trim()
        const idCard = String(r.owner_id_card || '').trim()
        const area = Number(r.area || 0)
        const year = Number(r.trust_year || new Date().getFullYear())
        const subsidyArable = r.subsidy_arable === undefined ? 1 : Number(r.subsidy_arable)
        if (!name || !idCard) { errors.push(`第${rowNo}行：流出方姓名/身份证不能为空`); continue }
        if (!(area > 0)) { errors.push(`第${rowNo}行：面积必须大于 0`); continue }
        const fp = db().getRaw<{ household_id: number | null }>(
          'SELECT household_id FROM farmer_profile WHERE id_card = ?', idCard)
        if (!fp?.household_id) { errors.push(`第${rowNo}行：身份证 ${maskIdCard(idCard)} 未建档`); continue }
        const exist = db().getRaw<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM land_trust
           WHERE owner_household_id = ? AND trust_year = ? AND trust_type = 'IDLE' AND is_active = 1`,
          fp.household_id, year)
        if ((exist?.cnt ?? 0) > 0) { skipped++; continue }
        db().runRaw(
          `INSERT INTO land_trust (owner_type, owner_household_id, trust_type, area, trust_year,
            data_reliability, affect_subsidy_calc, subsidy_arable, subsidy_cash_crop, note)
           VALUES ('household', ?, 'IDLE', ?, ?, 'SELF_REPORT', 1, ?, 0, ?)`,
          fp.household_id, area, year, subsidyArable, String(r.note || '').trim() || null)
        created++
      }
      return success({ created, skipped, errors })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════════════════════════════════════════
  //  大户管理（保留）
  // ═══════════════════════════════════════════

  ipcMain.handle('land:listLargeFarmers', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const countRow = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM large_farmer')
      const rows = db().allRaw('SELECT * FROM large_farmer ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, offset)
      return successList(rows, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:createLargeFarmer', (_e, payload: any) => {
    try {
      const cols = Object.keys(payload).filter(k => payload[k] !== undefined).join(',')
      const ph = Object.keys(payload).filter(k => payload[k] !== undefined).map(() => '?').join(',')
      const vals = Object.keys(payload).filter(k => payload[k] !== undefined).map(k => payload[k])
      const r = db().runRaw(`INSERT INTO large_farmer (${cols}) VALUES (${ph})`, ...vals)
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:updateLargeFarmer', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k}=?`).join(',')
      const vals = keys.map(k => data[k])
      db().runRaw(`UPDATE large_farmer SET ${sets} WHERE id=?`, ...vals, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:deleteLargeFarmer', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM large_farmer_trust WHERE large_farmer_id=?', id)
      db().runRaw('DELETE FROM large_farmer WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:listLargeFarmerTrusts', (_e, payload: any) => {
    try {
      const { id, year } = payload || {}
      let sql = `
        SELECT t.*,
               COALESCE(t.counterparty_name, h.household_name, '') AS owner_household_name,
               COALESCE(h.household_code, '') AS owner_household_code,
               COALESCE(t.trust_type, 'ENTRUST') AS trust_type
        FROM large_farmer_trust t
        LEFT JOIN family_household h ON h.id = t.owner_household_id
        WHERE t.large_farmer_id=?`
      const params: any[] = [id]
      if (year) { sql += ' AND t.trust_year=?'; params.push(year) }
      sql += ' ORDER BY t.trust_year DESC, t.id DESC'
      const rows = db().allRaw<Record<string, unknown>>(sql, ...params)
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:createLargeFarmerTrust', (_e, payload: any) => {
    try {
      const {
        large_farmer_id, trust_type, land_area, area, trust_year, start_date, end_date, note, remark,
        owner_household_id, counterparty_type, counterparty_name, counterparty_village, counterparty_group,
        trust_days, planted_area, own_area, crop_type,
      } = payload
      // 兼容两种字段名：实际列名为 area，前端若传 land_area 则取用
      const areaVal = area ?? land_area
      // owner_household_id 在老表结构下非空，演示数据若无对应家庭户则落 0 占位
      const ownerId = owner_household_id ?? 0
      const r = db().runRaw(
        `INSERT INTO large_farmer_trust
          (large_farmer_id, owner_household_id, trust_type, area, trust_year, start_date, end_date, note,
           counterparty_type, counterparty_name, counterparty_village, counterparty_group, trust_days,
           planted_area, own_area, crop_type)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        large_farmer_id, ownerId, trust_type, areaVal, trust_year, start_date || null, end_date || null, note || remark || '',
        counterparty_type || 'HOUSEHOLD', counterparty_name || '', counterparty_village || '', counterparty_group || '',
        trust_days ?? null, planted_area ?? null, own_area ?? null, crop_type || ''
      )
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:updateLargeFarmerTrust', (_e, payload: any) => {
    try {
      const { id, large_farmer_id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k}=?`).join(',')
      const vals = keys.map(k => data[k])
      db().runRaw(`UPDATE large_farmer_trust SET ${sets} WHERE id=?`, ...vals, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:deleteLargeFarmerTrust', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM large_farmer_trust WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })
}
