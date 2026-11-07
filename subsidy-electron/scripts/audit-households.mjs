/**
 * 家庭户数据只读体检。
 * 只读取数据库文件到内存做查询，绝不写回；不会修改任何数据。
 *
 * 用法：
 *   node scripts/audit-households.mjs                # 默认检查 %APPDATA%/subsidy-electron/subsidy.db
 *   node scripts/audit-households.mjs <db路径>
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'

const cwd = process.cwd()
const dbPath = process.argv[2] || join(process.env.APPDATA || '', 'subsidy-electron', 'subsidy.db')

if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`)
  process.exit(2)
}

const SQL = await initSqlJs({ locateFile: f => join(cwd, 'node_modules/sql.js/dist', f) })
const db = new SQL.Database(readFileSync(dbPath))

const maskName = s => {
  s = String(s || '')
  if (s.length <= 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}
const maskId = s => {
  s = String(s || '')
  return s.length >= 10 ? s.slice(0, 6) + '********' + s.slice(-4) : s
}

function q(sql, ...params) {
  try {
    const stmt = db.prepare(sql)
    if (params.length) stmt.bind(params)
    const out = []
    while (stmt.step()) out.push(stmt.getAsObject())
    stmt.free()
    return out
  } catch (e) {
    return [{ __error: String(e.message || e) }]
  }
}

function table(name) {
  return q("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name).length > 0
}

const findings = []
function report(title, rows, format, limit = 8) {
  if (rows.length && rows[0].__error) {
    findings.push(`\n【${title}】跳过：${rows[0].__error}`)
    return
  }
  findings.push(`\n【${title}】${rows.length} 条`)
  for (const r of rows.slice(0, limit)) findings.push('  - ' + format(r))
  if (rows.length > limit) findings.push(`  … 其余 ${rows.length - limit} 条省略`)
}

console.log(`只读体检：${dbPath}`)
console.log(`大小：${(readFileSync(dbPath).length / 1024 / 1024).toFixed(1)} MB`)

if (!table('family_household')) {
  console.error('不是本系统的数据库（缺少 family_household 表）')
  process.exit(2)
}

// 1. 在册但没有任何成员 → 多半是合并失败留下的
report('在册但 0 成员的家庭户（疑似合并失败残留）',
  q(`SELECT hh.id, hh.household_code, hh.household_name, hh.status, hh.contract_area, hh.confirmed_area
     FROM family_household hh
     WHERE hh.status = 1
       AND NOT EXISTS (SELECT 1 FROM farmer_profile fp WHERE fp.household_id = hh.id)
     ORDER BY hh.id`),
  r => `#${r.id} ${r.household_code} ${maskName(r.household_name)} 承包=${r.contract_area ?? '—'} 确权=${r.confirmed_area ?? '—'}`)

// 2. 一个户多个户主
report('同一户出现多个「户主」成员',
  q(`SELECT household_id, COUNT(*) AS cnt, GROUP_CONCAT(real_name) AS names
     FROM farmer_profile
     WHERE relation = '户主' AND farmer_status = 1
     GROUP BY household_id HAVING COUNT(*) > 1
     ORDER BY cnt DESC`),
  r => `户#${r.household_id}：${r.cnt} 人（${String(r.names || '').split(',').map(maskName).join('、')}）`)

// 3. 户主字段异常：指向不存在、或指向别户成员、或在册户无户主
const headStat = q(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN hh.head_farmer_id IS NULL THEN 1 ELSE 0 END) AS null_head,
    SUM(CASE WHEN fp.id IS NULL AND hh.head_farmer_id IS NOT NULL THEN 1 ELSE 0 END) AS missing,
    SUM(CASE WHEN fp.id IS NOT NULL AND fp.household_id = hh.id THEN 1 ELSE 0 END) AS ok,
    SUM(CASE WHEN fp.id IS NOT NULL AND fp.household_id != hh.id THEN 1 ELSE 0 END) AS wrong_hh,
    SUM(CASE WHEN hh.head_farmer_id = hh.id THEN 1 ELSE 0 END) AS same_id
  FROM family_household hh
  LEFT JOIN farmer_profile fp ON fp.id = hh.head_farmer_id`)
if (headStat.length && !headStat[0].__error) {
  const h = headStat[0]
  findings.push(`\n【户主字段概况】共 ${h.total} 户：正常 ${h.ok ?? 0}；为空 ${h.null_head ?? 0}；指向不存在 ${h.missing ?? 0}；指向别户成员 ${h.wrong_hh ?? 0}；head_farmer_id 恰好等于户id ${h.same_id ?? 0}`)
}

report('户主字段指向无效成员',
  q(`SELECT hh.id, hh.household_code, hh.household_name, hh.head_farmer_id
     FROM family_household hh
     LEFT JOIN farmer_profile fp ON fp.id = hh.head_farmer_id
     WHERE hh.head_farmer_id IS NOT NULL
       AND (fp.id IS NULL OR fp.household_id != hh.id)
     ORDER BY hh.id`),
  r => `#${r.id} ${r.household_code} ${maskName(r.household_name)} → head_farmer_id=${r.head_farmer_id}`)

report('在册且有成员、但没有户主',
  q(`SELECT hh.id, hh.household_code, hh.household_name,
            (SELECT COUNT(*) FROM farmer_profile fp WHERE fp.household_id = hh.id) AS members
     FROM family_household hh
     WHERE hh.status = 1
       AND (hh.head_farmer_id IS NULL OR hh.head_farmer_id = 0)
       AND EXISTS (SELECT 1 FROM farmer_profile fp WHERE fp.household_id = hh.id)
     ORDER BY hh.id`),
  r => `#${r.id} ${r.household_code} ${maskName(r.household_name)}（${r.members} 人）`)

// 4. 土地流转指向不存在的家庭户
if (table('land_trust')) {
  report('土地流转记录指向已不存在的家庭户（孤儿）',
    q(`SELECT lt.id, lt.owner_household_id, lt.operator_household_id, lt.area, lt.trust_year
       FROM land_trust lt
       WHERE (lt.owner_household_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM family_household hh WHERE hh.id = lt.owner_household_id))
          OR (lt.operator_household_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM family_household hh WHERE hh.id = lt.operator_household_id))
       ORDER BY lt.id`),
    r => `流转#${r.id} 户=${r.owner_household_id}→${r.operator_household_id} 面积=${r.area} 年度=${r.trust_year}`)
}

// 5. 家庭户事件指向已不存在的家庭户
if (table('household_event')) {
  report('家庭户事件指向已不存在的家庭户（孤儿）',
    q(`SELECT he.id, he.household_id, he.event_type, he.event_year, he.farmer_name
       FROM household_event he
       WHERE NOT EXISTS (SELECT 1 FROM family_household hh WHERE hh.id = he.household_id)
       ORDER BY he.id`),
    r => `事件#${r.id} 户#${r.household_id} ${r.event_type} ${r.event_year} ${maskName(r.farmer_name)}`)
}

// 6. 大户流转指向不存在的家庭户
if (table('large_farmer_trust')) {
  report('大户流转指向已不存在的家庭户（孤儿）',
    q(`SELECT t.id, t.large_farmer_id, t.owner_household_id, t.area, t.trust_year
       FROM large_farmer_trust t
       WHERE t.owner_household_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM family_household hh WHERE hh.id = t.owner_household_id)
       ORDER BY t.id`),
    r => `大户流转#${r.id} 大户=${r.large_farmer_id} 户#${r.owner_household_id} 面积=${r.area}`)
}

// 7. 面积缓存孤儿
if (table('household_area_usage_cache')) {
  const c = q(`SELECT COUNT(*) AS cnt FROM household_area_usage_cache c
               WHERE NOT EXISTS (SELECT 1 FROM family_household hh WHERE hh.id = c.household_id)`)
  findings.push(`\n【面积缓存孤儿记录】${c[0]?.cnt ?? 0} 条（该表当前代码已不再写入）`)
}

// 8. 有补贴记录但参考面积为空的家庭户
report('有补贴记录、但没有承包/确权面积的家庭户',
  q(`SELECT hh.id, hh.household_code, hh.household_name,
            COUNT(sa.id) AS apps,
            COALESCE(SUM(sa.apply_area), 0) AS area
     FROM family_household hh
     JOIN farmer_profile fp ON fp.household_id = hh.id
     JOIN subsidy_application sa ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp.id
     WHERE COALESCE(hh.confirmed_area, hh.contract_area, 0) <= 0
     GROUP BY hh.id
     HAVING COUNT(sa.id) > 0
     ORDER BY area DESC`),
  r => `#${r.id} ${r.household_code} ${maskName(r.household_name)} 申报${r.apps}条/面积${Number(r.area).toFixed(2)}`)

// 9. 参考面积口径差异（确权 vs 承包）
const diff = q(`SELECT
    SUM(CASE WHEN confirmed_area IS NOT NULL AND contract_area IS NOT NULL
              AND ABS(confirmed_area - contract_area) > 0.01 THEN 1 ELSE 0 END) AS diff_cnt,
    SUM(CASE WHEN confirmed_area IS NULL THEN 1 ELSE 0 END) AS no_confirmed,
    SUM(CASE WHEN contract_area IS NULL THEN 1 ELSE 0 END) AS no_contract,
    COUNT(*) AS total
  FROM family_household`)
if (diff.length && !diff[0].__error) {
  const d = diff[0]
  findings.push(`\n【面积字段概况】共 ${d.total} 户；确权≠承包 ${d.diff_cnt ?? 0} 户；无确权 ${d.no_confirmed ?? 0} 户；无承包 ${d.no_contract ?? 0} 户`)
}

// 10. 补贴记录指向不存在农户
report('补贴申请指向已不存在的农户（孤儿）',
  q(`SELECT sa.id, sa.farmer_id, sa.beneficiary_id, sa.apply_year
     FROM subsidy_application sa
     WHERE NOT EXISTS (SELECT 1 FROM farmer_profile fp WHERE fp.id = sa.farmer_id)
        OR (sa.beneficiary_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM farmer_profile fp WHERE fp.id = sa.beneficiary_id))
     ORDER BY sa.id`),
  r => `申请#${r.id} 农户=${r.farmer_id} 受益人=${r.beneficiary_id} 年度=${r.apply_year}`)

// 11. 重复身份证（正常应被唯一约束拦住）
report('重复身份证',
  q(`SELECT id_card, COUNT(*) AS cnt FROM farmer_profile GROUP BY id_card HAVING COUNT(*) > 1`),
  r => `${maskId(r.id_card)} × ${r.cnt}`)

console.log(findings.join('\n'))
console.log('\n提示：本脚本只读，未修改数据库。')
