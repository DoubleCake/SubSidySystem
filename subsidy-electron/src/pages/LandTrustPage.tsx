/**
 * 土地流转信息维护页
 * 管理家庭户之间的代耕代种/流转/出租关系（一年一签）
 *
 * 所有字段设计为可选，基础信息不完善也能录入
 * 数据可信度分级，未核实的数据有明确标注
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import Tag from '../components/Tag'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { fmt } from '../utils'

interface Trust {
  id: number
  owner_household_id: number;   owner_name: string;   owner_code: string
  operator_household_id: number | null; operator_name: string | null; operator_code: string | null
  trust_type: string;  trust_type_label: string
  area: number | null; trust_year: number
  start_date: string | null; end_date: string | null
  annual_fee: number | null; payment_method: string | null
  parcel_desc: string | null
  data_reliability: string; reliability_label: string
  affect_subsidy_calc: number
  note: string | null; operator: string | null
  is_active: number
  // 扩展字段：大户流转
  source_type?: 'normal' | 'large_farmer'
  large_farmer_name?: string
  large_farmer_type?: string
  large_farmer_type_label?: string
  parcel_village_name?: string
  parcel_group_no?: number
  is_high_standard?: number
  is_demonstration?: number
}

interface HHOption { id: number; household_code: string; household_name: string; head_name: string; village_full_name: string; land_area: number | null }

interface AreaSummary {
  contracted_area: number; trust_out_area: number; trust_in_area: number
  cultivable_area: number; applied_area: number
  is_overdrawn: boolean; overdraw_amount: number
  cultivable_note: string; has_trust_data: boolean
  subsidy_breakdown: { subsidy_name: string; applied_area: number; actual_amount: number }[]
  trust_records: Trust[]
}

const TRUST_TYPE_OPTS = [
  { val: 'ENTRUST',    label: '代耕代种', desc: '口头委托，无书面合同', icon: '🤝', color: 'blue' as const },
  { val: 'RENT',       label: '出租',     desc: '有书面租赁合同',       icon: '📄', color: 'green' as const },
  { val: 'TRANSFER',   label: '流转',     desc: '正式转让经营权',       icon: '🔄', color: 'purple' as const },
  { val: 'IDLE',       label: '撂荒',     desc: '土地闲置不耕种',       icon: '🌿', color: 'red' as const },
  { val: 'COLLECTIVE', label: '集体统一', desc: '村集体统一经营',       icon: '🏘️', color: 'amber' as const },
]

const RELIABILITY_OPTS = [
  { val: 'CERTIFIED',       label: '有书面合同', color: 'green' as const },
  { val: 'VILLAGE_CONFIRM', label: '村委确认',   color: 'blue' as const },
  { val: 'SELF_REPORT',     label: '农户自报',   color: 'amber' as const },
  { val: 'SUSPECTED',       label: '存疑',       color: 'red' as const },
]

const thisYear = new Date().getFullYear()
const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i)

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

const emptyForm = () => ({
  owner_household_id: null as number | null,
  operator_household_id: null as number | null,
  trust_type: 'ENTRUST',
  area: '' as string,
  trust_year: thisYear,
  start_date: '',
  end_date: '',
  annual_fee: '' as string,
  payment_method: '',
  parcel_desc: '',
  data_reliability: 'VILLAGE_CONFIRM',
  affect_subsidy_calc: 1,
  note: '',
})

export default function LandTrustPage() {
  const { toast, show } = useToast()
  const navigate = useNavigate()
  const [yearFilter, setYearFilter] = useState(thisYear)
  const [typeFilter, setTypeFilter] = useState('')
  const [list, setList]   = useState<Trust[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage]   = useState(1)
  const [loading, setLoading] = useState(false)
  // 流转来源类型：all=全部 normal=普通流转 large_farmer=大户流转
  const [sourceType, setSourceType] = useState<'all' | 'normal' | 'large_farmer'>('all')

  // 详情/面积汇总
  const [summaryHH, setSummaryHH]   = useState<HHOption | null>(null)
  const [summary, setSummary]       = useState<AreaSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  // 新增/编辑
  const [editOpen, setEditOpen]   = useState(false)
  const [editTarget, setEditTarget] = useState<Trust | null>(null)
  const [form, setForm]           = useState(emptyForm())
  const [ownerSearch, setOwnerSearch]   = useState('')
  const [ownerOpts, setOwnerOpts]       = useState<HHOption[]>([])
  const [operSearch, setOperSearch]     = useState('')
  const [operOpts, setOperOpts]         = useState<HHOption[]>([])

  // 家庭户查询弹窗（用于面积汇总）
  const [hhSearch, setHhSearch] = useState('')
  const [hhOpts, setHhOpts]     = useState<HHOption[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20' })
      if (yearFilter) p.set('year', String(yearFilter))
      if (typeFilter) p.set('trust_type', typeFilter)
      if (sourceType !== 'all') p.set('source_type', sourceType)

      const r = await req<{ total: number; items: Trust[] }>(`/api/land/all-trusts?${p}`)
      setList(r.items); setTotal(r.total)
    } finally { setLoading(false) }
  }, [page, yearFilter, typeFilter, sourceType])

  useEffect(() => { load() }, [load])

  // 家庭户搜索
  const searchHH = async (q: string, setOpts: (v: HHOption[]) => void) => {
    if (q.length < 1) { setOpts([]); return }
    const r = await req<HHOption[]>(`/api/land/search-household?q=${encodeURIComponent(q)}`).catch(() => [])
    setOpts(r)
  }

  useEffect(() => { searchHH(ownerSearch, setOwnerOpts) }, [ownerSearch])
  useEffect(() => { searchHH(operSearch, setOperOpts) }, [operSearch])
  useEffect(() => { searchHH(hhSearch, setHhOpts) }, [hhSearch])

  const loadSummary = async (hh: HHOption) => {
    setSummaryHH(hh); setSummary(null); setSummaryLoading(true)
    try {
      const r = await req<AreaSummary>(`/api/land/area-summary/${hh.id}?year=${yearFilter}`)
      setSummary(r)
    } finally { setSummaryLoading(false) }
  }

  const openAdd = () => {
    setEditTarget(null); setForm(emptyForm()); setOwnerSearch(''); setOperSearch('')
    setOwnerOpts([]); setOperOpts([]); setEditOpen(true)
  }

  const openEdit = (t: Trust) => {
    setEditTarget(t)
    setForm({
      owner_household_id: t.owner_household_id,
      operator_household_id: t.operator_household_id,
      trust_type: t.trust_type,
      area: t.area !== null ? String(t.area) : '',
      trust_year: t.trust_year,
      start_date: t.start_date || '',
      end_date: t.end_date || '',
      annual_fee: t.annual_fee !== null ? String(t.annual_fee) : '',
      payment_method: t.payment_method || '',
      parcel_desc: t.parcel_desc || '',
      data_reliability: t.data_reliability,
      affect_subsidy_calc: t.affect_subsidy_calc,
      note: t.note || '',
    })
    setOwnerSearch(t.owner_name); setOperSearch(t.operator_name || '')
    setEditOpen(true)
  }

  const submit = async () => {
    if (!form.owner_household_id) return show('请选择流出方（承包人）', 'err')
    if (!form.trust_year) return show('请选择流转年度', 'err')
    const payload = {
      ...form,
      area: form.area ? Number(form.area) : null,
      annual_fee: form.annual_fee ? Number(form.annual_fee) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      payment_method: form.payment_method || null,
      parcel_desc: form.parcel_desc || null,
      note: form.note || null,
    }
    try {
      if (editTarget) {
        await req(`/api/land/trusts/${editTarget.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        show('✓ 更新成功')
      } else {
        await req('/api/land/trusts', { method: 'POST', body: JSON.stringify(payload) })
        show('✓ 记录创建成功')
      }
      setEditOpen(false); load()
      if (summaryHH) loadSummary(summaryHH)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const del = async (id: number) => {
    if (!confirm('确认删除此流转记录？')) return
    await req(`/api/land/trusts/${id}`, { method: 'DELETE' })
    show('✓ 已删除'); load()
    if (summaryHH) loadSummary(summaryHH)
  }

  const sf = (k: keyof ReturnType<typeof emptyForm>, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const TRUST_COLOR: Record<string, 'blue'|'green'|'purple'|'red'|'amber'|'gray'> = {
    ENTRUST: 'blue', RENT: 'green', TRANSFER: 'purple', IDLE: 'red', COLLECTIVE: 'amber'
  }
  const TRUST_LABEL: Record<string, string> = {
    ENTRUST: '代耕代种', RENT: '出租', TRANSFER: '流转', IDLE: '撂荒', COLLECTIVE: '集体统一'
  }

  return (
    <div className="grid grid-cols-[1fr_340px] gap-4">
      {/* ── 左列：流转台账 ── */}
      <div>
        {/* 一级Tab切换：土地与大户 */}
        <div className="flex items-center gap-1 mb-4 border-b border-border">
          <button onClick={() => {}}
            className="px-4 py-2 text-sm font-semibold border-b-2 border-emerald-600 text-primary">
            土地流转
          </button>
          <button onClick={() => navigate('/settings/large-farmers')}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary border-b-2 border-transparent hover:border-border">
            大户管理
          </button>
        </div>
        {/* 工具栏 */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <select value={yearFilter} onChange={e => { setYearFilter(Number(e.target.value)); setPage(1) }}
            className="border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
            {years.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
            className="border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
            <option value="">所有类型</option>
            {TRUST_TYPE_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
          {/* 来源类型切换 */}
          <div className="flex border border-border rounded-btn overflow-hidden">
            <button onClick={() => { setSourceType('all'); setPage(1) }}
              className={`px-3 py-2 text-xs ${sourceType === 'all' ? 'bg-primary text-white' : 'bg-white text-text-primary hover:bg-warm/30'}`}>
              全部
            </button>
            <button onClick={() => { setSourceType('normal'); setPage(1) }}
              className={`px-3 py-2 text-xs ${sourceType === 'normal' ? 'bg-primary text-white' : 'bg-white text-text-primary hover:bg-warm/30'}`}>
              普通流转
            </button>
            <button onClick={() => { setSourceType('large_farmer'); setPage(1) }}
              className={`px-3 py-2 text-xs ${sourceType === 'large_farmer' ? 'bg-primary text-white' : 'bg-white text-text-primary hover:bg-warm/30'}`}>
              大户流转
            </button>
          </div>
          <span className="text-xs text-text-muted">共 {total} 条</span>
          {sourceType === 'normal' && (
            <button onClick={openAdd}
              className="ml-auto px-3 py-2 text-sm bg-primary text-white rounded-btn hover:bg-primary/90">
              ＋ 新增流转记录
            </button>
          )}
        </div>

        {/* 说明栏 */}
        <div className="bg-blue-50 border border-blue-100 rounded-card px-4 py-3 mb-4 text-xs text-blue-700 space-y-0.5">
          <p>流转记录是<strong>一年一签</strong>，每年需要更新。面积信息影响补贴超领预警的计算。</p>
          <p>所有字段均可选填，信息不完善时可只填流出方、年度和类型。</p>
          <p>可通过右上角切换查看<strong>普通流转</strong>或<strong>大户流转</strong>记录。</p>
        </div>

        {/* 列表 */}
        <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
          <table className="w-full border-collapse">
            <thead><tr className="bg-warm/30 border-b-2 border-border">
              {['流出方（承包人）','流入方（耕种人）','类型','面积','来源','可信度','补贴计算','操作'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs text-text-muted font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="text-center py-10 text-text-muted/50">加载中…</td></tr>}
              {!loading && list.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-text-muted/50 text-sm">
                  {yearFilter}年暂无流转记录
                </td></tr>
              )}
              {list.map(t => (
                <tr key={`${t.source_type || 'normal'}-${t.id}`} className="border-b border-border/50 hover:bg-warm/30">
                  <td className="px-3 py-2.5">
                    <div className="text-sm font-semibold">{t.owner_name}</div>
                    <div className="text-xs text-text-muted font-mono">{t.owner_code}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {t.source_type === 'large_farmer' ? (
                      <div className="text-sm">
                        <div className="font-semibold text-primary">{t.large_farmer_name}</div>
                        <div className="text-xs text-text-muted">{t.large_farmer_type_label || t.large_farmer_type}</div>
                      </div>
                    ) : t.operator_name ? (
                      <><div className="text-sm">{t.operator_name}</div>
                          <div className="text-xs text-text-muted font-mono">{t.operator_code}</div></>
                    ) : (
                      <span className="text-xs text-text-muted/50">— 无接收方</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><Tag label={t.trust_type_label} color={TRUST_COLOR[t.trust_type] || 'gray'} /></td>
                  <td className="px-3 py-2.5 text-sm font-mono">
                    {t.area !== null ? `${t.area}亩` : <span className="text-text-muted/50">未填</span>}
                    {t.parcel_desc && <div className="text-xs text-text-muted truncate max-w-20" title={t.parcel_desc}>{t.parcel_desc}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    {t.source_type === 'large_farmer' ? (
                      <Tag label="大户" color="amber" />
                    ) : (
                      <Tag label="普通" color="blue" />
                    )}
                  </td>
                  <td className="px-3 py-2.5"><Tag label={t.reliability_label} color={
                    t.data_reliability === 'CERTIFIED' ? 'green' :
                    t.data_reliability === 'VILLAGE_CONFIRM' ? 'blue' :
                    t.data_reliability === 'SELF_REPORT' ? 'amber' : 'red'
                  } /></td>
                  <td className="px-3 py-2.5">
                    {t.affect_subsidy_calc
                      ? <span className="text-xs text-primary">✓ 纳入计算</span>
                      : <span className="text-xs text-text-muted">仅记录</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {t.source_type !== 'large_farmer' && (
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(t)} className="text-xs border border-border text-text-muted px-2 py-1 rounded hover:border-border">编辑</button>
                        <button onClick={() => del(t.id)} className="text-xs border border-red-100 text-red-400 px-2 py-1 rounded hover:bg-red-50">删</button>
                      </div>
                    )}
                    {t.source_type === 'large_farmer' && (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border/50 bg-warm/10 flex justify-between text-xs text-text-muted">
            <span>共{total}条</span>
            <div className="flex gap-1">
              <button disabled={page<=1} onClick={() => setPage(p=>p-1)} className="px-2.5 py-1 border border-border rounded disabled:opacity-40">‹</button>
              <span className="px-2">{page}/{Math.max(1,Math.ceil(total/20))}</span>
              <button disabled={page*20>=total} onClick={() => setPage(p=>p+1)} className="px-2.5 py-1 border border-border rounded disabled:opacity-40">›</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 右列：面积汇总查询 ── */}
      <div>
        <div className="bg-white border border-border rounded-card p-4 shadow-card sticky top-4">
          <h3 className="font-semibold text-text-primary mb-3 text-sm">📐 家庭户面积汇总</h3>
          <p className="text-xs text-text-muted mb-2">搜索家庭户，查看承包+流转后的实际可耕种面积</p>

          {/* 家庭户搜索 */}
          <div className="relative mb-3">
            <input value={hhSearch} onChange={e => setHhSearch(e.target.value)}
              placeholder="输入户名、户主姓名搜索…"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
            {hhOpts.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-card shadow-lg z-10 max-h-48 overflow-y-auto">
                {hhOpts.map(h => (
                  <button key={h.id} onClick={() => { loadSummary(h); setHhSearch(''); setHhOpts([]) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-warm/30 border-b border-border/50 last:border-0">
                    <span className="font-semibold">{h.household_name}</span>
                    <span className="text-text-muted text-xs ml-2">{h.head_name}</span>
                    <span className="text-text-muted/50 text-xs ml-2">{h.village_full_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {summaryLoading && <div className="py-8 text-center text-text-muted/50 text-sm">计算中…</div>}

          {summary && summaryHH && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-semibold text-text-primary">{summaryHH.household_name}</span>
                <span className="text-xs text-text-muted">{yearFilter}年</span>
                {summary.is_overdrawn && <Tag label="超领预警" color="red" />}
              </div>

              {/* 面积分解卡片 */}
              <div className="space-y-2 mb-3">
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-xs text-text-muted">承包面积（权属）</span>
                  <span className="text-sm font-mono font-bold text-text-primary">
                    {summary.contracted_area > 0 ? `${summary.contracted_area}亩` : <span className="text-text-muted/50">未设置</span>}
                  </span>
                </div>
                {(summary.trust_out_area > 0 || summary.trust_in_area > 0) && (
                  <>
                    {summary.trust_out_area > 0 && (
                      <div className="flex justify-between items-center py-1.5 border-b border-border/50">
                        <span className="text-xs text-text-muted pl-2">— 流出/代出</span>
                        <span className="text-sm font-mono text-red-500">-{summary.trust_out_area}亩</span>
                      </div>
                    )}
                    {summary.trust_in_area > 0 && (
                      <div className="flex justify-between items-center py-1.5 border-b border-border/50">
                        <span className="text-xs text-text-muted pl-2">+ 流入/代耕</span>
                        <span className="text-sm font-mono text-primary">+{summary.trust_in_area}亩</span>
                      </div>
                    )}
                  </>
                )}
                <div className={`flex justify-between items-center py-2 rounded-btn px-2 ${summary.is_overdrawn ? 'bg-red-50' : 'bg-primary/5'}`}>
                  <span className="text-xs font-semibold text-text-primary">可耕种面积（超领基准）</span>
                  <span className={`text-sm font-mono font-bold ${summary.is_overdrawn ? 'text-red-700' : 'text-primary'}`}>
                    {summary.cultivable_area}亩
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-t border-border/50">
                  <span className="text-xs text-text-muted">已申报补贴面积</span>
                  <span className={`text-sm font-mono font-bold ${summary.applied_area > summary.cultivable_area && summary.cultivable_area > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {summary.applied_area}亩
                  </span>
                </div>
                {summary.is_overdrawn && (
                  <div className="bg-red-100 border border-red-200 rounded-btn px-3 py-2 text-xs text-red-700">
                    ⚠️ 超领 {summary.overdraw_amount}亩，需核查处理
                  </div>
                )}
                {!summary.is_overdrawn && summary.applied_area > 0 && (
                  <div className="text-xs text-text-muted text-right">
                    剩余可申报：{Math.max(0, summary.cultivable_area - summary.applied_area).toFixed(2)}亩
                  </div>
                )}
              </div>

              {/* 补贴明细 */}
              {summary.subsidy_breakdown.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted font-semibold mb-1.5">当年补贴占用明细</p>
                  <div className="space-y-1">
                    {summary.subsidy_breakdown.map((b, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-text-primary truncate flex-1">{b.subsidy_name}</span>
                        <span className="font-mono text-amber-600 ml-2">{b.applied_area}亩</span>
                        <span className="font-mono text-primary ml-2">{fmt(b.actual_amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!summary.has_trust_data && summary.contracted_area > 0 && (
                <p className="text-xs text-text-muted/50 mt-2 border-t border-border/50 pt-2">
                  暂无{yearFilter}年流转记录，超领判断仅基于承包面积
                </p>
              )}
            </div>
          )}

          {!summary && !summaryLoading && (
            <div className="py-6 text-center text-text-muted/50 text-xs">
              搜索并选择家庭户查看面积汇总
            </div>
          )}
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      <Modal open={editOpen} title={editTarget ? '编辑流转记录' : '新增流转记录'}
        onClose={() => setEditOpen(false)} onConfirm={submit} width={600}>
        <div className="space-y-4">

          {/* 类型选择 */}
          <div>
            <label className="block text-xs text-text-muted mb-2">流转类型 *</label>
            <div className="grid grid-cols-5 gap-1.5">
              {TRUST_TYPE_OPTS.map(o => (
                <div key={o.val} onClick={() => sf('trust_type', o.val)}
                  className={`border-2 rounded-card p-2 cursor-pointer transition-colors text-center
                    ${form.trust_type === o.val ? 'border-primary bg-primary/5' : 'border-border hover:border-border'}`}>
                  <div className="text-lg mb-0.5">{o.icon}</div>
                  <div className="text-xs font-semibold">{o.label}</div>
                  <div className="text-xs text-text-muted leading-tight mt-0.5 hidden xl:block">{o.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 流出方 */}
          <div>
            <label className="block text-xs text-text-muted mb-1">流出方（承包人）*</label>
            <div className="relative">
              <input value={ownerSearch}
                onChange={e => { setOwnerSearch(e.target.value); sf('owner_household_id', null) }}
                placeholder="输入户名或户主姓名搜索"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              {ownerOpts.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-card shadow-lg z-20 max-h-40 overflow-y-auto">
                  {ownerOpts.map(h => (
                    <button key={h.id} onClick={() => { sf('owner_household_id', h.id); setOwnerSearch(h.household_name); setOwnerOpts([]) }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-warm/30 border-b border-border/50 last:border-0">
                      <span className="font-semibold">{h.household_name}</span>
                      <span className="text-text-muted text-xs ml-2">{h.head_name}</span>
                      {h.land_area && <span className="text-primary text-xs ml-2">{h.land_area}亩</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {form.owner_household_id && <p className="text-xs text-primary mt-0.5">✓ 已选择</p>}
          </div>

          {/* 流入方（撂荒时可为空）*/}
          {form.trust_type !== 'IDLE' && form.trust_type !== 'COLLECTIVE' && (
            <div>
              <label className="block text-xs text-text-muted mb-1">
                流入方（实际耕种人）
                <span className="text-text-muted/50 ml-1">— 不填则视为无明确接收方</span>
              </label>
              <div className="relative">
                <input value={operSearch}
                  onChange={e => { setOperSearch(e.target.value); sf('operator_household_id', null) }}
                  placeholder="输入户名或户主姓名搜索（可不填）"
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
                {operOpts.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-card shadow-lg z-20 max-h-40 overflow-y-auto">
                    {operOpts.map(h => (
                      <button key={h.id} onClick={() => { sf('operator_household_id', h.id); setOperSearch(h.household_name); setOperOpts([]) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-warm/30 border-b border-border/50 last:border-0">
                        <span className="font-semibold">{h.household_name}</span>
                        <span className="text-text-muted text-xs ml-2">{h.head_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 年度 + 面积 + 地块描述 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">流转年度 *</label>
              <select value={form.trust_year} onChange={e => sf('trust_year', Number(e.target.value))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">面积（亩）<span className="text-text-muted/50">可不填</span></label>
              <input type="number" step="0.01" value={form.area} onChange={e => sf('area', e.target.value)}
                placeholder="如：3.5"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">年租金（元/亩）<span className="text-text-muted/50">可不填</span></label>
              <input type="number" step="0.01" value={form.annual_fee} onChange={e => sf('annual_fee', e.target.value)}
                placeholder="无偿/不清楚可不填"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">地块描述 <span className="text-text-muted/50">可不填（没有精确地块时用文字描述）</span></label>
            <input value={form.parcel_desc} onChange={e => sf('parcel_desc', e.target.value)}
              placeholder="如：东山坡靠路边那块、大门前三亩地"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>

          {/* 数据可信度 + 是否纳入计算 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">数据可信度</label>
              <select value={form.data_reliability} onChange={e => sf('data_reliability', e.target.value)}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                {RELIABILITY_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">补贴面积计算</label>
              <select value={form.affect_subsidy_calc} onChange={e => sf('affect_subsidy_calc', Number(e.target.value))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                <option value={1}>纳入计算（影响超领预警）</option>
                <option value={0}>仅作记录（不影响计算）</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">备注</label>
            <textarea rows={2} value={form.note} onChange={e => sf('note', e.target.value)}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
          </div>

          {form.trust_type === 'IDLE' && (
            <div className="bg-amber-50 border border-amber-200 rounded-card px-3 py-2.5 text-xs text-amber-700">
              ⚠️ 撂荒记录不计入流出面积（地还在，只是没种），但会在补贴资格规则中触发「要求土地未撂荒」检查。
            </div>
          )}
        </div>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}
