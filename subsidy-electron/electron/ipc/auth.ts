import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'

/**
 * 用户认证 — 基于 SQLite users 表
 */
let authEnabled = true
let tokenCounter = 1

function ensureUsersTable() {
  try {
    getDb().runRaw(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        role TEXT DEFAULT 'user',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `)
    // 确保默认管理员存在
    const admin = getDb().getRaw<{ id: number }>('SELECT id FROM users WHERE username=?', 'admin')
    if (!admin) {
      getDb().runRaw("INSERT INTO users (username, password, display_name, role) VALUES (?,?,?,?)",
        'admin', 'admin123', '管理员', 'admin')
    }
  } catch { /* ignore */ }
}

export function registerAuthHandlers(): void {
  ensureUsersTable()

  ipcMain.handle('auth:status', () => {
    try {
      return success({ auth_enabled: authEnabled })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('auth:login', (_e, payload: { username: string; password: string }) => {
    try {
      const { username, password } = payload
      const user = getDb().getRaw<{ id: number; password: string; display_name: string; role: string; is_active: number }>(
        'SELECT * FROM users WHERE username=? AND is_active=1', username
      )
      if (!user || user.password !== password) {
        return errorResponse('用户名或密码错误', 401)
      }
      const token = `local_token_${tokenCounter++}_${Date.now()}`
      return success({
        token, user_id: user.id, username,
        display_name: user.display_name, role: user.role,
      })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('auth:listUsers', () => {
    try {
      const rows = getDb().allRaw<Record<string, unknown>>(
        'SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY id'
      )
      return success(rows.map(r => ({ ...r, password: undefined })))
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('auth:createUser', (_e, form: any) => {
    try {
      const exist = getDb().getRaw<{ id: number }>('SELECT id FROM users WHERE username=?', form.username)
      if (exist) return errorResponse('用户名已存在')
      const r = getDb().runRaw(
        'INSERT INTO users (username, password, display_name, role, is_active) VALUES (?,?,?,?,?)',
        form.username, form.password || '123456', form.display_name || '', form.role || 'user', form.is_active ?? 1
      )
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('auth:updateUser', (_e, payload: any) => {
    try {
      const { id, is_active, password, display_name, role } = payload
      const updates: string[] = []
      const vals: any[] = []
      if (is_active !== undefined) { updates.push('is_active=?'); vals.push(is_active) }
      if (password) { updates.push('password=?'); vals.push(password) }
      if (display_name) { updates.push('display_name=?'); vals.push(display_name) }
      if (role) { updates.push('role=?'); vals.push(role) }
      if (updates.length === 0) return errorResponse('无更新数据')
      vals.push(id)
      getDb().runRaw(`UPDATE users SET ${updates.join(',')}, created_at=datetime('now','localtime') WHERE id=?`, ...vals)
      return success(null, '更新成功')
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('auth:changePassword', (_e, pwdForm: any) => {
    try {
      const user = getDb().getRaw<{ id: number; password: string }>(
        'SELECT * FROM users WHERE id=? AND is_active=1', pwdForm.user_id || 1
      )
      if (!user) return errorResponse('用户不存在')
      if (pwdForm.old_password && user.password !== pwdForm.old_password) {
        return errorResponse('原密码错误')
      }
      getDb().runRaw('UPDATE users SET password=? WHERE id=?', pwdForm.new_password, user.id)
      return success({ message: '密码已修改' })
    } catch (e) { return errorResponse(String(e)) }
  })
}
