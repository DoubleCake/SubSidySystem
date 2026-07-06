import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initDatabase } from './database/connection'
import { runMigrations } from './database/migrate'
import { registerAllIpcHandlers } from './ipc/index'
import { registerUpdateEvents, setUpdateWindow, checkForUpdatesSilent } from './updater'
import { getAutoCheckUpdate } from './store'

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
