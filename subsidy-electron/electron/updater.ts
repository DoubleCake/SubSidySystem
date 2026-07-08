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
 * 返回详细步骤信息，方便用户判断问题
 */
export async function checkForUpdatesAndInstall() {
  const url = getUpdateServerUrl()
  if (!url) {
    return { error: '未配置更新服务器地址，请在软件更新面板中填写' }
  }

  // 智能处理 URL：如果用户输入了完整 latest.yml 路径，自动修正为目录
  let cleanUrl = url.replace(/\/+$/, '')
  if (cleanUrl.endsWith('latest.yml')) {
    cleanUrl = cleanUrl.replace(/\/?latest\.yml$/, '')
  }
  const latestUrl = `${cleanUrl}/latest.yml`
  const steps: string[] = []

  // 步骤1: 检查服务器连通性
  steps.push(`🔍 正在连接: ${latestUrl}`)
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(latestUrl, { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) {
      return {
        error: `服务器返回 HTTP ${response.status}`,
        steps: [...steps, `❌ 服务器响应: HTTP ${response.status}`],
        detail: `请确认 ${latestUrl} 可正常访问\n常见原因:\n1. 服务器未启动或端口错误\n2. latest.yml 未上传到服务器目录\n3. 防火墙未开放端口`,
      }
    }

    const ymlContent = await response.text()
    steps.push(`✅ 已连接服务器，获取到 latest.yml (${ymlContent.length} 字节)`)

    // 步骤2: 解析版本信息
    let serverVersion = ''
    const versionMatch = ymlContent.match(/version:\s*(\S+)/)
    if (versionMatch) {
      serverVersion = versionMatch[1]
      steps.push(`服务器版本: ${serverVersion}`)
    } else {
      steps.push(`⚠️ latest.yml 中未找到版本号`)
    }

    // 步骤3: 比较版本
    const currentVersion = require('electron').app.getVersion()
    steps.push(`当前版本: ${currentVersion}`)

    if (!serverVersion || serverVersion === currentVersion) {
      setLastUpdateCheck(new Date().toISOString())
      return {
        message: `当前已是最新版本 (v${currentVersion})`,
        steps,
        currentVersion,
        serverVersion: serverVersion || '未知',
      }
    }

    steps.push(`发现新版本 v${serverVersion}，开始下载...`)

    // 步骤4: 先 checkForUpdates 注册更新信息，再下载
    configureUpdater(cleanUrl)

    try {
      const checkResult = await autoUpdater.checkForUpdates()
      if (!checkResult || !checkResult.updateInfo) {
        return {
          error: '无法获取更新信息',
          steps: [...steps, '❌ checkForUpdates 返回空'],
          detail: '服务器 latest.yml 格式可能不正确',
        }
      }
      steps.push(`✅ 解析更新信息成功 (v${checkResult.updateInfo.version})`)

      await autoUpdater.downloadUpdate()
      steps.push(`✅ 下载完成`)
      setLastUpdateCheck(new Date().toISOString())
      return {
        message: `更新已下载 (v${currentVersion} → v${serverVersion})，重启后安装`,
        steps,
        currentVersion,
        serverVersion,
      }
    } catch (downloadErr) {
      return {
        error: `下载失败: ${(downloadErr as Error).message}`,
        steps: [...steps, `❌ 下载失败: ${(downloadErr as Error).message}`],
        detail: `请确认:\n1. exe 文件已上传到 ${cleanUrl}/\n2. latest.yml 中 url 字段与实际文件名一致\n3. sha512/文件大小正确`,
      }
    }
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return {
        error: '连接超时 (10秒)',
        steps: [...steps, '❌ 请求超时无响应'],
        detail: `无法访问 ${latestUrl}\n请检查:\n1. 服务器是否在线 (ping ${cleanUrl.split('/')[2]})\n2. 地址和端口是否填写正确\n3. 防火墙/安全组是否开放端口`,
      }
    }
    return {
      error: `网络连接失败`,
      steps: [...steps, `❌ 无法连接: ${e.message || '未知错误'}`],
      detail: `目标地址: ${latestUrl}\n失败原因: ${e.message}\n请确认:\n1. 网址格式正确 (如 http://8.137.8.78:8080/)\n2. 服务器已启动并监听该端口\n3. 本机可访问该地址`,
    }
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
    const speedMB = progress.bytesPerSecond
      ? (progress.bytesPerSecond / (1024 * 1024)).toFixed(1)
      : '0.0'
    mainWindow?.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      speed: progress.bytesPerSecond,
      speedMB: `${speedMB} MB/s`,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:status', 'downloaded')
    // 弹窗询问是否立即重启安装
    // quitAndInstall(isSilent=true, isForceRunAfter=true):
    //   isSilent: NSIS 安装包静默安装（不显示安装界面）
    //   isForceRunAfter: 安装完成后强制启动新版本
    dialog.showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: '新版本已下载完成，是否立即重启安装？',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        // 静默安装 + 完成后强制启动新版本
        autoUpdater.quitAndInstall(true, true)
      }
    })
  })

  autoUpdater.on('error', (error) => {
    mainWindow?.webContents.send('update:status', 'error')
    mainWindow?.webContents.send('update:error', error.message)
  })
}

/**
 * 下载指定版本的 NSIS 安装包（不依赖 electron-updater 的 feed 机制）
 * 直接 HTTP 下载 EXE，推送进度，完成后可调用 quitAndInstall
 */
export async function downloadVersionExe(downloadUrl: string, version: string): Promise<string> {
  const { app } = require('electron')
  const fs = require('fs')
  const path = require('path')
  const http = downloadUrl.startsWith('https') ? require('https') : require('http')

  // URL 编码空格
  const url = downloadUrl.replace(/ /g, '%20')
  const tmpDir = app.getPath('temp')
  const filePath = path.join(tmpDir, `SubsidySystem Setup ${version}.exe`)

  mainWindow?.webContents.send('update:status', 'downloading')
  mainWindow?.webContents.send('update:progress', { percent: 0, speedMB: '0.0 MB/s' })

  return new Promise((resolve, reject) => {
    http.get(url, (res: any) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href
        res.resume()
        return resolve(downloadVersionExe(redirectUrl, version))
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }

      const total = parseInt(res.headers['content-length'], 10) || 0
      let downloaded = 0
      const startTime = Date.now()

      const file = fs.createWriteStream(filePath)
      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        file.write(chunk)
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100)
          const elapsed = (Date.now() - startTime) / 1000
          const speed = elapsed > 0 ? downloaded / elapsed : 0
          const speedMB = (speed / (1024 * 1024)).toFixed(1)
          mainWindow?.webContents.send('update:progress', {
            percent: pct,
            speedMB: `${speedMB} MB/s`,
            transferred: downloaded,
            total,
          })
        }
      })

      res.on('end', () => {
        file.end()
        mainWindow?.webContents.send('update:status', 'downloaded')
        resolve(filePath)
      })

      res.on('error', (err: Error) => {
        file.close()
        fs.unlink(filePath, () => {})
        reject(err)
      })
    }).on('error', reject)
  })
}
