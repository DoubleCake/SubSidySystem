/**
 * 户籍管理页 —— 家庭户 + 农户档案的统一入口
 *
 * Tab 1: 家庭户列表  → 详情（成员增删改/面积/补贴/历史事件/分户）
 * Tab 2: 快速跳转农户档案（复用 FarmersPage）
 *
 * 成员管理：单条增删改 + Excel 批量导入
 * 历史事件：时间线展示，支持手动补录
 * 分户向导：选成员 → 填新户信息 → 一键分户并自动记录事件
 */
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImport from '../components/ExcelImport'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { PAY_STATUS, fmt } from '../utils'

// ── 类型 ──────────────────────────────
interface HH {
  id: number; household_code: string; household_name: string
  village_full_name: string; village_name: string; head_name: string
  contracted_area: number; used_area: number; remaining_area: number
  is_overdrawn: boolean; overdraw_amount: number
  member_count: number; status: number; address: string | null; remark: string | null
}

interface Member {
  id: number; real_name: string; gender: number; id_card_masked: string
  is_head: number; relation: string | null; farmer_status: number; phone_masked: string | null
}

interface HHDetail {
  id: number; household_code: string; household_name: string
  village_full_name: string; contracted_area: number; status: number
  address: string | null; remark: string | null
  members: Member[]
  area_usage: {
    contracted_area: number; trust_out_area?: number; trust_in_area?: number
    cultivable_area?: number; used_area: number; remaining_area: number
    is_overdrawn: boolean; overdraw_amount?: number; has_trust_data?: boolean
    subsidy_breakdown: { subsidy_name: string; apply_area: number; calc_mode: string }[]
  }
  app_summary: {
    apply_year: number; farmer_name: string; subsidy_name: string
    calc_mode: string; apply_area: number | null; actual_amount: number | null; pay_status: number
  }[]
}

interface HHEvent {
  id: number; event_type: string; event_year: number; event_date: string | null
  date_accuracy: string; description: string
  farmer_id: number | null; farmer_name: string | null
  related_hh_id: number | null; evidence_type: string | null; evidence_note: string | null
  operator: string | null; created_at: string
  before_snapshot: unknown; after_snapshot: unknown
  undoable: boolean
}

interface HistoryDateEvent {
  date: string; event_type: string; description: string
  event_id: number; event_year: number
}

interface SnapshotAtResponse {
  target_date: string
  snapshot: {
    household_name: string; household_code: string
    land_area: number; status: number
    address: string | null; remark: string | null
    head_id: number | null
    members: Member[]
  } | null
  events: HHEvent[]
}

const EVENT_TYPE_CFG: Record<string, { label: string; color: string; icon: string }> = {
  ORIGINAL:       { label: '原始数据',   color: 'bg-slate-100 text-slate-600',   icon: '📌' },
  FOUND:          { label: '建档登记',   color: 'bg-blue-100 text-blue-700',     icon: '📝' },
  MEMBER_ADD:     { label: '成员新增',   color: 'bg-emerald-100 text-emerald-700', icon: '➕' },
  MEMBER_REMOVE:  { label: '成员移出',   color: 'bg-amber-100 text-amber-700',   icon: '➖' },
  MEMBER_STATUS:  { label: '状态变更',   color: 'bg-stone-100 text-stone-600',   icon: '🔄' },
  HEAD_CHANGE:    { label: '户主变更',   color: 'bg-purple-100 text-purple-700', icon: '👤' },
  SPLIT:          { label: '分户',       color: 'bg-orange-100 text-orange-700', icon: '🔀' },
  MERGE:          { label: '合户',       color: 'bg-teal-100 text-teal-700',     icon: '🔗' },
  LAND_CHANGE:    { label: '土地变更',   color: 'bg-green-100 text-green-700',   icon: '🌾' },
  STATUS_CHANGE:  { label: '户籍变更',   color: 'bg-red-100 text-red-700',       icon: '📋' },
  REMARK:         { label: '备注说明',   color: 'bg-stone-100 text-stone-500',   icon: '💬' },
}

const FARMER_STATUS_LABEL: Record<number, string> = { 1: '在册', 2: '注销', 3: '迁出', 4: '死亡' }
const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i)

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

