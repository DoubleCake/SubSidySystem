import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'
import type { SqlJsWrapper } from '../database/connection'

/**
 * 年度同类补贴关系链 — IPC handlers
 *
 * subsidy_type.prev_year_type_id 指向"该补贴上一年度的同类补贴"，形成链：
 *   2023年耕地地力 ← 2024年耕地地力 ← 2025年耕地地力
 * 数据分析页基于此链观察补贴用户（农户/家庭户）在多年间的数据变化。
 */

interface TypeRow {
  id: number
  subsidy_name: string
  subsidy_year: number
  season: string | null
  category: string | null
  prev_year_type_id: number | null
}

function loadTypes(db: SqlJsWrapper): TypeRow[] {
  return db.allRaw<TypeRow>(
    `SELECT id, subsidy_name, subsidy_year, season, category, prev_year_type_id
     FROM subsidy_type WHERE COALESCE(is_deleted,0) = 0`
  )
}

/**
 * 从链上任一节点出发，向上回溯到链头，再向下 BFS 收集整条链（按年份升序）。
 * 返回 null 表示该节点不在任何链中。
 */
function collectChain(db: SqlJsWrapper, typeId: number): TypeRow[] | null {
  const rows = loadTypes(db)
  const byId = new Map<number, TypeRow>()
  for (const r of rows) byId.set(Number(r.id), r)

  const prevOf = (id: number): number | null => {
    const r = byId.get(id)
    if (!r) return null
    const p = r.prev_year_type_id
    return p && Number(p) !== id ? Number(p) : null
  }

  if (!byId.has(typeId)) return null

  // 向上回溯到链头
  let head = typeId
  const seenUp = new Set<number>()
  while (true) {
    if (seenUp.has(head)) break
    seenUp.add(head)
    const p = prevOf(head)
    if (p === null) break
    head = p
  }

  // 从链头向下 BFS（prev → 多个下一年的孩子）
  const children = new Map<number, number[]>()
  for (const r of rows) {
    const p = prevOf(Number(r.id))
    if (p !== null) {
      if (!children.has(p)) children.set(p, [])
      children.get(p)!.push(Number(r.id))
    }
  }

  const queue = [head]
  const nodeIds = new Set<number>([head])
  while (queue.length) {
    const n = queue.shift()!
    for (const c of children.get(n) || []) {
      if (!nodeIds.has(c)) { nodeIds.add(c); queue.push(c) }
    }
  }

  const chain = [...nodeIds].map(id => byId.get(id)!)
  chain.sort((a, b) => Number(a.subsidy_year) - Number(b.subsidy_year))
  return chain.length > 1 ? chain : null
}

