/**
 * 异常检测规则（纯 SQL 逻辑，不依赖 Electron，便于测试）
 *  - OVER_AREA 超领
 *  - DUPLICATE_CLAIM 重复领取
 *  - MULTI_CLAIM 多人领取
 *  - DEATH_CLAIM 死亡后领取
 */

export interface AnomalyDb {
  allRaw<T = Record<string, any>>(sql: string, ...params: unknown[]): T[]
  runRaw(sql: string, ...params: unknown[]): { changes: number }
}

const round2 = (n: number) => Math.round(n * 100) / 100

function insertAnomaly(db: AnomalyDb, r: {
  typeCode: string
  dedupKey: string
  subjectType: string
  subjectId: number
  householdId?: number | null
  farmerId?: number | null
  subsidyTypeId?: number | null
  year: number
  season?: string | null
  title: string
  detail: string
  metric?: number | null
  reference?: number | null
  diff?: number | null
  severity: string
  ruleKey: string
  batchKey: string
}): number {
  const res = db.runRaw(
    `INSERT OR IGNORE INTO anomaly_record
       (type_code, dedup_key, subject_type, subject_id, household_id, farmer_id, subsidy_type_id,
        year, season, title, detail, metric_value, reference_value, diff_value,
        severity, status, source, rule_key, batch_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'auto', ?, ?)`,
    r.typeCode, r.dedupKey, r.subjectType, r.subjectId, r.householdId ?? null, r.farmerId ?? null,
    r.subsidyTypeId ?? null, r.year, r.season ?? null, r.title, r.detail,
    r.metric ?? null, r.reference ?? null, r.diff ?? null,
    r.severity, r.ruleKey, r.batchKey
  )
  return res.changes
}

/** 超领：同户 + 年度 + 季节，计入超限面积 > 参考面积（确权/承包取大） */
export function scanOverArea(db: AnomalyDb, year: number, batchKey: string): number {
  const rows = db.allRaw<any>(`
    SELECT fp.household_id AS hid, hh.household_code, hh.household_name,
           hh.contract_area, hh.confirmed_area,
           COALESCE(st.season, '全年单补') AS season,
           SUM(sa.apply_area - COALESCE(sa.apply_area_no_calc, 0)
               - COALESCE(sa.trust_area, 0) - COALESCE(sa.no_subsidy_area, 0)) AS used
    FROM subsidy_application sa
    JOIN farmer_profile fp ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp.id
    JOIN family_household hh ON hh.id = fp.household_id
    LEFT JOIN subsidy_type st ON st.id = sa.subsidy_type_id
    WHERE sa.apply_year = ?
    GROUP BY fp.household_id, COALESCE(st.season, '全年单补')
    HAVING used > 0
  `, year)

  let inserted = 0
  for (const r of rows) {
    const used = Number(r.used || 0)
    const ref = Math.max(Number(r.confirmed_area || 0), Number(r.contract_area || 0))
    if (!(ref > 0) || used <= ref + 0.001) continue
    const diff = round2(used - ref)
    const ratio = diff / ref
    const severity = ratio >= 0.2 ? 'high' : ratio >= 0.05 ? 'medium' : 'low'
    inserted += insertAnomaly(db, {
      typeCode: 'OVER_AREA',
      dedupKey: `OVER_AREA:${r.hid}:${year}:${r.season}`,
      subjectType: 'household',
      subjectId: Number(r.hid),
      householdId: Number(r.hid),
      year,
      season: String(r.season),
      title: `${r.household_name || '家庭户'} ${year}年${r.season}超领 ${diff} 亩`,
      detail: `计入超限面积 ${round2(used)} 亩，参考面积 ${ref} 亩，超出 ${diff} 亩`,
      metric: round2(used),
      reference: ref,
      diff,
      severity,
      ruleKey: 'over_area',
      batchKey,
    })
  }
  return inserted
}

/** 重复领取：同一身份证 + 同一年度 + 同一补贴项目，出现 ≥2 条发放记录 */
export function scanDuplicateClaim(db: AnomalyDb, year: number, batchKey: string): number {
  const rows = db.allRaw<any>(`
    SELECT sp.beneficiary_id AS fid, fp.real_name, fp.id_card,
           st.subsidy_name, COUNT(*) AS cnt, COALESCE(SUM(sp.amount), 0) AS amt,
           GROUP_CONCAT(sp.id) AS payment_ids
    FROM subsidy_payment sp
    JOIN farmer_profile fp ON fp.id = sp.beneficiary_id
    JOIN subsidy_type st ON st.id = sp.subsidy_type_id
    WHERE sp.payment_year = ?
    GROUP BY sp.beneficiary_id, st.subsidy_name
    HAVING cnt >= 2
  `, year)

  let inserted = 0
  for (const r of rows) {
    inserted += insertAnomaly(db, {
      typeCode: 'DUPLICATE_CLAIM',
      dedupKey: `DUPLICATE_CLAIM:${r.fid}:${year}:${r.subsidy_name}`,
      subjectType: 'farmer',
      subjectId: Number(r.fid),
      farmerId: Number(r.fid),
      year,
      title: `${r.real_name || '农户'} 重复领取「${r.subsidy_name}」${r.cnt} 次`,
      detail: `同一身份证同一年度同一补贴项目存在 ${r.cnt} 条发放记录（发放ID：${r.payment_ids}），合计 ${round2(Number(r.amt))} 元`,
      metric: Number(r.cnt),
      reference: 1,
      diff: Number(r.cnt) - 1,
      severity: 'high',
      ruleKey: 'duplicate_claim',
      batchKey,
    })
  }
  return inserted
}

