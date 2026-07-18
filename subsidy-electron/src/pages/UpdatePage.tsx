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

  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [detail, setDetail] = useState('')

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

  const loadVersions = async () => {
    setLoading(true)
    setError(''); setStatus('')
    try {
      // 同时获取版本历史和最新版本对比
      const [hist, check] = await Promise.all([
        window.electronAPI.invoke<{ code: number; data: VersionHistory }>('update:getVersionHistory'),
        window.electronAPI.invoke<{ code: number; data: any }>('settings:checkForUpdate'),
      ])
      if (hist?.data) setHistory(hist.data)
      if (check?.data) setStatus(check.data.message || '')
      loadConfig()
      // local changelog
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

  // 下载进度
  const [dlProgress, setDlProgress] = useState(0)
  const [dlSpeed, setDlSpeed] = useState('')
  const [downloadingVersion, setDownloadingVersion] = useState('')

  useEffect(() => {
    window.electronAPI.onUpdateProgress((p: any) => {
      setDlProgress(p.percent || 0)
      if (p.speedMB) setDlSpeed(p.speedMB)
    })
    window.electronAPI.onUpdateStatus((s: string) => {
      if (s === 'downloaded') setDlProgress(100)
    })
  }, [])

  const downloadVersion = async (v: VersionItem) => {
    const changes = v.changes?.length ? '\n\n更新内容:\n' + v.changes.map(c => '• ' + c).join('\n') : ''
    if (!confirm(`确定要安装版本 ${v.version}？\n\n${v.title || ''}${changes}`)) return
    setDownloadingVersion(v.version)
    setStatus('downloading')
    setDlProgress(0); setDlSpeed('')
    setError('')
    try {
      const r = await window.electronAPI.invoke<{ code: number; data: any }>('update:downloadVersion', { version: v.version, url: v.downloadUrl })
      if (r?.data?.error) { setError(r.data.error); setStatus('error') }
      else setStatus('downloaded')
    } catch (e) { setError(String(e)); setStatus('error') }
    finally { setDownloadingVersion('') }
  }

  const stLabel: Record<string, { text: string; color: string; bg: string }> = {
    'up-to-date': { text: '当前已是最新', color: 'text-green-600', bg: '#f0fdf4' },
    downloading: { text: '下载中...', color: 'text-amber-600', bg: '#fffbeb' },
    downloaded: { text: '下载完成，重启后安装', color: 'text-green-600', bg: '#f0fdf4' },
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
            className="flex-1 border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500 font-mono" />
          <button onClick={saveUrl} className="px-4 py-2 bg-primary-500 text-white text-sm rounded-btn hover:bg-primary-500/90">保存</button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={loadVersions} disabled={loading || !url.trim()}
            className="px-5 py-2.5 bg-primary-500 text-white rounded-btn hover:bg-primary-500/90 disabled:opacity-40 font-medium">
            {loading ? '加载中...' : '📋 加载版本列表'}
          </button>
        </div>

        {/* 下载进度条 */}
        {downloadingVersion && (
          <div className="space-y-1 bg-amber-50 border border-amber-200 rounded-card p-3">
            <div className="text-xs text-amber-700 mb-1 font-medium">正在下载 v{downloadingVersion} ...</div>
            {dlProgress > 0 && (
              <>
                <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full transition-all duration-300" style={{ width: `${dlProgress}%` }} />
                </div>
                <div className="flex justify-between text-xs text-text-muted">
                  <span>{dlProgress}%</span>
                  {dlSpeed && <span>{dlSpeed}</span>}
                </div>
              </>
            )}
          </div>
        )}
        {status && (() => {
          const sl = stLabel[status] || { text: status, color: 'text-text-muted', bg: '#f5f5f5' }
          return <div className={`text-xs ${sl.color} rounded-btn px-3 py-2`} style={{ backgroundColor: sl.bg }}>{sl.text}</div>
        })()}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-btn px-3 py-2">
            <div className="font-semibold">⚠️ {error}</div>
          </div>
        )}
      </div>

      {/* 版本历史 */}
      {history && history.versions.length > 0 && (
        <div className="bg-white border border-border rounded-card shadow-card overflow-hidden">
          <div className="px-5 py-3 bg-primary-500/5 border-b border-primary-500/10 font-semibold text-primary text-sm">
            📜 版本历史
          </div>
          <div className="divide-y divide-border/50">
            {history.versions.map((v, i) => (
              <div key={v.version} className={`p-4 ${v.version === config?.currentVersion ? 'bg-primary-500/5' : ''}`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-mono font-bold text-primary">v{v.version}</span>
                  {v.version === config?.currentVersion && (
                    <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded font-semibold">当前</span>
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
                {/* 安装/回退按钮 */}
                {v.version !== config?.currentVersion && (
                  <button onClick={() => downloadVersion(v)}
                    disabled={!!downloadingVersion}
                    className={`mt-2 px-4 py-2 rounded-btn disabled:opacity-60 font-bold shadow-md transition-all text-sm border-2 ${
                      downloadingVersion === v.version
                        ? 'bg-amber-500 text-white border-amber-600 shadow-amber-200 animate-pulse'
                        : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-200 border-emerald-600'
                    }`}>
                    {downloadingVersion === v.version ? `⏳ 下载中 ${dlProgress}%` : '⬇️ 安装此版本'}
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
