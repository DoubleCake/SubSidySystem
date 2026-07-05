import { ipcMain } from 'electron'
import { success, errorResponse } from './response'

export function registerPrecheckHandlers(): void {
  ipcMain.handle('precheck:run', (_e, data: unknown) => {
    try {
      // 预检功能待实现 - 需要移植 services/precheck_service.py
      return success({ message: '预检功能开发中', results: [] })
    } catch (e) { return errorResponse(String(e)) }
  })
}
