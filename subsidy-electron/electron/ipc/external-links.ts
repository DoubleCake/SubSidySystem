import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

// ExternalSite 模型在 routers/external_links.py 中内联定义
// 这里创建对应的表并处理

export function registerExternalLinksHandlers(): void {
  const db = () => getDb()

  // 确保 external_site 表存在
  db().exec(`
    CREATE TABLE IF NOT EXISTS external_site (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )
  `)

  ipcMain.handle('external-links:list', () => {
    try {
      const rows = db().allRaw('SELECT * FROM external_site WHERE is_active = 1 ORDER BY sort_order')
      return success(rows)
    } catch (e) { return errorResponse(String(e)) }
  })
}
