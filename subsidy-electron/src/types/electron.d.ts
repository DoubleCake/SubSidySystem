/**
 * Electron API 类型声明
 */
export interface ElectronAPI {
  invoke: <T = unknown>(channel: string, data?: unknown) => Promise<T>
  selectFile: (options?: {
    filters?: { name: string; extensions: string[] }[]
    title?: string
  }) => Promise<string | null>
  saveFile: (options?: {
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
    title?: string
  }) => Promise<string | null>
  getUserDataPath: () => Promise<string>
  getDbPath: () => Promise<string>
  copyFile: (src: string, dest: string) => Promise<void>

  // 更新事件监听
  onUpdateStatus: (callback: (status: string) => void) => void
  onUpdateAvailable: (callback: (info: { version: string; currentVersion: string }) => void) => void
  onUpdateProgress: (callback: (progress: { percent: number; speedMB?: string; speed?: number; transferred?: number; total?: number }) => void) => void
  onUpdateError: (callback: (error: string) => void) => void
  removeUpdateListeners: () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
