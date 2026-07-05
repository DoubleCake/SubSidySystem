import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

export function registerExcelTemplateHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('excel-templates:list', (_e, businessType?: string) => {
    try {
      let query = 'SELECT * FROM excel_column_template WHERE is_active = 1'
      const params: unknown[] = []
      if (businessType) { query += ' AND business_type = ?'; params.push(businessType) }
      query += ' ORDER BY id DESC'
      return success(db().allRaw(query, ...params))
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('excel-templates:get', (_e, id: number) => {
    try {
      const row = db().getRaw('SELECT * FROM excel_column_template WHERE id = ?', id)
      return success(row)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('excel-templates:save', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const result = db().runRaw(`INSERT INTO excel_column_template (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })
}
