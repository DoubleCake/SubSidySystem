/**
 * 异常扫描预演（只读）：把真实数据库读入内存，在内存里补建异常表并跑一遍检测规则，
 * 用于评估会生成多少异常，不会写回数据库。
 *
 * 运行：node node_modules/tsx/dist/cli.mjs scripts/preview-anomaly-scan.ts [年份]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { runAnomalyScan } from '../electron/utils/anomaly-detectors'

async function main() {
  const dbPath = join(process.env.APPDATA || '', 'subsidy-electron', 'subsidy.db')
  const year = Number(process.argv[2]) || new Date().getFullYear()
  const cwd = process.cwd()

  const src = readFileSync(join(cwd, 'electron/database/migrate.ts'), 'utf8')
  const ddl = [...src.matchAll(/db\.exec\(`([\s\S]*?)`\)/g)].map(m => m[1]).find(b => b.includes('CREATE TABLE IF NOT EXISTS village'))
  if (!ddl) throw new Error('未找到建表 DDL')

  const SQL = await initSqlJs({ locateFile: f => join(cwd, 'node_modules/sql.js/dist', f) })
  const db = new SQL.Database(readFileSync(dbPath))
  db.exec(ddl)
  for (const m of src.matchAll(/"(ALTER TABLE [^"]+)"/g)) {
    try { db.exec(m[1]) } catch { /* 已存在 */ }
  }

  const wrapper = {
    allRaw<T = Record<string, any>>(sql: string, ...params: unknown[]): T[] {
      const stmt = db.prepare(sql)
      if (params.length) stmt.bind(params)
      const out: T[] = []
      while (stmt.step()) out.push(stmt.getAsObject() as T)
      stmt.free()
      return out
    },
    runRaw(sql: string, ...params: unknown[]) {
      if (params.length) db.run(sql, params)
      else db.run(sql)
      return { changes: db.getRowsModified() }
    },
  }

  const res = runAnomalyScan(wrapper, year, `PREVIEW-${year}`)
  console.log(`数据库：${dbPath}`)
  console.log(`${year} 年预演扫描结果：`)
  for (const [k, v] of Object.entries(res.inserted)) console.log(`  ${k}: ${v} 条`)
  console.log(`  合计: ${res.total} 条`)
  if (res.errors.length) console.log('规则错误：' + res.errors.join('; '))

  const samples = wrapper.allRaw<any>(
    'SELECT type_code, title, diff_value FROM anomaly_record ORDER BY id LIMIT 8'
  )
  if (samples.length) {
    console.log('\n样例：')
    for (const s of samples) console.log(`  - [${s.type_code}] ${s.title}（差额 ${s.diff_value}）`)
  }
  console.log('\n本次仅内存预演，未修改数据库。')
}

main().catch(e => { console.error(e); process.exit(1) })
