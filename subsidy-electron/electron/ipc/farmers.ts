import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { formatGroupNo, parseGroupNoToInt } from '../utils/format'
import { parseIdCard } from '../utils/id-card'
import { maskIdCard, maskPhone, maskBankCard } from '../utils/masking'
import { parsePagination, successList, success, errorResponse } from './response'
import { safeUpdate } from '../utils/sql-guard'
import logger from '../utils/logger'

const FARMER_COLS = [
  'household_id', 'real_name', 'gender', 'id_card', 'phone',
  'bank_card', 'bank_name', 'relation', 'farmer_status',
  'own_village_id', 'own_group_no', 'remark',
]

export function registerFarmerHandlers(): void {
  const db = () => getDb()

  // ── 列表 ──
  ipcMain.handle('farmers:list', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const search = params.search as string || ''
      const villageName = params.village_name as string || ''
      const status = params.status ? Number(params.status) : null
      const incomplete = params.incomplete as boolean || false

      let where = 'WHERE 1=1'
      const sqlParams: unknown[] = []

      if (search) {
        where += ` AND (fp.real_name LIKE ? OR fp.id_card LIKE ? OR fp.phone LIKE ?)`
        sqlParams.push(`%${search}%`, `%${search}%`, `%${search}%`)
      }
      if (villageName) {
        where += ` AND v.village_name = ?`
        sqlParams.push(villageName)
      }
      if (status != null) {
        where += ` AND fp.farmer_status = ?`
        sqlParams.push(status)
      }
      if (incomplete) {
        where += ` AND (fp.phone IS NULL OR fp.bank_card IS NULL OR fp.bank_name IS NULL)`
      }

      const countRow = db().getRaw<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM farmer_profile fp LEFT JOIN family_household hh ON fp.household_id = hh.id LEFT JOIN village v ON hh.village_id = v.id ${where}`,
        ...sqlParams
      )

      const rows = db().allRaw<Record<string, unknown>>(
        `SELECT fp.id, fp.household_id, fp.real_name, fp.gender, fp.id_card,
                fp.phone, fp.bank_card, fp.bank_name, fp.relation,
                fp.farmer_status, fp.own_village_id, fp.own_group_no,
                fp.remark, fp.created_at, fp.updated_at,
                hh.household_code, hh.household_name,
                COALESCE(v.village_name || CASE WHEN hh.group_no >= 1 AND hh.group_no <= 10 THEN
                  SUBSTR('零一二三四五六七八九十', hh.group_no+1, 1) || '组' ELSE hh.group_no || '组' END, '未知村组') AS village_full_name
         FROM farmer_profile fp
         LEFT JOIN family_household hh ON fp.household_id = hh.id
         LEFT JOIN village v ON hh.village_id = v.id
         ${where}
         ORDER BY fp.id DESC
         LIMIT ? OFFSET ?`,
        ...sqlParams, pageSize, offset
      )

      const items = rows.map(r => ({
        ...r,
        id_card: maskIdCard(r.id_card as string),
        phone: r.phone ? maskPhone(r.phone as string) : null,
        bank_card: r.bank_card ? maskBankCard(r.bank_card as string) : null,
      }))

      return successList(items, countRow?.cnt || 0, page, pageSize)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 详情 ──
  ipcMain.handle('farmers:get', (_e, id: number) => {
    try {
      const row = db().getRaw<Record<string, unknown>>(
        `SELECT fp.*, hh.household_code, hh.household_name, hh.group_no,
                v.village_name
         FROM farmer_profile fp
         LEFT JOIN family_household hh ON fp.household_id = hh.id
         LEFT JOIN village v ON hh.village_id = v.id
         WHERE fp.id = ?`, id
      )
      if (!row) return errorResponse('农户不存在', 404)

      const groupNo = row.group_no != null ? Number(row.group_no) : 0
      const villageFullName = row.village_name
        ? `${row.village_name}${formatGroupNo(groupNo)}`
        : (formatGroupNo(groupNo) || '未知村组')

      // 查询该农户的补贴记录（含代领关系）
      let applications: unknown[] = []
      try {
        const apps = db().allRaw<Record<string, unknown>>(`
          SELECT sa.id, sa.apply_year, sa.subsidy_type_id,
                 st.subsidy_name,
                 sa.apply_area, COALESCE(sa.apply_amount, 0) as apply_amount,
                 COALESCE(sa.actual_amount, 0) as actual_amount,
                 sa.pay_status, sa.is_proxy, sa.apply_village_name, sa.apply_group_display,
                 sa.created_at
          FROM subsidy_application sa
          JOIN subsidy_type st ON st.id = sa.subsidy_type_id
          WHERE COALESCE(sa.beneficiary_id, sa.farmer_id) = ?
          ORDER BY sa.apply_year DESC, sa.id DESC
        `, id)

        // 查询代领关系
        if (apps.length > 0) {
          const appIds = apps.map(a => a.id)
          const placeholders = appIds.map(() => '?').join(',')
          try {
            const proxies = db().allRaw<Record<string, unknown>>(`
              SELECT sp.application_id, sp.proxy_type as type,
                     sp.beneficiary_farmer_id, sp.proxy_farmer_id,
                     bf.real_name as beneficiary_name,
                     pf.real_name as proxy_name,
                     sp.remark
              FROM subsidy_proxy sp
              LEFT JOIN farmer_profile bf ON bf.id = sp.beneficiary_farmer_id
              LEFT JOIN farmer_profile pf ON pf.id = sp.proxy_farmer_id
              WHERE sp.application_id IN (${placeholders})
            `, ...appIds)
            const proxyMap = new Map<unknown, unknown>()
            for (const p of proxies) {
              proxyMap.set(p.application_id, {
                type: p.type,
                beneficiary_farmer_id: p.beneficiary_farmer_id,
                proxy_farmer_id: p.proxy_farmer_id,
                beneficiary_name: p.beneficiary_name,
                proxy_name: p.proxy_name,
                remark: p.remark,
              })
            }
            applications = apps.map(a => ({
              ...a,
              proxy_info: proxyMap.get(a.id) || null,
            }))
          } catch { applications = apps }
        } else {
          applications = apps
        }
      } catch { /* table may not exist */ }

      return success({
        ...row,
        village_full_name: villageFullName,
        group_display: formatGroupNo(groupNo),
        applications,
        is_head: row.household_id && row.id ? null : 0,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 新增 ──
  ipcMain.handle('farmers:create', (_e, data: Record<string, unknown>) => {
    try {
      const idCard = data.id_card as string
      if (idCard) {
        const info = parseIdCard(idCard)
        if (info.gender && !data.gender) data.gender = info.gender
      }

      const fields = ['household_id', 'real_name', 'gender', 'id_card', 'phone', 'bank_card', 'bank_name', 'relation', 'farmer_status', 'own_village_id', 'own_group_no', 'remark']
      const vals = fields.map(f => data[f] ?? null)
      const placeholders = fields.map(() => '?').join(', ')
      const result = db().runRaw(`INSERT INTO farmer_profile (${fields.join(', ')}) VALUES (${placeholders})`, ...vals)
      logger.audit('新增农户', data.real_name as string || '', 'farmer_profile', { id: result.lastInsertRowid })
      return success({ id: result.lastInsertRowid })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 修改 ──
  ipcMain.handle('farmers:update', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      if (!id) return errorResponse('缺少农户ID')
      const changed = safeUpdate('farmer_profile', id, data, FARMER_COLS)
      if (!changed) return errorResponse('无更新数据')
      return success(null, '更新成功')
    } catch (e) { return errorResponse('更新农户失败') }
  })

  // ── 注销 ──
  ipcMain.handle('farmers:deactivate', (_e, payload: any) => {
    try {
      const { id, status = 2 } = payload
      db().runRaw(`UPDATE farmer_profile SET farmer_status = ?, updated_at = datetime('now','localtime') WHERE id = ?`, status, id)
      return success(null, '操作成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 批量导入 ──
  ipcMain.handle('farmers:batchImport', (_e, payload: any) => {
    try {
      const { rows, overwrite = false } = payload
      let created = 0, updated = 0, skipped = 0
      const errors: string[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const idCard = row.id_card as string
          if (!idCard) { skipped++; continue }
          if (idCard) {
            const info = parseIdCard(idCard)
            if (info.gender && !row.gender) row.gender = info.gender
          }

          const existing = db().getRaw<{ id: number }>('SELECT id FROM farmer_profile WHERE id_card = ?', idCard)
          if (existing) {
            if (overwrite) {
              const keys = Object.keys(row).filter(k => k !== 'id_card' && k !== 'id')
              const sets = keys.map(k => `${k} = ?`).join(', ')
              const vals = keys.map(k => row[k])
              db().runRaw(`UPDATE farmer_profile SET ${sets}, updated_at = datetime('now','localtime') WHERE id_card = ?`, ...vals, idCard)
              updated++
            } else { skipped++ }
          } else {
            const fields = ['household_id', 'real_name', 'gender', 'id_card', 'phone', 'bank_card', 'bank_name', 'relation', 'farmer_status']
            const vals = fields.map(f => row[f] ?? null)
            db().runRaw(`INSERT INTO farmer_profile (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, ...vals)
            created++
          }
        } catch (e) {
          errors.push(`第${i + 1}行: ${String(e)}`)
        }
      }
      return success({ created, updated, skipped, errors })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 批量查找 ──
  ipcMain.handle('farmers:batchLookup', (_e, idCards: string[]) => {
    try {
      const results: Record<string, number> = {}
      for (const card of idCards) {
        const row = db().getRaw<{ id: number }>('SELECT id FROM farmer_profile WHERE id_card = ?', card)
        if (row) results[card] = row.id
      }
      return success({ results })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('farmers:batchGetIdCards', (_e, farmerIds: number[]) => {
    try {
      const results: Record<string, string> = {}
      for (const fid of farmerIds) {
        const row = db().getRaw<{ id: number; id_card: string }>('SELECT id, id_card FROM farmer_profile WHERE id = ?', fid)
        if (row) results[String(fid)] = row.id_card
      }
      return success({ results })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 批量补全 ──
  ipcMain.handle('farmers:bulkComplete', (_e, rows: Record<string, unknown>[]) => {
    try {
      let updated = 0
      const errors: string[] = []
      for (const row of rows) {
        try {
          const idCard = row.id_card as string
          if (!idCard) continue
          const existing = db().getRaw<{ id: number }>('SELECT id FROM farmer_profile WHERE id_card = ?', idCard)
          if (!existing) continue
          const updateFields: Record<string, unknown> = {}
          if (row.phone) updateFields.phone = row.phone
          if (row.bank_card) updateFields.bank_card = row.bank_card
          if (row.bank_name) updateFields.bank_name = row.bank_name
          if (Object.keys(updateFields).length > 0) {
            const keys = Object.keys(updateFields)
            const sets = keys.map(k => `${k} = ?`).join(', ')
            const vals = keys.map(k => updateFields[k])
            db().runRaw(`UPDATE farmer_profile SET ${sets}, updated_at = datetime('now','localtime') WHERE id_card = ?`, ...vals, idCard)
            updated++
          }
        } catch (e) { errors.push(String(e)) }
      }
      return success({ updated, errors })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 家庭关系导入 ──
  ipcMain.handle('farmers:importRelations', (_e, payload: any) => {
    try {
      const { rows, split_villages: splitVillages } = payload
      let updated = 0
      const notFound: string[] = []
      const relationErrors: string[] = []

      for (const row of rows) {
        const idCard = row.id_card as string
        if (!idCard) continue
        const farmer = db().getRaw<{ id: number }>('SELECT id FROM farmer_profile WHERE id_card = ?', idCard)
        if (!farmer) { notFound.push(idCard); continue }
        if (row.relation) {
          db().runRaw(`UPDATE farmer_profile SET relation = ?, updated_at = datetime('now','localtime') WHERE id = ?`, row.relation, farmer.id)
          updated++
        }
      }
      return success({ stage1_updated: updated, stage1_not_found: notFound, stage1_relation_errors: relationErrors })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 多户主预览 ──
  ipcMain.handle('farmers:multiHeadPreview', (_e, payload: any) => {
    try {
      // Handle both cases: payload can be an array (villageNames only) or an object { villageNames, excelRows }
      const villageNames: string[] = Array.isArray(payload) ? payload : (payload?.villageNames || [])
      let query = `
        SELECT hh.id as household_id, hh.household_name,
               v.village_name,
               COUNT(fp.id) as head_count
        FROM farmer_profile fp
        JOIN family_household hh ON fp.household_id = hh.id
        JOIN village v ON hh.village_id = v.id
        WHERE fp.relation = '本人'
      `
      const params: unknown[] = []
      if (villageNames.length > 0) {
        query += ` AND v.village_name IN (${villageNames.map(() => '?').join(',')})`
        params.push(...villageNames)
      }
      query += ` GROUP BY hh.id HAVING COUNT(fp.id) > 1`

      const rows = db().allRaw(query, ...params)
      return success({ households: rows })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 搜索 ──
  ipcMain.handle('farmers:search', (_e, params: Record<string, unknown> = {}) => {
    try {
      const search = (params.search as string) || ''
      const pageSize = Number(params.page_size) || 20
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT fp.id, fp.real_name, fp.id_card, fp.phone, fp.household_id,
               hh.household_name, hh.household_code,
               COALESCE(v.village_name,'') as village_name
        FROM farmer_profile fp
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        LEFT JOIN village v ON hh.village_id=v.id
        WHERE fp.real_name LIKE ? OR fp.id_card LIKE ? OR fp.phone LIKE ?
        ORDER BY fp.id DESC LIMIT ?
      `, `%${search}%`, `%${search}%`, `%${search}%`, pageSize)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 身份信息验证 ──
  ipcMain.handle('farmers:verifyNames', (_e, params: any) => {
    try {
      const rows: { name: string; id_card: string }[] = params?.rows || []

      const results = rows.map(row => {
        const ic = (row.id_card || '').trim().toUpperCase()
        if (!ic || ic.length !== 18) {
          return { match: 'invalid', db_name: null, db_village: null }
        }

        const farmer = db().getRaw<{ real_name: string; village_name: string }>(
          `SELECT fp.real_name, COALESCE(v.village_name, '') as village_name
           FROM farmer_profile fp
           LEFT JOIN family_household hh ON fp.household_id = hh.id
           LEFT JOIN village v ON hh.village_id = v.id
           WHERE fp.id_card = ? LIMIT 1`, ic
        )

        if (!farmer) {
          return { match: 'not_found', db_name: null, db_village: null }
        }

        const inputName = (row.name || '').trim()
        const dbName = farmer.real_name || ''

        if (inputName === dbName) {
          return { match: 'ok', db_name: dbName, db_village: farmer.village_name }
        }

        return { match: 'mismatch', db_name: dbName, db_village: farmer.village_name }
      })

      return success({ results })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 导入时自动创建缺失农户（批量版）──
  ipcMain.handle('farmers:batchEnsure', (_e, rows: { id_card: string; real_name: string; village_name?: string; group_no?: string }[]) => {
    try {
      // 规范化身份证：统一 trim，避免与渲染进程 trim 后取值不一致导致全部"身份证无效"
      const normalized = (rows || []).map(r => ({
        ...r,
        id_card: String(r.id_card || '').trim(),
      }))
      const validRows = normalized.filter(r => r.id_card.length === 18)
      // 非18位身份证明细，供前端明确提示原因（而非笼统报"身份证无效"）
      const invalidRows = normalized
        .map((r, idx) => ({ idx, card: r.id_card }))
        .filter(x => x.card.length !== 18)
        .map(x => ({
          index: x.idx, id_card: x.card || '(空)',
          reason: x.card ? `长度${x.card.length}位（应为18位）` : '身份证号为空',
        }))
      if (!validRows.length) {
        return success({ results: {}, info: {}, new_count: 0, invalid_rows: invalidRows })
      }

      const idCards = validRows.map(r => r.id_card)
      const placeholders = idCards.map(() => '?').join(',')

      // ① 一次性查出所有已存在的农户
      const existing = db().allRaw<Record<string, unknown>>(
        `SELECT fp.id, fp.id_card, fp.household_id, hh.village_id, hh.group_no,
                v.village_name
         FROM farmer_profile fp
         LEFT JOIN family_household hh ON fp.household_id = hh.id
         LEFT JOIN village v ON hh.village_id = v.id
         WHERE fp.id_card IN (${placeholders})`,
        ...idCards
      )
      const existMap = new Map(existing.map(e => [e.id_card as string, e]))

      const results: Record<string, number> = {}
      const info: Record<string, { village_id: number; village_group_id: number; village_name: string; group_no: number }> = {}
      let newCount = 0

      // 填充已有结果
      for (const row of validRows) {
        const ex = existMap.get(row.id_card)
        if (ex) {
          results[row.id_card] = ex.id as number
          const vId = Number(ex.village_id || 0)
          const gNo = parseGroupNoToInt(ex.group_no)
          const vgId = vId ? (db().getRaw<{ id: number }>(
            'SELECT id FROM village_group WHERE village_id = ? AND group_no = ?', vId, gNo
          )?.id ?? 0) : 0
          info[row.id_card] = {
            village_id: vId,
            village_group_id: vgId,
            village_name: (ex.village_name as string) || '',
            group_no: gNo,
          }
        }
      }

      // ② 集中处理缺失农户：先批量确保村庄
      const missing = validRows.filter(r => !existMap.has(r.id_card))
      if (missing.length) {
        // 批量缓存村庄
        const villageCache = new Map<string, { id: number; groups: Set<number> }>()
        // 先查出所有已涉及的村庄
        const missingVillages = [...new Set(missing.map(r => r.village_name || '未分配'))]
        for (const vn of missingVillages) {
          const v = db().getRaw<{ id: number }>('SELECT id FROM village WHERE village_name = ?', vn)
          if (v) {
            const groups = new Set(
              db().allRaw<{ group_no: number }>('SELECT group_no FROM village_group WHERE village_id = ?', v.id).map(g => g.group_no)
            )
            villageCache.set(vn, { id: v.id, groups })
          }
        }

        for (const row of missing) {
          const idCard = row.id_card
          const realName = row.real_name || '未知'
          const villageName = row.village_name || '未分配'
          const groupNo = parseGroupNoToInt(row.group_no)

          // 确保村庄+村组存在
          let vc = villageCache.get(villageName)
          if (!vc) {
            const vid = db().runRaw('INSERT INTO village (village_name) VALUES (?)', villageName).lastInsertRowid
            for (let g = 1; g <= 4; g++) {
              db().runRaw('INSERT INTO village_group (village_id, group_no) VALUES (?, ?)', vid, g)
            }
            vc = { id: vid, groups: new Set([1,2,3,4]) }
            villageCache.set(villageName, vc)
          }
          if (!vc.groups.has(groupNo)) {
            db().runRaw('INSERT INTO village_group (village_id, group_no) VALUES (?, ?)', vc.id, groupNo)
            vc.groups.add(groupNo)
          }
          const vgId = db().getRaw<{ id: number }>(
            'SELECT id FROM village_group WHERE village_id = ? AND group_no = ?', vc.id, groupNo
          )!.id

          // 创建家庭户 + 农户
          const parsedInfo = parseIdCard(idCard)
          const hhId = db().runRaw(
            'INSERT INTO family_household (household_code, household_name, village_id, group_no, status) VALUES (?,?,?,?,1)',
            `AUTO-${idCard.slice(-4)}`, `${realName}户`, vc.id, groupNo
          ).lastInsertRowid
          const fId = db().runRaw(
            'INSERT INTO farmer_profile (real_name, gender, id_card, household_id, farmer_status) VALUES (?,?,?,?,1)',
            realName, parsedInfo.gender ? String(parsedInfo.gender) : '1', idCard, hhId
          ).lastInsertRowid

          results[idCard] = fId
          info[idCard] = { village_id: vc.id, village_group_id: vgId, village_name: villageName, group_no: groupNo }
          newCount++
        }
      }

      return success({ results, info, new_count: newCount, invalid_rows: invalidRows })
    } catch (e) { return errorResponse(String(e)) }
  })
}
