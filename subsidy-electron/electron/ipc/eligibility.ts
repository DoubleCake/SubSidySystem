import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

export function registerEligibilityHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('eligibility:list', (_e, subsidyTypeId?: number) => {
    try {
      let query = 'SELECT * FROM subsidy_eligibility_rule WHERE is_active = 1'
      const params: unknown[] = []
      if (subsidyTypeId) { query += ' AND subsidy_type_id = ?'; params.push(subsidyTypeId) }
      const rows = db().allRaw(query, ...params)
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('eligibility:create', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const result = db().runRaw(`INSERT INTO subsidy_eligibility_rule (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })
}
