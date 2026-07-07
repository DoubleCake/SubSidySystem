import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { formatGroupNo } from '../utils/format'
import { maskIdCard, maskPhone, maskBankCard } from '../utils/masking'
import { parsePagination, successList, success, errorResponse } from './response'

export function registerHouseholdHandlers(): void {
  const db = () => getDb()

  // ── 列表 ──
  ipcMain.handle('households:list', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const search = (params.search as string || '').trim()
      const villageName = params.village_name as string || ''
      const status = params.status != null ? Number(params.status) : null
      const hasSubsidy = params.has_subsidy != null ? Number(params.has_subsidy) : 0
      const overdrawnOnly = params.overdrawn_only != null ? Number(params.overdrawn_only) : 0
      const confirmedOnly = params.confirmed_only as string || ''

      let where = 'WHERE 1=1'
      const values: unknown[] = []

      if (search) {
        where += ` AND (hh.household_name LIKE ? OR hh.household_code LIKE ? OR head.real_name LIKE ?)`
        values.push(`%${search}%`, `%${search}%`, `%${search}%`)
      }
      if (villageName) {
        where += ` AND v.village_name = ?`
        values.push(villageName)
      }
      if (status != null) {
        where += ` AND hh.status = ?`
        values.push(status)
      }
      if (hasSubsidy === 1) {
        where += ` AND EXISTS (SELECT 1 FROM farmer_profile fp2 JOIN subsidy_application sa2 ON COALESCE(sa2.beneficiary_id,sa2.farmer_id) = fp2.id WHERE fp2.household_id = hh.id)`
      }
      if (overdrawnOnly === 1) {
        where += ` AND (SELECT COALESCE(SUM(sa.apply_area),0) FROM subsidy_application sa JOIN farmer_profile fp2 ON COALESCE(sa.beneficiary_id,sa.farmer_id) = fp2.id WHERE fp2.household_id = hh.id) > COALESCE(hh.contract_area, 0) AND hh.contract_area > 0`
      }
      if (confirmedOnly === '1') {
        where += ` AND hh.is_manually_confirmed = 1`
      } else if (confirmedOnly === '0') {
        where += ` AND (hh.is_manually_confirmed IS NULL OR hh.is_manually_confirmed = 0)`
      }

      const countRow = db().getRaw<{ cnt: number }>(`
        SELECT COUNT(*) as cnt FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN farmer_profile head ON head.id = hh.head_farmer_id
        ${where}
      `, ...values)

      // 用 LEFT JOIN 派生表替代标量子查询，3 个聚合只跑一次而非 N×3 次
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT hh.*, v.village_name,
               COALESCE(mc.cnt, 0) as member_count,
               head.real_name as head_name,
               COALESCE(area.total, 0) as total_subsidy_area
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN (SELECT household_id, COUNT(*) as cnt FROM farmer_profile GROUP BY household_id) mc
          ON mc.household_id = hh.id
        LEFT JOIN farmer_profile head ON head.id = hh.head_farmer_id
        LEFT JOIN (
          SELECT fp2.household_id, COALESCE(SUM(sa.apply_area), 0) as total
          FROM subsidy_application sa
          JOIN farmer_profile fp2 ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp2.id
          GROUP BY fp2.household_id
        ) area ON area.household_id = hh.id
        ${where}
        ORDER BY hh.id DESC
        LIMIT ? OFFSET ?
      `, ...values, pageSize, offset)

      const items = rows.map(r => {
        const contractArea = Number(r.contract_area || 0)
        const subsidyArea = Number(r.total_subsidy_area || 0)
        const isOverdrawn = contractArea > 0 && subsidyArea > contractArea
        return {
          ...r,
          group_display: formatGroupNo(r.group_no as number),
          village_full_name: r.village_name ? `${r.village_name}${formatGroupNo(r.group_no as number)}` : '未知村组',
          is_overdrawn: isOverdrawn,
          used_area: subsidyArea,
        }
      })

      return successList(items, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 详情 ──
  ipcMain.handle('households:get', (_e, payload: any) => {
    try {
      const { id, year } = payload
      const hh = db().getRaw<Record<string, unknown>>(`
        SELECT hh.*, v.village_name,
               (SELECT real_name FROM farmer_profile WHERE id = hh.head_farmer_id) as head_name
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE hh.id = ?
      `, id)

      if (!hh) return errorResponse('家庭户不存在', 404)

      const groupDisplay = formatGroupNo(hh.group_no as number)
      const villageFullName = hh.village_name ? `${hh.village_name}${groupDisplay}` : (groupDisplay || '未知村组')

      const members = db().allRaw<Record<string, unknown>>(`
        SELECT fp.*
        FROM farmer_profile fp
        WHERE fp.household_id = ?
        ORDER BY CASE WHEN fp.relation = '本人' THEN 0 ELSE 1 END, fp.id
      `, id)

      const members_list = members.map(m => ({
        ...m,
        is_head: hh.head_farmer_id === m.id ? 1 : 0,
        restricted_identity: 0,
      }))

      // app_summary: 补贴申请记录 + 代领关系
      let appSummary: unknown[] = []
      try {
        const apps = db().allRaw<Record<string, unknown>>(`
          SELECT sa.id, sa.apply_year,
                 COALESCE(sa.beneficiary_id, sa.farmer_id) as farmer_id,
                 fp.real_name as farmer_name,
                 st.subsidy_name, st.calc_mode,
                 sa.apply_area, COALESCE(sa.apply_amount, 0) as apply_amount,
                 COALESCE(sa.actual_amount, 0) as actual_amount,
                 sa.pay_status, sa.apply_village_name, sa.apply_group_display,
                 sa.is_proxy, sa.subsidy_type_id, sa.apply_area_no_calc
          FROM subsidy_application sa
          JOIN farmer_profile fp ON fp.id = COALESCE(sa.beneficiary_id, sa.farmer_id)
          JOIN subsidy_type st ON st.id = sa.subsidy_type_id
          WHERE fp.household_id = ?
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
            appSummary = apps.map(a => ({
              ...a,
              proxy_info: proxyMap.get(a.id) || null,
            }))
          } catch { appSummary = apps }
        } else {
          appSummary = apps
        }
      } catch { /* table might not exist yet */ }

      // area_usage: 实时计算面积使用情况（按年份+季节汇总）
      const contractedArea = Number(hh.contract_area || 0)
      let areaUsage = {
        contracted_area: contractedArea,
        trust_out_area: 0,
        trust_in_area: 0,
        trust_in_arable_area: 0,
        trust_in_cash_crop_area: 0,
        cultivable_area: contractedArea,
        used_area: 0,
        remaining_area: contractedArea,
        is_overdrawn: false,
        overdraw_amount: 0,
        has_trust_data: false,
        subsidy_breakdown: [] as unknown[],
        season_reference: {} as Record<string, number>,
        season_breakdown: {} as Record<string, unknown>,
        year_totals: {} as Record<string, Record<string, number>>,
        year_apply_totals: {} as Record<string, Record<string, number>>,
        year_payment_totals: {} as Record<string, Record<string, number>>,
      }

      try {
        const areaRows = db().allRaw<{ apply_year: number; season: string; used_area: number; apply_area: number; payment_area: number }>(`
          SELECT sa.apply_year, COALESCE(st.season, '全年单补') as season,
                 COALESCE(SUM(sa.apply_area), 0) as used_area,
                 COALESCE(SUM(sa.apply_area), 0) as apply_area,
                 COALESCE(SUM(CASE WHEN sa.pay_status >= 2 THEN sa.apply_area ELSE 0 END), 0) as payment_area
          FROM subsidy_application sa
          JOIN farmer_profile fp ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp.id
          LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
          WHERE fp.household_id = ?
          GROUP BY sa.apply_year, st.season
          ORDER BY sa.apply_year DESC
        `, id)

        // 汇总 year+season 数据
        const yt: Record<string, Record<string, number>> = {}
        const yat: Record<string, Record<string, number>> = {}
        const ypt: Record<string, Record<string, number>> = {}
        const seasonTotals: Record<string, { used: number; apply: number; payment: number }> = {}

        for (const r of areaRows) {
          const y = String(r.apply_year)
          if (!yt[y]) { yt[y] = {}; yat[y] = {}; ypt[y] = {} }
          yt[y][r.season] = (yt[y][r.season] || 0) + Number(r.used_area)
          yat[y][r.season] = (yat[y][r.season] || 0) + Number(r.apply_area)
          ypt[y][r.season] = (ypt[y][r.season] || 0) + Number(r.payment_area)

          if (!seasonTotals[r.season]) seasonTotals[r.season] = { used: 0, apply: 0, payment: 0 }
          seasonTotals[r.season].used += Number(r.used_area)
          seasonTotals[r.season].apply += Number(r.apply_area)
          seasonTotals[r.season].payment += Number(r.payment_area)
        }

        // 无论有无数据，4个季节始终展示
        const ALL_SEASONS = ['大春', '小春', '全年单补', '临时']
        const sb: Record<string, any> = {}
        let totalUsed = 0
        for (const season of ALL_SEASONS) {
          const totals = seasonTotals[season] || { used: 0, apply: 0, payment: 0 }
          const used = Math.round(totals.used * 100) / 100
          const remaining = Math.max(0, contractedArea - used)
          const isOver = contractedArea > 0 && used > contractedArea
          sb[season] = {
            used_area: used,
            apply_area: Math.round(totals.apply * 100) / 100,
            payment_area: Math.round(totals.payment * 100) / 100,
            remaining_area: Math.round(remaining * 100) / 100,
            is_overdrawn: isOver,
            overdraw_amount: isOver ? Math.round((used - contractedArea) * 100) / 100 : 0,
            reference_area: contractedArea,
            subsidies: [] as unknown[],
          }
          totalUsed = Math.max(totalUsed, used)
        }

        totalUsed = Math.round(totalUsed * 100) / 100
        areaUsage = {
          ...areaUsage,
          used_area: totalUsed,
          remaining_area: Math.round(Math.max(0, contractedArea - totalUsed) * 100) / 100,
          is_overdrawn: contractedArea > 0 && totalUsed > contractedArea,
          overdraw_amount: contractedArea > 0 ? Math.round(Math.max(0, totalUsed - contractedArea) * 100) / 100 : 0,
          season_breakdown: sb,
          year_totals: yt,
          year_apply_totals: yat,
          year_payment_totals: ypt,
        }
      } catch { /* area calculation optional */ }

      // trust_records: 流转记录
      let trustRecords: unknown[] = []
      try {
        trustRecords = db().allRaw(`
          SELECT lt.*,
                 oh.household_name as counterparty_name,
                 vh.village_name as counterparty_village_name,
                 oh.group_no as counterparty_group_no
          FROM land_trust lt
          LEFT JOIN family_household oh ON (
            (lt.owner_household_id = ? AND lt.operator_household_id = oh.id)
            OR (lt.operator_household_id = ? AND lt.owner_household_id = oh.id)
          )
          LEFT JOIN village vh ON oh.village_id = vh.id
          WHERE lt.owner_household_id = ? OR lt.operator_household_id = ?
          ORDER BY lt.trust_year DESC
        `, id, id, id, id)
      } catch { /* table might not exist yet */ }

      return success({
        id: hh.id,
        household_code: hh.household_code,
        household_name: hh.household_name,
        village_full_name: villageFullName,
        village_id: hh.village_id,
        group_no: hh.group_no || 1,
        address: hh.address,
        contracted_area: contractedArea,
        confirmed_area: hh.confirmed_area != null ? Number(hh.confirmed_area) : null,
        status: hh.status,
        remark: hh.remark,
        is_manually_confirmed: hh.is_manually_confirmed || 0,
        manually_confirmed_at: hh.manually_confirmed_at || null,
        manually_confirmed_by: hh.manually_confirmed_by || null,
        head_farmer_id: hh.head_farmer_id,
        head_name: hh.head_name,
        group_display: groupDisplay,
        members: members_list,
        app_summary: appSummary,
        area_usage: areaUsage,
        trust_records: trustRecords,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 新增 ──
  ipcMain.handle('households:create', (_e, data: Record<string, unknown>) => {
    try {
      const result = db().runRaw(`
        INSERT INTO family_household (household_code, household_name, village_id, group_no, address, contract_area, confirmed_area, status, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, data.household_code, data.household_name, data.village_id, data.group_no, data.address, data.contract_area, data.confirmed_area, data.status, data.remark)
      // 更新 household_code
      const code = `HH${String(result.lastInsertRowid).padStart(4, '0')}`
      db().runRaw('UPDATE family_household SET household_code = ? WHERE id = ?', code, result.lastInsertRowid)
      return success({ id: result.lastInsertRowid })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 修改 ──
  ipcMain.handle('households:update', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => data[k])
      db().runRaw(`UPDATE family_household SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, id)
      return success(null, '更新成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 删除 ──
  ipcMain.handle('households:delete', (_e, id: number) => {
    try {
      const memberCount = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM farmer_profile WHERE household_id = ?', id)?.cnt ?? 0
      if (memberCount > 0) {
        return errorResponse(`该家庭户下有${memberCount}名成员，请先移出所有成员`)
      }
      db().runRaw('DELETE FROM family_household WHERE id = ?', id)
      return success({ message: '删除成功', household_id: id })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 成员管理 ──
  ipcMain.handle('households:addMember', (_e, payload: any) => {
    try {
      const { householdId, ...data } = payload
      const result = db().runRaw(`
        INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, householdId, data.real_name, data.gender, data.id_card, data.phone, data.bank_card, data.bank_name, data.relation)
      return success({ id: result.lastInsertRowid, household_id: householdId })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('households:updateMember', (_e, payload: any) => {
    try {
      const { householdId, farmerId, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => data[k])
      db().runRaw(`UPDATE farmer_profile SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?`, ...values, farmerId, householdId)
      return success(null, '更新成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('households:removeMember', (_e, payload: any) => {
    try {
      const { householdId, farmerId } = payload
      db().runRaw("UPDATE farmer_profile SET household_id = NULL, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?", farmerId, householdId)
      return success(null, '移出成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 合并家庭户 ──
  ipcMain.handle('households:merge', (_e, payload: any) => {
    try {
      const { source_household_id: sourceId, target_household_id: targetId, operator } = payload
      db().runRaw("UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE household_id = ?", targetId, sourceId)
      db().runRaw('DELETE FROM family_household WHERE id = ?', sourceId)
      return success({ message: '合并成功' })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 村组选项 ──
  ipcMain.handle('households:groupOptions', () => {
    try {
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT DISTINCT v.village_name, vg.group_no
        FROM village_group vg
        JOIN village v ON vg.village_id = v.id
        ORDER BY v.village_name, vg.group_no
      `)

      return success(rows.map(r => ({
        ...r,
        group_display: formatGroupNo(r.group_no as number),
      })))
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 面积缓存刷新 ──
  ipcMain.handle('households:refreshAreaCache', (_e, householdId?: number) => {
    try {
      return success({ message: '面积缓存刷新功能待实现' })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 超面积预警 ──
  ipcMain.handle('households:overdrawn', () => {
    try {
      // 使用派生表一次聚合，避免 WHERE 和 SELECT 中重复子查询
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT hh.*, v.village_name,
               COALESCE(mc.cnt, 0) as member_count,
               COALESCE(area.total, 0) as total_subsidy_area
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN (SELECT household_id, COUNT(*) as cnt FROM farmer_profile GROUP BY household_id) mc
          ON mc.household_id = hh.id
        LEFT JOIN (
          SELECT fp2.household_id, COALESCE(SUM(sa.apply_area), 0) as total
          FROM subsidy_application sa
          JOIN farmer_profile fp2 ON sa.beneficiary_id = fp2.id
          GROUP BY fp2.household_id
        ) area ON area.household_id = hh.id
        WHERE hh.contract_area IS NOT NULL AND hh.contract_area > 0
          AND COALESCE(area.total, 0) > hh.contract_area
        ORDER BY area.total DESC
      `)
      return success(rows.map(r => ({ ...r, group_display: formatGroupNo(r.group_no as number) })))
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 超领明细导出 ──
  ipcMain.handle('households:overdrawnDetail', (_e, payload: any) => {
    try {
      const year = payload?.year ? Number(payload.year) : new Date().getFullYear()

      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT hh.household_name, head.real_name as head_name,
               v.village_name as village,
               COALESCE(hh.contract_area, 0) as contracted_area,
               COALESCE(hh.cultivable_area, 0) as cultivable_area,
               COALESCE(area.total, 0) as used_area,
               MAX(0, COALESCE(area.total, 0) - COALESCE(hh.contract_area, 0)) as overdraw_amount
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN farmer_profile head ON head.id = hh.head_farmer_id
        LEFT JOIN (
          SELECT fp2.household_id, COALESCE(SUM(sa.apply_area), 0) as total
          FROM subsidy_application sa
          JOIN farmer_profile fp2 ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp2.id
          WHERE sa.apply_year = ?
          GROUP BY fp2.household_id
        ) area ON area.household_id = hh.id
        WHERE hh.contract_area IS NOT NULL AND hh.contract_area > 0
          AND COALESCE(area.total, 0) > hh.contract_area
        ORDER BY overdraw_amount DESC
      `, year)

      const items = rows.map(r => ({ ...r, season_breakdown: {} }))
      return success({ year, total: items.length, items })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 成员迁移（从一个家庭户移到另一个） ──
  ipcMain.handle('households:moveMember', (_e, payload: any) => {
    try {
      const { householdId, farmerId, targetHouseholdId } = payload
      db().runRaw(
        "UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?",
        targetHouseholdId, farmerId, householdId
      )
      // 记录事件：从原户移出
      db().runRaw(
        "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MEMBER_REMOVE', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        householdId, `农户ID ${farmerId} 迁出至家庭户 ${targetHouseholdId}`
      )
      // 记录事件：迁入目标户
      db().runRaw(
        "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MEMBER_ADD', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        targetHouseholdId, `农户ID ${farmerId} 从家庭户 ${householdId} 迁入`
      )
      return success(null, '迁移成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 获取家庭成员 ──
  ipcMain.handle('households:members', (_e, payload: any) => {
    try {
      const { householdId } = payload
      const members = db().allRaw<Record<string, unknown>>(`
        SELECT fp.*
        FROM farmer_profile fp
        WHERE fp.household_id = ?
        ORDER BY CASE WHEN fp.relation = '本人' THEN 0 ELSE 1 END, fp.id
      `, householdId)
      return success(members)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 按年度统计面积 ──
  ipcMain.handle('households:areaByYear', (_e, payload: any) => {
    try {
      const { householdId } = payload
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT sa.apply_year,
               COUNT(DISTINCT sa.beneficiary_id) as beneficiary_count,
               COALESCE(SUM(sa.apply_area), 0) as total_area,
               COALESCE(SUM(sa.contract_area), 0) as total_contract_area,
               COALESCE(SUM(sa.trust_area), 0) as total_trust_area,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount
        FROM subsidy_application sa
        JOIN farmer_profile fp ON sa.beneficiary_id = fp.id
        WHERE fp.household_id = ?
        GROUP BY sa.apply_year
        ORDER BY sa.apply_year DESC
      `, householdId)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 家庭户事件列表 ──
  ipcMain.handle('households:events', (_e, payload: any) => {
    try {
      const { householdId, year } = payload
      let query = 'SELECT * FROM household_event WHERE household_id = ?'
      const params: unknown[] = [householdId]
      if (year) {
        query += ' AND event_year = ?'
        params.push(year)
      }
      query += ' ORDER BY event_date DESC, id DESC'
      const rows = db().allRaw<Record<string, unknown>>(query, ...params)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 新增事件 ──
  ipcMain.handle('households:addEvent', (_e, payload: any) => {
    try {
      const { householdId, event_type, event_year, description, event_date, related_hh_id, operator } = payload
      const result = db().runRaw(`
        INSERT INTO household_event (household_id, event_type, event_year, description, event_date, related_hh_id, date_accuracy)
        VALUES (?, ?, ?, ?, ?, ?, 'YEAR')
      `, householdId, event_type, event_year, description || '', event_date || null, related_hh_id || null)
      return success({ id: result.lastInsertRowid })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 撤销事件 ──
  ipcMain.handle('households:undoEvent', (_e, payload: any) => {
    try {
      const { householdId, eventId } = payload
      db().runRaw('DELETE FROM household_event WHERE id = ? AND household_id = ?', eventId, householdId)
      return success(null, '撤销成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 历史日期列表 ──
  ipcMain.handle('households:historyDates', (_e, payload: any) => {
    try {
      const { householdId } = payload
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT DISTINCT event_date FROM household_event WHERE household_id = ? AND event_date IS NOT NULL ORDER BY event_date DESC
      `, householdId)
      return success(rows.map(r => r.event_date))
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 按日期查看快照 ──
  ipcMain.handle('households:snapshotAt', (_e, payload: any) => {
    try {
      const { householdId, date } = payload
      const events = db().allRaw<Record<string, unknown>>(`
        SELECT * FROM household_event WHERE household_id = ? AND event_date = ? ORDER BY id
      `, householdId, date)
      return success(events)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 按事件ID查看快照 ──
  ipcMain.handle('households:snapshotByEvent', (_e, payload: any) => {
    try {
      const { householdId, eventId } = payload
      const event = db().getRaw<Record<string, unknown>>(
        'SELECT * FROM household_event WHERE id = ?', eventId
      )
      return success(event || null)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 历史年度列表 ──
  ipcMain.handle('households:historyYears', (_e, payload: any) => {
    try {
      const { householdId } = payload
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT DISTINCT event_year FROM household_event WHERE household_id = ? ORDER BY event_year DESC
      `, householdId)
      return success(rows.map(r => r.event_year))
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 按年度查看历史 ──
  ipcMain.handle('households:history', (_e, payload: any) => {
    try {
      const { householdId, year } = payload
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT * FROM household_event WHERE household_id = ? AND event_year = ? ORDER BY event_date DESC, id DESC
      `, householdId, year)
      return success(rows)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 分户 ──
  ipcMain.handle('households:split', (_e, payload: any) => {
    try {
      const householdId = Number(payload.householdId || payload.household_id) || 0
      if (!householdId) return errorResponse('缺少源家庭户ID')
      const newHouseholdName = payload.newHouseholdName || payload.new_household_name || '新家庭户'
      const villageId = Number(payload.villageId || payload.village_id) || null
      const groupNo = Number(payload.groupNo || payload.group_no) || 1
      const memberIds: number[] = payload.memberIds || payload.member_ids || []
      const newHeadId = Number(payload.newHeadId || payload.new_head_id) || null
      const newLandArea = Number(payload.newLandArea || payload.new_land_area) || 0
      const originLandArea = Number(payload.originLandArea || payload.origin_land_area) || 0

      // 1. 创建新家庭户（village_id 可为 NULL）
      const code = `HH_SPLIT_${Date.now()}`
      const result = villageId
        ? db().runRaw(`
            INSERT INTO family_household (household_code, household_name, village_id, group_no, address, contract_area, status, head_farmer_id, remark)
            VALUES (?, ?, ?, ?, '', ?, 1, ?, ?)
          `, code, newHouseholdName, villageId, groupNo, newLandArea, newHeadId, `从家庭户 ${householdId} 分出`)
        : db().runRaw(`
            INSERT INTO family_household (household_code, household_name, group_no, address, contract_area, status, head_farmer_id, remark)
            VALUES (?, ?, ?, '', ?, 1, ?, ?)
          `, code, newHouseholdName, groupNo, newLandArea, newHeadId, `从家庭户 ${householdId} 分出`)

      const newHouseholdId = result.lastInsertRowid
      const newCode = `HH${String(newHouseholdId).padStart(4, '0')}`
      db().runRaw('UPDATE family_household SET household_code = ? WHERE id = ?', newCode, newHouseholdId)

      // 2. 迁移成员到新户
      for (const farmerId of memberIds) {
        if (newHeadId && farmerId === newHeadId) {
          db().runRaw(
            "UPDATE farmer_profile SET household_id = ?, relation = '本人', updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?",
            newHouseholdId, farmerId, householdId
          )
        } else {
          db().runRaw(
            "UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?",
            newHouseholdId, farmerId, householdId
          )
        }
      }

      // 3. 更新原户承包面积
      if (originLandArea > 0) {
        db().runRaw('UPDATE family_household SET contract_area = ? WHERE id = ?', originLandArea, householdId)
      }

      // 4. 记录事件（原户）
      db().runRaw(
        "INSERT INTO household_event (household_id, related_hh_id, event_type, event_year, description, event_date) VALUES (?, ?, 'SPLIT', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        householdId, newHouseholdId, `分户：分出家庭户 ${newHouseholdName} (${newCode})，分出成员 ${memberIds?.length || 0} 人`
      )

      // 5. 记录事件（新户）
      db().runRaw(
        "INSERT INTO household_event (household_id, related_hh_id, event_type, event_year, description, event_date) VALUES (?, ?, 'FOUND', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        newHouseholdId, householdId, `由家庭户 ${householdId} 分出，自动建档`
      )

      return success({ new_household_id: newHouseholdId, new_household_code: newCode })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 批量创建家庭户 ──
  ipcMain.handle('households:batchBuild', (_e, payload: any) => {
    try {
      const { rows } = payload
      const created: number[] = []
      const errors: { row: number; message: string }[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const result = db().runRaw(`
            INSERT INTO family_household (household_code, household_name, village_id, group_no, address, contract_area, confirmed_area, status, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            row.household_code || `HH_TEMP_${Date.now()}_${i}`,
            row.household_name || '',
            row.village_id || null,
            row.group_no || 1,
            row.address || '',
            row.contract_area || null,
            row.confirmed_area || null,
            row.status != null ? row.status : 1,
            row.remark || ''
          )
          const id = result.lastInsertRowid
          const code = `HH${String(id).padStart(4, '0')}`
          db().runRaw('UPDATE family_household SET household_code = ? WHERE id = ?', code, id)
          created.push(id)
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) })
        }
      }

      return success({ created, total: rows.length, created_count: created.length, error_count: errors.length, errors })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 批量导入成员 ──
  ipcMain.handle('households:batchImportMembers', (_e, payload: any) => {
    try {
      const { householdId, rows } = payload
      const created: number[] = []
      const errors: { row: number; message: string }[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const result = db().runRaw(`
            INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
          `,
            householdId,
            row.real_name || '',
            row.gender || 1,
            row.id_card || '',
            row.phone || null,
            row.bank_card || null,
            row.bank_name || null,
            row.relation || '成员'
          )
          created.push(result.lastInsertRowid)
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) })
        }
      }

      return success({ created, total: rows.length, created_count: created.length, error_count: errors.length, errors })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 导入确权面积 ──
  ipcMain.handle('households:importConfirmedArea', (_e, payload: any) => {
    try {
      const rows = payload as Array<{ real_name: string; id_card: string; confirmed_area: number }>
      const updated: number[] = []
      const errors: { row: number; message: string }[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const farmer = db().getRaw<Record<string, unknown>>(
            'SELECT id, household_id FROM farmer_profile WHERE real_name = ? AND id_card = ?',
            row.real_name, row.id_card
          )
          if (!farmer || !farmer.household_id) {
            errors.push({ row: i + 1, message: `未找到匹配的农户：${row.real_name} ${row.id_card}` })
            continue
          }
          db().runRaw(
            "UPDATE family_household SET confirmed_area = ?, updated_at = datetime('now','localtime') WHERE id = ?",
            row.confirmed_area, farmer.household_id
          )
          updated.push(farmer.household_id as number)
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) })
        }
      }

      return success({ updated_count: updated.length, error_count: errors.length, errors })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 人工确认 ──
  ipcMain.handle('households:manualConfirm', (_e, payload: any) => {
    try {
      const { householdId, operator, remark } = payload
      db().runRaw(
        "UPDATE family_household SET is_manually_confirmed = 1, manually_confirmed_at = datetime('now','localtime'), manually_confirmed_by = ? WHERE id = ?",
        operator || null, householdId
      )
      // 记录事件
      db().runRaw(
        "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MANUAL_CONFIRM', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        householdId, remark || `人工确认（操作人：${operator || '未知'}）`
      )
      return success(null, '确认成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 取消确认 ──
  ipcMain.handle('households:cancelConfirm', (_e, payload: any) => {
    try {
      const { householdId, operator, remark } = payload
      db().runRaw('UPDATE family_household SET is_manually_confirmed = 0 WHERE id = ?', householdId)
      // 记录事件
      db().runRaw(
        "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MANUAL_CONFIRM', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        householdId, remark || `取消确认（操作人：${operator || '未知'}）`
      )
      return success(null, '已取消确认')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 批量确认 ──
  ipcMain.handle('households:batchConfirm', (_e, payload: any) => {
    try {
      const { household_ids, operator, remark } = payload
      if (!household_ids || !Array.isArray(household_ids)) {
        return errorResponse('household_ids 必须为数组')
      }
      for (const hid of household_ids) {
        db().runRaw(
          "UPDATE family_household SET is_manually_confirmed = 1, manually_confirmed_at = datetime('now','localtime'), manually_confirmed_by = ? WHERE id = ?",
          operator || null, hid
        )
        db().runRaw(
          "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MANUAL_CONFIRM', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
          hid, remark || `批量确认（操作人：${operator || '未知'}）`
        )
      }
      return success({ confirmed_count: household_ids.length })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 重新计算未确认户的承包面积 ──
  ipcMain.handle('households:recalcUnconfirmedContractArea', () => {
    try {
      // 用一条 GROUP BY 查询替代 N+1 循环
      const areaRows = db().allRaw<{ household_id: number; total_area: number }>(`
        SELECT fp.household_id, COALESCE(SUM(sa.contract_area), 0) as total_area
        FROM subsidy_application sa
        JOIN farmer_profile fp ON fp.id = COALESCE(sa.beneficiary_id, sa.farmer_id)
        JOIN family_household hh ON hh.id = fp.household_id
        WHERE hh.is_manually_confirmed = 0
          AND sa.apply_year = CAST(strftime('%Y','now') AS INTEGER)
          AND sa.contract_area > 0
        GROUP BY fp.household_id
      `)

      let updated = 0
      for (const row of areaRows) {
        if (row.total_area > 0) {
          db().runRaw('UPDATE family_household SET contract_area = ? WHERE id = ?',
            row.total_area, row.household_id)
          updated++
        }
      }

      const total = db().getRaw<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM family_household WHERE is_manually_confirmed = 0'
      )

      return success({ total_unconfirmed: total?.cnt ?? 0, updated })
    } catch (e) {
      return errorResponse(String(e))
    }
  })
}
