import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { success, errorResponse } from './response'
import { hashPassword, verifyPassword, isLegacyPassword } from '../utils/crypto'
import logger from '../utils/logger'

let authEnabled = true
let tokenCounter = 1

export function registerAuthHandlers(): void {

  ipcMain.handle('auth:status', () => {
    try {
      return success({ auth_enabled: authEnabled })
    } catch (e) { return errorResponse('认证服务异常') }
  })

  ipcMain.handle('auth:login', (_e, payload: { username: string; password: string }) => {
    try {
      const { username, password } = payload
      const user = getDb().getRaw<{ id: number; password: string; display_name: string; role: string; is_active: number }>(
        'SELECT * FROM users WHERE username=? AND is_active=1', username
      )
      if (!user || !verifyPassword(password, user.password)) {
        logger.warn('登录失败', { username })
        return errorResponse('用户名或密码错误', 401)
      }
      // 旧密码自动升级为哈希
      if (isLegacyPassword(user.password)) {
        getDb().runRaw('UPDATE users SET password=? WHERE id=?', hashPassword(password), user.id)
      }
      const token = `local_token_${tokenCounter++}_${Date.now()}`
      logger.info('用户登录', { username, role: user.role })
      return success({
        token, user_id: user.id, username,
        display_name: user.display_name, role: user.role,
      })
    } catch (e) { return errorResponse('登录服务异常') }
  })

  ipcMain.handle('auth:listUsers', () => {
    try {
      const rows = getDb().allRaw<Record<string, unknown>>(
        'SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY id'
      )
      return success(rows.map(r => ({ ...r, password: undefined })))
    } catch (e) { return errorResponse('获取用户列表失败') }
  })

  ipcMain.handle('auth:createUser', (_e, form: any) => {
    try {
      if (!form.username?.trim()) return errorResponse('用户名不能为空')
      if (!form.password || String(form.password).length < 4) return errorResponse('密码至少4位')
      const exist = getDb().getRaw<{ id: number }>('SELECT id FROM users WHERE username=?', form.username)
      if (exist) return errorResponse('用户名已存在')
      const r = getDb().runRaw(
        'INSERT INTO users (username, password, display_name, role, is_active) VALUES (?,?,?,?,?)',
        form.username, hashPassword(form.password), form.display_name || '', form.role || 'user', form.is_active ?? 1
      )
      logger.audit('创建用户', form.username, 'users', { id: r.lastInsertRowid, role: form.role })
      return success({ id: r.lastInsertRowid })
    } catch (e) { return errorResponse('创建用户失败') }
  })

  ipcMain.handle('auth:updateUser', (_e, payload: any) => {
    try {
      const { id, is_active, password, display_name, role } = payload
      if (!id) return errorResponse('缺少用户ID')
      const updates: string[] = []
      const vals: any[] = []
      if (is_active !== undefined) { updates.push('is_active=?'); vals.push(is_active) }
      if (password) { updates.push('password=?'); vals.push(hashPassword(password)) }
      if (display_name) { updates.push('display_name=?'); vals.push(display_name) }
      if (role) { updates.push('role=?'); vals.push(role) }
      if (updates.length === 0) return errorResponse('无更新数据')
      vals.push(id)
      getDb().runRaw(`UPDATE users SET ${updates.join(',')}, created_at=datetime('now','localtime') WHERE id=?`, ...vals)
      return success(null, '更新成功')
    } catch (e) { return errorResponse('更新用户失败') }
  })

  ipcMain.handle('auth:changePassword', (_e, pwdForm: any) => {
    try {
      if (!pwdForm.new_password || String(pwdForm.new_password).length < 4) return errorResponse('新密码至少4位')
      const user = getDb().getRaw<{ id: number; password: string }>(
        'SELECT * FROM users WHERE id=? AND is_active=1', pwdForm.user_id || 1
      )
      if (!user) return errorResponse('用户不存在')
      if (pwdForm.old_password && !verifyPassword(pwdForm.old_password, user.password)) {
        return errorResponse('原密码错误')
      }
      getDb().runRaw('UPDATE users SET password=? WHERE id=?', hashPassword(pwdForm.new_password), user.id)
      return success({ message: '密码已修改' })
    } catch (e) { return errorResponse('修改密码失败') }
  })
}
