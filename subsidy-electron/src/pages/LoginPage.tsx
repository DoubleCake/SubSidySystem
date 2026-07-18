/**
 * 登录页 (Electron 版)
 * 默认账号: admin / admin123
 * 支持 AUTH_DISABLED 模式：本地使用时可直接跳过登录
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const AUTH_KEY = 'subsidy_auth'

interface AuthInfo {
  token: string; user_id: number; username: string; display_name: string; role: string
}

let _authDisabled: boolean | null = null

export function isAuthDisabled(): boolean | null {
  return _authDisabled
}

export function setAuthDisabled(v: boolean) {
  _authDisabled = v
}

export function getAuth(): AuthInfo | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveAuth(info: AuthInfo) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(info))
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY)
}

export function authHeaders(): Record<string, string> {
  const auth = getAuth()
  return auth ? { Authorization: `Bearer ${auth.token}` } : {}
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [authDisabled, setAuthDisabledLocal] = useState(false)

  // 检测认证是否关闭
  useEffect(() => {
    window.electronAPI.invoke<{ code: number; data: { auth_enabled: boolean } }>('auth:status')
      .then(result => {
        const disabled = !result?.data?.auth_enabled
        setAuthDisabled(disabled)
        setAuthDisabledLocal(disabled)
      })
      .catch(() => {
        // Electron IPC 异常时默认开启认证
      })
  }, [])

  // 已登录则跳转首页
  useEffect(() => {
    if (getAuth()) navigate('/', { replace: true })
  }, [navigate])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    setLoading(true); setError('')
    try {
      const result = await window.electronAPI.invoke<{ code: number; data: AuthInfo; message?: string }>(
        'auth:login',
        { username: username.trim(), password }
      )
      if (result.code !== 0) {
        throw new Error(result.message || '登录失败')
      }
      saveAuth(result.data!)
      navigate('/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-stone-100">
      <div className="bg-white rounded-card shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-text-primary">农户补贴管理系统</h1>
          <p className="text-sm text-text-muted mt-1">
            {authDisabled ? '认证已关闭，可直接进入系统' : '请登录后使用'}
          </p>
        </div>
        {authDisabled ? (
          <div className="space-y-3">
            <p className="text-xs text-text-muted text-center">
              检测到认证已关闭（AUTH_DISABLED），本地模式无需登录。
            </p>
            <button onClick={() => navigate('/')}
              className="w-full py-2.5 bg-primary-500 text-white rounded-btn font-medium hover:bg-primary-500/90">
              直接进入系统
            </button>
          </div>
        ) : (
        <form onSubmit={handleLogin} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-100 rounded-btn px-3 py-2 text-sm text-red-600">{error}</div>}
          <div>
            <label className="block text-xs text-text-muted mb-1">用户名</label>
            <input value={username} onChange={e => setUsername(e.target.value)} autoFocus
              className="w-full border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-primary-500" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary-500 text-white rounded-btn font-medium hover:bg-primary-500/90 disabled:opacity-50">
            {loading ? '登录中…' : '登 录'}
          </button>
          <p className="text-xs text-text-muted text-center mt-2">默认账号: admin / admin123</p>
        </form>
        )}
      </div>
    </div>
  )
}
