/**
 * 结构化日志 — 写入 userData/logs/ 目录
 * 不依赖任何第三方库
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync } from 'fs'

function logDir(): string {
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function logFile(): string {
  const d = new Date()
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return join(logDir(), `${dateStr}.log`)
}

function format(level: string, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString()
  const metaStr = meta ? ' ' + JSON.stringify(meta) : ''
  return `[${ts}] ${level} ${message}${metaStr}\n`
}

const logger = {
  info(msg: string, meta?: Record<string, unknown>) {
    try { appendFileSync(logFile(), format('INFO', msg, meta)) } catch { /* ignore */ }
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    try { appendFileSync(logFile(), format('WARN', msg, meta)) } catch { /* ignore */ }
  },
  error(msg: string, meta?: Record<string, unknown>) {
    try { appendFileSync(logFile(), format('ERROR', msg, meta)) } catch { /* ignore */ }
  },
  /** 审计日志（操作记录） */
  audit(action: string, operator: string, target: string, detail?: Record<string, unknown>) {
    try {
      appendFileSync(logFile(), format('AUDIT', `${operator} ${action} ${target}`, detail))
      // 同时写数据库 audit_log
      try {
        const { getDb } = require('../database/connection')
        const db = getDb()
        if (db) {
          db.runRaw(
            `INSERT INTO audit_log (operator_name, action, table_name, record_id, after_data)
             VALUES (?,?,?,?,?)`,
            operator, action, target, detail?.id ?? null, JSON.stringify(detail || {})
          )
        }
      } catch { /* DB 不可用时跳过 */ }
    } catch { /* ignore */ }
  },
}

export default logger
