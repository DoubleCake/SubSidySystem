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

/** 一条关联检查项：name 用于提示文案，sql 只统计条数 */
export interface BlockingRef {
  name: string
  sql: string
}

/** 关联检查明细 */
export interface RefCheckItem {
  name: string
  count: number
}

/**
 * 批量统计关联记录条数（家庭户/农户删除前的引用检查）
 * 结果条数与 BlockingRef 顺序一致，errors 记录查询失败的项（如表不存在）
 */
export function collectRefCounts(refs: BlockingRef[], ...params: unknown[]): { items: RefCheckItem[]; errors: string[] } {
  const items: RefCheckItem[] = []
  const errors: string[] = []
  for (const ref of refs) {
    try {
      const row = getDb().getRaw<{ cnt: number }>(ref.sql, ...params)
      items.push({ name: ref.name, count: Number(row?.cnt || 0) })
    } catch (e) {
      errors.push(`${ref.name}查询失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { items, errors }
}

/**
 * 把关联检查明细拼成提示文案：`成员 3 条、补贴申请 12 条`
 */
export function formatRefCounts(items: RefCheckItem[]): string {
  return items.filter(i => i.count > 0).map(i => `${i.name} ${i.count} 条`).join('、')
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
