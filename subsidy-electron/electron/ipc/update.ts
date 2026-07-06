/**
 * 软件更新 & 版本管理 IPC 处理器
 */
import { ipcMain, app } from 'electron'
import { getUpdateServerUrl } from '../store'
import { success, errorResponse } from './response'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export function registerUpdateHandlers(): void {

  // ── 获取服务器上的版本历史 ──
  ipcMain.handle('update:getVersionHistory', async () => {
    try {
      const baseUrl = getUpdateServerUrl()
      if (!baseUrl) return errorResponse('未配置更新服务器地址')

      const cleanUrl = baseUrl.replace(/\/+$/, '')
      let versions: any[] = []

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const resp = await fetch(`${cleanUrl}/versions.json`, { signal: controller.signal })
        clearTimeout(timeout)
        if (resp.ok) {
          const data = await resp.json()
          versions = data.versions || data || []
        }
      } catch { /* server may not have versions.json yet */ }

      // 也尝试读取 latest.yml 获取当前服务器最新版本
      let latestVersion = ''
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const resp = await fetch(`${cleanUrl}/latest.yml`, { signal: controller.signal })
        clearTimeout(timeout)
        if (resp.ok) {
          const yml = await resp.text()
          const m = yml.match(/version:\s*(\S+)/)
          if (m) latestVersion = m[1]
        }
      } catch { /* ignore */ }

      return success({
        currentVersion: app.getVersion(),
        latestVersion,
        serverUrl: cleanUrl,
        versions,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  // ── 版本回退：下载指定版本安装包 ──
  ipcMain.handle('update:downloadVersion', async (_e, payload: { version: string; url?: string }) => {
    try {
      const baseUrl = getUpdateServerUrl()
      if (!baseUrl) return errorResponse('未配置更新服务器地址')

      const cleanUrl = baseUrl.replace(/\/+$/, '')
      const downloadUrl = payload.url || `${cleanUrl}/SubsidySystem Setup ${payload.version}.exe`

      const { autoUpdater } = require('electron-updater')
      autoUpdater.allowDowngrade = true
      autoUpdater.setFeedURL({ provider: 'generic', url: cleanUrl })

      // 直接使用 electron-updater 下载指定版本
      await autoUpdater.downloadUpdate()
      return success({ message: `版本 ${payload.version} 已下载，重启后安装` })
    } catch (e) {
      return errorResponse(`下载失败: ${(e as Error).message}`)
    }
  })

  // ── 本地版本更新日志 ──
  ipcMain.handle('update:getLocalChangelog', () => {
    try {
      const changelogPath = join(app.getAppPath(), '..', 'CHANGELOG.md')
      if (existsSync(changelogPath)) {
        return success({ content: readFileSync(changelogPath, 'utf-8') })
      }
      return success({ content: '' })
    } catch (e) { return errorResponse(String(e)) }
  })
}
