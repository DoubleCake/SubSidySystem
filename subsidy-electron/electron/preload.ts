import { contextBridge, ipcRenderer } from 'electron'

/**
 * 渲染进程安全 API
 * 通过 contextBridge 暴露最小化接口，不暴露 node/electron 能力
 */
const electronAPI = {
  /**
   * 通用 IPC 调用（Promise 风格）
   * @param channel IPC 通道名，格式：domain:action
   * @param data 可选参数
   */
  invoke: <T = unknown>(channel: string, data?: unknown): Promise<T> => {
    return ipcRenderer.invoke(channel, data)
  },

  /**
   * 打开文件选择对话框
   * @param options 对话框选项
   */
  selectFile: (options?: {
    filters?: { name: string; extensions: string[] }[]
    title?: string
  }): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:selectFile', options)
  },

  /**
   * 打开保存对话框
   */
  saveFile: (options?: {
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
    title?: string
  }): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:saveFile', options)
  },

  /**
   * 获取应用数据目录
   */
  getUserDataPath: (): Promise<string> => {
    return ipcRenderer.invoke('app:getUserDataPath')
  },

  /**
   * 获取数据库文件路径
   */
  getDbPath: (): Promise<string> => {
    return ipcRenderer.invoke('app:getDbPath')
  },

  /**
   * 复制文件到指定位置（备份用）
   */
  copyFile: (src: string, dest: string): Promise<void> => {
    return ipcRenderer.invoke('fs:copyFile', { src, dest })
  },

  /**
   * 监听更新事件
   */
  onUpdateStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('update:status', (_e, status) => callback(status as string))
  },
  onUpdateAvailable: (callback: (info: { version: string; currentVersion: string }) => void) => {
    ipcRenderer.on('update:available', (_e, info) => callback(info as { version: string; currentVersion: string }))
  },
  onUpdateProgress: (callback: (progress: { percent: number }) => void) => {
    ipcRenderer.on('update:progress', (_e, progress) => callback(progress as { percent: number }))
  },
  onUpdateError: (callback: (error: string) => void) => {
    ipcRenderer.on('update:error', (_e, error) => callback(error as string))
  },
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update:status')
    ipcRenderer.removeAllListeners('update:available')
    ipcRenderer.removeAllListeners('update:progress')
    ipcRenderer.removeAllListeners('update:error')
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// TypeScript 类型声明
export type ElectronAPI = typeof electronAPI
