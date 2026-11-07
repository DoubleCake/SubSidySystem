import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { maskIdCard } from '../utils/masking'
import { runAnomalyScan } from '../utils/anomaly-detectors'
import { parsePagination, successList, success, errorResponse } from './response'

/**
 * 异常中心
 *  - 异常类型：超领 / 重复领取 / 多人领取 / 死亡后领取
 *  - 手动扫描生成记录；同一对象重复扫描不会重复生成（dedup_key 唯一）
 *  - 只做「待核实 / 已核对 / 已忽略」三种状态，记录核实人与时间
 */
export function registerAnomalyHandlers(): void {
  // ── 手动扫描 ──
  ipcMain.handle('anomalies:scan', (_e, payload: any) => {
    try {
      const year = Number(payload?.year) || new Date().getFullYear()
      const batchKey = `SCAN-${year}-${Date.now()}`
      const db = getDb()

      db.beginTransaction()
      let result
      try {
        result = runAnomalyScan(db, year, batchKey)
        db.commitTransaction()
      } catch (e) {
        db.rollbackTransaction()
        throw e
      }

      return success({
        year,
        batch_key: batchKey,
        inserted: result.inserted,
        total: result.total,
        errors: result.errors,
        message: `扫描完成：新增 ${result.total} 条异常`,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 列表 ──
  ipcMain.handle('anomalies:list', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const year = params.year ? Number(params.year) : null
      const typeCode = (params.type_code as string) || ''
      const status = (params.status as string) || ''
      const search = (params.search as string || '').trim()

      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (year) { where += ' AND ar.year = ?'; vals.push(year) }
      if (typeCode) { where += ' AND ar.type_code = ?'; vals.push(typeCode) }
      if (status) { where += ' AND ar.status = ?'; vals.push(status) }
      if (search) {
        where += ` AND (ar.title LIKE ? OR ar.detail LIKE ? OR hh.household_name LIKE ?
                  OR hh.household_code LIKE ? OR fp.real_name LIKE ?)`
        vals.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
      }

      const joins = ` FROM anomaly_record ar
        LEFT JOIN anomaly_type at ON at.code = ar.type_code
        LEFT JOIN family_household hh ON hh.id = ar.household_id
        LEFT JOIN farmer_profile fp ON fp.id = ar.farmer_id`

      const countRow = getDb().getRaw<{ cnt: number }>(`SELECT COUNT(*) as cnt ${joins} ${where}`, ...vals)
      const rows = getDb().allRaw<Record<string, any>>(`
        SELECT ar.*, at.name AS type_name, at.category,
               hh.household_code, hh.household_name,
               fp.real_name, fp.id_card
        ${joins} ${where}
        ORDER BY CASE ar.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, ar.id DESC
        LIMIT ? OFFSET ?`, ...vals, pageSize, offset)

      const items = rows.map(r => ({
        ...r,
        id_card: r.id_card ? maskIdCard(String(r.id_card)) : null,
      }))
      return successList(items, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 统计 ──
  ipcMain.handle('anomalies:stats', (_e, payload: any) => {
    try {
      const year = payload?.year ? Number(payload.year) : null
      const where = year ? 'WHERE year = ?' : ''
      const vals = year ? [year] : []

      const byStatus = getDb().allRaw<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*) as cnt FROM anomaly_record ${where} GROUP BY status`, ...vals)
      const byType = getDb().allRaw<{ type_code: string; type_name: string; cnt: number; open_cnt: number }>(`
        SELECT ar.type_code, at.name AS type_name, COUNT(*) as cnt,
               SUM(CASE WHEN ar.status = 'open' THEN 1 ELSE 0 END) as open_cnt
        FROM anomaly_record ar
        LEFT JOIN anomaly_type at ON at.code = ar.type_code
        ${year ? 'WHERE ar.year = ?' : ''}
        GROUP BY ar.type_code ORDER BY at.sort_order`, ...vals)

      const statusMap: Record<string, number> = { open: 0, confirmed: 0, ignored: 0 }
      for (const r of byStatus) statusMap[r.status] = Number(r.cnt)
      return success({
        total: byStatus.reduce((s, r) => s + Number(r.cnt), 0),
        status: statusMap,
        by_type: byType,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 核对 / 忽略 / 恢复 ──
  ipcMain.handle('anomalies:verify', (_e, payload: any) => {
    try {
      const id = Number(payload?.id)
      const status = String(payload?.status || '')
      const note = String(payload?.note || '').trim()
      const operator = String(payload?.operator || '').trim() || '操作员'
      if (!id) return errorResponse('缺少异常记录ID')
      if (!['open', 'confirmed', 'ignored'].includes(status)) return errorResponse('无效的状态')

      if (status === 'open') {
        getDb().runRaw(
          "UPDATE anomaly_record SET status = 'open', verified_by = NULL, verified_at = NULL, verified_note = NULL, updated_at = datetime('now','localtime') WHERE id = ?",
          id
        )
      } else {
        getDb().runRaw(
          "UPDATE anomaly_record SET status = ?, verified_by = ?, verified_at = datetime('now','localtime'), verified_note = ?, updated_at = datetime('now','localtime') WHERE id = ?",
          status, operator, note || null, id
        )
      }
      return success({ message: status === 'open' ? '已恢复为待核实' : status === 'confirmed' ? '已标记为已核对' : '已忽略' })
    } catch (e) { return errorResponse(String(e)) }
  })
}
