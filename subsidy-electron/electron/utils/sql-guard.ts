/**
 * SQL 列名安全校验 — 防动态注入
 * 所有动态构建列名的 UPDATE/INSERT 必须经过此校验
 */
import { getDb } from '../database/connection'

/**
 * 安全更新：只允许白名单中的列名
 * @returns affected rows
 */
export function safeUpdate(
  table: string,
  id: number,
  data: Record<string, unknown>,
  allowedColumns: string[]
): number {
  const entries = Object.entries(data)
    .filter(([k, v]) => allowedColumns.includes(k) && v !== undefined)

  if (entries.length === 0) return 0

  const sets = entries.map(([k]) => `${k}=?`).join(', ')
  const vals = entries.map(([, v]) => v)
  vals.push(id)

  const result = getDb().runRaw(
    `UPDATE ${table} SET ${sets}, updated_at=datetime('now','localtime') WHERE id=?`,
    ...vals
  )
  return result.changes
}

/**
 * 安全插入：只允许白名单中的列名
 * @returns lastInsertRowid
 */
export function safeInsert(
  table: string,
  data: Record<string, unknown>,
  allowedColumns: string[]
): number {
  const entries = Object.entries(data)
    .filter(([k, v]) => allowedColumns.includes(k) && v !== undefined)

  if (entries.length === 0) return 0

  const cols = entries.map(([k]) => k).join(', ')
  const placeholders = entries.map(() => '?').join(', ')
  const vals = entries.map(([, v]) => v)

  const result = getDb().runRaw(
    `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`,
    ...vals
  )
  return result.lastInsertRowid
}