// ═══════════════════════════════════════════════════
export default function HouseholdsPage() {
  const { toast, show } = useToast()
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [search, setSearch]       = useState('')
  const [overdrawnOnly, setOverdrawnOnly] = useState(false)
  const [list, setList]   = useState<HH[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage]   = useState(1)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail]   = useState<HHDetail | null>(null)
  const [detailYear, setDetailYear] = useState(new Date().getFullYear())
  const [detailTab, setDetailTab] = useState<'members'|'area'|'subsidy'|'history'>('members')
  const [events, setEvents] = useState<HHEvent[]>([])

  // // 日期级历史滑轨
  // const [historyDate, setHistoryDate] = useState<string | null>(null)
  // const [historyDates, setHistoryDates] = useState<HistoryDateEvent[]>([])
  // const [snapshotData, setSnapshotData] = useState<SnapshotAtResponse | null>(null)
  // const [historyLoading, setHistoryLoading] = useState(false)
  // const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())

  // 批量组建
  const [buildOpen, setBuildOpen]     = useState(false)
  const [buildFile, setBuildFile]     = useState<File | null>(null)
  const [buildPreview, setBuildPreview] = useState<Record<string, unknown>[]>([])
  const [buildResult, setBuildResult] = useState<{ built: number; updated: number; errors: string[]; total_groups: number } | null>(null)
  const [buildLoading, setBuildLoading] = useState(false)

  // 编辑家庭户基础信息
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ household_name: '', land_area: '', address: '', remark: '' })

  // 成员管理
  const [memberAddOpen, setMemberAddOpen] = useState(false)
  const [memberEditTarget, setMemberEditTarget] = useState<Member | null>(null)
  const [memberImportOpen, setMemberImportOpen] = useState(false)
  const [memberForm, setMemberForm] = useState({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1' })

  // 分户向导
  const [splitOpen, setSplitOpen]   = useState(false)
  const [splitStep, setSplitStep]   = useState<1|2|3>(1)
  const [splitSelected, setSplitSelected] = useState<number[]>([])
  const [splitNewHead, setSplitNewHead]   = useState<number | null>(null)
  const [splitForm, setSplitForm] = useState({ household_name: '', split_year: String(new Date().getFullYear()), split_date: '', new_land_area: '', origin_land_area: '', description: '', evidence_type: '', evidence_note: '' })

  // 手动补录事件
  const [eventOpen, setEventOpen] = useState(false)
  const [eventForm, setEventForm] = useState({ event_type: 'REMARK', event_year: String(new Date().getFullYear()), event_date: '', description: '', evidence_type: 'NONE', evidence_note: '' })

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
    const d = await req<HHDetail>(`/api/households/${id}?year=${detailYear}`)
    setDetail(d); setDetailTab('members'); setEvents([])
    setHistoryDate(null); setSnapshotData(null)
    // 加载事件日期列表
    try {
      const hd = await req<{ events: HistoryDateEvent[] }>(`/api/households/${id}/history-dates`)
      setHistoryDates(hd.events)
      // 默认展开最近有事件的年份（跳过 ORIGINAL）
      const firstReal = hd.events.find(e => e.event_type !== 'ORIGINAL')
      if (firstReal) {
        setExpandedYears(new Set([firstReal.event_year]))
      }
    } catch { setHistoryDates([]) }
  }

  // 加载指定日期的历史快照
  const loadSnapshotAt = async (date: string) => {
    if (!detail) return
    setHistoryLoading(true)
    try {
      const snap = await req<SnapshotAtResponse>(`/api/households/${detail.id}/snapshot-at/${date}`)
      setSnapshotData(snap); setHistoryDate(date)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setHistoryLoading(false) }
  }

  const exitHistory = () => {
    setHistoryDate(null); setSnapshotData(null)
  }

  const loadEvents = async (id: number) => {
    const r = await req<{ total: number; items: HHEvent[] }>(`/api/households/${id}/events?page_size=100`)
    setEvents(r.items)
  }

  useEffect(() => {
    if (detailTab === 'history' && detail) loadEvents(detail.id)
  }, [detailTab, detail?.id])

  const refreshDetail = async () => {
    if (!detail) return
    const d = await req<HHDetail>(`/api/households/${detail.id}?year=${detailYear}`)
    setDetail(d)
  }

  // ── 编辑家庭户 ──
  const submitEdit = async () => {
    if (!detail) return
    await req(`/api/households/${detail.id}`, { method: 'PUT', body: JSON.stringify({
      household_name: editForm.household_name,
      land_area: Number(editForm.land_area) || null,
      address: editForm.address || null,
      remark: editForm.remark || null,
    }) })
    show('✓ 已更新'); setEditOpen(false); refreshDetail(); load()
  }

  // ── 成员增改 ──
  const submitMember = async () => {
    if (!detail) return
    if (!memberForm.real_name.trim()) return show('请填写姓名', 'err')
    if (!memberForm.id_card.trim()) return show('请填写身份证号', 'err')
    try {
      if (memberEditTarget) {
        await req(`/api/households/${detail.id}/members/${memberEditTarget.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            real_name: memberForm.real_name, relation: memberForm.relation,
            is_head: memberForm.is_head ? 1 : 0, phone: memberForm.phone || null,
            bank_card: memberForm.bank_card || null, bank_name: memberForm.bank_name || null,
            farmer_status: Number(memberForm.farmer_status),
          }),
        })
        show('✓ 成员信息已更新')
      } else {
        await req(`/api/households/${detail.id}/members`, {
          method: 'POST',
          body: JSON.stringify({
            real_name: memberForm.real_name, id_card: memberForm.id_card,
            gender: Number(memberForm.gender), relation: memberForm.relation,
            is_head: memberForm.is_head ? 1 : 0, phone: memberForm.phone || null,
            bank_card: memberForm.bank_card || null, bank_name: memberForm.bank_name || null,
            farmer_status: 1,
          }),
        })
        show('✓ 成员已添加')
      }
      setMemberAddOpen(false); setMemberEditTarget(null); refreshDetail()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const removeMember = async (m: Member) => {
    if (!detail) return
    if (!confirm(`确认移出「${m.real_name}」？移出后将标记为迁出，历史补贴记录保留。`)) return
    try {
      await req(`/api/households/${detail.id}/members/${m.id}?action=detach`, { method: 'DELETE' })
      show(`✓ 已移出「${m.real_name}」`); refreshDetail()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openMemberEdit = (m: Member) => {
    setMemberEditTarget(m)
    setMemberForm({ real_name: m.real_name, id_card: '', gender: String(m.gender), relation: m.relation || '成员', is_head: m.is_head === 1, phone: m.phone_masked?.replace(/\*+/, '') ?? '', bank_card: '', bank_name: '', farmer_status: String(m.farmer_status) })
    setMemberAddOpen(true)
  }

  // ── 成员批量导入 ──
  const handleMemberImport = async (rows: Record<string, unknown>[]) => {
    if (!detail) return { created: 0, skipped: 0, errors: [] }
    const res = await req<{ created: number; updated: number; errors: string[] }>(
      `/api/households/${detail.id}/members/batch-import`,
      { method: 'POST', body: JSON.stringify({ rows, year: detailYear }) }
    )
    show(`✓ 新增 ${res.created} 条，更新 ${res.updated} 条`)
    refreshDetail()
    return { created: res.created, skipped: 0, errors: res.errors }
  }

  // ── 分户向导 ──
  const submitSplit = async () => {
    if (!detail || !splitNewHead || splitSelected.length === 0) return
    if (!splitForm.household_name.trim()) return show('请填写新家庭户名称', 'err')
    try {
      const r = await req<{ message: string; new_household_id: number; new_household_code: string }>(
        `/api/households/${detail.id}/split`,
        { method: 'POST', body: JSON.stringify({
          split_year: Number(splitForm.split_year),
          split_date: splitForm.split_date || null,
          new_household_name: splitForm.household_name,
          member_ids: splitSelected,
          new_head_id: splitNewHead,
          new_land_area: splitForm.new_land_area ? Number(splitForm.new_land_area) : null,
          origin_land_area: splitForm.origin_land_area ? Number(splitForm.origin_land_area) : null,
          description: splitForm.description || `分户：${splitSelected.length}名成员独立组建「${splitForm.household_name}」`,
          evidence_type: splitForm.evidence_type || null,
          evidence_note: splitForm.evidence_note || null,
        }) }
      )
      show(`✓ ${r.message}`); setSplitOpen(false); setSplitStep(1); setSplitSelected([]); setSplitNewHead(null)
      refreshDetail(); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 手动补录事件 ──
  const submitEvent = async () => {
    if (!detail) return
    if (!eventForm.description.trim()) return show('请填写事件描述', 'err')
    await req(`/api/households/${detail.id}/events`, {
      method: 'POST',
      body: JSON.stringify({ ...eventForm, event_year: Number(eventForm.event_year) })
    })
    show('✓ 事件已记录'); setEventOpen(false); loadEvents(detail.id)
  }

  // ── 撤销事件 ──
  const undoEvent = async (ev: HHEvent) => {
    if (!detail) return
    if (!confirm('确认撤销此操作？系统将恢复到操作前的状态。')) return
    try {
      await req(`/api/households/${detail.id}/events/${ev.id}?action=undo`, { method: 'DELETE' })
      show('✓ 已撤销')
      // 刷新事件列表、详情、日期列表
      loadEvents(detail.id); refreshDetail()
      const hd = await req<{ events: HistoryDateEvent[] }>(`/api/households/${detail.id}/history-dates`)
      setHistoryDates(hd.events)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 年份折叠切换 ──
  const toggleYear = (yr: number) => {
    setExpandedYears(prev => {
      const next = new Set(prev)
      if (next.has(yr)) next.delete(yr)
      else next.add(yr)
      return next
    })
  }

  // ── 批量组建 ──
  const downloadBuildTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['家庭户编号*', '身份证号*', '姓名（核对用）', '是否户主*', '与户主关系', '土地面积(亩，户主行填)'],
      ['HH001', '510123196503154231', '张国强', '1', '本人', '3.5'],
      ['HH001', '510123197808224567', '李秀英', '0', '妻子', ''],
    ])
    ws['!cols'] = [14, 20, 12, 10, 12, 18].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '模板')
    XLSX.writeFile(wb, '家庭户批量组建模板.xlsx')
  }

  const handleBuildFile = (file: File) => {
    setBuildFile(file); setBuildResult(null)
    const reader = new FileReader()
    reader.onload = e => {
      const wb = XLSX.read(e.target?.result, { type: 'array' })
      setBuildPreview((XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, unknown>[]).slice(0, 5))
    }
    reader.readAsArrayBuffer(file)
  }

  const submitBuild = async () => {
    if (!buildFile) return show('请先上传文件', 'err')
    setBuildLoading(true)
    const reader = new FileReader()
    reader.onload = async e => {
      const wb = XLSX.read(e.target?.result, { type: 'array' })
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, unknown>[]
      const rows = raw.map(r => ({
        household_id: String(r['家庭户编号*'] || r['家庭户编号'] || '').trim(),
        id_card:      String(r['身份证号*']   || r['身份证号']   || '').trim(),
        real_name:    String(r['姓名（核对用）'] || r['姓名'] || '').trim() || undefined,
        is_head:      Number(r['是否户主*']    || r['是否户主']  || 0),
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
  }

  // ─────────────────────────────────────────────
  //  详情页
  // ─────────────────────────────────────────────
  if (detail) {
    const appsByYear: Record<number, typeof detail.app_summary> = {}
    detail.app_summary.forEach(a => {
      if (!appsByYear[a.apply_year]) appsByYear[a.apply_year] = []
      appsByYear[a.apply_year].push(a)
    })

    const canSplit = detail.members.filter(m => m.farmer_status === 1).length >= 2

    // 历史模式下使用历史快照的面积数据
    const areaUsage = historyDate !== null && snapshotData?.snapshot
      ? { contracted_area: snapshotData.snapshot.land_area, used_area: 0, remaining_area: snapshotData.snapshot.land_area, is_overdrawn: false, subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[] }
      : detail.area_usage

    return (
      <div>
        <button onClick={() => setDetail(null)} className="mb-4 text-sm text-emerald-700 hover:underline">← 返回列表</button>

        <div className="flex gap-4">
          {/* ── 左侧：日期级历史滑轨 ── */}
          <div className="w-44 shrink-0">
            <div className="bg-white border border-stone-200 rounded-xl shadow-sm sticky top-4">
              <div className="px-3 py-3 border-b border-stone-100">
                <div className="text-xs text-stone-400 font-medium">历史记录</div>
              </div>
              <div className="py-2 px-2 space-y-0.5 max-h-[60vh] overflow-y-auto">
                {/* 当前按钮 */}
                <button onClick={exitHistory}
                  className={`w-full py-2 rounded-lg text-xs font-medium transition-colors text-left px-2.5
                    ${historyDate === null ? 'bg-emerald-700 text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
                  当前
                </button>
                {/* 按年份折叠 + 日期展开（排除 ORIGINAL） */}
                {(() => {
                  const regularEvents = historyDates.filter(ev => ev.event_type !== 'ORIGINAL')
                  const originalEntry = historyDates.find(ev => ev.event_type === 'ORIGINAL')
                  const byYear: Record<number, HistoryDateEvent[]> = {}
                  regularEvents.forEach(ev => {
                    if (!byYear[ev.event_year]) byYear[ev.event_year] = []
                    byYear[ev.event_year].push(ev)
                  })
                  return (
                    <>
                      {Object.entries(byYear)
                        .sort((a, b) => Number(b[0]) - Number(a[0]))
                        .map(([yrStr, evts]) => {
                          const yr = Number(yrStr)
                          const expanded = expandedYears.has(yr)
                          return (
                            <div key={yr}>
                              <button onClick={() => toggleYear(yr)}
                                className="w-full py-1.5 px-2.5 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-50 flex items-center gap-1 transition-colors">
                                <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
                                {yr}年
                                <span className="ml-auto text-[10px] text-stone-300">{evts.length}</span>
                              </button>
                              {expanded && (
                                <div className="ml-3 space-y-0.5 border-l-2 border-stone-100 pl-2">
                                  {evts.map(ev => {
                                    const cfg = EVENT_TYPE_CFG[ev.event_type] || EVENT_TYPE_CFG.REMARK
                                    return (
                                      <button key={ev.event_id} onClick={() => loadSnapshotAt(ev.date)}
                                        className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors
                                          ${historyDate === ev.date ? 'bg-amber-50 text-amber-700 font-medium' : 'text-stone-500 hover:bg-amber-50 hover:text-amber-700'}`}>
                                        <span className="mr-1">{cfg.icon}</span>
                                        {ev.date?.slice(5) || ev.event_year}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      {/* 初始状态：单独放在最末尾 */}
                      {originalEntry && (
                        <>
                          <div className="my-1 mx-2 border-t border-dashed border-stone-200" />
                          <button onClick={() => loadSnapshotAt(originalEntry.date)}
                            className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors
                              ${historyDate === originalEntry.date ? 'bg-blue-50 text-blue-700 font-medium' : 'text-stone-500 hover:bg-blue-50 hover:text-blue-700'}`}>
                            <span className="mr-1">{EVENT_TYPE_CFG.ORIGINAL.icon}</span>
                            初始状态
                          </button>
                        </>
                      )}
                    </>
                  )
                })()}
                {historyDates.length === 0 && (
                  <div className="text-center py-4 text-xs text-stone-300">暂无变更记录</div>
                )}
              </div>
            </div>
          </div>

          {/* ── 右侧：详情内容 ── */}
          <div className="flex-1 min-w-0">

        {/* 历史模式提示条 */}
        {historyDate !== null && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-3">
            <span className="text-amber-600 text-sm">⏳</span>
            <span className="text-sm text-amber-700 font-medium">正在查看 <b>{historyDate}</b> 历史快照</span>
            {historyLoading && <span className="text-xs text-amber-500">加载中…</span>}
            <button onClick={exitHistory} className="ml-auto text-xs text-amber-600 hover:text-amber-800 underline">返回当前</button>
          </div>
        )}

        {/* 顶部卡片 */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm mb-4">
          <div className="bg-gradient-to-r from-emerald-800 to-emerald-700 px-6 py-4 flex items-center gap-5">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-xl font-bold text-white shrink-0">🏠</div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <span className="text-lg font-bold text-white">{detail.household_name}</span>
                <span className="text-emerald-300 text-xs font-mono">{detail.household_code}</span>
                {detail.area_usage?.is_overdrawn && <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded">⚠️ 超领预警</span>}
                {historyDate !== null && <span className="text-xs bg-amber-500/80 text-white px-2 py-0.5 rounded">⏳ {historyDate} 快照</span>}
              </div>
              <div className="text-emerald-200 text-sm">📍 {detail.village_full_name}
                {detail.address && <span className="ml-2 text-emerald-300 text-xs">{detail.address}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-bold font-mono text-white">
                {historyDate !== null && snapshotData?.snapshot
                  ? (snapshotData.snapshot.land_area > 0 ? `${snapshotData.snapshot.land_area}亩` : '未设置')
                  : (detail.contracted_area > 0 ? `${detail.contracted_area}亩` : '未设置')}
              </div>
              <div className="text-emerald-300 text-xs">承包土地面积</div>
            </div>
            {historyDate === null && (
              <div className="flex flex-col gap-1.5 shrink-0">
                <button onClick={() => { setEditForm({ household_name: detail.household_name, land_area: String(detail.contracted_area || ''), address: detail.address || '', remark: detail.remark || '' }); setEditOpen(true) }}
                  className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg">✏️ 编辑</button>
                {canSplit && (
                  <button onClick={() => { setSplitOpen(true); setSplitStep(1); setSplitSelected([]); setSplitNewHead(null); setSplitForm({ household_name: '', split_year: String(new Date().getFullYear()), split_date: '', new_land_area: '', origin_land_area: String(detail.contracted_area || ''), description: '', evidence_type: '', evidence_note: '' }) }}
                    className="text-xs bg-orange-500/80 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg">🔀 办理分户</button>
                )}
              </div>
            )}
          </div>

          {/* Tab 栏 */}
          <div className="flex border-b border-stone-200 bg-stone-50 items-center">
            {([
              { id: 'members', label: `👥 成员 (${detail.members.length})` },
              { id: 'area',    label: '📐 面积占用' },
              { id: 'subsidy', label: `💰 补贴汇总 (${detail.app_summary.length})` },
              { id: 'history', label: '📋 变更历史' },
            ] as {id: typeof detailTab; label: string}[]).map(t => (
              <button key={t.id} onClick={() => setDetailTab(t.id)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${detailTab === t.id ? 'border-emerald-600 text-emerald-700 bg-white' : 'border-transparent text-stone-500 hover:text-stone-700'}`}>
                {t.label}
              </button>
            ))}
            {historyDate === null && (
            <div className="ml-auto px-3 flex gap-2">
              {detailTab === 'members' && (
                <>
                  <button onClick={() => setMemberImportOpen(true)}
                    className="text-xs border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50">
                    ↑ 批量导入
                  </button>
                  <button onClick={() => { setMemberEditTarget(null); setMemberForm({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1' }); setMemberAddOpen(true) }}
                    className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600">
                    ＋ 新增成员
                  </button>
                </>
              )}
              {detailTab === 'history' && (
                <button onClick={() => setEventOpen(true)}
                  className="text-xs border border-stone-200 text-stone-600 px-3 py-1.5 rounded-lg hover:bg-stone-50">
                  ＋ 补录事件
                </button>
              )}
            </div>
            )}
          </div>

          {/* ── Tab: 成员 ── */}
          {detailTab === 'members' && (
            <div className="p-5 grid gap-2">
              {(historyDate !== null && snapshotData?.snapshot ? snapshotData.snapshot.members : detail.members).length === 0 && <div className="text-center py-8 text-stone-300 text-sm">暂无成员记录</div>}
              {(historyDate !== null && snapshotData?.snapshot ? snapshotData.snapshot.members : detail.members).map(m => (
                <div key={m.id} className={`flex items-center gap-4 rounded-xl px-4 py-3 border transition-colors
                  ${m.is_head ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-stone-200 hover:border-stone-300'}
                  ${m.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                    ${m.is_head ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
                    {m.real_name.slice(-1)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-stone-800">{m.real_name}</span>
                      {m.is_head === 1 && <Tag label="户主" color="green" />}
                      {m.relation && <Tag label={m.relation} color="gray" />}
                      {m.farmer_status !== 1 && <Tag label={FARMER_STATUS_LABEL[m.farmer_status] || '异常'} color="red" />}
                    </div>
                    <div className="text-xs text-stone-400 mt-0.5">
                      {m.gender === 1 ? '男' : '女'}
                      {m.phone_masked && <span className="ml-2">{m.phone_masked}</span>}
                      <span className="ml-2 font-mono">{m.id_card_masked}</span>
                    </div>
                  </div>
                  {historyDate === null && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => openMemberEdit(m)}
                      className="text-xs border border-stone-200 text-stone-500 px-2.5 py-1 rounded-lg hover:border-stone-300">
                      编辑
                    </button>
                    {m.is_head !== 1 && (
                      <button onClick={() => removeMember(m)}
                        className="text-xs border border-amber-200 text-amber-600 px-2.5 py-1 rounded-lg hover:bg-amber-50">
                        移出
                      </button>
                    )}
                  </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Tab: 面积占用 ── */}
          {detailTab === 'area' && (
            <div className="p-5">
              {areaUsage && (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                      { label: '承包面积', val: `${areaUsage.contracted_area}亩`, color: 'text-stone-700' },
                      { label: areaUsage.has_trust_data ? '可耕种面积（含流转）' : '可耕种面积', val: areaUsage.cultivable_area !== undefined ? `${areaUsage.cultivable_area.toFixed(2)}亩` : `${areaUsage.contracted_area}亩`, color: areaUsage.is_overdrawn ? 'text-red-600' : 'text-emerald-700' },
                      { label: '已申报面积', val: `${areaUsage.used_area.toFixed(2)}亩`, color: areaUsage.is_overdrawn ? 'text-red-600' : 'text-amber-600' },
                    ].map(s => (
                      <div key={s.label} className="bg-stone-50 border border-stone-200 rounded-xl p-4 text-center">
                        <div className={`text-xl font-bold font-mono ${s.color}`}>{s.val}</div>
                        <div className="text-xs text-stone-400 mt-1">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {areaUsage.has_trust_data && (
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 text-xs text-blue-700">
                      流出 {areaUsage.trust_out_area?.toFixed(2) ?? 0}亩 · 流入 {areaUsage.trust_in_area?.toFixed(2) ?? 0}亩
                      · 可耕种 = 承包 - 流出 + 流入
                    </div>
                  )}
                  {areaUsage.contracted_area > 0 && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-stone-400 mb-1.5">
                        <span>面积使用率（以可耕种面积为基准）</span>
                        <span>{Math.round(areaUsage.used_area / (areaUsage.cultivable_area ?? areaUsage.contracted_area) * 100)}%</span>
                      </div>
                      <div className="bg-stone-100 rounded-full h-3 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${areaUsage.is_overdrawn ? 'bg-red-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, Math.round(areaUsage.used_area / (areaUsage.cultivable_area ?? areaUsage.contracted_area) * 100))}%` }} />
                      </div>
                    </div>
                  )}
                  {areaUsage.subsidy_breakdown?.length > 0 && (
                    <div>
                      <p className="text-xs text-stone-400 mb-2">各项补贴占用明细：</p>
                      <div className="space-y-2">
                        {areaUsage.subsidy_breakdown.map((b, i) => (
                          <div key={i} className="flex justify-between items-center bg-white border border-stone-200 rounded-lg px-3 py-2">
                            <span className="text-sm">{b.subsidy_name}</span>
                            <span className="text-sm font-mono font-bold text-amber-600">{b.apply_area.toFixed(2)}亩</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Tab: 补贴汇总 ── */}
          {detailTab === 'subsidy' && (
            <div>
              {Object.keys(appsByYear).length === 0 && <div className="py-10 text-center text-stone-300 text-sm">暂无补贴记录</div>}
              {Object.entries(appsByYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yr, apps]) => (
                <div key={yr}>
                  <div className="px-5 py-2 bg-stone-50 border-b border-stone-100 text-xs font-bold text-stone-500">
                    {yr}年度 · {apps.length}条 · 合计 ¥{apps.reduce((s, a) => s + (a.actual_amount || 0), 0).toFixed(2)}
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

          {/* ── Tab: 变更历史 ── */}
          {detailTab === 'history' && (
            <div className="p-5">
              {events.length === 0 && <div className="text-center py-8 text-stone-300 text-sm">暂无变更记录<br/><span className="text-xs">点击右上角「＋ 补录事件」手动添加历史记录</span></div>}
              <div className="relative">
                {/* 时间线竖线 */}
                {events.length > 0 && <div className="absolute left-[19px] top-5 bottom-5 w-0.5 bg-stone-200" />}
                <div className="space-y-4">
                  {events.map(ev => {
                    const cfg = EVENT_TYPE_CFG[ev.event_type] || EVENT_TYPE_CFG.REMARK
                    return (
                      <div key={ev.id} className="flex gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 relative z-10 ${cfg.color}`}>
                          {cfg.icon}
                        </div>
                        <div className="flex-1 bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.label}</span>
                              <span className="text-xs font-bold text-stone-700">{ev.event_year}年</span>
                              {ev.event_date && <span className="text-xs text-stone-400">{ev.event_date}</span>}
                              {ev.farmer_name && <span className="text-xs text-stone-500">· 涉及：{ev.farmer_name}</span>}
                            </div>
                            <span className="text-xs text-stone-300">{ev.created_at?.slice(0, 16)}</span>
                          </div>
                          <p className="text-sm text-stone-700">{ev.description}</p>
                          {ev.evidence_note && <p className="text-xs text-stone-400 mt-1">证明材料：{ev.evidence_note}</p>}
                          {ev.operator && <p className="text-xs text-stone-300 mt-0.5">操作人：{ev.operator}</p>}
                          {ev.undoable && (
                            <button onClick={() => undoEvent(ev)}
                              className="mt-2 text-xs text-red-500 hover:text-red-700 hover:underline">
                              撤销此操作
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
          </div>
        </div>

        {/* ── 编辑弹窗 ── */}
        <Modal open={editOpen} title="编辑家庭户信息" onClose={() => setEditOpen(false)} onConfirm={submitEdit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">户名</label>
              <input value={editForm.household_name} onChange={e => setEditForm(f => ({ ...f, household_name: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            <div><label className="block text-xs text-stone-400 mb-1">承包土地面积（亩）</label>
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

        {/* ── 成员增改弹窗 ── */}
        <Modal open={memberAddOpen} title={memberEditTarget ? `编辑成员 · ${memberEditTarget.real_name}` : '新增成员'}
          onClose={() => { setMemberAddOpen(false); setMemberEditTarget(null) }} onConfirm={submitMember}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-stone-400 mb-1">姓名 *</label>
              <input value={memberForm.real_name} onChange={e => setMemberForm(f => ({ ...f, real_name: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            {!memberEditTarget && (
              <div><label className="block text-xs text-stone-400 mb-1">身份证号 *</label>
                <input value={memberForm.id_card} onChange={e => setMemberForm(f => ({ ...f, id_card: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 font-mono" /></div>
            )}
            <div><label className="block text-xs text-stone-400 mb-1">与户主关系</label>
              <input value={memberForm.relation} onChange={e => setMemberForm(f => ({ ...f, relation: e.target.value }))}
                placeholder="如：本人、妻子、父亲"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            <div><label className="block text-xs text-stone-400 mb-1">状态</label>
              <select value={memberForm.farmer_status} onChange={e => setMemberForm(f => ({ ...f, farmer_status: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                <option value="1">在册</option><option value="2">注销</option>
                <option value="3">迁出</option><option value="4">死亡</option>
              </select></div>
            <div><label className="block text-xs text-stone-400 mb-1">手机号</label>
              <input value={memberForm.phone} onChange={e => setMemberForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            <div><label className="block text-xs text-stone-400 mb-1">银行卡号</label>
              <input value={memberForm.bank_card} onChange={e => setMemberForm(f => ({ ...f, bank_card: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 font-mono" /></div>
            <div className="col-span-2 flex items-center gap-2 pt-1">
              <input type="checkbox" id="is_head_chk" checked={memberForm.is_head} onChange={e => setMemberForm(f => ({ ...f, is_head: e.target.checked }))} />
              <label htmlFor="is_head_chk" className="text-sm text-stone-600 cursor-pointer">设为本户户主</label>
              {memberForm.is_head && <span className="text-xs text-amber-600">（原户主将降为普通成员）</span>}
            </div>
          </div>
        </Modal>

        {/* ── 成员批量导入 ── */}
        <ExcelImport open={memberImportOpen} onClose={() => setMemberImportOpen(false)}
          title={`成员导入 · ${detail.household_name}`}
          templateHeaders={['身份证号*','姓名*','是否户主','与户主关系','手机号','银行卡号','开户行','状态']}
          templateExample={[{ '身份证号*': '510123196503154231','姓名*': '张国强','是否户主': '1','与户主关系': '本人','手机号': '138xxxx0001','银行卡号': '','开户行': '','状态': '在册' }]}
          onImport={handleMemberImport} onSuccess={refreshDetail} />

        {/* ── 分户向导 ── */}
        <Modal open={splitOpen} title="分户向导" onClose={() => setSplitOpen(false)}
          onConfirm={splitStep === 3 ? submitSplit : () => setSplitStep(s => (s + 1) as 1|2|3)}
          confirmText={splitStep === 3 ? '确认分户' : `下一步 (${splitStep}/3)`}
          width={560}>
          <div>
            {/* 步骤指示 */}
            <div className="flex items-center gap-2 mb-5">
              {['选择分出成员','填写新户信息','确认分户'].map((label, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {i > 0 && <div className={`w-8 h-px ${i < splitStep ? 'bg-emerald-400' : 'bg-stone-200'}`} />}
                  <div className={`flex items-center gap-1.5 text-xs font-medium ${splitStep === i+1 ? 'text-emerald-700' : i+1 < splitStep ? 'text-stone-400' : 'text-stone-300'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${splitStep === i+1 ? 'bg-emerald-700 text-white' : i+1 < splitStep ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-100 text-stone-300'}`}>
                      {i+1 < splitStep ? '✓' : i+1}
                    </div>
                    {label}
                  </div>
                </div>
              ))}
            </div>

            {splitStep === 1 && (
              <div>
                <p className="text-xs text-stone-400 mb-3">勾选要从本户分出的成员（至少1人，户主不能被分出）</p>
                <div className="space-y-2">
                  {detail.members.filter(m => m.is_head !== 1).map(m => (
                    <label key={m.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                      ${splitSelected.includes(m.id) ? 'bg-orange-50 border-orange-300' : 'bg-white border-stone-200 hover:border-stone-300'}`}>
                      <input type="checkbox" checked={splitSelected.includes(m.id)}
                        onChange={e => setSplitSelected(prev => e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id))} />
                      <div className="flex-1">
                        <span className="font-semibold text-sm">{m.real_name}</span>
                        <span className="text-xs text-stone-400 ml-2">{m.relation}</span>
                        {splitSelected.includes(m.id) && (
                          <label className="ml-3 flex items-center gap-1 inline-flex cursor-pointer" onClick={e => e.stopPropagation()}>
                            <input type="radio" name="new_head" value={m.id} checked={splitNewHead === m.id}
                              onChange={() => setSplitNewHead(m.id)} />
                            <span className="text-xs text-orange-700">设为新户户主</span>
                          </label>
                        )}
                      </div>
                    </label>
                  ))}
                  {detail.members.filter(m => m.is_head === 1).map(m => (
                    <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl border border-stone-100 bg-stone-50 opacity-50">
                      <input type="checkbox" disabled />
                      <span className="text-sm">{m.real_name}</span>
                      <Tag label="户主（不可分出）" color="gray" />
                    </div>
                  ))}
                </div>
                {splitSelected.length > 0 && !splitNewHead && (
                  <p className="text-xs text-amber-600 mt-2">请选择新户的户主</p>
                )}
              </div>
            )}

            {splitStep === 2 && (
              <div className="space-y-3">
                <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-xs text-orange-700">
                  将分出 {splitSelected.length} 名成员，户主为「{detail.members.find(m => m.id === splitNewHead)?.real_name}」
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-stone-400 mb-1">新家庭户名称 *</label>
                    <input value={splitForm.household_name} onChange={e => setSplitForm(f => ({ ...f, household_name: e.target.value }))}
                      placeholder={`${detail.members.find(m => m.id === splitNewHead)?.real_name || ''}户`}
                      className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">分户年度 *</label>
                    <select value={splitForm.split_year} onChange={e => setSplitForm(f => ({ ...f, split_year: e.target.value }))}
                      className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                      {years.map(y => <option key={y} value={y}>{y}年</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">分户日期（精确）</label>
                    <input type="date" value={splitForm.split_date} onChange={e => setSplitForm(f => ({ ...f, split_date: e.target.value }))}
                      className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">新户土地面积（亩）</label>
                    <input type="number" step="0.01" value={splitForm.new_land_area} onChange={e => setSplitForm(f => ({ ...f, new_land_area: e.target.value }))}
                      placeholder="可不填" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">原户调整后面积（亩）</label>
                    <input type="number" step="0.01" value={splitForm.origin_land_area} onChange={e => setSplitForm(f => ({ ...f, origin_land_area: e.target.value }))}
                      placeholder="不变则不填" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-stone-400 mb-1">分户原因/说明</label>
                    <textarea rows={2} value={splitForm.description} onChange={e => setSplitForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="如：子女独立成家、父母另立门户等"
                      className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
                  </div>
                </div>
              </div>
            )}

            {splitStep === 3 && (
              <div className="space-y-3">
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-orange-800">请确认分户信息</p>
                  <div className="text-xs text-orange-700 space-y-1">
                    <p>原户：{detail.household_name} → 将保留 {detail.members.length - splitSelected.length} 名成员</p>
                    <p>新户：{splitForm.household_name || '（未填写）'} → {splitSelected.length} 名成员</p>
                    <p>新户户主：{detail.members.find(m => m.id === splitNewHead)?.real_name}</p>
                    <p>年度：{splitForm.split_year}年{splitForm.split_date ? ` · ${splitForm.split_date}` : ''}</p>
                    {splitForm.new_land_area && <p>新户面积：{splitForm.new_land_area}亩</p>}
                    {splitForm.origin_land_area && <p>原户调整后面积：{splitForm.origin_land_area}亩</p>}
                  </div>
                </div>
                <p className="text-xs text-stone-400">分户后系统将自动：为新户创建户籍档案 · 将成员移入新户 · 在两户的变更历史中各记录一条分户事件</p>
              </div>
            )}
          </div>
        </Modal>

        {/* ── 手动补录事件 ── */}
        <Modal open={eventOpen} title="补录历史事件" onClose={() => setEventOpen(false)} onConfirm={submitEvent}>
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              用于补录系统上线前的历史变动，或记录口头协议等无法自动捕获的事项。
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-stone-400 mb-1">事件类型</label>
                <select value={eventForm.event_type} onChange={e => setEventForm(f => ({ ...f, event_type: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                  {Object.entries(EVENT_TYPE_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select></div>
              <div><label className="block text-xs text-stone-400 mb-1">发生年度 *</label>
                <select value={eventForm.event_year} onChange={e => setEventForm(f => ({ ...f, event_year: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                  {years.map(y => <option key={y} value={y}>{y}年</option>)}
                </select></div>
              <div><label className="block text-xs text-stone-400 mb-1">精确日期（可选）</label>
                <input type="date" value={eventForm.event_date} onChange={e => setEventForm(f => ({ ...f, event_date: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
              <div><label className="block text-xs text-stone-400 mb-1">证明材料类型</label>
                <select value={eventForm.evidence_type} onChange={e => setEventForm(f => ({ ...f, evidence_type: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                  <option value="NONE">无</option><option value="ID_CARD">身份证</option>
                  <option value="HOUSEHOLD_REG">户籍证明</option><option value="VILLAGE_PROOF">村委证明</option>
                  <option value="COURT">法院文书</option><option value="OTHER">其他</option>
                </select></div>
              <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">事件描述 *</label>
                <textarea rows={3} value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="请描述发生了什么，如：2024年3月，张三迁出本户，移居县城，户籍未迁"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" /></div>
              <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">证明材料说明</label>
                <input value={eventForm.evidence_note} onChange={e => setEventForm(f => ({ ...f, evidence_note: e.target.value }))}
                  placeholder="如：村委证明第2024-08号"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            </div>
          </div>
        </Modal>

        <Toast {...toast} />
      </div>
    )
  }

  // ─────────────────────────────────────────────
  //  列表页
  // ─────────────────────────────────────────────
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
          📥 批量组建
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
            {['户编码','户名','户主','所在位置','成员数','承包面积','已用面积','状态','操作'].map(h => (
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
            <button disabled={page<=1} onClick={() => setPage(p=>p-1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">‹</button>
            <span className="px-2">{page}/{Math.max(1,Math.ceil(total/20))}</span>
            <button disabled={page*20>=total} onClick={() => setPage(p=>p+1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">›</button>
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
                下载模板 → 每行一人 → 同一家庭填相同「家庭户编号」→ 上传
              </div>
              <button onClick={downloadBuildTemplate} className="w-full py-2.5 border-2 border-dashed border-emerald-300 text-emerald-700 rounded-xl text-sm hover:bg-emerald-50">
                ⬇️ 下载模板
              </button>
              <div>
                <label className="block text-xs text-stone-400 mb-1">上传 Excel</label>
                <input type="file" accept=".xlsx,.xls" onChange={e => { if (e.target.files?.[0]) handleBuildFile(e.target.files[0]) }}
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
