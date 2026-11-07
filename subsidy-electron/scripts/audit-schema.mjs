/**
 * 开发用：从 migrate.ts 还原一份"全新安装"的库结构，
 * 再扫描 electron/ 下的 INSERT / UPDATE 语句，报告引用了不存在表/列的 SQL。
 *
 * 用法：node scripts/audit-schema.mjs
 * 退出码：0 无问题；1 发现问题
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'

const cwd = process.cwd()
const migrateSrc = readFileSync(join(cwd, 'electron/database/migrate.ts'), 'utf8')

// 取出建表 DDL（包含 village 的那段模板字符串）
const execBlocks = [...migrateSrc.matchAll(/db\.exec\(`([\s\S]*?)`\)/g)].map(m => m[1])
const ddl = execBlocks.find(b => b.includes('CREATE TABLE IF NOT EXISTS village'))
if (!ddl) throw new Error('未能在 migrate.ts 中找到建表 DDL')

const SQL = await initSqlJs({
  locateFile: f => join(cwd, 'node_modules/sql.js/dist', f),
})
const db = new SQL.Database()
db.exec(ddl)

// 执行 ALTER TABLE 增量列（失败即列已存在）
for (const m of migrateSrc.matchAll(/"(ALTER TABLE [^"]+)"/g)) {
  try { db.exec(m[1]) } catch { /* 已存在 */ }
}

/** 读取所有表及列 */
const tables = new Map()
const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
for (const [name] of rows[0]?.values || []) {
  const cols = new Set()
  const info = db.exec(`PRAGMA table_info(${JSON.stringify(name)})`)
  for (const r of info[0]?.values || []) cols.add(String(r[1]))
  tables.set(String(name), cols)
}

/** 递归收集 ts 文件 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

const files = walk(join(cwd, 'electron'))
const problems = []

const IGNORE = new Set(['datetime', 'now', 'localtime', 'null', 'select', 'set'])

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const rel = file.slice(cwd.length + 1).replaceAll('\\', '/')

  // INSERT INTO table (a, b, c)
  for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)/gi)) {
    const table = m[1]
    if (table.endsWith('_new')) continue // 迁移中的临时表
    const cols = tables.get(table)
    if (!cols) { problems.push(`${rel}: 未知表 ${table}`); continue }
    const names = m[2].split(',').map(s => s.trim().replace(/["'`]/g, '')).filter(Boolean)
    for (const c of names) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(c)) continue // 跳过表达式/占位
      if (!cols.has(c)) {
        const line = src.slice(0, m.index).split('\n').length
        problems.push(`${rel}:${line}: INSERT ${table} 引用了不存在的列 ${c}`)
      }
    }
  }

  // UPDATE table SET a=?, b=?
  for (const m of src.matchAll(/UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)\s+WHERE/gi)) {
    const table = m[1]
    const cols = tables.get(table)
    if (!cols) { problems.push(`${rel}: 未知表 ${table}`); continue }
    const sets = m[2]
    // 模板字符串拼接的 SET 无法静态判断，跳过含 ${ 的情况
    if (sets.includes('${')) continue
    for (const part of sets.split(',')) {
      const name = part.split('=')[0].trim().replace(/["'`]/g, '')
      if (!/^[a-z_][a-z0-9_]*$/i.test(name)) continue
      if (IGNORE.has(name.toLowerCase())) continue
      if (!cols.has(name)) {
        const line = lines.slice(0, src.slice(0, m.index).split('\n').length).length
        problems.push(`${rel}:${line}: UPDATE ${table} 引用了不存在的列 ${name}`)
      }
    }
  }
}

// 常见表别名 → 表名，检查 SELECT 中 alias.column 是否存在
const ALIAS_TO_TABLE = {
  sa: 'subsidy_application',
  fp: 'farmer_profile',
  hh: 'family_household',
  st: 'subsidy_type',
  v: 'village',
  lf: 'large_farmer',
  lt: 'land_trust',
}
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = file.slice(cwd.length + 1).replaceAll('\\', '/')
  // 只扫描包含 SQL 关键字的模板字符串，避免把 JS 属性访问误判为 SQL
  for (const lit of src.matchAll(/`([\s\S]*?)`/g)) {
    const sql = lit[1]
    if (!/\b(SELECT|INSERT|UPDATE|DELETE|FROM|JOIN)\b/i.test(sql)) continue
    const base = lit.index + 1
    for (const m of sql.matchAll(/\b(sa|fp|hh|st|v|lf|lt)\.([a-z_][a-z0-9_]*)/g)) {
      const table = ALIAS_TO_TABLE[m[1]]
      const col = m[2]
      if (!tables.get(table)?.has(col)) {
        const line = src.slice(0, base + m.index).split('\n').length
        problems.push(`${rel}:${line}: ${m[1]}.${col} → ${table} 不存在该列`)
      }
    }
  }
}

if (problems.length) {  console.log(`发现 ${problems.length} 处结构不匹配：`)
  for (const p of [...new Set(problems)]) console.log('  - ' + p)
  process.exit(1)
} else {
  console.log('未发现表/列不匹配')
}
