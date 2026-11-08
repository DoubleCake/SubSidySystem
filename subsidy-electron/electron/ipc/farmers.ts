import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { formatGroupNo, parseGroupNoToInt } from '../utils/format'
import { parseIdCard, prepareIdCard, resolveGender } from '../utils/id-card'
import { maskIdCard, maskPhone, maskBankCard } from '../utils/masking'
import { parsePagination, successList, success, errorResponse } from './response'
import { safeUpdate, collectRefCounts, formatRefCounts, type BlockingRef } from '../utils/sql-guard'
import logger from '../utils/logger'

const FARMER_COLS = [
  'household_id', 'real_name', 'gender', 'id_card', 'phone',
  'bank_card', 'bank_name', 'relation', 'farmer_status',
  'own_village_id', 'own_group_no', 'remark',
]

/**
 * 删除农户前的关联检查项
 * 补贴申请/发放记录：本人是申报人（farmer_id）或受益人（beneficiary_id）都算关联
 * 代领关系：本人是受益人或代领人都算关联
 */
const FARMER_DELETE_REFS: BlockingRef[] = [
  {
    name: '补贴申请',
    sql: 'SELECT COUNT(*) as cnt FROM subsidy_application WHERE farmer_id = ? OR beneficiary_id = ?',
  },
  {
    name: '发放记录',
    sql: 'SELECT COUNT(*) as cnt FROM subsidy_payment WHERE farmer_id = ? OR beneficiary_id = ?',
  },
  {
    name: '代领关系',
    sql: 'SELECT COUNT(*) as cnt FROM subsidy_proxy WHERE beneficiary_farmer_id = ? OR proxy_farmer_id = ?',
  },
]

/**
 * 检查身份证号是否已被其他农户占用（身份证号的规范化/校验见 utils/id-card.ts）
 * @param idCard 规范化后的身份证号
 * @param excludeFarmerId 编辑场景排除自身 id，避免误判自己与自己冲突
 */
