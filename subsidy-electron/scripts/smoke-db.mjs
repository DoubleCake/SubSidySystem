/**
 * 开发用冒烟测试：在内存库上还原"全新安装"结构，插入最小数据，
 * 再执行本轮修复涉及的 SQL（预申请转发放、移出成员、家庭户面积聚合）。
 *
 * 用法：node scripts/smoke-db.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'

const cwd = process.cwd()
const migrateSrc = readFileSync(join(cwd, 'electron/database/migrate.ts'), 'utf8')
const blocks = [...migrateSrc.matchAll(/db\.exec\(`([\s\S]*?)`\)/g)].map(m => m[1])
const ddl = blocks.find(b => b.includes('CREATE TABLE IF NOT EXISTS village'))

const SQL = await initSqlJs({ locateFile: f => join(cwd, 'node_modules/sql.js/dist', f) })
const db = new SQL.Database()
db.exec(ddl)
for (const m of migrateSrc.matchAll(/"(ALTER TABLE [^"]+)"/g)) {
  try { db.exec(m[1]) } catch { /* 已存在 */ }
}

const assert = (cond, msg) => { if (!cond) throw new Error('断言失败：' + msg) }

db.run('INSERT INTO village (id, village_name) VALUES (1, ?)', ['测试村'])
db.run(`INSERT INTO family_household
  (id, household_code, household_name, village_id, group_no, contract_area, confirmed_area, status)
  VALUES (1, 'HH0001', '张三户', 1, 1, 5, 5, 1)`)
db.run(`INSERT INTO farmer_profile
  (id, household_id, real_name, gender, id_card, relation, farmer_status, bank_card, bank_name)
  VALUES (1, 1, '张三', 1, '510123199001011234', '户主', 1, '6228000000000001', '农商行')`)
db.run(`INSERT INTO farmer_profile
  (id, household_id, real_name, gender, id_card, relation, farmer_status)
  VALUES (2, 1, '李四', 2, '510123199202022345', '妻子', 1)`)
db.run('UPDATE family_household SET head_farmer_id = 1 WHERE id = 1')
db.run(`INSERT INTO subsidy_type (id, subsidy_name, subsidy_year, season, calc_mode)
  VALUES (1, '水稻补贴', 2026, '大春', 'per_mu')`)
db.run(`INSERT INTO subsidy_application
  (id, farmer_id, beneficiary_id, subsidy_type_id, apply_year,
   apply_area, apply_area_no_calc, contract_area, apply_amount, actual_amount,
   apply_village_id, apply_group_no, apply_village_name, apply_group_display, bank_card_snapshot)
  VALUES (1, 1, 1, 1, 2026, 3.5, 0.5, 5, 500, 480, 1, 1, '测试村', '一组', '6228000000000001')`)

// 1) 家庭户面积聚合（households:list 用到的写法）
const areaRow = db.exec(`
  SELECT COALESCE(SUM(sa.apply_area - COALESCE(sa.apply_area_no_calc, 0)
         - COALESCE(sa.trust_area, 0) - COALESCE(sa.no_subsidy_area, 0)), 0) AS used
  FROM subsidy_application sa
  JOIN farmer_profile fp2 ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp2.id
  WHERE sa.apply_year = 2026 AND fp2.household_id = 1
`)[0].values[0][0]
assert(Number(areaRow) === 3, `面积聚合应为 3，实际 ${areaRow}`)

// 2) 预申请转发放（与 subsidies:convertToPayment 中的 INSERT 一致）
db.run(`INSERT INTO subsidy_payment (
    farmer_id, beneficiary_id, subsidy_type_id, payment_year, amount, payment_date,
    payment_village_id, payment_group_no, payment_village_name, payment_group_display,
    apply_area, apply_area_no_calc, contract_area, trust_area, no_subsidy_area,
    bank_card, bank_name, remark, pay_status, is_proxy
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
[1, 1, 1, 2026, 480, null, 1, 1, '测试村', '一组', 3.5, 0.5, 5, null, null,
  '6228000000000001', '农商行', null, 2, 0])
const pay = db.exec('SELECT apply_area_no_calc, pay_status FROM subsidy_payment')[0].values[0]
assert(Number(pay[0]) === 0.5 && Number(pay[1]) === 2, '发放记录未正确写入')

// 3) 移出成员：保留 household_id，标记 farmer_status=3
db.run("UPDATE farmer_profile SET farmer_status = 3, updated_at = datetime('now','localtime') WHERE id = 2")
const status = db.exec('SELECT farmer_status, household_id FROM farmer_profile WHERE id = 2')[0].values[0]
assert(Number(status[0]) === 3 && Number(status[1]) === 1, '成员迁出状态写入异常')

db.run(`INSERT INTO household_event (household_id, event_type, event_year, event_date, farmer_id, farmer_name, description, operator)
        VALUES (1, 'MEMBER_REMOVE', 2026, '2026-11-07', 2, '李四', '移出成员', '系统')`)
const ev = db.exec("SELECT COUNT(*) FROM household_event WHERE event_type='MEMBER_REMOVE'")[0].values[0][0]
assert(Number(ev) === 1, '家庭户事件未写入')

console.log('冒烟测试通过：面积聚合 / 转发放 / 移出成员 均正常')
