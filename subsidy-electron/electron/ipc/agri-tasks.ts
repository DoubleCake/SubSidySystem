import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { parsePagination, successList, success, errorResponse } from './response'

export function registerAgriTaskHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('agri-tasks:list', (_e, params: Record<string, unknown> = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params)
      const countRow = db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM agri_task')
      const rows = db().allRaw('SELECT * FROM agri_task ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, offset)
      return successList(rows, countRow?.cnt ?? 0, page, pageSize)
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('agri-tasks:getAllocations', (_e, taskId: number) => {
    try {
      const rows = db().allRaw('SELECT * FROM agri_task_allocation WHERE task_id = ?', taskId)
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })
}
