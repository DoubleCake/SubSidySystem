/**
 * 家庭户管理页 — 完整版
 * 列表：搜索/筛选/超领标红，点击进入详情
 * 详情：成员列表、面积占用、补贴汇总
 * 功能：批量组建（Excel）、编辑基础信息
 */
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { PAY_STATUS, fmt } from '../utils'

interface HH {
  id: number; household_code: string; household_name: string
  village_full_name: string; village_name: string; head_name: string
  contracted_area: number; used_area: number; remaining_area: number
  is_overdrawn: boolean; overdraw_amount: number
  member_count: number; status: number; address: string | null; remark: string | null
}

interface HHDetail {
  id: number; household_code: string; household_name: string
  village_full_name: string; contracted_area: number; status: number
  address: string | null; remark: string | null
  members: {
    id: number; real_name: string; gender: number; id_card_masked: string
    is_head: number; relation: string | null; farmer_status: number; phone_masked: string | null
  }[]
  area_usage: {
    contracted_area: number; used_area: number; remaining_area: number
    is_overdrawn: boolean; overdraw_amount?: number; subsidy_breakdown: {
      subsidy_name: string; apply_area: number; calc_mode: string
    }[]
  }
  app_summary: {
    apply_year: number; farmer_name: string; subsidy_name: string
    calc_mode: string; apply_area: number | null; actual_amount: number | null; pay_status: number
  }[]
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i)

const FARMER_STATUS_LABEL: Record<number, string> = { 1: '在册', 2: '注销', 3: '迁出', 4: '死亡' }

