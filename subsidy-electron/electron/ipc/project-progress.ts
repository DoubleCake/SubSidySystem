import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'
import { readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'

export function registerProjectProgressHandlers(): void {
  const db = () => getDb()

  // ensure table
  try {
    db().runRaw(`
      CREATE TABLE IF NOT EXISTS project_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subsidy_type_id INTEGER NOT NULL,
        village_id INTEGER NOT NULL,
        village_name TEXT DEFAULT '',
        person_name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        stages TEXT DEFAULT '[]',
        note TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(subsidy_type_id, village_id)
      )
    `)
  } catch { /* ignore */ }

  // ── 获取某个项目的所有村进度 ──
  ipcMain.handle('project-progress:get', (_e, projectId: number) => {
    try {
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT * FROM project_progress WHERE subsidy_type_id = ? ORDER BY village_name
      `, projectId)

      const records = rows.map(r => ({
        ...r,
        stages: safeParse(r.stages as string, []),
      }))
      return success(records)
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 保存单村进度 ──
  ipcMain.handle('project-progress:save', (_e, payload: any) => {
    try {
      const { projectId, village_id, village_name, person_name, phone, stages, note } = payload
      const stagesJson = JSON.stringify(stages || [])

      const existing = db().getRaw<{ id: number }>(
        'SELECT id FROM project_progress WHERE subsidy_type_id = ? AND village_id = ?',
        projectId, village_id
      )

      if (existing) {
        db().runRaw(
          `UPDATE project_progress SET village_name=?, person_name=?, phone=?, stages=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`,
          village_name || '', person_name || '', phone || '', stagesJson, note || '', existing.id
        )
      } else {
        db().runRaw(
          `INSERT INTO project_progress (subsidy_type_id, village_id, village_name, person_name, phone, stages, note) VALUES (?,?,?,?,?,?,?)`,
          projectId, village_id, village_name || '', person_name || '', phone || '', stagesJson, note || ''
        )
      }
      return success({ message: '已保存' })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 批量操作 ──
  ipcMain.handle('project-progress:batch', (_e, payload: any) => {
    try {
      const { projectId, action } = payload
      const rows = db().allRaw<Record<string, unknown>>(
        'SELECT * FROM project_progress WHERE subsidy_type_id = ?', projectId
      )

      switch (action) {
        case 'init': {
          // 从村庄表初始化所有村
          const villages = db().allRaw<{ id: number; village_name: string; group_no: number }>(
            'SELECT vg.*, v.village_name FROM village_group vg JOIN village v ON vg.village_id = v.id ORDER BY v.village_name, vg.group_no'
          )
          let added = 0
          for (const v of villages) {
            const exists = rows.find(r => r.village_id === v.id)
            if (!exists) {
              db().runRaw(
                `INSERT INTO project_progress (subsidy_type_id, village_id, village_name, stages) VALUES (?,?,?,?)`,
                projectId, v.id, `${v.village_name}${formatGroupNoSimple(v.group_no)}`, '[]'
              )
              added++
            }
          }
          return success({ message: `已初始化 ${added} 个村` })
        }

        case 'sync_leaders': {
          // 从村庄表同步负责人信息
          let updated = 0
          for (const r of rows) {
            const leader = db().getRaw<{ real_name: string; phone: string }>(`
              SELECT fp.real_name, fp.phone FROM farmer_profile fp
              JOIN family_household hh ON fp.household_id = hh.id
              WHERE hh.village_id = (SELECT village_id FROM village_group WHERE id = ?)
              AND fp.relation = '本人'
              LIMIT 1
            `, r.village_id)
            if (leader) {
              db().runRaw(
                `UPDATE project_progress SET person_name=?, phone=?, updated_at=datetime('now','localtime') WHERE id=?`,
                leader.real_name || '', leader.phone || '', r.id
              )
              updated++
            }
          }
          return success({ message: `已同步`, updated })
        }

        case 'add_stage_to_all': {
          const { stage } = payload
          for (const r of rows) {
            const stages = safeParse(r.stages as string, [])
            if (!stages.find((s: any) => s.name === stage.name)) {
              stages.push(stage)
              db().runRaw(
                `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
                JSON.stringify(stages), r.id
              )
            }
          }
          return success({ message: `已添加阶段「${stage.name}」` })
        }

        case 'batch_stage': {
          const { stage_name, status, date } = payload
          for (const r of rows) {
            const stages = safeParse(r.stages as string, [])
            const idx = stages.findIndex((s: any) => s.name === stage_name)
            if (idx >= 0) {
              stages[idx] = { ...stages[idx], status, date: date || stages[idx].date }
              db().runRaw(
                `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
                JSON.stringify(stages), r.id
              )
            }
          }
          return success({ message: `已批量更新「${stage_name}」` })
        }

        case 'swap_stages': {
          const { stage_a, stage_b } = payload
          for (const r of rows) {
            const stages = safeParse(r.stages as string, [])
            const ia = stages.findIndex((s: any) => s.name === stage_a)
            const ib = stages.findIndex((s: any) => s.name === stage_b)
            if (ia >= 0 && ib >= 0) {
              ;[stages[ia], stages[ib]] = [stages[ib], stages[ia]]
              db().runRaw(
                `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
                JSON.stringify(stages), r.id
              )
            }
          }
          return success({ message: '已交换阶段顺序' })
        }

        default:
          return errorResponse('未知操作: ' + action)
      }
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 删除阶段 ──
  ipcMain.handle('project-progress:deleteStage', (_e, payload: any) => {
    try {
      const { projectId, stage_name } = payload
      const rows = db().allRaw<Record<string, unknown>>(
        'SELECT * FROM project_progress WHERE subsidy_type_id = ?', projectId
      )
      for (const r of rows) {
        const stages = safeParse(r.stages as string, [])
        const filtered = stages.filter((s: any) => s.name !== stage_name)
        if (filtered.length !== stages.length) {
          db().runRaw(
            `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
            JSON.stringify(filtered), r.id
          )
        }
      }
      return success({ message: `已删除阶段「${stage_name}」` })
    } catch (e) {
      return errorResponse(String(e))
    }
  })

  // ── 文件扫描 ──
  ipcMain.handle('project-progress:scanFiles', (_e, payload: any) => {
    try {
      const { projectId, path: scanPath, stage_name } = payload
      if (!existsSync(scanPath)) return errorResponse('目录不存在: ' + scanPath)

      const files = readdirSync(scanPath).filter(f => {
        try { return statSync(join(scanPath, f)).isFile() } catch { return false }
      })

      const rows = db().allRaw<Record<string, unknown>>(
        'SELECT * FROM project_progress WHERE subsidy_type_id = ?', projectId
      )

      let matched = 0
      for (const r of rows) {
        const vname = String(r.village_name || '')
        const found = files.some(f => {
          const basename = f.replace(/\.[^.]+$/, '') // strip extension
          return basename.includes(vname) || vname.includes(basename)
        })
        if (found) {
          const stages = safeParse(r.stages as string, [])
          const idx = stages.findIndex((s: any) => s.name === stage_name)
          if (idx >= 0) {
            stages[idx] = { ...stages[idx], status: 'done', date: new Date().toISOString() }
            db().runRaw(
              `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
              JSON.stringify(stages), r.id
            )
            matched++
          }
        }
      }

      return success({ message: `扫描完成：${files.length} 个文件，匹配 ${matched} 个村` })
    } catch (e) {
      return errorResponse(String(e))
    }
  })
}

function safeParse(val: string, fallback: unknown): any {
  try { return JSON.parse(val || '[]') } catch { return fallback }
}

function formatGroupNoSimple(n: number): string {
  const map = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (n >= 1 && n <= 10) return map[n] + '组'
  return n + '组'
}
