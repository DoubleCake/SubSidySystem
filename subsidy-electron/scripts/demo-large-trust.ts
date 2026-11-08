/**
 * 大户流转明细演示数据
 *
 * 用法（先备份 subsidy.db）：
 *   npm run demo:large-trust
 *
 * 会为每个大户补充 2~3 条演示流转记录，仅用于界面演示；
 * 不影响已有数据，重复执行会跳过已存在的演示记录。
 */
import { app } from 'electron'
import path from 'path'
import initSqlJs from 'sql.js'
import fs from 'fs'

async function main() {
  const dbPath = path.join(app.getPath('userData'), 'subsidy.db')
  if (!fs.existsSync(dbPath)) {
    console.error('数据库不存在:', dbPath)
    process.exit(1)
  }

  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(dbPath))

  // 确认扩展列已存在
  const cols = db.exec("PRAGMA table_info('large_farmer_trust')")[0]?.values.map((r: unknown[]) => r[1]) || []
  if (!cols.includes('counterparty_name')) {
    console.error('请先启动一次应用，触发迁移后再运行本脚本')
    process.exit(1)
  }

  const farmers = db.exec('SELECT id, operator_name, village_id, group_no FROM large_farmer')[0]?.values || []
  if (farmers.length === 0) {
    console.log('没有大户数据，跳过')
    process.exit(0)
  }

  const villageName = (vid: unknown) => {
    const r = db.exec(`SELECT village_name FROM village WHERE id=${Number(vid)}`)[0]?.values?.[0]
    return r ? String(r[0]) : ''
  }

  const samples = [
    { name: '张德贵', village: '', group: '3 组', area: 12.5, planted: 12.5, days: 1825, year: 2021, start: '2021-03-01', end: '2026-02-28', crop: '水稻' },
    { name: '李秀兰', village: '', group: '1 组', area: 8.2, planted: 8.2, days: 1095, year: 2022, start: '2022-06-01', end: '2025-05-31', crop: '玉米' },
    { name: '王家庄 4 组集体', village: '', group: '4 组', area: 20.0, planted: 18.0, days: 3650, year: 2020, start: '2020-01-01', end: '2029-12-31', crop: '蔬菜' },
  ]

  let added = 0
  for (const f of farmers) {
    const fid = Number(f[0])
    const vname = villageName(f[2])
    const exists = db.exec(`SELECT COUNT(*) FROM large_farmer_trust WHERE large_farmer_id=${fid}`)[0]?.values?.[0]?.[0] as number
    if (exists > 0) continue

    samples.slice(0, 2 + (fid % 2)).forEach((s, i) => {
      db.run(
        `INSERT INTO large_farmer_trust
          (large_farmer_id, owner_household_id, trust_type, area, trust_year, start_date, end_date, note,
           counterparty_type, counterparty_name, counterparty_village, counterparty_group, trust_days,
           planted_area, own_area, crop_type)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [fid, 0, i === 2 ? 'COLLECTIVE' : 'ENTRUST', s.area, s.year, s.start, s.end, '演示数据',
          i === 2 ? 'VILLAGE' : 'HOUSEHOLD', s.name, vname, s.group, s.days,
          s.planted, s.planted, s.crop]
      )
      added++
    })

    // 同步大户汇总面积
    const total = db.exec(`SELECT COALESCE(SUM(area),0) FROM large_farmer_trust WHERE large_farmer_id=${fid}`)[0]?.values?.[0]?.[0] ?? 0
    db.run(`UPDATE large_farmer SET trust_in_area=?, total_managed_area=COALESCE(own_contract_area,0)+? WHERE id=?`,
      [total, total, fid])
  }

  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  console.log(`✓ 已为 ${farmers.length} 个大户写入 ${added} 条演示流转记录`)
  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
