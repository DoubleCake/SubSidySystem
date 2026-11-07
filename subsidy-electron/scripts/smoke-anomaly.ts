/**
 * 异常检测规则冒烟测试（开发用）
 * 运行：node node_modules/tsx/dist/cli.mjs scripts/smoke-anomaly.ts
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { runAnomalyScan } from '../electron/utils/anomaly-detectors'

async function main() {
const cwd = process.cwd()
const src = readFileSync(join(cwd, 'electron/database/migrate.ts'), 'utf8')
const ddl = [...src.matchAll(/db\.exec\(`([\s\S]*?)`\)/g)].map(m => m[1]).find(b => b.includes('CREATE TABLE IF NOT EXISTS village'))
if (!ddl) throw new Error('未找到建表 DDL')

const SQL = await initSqlJs({ locateFile: f => join(cwd, 'node_modules/sql.js/dist', f) })
const db = new SQL.Database()
db.exec(ddl)
for (const m of src.matchAll(/"(ALTER TABLE [^"]+)"/g)) {
  try { db.exec(m[1]) } catch { /* 已存在 */ }
}
db.run('PRAGMA foreign_keys = ON')

// ── 基础数据 ──
db.run("INSERT INTO village (id, village_name) VALUES (1,'测试村')")
db.run(`INSERT INTO family_household (id, household_code, household_name, village_id, group_no, contract_area, confirmed_area, status, head_farmer_id)
        VALUES (1,'HH0001','甲户',1,1,10,NULL,1,1)`)
db.run(`INSERT INTO family_household (id, household_code, household_name, village_id, group_no, contract_area, confirmed_area, status, head_farmer_id)
        VALUES (2,'HH0002','乙户',1,1,5,NULL,1,3)`)

const farmers: Array<[number, number, string, number, string | null]> = [
  [1, 1, '张三', 1, null],
  [2, 1, '李四', 1, null],
  [3, 2, '王五', 4, '2026-01-01'],
]
for (const [id, hh, name, status, death] of farmers) {
  db.run(`INSERT INTO farmer_profile (id, household_id, real_name, gender, id_card, relation, farmer_status, death_date)
          VALUES (?,?,?,?,?,?,?,?)`,
    [id, hh, name, id % 2 ? 1 : 2, `51012319900101${String(1000 + id).slice(-4)}`, id === 1 ? '户主' : '成员', status, death])
}

db.run(`INSERT INTO subsidy_type (id, subsidy_name, subsidy_year, season, calc_mode, standard_unit)
        VALUES (1,'水稻补贴',2026,'大春','per_mu','元/亩')`)
db.run(`INSERT INTO subsidy_type (id, subsidy_name, subsidy_year, season, calc_mode, standard_unit)
        VALUES (2,'耕地地力保护',2026,'全年单补','fixed','元/户')`)
db.run(`INSERT INTO subsidy_type (id, subsidy_name, subsidy_year, season, calc_mode, standard_unit)
        VALUES (3,'水稻补贴',2026,'大春','per_mu','元/亩')`)

// 超领：甲户大春 7 + 5 = 12 亩 > 承包 10 亩
db.run(`INSERT INTO subsidy_application (id, farmer_id, beneficiary_id, subsidy_type_id, apply_year, apply_area)
        VALUES (1,1,1,1,2026,7)`)
db.run(`INSERT INTO subsidy_application (id, farmer_id, beneficiary_id, subsidy_type_id, apply_year, apply_area)
        VALUES (2,2,2,1,2026,5)`)

// 重复领取：同一人同一年度同一补贴名称两条发放（不同类型ID）
db.run(`INSERT INTO subsidy_payment (id, farmer_id, beneficiary_id, subsidy_type_id, payment_year, amount, pay_status)
        VALUES (1,1,1,1,2026,700,2)`)
db.run(`INSERT INTO subsidy_payment (id, farmer_id, beneficiary_id, subsidy_type_id, payment_year, amount, pay_status)
        VALUES (2,1,1,3,2026,700,2)`)

// 多人领取：按户补贴被甲户两名成员领取
db.run(`INSERT INTO subsidy_payment (id, farmer_id, beneficiary_id, subsidy_type_id, payment_year, amount, pay_status)
        VALUES (3,1,1,2,2026,100,2)`)
db.run(`INSERT INTO subsidy_payment (id, farmer_id, beneficiary_id, subsidy_type_id, payment_year, amount, pay_status)
        VALUES (4,2,2,2,2026,100,2)`)

// 死亡后领取：王五 2026-01-01 死亡，2026-05-01 发放
db.run(`INSERT INTO subsidy_payment (id, farmer_id, beneficiary_id, subsidy_type_id, payment_year, amount, payment_date, pay_status)
        VALUES (5,3,3,1,2026,500,'2026-05-01',2)`)

// ── 适配器：sql.js → AnomalyDb ──
const anomalyDb = {
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

const first = runAnomalyScan(anomalyDb, 2026, 'TEST-1')
assert.equal(first.errors.length, 0, '扫描不应有错误：' + first.errors.join('; '))
assert.equal(first.inserted.OVER_AREA, 1, '应检出 1 条超领')
assert.equal(first.inserted.DUPLICATE_CLAIM, 1, '应检出 1 条重复领取')
assert.equal(first.inserted.MULTI_CLAIM, 1, '应检出 1 条多人领取')
assert.equal(first.inserted.DEATH_CLAIM, 1, '应检出 1 条死亡后领取')

const second = runAnomalyScan(anomalyDb, 2026, 'TEST-2')
assert.equal(second.total, 0, '重复扫描不应重复生成')

const rows = anomalyDb.allRaw<any>('SELECT type_code, title, detail, status, severity FROM anomaly_record ORDER BY id')
assert.equal(rows.length, 4)
for (const r of rows) {
  assert.equal(r.status, 'open')
  assert.ok(r.title && r.detail)
}

const over = rows.find(r => r.type_code === 'OVER_AREA')
assert.ok(String(over.title).includes('2'), '超领差额应为 2 亩：' + over.title)

console.log('异常检测冒烟测试通过：超领/重复领取/多人领取/死亡后领取 各 1 条，重复扫描不重复生成')
}

main().catch(e => { console.error(e); process.exit(1) })
