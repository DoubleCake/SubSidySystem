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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
