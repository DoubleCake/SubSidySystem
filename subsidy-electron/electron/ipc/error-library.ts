import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { parsePagination, successList, success, errorResponse } from './response'

export function registerErrorLibraryHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('error-library:list', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const countRow = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM error_library')
      const rows = db().allRaw('SELECT * FROM error_library ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, offset)
      return successList(rows, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('error-library:create', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const result = db().runRaw(`INSERT INTO error_library (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('error-library:update', (_e, id: number, data: Record<string, unknown>) => {
    try {
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => data[k])
      db().runRaw(`UPDATE error_library SET ${sets} WHERE id = ?`, ...values, id)
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('error-library:delete', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM error_library WHERE id = ?', id)
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('error-library:batchDelete', (_e, ids: number[]) => {
    try {
      for (const id of ids) {
        db().runRaw('DELETE FROM error_library WHERE id = ?', id)
      }
      return success({ deleted: ids.length })
    } catch (e) { return errorResponse(String(e)) }
  })
}
