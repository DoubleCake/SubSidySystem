/**
 * 本地持久化存储
 * 使用 electron-store 管理用户设置
 */
import Store from 'electron-store'

interface UserSettings {
  /** 更新服务器地址 (用户可手动修改) */
  updateServerUrl: string
  /** 是否自动检查更新 */
  autoCheckUpdate: boolean
  /** 最后检查更新的时间 */
  lastUpdateCheck: string | null
}

const store = new Store<UserSettings>({
  name: 'user-settings',
  defaults: {
    updateServerUrl: '',
    autoCheckUpdate: true,
    lastUpdateCheck: null,
  },
})

export function getUpdateServerUrl(): string {
  return store.get('updateServerUrl')
}

export function setUpdateServerUrl(url: string): void {
  store.set('updateServerUrl', url)
}

export function getAutoCheckUpdate(): boolean {
  return store.get('autoCheckUpdate')
}

export function setAutoCheckUpdate(v: boolean): void {
  store.set('autoCheckUpdate', v)
}

export function getLastUpdateCheck(): string | null {
  return store.get('lastUpdateCheck')
}

export function setLastUpdateCheck(date: string): void {
  store.set('lastUpdateCheck', date)
}

export default store
