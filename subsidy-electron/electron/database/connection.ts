import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

// sql.js 类型
type SqlJsStatic = {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase
}
type SqlJsDatabase = {
  run(sql: string, params?: unknown[]): SqlJsDatabase
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>
  prepare(sql: string): SqlJsStatement
  export(): Uint8Array
  close(): void
}
type SqlJsStatement = {
  bind(params?: unknown[]): boolean
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): void
}

// ═══════════════════════════════════════════
//  sql.js wrapper — 提供类 better-sqlite3 的 API
// ═══════════════════════════════════════════

class SqlJsWrapper {
  private db: SqlJsDatabase
  private dbPath: string

  constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db
    this.dbPath = dbPath
  }

  /** 执行 SQL（INSERT/UPDATE/DELETE），自动保存 */
  run(sql: string, params: Record<string, unknown> = {}): { changes: number; lastInsertRowid: number } {
    // 将命名参数转为位置参数
    const { query, positionalParams } = this.convertNamedParams(sql, params)
    this.db.run(query, positionalParams)
    this.save()
    // 获取最后插入的 rowid
    const rows = this.db.exec('SELECT last_insert_rowid() as id')
    const lastId = Number(rows[0]?.values[0]?.[0] || 0)
    return { changes: 1, lastInsertRowid: lastId }
  }

  /** 执行查询，返回第一条记录 */
  get<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}): T | undefined {
    const { query, positionalParams } = this.convertNamedParams(sql, params)
    const stmt = this.db.prepare(query)
    stmt.bind(positionalParams)
    if (stmt.step()) {
      const obj = stmt.getAsObject()
      stmt.free()
      return obj as unknown as T
    }
    stmt.free()
    return undefined
  }

  /** 执行查询，返回所有记录 */
  all<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}): T[] {
    const { query, positionalParams } = this.convertNamedParams(sql, params)
    const stmt = this.db.prepare(query)
    stmt.bind(positionalParams)
    const results: T[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as T)
    }
    stmt.free()
    return results
  }

  /** 执行原始 SQL（不转换参数），返回所有记录 */
  allRaw<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    const stmt = this.db.prepare(sql)
    if (params.length > 0) stmt.bind(params)
    const results: T[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as T)
    }
    stmt.free()
    return results
  }

  /** 执行原始 SQL 并返回第一条 */
  getRaw<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql)
    if (params.length > 0) stmt.bind(params)
    if (stmt.step()) {
      const obj = stmt.getAsObject()
      stmt.free()
      return obj as unknown as T
    }
    stmt.free()
    return undefined
  }

  /** 执行原始 SQL（INSERT/UPDATE/DELETE），自动保存 */
  runRaw(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    this.db.run(sql, params)
    this.save()
    const rows = this.db.exec('SELECT last_insert_rowid() as id')
    const lastId = Number(rows[0]?.values[0]?.[0] || 0)
    return { changes: 1, lastInsertRowid: lastId }
  }

  /** 批量执行 SQL */
  exec(sql: string): void {
    this.db.exec(sql)
    this.save()
  }

  /** 注册自定义 SQL 函数 */
  createFunction(_name: string, _fn: (...args: unknown[]) => unknown): void {
    // sql.js does not support custom functions directly
    // format_group_no will be handled in application code
  }

  /** 保存到磁盘 */
  private save(): void {
    try {
      const data = this.db.export()
      const buffer = Buffer.from(data)
      writeFileSync(this.dbPath, buffer)
    } catch (e) {
      console.error('保存数据库失败:', e)
    }
  }

  /** 关闭数据库 */
  close(): void {
    this.save()
    this.db.close()
  }

  /** 将 @param 命名参数转为 ? 位置参数 */
  private convertNamedParams(sql: string, params: Record<string, unknown>): { query: string; positionalParams: unknown[] } {
    const positionalParams: unknown[] = []
    const query = sql.replace(/@(\w+)/g, (_match, name) => {
      positionalParams.push(params[name] ?? null)
      return '?'
    })
    // Also handle raw ? placeholders mixed with named params — not needed currently
    return { query, positionalParams }
  }
}

// ═══════════════════════════════════════════
//  单例管理
// ═══════════════════════════════════════════

let db: SqlJsWrapper | null = null

export async function initDatabase(dbPath?: string): Promise<void> {
  const resolvedPath = dbPath || join(app.getPath('userData'), 'subsidy.db')

  // 确保目录存在
  const dir = require('path').dirname(resolvedPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // 动态导入 sql.js
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs()

  let sqliteDb: SqlJsDatabase
  if (existsSync(resolvedPath)) {
    const fileBuffer = readFileSync(resolvedPath)
    sqliteDb = new SQL.Database(fileBuffer)
  } else {
    sqliteDb = new SQL.Database()
  }

  // 启用 WAL 模式（sql.js 不支持 WAL，但会保留设置）
  sqliteDb.run('PRAGMA foreign_keys = ON')

  db = new SqlJsWrapper(sqliteDb, resolvedPath)
}

export function getDb(): SqlJsWrapper {
  if (!db) throw new Error('数据库未初始化，请先调用 initDatabase()')
  return db
}

export function getDbPath(): string {
  return join(app.getPath('userData'), 'subsidy.db')
}

export { SqlJsWrapper }
