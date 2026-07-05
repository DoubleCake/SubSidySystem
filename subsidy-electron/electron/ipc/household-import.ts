import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { parseGroupNoToInt, formatGroupNo } from '../utils/format'
import { validateIdCard } from '../utils/id-card'
import { success, errorResponse } from './response'

/**
 * 家庭户批量导入 — 完整实现
 * 对应 Python 版 routers/household_import.py (feat/household-import-village-group)
 *
 * 功能：
 * 1. 按 household_code 或 家庭住址 分组
 * 2. 身份证匹配已有家庭户（0个→新建, 1个→并入, N个→合并）
 * 3. 支持 Excel 中指定 village_name/group_no
 * 4. 支持全局 default_village_name/default_group_no
 * 5. 所有变更写入 HouseholdEvent
 */

export function registerHouseholdImportHandlers(): void {
  const db = () => getDb()

  // ── 预览 ──
  ipcMain.handle('household-import:preview', (_e, payload: any) => {
    try {
      const rows = payload as Record<string, unknown>[]
      if (!rows || rows.length === 0) {
        return errorResponse('没有可导入的数据')
      }

      // ── 预加载 DB 数据 ──
      const allFarmers = new Map<string, Record<string, unknown>>()
      for (const f of db().allRaw<Record<string, unknown>>('SELECT * FROM farmer_profile')) {
        allFarmers.set(f.id_card as string, f)
      }
      const allHouseholds = new Map<number, Record<string, unknown>>()
      for (const h of db().allRaw<Record<string, unknown>>('SELECT * FROM family_household WHERE status = 1')) {
        allHouseholds.set(h.id as number, h)
      }
      const villageMap = new Map<number, string>()
      for (const v of db().allRaw<Record<string, unknown>>('SELECT id, village_name FROM village')) {
        villageMap.set(v.id as number, v.village_name as string)
      }

      // ── 逐行解析 ──
      const parsed: Record<string, unknown>[] = []
      const rowErrors: { row: number; name: string; errors: string[] }[] = []

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx]
        const name = String(row.real_name || '').trim()
        const idCard = String(row.id_card || '').trim().toUpperCase()
        const address = String(row.address || '').trim()
        const relation = String(row.head_relation || '').trim()
        const householdCode = String(row.household_code || '').trim()
        const farmerStatus = String(row.farmer_status || '').trim()
        const rawVillage = String(row.village_name || '').trim()
        const rawGroup = String(row.group_no || '').trim()

        const errs: string[] = []
        if (!name) errs.push('姓名为空')
        if (!idCard) errs.push('身份证号为空')
        else {
          const [ok, msg] = validateIdCard(idCard)
          if (!ok) errs.push(`身份证格式错误: ${msg}`)
        }
        if (!address && !householdCode) errs.push('家庭住址和家庭编码均为空')

        if (errs.length > 0) {
          rowErrors.push({ row: idx + 1, name, errors: errs })
        }

        parsed.push({
          real_name: name,
          id_card: idCard,
          address,
          head_relation: relation,
          is_head: relation.includes('户主'),
          phone: row.phone || null,
          bank_card: row.bank_card || null,
          bank_name: row.bank_name || null,
          gender: resolveGender(idCard, String(row.gender || '')),
          household_code: householdCode,
          farmer_status: farmerStatus,
          village_name: rawVillage,
          group_no: rawGroup,
          has_errors: errs.length > 0,
        })
      }

      // ── 分组 ──
      const groupsMap = new Map<string, Record<string, unknown>[]>()
      const groupsMeta = new Map<string, { household_code: string }>()

      for (const p of parsed) {
        const code = (p.household_code as string) || ''
        if (code) {
          const key = `CODE:${code}`
          if (!groupsMap.has(key)) groupsMap.set(key, [])
          groupsMap.get(key)!.push(p)
          groupsMeta.set(key, { household_code: code })
        } else if (p.address) {
          const key = `ADDR:${p.address}`
          if (!groupsMap.has(key)) groupsMap.set(key, [])
          groupsMap.get(key)!.push(p)
          groupsMeta.set(key, { household_code: '' })
        }
      }

      // ── 分析每组 ──
      const previewGroups: Record<string, unknown>[] = []
      const conflicts: Record<string, unknown>[] = []

      for (const [key, members] of groupsMap) {
        const meta = groupsMeta.get(key)!
        const displayKey = key.replace(/^(CODE:|ADDR:)/, '')

        // 找户主
        const heads = members.filter(m => m.is_head)
        const warnings: string[] = []
        let head: Record<string, unknown>
        if (heads.length === 0) {
          warnings.push('未找到户主标记，将以第一个成员作为户主')
          head = members[0]
        } else if (heads.length > 1) {
          warnings.push(`存在 ${heads.length} 个户主标记，将以第一个作为户主`)
          head = heads[0]
        } else {
          head = heads[0]
        }

        // 用成员身份证匹配 DB
        const matchedHhIds = new Set<number>()
        const memberDbInfo: Record<string, unknown>[] = []
        for (const m of members) {
          const existingFarmer = allFarmers.get(m.id_card as string)
          if (existingFarmer) {
            matchedHhIds.add(existingFarmer.household_id as number)
            const hh = allHouseholds.get(existingFarmer.household_id as number)
            memberDbInfo.push({
              id_card: m.id_card,
              farmer_id: existingFarmer.id,
              household_id: existingFarmer.household_id,
              village_id: hh?.village_id || null,
              group_no: hh?.group_no || null,
            })
          }
        }

        // household_code 匹配 DB
        let codeMatchedHh: Record<string, unknown> | null = null
        if (meta.household_code) {
          codeMatchedHh = db().getRaw<Record<string, unknown>>(
            'SELECT * FROM family_household WHERE household_code = ? AND status = 1',
            meta.household_code
          )
          if (codeMatchedHh) {
            matchedHhIds.add(codeMatchedHh.id as number)
            if (!allHouseholds.has(codeMatchedHh.id as number)) {
              allHouseholds.set(codeMatchedHh.id as number, codeMatchedHh)
            }
          }
        }

        // 确定目标村组
        let targetVillageId: number | null = null
        let targetGroupNo = 1
        const inputVillage = String(head.village_name || '').trim()
        const inputGroup = String(head.group_no || '').trim()

        if (inputVillage) {
          let v = db().getRaw<Record<string, unknown>>(
            'SELECT id FROM village WHERE village_name = ?', inputVillage
          )
          if (!v) {
            const r = db().runRaw('INSERT INTO village (village_name) VALUES (?)', inputVillage)
            v = { id: r.lastInsertRowid }
          }
          targetVillageId = v.id as number
        }
        if (inputGroup) {
          targetGroupNo = parseGroupNoToInt(inputGroup)
        } else if (!inputVillage) {
          // 无导入村组信息：从已有记录推断
          const headExisting = allFarmers.get(head.id_card as string)
          if (headExisting) {
            const hh = allHouseholds.get(headExisting.household_id as number)
            if (hh) {
              targetVillageId = targetVillageId || (hh.village_id as number)
              targetGroupNo = (hh.group_no as number) || targetGroupNo
            }
          }
          if (!targetVillageId && memberDbInfo.length > 0) {
            targetVillageId = memberDbInfo[0].village_id as number
            targetGroupNo = (memberDbInfo[0].group_no as number) || 1
          }
          if (!targetVillageId && codeMatchedHh) {
            targetVillageId = codeMatchedHh.village_id as number
            targetGroupNo = (codeMatchedHh.group_no as number) || 1
          }
        }

        // 合并场景判断
        const matchedList = [...matchedHhIds]
        let action: string
        if (matchedList.length === 0) {
          action = 'create'
        } else if (matchedList.length === 1) {
          action = 'merge_one'
        } else {
          action = 'merge_multi'
          warnings.push(`涉及 ${matchedList.length} 个已有家庭户，将执行合并`)
        }

        // 合并后面积
        const areaValues = matchedList
          .map(hid => allHouseholds.get(hid))
          .filter(Boolean)
          .map(hh => Number(hh!.contract_area))
          .filter(v => v > 0)
        const totalArea = areaValues.length > 0
          ? Math.round(areaValues.reduce((a, b) => a + b, 0) / areaValues.length * 100) / 100
          : null

        const matchedHhInfo = matchedList
          .map(hid => allHouseholds.get(hid))
          .filter(Boolean)
          .map(hh => ({
            id: hh!.id,
            household_code: hh!.household_code,
            household_name: hh!.household_name,
            village_name: villageMap.get(hh!.village_id as number) || '',
            group_display: formatGroupNo(hh!.group_no as number),
            contract_area: hh!.contract_area ? Number(hh!.contract_area) : null,
          }))

        previewGroups.push({
          address: displayKey,
          household_code: meta.household_code || null,
          action,
          head_name: head.real_name,
          head_id_card: head.id_card,
          member_count: members.length,
          members: members.map(m => ({
            real_name: m.real_name,
            id_card: m.id_card,
            is_head: m.is_head,
            in_db: allFarmers.has(m.id_card as string),
            has_errors: m.has_errors,
          })),
          matched_hh_info: matchedHhInfo,
          target_village_name: targetVillageId ? villageMap.get(targetVillageId) || '' : '',
          target_group_display: formatGroupNo(targetGroupNo),
          total_area_after_merge: totalArea,
          warnings,
          has_errors: members.some(m => m.has_errors),
        })
      }

      // 冲突明细
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx]
        const ic = String(row.id_card || '').trim().toUpperCase()
        if (ic && allFarmers.has(ic)) {
          const existing = allFarmers.get(ic)!
          conflicts.push({
            row: idx + 1,
            real_name: row.real_name,
            id_card: ic.substring(0, 6) + '****' + ic.substring(ic.length - 4),
            village_name: row.village_name || '',
            group_no: row.group_no || '',
            phone: row.phone || '',
            db_name: existing.real_name,
            db_household_id: existing.household_id,
          })
        }
      }

      const actionCounts: Record<string, number> = { create: 0, merge_one: 0, merge_multi: 0 }
      for (const g of previewGroups) {
        const act = g.action as string
        actionCounts[act] = (actionCounts[act] || 0) + 1
      }

      return success({
        groups: previewGroups,
        row_errors: rowErrors,
        conflicts,
        summary: {
          total_rows: rows.length,
          total_groups: groupsMap.size,
          new_households: actionCounts.create,
          merge_single: actionCounts.merge_one,
          merge_multi: actionCounts.merge_multi,
          error_rows: rowErrors.length,
        },
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 执行导入 ──
  ipcMain.handle('household-import:execute', (_e, payload: any) => {
    try {
      const rowsData = payload.rows as Record<string, unknown>[]
      if (!rowsData || rowsData.length === 0) {
        return errorResponse('没有可导入的数据')
      }

      const defaultVillage = String(payload.default_village_name || '').trim()
      const defaultGroup = String(payload.default_group_no || '').trim()

      // 应用全局默认村组
      const rows = rowsData.map(r => ({ ...r }))
      if (defaultVillage || defaultGroup) {
        for (const row of rows) {
          if (defaultVillage && !row.village_name) row.village_name = defaultVillage
          if (defaultGroup && !row.group_no) row.group_no = defaultGroup
        }
      }

      // ── 预加载 DB ──
      const allFarmers = new Map<string, Record<string, unknown>>()
      for (const f of db().allRaw<Record<string, unknown>>('SELECT * FROM farmer_profile')) {
        allFarmers.set(f.id_card as string, f)
      }
      const allHouseholds = new Map<number, Record<string, unknown>>()
      for (const h of db().allRaw<Record<string, unknown>>('SELECT * FROM family_household WHERE status = 1')) {
        allHouseholds.set(h.id as number, h)
      }

      // ── 解析 + 分组（复用预览的分析逻辑） ──
      const parsed: Record<string, unknown>[] = []
      const rowErrors: { row: number; name: string; errors: string[] }[] = []

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx]
        const name = String(row.real_name || '').trim()
        const idCard = String(row.id_card || '').trim().toUpperCase()
        const address = String(row.address || '').trim()
        const relation = String(row.head_relation || '').trim()
        const householdCode = String(row.household_code || '').trim()
        const farmerStatus = String(row.farmer_status || '').trim()
        const rawVillage = String(row.village_name || '').trim()
        const rawGroup = String(row.group_no || '').trim()

        const errs: string[] = []
        if (!name) errs.push('姓名为空')
        if (!idCard) errs.push('身份证号为空')
        else {
          const [ok, msg] = validateIdCard(idCard)
          if (!ok) errs.push(`身份证格式错误: ${msg}`)
        }
        if (!address && !householdCode) errs.push('家庭住址和家庭编码均为空')

        if (errs.length > 0) {
          rowErrors.push({ row: idx + 1, name, errors: errs })
        }

        parsed.push({
          real_name: name,
          id_card: idCard,
          address,
          head_relation: relation,
          is_head: relation.includes('户主'),
          phone: row.phone || null,
          bank_card: row.bank_card || null,
          bank_name: row.bank_name || null,
          gender: resolveGender(idCard, String(row.gender || '')),
          household_code: householdCode,
          farmer_status: farmerStatus,
          village_name: rawVillage,
          group_no: rawGroup,
          has_errors: errs.length > 0,
        })
      }

      // ── 分组 ──
      const groupsMap = new Map<string, Record<string, unknown>[]>()
      for (const p of parsed) {
        const code = (p.household_code as string) || ''
        const key = code ? `CODE:${code}` : `ADDR:${(p.address as string) || ''}`
        if (!groupsMap.has(key)) groupsMap.set(key, [])
        groupsMap.get(key)!.push(p)
      }

      // ── 执行导入 ──
      const now = new Date()
      const yearNow = now.getFullYear()
      const dateStr = now.toISOString().split('T')[0]

      let createdHh = 0, mergedHh = 0, createdFarmers = 0, skippedFarmers = 0
      const importErrors: string[] = [
        ...rowErrors.map(e => `第${e.row}行(${e.name}): ${e.errors.join('; ')}`),
      ]

      for (const [key, members] of groupsMap) {
        const displayKey = key.replace(/^(CODE:|ADDR:)/, '')

        // 有错误行的组跳过
        if (members.some(m => m.has_errors)) {
          importErrors.push(`地址「${displayKey}」存在格式错误行，该组已跳过`)
          continue
        }

        const heads = members.filter(m => m.is_head)
        const head: Record<string, unknown> = heads.length > 0 ? heads[0] : members[0]

        // 匹配已有家庭户
        const matchedHhIds = new Set<number>()
        for (const m of members) {
          const existing = allFarmers.get(m.id_card as string)
          if (existing) matchedHhIds.add(existing.household_id as number)
        }

        const matchedList = [...matchedHhIds]
        let action: string
        if (matchedList.length === 0) action = 'create'
        else if (matchedList.length === 1) action = 'merge_one'
        else action = 'merge_multi'

        // 确定目标村组
        let villageId: number | null = null
        let groupNo = 1
        const inputVillage = String(head.village_name || '').trim()
        const inputGroup = String(head.group_no || '').trim()

        if (inputVillage) {
          let v = db().getRaw<Record<string, unknown>>('SELECT id FROM village WHERE village_name = ?', inputVillage)
          if (!v) {
            const r = db().runRaw('INSERT INTO village (village_name) VALUES (?)', inputVillage)
            v = { id: r.lastInsertRowid }
          }
          villageId = v.id as number
        }
        if (inputGroup) {
          groupNo = parseGroupNoToInt(inputGroup)
        } else if (!inputVillage) {
          const headExisting = allFarmers.get(head.id_card as string)
          if (headExisting) {
            const hh = allHouseholds.get(headExisting.household_id as number)
            if (hh) { villageId = hh.village_id as number; groupNo = (hh.group_no as number) || 1 }
          }
        }

        // 确保有村
        if (!villageId) {
          let pending = db().getRaw<Record<string, unknown>>("SELECT id FROM village WHERE village_name = '待分配'")
          if (!pending) {
            const r = db().runRaw("INSERT INTO village (village_name) VALUES ('待分配')")
            pending = { id: r.lastInsertRowid }
          }
          villageId = pending.id as number
        }

        let targetHhId: number

        if (action === 'create') {
          // 新建家庭户（暂用占位编码，户主建好后再更新）
          const r = db().runRaw(
            `INSERT INTO family_household (household_code, household_name, head_farmer_id, village_id, group_no, registered_address, status, remark)
             VALUES ('', ?, NULL, ?, ?, ?, 1, '批量导入')`,
            `${head.real_name}户`, villageId, groupNo, displayKey
          )
          targetHhId = r.lastInsertRowid

          db().runRaw(
            `INSERT INTO household_event (household_id, event_type, event_year, event_date, description, operator)
             VALUES (?, 'FOUND', ?, ?, ?, '批量导入')`,
            targetHhId, yearNow, dateStr, `批量导入建档，来源住址：${displayKey}`
          )
          createdHh++
        } else if (action === 'merge_one') {
          targetHhId = matchedList[0]
          const hh = allHouseholds.get(targetHhId)!
          if (!hh.registered_address) {
            db().runRaw("UPDATE family_household SET registered_address = ?, updated_at = datetime('now','localtime') WHERE id = ?", displayKey, targetHhId)
          }
          db().runRaw(
            `INSERT INTO household_event (household_id, event_type, event_year, event_date, description, operator)
             VALUES (?, 'MEMBER_ADD', ?, ?, ?, '批量导入')`,
            targetHhId, yearNow, dateStr, `批量导入：并入来自住址「${displayKey}」的成员`
          )
          mergedHh++
        } else {
          // merge_multi：保留户主所在户或最大户
          const headExisting = allFarmers.get(head.id_card as string)
          let keepId: number
          if (headExisting && matchedList.includes(headExisting.household_id as number)) {
            keepId = headExisting.household_id as number
          } else {
            keepId = matchedList.reduce((a, b) => {
              const countA = [...allFarmers.values()].filter(f => f.household_id === a).length
              const countB = [...allFarmers.values()].filter(f => f.household_id === b).length
              return countA >= countB ? a : b
            })
          }

          targetHhId = keepId
          const targetHh = allHouseholds.get(targetHhId)!
          if (!targetHh.registered_address) {
            db().runRaw("UPDATE family_household SET registered_address = ?, updated_at = datetime('now','localtime') WHERE id = ?", displayKey, targetHhId)
          }

          // 面积取均值
          const areaVals = matchedList
            .map(hid => allHouseholds.get(hid))
            .filter(Boolean)
            .map(h => Number(h!.contract_area))
            .filter(v => v > 0)
          if (areaVals.length > 0) {
            const avg = Math.round(areaVals.reduce((a, b) => a + b, 0) / areaVals.length * 100) / 100
            db().runRaw("UPDATE family_household SET contract_area = ?, updated_at = datetime('now','localtime') WHERE id = ?", avg, targetHhId)
          }

          // 注销其他户
          const discardIds = matchedList.filter(hid => hid !== keepId)
          for (const discardId of discardIds) {
            db().runRaw("UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE household_id = ?", targetHhId, discardId)
            db().runRaw("UPDATE family_household SET status = 2, updated_at = datetime('now','localtime') WHERE id = ?", discardId)
            db().runRaw(
              `INSERT INTO household_event (household_id, related_hh_id, event_type, event_year, event_date, description, operator)
               VALUES (?, ?, 'MERGE', ?, ?, ?, '批量导入')`,
              discardId, targetHhId, yearNow, dateStr, `批量导入合并：并入 ${targetHh.household_code}（${targetHh.household_name}），本户注销`
            )
          }

          db().runRaw(
            `INSERT INTO household_event (household_id, event_type, event_year, event_date, description, operator)
             VALUES (?, 'MERGE', ?, ?, ?, '批量导入')`,
            targetHhId, yearNow, dateStr, `批量导入合并：吸收 ${discardIds.length} 个家庭户，来源住址：${displayKey}`
          )
          mergedHh++
        }

        // ── 添加/更新成员 ──
        let firstNewFarmerId: number | null = null

        for (const m of members) {
          if (allFarmers.has(m.id_card as string)) {
            // 已存在：覆盖更新
            const existing = allFarmers.get(m.id_card as string)!
            const updates: string[] = []
            const values: unknown[] = []

            updates.push("real_name = ?"); values.push(m.real_name)
            updates.push("gender = ?"); values.push(m.gender)
            updates.push("relation = ?"); values.push(m.is_head ? '户主' : (m.head_relation || '成员'))
            if (m.phone !== undefined) { updates.push("phone = ?"); values.push(m.phone) }
            if (m.bank_card !== undefined) { updates.push("bank_card = ?"); values.push(m.bank_card) }
            if (m.bank_name !== undefined) { updates.push("bank_name = ?"); values.push(m.bank_name) }
            updates.push("updated_at = datetime('now','localtime')")

            // farmer_status
            if (m.farmer_status) {
              updates.push("farmer_status = ?")
              values.push(mapFarmerStatus(m.farmer_status as string))
            }

            // merge 场景更新 household_id
            if (action !== 'create' && existing.household_id !== targetHhId) {
              updates.push("household_id = ?"); values.push(targetHhId)
            }

            db().runRaw(
              `UPDATE farmer_profile SET ${updates.join(', ')} WHERE id = ?`,
              ...values, existing.id
            )
            skippedFarmers++
            continue
          }

          // 新建成员
          const relation = m.is_head ? '户主' : (m.head_relation as string || '成员')
          const fs = m.farmer_status ? mapFarmerStatus(m.farmer_status as string) : 1

          const r = db().runRaw(
            `INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            targetHhId, m.real_name, m.gender, m.id_card,
            m.phone || null, m.bank_card || null, m.bank_name || null,
            relation, fs
          )
          const newFarmerId = r.lastInsertRowid
          if (!firstNewFarmerId) firstNewFarmerId = newFarmerId

          // 加入 allFarmers 缓存
          allFarmers.set(m.id_card as string, {
            id: newFarmerId, household_id: targetHhId,
            real_name: m.real_name, id_card: m.id_card,
          })
          createdFarmers++

          // 设置户主
          if (m.is_head) {
            const currentHead = db().getRaw<Record<string, unknown>>(
              'SELECT head_farmer_id FROM family_household WHERE id = ?', targetHhId
            )
            if (!currentHead?.head_farmer_id) {
              db().runRaw('UPDATE family_household SET head_farmer_id = ? WHERE id = ?', newFarmerId, targetHhId)
            } else if (action !== 'create') {
              const oldHeadId = currentHead.head_farmer_id
              db().runRaw('UPDATE family_household SET head_farmer_id = ? WHERE id = ?', newFarmerId, targetHhId)
              db().runRaw(
                `INSERT INTO household_event (household_id, event_type, farmer_id, farmer_name, event_year, event_date, description, operator)
                 VALUES (?, 'HEAD_CHANGE', ?, ?, ?, ?, ?, '批量导入')`,
                targetHhId, newFarmerId, m.real_name, yearNow, dateStr,
                `批量导入：户主变更（原户主ID:${oldHeadId} → ${m.real_name}）`
              )
            }
          }
        }

        // 新建户：若无人标为户主，用第一个成员
        if (action === 'create' && firstNewFarmerId) {
          const currentHead = db().getRaw<Record<string, unknown>>(
            'SELECT head_farmer_id FROM family_household WHERE id = ?', targetHhId
          )
          if (!currentHead?.head_farmer_id) {
            db().runRaw('UPDATE family_household SET head_farmer_id = ? WHERE id = ?', firstNewFarmerId, targetHhId)
          }

          // 用户主 farmer_id 生成正规 household_code
          const headId = currentHead?.head_farmer_id || firstNewFarmerId
          const code = `HH${String(headId).padStart(4, '0')}`
          db().runRaw("UPDATE family_household SET household_code = ?, updated_at = datetime('now','localtime') WHERE id = ?", code, targetHhId)
        }
      }

      return success({
        created_households: createdHh,
        merged_households: mergedHh,
        created_farmers: createdFarmers,
        skipped_farmers: skippedFarmers,
        errors: importErrors,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })
}

// ── 辅助函数 ──

function resolveGender(idCard: string, genderStr: string): number {
  if (genderStr) {
    return ['男', '1', 'male', 'M'].includes(genderStr.trim()) ? 1 : 2
  }
  if (idCard.length === 18) {
    return parseInt(idCard[16]) % 2 === 1 ? 1 : 2
  }
  return 1
}

function mapFarmerStatus(status: string): number {
  const lower = status.toLowerCase()
  const deadKeywords = ['死亡', '去世', 'deceased', 'dead']
  const movedKeywords = ['移居', '迁出', 'moved', '移出']
  const abroadKeywords = ['出国', 'overseas', 'abroad']
  const missingKeywords = ['失踪', 'missing']

  const allBad = [...deadKeywords, ...movedKeywords, ...abroadKeywords, ...missingKeywords]
  if (allBad.some(kw => lower.includes(kw))) return 0
  return 1
}
