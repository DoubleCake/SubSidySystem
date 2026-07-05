import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

export function registerHouseholdImportHandlers(): void {
  const db = () => getDb()

  // ── 预览 ──
  ipcMain.handle('household-import:preview', (_e, payload: any) => {
    try {
      const rows = payload as Record<string, unknown>[]
      if (!rows || rows.length === 0) {
        return errorResponse('没有可导入的数据')
      }

      // 按家庭户分组（使用 household_code 或 household_name）
      const groupMap = new Map<string, { rows: Record<string, unknown>[]; household_name: string }>()
      for (const row of rows) {
        const key = (row.household_code as string) || (row.household_name as string) || `__orphan__${groupMap.size}`
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            rows: [],
            household_name: (row.household_name as string) || key,
          })
        }
        groupMap.get(key)!.rows.push(row)
      }

      const groups: Record<string, unknown>[] = []
      const rowErrors: { row: number; message: string }[] = []
      let newHouseholds = 0
      let mergeSingle = 0
      let mergeMulti = 0
      let errorRows = 0

      let rowIndex = 0
      for (const [key, group] of groupMap) {
        rowIndex++
        try {
          // 检查该家庭户是否已存在
          const existing = db().getRaw<Record<string, unknown>>(
            'SELECT id, household_name FROM family_household WHERE household_name = ? OR household_code = ?',
            group.household_name, key
          )

          if (existing) {
            // 已存在：检查是否已有成员
            const memberCount = db().getRaw<{ cnt: number }>(
              'SELECT COUNT(*) as cnt FROM farmer_profile WHERE household_id = ?', existing.id
            )?.cnt ?? 0

            if (memberCount === 0) {
              mergeSingle++
            } else {
              mergeMulti++
            }

            groups.push({
              key,
              household_name: group.household_name,
              member_count: group.rows.length,
              existing_household_id: existing.id,
              existing_household_name: existing.household_name,
              status: 'merge',
              existing_member_count: memberCount,
            })
          } else {
            newHouseholds++
            groups.push({
              key,
              household_name: group.household_name,
              member_count: group.rows.length,
              status: 'new',
            })
          }
        } catch (e) {
          errorRows++
          rowErrors.push({ row: rowIndex, message: String(e) })
        }
      }

      return success({
        groups,
        row_errors: rowErrors,
        summary: {
          total_rows: rows.length,
          total_groups: groupMap.size,
          new_households: newHouseholds,
          merge_single: mergeSingle,
          merge_multi: mergeMulti,
          error_rows: errorRows,
        },
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 执行导入 ──
  ipcMain.handle('household-import:execute', (_e, payload: any) => {
    try {
      const rows = payload as Record<string, unknown>[]
      if (!rows || rows.length === 0) {
        return errorResponse('没有可导入的数据')
      }

      // 按家庭户分组
      const groupMap = new Map<string, { rows: Record<string, unknown>[]; household_name: string }>()
      for (const row of rows) {
        const key = (row.household_code as string) || (row.household_name as string) || `__orphan__${groupMap.size}`
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            rows: [],
            household_name: (row.household_name as string) || key,
          })
        }
        groupMap.get(key)!.rows.push(row)
      }

      let createdHouseholds = 0
      let mergedHouseholds = 0
      let createdFarmers = 0
      let skippedFarmers = 0
      const errors: { group: string; message: string }[] = []

      for (const [key, group] of groupMap) {
        try {
          let householdId: number

          // 查找或创建家庭户
          const existing = db().getRaw<Record<string, unknown>>(
            'SELECT id FROM family_household WHERE household_name = ? OR household_code = ?',
            group.household_name, key
          )

          if (existing) {
            householdId = existing.id as number
            mergedHouseholds++
          } else {
            const code = `HH_IMP_${Date.now()}_${createdHouseholds}`
            const villageId = group.rows[0]?.village_id || null
            const groupNo = group.rows[0]?.group_no || 1
            const address = group.rows[0]?.address || ''
            const contractArea = group.rows[0]?.contract_area || null
            const confirmedArea = group.rows[0]?.confirmed_area || null

            const result = db().runRaw(`
              INSERT INTO family_household (household_code, household_name, village_id, group_no, address, contract_area, confirmed_area, status, remark)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, '批量导入')
            `, code, group.household_name, villageId, groupNo, address, contractArea, confirmedArea)

            householdId = result.lastInsertRowid
            const newCode = `HH${String(householdId).padStart(4, '0')}`
            db().runRaw('UPDATE family_household SET household_code = ? WHERE id = ?', newCode, householdId)
            createdHouseholds++
          }

          // 导入成员
          for (const row of group.rows) {
            try {
              // 检查身份证是否已存在
              if (row.id_card) {
                const existingFarmer = db().getRaw<Record<string, unknown>>(
                  'SELECT id FROM farmer_profile WHERE id_card = ?', row.id_card
                )
                if (existingFarmer) {
                  // 更新该成员的 household_id
                  db().runRaw(
                    "UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE id = ?",
                    householdId, existingFarmer.id
                  )
                  skippedFarmers++
                  continue
                }
              }

              db().runRaw(`
                INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
              `,
                householdId,
                row.real_name || '',
                row.gender || 1,
                row.id_card || '',
                row.phone || null,
                row.bank_card || null,
                row.bank_name || null,
                row.relation || '成员'
              )
              createdFarmers++
            } catch (memberErr) {
              errors.push({ group: group.household_name, message: `成员导入失败: ${String(memberErr)}` })
            }
          }
        } catch (groupErr) {
          errors.push({ group: group.household_name, message: String(groupErr) })
        }
      }

      return success({
        created_households: createdHouseholds,
        merged_households: mergedHouseholds,
        created_farmers: createdFarmers,
        skipped_farmers: skippedFarmers,
        errors,
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })
}