function findIdCardOwner(
  idCard: string,
  excludeFarmerId?: number
): { id: number; real_name: string; household_id: number | null } | undefined {
  if (!idCard) return undefined
  const db = getDb()
  if (excludeFarmerId != null) {
    return db.getRaw<{ id: number; real_name: string; household_id: number | null }>(
      'SELECT id, real_name, household_id FROM farmer_profile WHERE UPPER(TRIM(id_card)) = ? AND id <> ? LIMIT 1',
      idCard, excludeFarmerId
    )
  }
  return db.getRaw<{ id: number; real_name: string; household_id: number | null }>(
    'SELECT id, real_name, household_id FROM farmer_profile WHERE UPPER(TRIM(id_card)) = ? LIMIT 1',
    idCard
  )
}

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
      // 顺序：去空格转大写 → 格式校验 → 重复校验（唯一索引按原始文本比较，必须先规范化）
      const card = prepareIdCard(data.id_card)
      if (!card.ok) return errorResponse(card.error || '身份证号格式不正确')
      const idCard = card.idCard
      if (idCard) {
        // 身份证号重复校验：已存在则拒绝，并提示重复农户姓名
        const dup = findIdCardOwner(idCard)
        if (dup) {
          return errorResponse(`身份证号已存在，对应农户：${dup.real_name}（ID ${dup.id}），不能重复建档`)
        }
      }
      data.id_card = idCard || null
      // 性别：用户显式提供优先，未提供且身份证合法时自动推导
      const gender = resolveGender(data.gender, idCard)
      if (gender != null) data.gender = gender
      // household_id / gender / id_card / farmer_status 均为 NOT NULL，缺省时给默认值避免插入失败
      if (data.farmer_status == null) data.farmer_status = 1
      if (data.gender == null) data.gender = 1

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
      const farmerId = Number(id)
      if (!Number.isFinite(farmerId)) return errorResponse('农户ID格式错误')
      // 身份证号重复校验：排除自身，避免编辑时误判自己与自己冲突
      if ('id_card' in data) {
        // 顺序：去空格转大写 → 格式校验 → 重复校验
        const card = prepareIdCard(data.id_card)
        if (!card.ok) return errorResponse(card.error || '身份证号格式不正确')
        const idCard = card.idCard
        if (idCard) {
          const dup = findIdCardOwner(idCard, farmerId)
          if (dup) {
            return errorResponse(`身份证号已存在，对应农户：${dup.real_name}（ID ${dup.id}），不能重复建档`)
          }
        }
        data.id_card = idCard || null
      }
      // 性别：本次未显式传 gender 时按（本次传入或库中现有的）身份证推导；
      // 身份证不合法/为空则不推导，保留库中原值，避免存量脏数据阻塞编辑
      if (!('gender' in data)) {
        const currentCard = 'id_card' in data
          ? data.id_card
          : db().getRaw<{ id_card: string | null }>('SELECT id_card FROM farmer_profile WHERE id = ?', farmerId)?.id_card
        const gender = resolveGender(null, currentCard)
        if (gender != null) data.gender = gender
      }
      const changed = safeUpdate('farmer_profile', farmerId, data, FARMER_COLS)
      if (!changed) return errorResponse('无更新数据')
      return success(null, '更新成功')
    } catch (e) { return errorResponse('更新农户失败') }
  })

  // ── 删除 ──
  /**
   * 删除农户
   * @param payload number（仅农户ID）或 { id }
   *
   * 只要存在补贴申请、发放记录或代领关系，一律拒绝删除（不提供强制删除，
   * 否则会留下指向已删农户的孤儿补贴记录）。需要清理时请走「迁出/注销」。
   */
  ipcMain.handle('farmers:delete', (_e, payload: unknown) => {
    try {
      const params = payload && typeof payload === 'object'
        ? (payload as { id?: unknown })
        : { id: payload }
      const id = Number(params.id)
      if (!id || !Number.isFinite(id)) return errorResponse('缺少农户ID')

      const farmer = db().getRaw<{ id: number; real_name: string; household_id: number | null }>(
        'SELECT id, real_name, household_id FROM farmer_profile WHERE id = ?', id
      )
      if (!farmer) return errorResponse('农户不存在', 404)

      // 户主不能直接删除，否则家庭户会失去户主指向
      if (farmer.household_id) {
        const hh = db().getRaw<{ id: number; head_farmer_id: number | null }>(
          'SELECT id, head_farmer_id FROM family_household WHERE id = ?', farmer.household_id
        )
        if (hh && Number(hh.head_farmer_id) === id) {
          return errorResponse('该农户是当前家庭户户主，不能直接删除，请先将其他成员设为户主')
        }
      }

      const { items, errors } = collectRefCounts(FARMER_DELETE_REFS, id, id)
      if (errors.length > 0) {
        return errorResponse(`删除前关联检查失败，已中止删除：${errors.join('；')}`)
      }
      const total = items.reduce((sum, i) => sum + i.count, 0)

      if (total > 0) {
        return errorResponse(
          `农户「${farmer.real_name}」存在 ${formatRefCounts(items)}，无法删除。请先处理关联记录，或改用「迁出/注销」保留档案。`
        )
      }

      db().runRaw('DELETE FROM farmer_profile WHERE id = ?', id)
      logger.audit('删除农户', String(farmer.real_name || ''), 'farmer_profile', { id })
      return success({ message: '删除成功', farmer_id: id })
    } catch (e) {
      return errorResponse(String(e))
    }
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
          if (!row || typeof row !== 'object') { skipped++; continue }
          // 顺序：去空格转大写 → 格式校验 → 查重（空值跳过，不阻断整批导入）
          const card = prepareIdCard((row as Record<string, unknown>).id_card)
          if (!card.ok) { errors.push(`第${i + 1}行: ${card.error}`); skipped++; continue }
          const idCard = card.idCard
          if (!idCard) { skipped++; continue }
          row.id_card = idCard
          // 性别：用户显式提供优先，未提供时由身份证推导
          const gender = resolveGender(row.gender, idCard)
          if (gender != null) row.gender = gender

          const existing = db().getRaw<{ id: number }>(
            'SELECT id FROM farmer_profile WHERE UPPER(TRIM(id_card)) = ?', idCard
          )
          if (existing) {
            if (overwrite) {
              const keys = Object.keys(row).filter(k => k !== 'id_card' && k !== 'id')
              const sets = keys.map(k => `${k} = ?`).join(', ')
              const vals = keys.map(k => row[k])
              db().runRaw(`UPDATE farmer_profile SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...vals, existing.id)
              updated++
            } else { skipped++ }
          } else {
            const fields = ['household_id', 'real_name', 'gender', 'id_card', 'phone', 'bank_card', 'bank_name', 'relation', 'farmer_status']
            // household_id / gender / farmer_status 为 NOT NULL，缺省时给默认值
            const merged: Record<string, unknown> = {
              ...row,
              household_id: row.household_id ?? null,
              gender: row.gender ?? 1,
              farmer_status: row.farmer_status ?? 1,
            }
            const vals = fields.map(f => merged[f] ?? null)
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
