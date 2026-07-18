/**
 * 软件更新面板
 * - 显示当前版本
 * - 配置更新服务器地址
 * - 自动检查开关
 * - 手动检查更新
 */
import { useState, useEffect } from 'react'

interface UpdateConfig {
  updateServerUrl: string
  autoCheckUpdate: boolean
  lastUpdateCheck: string | null
  currentVersion: string
}

export default function UpdatePanel() {
  const [config, setConfig] = useState<UpdateConfig | null>(null)
  const [url, setUrl] = useState('')
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(0)
  const [speedInfo, setSpeedInfo] = useState('')
  const [error, setError] = useState('')
  const [detail, setDetail] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadConfig()
    // 监听更新事件
    window.electronAPI.onUpdateStatus((s: string) => {
      setStatus(s)
      if (s === 'up-to-date') setChecking(false)
      if (s === 'downloaded') setChecking(false)
    })
    window.electronAPI.onUpdateProgress((p: { percent: number; speedMB?: string }) => {
      setProgress(p.percent)
      if (p.speedMB) setSpeedInfo(p.speedMB)
    })
    window.electronAPI.onUpdateError((e: string) => {
      setError(e)
      setChecking(false)
    })
    return () => { window.electronAPI.removeUpdateListeners() }
  }, [])

  const loadConfig = async () => {
    try {
      const result = await window.electronAPI.invoke<{ code: number; data: UpdateConfig }>('settings:getUpdateConfig')
      if (result?.data) {
        setConfig(result.data)
        setUrl(result.data.updateServerUrl)
      }
    } catch { /* ignore */ }
  }

  const saveConfig = async () => {
    setSaving(true)
    try {
      await window.electronAPI.invoke('settings:setUpdateConfig', { updateServerUrl: url.trim() })
      setError('')
      setStatus('设置已保存')
      setTimeout(() => setStatus(''), 2000)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  const toggleAutoCheck = async () => {
    if (!config) return
    const next = !config.autoCheckUpdate
    try {
      await window.electronAPI.invoke('settings:setUpdateConfig', { autoCheckUpdate: next })
      setConfig({ ...config, autoCheckUpdate: next })
    } catch (e) { setError(String(e)) }
  }

  const checkForUpdate = async () => {
    setChecking(true)
    setError('')
    setDetail('')
    setSteps([])
    setStatus('checking')
    setProgress(0)
    try {
      const result = await window.electronAPI.invoke<{
        code: number; data: { message?: string; error?: string; version?: string; steps?: string[]; detail?: string; serverVersion?: string; currentVersion?: string }
      }>('settings:checkForUpdate')
      const d = result?.data
      if (d?.error) {
        setError(d.error)
        setDetail(d.detail || '')
        setSteps(d.steps || [])
        setStatus('error')
      } else if (d?.message) {
        setStatus(d.message)
        setSteps(d.steps || [])
      }
      setChecking(false)
      loadConfig()
    } catch (e) {
      setError(String(e))
      setStatus('error')
      setChecking(false)
    }
  }

  const statusLabel: Record<string, { text: string; color: string }> = {
    checking: { text: '正在检查更新...', color: 'text-blue-600' },
    'up-to-date': { text: '当前已是最新版本 ✓', color: 'text-green-600' },
    available: { text: '发现新版本！', color: 'text-amber-600' },
    downloaded: { text: '更新已下载，重启后安装', color: 'text-primary' },
    error: { text: '更新出错', color: 'text-red-600' },
  }

  const st = statusLabel[status] || { text: status, color: 'text-text-muted' }

  return (
    <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
      <div className="px-5 py-3 bg-primary-500/5 border-b border-primary-500/10">
        <span className="font-semibold text-primary text-sm">🔄 软件更新</span>
        {config && <span className="ml-3 text-xs text-text-muted font-mono">v{config.currentVersion}</span>}
      </div>
      <div className="p-5 space-y-4">

        {/* 更新服务器地址 */}
        <div>
          <label className="text-xs text-text-muted mb-1 block">更新服务器地址</label>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="http://8.137.8.78:8080/"
              className="flex-1 border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500 font-mono"
            />
            <button onClick={saveConfig} disabled={saving}
              className="px-4 py-2 bg-primary-500 text-white text-sm rounded-btn hover:bg-primary-500/90 disabled:opacity-50 whitespace-nowrap">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
          <p className="text-[11px] text-text-muted/60 mt-1">填写更新服务器根目录地址，如 http://8.137.8.78:8080/，程序会自动查找 latest.yml</p>
        </div>

        {/* 当前状态 + 操作 */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* 自动检查开关 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={config?.autoCheckUpdate ?? false} onChange={toggleAutoCheck}
              className="w-4 h-4" />
            <span className="text-xs text-text-primary">启动时自动检查</span>
          </label>

          <button onClick={checkForUpdate} disabled={checking || !url.trim()}
            className="px-4 py-2 bg-primary-500 text-white text-sm rounded-btn hover:bg-primary-500/90 disabled:opacity-40 transition-all">
            {checking ? '检查中...' : '🔍 立即检查更新'}
          </button>
        </div>

        {/* 进度条 */}
        {progress > 0 && progress < 100 && (
          <div className="space-y-1">
            <div className="w-full bg-border rounded-full h-2 overflow-hidden">
              <div className="bg-primary-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-text-muted">
              <span>{progress}%</span>
              {speedInfo && <span>{speedInfo}</span>}
            </div>
          </div>
        )}

        {/* 步骤日志 */}
        {steps.length > 0 && (
          <div className="bg-gray-50 border border-border rounded-card p-3 text-xs space-y-0.5 max-h-40 overflow-y-auto font-mono">
            {steps.map((s, i) => (
              <div key={i} className={s.includes('❌') ? 'text-red-600' : s.includes('✅') ? 'text-green-600' : s.includes('⚠️') ? 'text-amber-600' : 'text-text-muted'}>
                {s}
              </div>
            ))}
          </div>
        )}

        {/* 状态提示 */}
        {status && (
          <div className={`text-xs ${st.color} rounded-btn px-3 py-2`}
            style={{ backgroundColor: st.color === 'text-green-600' ? '#f0fdf4' : st.color === 'text-red-600' ? '#fef2f2' : st.color === 'text-amber-600' ? '#fffbeb' : '#eff6ff' }}>
            {st.text}
            {progress > 0 && progress < 100 && ` (${progress}%)`}
          </div>
        )}

        {/* 错误 + 诊断建议 */}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-btn px-3 py-2 space-y-1">
            <div className="font-semibold">⚠️ {error}</div>
            {detail && <div className="text-red-500 whitespace-pre-wrap">{detail}</div>}
          </div>
        )}

        {/* 最后检查时间 */}
        {config?.lastUpdateCheck && (
          <p className="text-[11px] text-text-muted/50">
            上次检查: {new Date(config.lastUpdateCheck).toLocaleString('zh-CN')}
          </p>
        )}
      </div>
    </div>
  )
}
