/**
 * 软件更新页面 — 版本历史 / 更新检测 / 版本回退
 */
import { useState, useEffect } from 'react'

interface VersionItem {
  version: string
  date: string
  title: string
  changes: string[]
  fileSize?: string
  downloadUrl?: string
}

interface VersionHistory {
  currentVersion: string
  latestVersion: string
  serverUrl: string
  versions: VersionItem[]
}

export default function UpdatePage() {
  const [history, setHistory] = useState<VersionHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState('')
  const [config, setConfig] = useState<{ updateServerUrl: string; autoCheckUpdate: boolean; currentVersion: string } | null>(null)

  // 更新检测状态
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [error, setError] = useState('')
  const [detail, setDetail] = useState('')

  // 本地 changelog
  const [localLog, setLocalLog] = useState('')

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const r = await window.electronAPI.invoke<{ code: number; data: any }>('settings:getUpdateConfig')
      if (r?.data) {
        setConfig(r.data)
        setUrl(r.data.updateServerUrl)
      }
    } catch { /* ignore */ }
  }

  const loadHistory = async () => {
    setLoading(true)
    try {
      const r = await window.electronAPI.invoke<{ code: number; data: VersionHistory }>('update:getVersionHistory')
      if (r?.data) setHistory(r.data)
      // also load local changelog
      const l = await window.electronAPI.invoke<{ code: number; data: { content: string } }>('update:getLocalChangelog')
      if (l?.data) setLocalLog(l.data.content)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  const saveUrl = async () => {
    try {
      await window.electronAPI.invoke('settings:setUpdateConfig', { updateServerUrl: url.trim() })
      setStatus('已保存')
      setTimeout(() => setStatus(''), 2000)
    } catch (e) { setError(String(e)) }
  }

  const checkUpdate = async () => {
    setChecking(true)
    setError(''); setDetail(''); setSteps([]); setStatus('checking')
    try {
      const r = await window.electronAPI.invoke<{ code: number; data: any }>('settings:checkForUpdate')
      const d = r?.data
      if (d?.error) {
        setError(d.error); setDetail(d.detail || ''); setSteps(d.steps || []); setStatus('error')
      } else {
        setStatus(d?.message || '')
        setSteps(d?.steps || [])
      }
      setChecking(false)
      loadConfig()
    } catch (e) {
      setError(String(e)); setStatus('error'); setChecking(false)
    }
  }

  const downloadVersion = async (v: VersionItem) => {
    if (!confirm(`确定要下载并安装版本 ${v.version}？\n${v.title || ''}`)) return
    setChecking(true)
    setStatus('downloading')
    try {
      const r = await window.electronAPI.invoke<{ code: number; data: any }>('update:downloadVersion', { version: v.version, url: v.downloadUrl })
      if (r?.data?.error) setError(r.data.error)
      else setStatus(r?.data?.message || `已下载 v${v.version}`)
    } catch (e) { setError(String(e)) }
    finally { setChecking(false) }
  }

  const stLabel: Record<string, { text: string; color: string; bg: string }> = {
    checking: { text: '检查中...', color: 'text-blue-600', bg: '#eff6ff' },
    'up-to-date': { text: '当前已是最新', color: 'text-green-600', bg: '#f0fdf4' },
    downloading: { text: '下载中...', color: 'text-amber-600', bg: '#fffbeb' },
    error: { text: '出错', color: 'text-red-600', bg: '#fef2f2' },
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-5">
      <h1 className="text-xl font-bold">🔄 软件更新</h1>

      {/* 当前版本 + 服务器配置 */}
      <div className="bg-white border border-border rounded-card p-5 shadow-card space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">当前版本:</span>
            <span className="font-mono font-bold text-primary">{config?.currentVersion || '—'}</span>
          </div>
          {history && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">服务器最新:</span>
              <span className={`font-mono font-bold ${history.latestVersion !== history.currentVersion ? 'text-amber-600' : 'text-green-600'}`}>
                {history.latestVersion || '未知'}
              </span>
              {history.latestVersion !== history.currentVersion && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">可更新</span>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="http://8.137.8.78:8080/"
            className="flex-1 border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary font-mono" />
          <button onClick={saveUrl} className="px-4 py-2 bg-primary-500 text-white text-sm rounded-btn hover:bg-primary/90">保存</button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={checkUpdate} disabled={checking || !url.trim()}
            className="px-5 py-2.5 bg-primary-500 text-white rounded-btn hover:bg-primary/90 disabled:opacity-40 font-medium">
            {checking ? '检查中...' : '🔍 检查更新'}
          </button>
          <button onClick={loadHistory} disabled={loading}
            className="px-4 py-2 border border-border rounded-btn text-sm hover:bg-warm/30">
            {loading ? '加载中...' : '📋 加载版本历史'}
          </button>
        </div>

        {/* 步骤日志 */}
        {steps.length > 0 && (
          <div className="bg-gray-50 border border-border rounded-card p-3 text-xs space-y-0.5 font-mono max-h-36 overflow-y-auto">
            {steps.map((s, i) => (
              <div key={i} className={s.includes('❌') ? 'text-red-600' : s.includes('✅') ? 'text-green-600' : 'text-text-muted'}>
                {s}
              </div>
            ))}
          </div>
        )}

        {status && (() => {
          const sl = stLabel[status] || { text: status, color: 'text-text-muted', bg: '#f5f5f5' }
          return <div className={`text-xs ${sl.color} rounded-btn px-3 py-2`} style={{ backgroundColor: sl.bg }}>{sl.text}</div>
        })()}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-btn px-3 py-2">
            <div className="font-semibold">⚠️ {error}</div>
            {detail && <div className="text-red-500 mt-1 whitespace-pre-wrap">{detail}</div>}
          </div>
        )}
      </div>

      {/* 版本历史 */}
      {history && history.versions.length > 0 && (
        <div className="bg-white border border-border rounded-card shadow-card overflow-hidden">
          <div className="px-5 py-3 bg-primary/5 border-b border-primary/10 font-semibold text-primary text-sm">
            📜 版本历史
          </div>
          <div className="divide-y divide-border/50">
            {history.versions.map((v, i) => (
              <div key={v.version} className={`p-4 ${v.version === config?.currentVersion ? 'bg-primary/5' : ''}`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-mono font-bold text-primary">v{v.version}</span>
                  {v.version === config?.currentVersion && (
                    <span className="text-xs bg-primary text-white px-2 py-0.5 rounded">当前</span>
                  )}
                  {v.version === history.latestVersion && v.version !== config?.currentVersion && (
                    <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded">最新</span>
                  )}
                  <span className="text-xs text-text-muted">{v.date}</span>
                  {v.fileSize && <span className="text-xs text-text-muted">{v.fileSize}</span>}
                </div>
                {v.title && <div className="text-sm font-medium text-text-primary mb-1.5">{v.title}</div>}
                {v.changes.length > 0 && (
                  <ul className="text-xs text-text-muted space-y-0.5 ml-4 list-disc">
                    {v.changes.map((c, j) => <li key={j}>{c}</li>)}
                  </ul>
                )}
                {/* 版本回退按钮 */}
                {v.version !== config?.currentVersion && (
                  <button onClick={() => downloadVersion(v)}
                    disabled={checking}
                    className="mt-2 text-xs text-primary border border-primary/30 px-3 py-1 rounded-btn hover:bg-primary/5 disabled:opacity-40">
                    ⬇️ 切换到此版本
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 本地 CHANGELOG */}
      {localLog && (
        <div className="bg-white border border-border rounded-card p-5 shadow-card">
          <details>
            <summary className="text-sm font-medium text-text-muted cursor-pointer">📝 本地更新日志 (CHANGELOG.md)</summary>
            <pre className="mt-3 text-xs text-text-muted whitespace-pre-wrap font-mono max-h-60 overflow-y-auto bg-warm/30 p-3 rounded">{localLog}</pre>
          </details>
        </div>
      )}

      {!history?.versions?.length && !loading && (
        <div className="text-center text-text-muted/50 py-8 text-sm">
          点击"加载版本历史"查看服务器上可用的版本
        </div>
      )}
    </div>
  )
}
