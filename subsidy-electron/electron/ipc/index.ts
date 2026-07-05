import { ipcMain, dialog, app } from 'electron'
import { copyFileSync } from 'fs'
import { registerFarmerHandlers } from './farmers'
import { registerHouseholdHandlers } from './households'
import { registerSubsidyHandlers } from './subsidies'
import { registerAiHandlers } from './ai'
import { registerLandHandlers } from './land'
import { registerSettingsHandlers } from './settings'
import { registerPrecheckHandlers } from './precheck'
import { registerExcelTemplateHandlers } from './excel-templates'
import { registerErrorLibraryHandlers } from './error-library'
import { registerHouseholdImportHandlers } from './household-import'
import { registerAgriTaskHandlers } from './agri-tasks'
import { registerExternalLinksHandlers } from './external-links'
import { registerEligibilityHandlers } from './eligibility'
import { getDbPath } from '../database/connection'

/**
 * 注册所有 IPC 处理器
 */
export function registerAllIpcHandlers(): void {
  // ── 通用对话框 ──
  ipcMain.handle('dialog:selectFile', async (_e, options) => {
    const result = await dialog.showOpenDialog({
      title: options?.title || '选择文件',
      filters: options?.filters || [{ name: 'Excel文件', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_e, options) => {
    const result = await dialog.showSaveDialog({
      title: options?.title || '保存文件',
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: 'Excel文件', extensions: ['xlsx'] }],
    })
    return result.canceled ? null : result.filePath || null
  })

  // ── 应用信息 ──
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'))
  ipcMain.handle('app:getDbPath', () => getDbPath())

  // ── 文件操作 ──
  ipcMain.handle('fs:copyFile', (_e, { src, dest }: { src: string; dest: string }) => {
    copyFileSync(src, dest)
  })

  // ── 业务领域 handlers ──
  registerFarmerHandlers()
  registerHouseholdHandlers()
  registerSubsidyHandlers()
  registerAiHandlers()
  registerLandHandlers()
  registerSettingsHandlers()
  registerPrecheckHandlers()
  registerExcelTemplateHandlers()
  registerErrorLibraryHandlers()
  registerHouseholdImportHandlers()
  registerAgriTaskHandlers()
  registerExternalLinksHandlers()
  registerEligibilityHandlers()
}
