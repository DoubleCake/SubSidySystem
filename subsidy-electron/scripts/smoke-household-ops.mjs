/**
 * 开发用冒烟测试：在内存库上验证「合并家庭户 → 分户」的完整 SQL 序列，
 * 包括外键搬迁、面积累加/拆分、户主关系、事件迁移。
 *
 * 用法：node scripts/smoke-household-ops.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'

const cwd = process.cwd()
const src = readFileSync(join(cwd, 'electron/database/migrate.ts'), 'utf8')
const ddl = [...src.matchAll(/db\.exec\(`([\s\S]*?)`\)/g)].map(m => m[1]).find(b => b.includes('CREATE TABLE IF NOT EXISTS village'))
const SQL = await initSqlJs({ locateFile: f => join(cwd, 'node_modules/sql.js/dist', f) })
const db = new SQL.Database()
db.exec(ddl)
for (const m of src.matchAll(/"(ALTER TABLE [^"]+)"/g)) {
  try { db.exec(m[1]) } catch { /* 已存在 */ }
}
db.run('PRAGMA foreign_keys = ON')

const assert = (cond, msg) => { if (!cond) throw new Error('断言失败：' + msg) }
const get = sql => db.exec(sql)[0]?.values[0]

// ── 基础数据 ──
db.run("INSERT INTO village (id, village_name) VALUES (1,'测试村')")
db.run(`INSERT INTO family_household (id, household_code, household_name, village_id, group_no, contract_area, confirmed_area, status, head_farmer_id)
        VALUES (1,'HH0001','甲户',1,1,4,3,1,1)`)
db.run(`INSERT INTO family_household (id, household_code, household_name, village_id, group_no, contract_area, confirmed_area, status, head_farmer_id)
        VALUES (2,'HH0002','乙户',1,1,6,2,1,3)`)
const farmers = [
  [1, 1, '张三', '户主'], [2, 1, '李四', '妻子'],
  [3, 2, '王五', '户主'], [4, 2, '赵六', '儿子'],
]
for (const [id, hh, name, rel] of farmers) {
  db.run(`INSERT INTO farmer_profile (id, household_id, real_name, gender, id_card, relation, farmer_status)
          VALUES (?,?,?,?,?,?,1)`, [id, hh, name, id % 2 ? 1 : 2, `51012319900101${String(1000 + id).slice(-4)}`, rel])
}
db.run(`INSERT INTO family_household (id, household_code, household_name, village_id, group_no, status)
        VALUES (3,'HH0003','丙户',1,1,1)`)
db.run("INSERT INTO land_trust (id, owner_household_id, operator_household_id, trust_year, area) VALUES (1,1,3,2026,2)")
db.run("INSERT INTO land_trust (id, owner_household_id, operator_household_id, trust_year, area) VALUES (2,3,1,2026,1)")
db.run("INSERT INTO large_farmer (id, operator_name, village_id, status) VALUES (1,'大户A',1,1)")
db.run("INSERT INTO large_farmer_trust (id, large_farmer_id, owner_household_id, trust_year, area) VALUES (1,1,1,2026,1.5)")
db.run("INSERT INTO household_event (household_id, event_type, event_year, description) VALUES (1,'FOUND',2020,'建档')")
db.run("INSERT INTO subsidy_type (id, subsidy_name, subsidy_year, season, calc_mode) VALUES (1,'水稻补贴',2026,'大春','per_mu')")
db.run(`INSERT INTO subsidy_application (farmer_id, beneficiary_id, subsidy_type_id, apply_year, apply_area)
        VALUES (1,1,1,2026,1.5)`)

// ══════════ 合并：源户 1 → 目标户 2（与 households:merge 相同顺序）══════════
db.run('BEGIN')
db.run("UPDATE farmer_profile SET household_id = 2, updated_at = datetime('now','localtime') WHERE household_id = 1")
db.run("UPDATE farmer_profile SET relation = '成员' WHERE id = 1 AND relation = '户主'")
db.run('UPDATE land_trust SET owner_household_id = 2 WHERE owner_household_id = 1')
db.run('UPDATE land_trust SET operator_household_id = 2 WHERE operator_household_id = 1')
db.run('UPDATE large_farmer_trust SET owner_household_id = 2 WHERE owner_household_id = 1')
db.run('DELETE FROM household_area_usage_cache WHERE household_id = 1')
db.run('UPDATE household_event SET household_id = 2 WHERE household_id = 1')
db.run('UPDATE family_household SET contract_area = 10, confirmed_area = 5 WHERE id = 2')
db.run('DELETE FROM family_household WHERE id = 1')
db.run(`INSERT INTO household_event (household_id, related_hh_id, event_type, event_year, event_date, date_accuracy, before_snapshot, after_snapshot, description)
        VALUES (2,1,'MERGE',2026,'2026-11-07','EXACT','{}','{}','合并')`)
