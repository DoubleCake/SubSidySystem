/**
 * 数据备份与迁移页面
 * - 查看数据库信息（大小、各表记录数）
 * - 下载数据库文件（.db，可直接迁移）
 * - 导出全量 Excel（5个Sheet，可汇报/归档）
 * - 上传恢复数据库
 * - 创建/管理本地备份
 */
import { useState, useEffect } from 'react'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface BackupInfo {
  db_path: string; db_size_kb: number; db_size_mb: number
  total_records: number
  record_counts: {
    farmer_profile: number; family_household: number; village_group: number
    subsidy_type: number; subsidy_application: number
  }
  backups: { filename: string; size_kb: number; created: string }[]
  backup_dir: string
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

const TABLE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  farmer_profile:      { label: '农户档案',   icon: '👤', color: 'text-blue-600'   },
  family_household:    { label: '家庭户',     icon: '🏠', color: 'text-purple-600' },
  village_group:       { label: '村组配置',   icon: '🏘️', color: 'text-amber-600'  },
  subsidy_type:        { label: '补贴项目',   icon: '💰', color: 'text-primary'},
  subsidy_application: { label: '补贴申请记录', icon: '📋', color: 'text-rose-600'   },
}

export default function BackupPage() {
  const { toast, show } = useToast()
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [localBacking, setLocalBacking] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const loadInfo = async () => {
    try { setInfo(await req<BackupInfo>('/api/backup/info')) }
    catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadInfo() }, [])

  // 下载数据库文件
  const downloadDb = () => {
    const a = document.createElement('a')
    a.href = '/api/backup/download'
    a.click()
  }

  // 导出 Excel
  const exportExcel = async () => {
    setExporting(true)
    try {
      const r = await fetch('/api/backup/export-excel')
      if (!r.ok) throw new Error('导出失败')
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toLocaleDateString('zh-CN').replace(/\//g, '')
      a.download = `补贴数据导出_${ts}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      show('✓ Excel 导出成功')
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setExporting(false) }
  }

  // 创建本地备份
  const createLocalBackup = async () => {
    setLocalBacking(true)
    try {
      const r = await req<{ message: string; filename: string; size_kb: number }>('/api/backup/auto', { method: 'POST' })
      show(`✓ ${r.message}：${r.filename}（${r.size_kb} KB）`)
      loadInfo()
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setLocalBacking(false) }
  }

  // 上传恢复
  const handleRestore = async () => {
    if (!restoreFile) return show('请先选择数据库文件', 'err')
    if (!confirmRestore) return show('请勾选确认框后再执行恢复', 'err')
    setRestoring(true)
    try {
      const fd = new FormData()
      fd.append('file', restoreFile)
      const r = await fetch('/api/backup/restore', { method: 'POST', body: fd })
      const d = await r.json() as { message: string; backup_created: string }
      if (!r.ok) throw new Error((d as { detail?: string }).detail || '恢复失败')
      show(`✓ ${d.message}`)
      setRestoreFile(null); setConfirmRestore(false)
      setTimeout(loadInfo, 500)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setRestoring(false) }
  }

  // 删除备份
  const deleteBackup = async (filename: string) => {
    if (!confirm(`确认删除备份 ${filename}？此操作不可恢复`)) return
    try {
      await req(`/api/backup/backups/${filename}`, { method: 'DELETE' })
      show('✓ 已删除'); loadInfo()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  if (loading) return <div className="text-center py-20 text-text-muted/50">加载中…</div>

  return (
    <div className="max-w-4xl">
      {/* 数据库概况 */}
      <div className="bg-white border border-border rounded-card overflow-hidden shadow-card mb-5">
        <div className="px-5 py-3 bg-warm/30 border-b border-border/50">
          <span className="font-semibold text-text-primary text-sm">📊 当前数据库状态</span>
          {info && <span className="ml-3 text-xs text-text-muted font-mono">{info.db_path}</span>}
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-warm/30 rounded-card p-4 text-center">
              <div className="text-2xl font-bold font-mono text-text-primary">{info?.db_size_mb} MB</div>
              <div className="text-xs text-text-muted mt-1">数据库大小</div>
            </div>
            <div className="bg-primary/5 rounded-card p-4 text-center">
              <div className="text-2xl font-bold font-mono text-primary">{info?.total_records.toLocaleString()}</div>
              <div className="text-xs text-text-muted mt-1">总记录数</div>
            </div>
            <div className="bg-blue-50 rounded-card p-4 text-center">
              <div className="text-2xl font-bold font-mono text-blue-600">{info?.backups.length ?? 0}</div>
              <div className="text-xs text-text-muted mt-1">本地备份数</div>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {info && Object.entries(info.record_counts).map(([key, count]) => {
              const cfg = TABLE_LABELS[key]
              return (
                <div key={key} className="border border-border rounded-card p-3 text-center">
                  <div className="text-lg mb-1">{cfg?.icon}</div>
                  <div className={`text-lg font-bold font-mono ${cfg?.color}`}>{count.toLocaleString()}</div>
                  <div className="text-xs text-text-muted mt-0.5">{cfg?.label}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        {/* 导出备份 */}
        <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
          <div className="px-5 py-3 bg-primary/5 border-b border-primary/10">
            <span className="font-semibold text-primary text-sm">⬇️ 导出 / 备份</span>
          </div>
          <div className="p-5 space-y-3">
            {/* 下载 .db */}
            <div className="border border-border rounded-card p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🗄️</span>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-text-primary mb-1">下载数据库文件 (.db)</div>
                  <p className="text-xs text-text-muted mb-3">完整迁移首选。换电脑时把这个文件复制过去，直接放到新机器的项目目录即可，数据 100% 保留。</p>
                  <button onClick={downloadDb}
                    className="w-full py-2 bg-primary  text-sm rounded-btn hover:bg-primary/90">
                    ⬇️ 下载 subsidy.db
                  </button>
                </div>
              </div>
            </div>

            {/* 导出 Excel */}
            <div className="border border-border rounded-card p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">📊</span>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-text-primary mb-1">导出全量 Excel</div>
                  <p className="text-xs text-text-muted mb-3">包含5个Sheet：农户档案、家庭户、补贴记录、补贴项目、村组配置。适合归档上报，或在无法安装系统时查阅数据。</p>
                  <button onClick={exportExcel} disabled={exporting}
                    className="w-full py-2 border border-primary/20 text-primary text-sm rounded-btn hover:bg-primary/5 disabled:opacity-60">
                    {exporting ? '生成中…' : '📊 导出 Excel（5 Sheet）'}
                  </button>
                </div>
              </div>
            </div>

            {/* 创建本地备份 */}
            <div className="border border-border rounded-card p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">📁</span>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-text-primary mb-1">创建本地备份</div>
                  <p className="text-xs text-text-muted mb-3">在服务器的 backups/ 目录创建带时间戳的副本，方便日常增量备份，不占用下载流量。</p>
                  <button onClick={createLocalBackup} disabled={localBacking}
                    className="w-full py-2 border border-border text-text-primary text-sm rounded-btn hover:bg-warm/30 disabled:opacity-60">
                    {localBacking ? '备份中…' : '📁 创建本地备份'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 恢复数据库 */}
        <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
            <span className="font-semibold text-amber-800 text-sm">⬆️ 恢复数据库</span>
          </div>
          <div className="p-5">
            <div className="bg-red-50 border border-red-200 rounded-card p-4 mb-4">
              <p className="text-xs text-red-700 font-semibold mb-1">⚠️ 注意事项</p>
              <ul className="text-xs text-red-600 space-y-1 list-disc ml-3">
                <li>恢复会<strong>完全替换</strong>当前数据库，操作不可撤销</li>
                <li>恢复前系统会自动创建一个应急备份</li>
                <li>恢复后需要重启后端服务才能生效</li>
                <li>只接受 .db 格式的 SQLite 数据库文件</li>
              </ul>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">选择数据库文件 (.db)</label>
                <input type="file" accept=".db"
                  onChange={e => setRestoreFile(e.target.files?.[0] || null)}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm" />
                {restoreFile && (
                  <p className="text-xs text-primary mt-1">
                    ✓ 已选择：{restoreFile.name}（{(restoreFile.size / 1024).toFixed(1)} KB）
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={confirmRestore} onChange={e => setConfirmRestore(e.target.checked)}
                  className="w-4 h-4" />
                <span className="text-xs text-text-primary">我已了解风险，确认执行数据库恢复操作</span>
              </label>

              <button onClick={handleRestore} disabled={restoring || !restoreFile || !confirmRestore}
                className="w-full py-2.5 bg-red-600  text-sm rounded-btn hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {restoring ? '恢复中，请勿关闭…' : '🔄 执行数据库恢复'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 本地备份列表 */}
      <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
        <div className="px-5 py-3 bg-warm/30 border-b border-border/50 flex justify-between items-center">
          <span className="font-semibold text-text-primary text-sm">📁 本地备份记录</span>
          <span className="text-xs text-text-muted">{info?.backup_dir}</span>
        </div>
        {!info?.backups.length
          ? <div className="py-10 text-center text-text-muted/50 text-sm">暂无本地备份，点击「创建本地备份」生成第一个</div>
          : <table className="w-full border-collapse">
              <thead><tr className="border-b border-border/50">
                {['文件名', '大小', '创建时间', '操作'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-semibold">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {info.backups.map(b => (
                  <tr key={b.filename} className="border-b border-border/50 hover:bg-warm/30">
                    <td className="px-4 py-2.5 text-sm font-mono text-text-primary">{b.filename}</td>
                    <td className="px-4 py-2.5 text-sm text-text-muted">{b.size_kb} KB</td>
                    <td className="px-4 py-2.5 text-sm text-text-muted">{b.created}</td>
                    <td className="px-4 py-2.5 flex gap-2">
                      <a href={`/api/backup/backups/${b.filename}`} download={b.filename}
                        className="text-xs text-primary border border-primary/20 px-2.5 py-1 rounded-btn hover:bg-primary/5">
                        下载
                      </a>
                      <button onClick={() => deleteBackup(b.filename)}
                        className="text-xs text-red-400 border border-red-200 px-2.5 py-1 rounded-btn hover:bg-red-50">
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>

      {/* 迁移指南 */}
      <div className="bg-blue-50 border border-blue-100 rounded-card p-5 mt-5">
        <h3 className="font-semibold text-blue-800 text-sm mb-3">📖 换电脑迁移指南</h3>
        <div className="grid grid-cols-2 gap-4 text-xs text-blue-700">
          <div>
            <p className="font-semibold mb-1">方法一：迁移数据库文件（推荐）</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>在旧电脑点「下载 subsidy.db」</li>
              <li>在新电脑安装好系统（Python环境+依赖）</li>
              <li>把下载的 .db 文件放到新电脑项目根目录</li>
              <li>启动后端，所有数据完整恢复</li>
            </ol>
          </div>
          <div>
            <p className="font-semibold mb-1">方法二：整个项目文件夹复制</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>直接复制整个 subsidy_system/ 文件夹</li>
              <li>新电脑安装 Python 3.10+</li>
              <li>运行 <code className="bg-blue-100 px-1 rounded">pip install -r requirements.txt</code></li>
              <li>运行 <code className="bg-blue-100 px-1 rounded">python main.py</code> 启动</li>
            </ol>
          </div>
        </div>
      </div>

      <Toast {...toast} />
    </div>
  )
}
