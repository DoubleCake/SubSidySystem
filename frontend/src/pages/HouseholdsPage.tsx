/**
 * 家庭户管理页面
 * 功能：
 *   - 列表：展示家庭户、承包面积、已占用面积、超领预警
 *   - 详情：成员列表 + 各补贴项面积占用明细
 *   - 编辑：修改承包面积、地址等
 *   - 超领预警 tab：单独列出所有超领家庭
 */
import { useState, useEffect, useCallback } from 'react'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { fmt, years } from '../utils'

// ─── 类型 ───
interface HouseholdItem {
  id: number
  household_code: string
  household_name: string
  village_full_name: string
  village_name: string
  head_name: string
  member_count: number
  status: number
  address: string | null
  remark: string | null
  contracted_area: number
  used_area: number
  remaining_area: number
  is_overdrawn: boolean
  overdraw_amount: number
}

interface HouseholdDetail {
  id: number
  household_code: string
  household_name: string
  village_full_name: string
  address: string | null
  contracted_area: number
  status: number
  remark: string | null
  members: {
    id: number; real_name: string; gender: number
    id_card_masked: string; is_head: number; relation: string | null
    farmer_status: number; phone_masked: string | null
  }[]
  area_usage: {
    contracted_area: number; used_area: number
    remaining_area: number; is_overdrawn: boolean
    overdraw_amount: number
    year_totals: Record<string, number>
    subsidy_breakdown: {
      subsidy_name: string; apply_year: number
      used_area: number; total_amount: number; app_count: number
    }[]
  }
  app_summary: {
    apply_year: number; farmer_name: string; subsidy_name: string
    calc_mode: string; apply_area: number | null
    apply_amount: number | null; actual_amount: number | null; pay_status: number
  }[]
}

interface OverdrawnItem {
  household_id: number; household_code: string; household_name: string
  head_name: string; village: string
  contracted_area: number; used_area: number; overdraw_amount: number; year: number
  subsidy_breakdown: { subsidy_name: string; apply_year: number; used_area: number }[]
}

