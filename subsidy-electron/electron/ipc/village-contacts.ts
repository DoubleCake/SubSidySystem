/**
 * 村组联系人管理 — 历史时间线模式
 *
 * village_contact:    村负责人（时间轴：start_year → end_year，同一村不重叠）
 * village_group_contact: 组负责人（同上）
 *
 * 规则：新增"至今"记录时自动把上一个 end_year 封口。
 */
import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, successList, errorResponse } from './response'

// ── 工具：把上一个"至今"记录的 end_year 封口 ──
function closePreviousVillage(villageId: number, currentYear: number) {
  const db = getDb()
  const prev = db.getRaw<{ id: number }>(
    'SELECT id FROM village_contact WHERE village_id=? AND end_year IS NULL AND id != (SELECT MAX(id) FROM village_contact WHERE village_id=?)',
    villageId, villageId
  )
  if (prev) {
    db.runRaw('UPDATE village_contact SET end_year=? WHERE id=?', currentYear - 1, prev.id)
  }
}

function closePreviousGroup(villageGroupId: number, currentYear: number) {
  const db = getDb()
  const prev = db.getRaw<{ id: number }>(
    'SELECT id FROM village_group_contact WHERE village_group_id=? AND end_year IS NULL',
    villageGroupId
  )
  if (prev) {
    db.runRaw('UPDATE village_group_contact SET end_year=? WHERE id=?', currentYear - 1, prev.id)
  }
}

