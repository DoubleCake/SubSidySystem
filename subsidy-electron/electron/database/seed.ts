/**
 * 模拟数据脚本 — 使用 sql.js
 * 运行: npx tsx electron/database/seed.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { randomSeed } from '../utils/random'

// 使用确定性随机
const rand = randomSeed(42)

const VILLAGES: [string, string[]][] = [
  ['红星村', ['一组', '二组', '三组', '四组']],
  ['青山村', ['一组', '二组', '三组']],
  ['幸福村', ['一组', '二组', '四组', '五组']],
  ['民主村', ['一组', '二组', '三组']],
  ['新建村', ['一组', '二组']],
]

const SURNAMES = '王李张刘陈杨黄赵周吴徐孙马朱胡郭林何高梁唐郑罗宋谢韩曹许邓萧冯曾程蔡彭潘袁于董余苏叶'.split('')
const GIVEN_M = ['国强', '建国', '志明', '文军', '海波', '建华', '荣华', '卫东', '振宇', '立新', '光明', '永强', '文斌', '胜利', '建设', '大勇', '志刚', '军民', '长江', '明德', '发强', '庆丰', '国华', '文杰', '建平', '忠诚', '永福', '玉林', '金山', '正平']
const GIVEN_F = ['秀英', '桂花', '凤英', '玉兰', '淑芬', '翠花', '丽华', '桂英', '春梅', '玉珍', '凤仙', '秀珍', '梅花', '彩霞', '香花', '淑英', '桂珍', '凤凰', '美珍', '素英', '文华', '惠芳', '淑珍', '春花', '玉华', '秀华', '月英', '桂兰', '翠云']
const BANKS = ['中国农业银行', '中国工商银行', '中国建设银行', '中国邮政储蓄银行', '农村商业银行']
const RELATIONS = ['妻子', '儿子', '女儿', '父亲', '母亲', '兄弟', '姐妹']

function randId(y: number, m: number, d: number, gender: number, seq: number): string {
  const area = rand.choice(['510123', '510124', '510125', '510126', '510181'])
  const seqPart = String((gender === 1 ? seq * 2 - 1 : seq * 2) % 999 + 1).padStart(3, '0')
  const body = `${area}${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}${seqPart}`
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checkMap = '10X98765432'
  let total = 0
  for (let i = 0; i < 17; i++) total += parseInt(body[i]) * weights[i]
  return body + checkMap[total % 11]
}

function randPhone(): string {
  return rand.choice(['138', '139', '150', '151', '158', '159', '186', '187']) +
    String(rand.nextInt(10000000, 99999999))
}

function randBank(): string {
  return '6228' + Array.from({ length: 15 }, () => rand.nextInt(0, 9)).join('')
}

function randName(gender: number): string {
  return rand.choice(SURNAMES) + (gender === 1 ? rand.choice(GIVEN_M) : rand.choice(GIVEN_F))
}

export async function runSeed(dbPath?: string): Promise<void> {
  const resolvedPath = dbPath || join(process.env.APPDATA || '', 'subsidy-electron', 'subsidy.db')
  console.log(`数据库路径: ${resolvedPath}`)

  const dir = dirname(resolvedPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // 动态导入 sql.js
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs()

  let db: ReturnType<typeof SQL.Database>
  if (existsSync(resolvedPath)) {
    db = new SQL.Database(readFileSync(resolvedPath))
  } else {
    db = new SQL.Database()
  }

  function save(): void {
    writeFileSync(resolvedPath, Buffer.from(db.export()))
  }

  function run(sql: string, ...params: unknown[]): { lastInsertRowid: number } {
    db.run(sql, params)
    save()
    const rows = db.exec('SELECT last_insert_rowid() as id')
    return { lastInsertRowid: Number(rows[0]?.values[0]?.[0] || 0) }
  }

  function get<T extends Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    const stmt = db.prepare(sql)
    if (params.length > 0) stmt.bind(params)
    if (stmt.step()) {
      const obj = stmt.getAsObject() as unknown as T
      stmt.free()
      return obj
    }
    stmt.free()
    return undefined
  }

  function all<T extends Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    const stmt = db.prepare(sql)
    if (params.length > 0) stmt.bind(params)
    const results: T[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as T)
    }
    stmt.free()
    return results
  }

  db.exec('PRAGMA foreign_keys = ON')

  // 1. 村组
  console.log('创建村组...')
  for (const [vname, groups] of VILLAGES) {
    let village = get<{ id: number }>('SELECT id FROM village WHERE village_name = ?', vname)
    if (!village) {
      const r = run('INSERT INTO village (village_name) VALUES (?)', vname)
      village = { id: r.lastInsertRowid }
    }
    for (const gno of groups) {
      const ex = get('SELECT id FROM village_group WHERE village_id = ? AND group_no = ?', village.id, gno)
      if (!ex) {
        run('INSERT INTO village_group (village_id, group_no) VALUES (?, ?)', village.id, gno)
      }
    }
  }

  // 2. 补贴类型
  console.log('创建补贴类型...')
  const seasonTypes: Record<string, string[]> = {
    '大春': ['水稻补贴', '玉米补贴', '大豆补贴'],
    '小春': ['小麦补贴', '油菜补贴'],
    '全年单补': ['耕地地力保护补贴'],
  }
  const fixedTypes = ['农村低保补助', '高龄老人补贴', '残疾人补贴', '生育补贴']

  for (const year of [2020, 2023, 2024]) {
    for (const [season, names] of Object.entries(seasonTypes)) {
      for (const name of names) {
        const ex = get('SELECT id FROM subsidy_type WHERE subsidy_name = ? AND subsidy_year = ?', name, year)
        if (!ex) {
          const amt = Math.round(rand.uniform(100, 300) * 100) / 100
          run(`INSERT INTO subsidy_type (subsidy_name, subsidy_year, calc_mode, standard_amount, standard_unit, fund_source, season, pay_status)
            VALUES (?, ?, 'per_mu', ?, '元/亩', ?, ?, 2)`,
            name, year, amt, rand.choice(['中央', '省级', '县级']), season)
        }
      }
    }
    for (const name of fixedTypes) {
      const ex = get('SELECT id FROM subsidy_type WHERE subsidy_name = ? AND subsidy_year = ?', name, year)
      if (!ex) {
        const amt = Math.round(rand.uniform(500, 2000) * 100) / 100
        run(`INSERT INTO subsidy_type (subsidy_name, subsidy_year, calc_mode, standard_amount, standard_unit, fund_source, season, pay_status)
          VALUES (?, ?, 'fixed', ?, '元/人', '县级', '全年单补', 2)`, name, year, amt)
      }
    }
  }

  // 3. 农户 + 家庭户
  console.log('创建农户和家庭户...')
  let createdF = 0, createdHh = 0
  const villageGroups = all<{ id: number; village_name: string; group_no: string; vid: number }>(
    'SELECT vg.id, v.village_name, vg.group_no, v.id as vid FROM village_group vg JOIN village v ON vg.village_id = v.id'
  )

  for (const vg of villageGroups) {
    for (let hhI = 0; hhI < rand.nextInt(7, 11); hhI++) {
      const gHead = rand.choice([1, 1, 1, 2])
      const by = rand.nextInt(1950, 1985)
      const bm = rand.nextInt(1, 12)
      const bd = rand.nextInt(1, 28)
      const idHead = randId(by, bm, bd, gHead, hhI + 1)

      if (get('SELECT id FROM farmer_profile WHERE id_card = ?', idHead)) continue

      const nameHead = randName(gHead)
      const land = Math.round(rand.uniform(0.5, 8.0) * 100) / 100
      const gno = parseInt(vg.group_no.replace(/[^0-9]/g, '')) || 1

      const r = run(`INSERT INTO family_household (household_code, household_name, village_id, group_no, address, contract_area, status)
        VALUES ('TEMP', ?, ?, ?, ?, ?, 1)`, `${nameHead}户`, vg.vid, gno, `${vg.village_name}${vg.group_no}${hhI + 1}号`, land)
      const hhId = r.lastInsertRowid

      const code = `HH${String(hhId).padStart(4, '0')}`
      run('UPDATE family_household SET household_code = ? WHERE id = ?', code, hhId)

      const hr = run(`INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, '本人', 1)`,
        hhId, nameHead, gHead, idHead,
        rand.uniform(0, 1) > 0.2 ? randPhone() : null,
        randBank(), rand.choice(BANKS))
      const headId = hr.lastInsertRowid
      run('UPDATE family_household SET head_farmer_id = ? WHERE id = ?', headId, hhId)
      createdF++

      for (let mi = 0; mi < rand.nextInt(0, 2); mi++) {
        const mg = rand.choice([1, 2])
        const mby = rand.nextInt(1960, 2005)
        const mid = randId(mby, rand.nextInt(1, 12), rand.nextInt(1, 28), mg, hhI * 10 + mi + 1)
        if (get('SELECT id FROM farmer_profile WHERE id_card = ?', mid)) continue

        run(`INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          hhId, randName(mg), mg, mid,
          rand.uniform(0, 1) > 0.5 ? randPhone() : null,
          rand.uniform(0, 1) > 0.4 ? randBank() : null,
          rand.uniform(0, 1) > 0.4 ? rand.choice(BANKS) : null,
          rand.choice(RELATIONS),
          rand.weightedChoice([1, 1, 1, 2, 3], [80, 5, 5, 5, 5]))
        createdF++
      }
      createdHh++
    }
  }

  console.log(`  农户: ${createdF} 人, 家庭户: ${createdHh} 户`)

  // 4. 补贴申请
  console.log('创建补贴申请...')
  let createdApp = 0

  const areaTypes = all<{ id: number; standard_amount: number; season: string }>(
    "SELECT id, standard_amount, season FROM subsidy_type WHERE calc_mode = 'per_mu' AND subsidy_year = 2020"
  )
  const heads = all<{ id: number; household_id: number; bank_card: string | null }>(`
    SELECT fp.id, fp.household_id, fp.bank_card
    FROM farmer_profile fp JOIN family_household hh ON hh.head_farmer_id = fp.id
    WHERE fp.farmer_status = 1
  `)

  for (const h of heads) {
    const hh = get<{ contract_area: number | null }>('SELECT contract_area FROM family_household WHERE id = ?', h.household_id)
    const land = Number(hh?.contract_area || 0)
    if (land <= 0) continue

    for (const st of areaTypes) {
      if (rand.uniform(0, 1) > 0.85) continue
      if (get('SELECT id FROM subsidy_application WHERE farmer_id = ? AND subsidy_type_id = ? AND apply_year = 2020', h.id, st.id)) continue

      const area = Math.round(land * rand.uniform(0.6, 1.0) * 100) / 100
      const amount = Math.round(area * st.standard_amount * 100) / 100
      const pmonth = rand.nextInt(7, 11)
      const pday = rand.nextInt(1, 28)

      run(`INSERT INTO subsidy_application (farmer_id, beneficiary_id, subsidy_type_id, apply_year, apply_area, apply_amount, actual_amount, pay_status, pay_date, bank_card_snapshot)
        VALUES (?, ?, ?, 2020, ?, ?, ?, 2, ?, ?)`,
        h.id, h.id, st.id, area, amount, amount,
        `2020-${String(pmonth).padStart(2, '0')}-${String(pday).padStart(2, '0')}`,
        h.bank_card ? h.bank_card.slice(-4) : null)
      createdApp++
    }
  }

  // 固定金额补贴
  const fixedTypes2 = all<{ id: number; standard_amount: number }>(
    "SELECT id, standard_amount FROM subsidy_type WHERE calc_mode = 'fixed' AND subsidy_year = 2020"
  )
  const allFarmers = all<{ id: number; bank_card: string | null }>(
    'SELECT id, bank_card FROM farmer_profile WHERE farmer_status = 1'
  )

  for (const st of fixedTypes2) {
    const chosen = rand.sample(allFarmers, Math.floor(allFarmers.length * rand.uniform(0.2, 0.4)))
    for (const f of chosen) {
      if (get('SELECT id FROM subsidy_application WHERE farmer_id = ? AND subsidy_type_id = ? AND apply_year = 2020', f.id, st.id)) continue
      const pmonth = rand.nextInt(7, 11)
      const pday = rand.nextInt(1, 28)
      run(`INSERT INTO subsidy_application (farmer_id, beneficiary_id, subsidy_type_id, apply_year, apply_amount, actual_amount, pay_status, pay_date, bank_card_snapshot)
        VALUES (?, ?, ?, 2020, ?, ?, 2, ?, ?)`,
        f.id, f.id, st.id, st.standard_amount, st.standard_amount,
        `2020-${String(pmonth).padStart(2, '0')}-${String(pday).padStart(2, '0')}`,
        f.bank_card ? f.bank_card.slice(-4) : null)
      createdApp++
    }
  }

  console.log(`  补贴记录: ${createdApp} 条`)
  console.log('=== 种子数据生成完成 ===')

  const tf = (get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM farmer_profile') || { cnt: 0 }).cnt
  const th = (get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM family_household') || { cnt: 0 }).cnt
  const ta = (get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM subsidy_application') || { cnt: 0 }).cnt
  console.log(`数据库总计: ${tf} 农户 / ${th} 家庭户 / ${ta} 补贴记录`)

  db.close()
  console.log('数据库已保存')
}

// 直接运行
if (require.main === module) {
  runSeed().catch(console.error)
}
