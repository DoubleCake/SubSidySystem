/**
 * 异常中心
 *
 * 超领 / 重复领取 / 多人领取 / 死亡后领取 四类异常的统一核对入口。
 * 扫描为手动触发，重复扫描不会重复生成；核对/忽略状态会保留。
 *
 * 注：身份证按用户要求明文显示（与 CLAUDE.md 脱敏约定冲突，已确认）。
 */
import { useCallback, useEffect, useState } from 'react'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import { getAuth } from './LoginPage'

interface ApiRes<T> { code: number; data?: T; message?: string }

interface AnomalyRow {
  id: number
  type_code: string
  type_name?: string | null
  household_id?: number | null
  household_name?: string | null
  household_code?: string | null
  farmer_id?: number | null
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
  OVER_AREA:       { label: '超领',       cls: 'bg-danger/10 text-danger' },
  DUPLICATE_CLAIM: { label: '重复领取',   cls: 'bg-[#FBF3E2] text-[#8A6118]' },
  MULTI_CLAIM:     { label: '多人领取',   cls: 'bg-[#E2EDE6] text-[#2F5C46]' },
  DEATH_CLAIM:     { label: '死亡后领取', cls: 'bg-[#FBF8F3] text-[#7A5A3A]' },
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  open:      { label: '待核实', cls: 'bg-[#FBF3E2] text-[#8A6118]' },
  confirmed: { label: '已核对', cls: 'bg-[#E2EDE6] text-[#2F5C46]' },
  ignored:   { label: '已忽略', cls: 'bg-[#F1EDE4] text-[#5C5749]' },
}

const SEVERITY_CFG: Record<string, { label: string; cls: string }> = {
  high:   { label: '高', cls: 'bg-danger/10 text-danger' },
  medium: { label: '中', cls: 'bg-[#FBF3E2] text-[#8A6118]' },
  low:    { label: '低', cls: 'bg-[#F1EDE4] text-[#5C5749]' },
}

async function call<T>(channel: string, data?: unknown): Promise<T> {
  const res = await window.electronAPI.invoke<ApiRes<T>>(channel, data)
  if (!res || res.code !== 0) throw new Error(res?.message || '请求失败')
  return res.data as T
}

const nowYear = new Date().getFullYear()
const YEARS = Array.from({ length: 6 }, (_, i) => nowYear + 1 - i)

