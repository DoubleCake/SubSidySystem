import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { parsePagination, successList, success, errorResponse } from './response'

export function registerLandHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('land:list', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const countRow = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM land_trust')
      const rows = db().allRaw('SELECT * FROM land_trust ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, offset)
      return successList(rows, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:create', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const result = db().runRaw(`INSERT INTO land_trust (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:update', (_e, id: number, data: Record<string, unknown>) => {
    try {
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => data[k])
      db().runRaw(`UPDATE land_trust SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  // 大户管理
  ipcMain.handle('land:listLargeFarmers', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const countRow = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM large_farmer')
      const rows = db().allRaw('SELECT * FROM large_farmer ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, offset)
      return successList(rows, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })
}