export function registerSubsidyTrendHandlers(): void {
  const db = () => getDb()

  // ── 保存/清除"上一年同类补贴"关系 ──
  ipcMain.handle('subsidies:setPrevYearType', (_e, payload: any) => {
    try {
      const typeId = Number(payload?.type_id)
      const rawPrev = payload?.prev_year_type_id
      const prevId = (rawPrev === null || rawPrev === undefined || rawPrev === '')
        ? null : Number(rawPrev)

      const cur = db().getRaw<{ id: number; subsidy_year: number }>(
        'SELECT id, subsidy_year FROM subsidy_type WHERE id = ? AND COALESCE(is_deleted,0) = 0', typeId)
      if (!cur) return errorResponse('补贴项目不存在')

      if (prevId !== null) {
        if (prevId === typeId) return errorResponse('不能将项目关联为它自身的上一年同类')
        const prev = db().getRaw<{ id: number; subsidy_year: number }>(
          'SELECT id, subsidy_year FROM subsidy_type WHERE id = ? AND COALESCE(is_deleted,0) = 0', prevId)
        if (!prev) return errorResponse('上一年同类补贴项目不存在')
        if (Number(prev.subsidy_year) !== Number(cur.subsidy_year) - 1) {
          return errorResponse(`上一年同类补贴的年份必须为 ${Number(cur.subsidy_year) - 1} 年（所选为 ${prev.subsidy_year} 年）`)
        }
        // 防环：沿 prev 回溯，若遇到自身则成环
        let cursor = prevId
        const seen = new Set<number>()
        while (cursor) {
          if (cursor === typeId) return errorResponse('关联会形成循环，请重新选择')
          if (seen.has(cursor)) break
          seen.add(cursor)
          const row = db().getRaw<{ prev_year_type_id: number | null }>(
            'SELECT prev_year_type_id FROM subsidy_type WHERE id = ?', cursor)
          cursor = row?.prev_year_type_id ? Number(row.prev_year_type_id) : null
        }
      }

      db().runRaw('UPDATE subsidy_type SET prev_year_type_id = ? WHERE id = ?', prevId, typeId)
      return success({ ok: true, type_id: typeId, prev_year_type_id: prevId })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 所有已形成链的项目分组 ──
  ipcMain.handle('subsidies:listChains', () => {
    try {
      const rows = loadTypes(db())
      const byId = new Map<number, TypeRow>()
      for (const r of rows) byId.set(Number(r.id), r)

      const prevOf = (id: number): number | null => {
        const r = byId.get(id)
        if (!r) return null
        const p = r.prev_year_type_id
        return p && Number(p) !== id ? Number(p) : null
      }

      // 链成员 = 有 prev 或被别人指向
      const members = new Set<number>()
      for (const r of rows) {
        const id = Number(r.id)
        const p = prevOf(id)
        if (p !== null) { members.add(id); members.add(p) }
      }

      // 链头 = 链成员中没有 prev 的节点
      const heads = new Set<number>()
      for (const id of members) if (prevOf(id) === null) heads.add(id)

      const children = new Map<number, number[]>()
      for (const r of rows) {
        const p = prevOf(Number(r.id))
        if (p !== null) {
          if (!children.has(p)) children.set(p, [])
          children.get(p)!.push(Number(r.id))
        }
      }

      const chains: Array<{
        chain_id: number
        chain_name: string
        year_from: number
        year_to: number
        years: Array<{ type_id: number; subsidy_name: string; subsidy_year: number; season: string | null; category: string | null }>
      }> = []

      for (const headId of heads) {
        const queue = [headId]
        const nodeIds = new Set<number>([headId])
        while (queue.length) {
          const n = queue.shift()!
          for (const c of children.get(n) || []) {
            if (!nodeIds.has(c)) { nodeIds.add(c); queue.push(c) }
          }
        }
        const years = [...nodeIds].map(id => byId.get(id)!)
          .sort((a, b) => Number(a.subsidy_year) - Number(b.subsidy_year))
        const head = byId.get(headId)!
        chains.push({
          chain_id: headId,
          chain_name: head.subsidy_name,
          year_from: Number(years[0].subsidy_year),
          year_to: Number(years[years.length - 1].subsidy_year),
          years: years.map(r => ({
            type_id: Number(r.id),
            subsidy_name: r.subsidy_name,
            subsidy_year: Number(r.subsidy_year),
            season: r.season,
            category: r.category,
          })),
        })
      }

      chains.sort((a, b) => b.year_to - a.year_to || b.year_from - a.year_from)
      return success(chains)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 一条链的完整数据（逐年聚合 + 农户/家庭户明细）──
  ipcMain.handle('subsidies:chainDetail', (_e, payload: any) => {
    try {
      const typeId = Number(payload?.type_id)
      const ds = payload?.data_source === 'payment' ? 'payment' : 'application'

      const chain = collectChain(db(), typeId)
      if (!chain) return errorResponse('该项目不在任何补贴链中（需要先设置上一年同类补贴）')

      const table = ds === 'payment' ? 'subsidy_payment' : 'subsidy_application'
      const yearCol = ds === 'payment' ? 'payment_year' : 'apply_year'
      // 预申请实际发放金额多数未填，退而取申报金额，保证趋势图有数可看
      const amountCol = ds === 'payment' ? 'sa.amount' : 'COALESCE(sa.actual_amount, sa.apply_amount)'
      const villageCol = ds === 'payment' ? 'payment_village_name' : 'apply_village_name'
      const groupDisplayCol = ds === 'payment' ? 'payment_group_display' : 'apply_group_display'

      const typeIds = chain.map(r => r.id)
      const placeholders = typeIds.map(() => '?').join(', ')

      const rows = db().allRaw<{
        yr: number
        amount: number | null
        area: number | null
        farmer_id: number
        id_card: string | null
        real_name: string
        household_id: number | null
        household_name: string | null
        village: string | null
        village_group: string | null
      }>(`
        SELECT sa.${yearCol} AS yr,
               COALESCE(${amountCol}, 0) AS amount,
               COALESCE(sa.apply_area, 0) AS area,
               fp.id AS farmer_id,
               fp.id_card AS id_card,
               fp.real_name AS real_name,
               fp.household_id AS household_id,
               hh.household_name AS household_name,
               COALESCE(NULLIF(sa.${villageCol}, ''), v.village_name) AS village,
               CASE
                 WHEN NULLIF(sa.${groupDisplayCol}, '') IS NOT NULL THEN sa.${groupDisplayCol}
                 WHEN hh.group_no IS NOT NULL THEN CAST(hh.group_no AS TEXT) || '组'
                 ELSE NULL
               END AS village_group
        FROM ${table} sa
        JOIN farmer_profile fp ON fp.id = COALESCE(sa.beneficiary_id, sa.farmer_id)
        LEFT JOIN family_household hh ON hh.id = fp.household_id
        LEFT JOIN village v ON v.id = hh.village_id
        WHERE sa.subsidy_type_id IN (${placeholders})
      `, ...typeIds)

      // ── 逐年聚合 ──
      const years = chain.map(r => ({
        type_id: Number(r.id),
        subsidy_name: r.subsidy_name,
        subsidy_year: Number(r.subsidy_year),
      }))
      const byYear = new Map<number, typeof rows>()
      for (const r of rows) {
        const y = Number(r.yr)
        if (!byYear.has(y)) byYear.set(y, [])
        byYear.get(y)!.push(r)
      }

      // 农户模式：按 id_card 归并；家庭户模式：按当前 household_id 归并
      // 个体名称/村组信息取"最新出现年份"的值（村可能跨年变动）
      type FarmerKey = {
        key: string; name: string; hhId: number | null; hhName: string; village: string
        group: string
        maxYear: number
        perYear: Record<number, { area: number; amount: number }>
      }
      const farmerMap = new Map<string, FarmerKey>()
      const hhMap = new Map<number, FarmerKey>()

      for (const r of rows) {
        const y = Number(r.yr)
        // 农户
        const fkey = r.id_card || `f${r.farmer_id}`
        let f = farmerMap.get(fkey)
        if (!f) {
          f = { key: fkey, name: r.real_name, hhId: r.household_id, hhName: r.household_name || '', village: r.village || '', group: r.village_group || '', maxYear: 0, perYear: {} }
          farmerMap.set(fkey, f)
        }
        f.perYear[y] = {
          area: (f.perYear[y]?.area || 0) + Number(r.area || 0),
          amount: (f.perYear[y]?.amount || 0) + Number(r.amount || 0),
        }
        if (y >= f.maxYear) {
          f.maxYear = y
          f.name = r.real_name
          f.hhId = r.household_id
          f.hhName = r.household_name || ''
          f.village = r.village || ''
          f.group = r.village_group || ''
        }
        // 家庭户（历史归属以当前 household_id 为准）
        const hkey = r.household_id ?? 0
        let h = hhMap.get(hkey)
        if (!h) {
          h = { key: String(hkey), name: r.household_name || '(无家庭户)', hhId: r.household_id, hhName: r.household_name || '', village: r.village || '', group: r.village_group || '', maxYear: 0, perYear: {} }
          hhMap.set(hkey, h)
        }
        h.perYear[y] = {
          area: (h.perYear[y]?.area || 0) + Number(r.area || 0),
          amount: (h.perYear[y]?.amount || 0) + Number(r.amount || 0),
        }
        if (y >= h.maxYear) {
          h.maxYear = y
          h.name = r.household_name || '(无家庭户)'
          h.hhId = r.household_id
          h.hhName = r.household_name || ''
          h.village = r.village || ''
          h.group = r.village_group || ''
        }
      }

      // ── summary + 新增/退出 ──
      const summary = years.map((y, idx) => {
        const arr = byYear.get(y.subsidy_year) || []
        const farmerSet = new Set<string>()
        const hhSet = new Set<number>()
        let area = 0, amount = 0
        for (const r of arr) {
          farmerSet.add(r.id_card || `f${r.farmer_id}`)
          hhSet.add(r.household_id ?? 0)
          area += Number(r.area || 0)
          amount += Number(r.amount || 0)
        }
        const prev = idx > 0 ? byYear.get(years[idx - 1].subsidy_year) || [] : []
        const prevFarmerSet = new Set(prev.map(r => r.id_card || `f${r.farmer_id}`))
        const prevHhSet = new Set(prev.map(r => r.household_id ?? 0))

        let newFarmers = 0, removedFarmers = 0
        for (const k of farmerSet) if (!prevFarmerSet.has(k)) newFarmers++
        for (const k of prevFarmerSet) if (!farmerSet.has(k)) removedFarmers++
        let newHouseholds = 0, removedHouseholds = 0
        for (const k of hhSet) if (!prevHhSet.has(k)) newHouseholds++
        for (const k of prevHhSet) if (!hhSet.has(k)) removedHouseholds++

        return {
          year: y.subsidy_year,
          total_records: arr.length,
          total_farmers: farmerSet.size,
          total_households: hhSet.size,
          total_area: Number(area.toFixed(2)),
          total_amount: Number(amount.toFixed(2)),
          new_farmers: newFarmers,
          removed_farmers: removedFarmers,
          new_households: newHouseholds,
          removed_households: removedHouseholds,
        }
      })

      const farmers = [...farmerMap.values()].map(f => ({
        id_card: f.key,
        real_name: f.name,
        household_name: f.hhName,
        village: f.village,
        group: f.group,
        per_year: f.perYear,
      })).sort((a, b) => (a.household_name || '').localeCompare(b.household_name || '') || a.real_name.localeCompare(b.real_name))

      const hhList = [...hhMap.values()]
        .filter(h => h.hhId !== null && h.hhId !== undefined)
      const hhIds = hhList.map(h => h.hhId as number)

      // 家庭户当前在册成员（供明细矩阵展示"家人"）
      const membersByHh = new Map<number, Array<{ real_name: string; id_card: string | null }>>()
      if (hhIds.length) {
        const hhPh = hhIds.map(() => '?').join(',')
        const memberRows = db().allRaw<{ household_id: number; real_name: string; id_card: string | null }>(
          `SELECT household_id, real_name, id_card FROM farmer_profile
           WHERE household_id IN (${hhPh}) AND farmer_status = 1
           ORDER BY household_id, id`,
          ...hhIds)
        for (const m of memberRows) {
          const hk = Number(m.household_id)
          if (!membersByHh.has(hk)) membersByHh.set(hk, [])
          membersByHh.get(hk)!.push({ real_name: m.real_name, id_card: m.id_card })
        }
      }

      const households = hhList
        .map(h => ({
          household_id: h.hhId,
          household_name: h.name,
          village: h.village,
          group: h.group,
          members: membersByHh.get(h.hhId as number) || [],
          per_year: h.perYear,
        }))
        .sort((a, b) => (a.household_name || '').localeCompare(b.household_name || ''))

      return success({
        years,
        summary,
        farmers,
        households,
      })
    } catch (e) { return errorResponse(String(e)) }
  })
}
