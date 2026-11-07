/**
 * 异常中心
 * 超领 / 重复领取 / 多人领取 / 死亡后领取
 * 手动扫描生成；支持标记已核对、忽略、恢复待核实。
 */
import { useCallback, useEffect, useState } from 'react'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import { getAuth } from './LoginPage'

type ApiRes<T> = { code: number; data?: T; message?: string }

interface AnomalyRow {
  id: number
  type_code: string
  type_name?: string
  category?: string
  household_code?: string | null
  household_name?: string | null
  real_name?: string | null
  id_card?: string | null
  year?: number | null
  season?: string | null
  title: string
  detail?: string | null
  metric_value?: number | null
  reference_value?: number | null
  diff_value?: number | null
  severity: 'high' | 'medium' | 'low'
  status: 'open' | 'confirmed' | 'ignored'
  verified_by?: string | null
  verified_at?: string | null
  verified_note?: string | null
  created_at?: string | null
}

interface ListData { items: AnomalyRow[]; total: number; page: number; page_size: number }
interface StatsData {
  total: number
  status: { open: number; confirmed: number; ignored: number }
  by_type: Array<{ type_code: string; type_name: string; cnt: number; open_cnt: number }>
}

const TYPE_CFG: Record<string, { label: string; cls: string }> = {
  OVER_AREA: { label: '超领', cls: 'bg-red-50 text-red-600 border-red-200' },
  DUPLICATE_CLAIM: { label: '重复领取', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  MULTI_CLAIM: { label: '多人领取', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  DEATH_CLAIM: { label: '死亡后领取', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  open: { label: '待核实', cls: 'bg-amber-50 text-amber-700' },
  confirmed: { label: '已核对', cls: 'bg-emerald-50 text-emerald-700' },
  ignored: { label: '已忽略', cls: 'bg-slate-100 text-slate-500' },
}

const SEVERITY_CFG: Record<string, { label: string; cls: string }> = {
  high: { label: '高', cls: 'bg-red-500 text-white' },
  medium: { label: '中', cls: 'bg-amber-500 text-white' },
  low: { label: '低', cls: 'bg-slate-400 text-white' },
}

async function call<T>(channel: string, data?: unknown): Promise<T> {
  const res = await window.electronAPI.invoke<ApiRes<T>>(channel, data)
  if (!res || res.code !== 0 || res.data === undefined) throw new Error(res?.message || '请求失败')
  return res.data
}

const thisYear = new Date().getFullYear()
const years = Array.from({ length: 8 }, (_, i) => thisYear - i + 1)

export default function AnomalyCenterPage() {
  const { toast, show } = useToast()
  const [year, setYear] = useState(thisYear)
  const [typeCode, setTypeCode] = useState('')
  const [status, setStatus] = useState('open')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListData | null>(null)
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, st] = await Promise.all([
        call<ListData>('anomalies:list', { year, type_code: typeCode, status, search, page, page_size: 20 }),
        call<StatsData>('anomalies:stats', { year }),
      ])
      setData(list)
      setStats(st)
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }, [year, typeCode, status, search, page, show])

  useEffect(() => { load() }, [load])

  const handleScan = async () => {
    if (!window.confirm(`扫描 ${year} 年数据并生成异常记录？\n\n同一对象重复扫描不会重复生成；已有的核对/忽略状态会保留。`)) return
    setScanning(true)
    try {
      const res = await call<{ total: number; message: string; errors: string[] }>('anomalies:scan', { year })
      show('✓ ' + res.message)
      if (res.errors?.length) show('部分规则执行失败：' + res.errors[0], 'err')
      setPage(1)
      await load()
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setScanning(false)
    }
  }

  const handleVerify = async (row: AnomalyRow, next: 'confirmed' | 'ignored' | 'open') => {
    let note = ''
    if (next !== 'open') {
      const input = window.prompt(
        next === 'confirmed' ? '核对说明（可选，直接确定即可）' : '忽略原因（可选，直接确定即可）',
        ''
      )
      if (input === null) return
      note = input
    }
    try {
      const auth = getAuth()
      await call('anomalies:verify', { id: row.id, status: next, note, operator: auth?.display_name || '操作员' })
      show(next === 'open' ? '已恢复为待核实' : next === 'confirmed' ? '已标记为已核对' : '已忽略')
      await load()
    } catch (e) {
      show((e as Error).message, 'err')
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const typeOptions = stats?.by_type ?? []

  return (
    <div className="space-y-4">
      <Toast msg={toast?.msg} type={toast?.type} />

      <div className="bg-white border border-border rounded-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-text-primary">异常中心</h1>
          <select value={year} onChange={e => { setYear(Number(e.target.value)); setPage(1) }}
            className="border border-border rounded-btn px-3 py-1.5 text-sm bg-white outline-none">
            {years.map(y => <option key={y} value={y}>{y} 年度</option>)}
          </select>
          <button onClick={handleScan} disabled={scanning}
            className="px-4 py-1.5 bg-primary-500 text-white rounded-btn text-sm hover:bg-primary-600 disabled:opacity-50">
            {scanning ? '扫描中…' : '扫描生成异常'}
          </button>
          <span className="text-xs text-text-muted">手动扫描；重复扫描不会重复生成，已核对/已忽略状态会保留</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <button onClick={() => { setStatus('open'); setPage(1) }}
            className={`text-left border rounded-btn p-3 ${status === 'open' ? 'border-amber-300 bg-amber-50/60' : 'border-border'}`}>
            <div className="text-xs text-text-muted">待核实</div>
            <div className="text-xl font-bold text-amber-600">{stats?.status.open ?? 0}</div>
          </button>
          <button onClick={() => { setStatus('confirmed'); setPage(1) }}
            className={`text-left border rounded-btn p-3 ${status === 'confirmed' ? 'border-emerald-300 bg-emerald-50/60' : 'border-border'}`}>
            <div className="text-xs text-text-muted">已核对</div>
            <div className="text-xl font-bold text-emerald-600">{stats?.status.confirmed ?? 0}</div>
          </button>
          <button onClick={() => { setStatus('ignored'); setPage(1) }}
            className={`text-left border rounded-btn p-3 ${status === 'ignored' ? 'border-slate-300 bg-slate-50' : 'border-border'}`}>
            <div className="text-xs text-text-muted">已忽略</div>
            <div className="text-xl font-bold text-slate-500">{stats?.status.ignored ?? 0}</div>
          </button>
          <button onClick={() => { setStatus(''); setTypeCode(''); setPage(1) }}
            className={`text-left border rounded-btn p-3 ${!status && !typeCode ? 'border-primary-300 bg-primary-500/5' : 'border-border'}`}>
            <div className="text-xs text-text-muted">全部</div>
            <div className="text-xl font-bold text-primary">{stats?.total ?? 0}</div>
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={() => { setTypeCode(''); setPage(1) }}
            className={`px-3 py-1 rounded-full text-xs border ${!typeCode ? 'bg-primary-500 text-white border-primary-500' : 'border-border text-text-muted hover:bg-warm/40'}`}>
            全部类型
          </button>
          {typeOptions.map(t => {
            const cfg = TYPE_CFG[t.type_code] || { label: t.type_name, cls: '' }
            return (
              <button key={t.type_code} onClick={() => { setTypeCode(t.type_code); setPage(1) }}
                className={`px-3 py-1 rounded-full text-xs border ${typeCode === t.type_code ? 'bg-primary-500 text-white border-primary-500' : cfg.cls || 'border-border'}`}>
                {cfg.label} {t.cnt}{t.open_cnt > 0 ? `（待核实 ${t.open_cnt}）` : ''}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
            className="border border-border rounded-btn px-2.5 py-1.5 text-sm bg-white outline-none">
            <option value="">全部状态</option>
            <option value="open">待核实</option>
            <option value="confirmed">已核对</option>
            <option value="ignored">已忽略</option>
          </select>
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput.trim()); setPage(1) } }}
            placeholder="户名 / 户编码 / 姓名"
            className="border border-border rounded-btn px-2.5 py-1.5 text-sm outline-none focus:border-primary-500 w-56" />
          <button onClick={() => { setSearch(searchInput.trim()); setPage(1) }}
            className="px-3 py-1.5 border border-border rounded-btn text-sm text-text-secondary hover:bg-warm/30">搜索</button>
          {loading && <span className="text-xs text-text-muted">加载中…</span>}
        </div>
      </div>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-warm/30 text-text-muted border-b border-border">
                <th className="text-left px-3 py-2.5">类型</th>
                <th className="text-left px-3 py-2.5">对象</th>
                <th className="text-left px-3 py-2.5">年度/季节</th>
                <th className="text-left px-3 py-2.5">异常说明</th>
                <th className="text-right px-3 py-2.5">实际</th>
                <th className="text-right px-3 py-2.5">参考</th>
                <th className="text-right px-3 py-2.5">差额</th>
                <th className="text-left px-3 py-2.5">严重度</th>
                <th className="text-left px-3 py-2.5">状态</th>
                <th className="text-left px-3 py-2.5">核实</th>
                <th className="text-left px-3 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map(row => {
                const t = TYPE_CFG[row.type_code] || { label: row.type_name || row.type_code, cls: '' }
                const s = STATUS_CFG[row.status]
                const sv = SEVERITY_CFG[row.severity]
                return (
                  <tr key={row.id} className="border-b border-border/60 hover:bg-warm/20">
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full border text-xs ${t.cls}`}>{t.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.household_name
                        ? <span>{row.household_name}<span className="text-text-muted"> {row.household_code}</span></span>
                        : <span>{row.real_name || '—'}<span className="text-text-muted font-mono ml-1">{row.id_card}</span></span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.year || '—'}{row.season ? ` / ${row.season}` : ''}</td>
                    <td className="px-3 py-2.5 max-w-[280px]">
                      <div className="font-medium text-text-primary">{row.title}</div>
                      {row.detail && <div className="text-text-muted mt-0.5" title={row.detail}>{row.detail}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{row.metric_value ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{row.reference_value ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-red-600">{row.diff_value ?? '—'}</td>
                    <td className="px-3 py-2.5"><span className={`px-1.5 py-0.5 rounded text-xs ${sv.cls}`}>{sv.label}</span></td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-xs ${s.cls}`}>{s.label}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.verified_by
                        ? <span>{row.verified_by}<span className="text-text-muted"> {row.verified_at?.slice(0, 16)}</span></span>
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex gap-1.5">
                        {row.status !== 'confirmed' && (
                          <button onClick={() => handleVerify(row, 'confirmed')} className="text-emerald-600 hover:underline">核对</button>
                        )}
                        {row.status !== 'ignored' && (
                          <button onClick={() => handleVerify(row, 'ignored')} className="text-slate-500 hover:underline">忽略</button>
                        )}
                        {row.status !== 'open' && (
                          <button onClick={() => handleVerify(row, 'open')} className="text-text-muted hover:underline">恢复</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {(data?.items || []).length === 0 && (
                <tr><td colSpan={11} className="py-10 text-center text-text-muted">
                  {scanning ? '扫描中…' : '暂无异常记录，点击“扫描生成异常”'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-text-muted">
          <span>共 {data?.total ?? 0} 条</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-2.5 py-1 border border-border rounded disabled:opacity-40">上一页</button>
            <span>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-2.5 py-1 border border-border rounded disabled:opacity-40">下一页</button>
          </div>
        </div>
      </div>
    </div>
  )
}
