/**
 * 本地持久化存储 — 简单的 JSON 文件存储
 * 替代 electron-store (ESM-only 不兼容 CJS)
 */
import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

interface UserSettings {
  updateServerUrl: string
  autoCheckUpdate: boolean
  lastUpdateCheck: string | null
}

const DEFAULT_SETTINGS: UserSettings = {
  updateServerUrl: '',
  autoCheckUpdate: true,
  lastUpdateCheck: null,
}

function getConfigPath(): string {
  const dir = join(app.getPath('userData'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'user-settings.json')
}

function readSettings(): UserSettings {
  try {
    const path = getConfigPath()
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

function writeSettings(settings: UserSettings): void {
  try {
    writeFileSync(getConfigPath(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Store] 保存设置失败:', e)
  }
}

let cachedSettings: UserSettings | null = null

function getSettings(): UserSettings {
  if (!cachedSettings) cachedSettings = readSettings()
  return cachedSettings
}

export function getUpdateServerUrl(): string {
  return getSettings().updateServerUrl
}

export function setUpdateServerUrl(url: string): void {
  const s = getSettings()
  s.updateServerUrl = url
  writeSettings(s)
}

export function getAutoCheckUpdate(): boolean {
  return getSettings().autoCheckUpdate
}

export function setAutoCheckUpdate(v: boolean): void {
  const s = getSettings()
  s.autoCheckUpdate = v
  writeSettings(s)
}

export function getLastUpdateCheck(): string | null {
  return getSettings().lastUpdateCheck
}

export function setLastUpdateCheck(date: string): void {
  const s = getSettings()
  s.lastUpdateCheck = date
  writeSettings(s)
}