const STATUS_MAP: Record<number, { label: string; color: 'green' | 'red' | 'amber' }> = {
  1: { label: '在册', color: 'green' },
  2: { label: '注销', color: 'red'   },
  3: { label: '迁出', color: 'amber' },
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

export default function HouseholdsPage() {
  const { toast, show } = useToast()
  const [tab, setTab] = useState<'list' | 'overdrawn'>('list')
  const [households, setHouseholds] = useState<HouseholdItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [villageFilter, setVillageFilter] = useState('')
  const [search, setSearch] = useState('')
  const [villages, setVillages] = useState<string[]>([])

  const [detail, setDetail] = useState<HouseholdDetail | null>(null)
  const [detailYear, setDetailYear] = useState<number | ''>('')
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<{ land_area?: number; address?: string; remark?: string }>({})

  const [overdrawn, setOverdrawn] = useState<OverdrawnItem[]>([])
  const [overdrawnLoading, setOverdrawnLoading] = useState(false)

  // 加载村名列表
  useEffect(() => {
    req<{ id: number; village_name: string }[]>('/api/village-groups').then(g =>
      setVillages([...new Set(g.map(v => v.village_name))])
    )
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page), page_size: '20',
        year: String(year),
      })
      if (villageFilter) params.set('village_name', villageFilter)
      if (search)        params.set('search', search)
      const res = await req<{ total: number; items: HouseholdItem[] }>(`/api/households?${params}`)
      setHouseholds(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }, [page, year, villageFilter, search])

  useEffect(() => { if (tab === 'list') loadList() }, [loadList, tab])

  const loadOverdrawn = useCallback(async () => {
    setOverdrawnLoading(true)
    try {
      const params = new URLSearchParams({ year: String(year) })
      if (villageFilter) params.set('village_name', villageFilter)
      const res = await req<{ items: OverdrawnItem[] }>(`/api/households/alert/overdrawn?${params}`)
      setOverdrawn(res.items)
    } finally { setOverdrawnLoading(false) }
  }, [year, villageFilter])

  useEffect(() => { if (tab === 'overdrawn') loadOverdrawn() }, [tab, loadOverdrawn])

  const openDetail = async (id: number) => {
    const d = await req<HouseholdDetail>(`/api/households/${id}${detailYear ? `?year=${detailYear}` : ''}`)
    setDetail(d)
  }

  const submitEdit = async () => {
    if (!detail) return
    try {
      await req(`/api/households/${detail.id}`, { method: 'PUT', body: JSON.stringify(editForm) })
      show('✓ 更新成功')
      setEditOpen(false)
      openDetail(detail.id)  // 刷新详情
      loadList()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 面积进度条 ──
  const AreaBar = ({ contracted, used, overdrawn }: { contracted: number; used: number; overdrawn: boolean }) => {
    if (contracted <= 0) return <span className="text-xs text-stone-300">未设置承包面积</span>
    const pct = Math.min(100, Math.round(used / contracted * 100))
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-16 bg-stone-100 rounded-full h-2 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${overdrawn ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-500'}`}
            style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-xs font-mono whitespace-nowrap ${overdrawn ? 'text-red-600 font-bold' : 'text-stone-500'}`}>
          {used}/{contracted}亩
        </span>
        {overdrawn && <Tag label={`超 ${(used - contracted).toFixed(1)}亩`} color="red" />}
      </div>
    )
  }

  // ── 详情页 ──
  if (detail) {
    const au = detail.area_usage
    const isOverdrawn = au?.is_overdrawn || false

    return (
      <div>
        <button onClick={() => setDetail(null)} className="mb-4 text-sm text-emerald-700 hover:underline">
          ← 返回列表
        </button>
        <div className="grid grid-cols-[300px_1fr] gap-5">
          {/* 左侧：基础信息 + 成员 */}
          <div className="space-y-4">
            {/* 家庭户信息卡 */}
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
                <div>
                  <div className="font-bold text-stone-800">{detail.household_name}</div>
                  <div className="text-xs text-stone-400 mt-0.5 font-mono">{detail.household_code}</div>
                </div>
                <button onClick={() => { setEditForm({ land_area: detail.contracted_area, address: detail.address ?? '', remark: detail.remark ?? '' }); setEditOpen(true) }}
                  className="text-xs text-stone-400 border border-stone-200 px-2.5 py-1 rounded-lg hover:text-emerald-700 hover:border-emerald-200">编辑</button>
              </div>
              <div className="divide-y divide-stone-50 px-5">
                {[
                  ['所在位置', detail.village_full_name],
                  ['详细地址', detail.address || '—'],
                  ['承包面积', <span key="la" className="font-mono font-bold text-emerald-700">{detail.contracted_area || '未设置'}{detail.contracted_area ? ' 亩' : ''}</span>],
                ].map(([k, v], i) => (
                  <div key={i} className="flex justify-between items-center py-2.5 text-sm">
                    <span className="text-stone-400">{k}</span>
                    <span className="text-stone-700">{v as React.ReactNode}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 成员列表 */}
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
                <span className="font-semibold text-stone-700 text-sm">家庭成员</span>
                <Tag label={`${detail.members.length} 人`} color="blue" />
              </div>
              <div className="divide-y divide-stone-50">
                {detail.members.map(m => (
                  <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold">{m.real_name}</span>
                      {m.is_head === 1 && <Tag label="户主" color="purple" />}
                      <div className="text-xs text-stone-400 mt-0.5 font-mono">{m.id_card_masked}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-stone-400">{m.relation || '—'}</div>
                      <Tag label={m.farmer_status === 1 ? '在册' : m.farmer_status === 2 ? '注销' : '迁出'} color={m.farmer_status === 1 ? 'green' : 'red'} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧：面积占用 + 补贴记录 */}
          <div className="space-y-4">
            {/* 面积占用总览 */}
            {au && (
              <div className={`rounded-xl border p-5 shadow-sm ${isOverdrawn ? 'bg-red-50 border-red-200' : 'bg-white border-stone-200'}`}>
                <div className="flex items-center justify-between mb-4">
                  <span className="font-bold text-stone-700">面积占用情况</span>
                  {isOverdrawn && <Tag label={`⚠️ 超领 ${au.overdraw_amount} 亩`} color="red" />}
                </div>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  {[
                    { label: '承包面积', val: `${au.contracted_area} 亩`, color: 'text-stone-700' },
                    { label: '已占用面积', val: `${au.used_area} 亩`, color: isOverdrawn ? 'text-red-600' : 'text-amber-600' },
                    { label: '剩余可用', val: `${au.remaining_area} 亩`, color: au.remaining_area >= 0 ? 'text-emerald-700' : 'text-red-600' },
                  ].map(s => (
                    <div key={s.label} className="bg-white/70 border border-stone-200 rounded-xl p-3 text-center">
                      <div className={`text-xl font-bold font-mono ${s.color}`}>{s.val}</div>
                      <div className="text-xs text-stone-400 mt-1">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 进度条 */}
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-stone-400 mb-1">
                    <span>面积占用进度</span>
                    <span>{au.contracted_area > 0 ? Math.round(au.used_area / au.contracted_area * 100) : 0}%</span>
                  </div>
                  <div className="bg-stone-100 rounded-full h-3 overflow-hidden">
                    <div className={`h-full rounded-full ${isOverdrawn ? 'bg-red-500' : 'bg-emerald-500'}`}
                      style={{ width: `${au.contracted_area > 0 ? Math.min(100, au.used_area / au.contracted_area * 100) : 0}%` }} />
                  </div>
                </div>

                {/* 分补贴项明细 */}
                {au.subsidy_breakdown.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 mb-2">各补贴项占用明细：</p>
                    <table className="w-full text-xs border-collapse">
                      <thead><tr className="border-b border-stone-200">
                        {['补贴项目','年度','占用面积','实发金额','笔数'].map(h => (
                          <th key={h} className="text-left pb-1.5 text-stone-400 font-medium">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {au.subsidy_breakdown.map((b, i) => (
                          <tr key={i} className="border-b border-stone-50">
                            <td className="py-1.5">{b.subsidy_name}</td>
                            <td className="py-1.5 text-blue-600 font-mono">{b.apply_year}</td>
                            <td className="py-1.5 font-mono font-bold text-amber-600">{b.used_area} 亩</td>
                            <td className="py-1.5 font-mono text-emerald-700">{fmt(b.total_amount)}</td>
                            <td className="py-1.5 text-stone-400">{b.app_count} 笔</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 补贴申请记录 */}
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 font-semibold text-stone-700 text-sm">
                全部补贴申请记录
              </div>
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-stone-100">
                  {['年度','成员','补贴项目','申请面积','申请金额','实发金额','状态'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs text-stone-400 font-semibold">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {detail.app_summary.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-stone-300 text-sm">暂无补贴记录</td></tr>
                  )}
                  {detail.app_summary.map((a, i) => (
                    <tr key={i} className="border-b border-stone-50 hover:bg-stone-50">
                      <td className="px-4 py-2.5 text-sm font-bold text-blue-600">{a.apply_year}</td>
                      <td className="px-4 py-2.5 text-sm">{a.farmer_name}</td>
                      <td className="px-4 py-2.5 text-sm">{a.subsidy_name}</td>
                      <td className="px-4 py-2.5 text-sm font-mono">{a.apply_area != null ? `${a.apply_area} 亩` : '—'}</td>
                      <td className="px-4 py-2.5 text-sm font-mono text-stone-500">{fmt(a.apply_amount)}</td>
                      <td className="px-4 py-2.5 text-sm font-mono font-bold text-emerald-700">{fmt(a.actual_amount)}</td>
                      <td className="px-4 py-2.5">
                        <Tag label={['待审核','审核通过','已发放','驳回'][a.pay_status] || '—'} color={(['amber','blue','green','red'] as const)[a.pay_status] || 'gray'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 编辑弹窗 */}
        <Modal open={editOpen} title={`编辑家庭户 · ${detail.household_name}`}
          onClose={() => setEditOpen(false)} onConfirm={submitEdit}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">承包土地面积（亩）</label>
              <input type="number" step="0.01" min="0"
                value={editForm.land_area ?? ''}
                onChange={e => setEditForm(f => ({ ...f, land_area: Number(e.target.value) || undefined }))}
                placeholder="0.00"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              <p className="text-xs text-stone-300 mt-1">承包面积是超领检测的基准，请按实际填写</p>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">详细地址</label>
              <input value={editForm.address ?? ''}
                onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">备注</label>
              <textarea rows={2} value={editForm.remark ?? ''}
                onChange={e => setEditForm(f => ({ ...f, remark: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
            </div>
          </div>
        </Modal>

        <Toast {...toast} />
      </div>
    )
  }

  return (
    <div>
      {/* Tab 切换 */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('list')}
          className={`px-4 py-2 text-sm rounded-lg border transition-colors
            ${tab === 'list' ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white border-stone-200 text-stone-600'}`}>
          家庭户列表
        </button>
        <button onClick={() => setTab('overdrawn')}
          className={`px-4 py-2 text-sm rounded-lg border transition-colors flex items-center gap-2
            ${tab === 'overdrawn' ? 'bg-red-600 text-white border-red-600' : 'bg-white border-stone-200 text-stone-600'}`}>
          ⚠️ 超领预警
          {overdrawn.length > 0 && tab !== 'overdrawn' && (
            <span className="bg-red-100 text-red-600 text-xs px-1.5 py-0.5 rounded-full font-mono">{overdrawn.length}</span>
          )}
        </button>

        <div className="ml-auto flex gap-2">
          {/* 年度选择 */}
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-2 py-1.5 text-sm bg-white outline-none">
            {years.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          {/* 村庄筛选 */}
          <select value={villageFilter} onChange={e => setVillageFilter(e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-1.5 text-sm bg-white outline-none">
            <option value="">全部村庄</option>
            {villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* ── 家庭户列表 ── */}
      {tab === 'list' && (
        <>
          <div className="flex gap-2 mb-3">
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="搜索户名或户主姓名…"
              className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 bg-white" />
          </div>
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full border-collapse">
              <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
                {['户编码','家庭名称','所在位置','户主','成员数','承包面积','已占用面积','剩余','状态','操作'].map(h => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={10} className="text-center py-10 text-stone-400 text-sm">加载中…</td></tr>}
                {!loading && households.map(hh => (
                  <tr key={hh.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors ${hh.is_overdrawn ? 'bg-red-50/30' : ''}`}>
                    <td className="px-3.5 py-2.5 text-xs font-mono text-stone-400">{hh.household_code}</td>
                    <td className="px-3.5 py-2.5 text-sm font-semibold">
                      {hh.household_name}
                      {hh.is_overdrawn && <span className="ml-1 text-xs text-red-500">⚠️</span>}
                    </td>
                    <td className="px-3.5 py-2.5 text-xs text-stone-400">{hh.village_full_name}</td>
                    <td className="px-3.5 py-2.5 text-sm">{hh.head_name}</td>
                    <td className="px-3.5 py-2.5 text-sm text-center">{hh.member_count}</td>
                    <td className="px-3.5 py-2.5 text-sm font-mono">
                      {hh.contracted_area > 0 ? `${hh.contracted_area} 亩` : <span className="text-stone-300">未设置</span>}
                    </td>
                    <td className="px-3.5 py-2.5 min-w-36">
                      <AreaBar contracted={hh.contracted_area} used={hh.used_area} overdrawn={hh.is_overdrawn} />
                    </td>
                    <td className="px-3.5 py-2.5 text-sm font-mono">
                      {hh.contracted_area > 0
                        ? <span className={hh.remaining_area < 0 ? 'text-red-600 font-bold' : 'text-emerald-700'}>{hh.remaining_area} 亩</span>
                        : '—'}
                    </td>
                    <td className="px-3.5 py-2.5"><Tag label={STATUS_MAP[hh.status]?.label || '—'} color={STATUS_MAP[hh.status]?.color || 'gray'} /></td>
                    <td className="px-3.5 py-2.5">
                      <button onClick={() => openDetail(hh.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-50">详情</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100 bg-stone-50/50 flex justify-between">
              <span>共 {total} 户</span>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 text-xs border border-stone-200 rounded disabled:opacity-40">‹</button>
                <span className="px-2 py-1 text-xs">第 {page}/{Math.ceil(total / 20)} 页</span>
                <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 text-xs border border-stone-200 rounded disabled:opacity-40">›</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 超领预警 ── */}
      {tab === 'overdrawn' && (
        <div>
          {overdrawnLoading && <div className="text-center py-16 text-stone-300">计算中…</div>}
          {!overdrawnLoading && overdrawn.length === 0 && (
            <div className="text-center py-16 bg-white border border-stone-200 rounded-xl text-stone-300">
              <div className="text-5xl mb-3">✅</div>
              <p className="text-sm">{year} 年无超领家庭，数据正常</p>
            </div>
          )}
          {!overdrawnLoading && overdrawn.length > 0 && (
            <>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
                <strong>⚠️ 发现 {overdrawn.length} 户超领家庭（{year}年）</strong>
                ——已补贴面积超过承包面积，正式申请前必须核实处理。
              </div>
              <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full border-collapse">
                  <thead><tr className="bg-red-50 border-b-2 border-red-200">
                    {['户编码','家庭名称','户主','所在位置','承包面积','已补贴面积','超领面积','涉及补贴项','操作'].map(h => (
                      <th key={h} className="px-3.5 py-2.5 text-left text-xs text-stone-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {overdrawn.map(hh => (
                      <tr key={hh.household_id} className="border-b border-red-50 hover:bg-red-50/50 transition-colors">
                        <td className="px-3.5 py-2.5 text-xs font-mono text-stone-400">{hh.household_code}</td>
                        <td className="px-3.5 py-2.5 text-sm font-semibold">{hh.household_name}</td>
                        <td className="px-3.5 py-2.5 text-sm">{hh.head_name}</td>
                        <td className="px-3.5 py-2.5 text-xs text-stone-400">{hh.village}</td>
                        <td className="px-3.5 py-2.5 text-sm font-mono">{hh.contracted_area} 亩</td>
                        <td className="px-3.5 py-2.5 text-sm font-mono text-amber-600">{hh.used_area} 亩</td>
                        <td className="px-3.5 py-2.5">
                          <Tag label={`超 ${hh.overdraw_amount} 亩`} color="red" />
                        </td>
                        <td className="px-3.5 py-2.5 text-xs text-stone-500">
                          {[...new Set(hh.subsidy_breakdown.map(b => b.subsidy_name))].join('、')}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <button onClick={() => openDetail(hh.household_id)}
                            className="text-xs text-red-600 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-50">查看</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <Toast {...toast} />
    </div>
  )
}

// ─── 面积进度条（列表用）───
function AreaBar({ contracted, used, overdrawn }: { contracted: number; used: number; overdrawn: boolean }) {
  if (contracted <= 0) return <span className="text-xs text-stone-300">—</span>
  const pct = Math.min(100, Math.round(used / contracted * 100))
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-12 bg-stone-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${overdrawn ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono ${overdrawn ? 'text-red-600 font-bold' : 'text-stone-400'}`}>{used}亩</span>
    </div>
  )
}
