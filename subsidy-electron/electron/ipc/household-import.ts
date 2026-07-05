import { ipcMain } from 'electron'
import { success, errorResponse } from './response'

export function registerHouseholdImportHandlers(): void {
  ipcMain.handle('household-import:preview', (_e, rows: unknown[]) => {
    try {
      return success({ message: '家庭户批量导入预览功能开发中', groups: [], row_errors: [], summary: { total_rows: 0, total_groups: 0, new_households: 0, merge_single: 0, merge_multi: 0, error_rows: 0 } })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('household-import:execute', (_e, rows: unknown[]) => {
    try {
      return success({ message: '家庭户批量导入执行功能开发中', created_households: 0, merged_households: 0, created_farmers: 0, skipped_farmers: 0, errors: [] })
    } catch (e) { return errorResponse(String(e)) }
  })
}
