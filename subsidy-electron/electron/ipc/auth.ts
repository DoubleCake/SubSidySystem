import { ipcMain } from 'electron'
import { success, errorResponse } from './response'

/**
 * 简单本地认证 — 桌面应用用固定账号
 * 默认账号: admin / admin123
 */
const LOCAL_USERS: Record<string, { password: string; display_name: string; role: string }> = {
  admin: { password: 'admin123', display_name: '管理员', role: 'admin' },
}

let authEnabled = true
// token 简单递增
let tokenCounter = 1

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:status', () => {
    try {
      return success({ auth_enabled: authEnabled })
    } catch (e) { return errorResponse(String(e)) }
  })

  ipcMain.handle('auth:login', (_e, payload: { username: string; password: string }) => {
    try {
      const { username, password } = payload
      const user = LOCAL_USERS[username]
      if (!user || user.password !== password) {
        return errorResponse('用户名或密码错误', 401)
      }
      const token = `local_token_${tokenCounter++}_${Date.now()}`
      return success({
        token,
        user_id: 1,
        username,
        display_name: user.display_name,
        role: user.role,
      })
    } catch (e) { return errorResponse(String(e)) }
  })
}