function fmtNum(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export default function AnomalyCenterPage() {
  const { toast, show } = useToast()

  const [year, setYear] = useState(nowYear)
  const [status, setStatus] = useState<'open' | 'confirmed' | 'ignored' | ''>('open')
  const [typeCode, setTypeCode] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListData | null>(null)
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, st] = await Promise.all([
        call<ListData>('anomalies:list', { year, status: status || undefined, type_code: typeCode || undefined, search: search || undefined, page, page_size: 20 }),
        call<StatsData>('anomalies:stats', { year }),
      ])
      setData(list)
      setStats(st)
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }, [year, status, typeCode, search, page, show])

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
  const openCount = stats?.status.open ?? 0

  return (
    <div className="space-y-3">
      <Toast msg={toast?.msg} type={toast?.type} />

      {/* 页头 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold text-primary leading-tight">异常中心</h1>
          <div className="text-meta text-text-muted mt-1">超领、重复领取、多人领取、死亡后领取 · 手动扫描生成，重复扫描不会重复生成</div>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => { setYear(Number(e.target.value)); setPage(1) }}
            className="h-[30px] border border-border rounded-btn px-2.5 text-xs bg-white outline-none">
            {YEARS.map(y => <option key={y} value={y}>{y} 年度</option>)}
          </select>
          <button onClick={handleScan} disabled={scanning}
            className="h-[30px] px-3 ui-btn-primary text-xs disabled:opacity-50">
            {scanning ? '扫描中…' : '扫描生成异常'}
          </button>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <button onClick={() => { setStatus('open'); setPage(1) }}
          className={`text-left border rounded-card px-3.5 py-2.5 transition-colors ${status === 'open' ? 'border-[#F2E0B8] bg-[#FBF3E2]' : 'border-border bg-white hover:border-[#F2E0B8]'}`}>
          <div className="text-[11px] text-text-muted">待核实</div>
          <div className="text-[20px] font-bold font-mono text-[#8A6118]">{openCount}</div>
        </button>
        <button onClick={() => { setStatus('confirmed'); setPage(1) }}
          className={`text-left border rounded-card px-3.5 py-2.5 transition-colors ${status === 'confirmed' ? 'border-[#C4DACC] bg-[#F7FAF7]' : 'border-border bg-white hover:border-[#C4DACC]'}`}>
          <div className="text-[11px] text-text-muted">已核对</div>
          <div className="text-[20px] font-bold font-mono text-[#2F5C46]">{stats?.status.confirmed ?? 0}</div>
        </button>
        <button onClick={() => { setStatus('ignored'); setPage(1) }}
          className={`text-left border rounded-card px-3.5 py-2.5 transition-colors ${status === 'ignored' ? 'border-[#DCD6C8] bg-[#FAF8F2]' : 'border-border bg-white hover:border-[#DCD6C8]'}`}>
          <div className="text-[11px] text-text-muted">已忽略</div>
          <div className="text-[20px] font-bold font-mono text-[#5C5749]">{stats?.status.ignored ?? 0}</div>
        </button>
        <button onClick={() => { setStatus(''); setTypeCode(''); setPage(1) }}
          className={`text-left border rounded-card px-3.5 py-2.5 transition-colors ${!status && !typeCode ? 'border-primary-500/30 bg-[#F2F7F4]' : 'border-border bg-white hover:border-primary-500/30'}`}>
          <div className="text-[11px] text-text-muted">全部</div>
          <div className="text-[20px] font-bold font-mono text-primary">{stats?.total ?? 0}</div>
        </button>
      </div>

      {/* 类型筛选 + 搜索 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => { setTypeCode(''); setPage(1) }}
          className={`px-2.5 py-[3px] rounded-full text-[10.5px] border transition-colors ${!typeCode ? 'bg-primary text-[#FFFFFF] border-primary' : 'bg-white border-border text-text-muted hover:border-primary/30'}`}>
          全部类型
        </button>
        {typeOptions.map(t => {
          const cfg = TYPE_CFG[t.type_code] || { label: t.type_name, cls: '' }
          const active = typeCode === t.type_code
          return (
            <button key={t.type_code} onClick={() => { setTypeCode(t.type_code); setPage(1) }}
              className={`px-2.5 py-[3px] rounded-full text-[10.5px] border transition-colors whitespace-nowrap ${
                active ? 'border-primary bg-primary text-[#FFFFFF]' : `border-border bg-white hover:border-primary/30 ${cfg.cls.split(' ').pop()}`
              }`}>
              {cfg.label} {t.cnt}{t.open_cnt > 0 ? `（待核实 ${t.open_cnt}）` : ''}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-1.5">
          <select value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(1) }}
            className="h-[28px] border border-border rounded-btn px-2 text-[11px] bg-white outline-none">
            <option value="">全部状态</option>
            <option value="open">待核实</option>
            <option value="confirmed">已核对</option>
            <option value="ignored">已忽略</option>
          </select>
          <div className="flex items-center gap-1.5 border border-border rounded-btn px-2 h-[28px] w-[180px] bg-white">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7A7466" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput.trim()); setPage(1) } }}
              placeholder="户名 / 姓名"
              className="flex-1 text-[11px] outline-none bg-transparent" />
          </div>
          <button onClick={() => { setSearch(searchInput.trim()); setPage(1) }}
            className="h-[28px] px-2.5 border border-border rounded-btn text-[11px] text-text-secondary hover:bg-warm/30 transition-colors">搜索</button>
          {loading && <span className="text-[10px] text-text-muted">加载中…</span>}
        </div>
      </div>

      {/* 表格 */}
      <div className="bg-white border border-border rounded-card overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-[#F3EFE7] text-text-muted text-[10.5px] text-left border-b border-border">
                <th className="font-medium px-3 py-2">类型</th>
                <th className="font-medium px-1.5 py-2">对象</th>
                <th className="font-medium px-1.5 py-2">年度 / 季节</th>
                <th className="font-medium px-1.5 py-2">异常说明</th>
                <th className="font-medium px-1.5 py-2 text-right">实际</th>
                <th className="font-medium px-1.5 py-2 text-right">参考</th>
                <th className="font-medium px-1.5 py-2 text-right">差额</th>
                <th className="font-medium px-1.5 py-2">级别</th>
                <th className="font-medium px-1.5 py-2">状态</th>
                <th className="font-medium px-1.5 py-2">核实</th>
                <th className="font-medium px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map(row => {
                const t = TYPE_CFG[row.type_code] || { label: row.type_name || row.type_code, cls: '' }
                const s = STATUS_CFG[row.status]
                const sv = SEVERITY_CFG[row.severity]
                return (
                  <tr key={row.id} className="border-b border-[#E6E0D4] align-top hover:bg-[#F2F7F4] transition-colors">
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-[1px] rounded-[3px] text-[9.5px] ${t.cls}`}>{t.label}</span>
                    </td>
                    <td className="px-1.5 py-2">
                      {row.household_name
                        ? <div><div className="font-semibold">{row.household_name}</div><div className="text-[9.5px] text-text-muted font-mono">{row.household_code}</div></div>
                        : <div><div className="font-semibold">{row.real_name || '—'}</div><div className="text-[9.5px] text-text-muted font-mono">{row.id_card}</div></div>}
                    </td>
                    <td className="px-1.5 py-2 text-text-secondary whitespace-nowrap">{row.year || '—'}{row.season ? ` / ${row.season}` : ' / —'}</td>
                    <td className="px-1.5 py-2 max-w-[280px]">
                      <div className="font-medium">{row.title}</div>
                      {row.detail && <div className="text-[9.5px] text-text-muted mt-0.5 truncate" title={row.detail}>{row.detail}</div>}
                    </td>
                    <td className="px-1.5 py-2 text-right font-mono">{fmtNum(row.metric_value)}</td>
                    <td className="px-1.5 py-2 text-right font-mono">{fmtNum(row.reference_value)}</td>
                    <td className="px-1.5 py-2 text-right font-mono text-danger font-bold">{row.diff_value != null && row.diff_value > 0 ? '+' : ''}{fmtNum(row.diff_value)}</td>
                    <td className="px-1.5 py-2"><span className={`inline-block px-1.5 py-[1px] rounded-[2px] text-[9.5px] ${sv.cls}`}>{sv.label}</span></td>
                    <td className="px-1.5 py-2"><span className={`inline-block px-1.5 py-[1px] rounded-full text-[9.5px] ${s.cls}`}>{s.label}</span></td>
                    <td className="px-1.5 py-2 whitespace-nowrap">
                      {row.verified_by
                        ? <div><div>{row.verified_by}</div><div className="text-[9.5px] text-text-muted">{row.verified_at?.slice(5, 16).replace('T', ' ')}</div></div>
                        : <span className="text-[#C9C2B2]">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {row.status !== 'confirmed' && (
                          <button onClick={() => handleVerify(row, 'confirmed')} className="text-[11px] text-[#2F5C46] font-semibold hover:underline">核对</button>
                        )}
                        {row.status !== 'ignored' && (
                          <button onClick={() => handleVerify(row, 'ignored')} className="text-[11px] text-text-muted hover:underline">忽略</button>
                        )}
                        {row.status !== 'open' && (
                          <button onClick={() => handleVerify(row, 'open')} className="text-[11px] text-text-muted hover:underline">恢复</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {(data?.items || []).length === 0 && (
                <tr><td colSpan={11} className="py-12 text-center text-text-muted text-xs">
                  {scanning ? '扫描中…' : '暂无异常记录，点击右上角「扫描生成异常」'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-[10.5px] text-text-muted">
          <span>共 {data?.total ?? 0} 条 · 当前筛选：{status ? STATUS_CFG[status].label : '全部状态'}</span>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="h-6 px-2 border border-border rounded-[3px] bg-white disabled:opacity-40">上一页</button>
            <span className="px-1.5">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="h-6 px-2 border border-border rounded-[3px] bg-white disabled:opacity-40">下一页</button>
          </div>
        </div>
      </div>
    </div>
  )
}
