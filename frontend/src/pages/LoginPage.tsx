/**
 * 登录页
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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [authDisabled, setAuthDisabledLocal] = useState(false)

  // 检测认证是否关闭
  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => {
        const disabled = !data.auth_enabled
        setAuthDisabled(disabled)  // 模块级变量
        setAuthDisabledLocal(disabled)
        if (disabled) return  // 不自动跳转，让用户选择
      })
      .catch(() => { /* 后端可能不支持，走默认登录 */ })
  }, [])

  // 已登录则跳转首页（useEffect 避免 render 中 navigate）
  useEffect(() => {
    if (getAuth()) navigate('/', { replace: true })
  }, [navigate])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || '登录失败') }
      const data = await r.json()
      saveAuth(data)
      navigate('/', { replace: true })
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
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
              className="w-full py-2.5 bg-primary text-white rounded-btn font-medium hover:bg-primary/90">
              直接进入系统
            </button>
          </div>
        ) : (
        <form onSubmit={handleLogin} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-100 rounded-btn px-3 py-2 text-sm text-red-600">{error}</div>}
          <div>
            <label className="block text-xs text-text-muted mb-1">用户名</label>
            <input value={username} onChange={e => setUsername(e.target.value)} autoFocus
              className="w-full border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary  rounded-btn font-medium hover:bg-primary/90 disabled:opacity-50">
            {loading ? '登录中…' : '登 录'}
          </button>
        </form>
        )}
      </div>
    </div>
  )
}