export default function HouseholdsPage() {
  const { toast, show } = useToast()
  const [list, setList] = useState<HH[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [overdrawnOnly, setOverdrawnOnly] = useState(false)

  // 详情
  const [detail, setDetail] = useState<HHDetail | null>(null)
  const [detailYear, setDetailYear] = useState(new Date().getFullYear())
  const [detailTab, setDetailTab] = useState<'members' | 'area' | 'subsidy'>('members')

  // 编辑家庭户
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<{ household_name: string; land_area: string; address: string; remark: string }>({ household_name: '', land_area: '', address: '', remark: '' })

  // 批量组建
  const [buildOpen, setBuildOpen] = useState(false)
  const [buildFile, setBuildFile] = useState<File | null>(null)
  const [buildPreview, setBuildPreview] = useState<Record<string, unknown>[]>([])
  const [buildResult, setBuildResult] = useState<{ built: number; updated: number; errors: string[]; total_groups: number } | null>(null)
  const [buildLoading, setBuildLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20', year: String(yearFilter) })
      if (search) p.set('search', search)
      if (overdrawnOnly) p.set('overdrawn_only', '1')
      const r = await req<{ total: number; items: HH[] }>(`/api/households?${p}`)
      setList(r.items); setTotal(r.total)
    } finally { setLoading(false) }
  }, [page, search, yearFilter, overdrawnOnly])

  useEffect(() => { load() }, [load])

  const openDetail = async (id: number) => {
    try {
      const d = await req<HHDetail>(`/api/households/${id}?year=${detailYear}`)
      setDetail(d); setDetailTab('members')
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openEdit = (hh: HH) => {
    setEditForm({ household_name: hh.household_name, land_area: String(hh.contracted_area || ''), address: hh.address || '', remark: hh.remark || '' })
    setEditOpen(true)
  }

  const submitEdit = async () => {
    if (!detail) return
    try {
      await req(`/api/households/${detail.id}`, { method: 'PUT', body: JSON.stringify({
        household_name: editForm.household_name,
        land_area: Number(editForm.land_area) || null,
        address: editForm.address || null,
        remark: editForm.remark || null,
      }) })
      show('✓ 更新成功'); setEditOpen(false)
      const d = await req<HHDetail>(`/api/households/${detail.id}?year=${detailYear}`)
      setDetail(d); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // 批量组建
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['家庭户编号*', '身份证号*', '姓名（核对用）', '是否户主*', '与户主关系', '土地面积(亩，户主行填)'],
      ['HH001', '510123196503154231', '张国强', '1', '本人', '3.5'],
      ['HH001', '510123197808224567', '李秀英', '0', '妻子', ''],
      ['HH002', '510123197012185678', '王建国', '1', '本人', '2.8'],
    ])
    ws['!cols'] = [14, 20, 12, 10, 12, 18].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '家庭户组建模板')
    XLSX.writeFile(wb, '家庭户组建模板.xlsx')
  }

  const handleFileChange = (file: File) => {
    setBuildFile(file); setBuildResult(null)
    const reader = new FileReader()
    reader.onload = e => {
      const wb = XLSX.read(e.target?.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      setBuildPreview((XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]).slice(0, 5))
    }
    reader.readAsArrayBuffer(file)
  }

  const submitBuild = async () => {
    if (!buildFile) return show('请先上传文件', 'err')
    setBuildLoading(true)
    try {
      const reader = new FileReader()
      reader.onload = async e => {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, unknown>[]
        const rows = raw.map(r => ({
          household_id: String(r['家庭户编号*'] || r['家庭户编号'] || '').trim(),
          id_card:      String(r['身份证号*']   || r['身份证号']   || '').trim(),
          real_name:    String(r['姓名（核对用）'] || r['姓名'] || '').trim() || undefined,
          is_head:      Number(r['是否户主*']    || r['是否户主'] || 0),
          relation:     String(r['与户主关系']   || '成员').trim() || '成员',
          land_area:    Number(r['土地面积(亩，户主行填)'] || r['土地面积'] || 0) || undefined,
        })).filter(r => r.household_id && r.id_card)
        const res = await req<{ built: number; updated: number; errors: string[]; total_groups: number }>(
          '/api/households/batch-build', { method: 'POST', body: JSON.stringify({ rows }) }
        )
        setBuildResult(res)
        if (res.built + res.updated > 0) { show(`✓ 组建 ${res.built} 个，更新 ${res.updated} 个`); load() }
        setBuildLoading(false)
      }
      reader.readAsArrayBuffer(buildFile)
    } catch (e: unknown) { show((e as Error).message, 'err'); setBuildLoading(false) }
  }

  // 如果在详情页
  if (detail) {
    const appsByYear: Record<number, typeof detail.app_summary> = {}
    detail.app_summary.forEach(a => {
      if (!appsByYear[a.apply_year]) appsByYear[a.apply_year] = []
      appsByYear[a.apply_year].push(a)
    })

    return (
      <div>
        <button onClick={() => setDetail(null)} className="mb-4 text-sm text-emerald-700 hover:underline">← 返回列表</button>

        {/* 顶部信息卡 */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm mb-4">
          <div className="bg-gradient-to-r from-emerald-800 to-emerald-700 px-6 py-4 flex items-center gap-5">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-xl font-bold text-white shrink-0">🏠</div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-lg font-bold text-white">{detail.household_name}</span>
                <span className="text-emerald-300 text-xs font-mono">{detail.household_code}</span>
              </div>
              <div className="text-emerald-200 text-sm">📍 {detail.village_full_name}
                {detail.address && <span className="ml-2 text-emerald-300 text-xs">{detail.address}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-bold font-mono text-white">{detail.contracted_area > 0 ? `${detail.contracted_area}亩` : '未设置'}</div>
              <div className="text-emerald-300 text-xs">承包土地面积</div>
              {detail.area_usage?.is_overdrawn && (
                <div className="text-red-300 text-xs mt-0.5">⚠️ 超领 {detail.area_usage.overdraw_amount?.toFixed(2)}亩</div>
              )}
            </div>
            <button onClick={() => {
              openEdit({ ...detail, contracted_area: detail.contracted_area } as unknown as HH)
            }} className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg shrink-0">
              ✏️ 编辑
            </button>
          </div>

          {/* Tab */}
          <div className="flex border-b border-stone-200 bg-stone-50">
            {[
              { id: 'members', label: `👥 成员 (${detail.members.length})` },
              { id: 'area',    label: `📐 面积占用` },
              { id: 'subsidy', label: `💰 补贴汇总 (${detail.app_summary.length})` },
            ].map(t => (
              <button key={t.id} onClick={() => setDetailTab(t.id as typeof detailTab)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors
                  ${detailTab === t.id ? 'border-emerald-600 text-emerald-700 bg-white' : 'border-transparent text-stone-500 hover:text-stone-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab: 成员 */}
          {detailTab === 'members' && (
            <div className="p-5 grid gap-2">
              {detail.members.length === 0 && <div className="text-center py-8 text-stone-300 text-sm">暂无成员记录</div>}
              {detail.members.map(m => (
                <div key={m.id} className={`flex items-center gap-4 rounded-xl px-4 py-3 border transition-colors
                  ${m.is_head ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-stone-200 hover:border-stone-300'}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                    ${m.is_head ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
                    {m.real_name.slice(-1)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-stone-800">{m.real_name}</span>
                      {m.is_head === 1 && <Tag label="户主" color="green" />}
                      {m.relation && <Tag label={m.relation} color="gray" />}
                      {m.farmer_status !== 1 && <Tag label={FARMER_STATUS_LABEL[m.farmer_status] || '异常'} color="red" />}
                    </div>
                    <div className="text-xs text-stone-400 mt-0.5">
                      {m.gender === 1 ? '男' : '女'}
                      {m.phone_masked && <span className="ml-2">{m.phone_masked}</span>}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-stone-300">{m.id_card_masked}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tab: 面积占用 */}
          {detailTab === 'area' && (
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <label className="text-xs text-stone-400">查看年度</label>
                <select value={detailYear} onChange={async e => {
                  setDetailYear(Number(e.target.value))
                  const d = await req<HHDetail>(`/api/households/${detail.id}?year=${e.target.value}`)
                  setDetail(d)
                }} className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm bg-white outline-none">
                  {years.map(y => <option key={y} value={y}>{y}年</option>)}
                </select>
              </div>
              {detail.area_usage ? (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                      { label: '承包面积', val: `${detail.area_usage.contracted_area}亩`, color: 'text-stone-700' },
                      { label: '已用面积', val: `${detail.area_usage.used_area.toFixed(2)}亩`, color: detail.area_usage.is_overdrawn ? 'text-red-600' : 'text-amber-600' },
                      { label: '剩余面积', val: detail.area_usage.is_overdrawn ? `超领 ${Math.abs(detail.area_usage.remaining_area).toFixed(2)}亩` : `${detail.area_usage.remaining_area.toFixed(2)}亩`, color: detail.area_usage.is_overdrawn ? 'text-red-600' : 'text-emerald-700' },
                    ].map(s => (
                      <div key={s.label} className="bg-stone-50 border border-stone-200 rounded-xl p-4 text-center">
                        <div className={`text-xl font-bold font-mono ${s.color}`}>{s.val}</div>
                        <div className="text-xs text-stone-400 mt-1">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* 进度条 */}
                  {detail.area_usage.contracted_area > 0 && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-stone-400 mb-1.5">
                        <span>面积使用率</span>
                        <span>{Math.round(detail.area_usage.used_area / detail.area_usage.contracted_area * 100)}%</span>
                      </div>
                      <div className="bg-stone-100 rounded-full h-3 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${detail.area_usage.is_overdrawn ? 'bg-red-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, Math.round(detail.area_usage.used_area / detail.area_usage.contracted_area * 100))}%` }} />
                      </div>
                    </div>
                  )}
                  {detail.area_usage.subsidy_breakdown?.length > 0 && (
                    <div>
                      <p className="text-xs text-stone-400 mb-2">各项补贴占用明细：</p>
                      <div className="space-y-2">
                        {detail.area_usage.subsidy_breakdown.map((b, i) => (
                          <div key={i} className="flex justify-between items-center bg-white border border-stone-200 rounded-lg px-3 py-2">
                            <span className="text-sm">{b.subsidy_name}</span>
                            <span className="text-sm font-mono font-bold text-amber-600">{b.apply_area.toFixed(2)}亩</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : <div className="text-center py-8 text-stone-300 text-sm">暂无面积数据</div>}
            </div>
          )}

          {/* Tab: 补贴汇总 */}
          {detailTab === 'subsidy' && (
            <div>
              {Object.keys(appsByYear).length === 0 && <div className="py-10 text-center text-stone-300 text-sm">暂无补贴记录</div>}
              {Object.entries(appsByYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yr, apps]) => (
                <div key={yr}>
                  <div className="px-5 py-2 bg-stone-50 border-b border-stone-100 text-xs font-bold text-stone-500">
                    {yr} 年度 · {apps.length}条 · 合计 ¥{apps.reduce((s, a) => s + (a.actual_amount || 0), 0).toFixed(2)}
                  </div>
                  {apps.map((a, i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-2.5 border-b border-stone-50 hover:bg-stone-50">
                      <span className="text-sm text-stone-500 w-16 shrink-0">{a.farmer_name}</span>
                      <span className="text-sm flex-1">{a.subsidy_name}</span>
                      {a.apply_area && <span className="text-xs text-stone-400 font-mono">{a.apply_area}亩</span>}
                      <span className="text-sm font-mono font-bold text-emerald-700">{a.actual_amount ? fmt(a.actual_amount) : '—'}</span>
                      <Tag label={PAY_STATUS[a.pay_status]?.label || '—'} color={PAY_STATUS[a.pay_status]?.color as 'green'} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 编辑弹窗 */}
        <Modal open={editOpen} title="编辑家庭户信息" onClose={() => setEditOpen(false)} onConfirm={submitEdit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">户名</label>
              <input value={editForm.household_name} onChange={e => setEditForm(f => ({ ...f, household_name: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            <div><label className="block text-xs text-stone-400 mb-1">承包土地面积(亩)</label>
              <input type="number" step="0.01" value={editForm.land_area} onChange={e => setEditForm(f => ({ ...f, land_area: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            <div><label className="block text-xs text-stone-400 mb-1">地址</label>
              <input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">备注</label>
              <textarea rows={2} value={editForm.remark} onChange={e => setEditForm(f => ({ ...f, remark: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" /></div>
          </div>
        </Modal>
        <Toast {...toast} />
      </div>
    )
  }

  // ── 列表页 ──
  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索户名或户主…"
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 bg-white w-52" />
        <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-stone-600 cursor-pointer">
          <input type="checkbox" checked={overdrawnOnly} onChange={e => setOverdrawnOnly(e.target.checked)} />
          仅看超领
        </label>
        <span className="text-xs text-stone-400">共 {total} 户</span>
        <button onClick={() => { setBuildOpen(true); setBuildFile(null); setBuildPreview([]); setBuildResult(null) }}
          className="ml-auto px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">
          🏠 批量组建家庭户
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
            {['户编码', '户名', '户主', '所在位置', '成员数', '承包面积', '已用面积', '状态', '操作'].map(h => (
              <th key={h} className="px-3.5 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="text-center py-12 text-stone-300">加载中…</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={9} className="text-center py-12 text-stone-300 text-sm">暂无数据</td></tr>}
            {list.map(h => (
              <tr key={h.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors cursor-pointer ${h.is_overdrawn ? 'bg-red-50/30' : ''}`}
                onClick={() => openDetail(h.id)}>
                <td className="px-3.5 py-2.5 text-xs font-mono text-blue-600">{h.household_code}</td>
                <td className="px-3.5 py-2.5 text-sm font-semibold">{h.household_name}</td>
                <td className="px-3.5 py-2.5 text-sm text-stone-500">{h.head_name}</td>
                <td className="px-3.5 py-2.5 text-xs text-stone-400">{h.village_full_name}</td>
                <td className="px-3.5 py-2.5 text-sm">{h.member_count}人</td>
                <td className="px-3.5 py-2.5 text-sm font-mono">{h.contracted_area > 0 ? `${h.contracted_area}亩` : <span className="text-stone-300">未设置</span>}</td>
                <td className="px-3.5 py-2.5 text-sm font-mono">
                  {h.is_overdrawn
                    ? <span className="text-red-600 font-bold">超领 {h.overdraw_amount.toFixed(2)}亩 ⚠️</span>
                    : h.used_area > 0 ? `${h.used_area.toFixed(2)}亩` : '—'}
                </td>
                <td className="px-3.5 py-2.5">
                  <Tag label={h.status === 1 ? '正常' : h.status === 2 ? '注销' : '异常'} color={h.status === 1 ? 'green' : 'red'} />
                </td>
                <td className="px-3.5 py-2.5" onClick={e => e.stopPropagation()}>
                  <button onClick={() => openDetail(h.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-50">详情</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-stone-100 bg-stone-50/50 flex justify-between text-xs text-stone-400">
          <span>共{total}户</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">‹</button>
            <span className="px-2">{page}/{Math.max(1, Math.ceil(total / 20))}</span>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">›</button>
          </div>
        </div>
      </div>

      {/* 批量组建弹窗 */}
      <Modal open={buildOpen} title="批量组建家庭户" onClose={() => setBuildOpen(false)}
        onConfirm={buildResult ? undefined : submitBuild} confirmText={buildLoading ? '处理中…' : '开始组建'}>
        <div className="space-y-4">
          {!buildResult ? (
            <>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700">
                <p className="font-semibold mb-2">使用步骤：</p>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>下载模板，每行一人，同家庭户填相同「家庭户编号」</li>
                  <li>户主行填 is_head=1，土地面积写在户主行</li>
                  <li>上传 → 系统按身份证匹配已有农户并完成组建</li>
                </ol>
              </div>
              <button onClick={downloadTemplate} className="w-full py-2.5 border-2 border-dashed border-emerald-300 text-emerald-700 rounded-xl text-sm hover:bg-emerald-50">
                ⬇️ 下载家庭户组建模板
              </button>
              <div>
                <label className="block text-xs text-stone-400 mb-1">上传填写好的 Excel</label>
                <input type="file" accept=".xlsx,.xls" onChange={e => { if (e.target.files?.[0]) handleFileChange(e.target.files[0]) }}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              {buildPreview.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-stone-200">
                  <table className="text-xs w-full border-collapse">
                    <thead><tr className="bg-stone-50">{Object.keys(buildPreview[0]).map(k => (
                      <th key={k} className="px-2 py-1.5 text-left text-stone-400 whitespace-nowrap border-b border-stone-200">{k}</th>
                    ))}</tr></thead>
                    <tbody>{buildPreview.map((r, i) => (
                      <tr key={i} className="border-b border-stone-100">{Object.values(r).map((v, j) => (
                        <td key={j} className="px-2 py-1.5 text-stone-600 whitespace-nowrap">{String(v)}</td>
                      ))}</tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: '识别家庭户', val: buildResult.total_groups, color: 'text-blue-600' },
                  { label: '成功组建',   val: buildResult.built,        color: 'text-emerald-700' },
                  { label: '更新已有',   val: buildResult.updated,      color: 'text-amber-600' },
                ].map(s => (
                  <div key={s.label} className="bg-stone-50 rounded-xl p-3">
                    <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
                    <div className="text-xs text-stone-400 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
              {buildResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 max-h-40 overflow-auto">
                  <p className="text-xs font-semibold text-red-700 mb-2">⚠️ {buildResult.errors.length} 条错误：</p>
                  {buildResult.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                </div>
              )}
              <button onClick={() => { setBuildResult(null); setBuildFile(null); setBuildPreview([]) }}
                className="w-full py-2 border border-stone-200 text-stone-500 rounded-lg text-sm">重新上传</button>
            </div>
          )}
        </div>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}
