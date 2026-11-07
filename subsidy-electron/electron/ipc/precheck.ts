/**
 * 预检查引擎 — 基于 precheck_rule_config 表的可配置规则
 *
 * 每项规则 enable=1 才执行，threshold_json 提供参数
 */
import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

// ── 默认规则（表为空时的后备） ──
const DEFAULT_RULES = [
  { rule_key: 'format_errors', rule_name: '格式错误', enabled: 1, threshold_json: '{}' },
  { rule_key: 'village_errors', rule_name: '村组不存在', enabled: 1, threshold_json: '{}' },
  { rule_key: 'duplicate_errors', rule_name: '重复身份证', enabled: 1, threshold_json: '{}' },
  { rule_key: 'gender_mismatch', rule_name: '性别不符', enabled: 1, threshold_json: '{}' },
  { rule_key: 'error_library_hits', rule_name: '错误库命中', enabled: 1, threshold_json: '{}' },
  { rule_key: 'area_anomalies', rule_name: '面积异常', enabled: 1, threshold_json: '{"ratio":1.1}' },
  { rule_key: 'area_missing', rule_name: '承包面积缺失', enabled: 1, threshold_json: '{}' },
  { rule_key: 'age_anomaly', rule_name: '年龄异常', enabled: 0, threshold_json: '{"min":16,"max":100}' },
  { rule_key: 'deceased_farmers', rule_name: '死亡农户', enabled: 1, threshold_json: '{}' },
  { rule_key: 'restricted_farmers', rule_name: '受限身份农户', enabled: 1, threshold_json: '{}' },
  { rule_key: 'household_duplicates', rule_name: '同一家庭多成员', enabled: 1, threshold_json: '{}' },
  { rule_key: 'new_farmers', rule_name: '新增农户', enabled: 1, threshold_json: '{}' },
  { rule_key: 'removed_farmers', rule_name: '减少农户', enabled: 1, threshold_json: '{}' },
  { rule_key: 'changed_farmers', rule_name: '字段变更', enabled: 1, threshold_json: '{}' },
]

function loadRules(): { rule_key: string; rule_name: string; enabled: number; threshold_json: string }[] {
  try {
    const rows = getDb().allRaw<{ rule_key: string; rule_name: string; enabled: number; threshold_json: string }>(
      'SELECT rule_key, rule_name, enabled, threshold_json FROM precheck_rule_config WHERE enabled=1 ORDER BY sort_order'
    )
    return rows.length > 0 ? rows : DEFAULT_RULES.filter(r => r.enabled)
  } catch { return DEFAULT_RULES.filter(r => r.enabled) }
}

function getThreshold(rules: { rule_key: string; threshold_json: string }[], key: string): Record<string, number> {
  const r = rules.find(r => r.rule_key === key)
  if (!r) return {}
  try { return JSON.parse(r.threshold_json) } catch { return {} }
}

function isEnabled(rules: { rule_key: string }[], key: string): boolean {
  return rules.some(r => r.rule_key === key)
}

type RuleSet = ReturnType<typeof loadRules>

// ── 校验身份证 ──
function validateIdCard(idCard: string): string[] {
  const errors: string[] = []
  if (!idCard) return errors
  if (idCard.length !== 18) { errors.push('身份证号长度必须为18位'); return errors }
  const factors = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = idCard.slice(0, 17).split('').reduce((s, c, i) => s + parseInt(c) * factors[i], 0)
  if (checkCodes[sum % 11] !== idCard[17].toUpperCase()) {
    errors.push('身份证校验码不正确')
  }
  return errors
}

function getAge(idCard: string): number | null {
  if (!idCard || idCard.length < 14) return null
  const birthYear = parseInt(idCard.slice(6, 10))
  return isNaN(birthYear) ? null : new Date().getFullYear() - birthYear
}

function idCardGender(idCard: string): number | null {
  if (!idCard || idCard.length < 17) return null
  const d = parseInt(idCard[16])
  return isNaN(d) ? null : (d % 2 === 1 ? 1 : 2) // 1=男 2=女
}

// ═══════════════════════════════════════════

