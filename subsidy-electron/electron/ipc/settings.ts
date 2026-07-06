import { ipcMain, app, dialog } from 'electron'
import { getDb, getDbPath } from '../database/connection'
import { success, errorResponse } from './response'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import { formatGroupNo } from '../utils/format'
import { getUpdateServerUrl, getAutoCheckUpdate, getLastUpdateCheck, setUpdateServerUrl, setAutoCheckUpdate } from '../store'
import { checkForUpdatesAndInstall } from '../updater'

function getBackupDir(): string {
  const dir = join(app.getPath('userData'), 'backups')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function registerSettingsHandlers(): void {
  const db = () => getDb()

  // ── 村组管理 ──
  ipcMain.handle('settings:listVillageGroups', () => {
    try {
      const rows = db().allRaw(`
        SELECT vg.*, v.village_name FROM village_group vg
        JOIN village v ON vg.village_id = v.id
        ORDER BY v.village_name, vg.group_no
      `)
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('settings:createVillageGroup', (_e, data: { village_name: string; group_no: string }) => {
    try {
      let village = db().getRaw<{ id: number }>('SELECT id FROM village WHERE village_name = ?', data.village_name)
      if (!village) {
        const r = db().runRaw('INSERT INTO village (village_name) VALUES (?)', data.village_name)
        village = { id: Number(r.lastInsertRowid) }
      }
      const result = db().runRaw('INSERT INTO village_group (village_id, group_no) VALUES (?, ?)', village.id, data.group_no)
      return success({ id: result.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 数据库信息 ──
  ipcMain.handle('settings:getDbInfo', () => {
    try {
      const dbPath = getDbPath()
      const stat = existsSync(dbPath) ? statSync(dbPath) : { size: 0 }
      const sizeKb = Math.round(stat.size / 1024)
      const sizeMb = Math.round(stat.size / 1024 / 1024 * 100) / 100

      // 各表记录数
      const tables = ['farmer_profile', 'family_household', 'village_group', 'subsidy_type', 'subsidy_application']
      const recordCounts: Record<string, number> = {}
      let totalRecords = 0
      for (const t of tables) {
        try {
          const r = db().getRaw<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM "${t}"`)
          recordCounts[t] = r?.cnt ?? 0
          totalRecords += r?.cnt ?? 0
        } catch { recordCounts[t] = 0 }
      }

      // 本地备份列表
      const backupDir = getBackupDir()
      const backups: { filename: string; size_kb: number; created: string }[] = []
      try {
        for (const f of readdirSync(backupDir)) {
          if (f.endsWith('.db')) {
            const fs = statSync(join(backupDir, f))
            backups.push({
              filename: f,
              size_kb: Math.round(fs.size / 1024),
              created: fs.birthtime.toISOString().split('T')[0],
            })
          }
        }
        backups.sort((a, b) => b.created.localeCompare(a.created))
      } catch { /* ignore */ }

      return success({
        db_path: dbPath,
        db_size_kb: sizeKb,
        db_size_mb: sizeMb,
        total_records: totalRecords,
        record_counts: recordCounts,
        backups,
        backup_dir: backupDir,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 下载数据库文件 ──
  ipcMain.handle('settings:downloadDb', async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: '保存数据库文件',
        defaultPath: 'subsidy.db',
        filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
      })
      if (result.canceled || !result.filePath) return success(null, '已取消')
      copyFileSync(getDbPath(), result.filePath)
      return success({ message: '下载成功', path: result.filePath })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 导出 Excel ──
  ipcMain.handle('settings:exportExcel', async () => {
    try {
      // 动态加载 xlsx
      const XLSX = require('xlsx')
      const wb = XLSX.utils.book_new()

      const sheets: { name: string; table: string }[] = [
        { name: '农户档案', table: 'farmer_profile' },
        { name: '家庭户', table: 'family_household' },
        { name: '补贴记录', table: 'subsidy_application' },
        { name: '补贴项目', table: 'subsidy_type' },
        { name: '村组配置', table: 'village_group' },
      ]

      for (const { name, table } of sheets) {
        try {
          const rows = db().allRaw(`SELECT * FROM "${table}"`)
          if (rows.length > 0) {
            const ws = XLSX.utils.json_to_sheet(rows)
            XLSX.utils.book_append_sheet(wb, ws, name)
          }
        } catch { /* table might not exist */ }
      }

      const result = await dialog.showSaveDialog({
        title: '导出 Excel',
        defaultPath: `数据备份_${new Date().toISOString().split('T')[0]}.xlsx`,
        filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
      })
      if (result.canceled || !result.filePath) return success(null, '已取消')

      XLSX.writeFile(wb, result.filePath)
      return success({ message: '导出成功', path: result.filePath })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 创建本地备份 ──
  ipcMain.handle('settings:createBackup', () => {
    try {
      const backupDir = getBackupDir()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filename = `backup_${timestamp}.db`
      const destPath = join(backupDir, filename)
      copyFileSync(getDbPath(), destPath)
      const stat = statSync(destPath)
      return success({
        message: '备份创建成功',
        filename,
        size_kb: Math.round(stat.size / 1024),
        path: destPath,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 下载备份文件 ──
  ipcMain.handle('settings:downloadBackup', async (_e, filename: string) => {
    try {
      const srcPath = join(getBackupDir(), filename)
      if (!existsSync(srcPath)) return errorResponse('备份文件不存在')
      const result = await dialog.showSaveDialog({
        title: '下载备份',
        defaultPath: filename,
        filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
      })
      if (result.canceled || !result.filePath) return success(null, '已取消')
      copyFileSync(srcPath, result.filePath)
      return success({ message: '下载成功' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 删除备份 ──
  ipcMain.handle('settings:deleteBackup', (_e, filename: string) => {
    try {
      const filePath = join(getBackupDir(), filename)
      if (existsSync(filePath)) unlinkSync(filePath)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 预览恢复（读取源 DB 统计信息）──
  ipcMain.handle('settings:previewRestore', async (_e, filePath: string) => {
    try {
      if (!existsSync(filePath)) return errorResponse('备份文件不存在')

      const fileStat = statSync(filePath)
      const tables: { name: string; count: number }[] = []
      let totalRecords = 0

      // 用 sql.js 临时打开源文件读取统计
      try {
        const initSqlJs = require('sql.js')
        const SQL = await initSqlJs()
        const fileBuffer = readFileSync(filePath)
        const srcDb = new SQL.Database(fileBuffer)
        const rows = srcDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        if (rows.length > 0) {
          for (const col of rows[0].values) {
            const tableName = col[0] as string
            try {
              const cnt = srcDb.exec(`SELECT COUNT(*) as cnt FROM "${tableName}"`)
              const count = cnt.length > 0 ? Number(cnt[0].values[0][0]) : 0
              tables.push({ name: tableName, count })
              totalRecords += count
            } catch { tables.push({ name: tableName, count: 0 }) }
          }
        }
        srcDb.close()
      } catch { /* 无法解析，跳过 */ }

      return success({
        filePath,
        fileName: basename(filePath),
        fileSizeKb: Math.round(fileStat.size / 1024),
        fileSizeMb: (fileStat.size / 1024 / 1024).toFixed(1),
        tables,
        tableCount: tables.length,
        totalRecords,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 恢复数据库 ──
  ipcMain.handle('settings:restore', async (_e, filePath: string) => {
    try {
      if (!existsSync(filePath)) return errorResponse('备份文件不存在')

      // 创建应急备份
      const emergencyDir = getBackupDir()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const emergencyPath = join(emergencyDir, `emergency_before_restore_${timestamp}.db`)
      copyFileSync(getDbPath(), emergencyPath)

      // 分析源文件
      const fileStat = statSync(filePath)
      const tables: { name: string; count: number }[] = []
      let totalRecords = 0

      try {
        const initSqlJs = require('sql.js')
        const SQL = await initSqlJs()
        const fileBuffer = readFileSync(filePath)
        const srcDb = new SQL.Database(fileBuffer)
        const rows = srcDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        if (rows.length > 0) {
          for (const col of rows[0].values) {
            const tableName = col[0] as string
            try {
              const cnt = srcDb.exec(`SELECT COUNT(*) as cnt FROM "${tableName}"`)
              const count = cnt.length > 0 ? Number(cnt[0].values[0][0]) : 0
              tables.push({ name: tableName, count })
              totalRecords += count
            } catch { tables.push({ name: tableName, count: 0 }) }
          }
        }
        srcDb.close()
      } catch { /* 统计失败，继续恢复 */ }

      // 执行恢复
      copyFileSync(filePath, getDbPath())

      return success({
        message: `数据库恢复完成！共 ${tables.length} 个表，${totalRecords} 条记录`,
        backup_created: basename(emergencyPath),
        source_file: basename(filePath),
        source_size_kb: Math.round(fileStat.size / 1024),
        tables_imported: tables.length,
        total_records: totalRecords,
        details: tables.map(t => `${t.name}: ${t.count} 条`),
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 更新设置 ──
  ipcMain.handle('settings:getUpdateConfig', () => {
    try {
      return success({
        updateServerUrl: getUpdateServerUrl(),
        autoCheckUpdate: getAutoCheckUpdate(),
        lastUpdateCheck: getLastUpdateCheck(),
        currentVersion: app.getVersion(),
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('settings:setUpdateConfig', (_e, config: { updateServerUrl?: string; autoCheckUpdate?: boolean }) => {
    try {
      if (config.updateServerUrl !== undefined) setUpdateServerUrl(config.updateServerUrl)
      if (config.autoCheckUpdate !== undefined) setAutoCheckUpdate(config.autoCheckUpdate)
      return success({ message: '设置已保存' })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('settings:checkForUpdate', async () => {
    try {
      return success(await checkForUpdatesAndInstall())
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 获取村列表 ──
  ipcMain.handle('settings:listVillages', () => {
    try {
      const rows = db().allRaw('SELECT id, village_name FROM village ORDER BY village_name')
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 村详情 ──
  ipcMain.handle('settings:villageDetail', (_e, villageId: number) => {
    try {
      const v = db().getRaw<Record<string, unknown>>('SELECT * FROM village WHERE id=?', villageId)
      if (!v) return errorResponse('村不存在', 404)
      const groups = db().allRaw('SELECT * FROM village_group WHERE village_id=? ORDER BY group_no', villageId)
      return success({ ...v, groups })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 更新村 ──
  ipcMain.handle('settings:updateVillage', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined && k !== 'id')
      if (keys.length === 0) return errorResponse('无更新数据')
      const sets = keys.map(k => `${k}=?`).join(',')
      db().runRaw(`UPDATE village SET ${sets} WHERE id=?`, ...keys.map(k => data[k]), id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 批量创建村组 ──
  ipcMain.handle('settings:batchCreateVillageGroups', (_e, payload: any) => {
    try {
      const { rows } = payload
      let created = 0
      for (const r of rows) {
        let village = db().getRaw<{ id: number }>('SELECT id FROM village WHERE village_name=?', r.village_name)
        if (!village) {
          const vr = db().runRaw('INSERT INTO village (village_name) VALUES (?)', r.village_name)
          village = { id: Number(vr.lastInsertRowid) }
        }
        const exist = db().getRaw<{ id: number }>('SELECT id FROM village_group WHERE village_id=? AND group_no=?', village.id, r.group_no)
        if (!exist) {
          db().runRaw('INSERT INTO village_group (village_id, group_no) VALUES (?,?)', village.id, r.group_no)
          created++
        }
      }
      return success({ message: `已创建 ${created} 个村组` })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 更新村组 ──
  ipcMain.handle('settings:updateVillageGroup', (_e, payload: any) => {
    try {
      const { id, ...data } = payload
      const keys = Object.keys(data).filter(k => data[k] !== undefined && k !== 'id')
      if (keys.length === 0) return errorResponse('无更新数据')
      db().runRaw(`UPDATE village_group SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, ...keys.map(k => data[k]), id)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 删除村组 ──
  ipcMain.handle('settings:deleteVillageGroup', (_e, gId: number) => {
    try {
      // check references
      const hhCount = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM family_household WHERE village_id IN (SELECT village_id FROM village_group WHERE id=?)', gId)?.cnt ?? 0
      if (hhCount > 0) return errorResponse(`该村组下有 ${hhCount} 个家庭户，无法删除`)
      db().runRaw('DELETE FROM village_group WHERE id=?', gId)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 村组引用检查 ──
  ipcMain.handle('settings:villageReferences', (_e, vid: number) => {
    try {
      const hhCount = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM family_household WHERE village_id=?', vid)?.cnt ?? 0
      const farmerCount = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM farmer_profile WHERE own_village_id=?', vid)?.cnt ?? 0
      return success({ households: hhCount, farmers: farmerCount, canDelete: hhCount === 0 && farmerCount === 0 })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 批量更新负责人 ──
  ipcMain.handle('settings:batchUpdateLeaders', (_e, payload: any) => {
    try {
      const { rows } = payload
      let updated = 0
      for (const r of rows) {
        db().runRaw('UPDATE family_household SET head_farmer_id=(SELECT id FROM farmer_profile WHERE household_id=? AND relation=\'本人\' LIMIT 1) WHERE id=?',
          r.household_id || 0, r.household_id || 0)
        updated++
      }
      return success({ message: `已更新 ${updated} 个家庭户` })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 农事任务：村土地信息 ──
  ipcMain.handle('agri-tasks:listVillageLandInfo', () => {
    try {
      const rows = db().allRaw<Record<string, unknown>>(`
        SELECT vg.id as village_id, v.village_name, vg.group_no,
               (SELECT COUNT(*) FROM family_household WHERE village_id=v.id AND group_no=vg.group_no) as household_count,
               (SELECT COALESCE(SUM(contract_area),0) FROM family_household WHERE village_id=v.id AND group_no=vg.group_no) as total_contract_area
        FROM village_group vg JOIN village v ON vg.village_id=v.id ORDER BY v.village_name, vg.group_no
      `)
      return success(rows.map(r => ({ ...r, group_display: formatGroupNo(r.group_no as number) })))
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('agri-tasks:updateVillageLandInfo', (_e, payload: any) => {
    try {
      const { village_id, ...data } = payload
      if (data.contract_area != null) {
        db().runRaw('UPDATE family_household SET contract_area=? WHERE village_id=?',
          data.contract_area, village_id)
      }
      return success({ message: '已更新' })
    } catch (e) { return errorResponse(String(e)) }
  })
}
