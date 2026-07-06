/**
 * 村级联系人管理 IPC 处理器
 */
import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'
import { existsSync, readFileSync } from 'fs'

function ensureTable() {
  const db = getDb()
  db.runRaw(`
    CREATE TABLE IF NOT EXISTS village_contact (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      village_id INTEGER NOT NULL UNIQUE,
      village_name TEXT DEFAULT '',
      leader_name TEXT DEFAULT '',
      leader_phone TEXT DEFAULT '',
      leader_title TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)
}

export function registerVillageContactsHandlers(): void {
  ensureTable()

  ipcMain.handle('village-contacts:list', () => {
    try {
      const rows = getDb().allRaw<Record<string, unknown>>(
        'SELECT * FROM village_contact ORDER BY village_name'
      )
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:create', (_e, body: any) => {
    try {
      const { village_id, village_name, leader_name, leader_phone, leader_title, contact_name, contact_phone, remark } = body
      const r = getDb().runRaw(
        `INSERT INTO village_contact (village_id, village_name, leader_name, leader_phone, leader_title, contact_name, contact_phone, remark) VALUES (?,?,?,?,?,?,?,?)`,
        village_id, village_name || '', leader_name || '', leader_phone || '', leader_title || '', contact_name || '', contact_phone || '', remark || ''
      )
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:update', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined && k !== 'id')
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const vals = keys.map(k => data[k])
      getDb().runRaw(`UPDATE village_contact SET ${sets}, updated_at=datetime('now','localtime') WHERE id=?`, ...vals, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:delete', (_e, id: number) => {
    try {
      getDb().runRaw('DELETE FROM village_contact WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:setLead', (_e, id: number) => {
    try {
      const c = getDb().getRaw<{ village_id: number }>('SELECT village_id FROM village_contact WHERE id=?', id)
      if (!c) return errorResponse('联系人不存在')
      getDb().runRaw("UPDATE village_contact SET leader_name='', leader_phone='', leader_title='' WHERE village_id=? AND id!=?", c.village_id, id)
      getDb().runRaw("UPDATE village_contact SET leader_name='负责人', leader_title='主要负责人' WHERE id=?", id)
      return success({ message: '已设为负责人' })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('village-contacts:import', (_e, payload: any) => {
    try {
      const { overwrite, filePath } = payload
      if (!existsSync(filePath)) return errorResponse('文件不存在')
      const XLSX = require('xlsx')
      const wb = XLSX.readFile(filePath)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws) as Record<string, string>[]
      let created = 0, updated = 0
      for (const row of rows) {
        const vname = row['村名'] || row['village_name'] || ''
        const vg = getDb().getRaw<{ id: number }>('SELECT id FROM village_group WHERE id=?', Number(row['village_id']) || 0)
        const vid = vg?.id
        if (!vid) continue
        const exist = getDb().getRaw<{ id: number }>('SELECT id FROM village_contact WHERE village_id=?', vid)
        if (exist && overwrite) {
          getDb().runRaw("UPDATE village_contact SET leader_name=?, leader_phone=?, updated_at=datetime('now','localtime') WHERE id=?",
            row['负责人'] || row['leader_name'] || '', row['电话'] || row['leader_phone'] || '', exist.id)
          updated++
        } else if (!exist) {
          getDb().runRaw("INSERT INTO village_contact (village_id, village_name, leader_name, leader_phone) VALUES (?,?,?,?)",
            vid, vname, row['负责人'] || '', row['电话'] || '')
          created++
        }
      }
      return success({ message: `导入完成：新增${created}，更新${updated}` })
    } catch (e) { return errorResponse(String(e)) }
  })
}
