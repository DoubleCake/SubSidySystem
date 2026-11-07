import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { maskIdCard } from '../utils/masking'
import {
  buildAttributePreview,
  STATUS_LABEL,
  type AttributePreviewRow,
} from '../utils/attribute-import'
import { success, errorResponse } from './response'

/**
 * 人员基本属性导入
 *
 * 规则：
 *  - 以身份证号匹配系统中已有人员，不自动建档；
 *  - 姓名仅用于核对，与系统不一致的行展示出来并跳过（不覆盖任何数据）；
 *  - 只允许修改「人员状态 / 状态变更日期 / 死亡日期」三个属性，其他字段一律不动；
 *  - 每行写一条 household_event(MEMBER_STATUS)，保留变更前后快照。
 */

function publicItem(r: AttributePreviewRow) {
  return {
    row_index: r.row_index,
    id_card_masked: r.id_card_masked,
    input_name: r.input_name,
    db_name: r.db_name,
    current: {
      farmer_status: r.current_status,
      status_date: r.current_status_date,
      death_date: r.current_death_date,
    },
    next: {
      farmer_status: r.next_status,
      status_date: r.next_status_date,
      death_date: r.next_death_date,
    },
    action: r.action,
    messages: r.messages,
  }
}

export function registerFarmerAttributeHandlers(): void {
  // ── 预览（只读） ──
  ipcMain.handle('farmers:previewAttributeImport', (_e, payload: any) => {
    try {
      const rows = Array.isArray(payload) ? payload : payload?.rows
      if (!Array.isArray(rows) || rows.length === 0) return errorResponse('没有可导入的数据')

      const parsed = buildAttributePreview(rows, getDb())
      const update = parsed.filter(r => r.action === 'update').length
      const skip = parsed.filter(r => r.action === 'skip').length
      const errors = parsed.filter(r => r.action === 'error').length

      return success({
        total: parsed.length,
        summary: { update, skip, error: errors },
        items: parsed.map(publicItem),
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 应用导入 ──
  ipcMain.handle('farmers:applyAttributeImport', (_e, payload: any) => {
    try {
      const rows = payload?.rows
      if (!Array.isArray(rows) || rows.length === 0) return errorResponse('没有可导入的数据')

      const fileName = String(payload?.file_name || '').trim() || '人员属性导入'
      const operator = String(payload?.operator || '').trim() || '系统'
      const started = Date.now()
      const parsed = buildAttributePreview(rows, getDb())
      const targets = parsed.filter(r => r.action === 'update')

      const errors = parsed.filter(r => r.action === 'error')
      const skipped = parsed.filter(r => r.action === 'skip')
      let updated = 0

      if (targets.length > 0) {
        const db = getDb()
        const now = new Date()
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

        db.beginTransaction()
        try {
          for (const r of targets) {
            const before = {
              farmer_status: r.current_status,
              status_date: r.current_status_date,
              death_date: r.current_death_date,
            }
            const after = {
              farmer_status: r.next_status,
              status_date: r.next_status_date,
              death_date: r.next_death_date,
            }

            // 只更新状态相关三列，绝不触碰姓名/手机号/银行卡/关系等字段
            db.runRaw(
              "UPDATE farmer_profile SET farmer_status = ?, status_date = ?, death_date = ?, updated_at = datetime('now','localtime') WHERE id = ?",
              after.farmer_status, after.status_date, after.death_date, r.db_id
            )

            const effectiveDate = after.status_date || after.death_date || todayStr
            const statusChanged = before.farmer_status !== after.farmer_status
            const desc = statusChanged
              ? `人员状态变更：${STATUS_LABEL[before.farmer_status ?? 1] || before.farmer_status} → ${STATUS_LABEL[after.farmer_status ?? 1] || after.farmer_status}${after.death_date ? `（${after.death_date}）` : ''}`
              : `属性更新：状态日期 ${after.status_date || '—'}，死亡日期 ${after.death_date || '—'}`

            db.runRaw(
              `INSERT INTO household_event
                 (household_id, event_type, event_year, event_date, date_accuracy,
                  before_snapshot, after_snapshot, farmer_id, farmer_name, description, operator)
               VALUES (?, 'MEMBER_STATUS', ?, ?, 'EXACT', ?, ?, ?, ?, ?, ?)`,
              r.household_id, Number(effectiveDate.slice(0, 4)), effectiveDate,
              JSON.stringify(before), JSON.stringify(after),
              r.db_id, r.db_name || r.input_name, desc, operator
            )
            updated++
          }
          db.commitTransaction()
        } catch (e) {
          db.rollbackTransaction()
          throw e
        }
      }

      // 批次日志（失败不影响导入结果）
      try {
        getDb().runRaw(
          `INSERT INTO excel_import_log
             (file_name, business_type, total_rows, valid_rows, created_count, updated_count,
              skipped_count, error_count, warning_count, error_detail, operator, import_duration_ms)
           VALUES (?, 'FARMER_ATTRIBUTE', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
          fileName, parsed.length, targets.length, updated, skipped.length, errors.length,
          parsed.filter(r => r.messages.length > 0).length,
          JSON.stringify(errors.map(r => ({
            row: r.row_index, id_card: maskIdCard(r.id_card),
            name: r.input_name, db_name: r.db_name, messages: r.messages,
          }))),
          operator, Date.now() - started
        )
      } catch { /* 日志失败忽略 */ }

      return success({
        total: parsed.length,
        updated,
        skipped: skipped.length,
        error_count: errors.length,
        errors: errors.map(publicItem),
        skipped_items: skipped.map(publicItem),
        message: `导入完成：更新 ${updated} 条，跳过 ${skipped.length} 条，问题 ${errors.length} 条`,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })
}