// ── 注册 ──
export function registerVillageContactsHandlers(): void {
  // ═══════ 村负责人 ═══════

  // 列表（按村分组 + 时间线）
  ipcMain.handle('village-contacts:list', (_e, params?: { village_id?: number; year?: number }) => {
    try {
      const villageId = params?.village_id ? Number(params.village_id) : undefined
      const year = params?.year ? Number(params.year) : undefined

      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (villageId) { where += ' AND vc.village_id=?'; vals.push(villageId) }
      if (year) {
        where += ' AND vc.start_year <= ? AND (vc.end_year IS NULL OR vc.end_year >= ?)'
        vals.push(year, year)
      }

      const rows = getDb().allRaw<Record<string, unknown>>(`
        SELECT vc.*, v.village_name
        FROM village_contact vc
        LEFT JOIN village v ON vc.village_id = v.id
        ${where}
        ORDER BY vc.village_name, vc.start_year DESC
      `, ...vals)

      // 同时返回 village 列表供选择
      const villages = getDb().allRaw<Record<string, unknown>>(
        'SELECT id, village_name FROM village ORDER BY village_name'
      )

      return success({ items: rows, villages })
    } catch (e) { return errorResponse(String(e)) }
  })

  // 某村的时间线
  ipcMain.handle('village-contacts:timeline', (_e, villageId: number) => {
    try {
      const contacts = getDb().allRaw<Record<string, unknown>>(`
        SELECT vc.*, v.village_name
        FROM village_contact vc
        JOIN village v ON vc.village_id = v.id
        WHERE vc.village_id = ?
        ORDER BY vc.start_year DESC
      `, villageId)

      // 组联系人
      const groups = getDb().allRaw<Record<string, unknown>>(`
        SELECT vgc.*, vg.group_no
        FROM village_group_contact vgc
        LEFT JOIN village_group vg ON vgc.village_group_id = vg.id
        WHERE vgc.village_id = ?
        ORDER BY vgc.group_no, vgc.start_year DESC
      `, villageId)

      return success({ contacts, groups })
    } catch (e) { return errorResponse(String(e)) }
  })

  // 新增
  ipcMain.handle('village-contacts:create', (_e, body: any) => {
    try {
      const { village_id, leader_name, leader_phone, leader_title, contact_name, contact_phone, start_year, end_year, remark } = body
      const sy = Number(start_year || new Date().getFullYear())
      const ey = end_year != null && end_year !== '' ? Number(end_year) : null

      // 如果是"至今"（end_year=null），先封口旧记录
      if (ey === null) closePreviousVillage(Number(village_id), sy)

      const villageName = getDb().getRaw<{ village_name: string }>(
        'SELECT village_name FROM village WHERE id=?', Number(village_id)
      )?.village_name || ''

      const r = getDb().runRaw(
        `INSERT INTO village_contact (village_id, village_name, leader_name, leader_phone, leader_title, contact_name, contact_phone, start_year, end_year, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        Number(village_id), villageName, String(leader_name || ''), String(leader_phone || ''),
        String(leader_title || ''), String(contact_name || ''), String(contact_phone || ''),
        sy, ey, String(remark || '')
      )
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  // 更新
  ipcMain.handle('village-contacts:update', (_e, body: any) => {
    try {
      const { id, ...data } = body
      const allowed = ['leader_name', 'leader_phone', 'leader_title', 'contact_name', 'contact_phone', 'start_year', 'end_year', 'remark']
      const updates: Record<string, unknown> = {}
      for (const k of allowed) {
        if (data[k] !== undefined) updates[k] = data[k]
      }
      if (Object.keys(updates).length === 0) return errorResponse('无更新数据')

      const sets = Object.keys(updates).map(k => `${k}=?`).join(',')
      const vals = Object.values(updates)
      getDb().runRaw(
        `UPDATE village_contact SET ${sets}, updated_at=datetime('now','localtime') WHERE id=?`,
        ...vals, id
      )
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  // 删除
  ipcMain.handle('village-contacts:delete', (_e, id: number) => {
    try {
      getDb().runRaw('DELETE FROM village_contact WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════ 组负责人 ═══════

  ipcMain.handle('village-contacts:listGroups', (_e, params?: { village_id?: number; year?: number }) => {
    try {
      const villageId = params?.village_id ? Number(params.village_id) : undefined
      const year = params?.year ? Number(params.year) : undefined

      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (villageId) { where += ' AND vgc.village_id=?'; vals.push(villageId) }
      if (year) {
        where += ' AND vgc.start_year <= ? AND (vgc.end_year IS NULL OR vgc.end_year >= ?)'
        vals.push(year, year)
      }

      const rows = getDb().allRaw<Record<string, unknown>>(`
        SELECT vgc.*, v.village_name, vg.group_no
        FROM village_group_contact vgc
        LEFT JOIN village v ON vgc.village_id = v.id
        LEFT JOIN village_group vg ON vgc.village_group_id = vg.id
        ${where}
        ORDER BY v.village_name, vgc.group_no, vgc.start_year DESC
      `, ...vals)

      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:createGroup', (_e, body: any) => {
    try {
      const { village_id, village_group_id, group_no, leader_name, leader_phone, start_year, end_year, remark } = body
      const sy = Number(start_year || new Date().getFullYear())
      const ey = end_year != null && end_year !== '' ? Number(end_year) : null

      if (ey === null) closePreviousGroup(Number(village_group_id), sy)

      const r = getDb().runRaw(
        `INSERT INTO village_group_contact (village_id, village_group_id, group_no, leader_name, leader_phone, start_year, end_year, remark)
         VALUES (?,?,?,?,?,?,?,?)`,
        Number(village_id), Number(village_group_id), Number(group_no || 1),
        String(leader_name || ''), String(leader_phone || ''),
        sy, ey, String(remark || '')
      )
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:updateGroup', (_e, body: any) => {
    try {
      const { id, ...data } = body
      const allowed = ['leader_name', 'leader_phone', 'start_year', 'end_year', 'remark']
      const updates: Record<string, unknown> = {}
      for (const k of allowed) {
        if (data[k] !== undefined) updates[k] = data[k]
      }
      if (Object.keys(updates).length === 0) return errorResponse('无更新数据')

      const sets = Object.keys(updates).map(k => `${k}=?`).join(',')
      const vals = Object.values(updates)
      getDb().runRaw(`UPDATE village_group_contact SET ${sets} WHERE id=?`, ...vals, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:deleteGroup', (_e, id: number) => {
    try {
      getDb().runRaw('DELETE FROM village_group_contact WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════ 获取某村的所有组（用于新增组联系人的下拉选项） ═══════
  ipcMain.handle('village-contacts:getGroups', (_e, villageId: number) => {
    try {
      const rows = getDb().allRaw<Record<string, unknown>>(
        'SELECT vg.id as village_group_id, vg.group_no FROM village_group vg WHERE vg.village_id = ? ORDER BY vg.group_no',
        villageId
      )
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════ 批量导入 ═══════

  ipcMain.handle('village-contacts:importVillage', (_e, rows: any[]) => {
    try {
      let created = 0, updated = 0, skipped = 0
      for (const row of rows) {
        const villageName = String(row['村名'] || '').trim()
        if (!villageName) { skipped++; continue }
        const v = getDb().getRaw<{ id: number }>('SELECT id FROM village WHERE village_name=?', villageName)
        if (!v) { skipped++; continue }
        const startYear = Number(row['开始年份']) || new Date().getFullYear()
        const endYearRaw = row['结束年份']
        const endYear = (endYearRaw != null && String(endYearRaw).trim() !== '') ? Number(endYearRaw) : null

        if (endYear === null) closePreviousVillage(v.id, startYear)

        getDb().runRaw(
          `INSERT INTO village_contact (village_id, village_name, leader_name, leader_phone, leader_title, contact_name, contact_phone, start_year, end_year, remark)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          v.id, villageName,
          String(row['负责人姓名'] || '').trim(), String(row['电话'] || '').trim(),
          String(row['职务'] || '').trim(), String(row['次要联系人'] || '').trim(),
          String(row['次要联系人电话'] || '').trim(),
          startYear, endYear, String(row['备注'] || '').trim()
        )
        created++
      }
      return success({ created, updated, skipped })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:importGroups', (_e, rows: any[]) => {
    try {
      let created = 0, skipped = 0
      for (const row of rows) {
        const villageName = String(row['村名'] || '').trim()
        const groupNo = Number(row['组号'] || 0)
        if (!villageName || !groupNo) { skipped++; continue }
        const vg = getDb().getRaw<{ village_group_id: number; village_id: number }>(
          'SELECT vg.id as village_group_id, vg.village_id FROM village_group vg JOIN village v ON vg.village_id=v.id WHERE v.village_name=? AND vg.group_no=?',
          villageName, groupNo
        )
        if (!vg) { skipped++; continue }
        const startYear = Number(row['开始年份']) || new Date().getFullYear()
        const endYearRaw = row['结束年份']
        const endYear = (endYearRaw != null && String(endYearRaw).trim() !== '') ? Number(endYearRaw) : null

        if (endYear === null) closePreviousGroup(vg.village_group_id, startYear)

        getDb().runRaw(
          `INSERT INTO village_group_contact (village_id, village_group_id, group_no, leader_name, leader_phone, start_year, end_year, remark)
           VALUES (?,?,?,?,?,?,?,?)`,
          vg.village_id, vg.village_group_id, groupNo,
          String(row['组长姓名'] || '').trim(), String(row['电话'] || '').trim(),
          startYear, endYear, String(row['备注'] || '').trim()
        )
        created++
      }
      return success({ created, skipped })
    } catch (e) { return errorResponse(String(e)) }
  })
}
