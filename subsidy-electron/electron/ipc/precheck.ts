import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { parsePagination, successList, success, errorResponse } from './response'

export function registerPrecheckHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('precheck:run', (_e, data: unknown) => {
    try {
      return success({ message: '预检功能开发中', results: [] })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('precheck:saveHistory', (_e, payload: any) => {
    try {
      return success({ saved: 0, batch_key: '' })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('precheck:listHistory', (_e, params: Record<string, unknown> = {}) => {
    try {
      return successList([], 0)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('precheck:listBatches', (_e, payload: any) => {
    try {
      return success({ batches: [] })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('precheck:resolveHistory', (_e, id: number) => {
    try {
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('precheck:unresolveHistory', (_e, id: number) => {
    try {
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('precheck:deleteHistory', (_e, id: number) => {
    try {
      return success(null)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('precheck:autoResolve', (_e, payload: any) => {
    try {
      return success({ resolved_count: 0, total: 0 })
    } catch (e) { return errorResponse(String(e)) }
  })
}
