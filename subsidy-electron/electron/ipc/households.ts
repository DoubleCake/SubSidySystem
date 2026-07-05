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
      const search = params.search as string || ''
      const villageName = params.village_name as string || ''
      const status = params.status != null ? Number(params.status) : null

      let where = 'WHERE 1=1'
      const values: unknown[] = []

      if (search) {
        where += ` AND (hh.household_name LIKE ? OR hh.household_code LIKE ?)`
        values.push(`%${search}%`, `%${search}%`)
      }
      if (villageName) {
        where += ` AND v.village_name = ?`
        values.push(villageName)
      }
      if (status != null) {
        where += ` AND hh.status = ?`
        values.push(status)
      }

      const countRow = db().getRaw<{ cnt: number }>(`
        SELECT COUNT(*) as cnt FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        ${where}
      `, ...values)

      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT hh.*, v.village_name,
               (SELECT COUNT(*) FROM farmer_profile WHERE household_id = hh.id) as member_count,
               (SELECT real_name FROM farmer_profile WHERE id = hh.head_farmer_id) as head_name
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        ${where}
        ORDER BY hh.id DESC
        LIMIT ? OFFSET ?
      `, ...values, pageSize, offset)

      const items = rows.map(r => ({
        ...r,
        group_display: formatGroupNo(r.group_no as number),
      }))

      return successList(items, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 详情 ──
  ipcMain.handle('households:get', (_e, id: number, year?: number) => {
    try {
      const hh = db().getRaw<Record<string, unknown>>(`
        SELECT hh.*, v.village_name,
               (SELECT real_name FROM farmer_profile WHERE id = hh.head_farmer_id) as head_name
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE hh.id = ?
      `, id)

      if (!hh) return errorResponse('家庭户不存在', 404)

      const members = db().allRaw<Record<string, unknown>>(`
        SELECT fp.*
        FROM farmer_profile fp
        WHERE fp.household_id = ?
        ORDER BY CASE WHEN fp.relation = '本人' THEN 0 ELSE 1 END, fp.id
      `, id)

      const maskedMembers = members.map(m => ({
        ...m,
        id_card: maskIdCard(m.id_card as string),
        phone: m.phone ? maskPhone(m.phone as string) : null,
        bank_card: m.bank_card ? maskBankCard(m.bank_card as string) : null,
      }))

      return success({ ...hh, group_display: formatGroupNo(hh.group_no as number), members: maskedMembers })
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
  ipcMain.handle('households:update', (_e, id: number, data: Record<string, unknown>) => {
    try {
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
  ipcMain.handle('households:addMember', (_e, householdId: number, data: Record<string, unknown>) => {
    try {
      const result = db().runRaw(`
        INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, householdId, data.real_name, data.gender, data.id_card, data.phone, data.bank_card, data.bank_name, data.relation)
      return success({ id: result.lastInsertRowid, household_id: householdId })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  ipcMain.handle('households:updateMember', (_e, householdId: number, farmerId: number, data: Record<string, unknown>) => {
    try {
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

  ipcMain.handle('households:removeMember', (_e, householdId: number, farmerId: number) => {
    try {
      db().runRaw("UPDATE farmer_profile SET household_id = NULL, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?", farmerId, householdId)
      return success(null, '移出成功')
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 合并家庭户 ──
  ipcMain.handle('households:merge', (_e, sourceId: number, targetId: number, operator?: string) => {
    try {
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
}