export function registerPrecheckHandlers(): void {
  const db = () => getDb()

  // ── 执行预检 ──
  ipcMain.handle('subsidies:precheck', (_e, params: any) => {
    try {
      const rules = loadRules()
      const { subsidy_type_id, year, pay_status, village_name } = params || {}
      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (subsidy_type_id) { where += ' AND sa.subsidy_type_id=?'; vals.push(subsidy_type_id) }
      if (year) { where += ' AND sa.apply_year=?'; vals.push(year) }
      if (pay_status != null && pay_status !== '') {
        const statusList = String(pay_status).split(',').map((s: string) => s.trim()).filter(Boolean)
        if (statusList.length > 0) {
          where += ` AND sa.pay_status IN (${statusList.map(() => '?').join(',')})`
          statusList.forEach((s: string) => vals.push(Number(s)))
        }
      }
      if (village_name) { where += ' AND sa.apply_village_name=?'; vals.push(village_name) }

      const rows = db().allRaw<Record<string, any>>(`
        SELECT sa.*, fp.real_name as farmer_name, fp.id_card, fp.gender, fp.farmer_status,
               fp.phone, fp.bank_card, fp.bank_name,
               st.subsidy_name, st.calc_mode, st.standard_amount,
               hh.id as hh_id, hh.household_name, hh.contract_area as hh_contract_area,
               hh.confirmed_area,
               v.village_name, hh.group_no
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.beneficiary_id=fp.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id=st.id
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        ${where} ORDER BY sa.id
      `, ...vals)

      const totalRows = rows.length
      const idCardMap = new Map<string, number[]>()
      const householdMap = new Map<number, { idx: number; name: string }[]>() // hh_id -> members

      // 结果容器
      const formatErrors: any[] = []
      const villageErrors: any[] = []
      const duplicateErrors: any[] = []
      const genderMismatches: any[] = []
      const errorLibHits: any[] = []
      const areaAnomalies: any[] = []
      const areaMissing: any[] = []
      const ageAnomalies: any[] = []
      const deceasedFarmers: any[] = []
      const restrictedFarmers: any[] = []
      const householdDuplicates: any[] = []

      // 遍历每行
      rows.forEach((r, idx) => {
        const rowNum = idx + 1
        const idCard = String(r.id_card || '')
        const name = r.farmer_name || ''
        const vname = r.apply_village_name || r.village_name || ''
        const gno = r.apply_group_display || r.group_no || ''

        // 格式错误
        if (isEnabled(rules, 'format_errors')) {
          const errs = validateIdCard(idCard)
          if (!name) errs.push('姓名为空')
          if (errs.length > 0) {
            formatErrors.push({ row: rowNum, name, id_card: idCard, village: vname, group: gno, errors: errs })
          }
        }

        // 村组不存在
        if (isEnabled(rules, 'village_errors') && vname && vname !== '未知') {
          const ve = db().getRaw<{ id: number }>('SELECT id FROM village WHERE village_name=?', vname)
          if (!ve) {
            villageErrors.push({ row: rowNum, name, id_card: idCard, village: vname, group: gno, error: `村「${vname}」在系统中不存在` })
          }
        }

        // 重复身份证 & 性别 & 年龄
        if (idCard) {
          if (isEnabled(rules, 'duplicate_errors')) {
            if (!idCardMap.has(idCard)) idCardMap.set(idCard, [])
            idCardMap.get(idCard)!.push(rowNum)
          }

          if (isEnabled(rules, 'gender_mismatch')) {
            const idG = idCardGender(idCard)
            const dbG = r.gender != null ? Number(r.gender) : null
            if (idG !== null && dbG !== null && idG !== dbG) {
              genderMismatches.push({
                row: rowNum, name, id_card: idCard, village: vname, group: gno,
                excel_gender: idG === 1 ? '男' : '女',
                id_card_gender: dbG === 1 ? '男' : '女',
              })
            }
          }

          if (isEnabled(rules, 'age_anomaly')) {
            const t = getThreshold(rules, 'age_anomaly')
            const age = getAge(idCard)
            if (age !== null && (age < (t.min || 16) || age > (t.max || 100))) {
              ageAnomalies.push({
                row: rowNum, name, id_card: idCard, village: vname, group: gno,
                age, birth_year: parseInt(idCard.slice(6,10)),
                error: age < 0 ? '出生年份异常' : `年龄 ${age} 岁超出合理范围`,
              })
            }
          }
        }

        // 死亡/受限农户
        if (isEnabled(rules, 'deceased_farmers') && Number(r.farmer_status) === 4) {
          deceasedFarmers.push({
            row: rowNum, name, id_card: idCard, village: vname, group: gno,
            death_date: '', error: '该农户已标记为离世状态'
          })
        }
        if (isEnabled(rules, 'restricted_farmers') && Number(r.farmer_status) === 3) {
          restrictedFarmers.push({
            row: rowNum, name, id_card: idCard, village: vname, group: gno,
            error: '农户状态为迁出，可能不应享受补贴'
          })
        }

        // 面积异常 + 缺失
        if (isEnabled(rules, 'area_anomalies') || isEnabled(rules, 'area_missing')) {
          const applyArea = Number(r.apply_area || 0)
          const contractArea = Math.max(
            Number(r.confirmed_area || 0),
            Number(r.contract_area || r.hh_contract_area || 0)
          )
          const trustArea = Number(r.trust_area || 0)
          const noSubsidyArea = Number(r.no_subsidy_area || 0)
          const referenceArea = contractArea + trustArea

          if (isEnabled(rules, 'area_anomalies') && applyArea > 0 && referenceArea > 0) {
            const t = getThreshold(rules, 'area_anomalies')
            const ratio = t.ratio || 1.1
            if (applyArea > referenceArea * ratio) {
              areaAnomalies.push({
                row: rowNum, name, id_card: idCard, village: vname, group: gno,
                anomaly_type: '面积超额',
                anomaly_details: `申报面积${applyArea.toFixed(2)}亩超出参考面积${referenceArea.toFixed(2)}亩(${Math.round(ratio*100)}%)`,
                contract_area: contractArea, trust_out_area: trustArea, trust_in_area: 0,
                no_subsidy_area: noSubsidyArea, actual_subsidy_area: applyArea,
                self_occupy: 0, hh_used: 0, hh_total: 0, db_contract_area: contractArea,
                reference_area: referenceArea, area_source: '承包+代耕',
                exceed_amount: Math.round((applyArea - referenceArea) * 100) / 100,
              })
            }
          }

          if (isEnabled(rules, 'area_missing') && applyArea === 0 && (contractArea > 0 || trustArea > 0)) {
            areaMissing.push({
              row: rowNum, name, id_card: idCard, village: vname, group: gno,
              contract_area: contractArea,
              error: '有承包地/代耕面积但没有申报面积'
            })
          }
        }

        // 同一家庭多成员
        if (isEnabled(rules, 'household_duplicates') && r.hh_id) {
          if (!householdMap.has(r.hh_id)) householdMap.set(r.hh_id, [])
          householdMap.get(r.hh_id)!.push({ idx, name })
        }
      })

      // 生成重复身份证结果
      if (isEnabled(rules, 'duplicate_errors')) {
        for (const [idCard, indices] of idCardMap) {
          if (indices.length > 1) {
            const firstRow = rows[indices[0] - 1]
            duplicateErrors.push({
              row: indices[0], name: firstRow?.farmer_name || '', id_card: idCard,
              village: firstRow?.apply_village_name || firstRow?.village_name || '',
              group: firstRow?.apply_group_display || firstRow?.group_no || '',
              error: `同一身份证出现${indices.length}次（第${indices.join(', ')}行）`,
            })
          }
        }
      }

      // 生成同户多成员结果
      if (isEnabled(rules, 'household_duplicates')) {
        for (const [hhId, members] of householdMap) {
          if (members.length > 1) {
            const first = rows[members[0].idx]
            const otherNames = members.slice(1).map(m => rows[m.idx]?.farmer_name || '')
            householdDuplicates.push({
              row: members[0].idx + 1, name: first?.farmer_name || '',
              id_card: first?.id_card || '', village: first?.apply_village_name || first?.village_name || '',
              group: first?.apply_group_display || first?.group_no || '',
              household_id: hhId, total_count: members.length,
              other_members: otherNames,
              excel_remark: first?.remark || '', db_existing_apps: [],
            })
          }
        }
      }

      // 错误库命中
      if (isEnabled(rules, 'error_library_hits')) {
        const allIdCards = rows.map(r => String(r.id_card || '')).filter(Boolean)
        if (allIdCards.length > 0) {
          try {
            const errorLibRows = db().allRaw<any>(`
              SELECT el.* FROM error_library el WHERE el.id_card IN (${allIdCards.map(() => '?').join(',')})
            `, ...allIdCards)
            const byIdCard: Record<string, any[]> = {}
            errorLibRows.forEach((r: any) => {
              const ic = String(r.id_card || '')
              if (!byIdCard[ic]) byIdCard[ic] = []
              byIdCard[ic].push(r)
            })
            rows.forEach((r, idx) => {
              const ic = String(r.id_card || '')
              const hits = byIdCard[ic]
              if (hits) hits.forEach((h: any) => {
                errorLibHits.push({
                  row: idx + 1, name: r.farmer_name || '', id_card: ic,
                  village: r.apply_village_name || r.village_name || '',
                  group: r.apply_group_display || r.group_no || '',
                  error_type: h.error_type || '未知', error_reason: h.error_reason || h.remark || '',
                  source: h.source || '错误库',
                })
              })
            })
          } catch { /* error_library 表可能不存在 */ }
        }
      }

      // 新增/减少/变更农户（对比 Excel vs DB，需要传入对比数据源）
      const newFarmers: any[] = []
      const removedFarmers: any[] = []
      const changedFarmers: any[] = []

      if (isEnabled(rules, 'new_farmers') || isEnabled(rules, 'removed_farmers')) {
        const excelCards = rows.map(r => String(r.id_card || '')).filter(Boolean)
        if (excelCards.length > 0) {
          try {
            const dbFarmers = db().allRaw<{ id_card: string; real_name: string; farmer_status: number }>(
              `SELECT fp.id_card, fp.real_name, fp.farmer_status
               FROM farmer_profile fp WHERE fp.id_card IN (${excelCards.map(() => '?').join(',')})`,
              ...excelCards
            )
            const dbCards = new Set(dbFarmers.map(f => f.id_card))
            const excelSet = new Set(excelCards)

            // 新增
            if (isEnabled(rules, 'new_farmers')) {
              for (const ic of excelSet) {
                if (!dbCards.has(ic)) {
                  const r = rows.find(r => String(r.id_card || '') === ic)
                  if (r) newFarmers.push({
                    row: rows.indexOf(r) + 1, name: r.farmer_name || '', id_card: ic,
                    village: r.apply_village_name || r.village_name || '',
                    group: r.apply_group_display || r.group_no || '',
                  })
                }
              }
            }

            // 减少
            if (isEnabled(rules, 'removed_farmers')) {
              for (const f of dbFarmers) {
                if (!excelSet.has(f.id_card) && f.farmer_status !== 2) {
                  removedFarmers.push({
                    name: f.real_name, id_card: f.id_card,
                    village: '', group: '',
                    note: '数据库在册但本次Excel未出现'
                  })
                }
              }
            }
          } catch { /* farmer_profile 表可能不存在 */ }
        }
      }

      // 字段变更
      if (isEnabled(rules, 'changed_farmers')) {
        for (const r of rows) {
          const ic = String(r.id_card || '')
          if (!ic) continue
          try {
            const fp = db().getRaw<{ real_name: string; phone: string }>(
              'SELECT real_name, phone FROM farmer_profile WHERE id_card=?', ic
            )
            if (fp) {
              const changes: string[] = []
              if (fp.real_name && fp.real_name !== (r.farmer_name || '')) {
                changes.push(`姓名: "${fp.real_name}" → "${r.farmer_name}"`)
              }
              if (fp.phone && fp.phone !== String(r.phone || '')) {
                changes.push(`电话: "${fp.phone}" → "${r.phone || ''}"`)
              }
              if (changes.length > 0) {
                changedFarmers.push({
                  row: rows.indexOf(r) + 1, name: r.farmer_name || '', id_card: ic,
                  village: r.apply_village_name || r.village_name || '',
                  group: r.apply_group_display || r.group_no || '',
                  changes,
                })
              }
            }
          } catch { /* ignore */ }
        }
      }

      const errorCount = formatErrors.length + villageErrors.length + duplicateErrors.length +
        genderMismatches.length + errorLibHits.length + areaAnomalies.length +
        areaMissing.length + ageAnomalies.length + deceasedFarmers.length +
        restrictedFarmers.length + householdDuplicates.length +
        newFarmers.length + removedFarmers.length + changedFarmers.length

      return success({
        summary: {
          total_rows: totalRows, ok_rows: totalRows - errorCount, error_rows: errorCount,
          format_errors: formatErrors.length, village_errors: villageErrors.length,
          duplicate_errors: duplicateErrors.length, gender_mismatch: genderMismatches.length,
          error_library_hits: errorLibHits.length, area_anomalies: areaAnomalies.length,
          area_missing: areaMissing.length, age_anomaly: ageAnomalies.length,
          deceased_farmers: deceasedFarmers.length, restricted_farmers: restrictedFarmers.length,
          household_duplicates: householdDuplicates.length,
          new_farmers: newFarmers.length, removed_farmers: removedFarmers.length,
          changed_farmers: changedFarmers.length,
          pass_rate: totalRows > 0 ? Math.round((totalRows - errorCount) / totalRows * 100) : 100,
        },
        format_errors: formatErrors, village_errors: villageErrors,
        duplicate_errors: duplicateErrors, gender_mismatch: genderMismatches,
        error_library_hits: errorLibHits, area_anomalies: areaAnomalies,
        area_missing: areaMissing, age_anomaly: ageAnomalies,
        deceased_farmers: deceasedFarmers, restricted_farmers: restrictedFarmers,
        household_duplicates: householdDuplicates,
        new_farmers: newFarmers, removed_farmers: removedFarmers,
        changed_farmers: changedFarmers,
      })
    } catch (e) { return errorResponse('预检失败') }
  })

  // ── 预检规则配置 CRUD ──
  ipcMain.handle('precheck:listRules', () => {
    try {
      const rows = db().allRaw('SELECT * FROM precheck_rule_config ORDER BY sort_order')
      return success(rows)
    } catch { return success(DEFAULT_RULES) }
  })

  ipcMain.handle('precheck:saveRules', (_e, rules: any[]) => {
    try {
      for (const r of rules) {
        db().runRaw(
          `UPDATE precheck_rule_config SET enabled=?, threshold_json=?, rule_name=?, description=?
           WHERE rule_key=?`,
          r.enabled ? 1 : 0, r.threshold_json || '{}', r.rule_name || '', r.description || '', r.rule_key
        )
      }
      return success({ message: '已保存' })
    } catch (e) { return errorResponse('保存失败') }
  })

  ipcMain.handle('precheck:resetRules', () => {
    try {
      db().runRaw('DELETE FROM precheck_rule_config')
      for (const r of DEFAULT_RULES) {
        db().runRaw(
          `INSERT OR IGNORE INTO precheck_rule_config (rule_key, rule_name, description, enabled, threshold_json, sort_order)
           VALUES (?,?,?,?,?,?)`,
          r.rule_key, r.rule_name, '', r.enabled, r.threshold_json, DEFAULT_RULES.indexOf(r) + 1
        )
      }
      return success({ message: '已恢复默认' })
    } catch (e) { return errorResponse('重置失败') }
  })

  // ═══════ 保存预检记录（事务批处理） ═══════
  ipcMain.handle('precheck:saveRecord', (_e, payload: any) => {
    try {
      const { subsidy_type_id, year, items } = payload
      if (!Array.isArray(items) || items.length === 0) return errorResponse('无预检结果数据')

      const batchKey = `precheck_${subsidy_type_id}_${year}_${new Date().toISOString().slice(0, 16).replace('T', '_')}`
      let saved = 0

      db().beginTransaction()
      try {
        for (const item of items) {
          db().runRaw(
            `INSERT INTO precheck_record (subsidy_type_id, apply_year, batch_key, error_type, farmer_name, id_card, village, group_no, error_message)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            subsidy_type_id || 0, year || 0, batchKey,
            String(item.error_type || ''),
            String(item.farmer_name || ''),
            String(item.id_card || ''),
            String(item.village || ''),
            String(item.group_no || ''),
            String(item.error_message || '')
          )
          saved++
        }
      } finally {
        db().commitTransaction()
      }

      console.log(`[precheck] 保存记录: ${saved} 条, 批次: ${batchKey}`)
      return success({ saved, batch_key: batchKey })
    } catch (e) {
      console.error('[precheck] 保存记录失败:', e)
      return errorResponse('保存失败: ' + String(e).slice(0, 100))
    }
  })

  // ── 批次列表 ──
  ipcMain.handle('precheck:listBatches', (_e, payload: any = {}) => {
    try {
      const { subsidy_type_id, year } = payload || {}
      let where = 'WHERE 1=1'
      const vals: unknown[] = []
      if (subsidy_type_id) { where += ' AND subsidy_type_id=?'; vals.push(subsidy_type_id) }
      if (year) { where += ' AND apply_year=?'; vals.push(year) }
      const rows = db().allRaw<any>(
        `SELECT batch_key,
                COUNT(*) as total,
                SUM(CASE WHEN status='fixed' THEN 1 ELSE 0 END) as fixed_count,
                MAX(created_at) as created_at
         FROM precheck_record ${where}
         GROUP BY batch_key ORDER BY created_at DESC`, ...vals
      )
      return success({ batches: rows })
    } catch { return success({ batches: [] }) }
  })

  // ── 某批次的记录列表 ──
  ipcMain.handle('precheck:listRecords', (_e, params: any = {}) => {
    try {
      const { batch_key, status, error_type, page, page_size } = params || {}
      let where = batch_key ? 'WHERE batch_key=?' : 'WHERE 1=1'
      const vals: unknown[] = batch_key ? [batch_key] : []
      if (status) { where += ' AND status=?'; vals.push(status) }
      if (error_type) { where += ' AND error_type=?'; vals.push(error_type) }
      const pg = Math.max(1, Number(page || 1))
      const ps = Math.min(200, Math.max(1, Number(page_size || 50)))
      const offset = (pg - 1) * ps

      const cnt = db().getRaw<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM precheck_record ${where}`, ...vals
      )
      const rows = db().allRaw(
        `SELECT * FROM precheck_record ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
        ...vals, ps, offset
      )
      return success({ items: rows, total: cnt?.cnt ?? 0, page: pg, page_size: ps })
    } catch { return success({ items: [], total: 0, page: 1, page_size: 50 }) }
  })

  // ── 切换单条状态 open ↔ fixed ──
  ipcMain.handle('precheck:toggleRecord', (_e, id: number) => {
    try {
      const row = db().getRaw<{ status: string }>('SELECT status FROM precheck_record WHERE id=?', id)
      if (!row) return errorResponse('记录不存在')
      const newStatus = row.status === 'fixed' ? 'open' : 'fixed'
      const fixedAt = newStatus === 'fixed' ? new Date().toISOString().slice(0, 19) : null
      db().runRaw(
        `UPDATE precheck_record SET status=?, fixed_at=? WHERE id=?`,
        newStatus, fixedAt, id
      )
      return success({ status: newStatus })
    } catch { return errorResponse('操作失败') }
  })

  // ── 删除单条 ──
  ipcMain.handle('precheck:deleteRecord', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM precheck_record WHERE id=?', id)
      return success(null)
    } catch { return errorResponse('删除失败') }
  })

  // ── 自动比对（事务批处理） ──
  ipcMain.handle('precheck:autoResolve', (_e, payload: any) => {
    try {
      const { subsidy_type_id, year } = payload || {}

      // 查当前数据中的身份证号
      let currentCards: string[] = []
      try {
        const rows = db().allRaw<{ id_card: string }>(
          `SELECT DISTINCT fp.id_card FROM subsidy_application sa
           JOIN farmer_profile fp ON sa.beneficiary_id = fp.id
           WHERE sa.subsidy_type_id=? AND sa.apply_year=? AND fp.id_card IS NOT NULL`,
          subsidy_type_id, year
        )
        currentCards = rows.map(r => r.id_card).filter(Boolean)
      } catch { /* ignore */ }

      // 查项目下所有 open 记录
      const openRecords = db().allRaw<{ id: number; id_card: string }>(
        `SELECT id, id_card FROM precheck_record
         WHERE subsidy_type_id=? AND apply_year=? AND status='open'`,
        subsidy_type_id, year
      )

      if (currentCards.length === 0 || openRecords.length === 0) {
        return success({ resolved_count: 0, total: openRecords.length })
      }

      const cardSet = new Set(currentCards)
      let fixed = 0

      db().beginTransaction()
      try {
        const now = new Date().toISOString().slice(0, 19)
        for (const r of openRecords) {
          if (r.id_card && !cardSet.has(r.id_card)) {
            db().runRaw(
              `UPDATE precheck_record SET status='fixed', fixed_at=? WHERE id=?`,
              now, r.id
            )
            fixed++
          }
        }
      } finally {
        db().commitTransaction()
      }

      console.log(`[precheck] 自动比对: ${fixed}/${openRecords.length} 条已自动修正`)
      return success({ resolved_count: fixed, total: openRecords.length })
    } catch { return errorResponse('自动比对失败') }
  })
}
