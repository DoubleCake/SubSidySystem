/**
 * 自动更新模块
 * 基于 electron-updater，支持自定义服务器地址
 *
 * 用户配置的服务器上需要放置以下文件:
 *   {serverUrl}/
 *     ├── latest.yml          # 版本元数据 (electron-builder 自动生成)
 *     ├── 农户补贴管理系统 Setup 3.0.0.exe
 *     ├── 农户补贴管理系统 Setup 3.0.0.exe.blockmap
 *     └── ... (各版本安装包)
 *
 * 发布流程:
 *   1. npm run dist (生成 exe + latest.yml)
 *   2. 将 dist/ 下的文件上传到云服务器
 *   3. 用户在软件中设置更新服务器地址
 */
import { autoUpdater } from 'electron-updater'
import { BrowserWindow, dialog } from 'electron'
import { getUpdateServerUrl, setLastUpdateCheck } from './store'

let mainWindow: BrowserWindow | null = null

export function setUpdateWindow(win: BrowserWindow) {
  mainWindow = win
}

/**
 * 切换到指定服务器地址
 */
function configureUpdater(url: string) {
  if (url) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: url.replace(/\/+$/, ''), // 去掉末尾斜杠
    })
  }
}

/**
 * 检查更新（静默模式，启动时调用）
 */
export async function checkForUpdatesSilent() {
  const url = getUpdateServerUrl()
  if (!url) return // 未配置服务器地址，跳过

  configureUpdater(url)

  try {
    const result = await autoUpdater.checkForUpdates()
    if (result?.updateInfo?.version !== autoUpdater.currentVersion) {
      // 有新版本，通知渲染进程
      mainWindow?.webContents.send('update:available', {
        version: result.updateInfo.version,
        currentVersion: autoUpdater.currentVersion,
      })
    }
  } catch (e) {
    console.log('[Updater] 检查更新失败:', (e as Error).message)
  }

  setLastUpdateCheck(new Date().toISOString())
}

/**
 * 手动检查更新并下载安装
 */
export async function checkForUpdatesAndInstall() {
  const url = getUpdateServerUrl()
  if (!url) {
    return { error: '未配置更新服务器地址，请在设置中填写' }
  }

  configureUpdater(url)

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result || result.updateInfo.version === autoUpdater.currentVersion) {
      return { message: '当前已是最新版本', version: autoUpdater.currentVersion }
    }

    // 下载并安装
    await autoUpdater.downloadUpdate()
    setLastUpdateCheck(new Date().toISOString())
    return { message: '更新已下载，将在退出时安装', version: result.updateInfo.version }
  } catch (e) {
    return { error: `更新失败: ${(e as Error).message}` }
  }
}

/**
 * 注册更新事件监听
 */
export function registerUpdateEvents() {
  autoUpdater.autoDownload = false // 手动控制下载
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update:status', 'checking')
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:status', 'available')
    mainWindow?.webContents.send('update:available', {
      version: info.version,
      currentVersion: autoUpdater.currentVersion,
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update:status', 'up-to-date')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      speed: progress.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:status', 'downloaded')
    // 弹窗询问是否立即重启安装
    dialog.showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: '新版本已下载完成，是否立即重启安装？',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (error) => {
    mainWindow?.webContents.send('update:status', 'error')
    mainWindow?.webContents.send('update:error', error.message)
  })
}
