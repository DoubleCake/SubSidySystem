import { app, BrowserWindow, shell, dialog } from 'electron'
import { join, dirname } from 'path'
import { existsSync, writeFileSync, copyFileSync, mkdirSync } from 'fs'
import { initDatabase, getDbPath } from './database/connection'
import { runMigrations } from './database/migrate'
import { registerAllIpcHandlers } from './ipc/index'
import { registerUpdateEvents, setUpdateWindow, checkForUpdatesSilent } from './updater'
import { getAutoCheckUpdate } from './store'

/**
 * 自动生成 resources/app-update.yml
 * electron-updater 需要这个文件来获取当前版本信息。
 * --dir 打包不会自动生成，所以应用启动时检查并补上。
 */
function ensureAppUpdateYml(): void {
  try {
    // resources/ 在 exe 同目录下（开发模式在 out/ 同目录下）
    const exeDir = dirname(app.getPath('exe'))
    const ymlPath = join(exeDir, 'resources', 'app-update.yml')
    if (!existsSync(ymlPath)) {
      const version = app.getVersion()
      const now = new Date().toISOString()
      const content = [
        `version: ${version}`,
        'files:',
        '  - url: SubsidySystem.exe',
        '    sha512: SKIP',
        '    size: 0',
        `path: SubsidySystem.exe`,
        'sha512: SKIP',
        `releaseDate: ${now}`,
      ].join('\n')
      writeFileSync(ymlPath, content, 'utf-8')
      console.log('[App] Created app-update.yml at', ymlPath)
    }
  } catch (e) {
    console.error('[App] Failed to create app-update.yml:', e)
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: '农户补贴管理系统',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  setUpdateWindow(mainWindow)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 全局未捕获异常处理 — 防止程序悄无声息崩溃
process.on('uncaughtException', (err) => {
  console.error('[App] 未捕获异常:', err)
  dialog.showErrorBox('程序异常', `应用遇到未处理的错误:\n${err.message}\n\n请截图并联系管理员。`)
})
process.on('unhandledRejection', (reason) => {
  console.error('[App] 未处理的 Promise 拒绝:', reason)
})

app.whenReady().then(async () => {
  // 数据库初始化 — 失败不阻塞应用启动
  try {
    ensureAppUpdateYml()
    await initDatabase()
    try { runMigrations() } catch (e) { console.error('[App] 数据库迁移失败:', e) }
    console.log('[App] 数据库就绪')
    startAutoBackup()  // 启动定时备份
  } catch (err) {
    console.error('[App] 数据库初始化失败，应用将以离线模式运行:', err)
  }

  // 无论数据库是否成功，都注册 handler 并创建窗口
  try { registerAllIpcHandlers() } catch (e) { console.error('[App] IPC 注册失败:', e) }
  registerUpdateEvents()
  createWindow()

  // 数据库问题不弹窗阻塞，由前端横幅提示并提供重试按钮

  // 启动后自动检查更新（如果已配置服务器）
  setTimeout(() => {
    if (getAutoCheckUpdate()) checkForUpdatesSilent()
  }, 3000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

/**
 * 定时备份 — 每4小时自动备份到 userData/backups/
 */
function startAutoBackup() {
  const BACKUP_INTERVAL = 4 * 60 * 60 * 1000 // 4 小时
  const MAX_BACKUPS = 7 // 保留最近 7 个

  const doBackup = () => {
    try {
      const dbPath = getDbPath()
      if (!existsSync(dbPath)) return

      const backupDir = join(app.getPath('userData'), 'backups')
      if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const dest = join(backupDir, `subsidy_auto_${ts}.db`)
      copyFileSync(dbPath, dest)
      console.log('[AutoBackup]', dest)

      // 清理旧备份
      try {
        const { readdirSync, statSync, unlinkSync } = require('fs')
        const files = readdirSync(backupDir)
          .filter((f: string) => f.startsWith('subsidy_auto_'))
          .map((f: string) => ({ name: f, mtime: statSync(join(backupDir, f)).mtimeMs }))
          .sort((a: any, b: any) => b.mtime - a.mtime)

        for (let i = MAX_BACKUPS; i < files.length; i++) {
          unlinkSync(join(backupDir, files[i].name))
        }
      } catch { /* 清理失败不阻塞 */ }
    } catch (e) {
      console.error('[AutoBackup] 备份失败:', e)
    }
  }

  // 启动后 5 分钟执行首次备份，之后每 4 小时
  setTimeout(() => {
    doBackup()
    setInterval(doBackup, BACKUP_INTERVAL)
  }, 5 * 60 * 1000)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