db.run('COMMIT')

assert(get('SELECT COUNT(*) FROM family_household WHERE id = 1')?.[0] === 0, '源户应已删除')
assert(get('SELECT COUNT(*) FROM farmer_profile WHERE household_id = 2')?.[0] === 4, '4 名成员应在目标户')
assert(get('SELECT owner_household_id FROM land_trust WHERE id = 1')?.[0] === 2, '流转流出方应改挂目标户')
assert(get('SELECT operator_household_id FROM land_trust WHERE id = 1')?.[0] === 3, '无关的流入方不应变化')
assert(get('SELECT owner_household_id FROM land_trust WHERE id = 2')?.[0] === 3, '无关的流出方不应变化')
assert(get('SELECT operator_household_id FROM land_trust WHERE id = 2')?.[0] === 2, '流转流入方应改挂目标户')
assert(get('SELECT owner_household_id FROM large_farmer_trust WHERE id = 1')?.[0] === 2, '大户流转应改挂目标户')
assert(get('SELECT COUNT(*) FROM household_event WHERE household_id = 2')?.[0] === 2, '历史事件应迁到目标户')
const area = get('SELECT contract_area, confirmed_area, head_farmer_id FROM family_household WHERE id = 2')
assert(Number(area[0]) === 10 && Number(area[1]) === 5, `面积应累加为 10/5，实际 ${area[0]}/${area[1]}`)
assert(Number(area[2]) === 3, '目标户原户主应保留')
assert(get("SELECT relation FROM farmer_profile WHERE id = 1")?.[0] === '成员', '源户户主应降为成员')

// ══════════ 分户：从户 2 分出成员 1，新户 3（面积 3 / 原户 7）══════════
const sourceContract = 10, sourceConfirmed = 5, newArea = 3, originArea = 7
const newConfirmed = Math.round(sourceConfirmed * (newArea / sourceContract) * 100) / 100
const originConfirmed = Math.round((sourceConfirmed - newConfirmed) * 100) / 100

db.run('BEGIN')
db.run(`INSERT INTO family_household (household_code, household_name, village_id, group_no, address, registered_address,
          contract_area, confirmed_area, status, head_farmer_id, remark)
        VALUES ('HH_SPLIT', '丙户', 1, 1, '', '', ?, ?, 1, 1, '分户')`, [newArea, newConfirmed])
const newId = get('SELECT last_insert_rowid()')?.[0]
db.run(`INSERT INTO farmer_profile (id, household_id, real_name, gender, id_card, relation, farmer_status)
        VALUES (5, ?, '孙七', 1, '510123199001015555', '本人', 1)`, [newId])
db.run("UPDATE farmer_profile SET household_id = ?, relation = '本人' WHERE id = 1", [newId])
db.run('UPDATE family_household SET contract_area = ?, confirmed_area = ? WHERE id = 2', [originArea, originConfirmed])
db.run(`INSERT INTO household_event (household_id, related_hh_id, event_type, event_year, date_accuracy, description)
        VALUES (2, ?, 'SPLIT', 2026, 'YEAR', '分户')`, [newId])
db.run('COMMIT')

assert(get('SELECT household_id FROM farmer_profile WHERE id = 1')?.[0] === newId, '成员应迁入新户')
assert(get('SELECT COUNT(*) FROM farmer_profile WHERE household_id = 2')?.[0] === 3, '原户应剩 3 人')
const srcArea = get('SELECT contract_area, confirmed_area FROM family_household WHERE id = 2')
assert(Number(srcArea[0]) === 7 && Number(srcArea[1]) === 3.5, `原户面积应为 7/3.5，实际 ${srcArea[0]}/${srcArea[1]}`)
const newAreaRow = db.exec(`SELECT contract_area, confirmed_area FROM family_household WHERE id = ${newId}`)[0].values[0]
assert(Number(newAreaRow[0]) === 3 && Number(newAreaRow[1]) === 1.5, `新户面积应为 3/1.5，实际 ${newAreaRow[0]}/${newAreaRow[1]}`)

console.log('冒烟测试通过：合并（外键迁移/面积累加/户主降级/事件迁移）与分户（面积拆分/确权按比例）均正常')
