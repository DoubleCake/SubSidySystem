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

  ipcMain.handle('error-library:update', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
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

  // ── 错误统计 ──
  ipcMain.handle('error-library:stats', () => {
    try {
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT error_type, COUNT(*) as count
        FROM error_library
        GROUP BY error_type
        ORDER BY count DESC
      `)
      const total = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM error_library')
      return success({ total: total?.cnt ?? 0, by_type: rows })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 批量导入 ──
  ipcMain.handle('error-library:batchImport', (_e, payload: any) => {
    try {
      const { rows } = payload
      const inserted: number[] = []
      const errors: { row: number; message: string }[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const cols = Object.keys(row).join(', ')
          const placeholders = Object.keys(row).map(() => '?').join(', ')
          const values = Object.keys(row).map(k => row[k])
          const result = db().runRaw(`INSERT INTO error_library (${cols}) VALUES (${placeholders})`, ...values)
          inserted.push(result.lastInsertRowid)
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) })
        }
      }

      return success({
        total: rows.length,
        inserted_count: inserted.length,
        error_count: errors.length,
        errors,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })
}
