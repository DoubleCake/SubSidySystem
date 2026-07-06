import { app, BrowserWindow, shell } from 'electron'
import { join, dirname } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { initDatabase } from './database/connection'
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

app.whenReady().then(async () => {
  ensureAppUpdateYml()
  await initDatabase()
  runMigrations()
  registerAllIpcHandlers()
  registerUpdateEvents()
  createWindow()

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
