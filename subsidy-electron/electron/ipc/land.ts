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

  ipcMain.handle('land:update', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => data[k])
      db().runRaw(`UPDATE land_trust SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 大户管理 ──
  function ensureLargeFarmerTables() {
    try { db().runRaw('CREATE TABLE IF NOT EXISTS large_farmer (id INTEGER PRIMARY KEY AUTOINCREMENT, farmer_name TEXT, household_id INTEGER, household_name TEXT, village_name TEXT, land_area REAL, remark TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))') } catch {}
    try { db().runRaw('CREATE TABLE IF NOT EXISTS large_farmer_trust (id INTEGER PRIMARY KEY AUTOINCREMENT, large_farmer_id INTEGER, trust_type TEXT, land_area REAL, trust_year INTEGER, start_date TEXT, end_date TEXT, remark TEXT, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))') } catch {}
  }
  ensureLargeFarmerTables()

  ipcMain.handle('land:listLargeFarmers', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const countRow = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM large_farmer')
      const rows = db().allRaw('SELECT * FROM large_farmer ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, offset)
      return successList(rows, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:createLargeFarmer', (_e, payload: any) => {
    try {
      const cols = Object.keys(payload).filter(k => payload[k] !== undefined).join(',')
      const ph = Object.keys(payload).filter(k => payload[k] !== undefined).map(() => '?').join(',')
      const vals = Object.keys(payload).filter(k => payload[k] !== undefined).map(k => payload[k])
      const r = db().runRaw(`INSERT INTO large_farmer (${cols}) VALUES (${ph})`, ...vals)
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:updateLargeFarmer', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k}=?`).join(',')
      const vals = keys.map(k => data[k])
      db().runRaw(`UPDATE large_farmer SET ${sets} WHERE id=?`, ...vals, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:deleteLargeFarmer', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM large_farmer_trust WHERE large_farmer_id=?', id)
      db().runRaw('DELETE FROM large_farmer WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:listLargeFarmerTrusts', (_e, payload: any) => {
    try {
      const { id, year } = payload || {}
      let sql = 'SELECT * FROM large_farmer_trust WHERE large_farmer_id=?'
      const params: any[] = [id]
      if (year) { sql += ' AND trust_year=?'; params.push(year) }
      sql += ' ORDER BY trust_year DESC'
      const rows = db().allRaw<Record<string, unknown>>(sql, ...params)
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:createLargeFarmerTrust', (_e, payload: any) => {
    try {
      const { large_farmer_id, trust_type, land_area, trust_year, start_date, end_date, remark } = payload
      const r = db().runRaw(
        'INSERT INTO large_farmer_trust (large_farmer_id, trust_type, land_area, trust_year, start_date, end_date, remark) VALUES (?,?,?,?,?,?,?)',
        large_farmer_id, trust_type, land_area, trust_year, start_date || null, end_date || null, remark || ''
      )
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:updateLargeFarmerTrust', (_e, payload: any) => {
    try {
      const { id, large_farmer_id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined)
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k}=?`).join(',')
      const vals = keys.map(k => data[k])
      db().runRaw(`UPDATE large_farmer_trust SET ${sets} WHERE id=?`, ...vals, id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:deleteLargeFarmerTrust', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM large_farmer_trust WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('land:searchHousehold', (_e, payload: any) => {
    try {
      const q = payload.q || ''
      const rows = db().allRaw<Record<string, unknown>>(
        `SELECT hh.id as household_id, hh.household_code, hh.household_name,
                (SELECT real_name FROM farmer_profile WHERE id=hh.head_farmer_id) as head_name,
                COALESCE(v.village_name,'') as village_name
         FROM family_household hh LEFT JOIN village v ON hh.village_id=v.id
         WHERE hh.household_name LIKE ? OR hh.household_code LIKE ?
         LIMIT 20`,
        `%${q}%`, `%${q}%`
      )
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })
}
