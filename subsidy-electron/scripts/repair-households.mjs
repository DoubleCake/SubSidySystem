/**
 * 家庭户存量数据修复（默认只预演，不写库）。
 *
 * 修复三类问题：
 *   1. 在册但 0 成员的家庭户 → status = 3（迁出）
 *   2. head_farmer_id 指向不存在/别户成员 → 改选户内在册成员
 *   3. 同一户多个「户主」→ 保留 head_farmer_id 对应成员，其余降为「成员」
 *
 * 用法：
 *   node scripts/repair-households.mjs                 # 预演，只读
 *   node scripts/repair-households.mjs --apply         # 备份后写库
 *   node scripts/repair-households.mjs <db路径> --apply
 *
 * 写库前会先复制一份 <db>.bak-YYYYMMDD-HHmmss，并为每户写一条家庭户事件。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dbPath = args.find(a => !a.startsWith('--')) || join(process.env.APPDATA || '', 'subsidy-electron', 'subsidy.db')
if (!existsSync(dbPath)) { console.error('数据库不存在：' + dbPath); process.exit(2) }

const SQL = await initSqlJs({ locateFile: f => join(process.cwd(), 'node_modules/sql.js/dist', f) })
const db = new SQL.Database(readFileSync(dbPath))

const maskName = s => {
  s = String(s || '')
  if (s.length <= 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}
const q = (sql, params = []) => {
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  const out = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

const emptyActive = q(`
  SELECT hh.id, hh.household_code, hh.household_name
  FROM family_household hh
  WHERE hh.status = 1
    AND NOT EXISTS (SELECT 1 FROM farmer_profile fp WHERE fp.household_id = hh.id)
  ORDER BY hh.id`)

const invalidHead = q(`
  SELECT hh.id, hh.household_code, hh.household_name, hh.head_farmer_id,
         fp.household_id AS head_hh, fp.real_name AS head_name
  FROM family_household hh
  LEFT JOIN farmer_profile fp ON fp.id = hh.head_farmer_id
  WHERE hh.status = 1
    AND (hh.head_farmer_id IS NULL OR fp.id IS NULL OR fp.household_id != hh.id)
  ORDER BY hh.id`)

const multiHeadRows = q(`
  SELECT household_id, COUNT(*) AS cnt
  FROM farmer_profile
  WHERE relation = '户主' AND farmer_status = 1
  GROUP BY household_id HAVING COUNT(*) > 1`)

// 汇总需要处理的家庭户
const targetIds = new Set([...emptyActive, ...invalidHead, ...multiHeadRows].map(r => Number(r.id ?? r.household_id)))
const plans = []
for (const hid of targetIds) {
  const hh = q('SELECT * FROM family_household WHERE id = ?', [hid])[0]
  if (!hh) continue
  const members = q(`SELECT id, real_name, relation, farmer_status FROM farmer_profile
                     WHERE household_id = ?
                     ORDER BY CASE WHEN farmer_status = 1 THEN 0 ELSE 1 END, id`, [hid])
  const active = members.filter(m => Number(m.farmer_status) === 1)
  const current = members.find(m => Number(m.id) === Number(hh.head_farmer_id))

  if (members.length === 0) {
    plans.push({ kind: 'empty', id: hid, name: hh.household_name })
    continue
  }

  let chosen
  if (current && Number(current.farmer_status) === 1) chosen = current
  else chosen = active.find(m => m.relation === '户主') || active[0] || members[0]

  const others = members.filter(m => Number(m.id) !== Number(chosen.id) && m.relation === '户主' && Number(m.farmer_status) === 1)
  const headChanged = Number(hh.head_farmer_id) !== Number(chosen.id)
  if (headChanged || others.length > 0) {
    plans.push({
      kind: 'head', id: hid, name: hh.household_name,
      oldHeadId: hh.head_farmer_id, oldHeadName: current?.real_name || '（无效）',
      chosen, others,
    })
  }
}

const emptyPlans = plans.filter(p => p.kind === 'empty')
const headPlans = plans.filter(p => p.kind === 'head')

console.log(`数据库：${dbPath}`)
console.log(`在册 0 成员：${emptyPlans.length} 户`)
console.log(`户主待修正：${headPlans.length} 户（含多头户主 ${multiHeadRows.length} 户）`)
console.log(`合计将要修改：${plans.length} 户`)

const show = (arr, fmt) => {
  for (const p of arr.slice(0, 10)) console.log('  - ' + fmt(p))
  if (arr.length > 10) console.log(`  … 其余 ${arr.length - 10} 户省略`)
}
console.log('\n[空户 → 标记迁出]')
show(emptyPlans, p => `#${p.id} ${maskName(p.name)}`)
console.log('\n[户主修正（户内改选/多头降级）]')
show(headPlans, p => `#${p.id} ${maskName(p.name)}：${maskName(p.oldHeadName)} → ${maskName(p.chosen.real_name)}${p.others.length ? `，降级 ${p.others.length} 个户主` : ''}`)

if (!apply) {
  console.log('\n当前为预演模式，未修改数据库。确认后加 --apply 执行（会先自动备份）。')
  process.exit(0)
}

// ── 写库 ──
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = `${dbPath}.bak-${stamp}`
copyFileSync(dbPath, backup)
console.log(`\n已备份：${backup}`)

const now = new Date()
const year = now.getFullYear()
const dateStr = now.toISOString().split('T')[0]

db.run('BEGIN')
try {
  for (const p of emptyPlans) {
    db.run("UPDATE family_household SET status = 3, updated_at = datetime('now','localtime') WHERE id = ?", [p.id])
    db.run(`INSERT INTO household_event (household_id, event_type, event_year, event_date, date_accuracy, description, operator)
            VALUES (?, 'REMARK', ?, ?, 'EXACT', ?, '数据体检修复')`, [p.id, year, dateStr, '家庭户无成员，标记为迁出'])
  }
  for (const p of headPlans) {
    db.run("UPDATE family_household SET head_farmer_id = ?, updated_at = datetime('now','localtime') WHERE id = ?", [p.chosen.id, p.id])
    db.run("UPDATE farmer_profile SET relation = '户主' WHERE id = ?", [p.chosen.id])
    for (const o of p.others) {
      db.run("UPDATE farmer_profile SET relation = '成员' WHERE id = ?", [o.id])
    }
    const desc = p.oldHeadId
      ? `数据体检修复：户主由「${p.oldHeadName}」改为「${p.chosen.real_name}」`
      : `数据体检修复：补充户主「${p.chosen.real_name}」`
    db.run(`INSERT INTO household_event (household_id, event_type, event_year, event_date, date_accuracy, farmer_id, farmer_name, description, operator)
            VALUES (?, 'HEAD_CHANGE', ?, ?, 'EXACT', ?, ?, ?, '数据体检修复')`,
      [p.id, year, dateStr, p.chosen.id, p.chosen.real_name, desc])
  }
  db.run('COMMIT')
} catch (e) {
  try { db.run('ROLLBACK') } catch { /* ignore */ }
  console.error('写入失败，已回滚：' + e.message)
  process.exit(1)
}

writeFileSync(dbPath, Buffer.from(db.export()))
console.log(`完成：空户 ${emptyPlans.length} 户、户主修正 ${headPlans.length} 户。`)
