import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

export function registerExternalLinksHandlers(): void {
  // 表结构由 migrate.ts + alterStatements 统一管理

  // ═══════════════════ 外部网站 CRUD ═══════════════════

  ipcMain.handle('external-links:list', () => {
    try {
      const rows = getDb().allRaw<Record<string, unknown>>(
        'SELECT * FROM external_site WHERE is_active = 1 ORDER BY sort_order'
      )
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('external-links:createSite', (_e, data: Record<string, unknown>) => {
    try {
      const cols = Object.keys(data).join(', ')
      const vals = Object.keys(data).map(() => '?').join(', ')
      const result = getDb().runRaw(
        `INSERT INTO external_site (${cols}) VALUES (${vals})`,
        ...Object.values(data)
      )
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('external-links:updateSite', (_e, payload: Record<string, unknown>) => {
    try {
      const { id, ...data } = payload
      const sets = Object.keys(data).map(k => `${k} = ?`).join(', ')
      getDb().runRaw(
        `UPDATE external_site SET ${sets} WHERE id = ?`,
        ...Object.values(data), id
      )
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('external-links:deleteSite', (_e, id: number) => {
    try {
      getDb().runRaw('DELETE FROM external_site WHERE id = ?', id)
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════════════════ 查询记录 CRUD ═══════════════════

  ipcMain.handle('external-links:listRecords', (_e, params: Record<string, unknown> = {}) => {
    try {
      const page = Number(params.page) || 1
      const pageSize = Number(params.page_size) || 20
      const offset = (page - 1) * pageSize
      const search = params.search ? String(params.search) : ''

      let where = "WHERE 1=1"
      const values: unknown[] = []

      if (search) {
        where += " AND (query_input LIKE ? OR result_note LIKE ? OR site_name LIKE ? OR query_type LIKE ? OR purpose LIKE ?)"
        const s = `%${search}%`
        values.push(s, s, s, s, s)
      }

      const countRow = getDb().getRaw<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM query_record ${where}`, ...values
      )

      const rows = getDb().allRaw<Record<string, unknown>>(
        `SELECT * FROM query_record ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        ...values, pageSize, offset
      )

      // 反序列化 query_input (JSON → 数组)
      const items = rows.map(r => {
        let queryInputs: string[] = []
        try {
          queryInputs = JSON.parse(r.query_input as string)
        } catch { queryInputs = [(r.query_input as string) || ''] }

        return {
          ...r,
          query_inputs: queryInputs,
          query_count: r.query_count || queryInputs.length,
        }
      })

      return success({ items, total: countRow?.cnt ?? 0 })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('external-links:createRecord', (_e, data: Record<string, unknown>) => {
    try {
      // 序列化 query_inputs (数组 → JSON 字符串)
      const d = { ...data }
      if (Array.isArray(d.query_inputs)) {
        d.query_input = JSON.stringify(d.query_inputs)
        d.query_count = d.query_inputs.length
      } else if (d.query_input) {
        d.query_input = String(d.query_input)
        d.query_count = 1
      }
      delete d.query_inputs

      const cols = Object.keys(d).join(', ')
      const vals = Object.keys(d).map(() => '?').join(', ')
      const result = getDb().runRaw(
        `INSERT INTO query_record (${cols}) VALUES (${vals})`,
        ...Object.values(d)
      )
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('external-links:updateRecord', (_e, payload: Record<string, unknown>) => {
    try {
      const { id, ...data } = payload
      const d: Record<string, unknown> = { ...data }
      // 处理 tags 和 result_note 等直接字段
      const sets = Object.keys(d).map(k => `${k} = ?`).join(', ')
      getDb().runRaw(
        `UPDATE query_record SET ${sets} WHERE id = ?`,
        ...Object.values(d), id
      )
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('external-links:deleteRecord', (_e, id: number) => {
    try {
      getDb().runRaw('DELETE FROM query_record WHERE id = ?', id)
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ═══════════════════ 查询统计 ═══════════════════

  ipcMain.handle('external-links:stats', () => {
    try {
      const totalRow = getDb().getRaw<{ total_records: number; total_items: number }>(
        "SELECT COUNT(*) as total_records, COALESCE(SUM(query_count),0) as total_items FROM query_record"
      )
      const byType = getDb().allRaw<{ type: string; times: number; total_items: number }>(
        "SELECT query_type as type, COUNT(*) as times, COALESCE(SUM(query_count),0) as total_items FROM query_record GROUP BY query_type ORDER BY times DESC"
      )
      const bySite = getDb().allRaw<{ site: string; times: number }>(
        "SELECT site_name as site, COUNT(*) as times FROM query_record GROUP BY site_name ORDER BY times DESC"
      )
      return success({
        total_records: totalRow?.total_records ?? 0,
        total_items: totalRow?.total_items ?? 0,
        by_type: byType,
        by_site: bySite,
      })
    } catch (e) { return errorResponse(String(e)) }
  })
}