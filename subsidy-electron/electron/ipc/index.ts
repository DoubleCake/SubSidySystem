import { ipcMain, dialog, app } from 'electron'
import { copyFileSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import type { Stats } from 'fs'
import { initDatabase } from '../database/connection'
import { runMigrations } from '../database/migrate'
import { registerFarmerHandlers } from './farmers'
import { registerHouseholdHandlers } from './households'
import { registerSubsidyHandlers } from './subsidies'
import { registerAiHandlers } from './ai'
import { registerLandHandlers } from './land'
import { registerSettingsHandlers } from './settings'
import { registerPrecheckHandlers } from './precheck'
import { registerExcelTemplateHandlers } from './excel-templates'
import { registerErrorLibraryHandlers } from './error-library'
import { registerHouseholdImportHandlers } from './household-import'
import { registerAgriTaskHandlers } from './agri-tasks'
import { registerExternalLinksHandlers } from './external-links'
import { registerEligibilityHandlers } from './eligibility'
import { registerAuthHandlers } from './auth'
import { registerProjectProgressHandlers } from './project-progress'
import { registerVillageContactsHandlers } from './village-contacts'
import { registerUpdateHandlers } from './update'
import { getDbPath } from '../database/connection'

/**
 * 注册所有 IPC 处理器
 */
export function registerAllIpcHandlers(): void {
  // ── 通用对话框 ──
  ipcMain.handle('dialog:selectFile', async (_e, options) => {
    const result = await dialog.showOpenDialog({
      title: options?.title || '选择文件',
      filters: options?.filters || [{ name: 'Excel文件', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_e, options) => {
    const result = await dialog.showSaveDialog({
      title: options?.title || '保存文件',
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: 'Excel文件', extensions: ['xlsx'] }],
    })
    return result.canceled ? null : result.filePath || null
  })

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择文件夹',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] || null
  })

  // ── 应用信息 ──
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'))
  ipcMain.handle('app:getDbPath', () => getDbPath())
  ipcMain.handle('app:relaunch', () => { app.relaunch(); app.quit() })

  // ── 数据库状态与首次运行 ──
  ipcMain.handle('db:status', () => {
    try {
      const { getDb } = require('../database/connection')
      const db = getDb()
      if (!db) return { ok: false, firstRun: false }
      // 检查 users 表是否存在且有数据
      let hasUsers = false
      try {
        const row = db.getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM users')
        hasUsers = (row?.cnt ?? 0) > 0
      } catch { /* users 表不存在 */ }
      return { ok: true, firstRun: !hasUsers }
    } catch {
      return { ok: false, firstRun: false }
    }
  })

  ipcMain.handle('db:reload', async () => {
    try {
      await initDatabase()
      runMigrations()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ── 首次运行设置（绕过登录直接创建管理员） ──
  ipcMain.handle('auth:setup', (_e, username: string, password: string) => {
    try {
      const { getDb } = require('../database/connection')
      const d = getDb()
      if (!d) return { ok: false, error: '数据库未就绪' }
      // 确保表存在
      d.runRaw(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          display_name TEXT DEFAULT '',
          role TEXT DEFAULT 'user',
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now','localtime'))
        )
      `)
      const exist = d.getRaw<{ id: number }>('SELECT id FROM users WHERE username=?', username)
      if (!exist) {
        d.runRaw("INSERT INTO users (username, password, display_name, role) VALUES (?,?,?,?)",
          username, password, '管理员', 'admin')
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ── 文件操作 ──
  ipcMain.handle('fs:copyFile', (_e, { src, dest }: { src: string; dest: string }) => {
    copyFileSync(src, dest)
  })

  // ── 进度配置持久化 ──
  function progressConfigPath() {
    const dir = join(app.getPath('userData'))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return join(dir, 'village-progress-config.json')
  }

  function loadProgressConfig(): Record<string, { folderPath?: string; stages?: string[] }> {
    try {
      const p = progressConfigPath()
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
    } catch { /* ignore */ }
    return {}
  }

  function saveProgressConfig(cfg: Record<string, unknown>) {
    writeFileSync(progressConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8')
  }

  ipcMain.handle('progress:loadConfig', (_e, key: string) => {
    const cfg = loadProgressConfig()
    return cfg[key] || { folderPath: '', stages: [] }
  })

  ipcMain.handle('progress:saveConfig', (_e, key: string, data: { folderPath?: string; stages?: string[] }) => {
    const cfg = loadProgressConfig()
    cfg[key] = { ...cfg[key], ...data }
    saveProgressConfig(cfg)
    return { ok: true }
  })

  // ── 扫描文件夹，匹配阶段和村名 ──
  ipcMain.handle('progress:scan', (_e, folderPath: string, stages: string[], villageNames: string[]) => {
    try {
      if (!folderPath || !existsSync(folderPath)) {
        return { stages: [], villageResults: [], error: '文件夹路径不存在' }
      }

      const results: { stage: string; villages: string[]; totalFiles: number }[] = []
      const entries = readdirSync(folderPath)

      for (const stage of stages) {
        // 在文件夹中查找匹配阶段名的子文件夹
        const matchedEntry = entries.find(e => {
          const full = join(folderPath, e)
          try {
            const st = statSync(full)
            return st.isDirectory() && e === stage
          } catch { return false }
        })

        const matchedVillages: string[] = []
        let totalFiles = 0

        if (matchedEntry) {
          const stageDir = join(folderPath, matchedEntry)
          const files = readdirSync(stageDir)
          totalFiles = files.length

          // 检查文件名是否包含村名
          for (const vn of villageNames) {
            const found = files.some(f => f.includes(vn))
            if (found) matchedVillages.push(vn)
          }
        }

        results.push({ stage, villages: matchedVillages, totalFiles })
      }

      return { stages: results, villageResults: null, error: null }
    } catch (e) { return { stages: [], villageResults: null, error: String(e) } }
  })

  // ── 业务领域 handlers ──
  registerFarmerHandlers()
  registerHouseholdHandlers()
  registerSubsidyHandlers()
  registerAiHandlers()
  registerLandHandlers()
  registerSettingsHandlers()
  registerPrecheckHandlers()
  registerExcelTemplateHandlers()
  registerErrorLibraryHandlers()
  registerHouseholdImportHandlers()
  registerAgriTaskHandlers()
  registerExternalLinksHandlers()
  registerEligibilityHandlers()
  registerAuthHandlers()
  registerProjectProgressHandlers()
  registerVillageContactsHandlers()
  registerUpdateHandlers()
}