/** 多人领取：同一户 + 同一年度 + 按户补贴（元/户），被 ≥2 名成员领取 */
export function scanMultiClaim(db: AnomalyDb, year: number, batchKey: string): number {
  const rows = db.allRaw<any>(`
    SELECT fp.household_id AS hid, hh.household_name, sp.subsidy_type_id AS tid,
           st.subsidy_name, COUNT(DISTINCT sp.beneficiary_id) AS cnt,
           COUNT(*) AS pay_cnt, COALESCE(SUM(sp.amount), 0) AS amt
    FROM subsidy_payment sp
    JOIN farmer_profile fp ON fp.id = sp.beneficiary_id
    JOIN family_household hh ON hh.id = fp.household_id
    JOIN subsidy_type st ON st.id = sp.subsidy_type_id
    WHERE sp.payment_year = ?
      AND st.calc_mode = 'fixed'
      AND st.standard_unit = '元/户'
    GROUP BY fp.household_id, sp.subsidy_type_id
    HAVING cnt >= 2
  `, year)

  let inserted = 0
  for (const r of rows) {
    inserted += insertAnomaly(db, {
      typeCode: 'MULTI_CLAIM',
      dedupKey: `MULTI_CLAIM:${r.hid}:${year}:${r.tid}`,
      subjectType: 'household',
      subjectId: Number(r.hid),
      householdId: Number(r.hid),
      subsidyTypeId: Number(r.tid),
      year,
      title: `${r.household_name || '家庭户'} 多人领取「${r.subsidy_name}」${r.cnt} 人`,
      detail: `按户补贴（元/户）同一年度被 ${r.cnt} 名成员领取，共 ${r.pay_cnt} 条发放，合计 ${round2(Number(r.amt))} 元`,
      metric: Number(r.cnt),
      reference: 1,
      diff: Number(r.cnt) - 1,
      severity: 'high',
      ruleKey: 'multi_claim',
      batchKey,
    })
  }
  return inserted
}

/** 死亡后领取：发放日期晚于死亡/状态日期，或已死亡人员仍有当年发放 */
export function scanDeathClaim(db: AnomalyDb, year: number, batchKey: string): number {
  const rows = db.allRaw<any>(`
    SELECT sp.id AS pid, sp.beneficiary_id AS fid, sp.farmer_id, sp.payment_date, sp.payment_year,
           COALESCE(sp.amount, 0) AS amt, st.subsidy_name,
           fp.real_name, fp.id_card, fp.death_date, fp.status_date, fp.household_id AS hid
    FROM subsidy_payment sp
    JOIN farmer_profile fp ON fp.id = COALESCE(sp.beneficiary_id, sp.farmer_id)
    LEFT JOIN subsidy_type st ON st.id = sp.subsidy_type_id
    WHERE sp.payment_year = ?
      AND fp.farmer_status = 4
      AND (
        (fp.death_date IS NOT NULL AND sp.payment_date IS NOT NULL
          AND date(sp.payment_date) > date(fp.death_date))
        OR (fp.death_date IS NULL AND fp.status_date IS NOT NULL AND sp.payment_date IS NOT NULL
          AND date(sp.payment_date) > date(fp.status_date))
        OR (fp.death_date IS NULL AND fp.status_date IS NULL
          AND sp.payment_year >= CAST(strftime('%Y','now') AS INTEGER))
      )
  `, year)

  let inserted = 0
  for (const r of rows) {
    const deathDate = r.death_date || r.status_date
    inserted += insertAnomaly(db, {
      typeCode: 'DEATH_CLAIM',
      dedupKey: `DEATH_CLAIM:${r.pid}`,
      subjectType: 'payment',
      subjectId: Number(r.pid),
      householdId: r.hid ? Number(r.hid) : null,
      farmerId: Number(r.fid),
      year: Number(r.payment_year),
      title: `${r.real_name || '农户'} 死亡后领取「${r.subsidy_name || '补贴'}」${round2(Number(r.amt))} 元`,
      detail: deathDate
        ? `死亡/状态日期 ${deathDate}，发放日期 ${r.payment_date || '—'}`
        : '人员状态为死亡，但未登记死亡日期，需人工核实发放时间',
      metric: round2(Number(r.amt)),
      reference: 0,
      diff: round2(Number(r.amt)),
      severity: deathDate ? 'high' : 'medium',
      ruleKey: 'death_claim',
      batchKey,
    })
  }
  return inserted
}

export interface ScanResult {
  inserted: Record<string, number>
  errors: string[]
  total: number
}

/** 依次执行四类规则；单条规则失败不影响其它规则 */
export function runAnomalyScan(db: AnomalyDb, year: number, batchKey: string): ScanResult {
  const inserted: Record<string, number> = { OVER_AREA: 0, DUPLICATE_CLAIM: 0, MULTI_CLAIM: 0, DEATH_CLAIM: 0 }
  const errors: string[] = []

  const runners: Array<[string, () => number]> = [
    ['OVER_AREA', () => scanOverArea(db, year, batchKey)],
    ['DUPLICATE_CLAIM', () => scanDuplicateClaim(db, year, batchKey)],
    ['MULTI_CLAIM', () => scanMultiClaim(db, year, batchKey)],
    ['DEATH_CLAIM', () => scanDeathClaim(db, year, batchKey)],
  ]
  for (const [code, run] of runners) {
    try { inserted[code] = run() } catch (e) { errors.push(`${code}: ${String(e)}`) }
  }
  return { inserted, errors, total: Object.values(inserted).reduce((s, n) => s + n, 0) }
}
