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
    } catch (e) { return errorResponse('获取任务列表失败') }
  })

  ipcMain.handle('agri-tasks:get', (_e, id: number) => {
    try {
      const task = db().getRaw('SELECT * FROM agri_task WHERE id=?', id)
      if (!task) return errorResponse('任务不存在', 404)
      const allocations = db().allRaw('SELECT * FROM agri_task_allocation WHERE task_id=?', id)
      return success({ ...task, allocations })
    } catch (e) { return errorResponse('获取任务详情失败') }
  })

  ipcMain.handle('agri-tasks:create', (_e, data: Record<string, unknown>) => {
    try {
      if (!data.task_name) return errorResponse('任务名称不能为空')
      if (!data.total_area) return errorResponse('总面积不能为空')
      const cols = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const values = Object.keys(data).map(k => data[k])
      const r = db().runRaw(`INSERT INTO agri_task (${cols}) VALUES (${placeholders})`, ...values)
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse('创建任务失败') }
  })

  ipcMain.handle('agri-tasks:delete', (_e, id: number) => {
    try {
      db().runRaw('DELETE FROM agri_task_allocation WHERE task_id=?', id)
      db().runRaw('DELETE FROM agri_task WHERE id=?', id)
      return success({ message: '已删除' })
    } catch (e) { return errorResponse('删除任务失败') }
  })

  ipcMain.handle('agri-tasks:preview', (_e, id: number) => {
    try {
      const task = db().getRaw('SELECT * FROM agri_task WHERE id=?', id)
      if (!task) return errorResponse('任务不存在')
      const allocations = db().allRaw(
        `SELECT ata.*, v.village_name
         FROM agri_task_allocation ata
         LEFT JOIN village v ON ata.village_id = v.id
         WHERE ata.task_id=? ORDER BY v.village_name`, id
      )
      return success({ task, allocations })
    } catch (e) { return errorResponse('预览失败') }
  })

  ipcMain.handle('agri-tasks:issue', (_e, id: number) => {
    try {
      db().runRaw("UPDATE agri_task SET status='ISSUED' WHERE id=?", id)
      const count = db().getRaw<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM agri_task_allocation WHERE task_id=?', id
      )
      return success({ village_count: count?.cnt ?? 0 })
    } catch (e) { return errorResponse('下发失败') }
  })

  ipcMain.handle('agri-tasks:revoke', (_e, id: number) => {
    try {
      db().runRaw("UPDATE agri_task SET status='DRAFT' WHERE id=?", id)
      return success({ message: '已撤回' })
    } catch (e) { return errorResponse('撤回失败') }
  })

  ipcMain.handle('agri-tasks:done', (_e, id: number) => {
    try {
      db().runRaw("UPDATE agri_task SET status='DONE' WHERE id=?", id)
      return success({ message: '已标记完成' })
    } catch (e) { return errorResponse('操作失败') }
  })

  ipcMain.handle('agri-tasks:meta', () => {
    try {
      const totalTasks = (db().getRaw<{ cnt: number }>('SELECT COUNT(*) as cnt FROM agri_task'))?.cnt ?? 0
      const totalArea = (db().getRaw<{ sum: number }>('SELECT COALESCE(SUM(total_area),0) as sum FROM agri_task'))?.sum ?? 0
      return success({ total_tasks: totalTasks, total_area: totalArea })
    } catch (e) { return errorResponse('获取元数据失败') }
  })

  ipcMain.handle('agri-tasks:updateAllocation', (_e, payload: { taskId: number; villageId: number; actual_area: number }) => {
    try {
      const { taskId, villageId, actual_area } = payload
      db().runRaw(
        'UPDATE agri_task_allocation SET actual_area=? WHERE task_id=? AND village_id=?',
        actual_area, taskId, villageId
      )
      return success({ message: '已更新' })
    } catch (e) { return errorResponse('更新分配失败') }
  })

  ipcMain.handle('agri-tasks:getAllocations', (_e, taskId: number) => {
    try {
      const rows = db().allRaw('SELECT * FROM agri_task_allocation WHERE task_id = ?', taskId)
      return success(rows)
    } catch (e) { return errorResponse('获取分配记录失败') }
  })
}
