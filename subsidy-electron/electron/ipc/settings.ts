import { ipcMain, app } from 'electron'
import { getDb } from '../database/connection'
import { getDbPath } from '../database/connection'
import { success, errorResponse, parsePagination, successList } from './response'
import { copyFileSync } from 'fs'
import { join } from 'path'

export function registerSettingsHandlers(): void {
  const db = () => getDb()

  // 村组管理
  ipcMain.handle('settings:listVillageGroups', () => {
    try {
      const rows = db().allRaw(`
        SELECT vg.*, v.village_name FROM village_group vg
        JOIN village v ON vg.village_id = v.id
        ORDER BY v.village_name, vg.group_no
      `)
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('settings:createVillageGroup', (_e, data: { village_name: string; group_no: string }) => {
    try {
      // 确保 village 存在
      let village = db().getRaw<{ id: number }>('SELECT id FROM village WHERE village_name = ?', data.village_name)
      if (!village) {
        const r = db().runRaw('INSERT INTO village (village_name) VALUES (?)', data.village_name)
        village = { id: Number(r.lastInsertRowid) }
      }
      const result = db().runRaw('INSERT INTO village_group (village_id, group_no) VALUES (?, ?)', village.id, data.group_no)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  // 备份
  ipcMain.handle('settings:backup', (_e, destPath: string) => {
    try {
      const srcPath = getDbPath()
      copyFileSync(srcPath, destPath)
      return success({ message: '备份成功', path: destPath })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('settings:getDbInfo', () => {
    try {
      const path = getDbPath()
      const tables = db().allRaw<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      const counts: Record<string, number> = {}
      for (const t of tables) {
        try {
          const r = db().getRaw<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM "${t.name}"`)
          counts[t.name] = r?.cnt ?? 0
        } catch { /* skip */ }
      }
      return success({ path, tables: tables.map(t => t.name), counts })
    } catch (e) { return errorResponse(String(e)) }
  })
}
