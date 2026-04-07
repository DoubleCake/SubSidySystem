/**
 * 户籍管理页 - 农户详情相关组件
 * - FarmerDetail: 农户详情卡片（个人信息 + 补贴记录）
 * - FarmerHouseholdDetail: 农户所属家庭户详情卡片
 * - HistorySidebar: 历史记录侧边栏
 */
import Tag from '../components/Tag'
import { EVENT_TYPE_CFG, GENDER, calcAge } from './FarmerConstants'
import { FARMER_STATUS, PAY_STATUS, fmt } from '../utils'
import type { FarmerDetail, HHDetail, HistoryDateEvent, SnapshotAtResponse, HHMember, SnapshotMember, VillageGroup } from '../types'

// ── 农户详情卡片 Props ──
export interface FarmerDetailProps {
  selectedFarmer: FarmerDetail | null
  /** 是否显示补贴记录（与家庭户一致），默认false显示个人applications */
  showAppSummary?: boolean
  /** app_summary数据（showAppSummary=true时使用） */
  appSummary?: {
    apply_year: number; farmer_id: number; farmer_name: string; subsidy_name: string
    calc_mode: string; apply_area: number | null; apply_amount: number | null; actual_amount: number | null
    pay_status: number; apply_village_name: string; apply_group_display: string; is_proxy: number
    proxy_info?: { type: string; proxy_name?: string; beneficiary_name?: string; proxy_farmer_id?: number; beneficiary_farmer_id?: number; remark?: string } | null
  }[]
}

// ── 农户详情卡片 ──
export function FarmerDetail({ selectedFarmer, showAppSummary, appSummary }: FarmerDetailProps) {
  if (!selectedFarmer) return null
  const fd = selectedFarmer
  const apps: any[] = showAppSummary && appSummary
    ? appSummary
    : (fd.applications || [])
  const totalAmt = apps.reduce((s: number, a: any) => s + Number(a.actual_amount || 0), 0)
  const age = calcAge(fd.birth_date)

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md mb-4">
      <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 px-6 py-5 flex items-center gap-5">
        <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white shrink-0">
          {fd.real_name.slice(-1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <span className="text-xl font-bold text-white">{fd.real_name}</span>
            <span className="text-emerald-200 text-sm">{GENDER(fd.gender)}</span>
            {age && <span className="text-emerald-200 text-sm">{age} 岁</span>}
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded">{FARMER_STATUS[fd.farmer_status]?.label ?? '未知'}</span>
            {fd.is_head ? <span className="text-xs bg-purple-500/80 text-white px-2 py-0.5 rounded">户主</span> : <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded">{fd.relation || '成员'}</span>}
          </div>
          <div className="text-emerald-200 text-sm">📍 {fd.village_full_name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold font-mono text-white">¥{totalAmt.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</div>
          <div className="text-emerald-200 text-xs mt-0.5">累计获得补贴</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-0 divide-x divide-stone-100">
        <div className="p-5">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">个人信息</h3>
          <div className="space-y-3">
            {[
              ['姓名', fd.real_name],
              ['性别', GENDER(fd.gender)],
              ['年龄', age ? `${age} 岁` : '—'],
              ['身份证号', <span key="id" className="font-mono text-amber-600 text-xs select-all">{fd.id_card || fd.id_card_masked}</span>],
              ['手机号', <span key="ph" className="font-mono text-xs">{fd.phone || fd.phone_masked || '—'}</span>],
              ['所在村组', fd.village_full_name],
            ].map(([k, v], i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-stone-400 w-20 shrink-0">{k}</span>
                <span className="text-sm text-stone-700">{v as React.ReactNode}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">银行 & 其他</h3>
          <div className="space-y-3">
            {[
              ['银行卡号', <span key="bc" className="font-mono text-xs text-amber-600 select-all">{fd.bank_card || fd.bank_card_masked || '—'}</span>],
              ['开户行', fd.bank_name || '—'],
              ['农户状态', <Tag key="st" label={FARMER_STATUS[fd.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[fd.farmer_status]?.color as 'green'} />],
              ['备注', fd.remark || '—'],
              ['录入时间', fd.created_at ? fd.created_at.slice(0, 10) : '—'],
            ].map(([k, v], i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-stone-400 w-20 shrink-0">{k}</span>
                <span className="text-sm text-stone-700">{v as React.ReactNode}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 补贴记录 */}
      {apps.length > 0 && (
        <div className="border-t border-stone-200">
          <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
            <span className="text-sm font-medium text-stone-700">补贴记录 ({apps.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="bg-stone-50 border-b border-stone-200">
                {['年度', '补贴项目', '面积', '申请金额', '实发金额', '状态'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {apps.map((a, idx) => (
                  <tr key={a.id ?? `app-${a.farmer_id}-${a.apply_year}-${a.subsidy_name}`} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-2 text-sm font-bold text-emerald-600">{a.apply_year}</td>
                    <td className="px-4 py-2 text-sm">{a.subsidy_name}</td>
                    <td className="px-4 py-2 text-sm font-mono">{a.apply_area ? `${a.apply_area}亩` : '—'}</td>
                    <td className="px-4 py-2 text-sm font-mono text-stone-500">{fmt(a.apply_amount)}</td>
                    <td className="px-4 py-2 text-sm font-mono font-bold" style={{ color: a.actual_amount ? '#059669' : '#d97706' }}>
                      {a.actual_amount ? fmt(a.actual_amount) : '待发放'}
                    </td>
                    <td className="px-4 py-2"><Tag label={PAY_STATUS[a.pay_status]?.label} color={PAY_STATUS[a.pay_status]?.color as 'green'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-100 flex justify-end gap-6 text-sm">
            <span className="text-stone-500">合计 {apps.length} 笔</span>
            <span className="font-bold font-mono text-emerald-700">¥{totalAmt.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 农户所属家庭户详情卡片 Props ──
export interface FarmerHouseholdDetailProps {
  selectedFarmerHousehold: HHDetail | null
  historyEventId: number | null
  snapshotData: SnapshotAtResponse | null
  historyDates: HistoryDateEvent[]
  historyLoading: boolean
  detailTab: 'members' | 'subsidy'
  setDetailTab: (t: 'members' | 'subsidy') => void
  onExitHistory: () => void
  onLoadSnapshotAt: (date: string, householdId: number, eventId?: number) => void
  selectedFarmerId: number | null
  groups: VillageGroup[]
  onOpenMemberEdit: (m: HHMember | SnapshotMember) => void
  onOpenFarmer: (id: number) => void
  onOpenMemberAdd: () => void
  onOpenMemberImport: () => void
  onOpenEvent: () => void
  getHistoryDateByEventId: (eventId: number | null) => string | null
  memberForm: {
    real_name: string
    id_card: string
    gender: string
    relation: string
    is_head: boolean
    phone: string
    bank_card: string
    bank_name: string
    farmer_status: string
    event_date: string
    village_id: number
    group_no: number
    village_name: string
    group_name: string
  }
  setMemberForm: React.Dispatch<React.SetStateAction<{
    real_name: string
    id_card: string
    gender: string
    relation: string
    is_head: boolean
    phone: string
    bank_card: string
    bank_name: string
    farmer_status: string
    event_date: string
    village_id: number
    group_no: number
    village_name: string
    group_name: string
  }>>
  memberEditTarget: HHMember | null
}

// ── 农户所属家庭户详情卡片 ──
export function FarmerHouseholdDetail({
  selectedFarmerHousehold,
  historyEventId,
  snapshotData,
  historyDates,
  historyLoading,
  detailTab,
  setDetailTab,
  onExitHistory,
  onLoadSnapshotAt,
  selectedFarmerId,
  groups,
  onOpenMemberEdit,
  onOpenFarmer,
  onOpenMemberAdd,
  onOpenMemberImport,
  onOpenEvent,
  getHistoryDateByEventId,
  memberForm,
  setMemberForm,
  memberEditTarget,
}: FarmerHouseholdDetailProps) {
  if (!selectedFarmerHousehold) return null

  const hh = selectedFarmerHousehold
  const appsByYear: Record<number, typeof hh.app_summary> = {}
  hh.app_summary.forEach(a => {
    if (!appsByYear[a.apply_year]) appsByYear[a.apply_year] = []
    appsByYear[a.apply_year].push(a)
  })
  const displayMembers = historyEventId !== null && snapshotData?.snapshot ? snapshotData.snapshot.members : hh.members
  const defaultAreaUsage = {
    contracted_area: hh.contracted_area || 0,
    trust_out_area: 0,
    trust_in_area: 0,
    cultivable_area: hh.contracted_area || 0,
    used_area: 0,
    remaining_area: hh.contracted_area || 0,
    is_overdrawn: false,
    overdraw_amount: 0,
    has_trust_data: false,
    subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[],
    season_breakdown: {} as Record<string, any>,
    year_totals: {} as Record<string, Record<string, number>>
  }
  const areaUsage = historyEventId !== null && snapshotData?.snapshot
    ? { contracted_area: snapshotData.snapshot.contract_area, trust_out_area: 0, trust_in_area: 0, cultivable_area: snapshotData.snapshot.contract_area, used_area: 0, remaining_area: snapshotData.snapshot.contract_area, is_overdrawn: false, overdraw_amount: 0, has_trust_data: false, subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[], season_breakdown: {} as Record<string, any>, year_totals: {} as Record<string, Record<string, number>> }
    : (hh.area_usage || defaultAreaUsage)

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md">
      {/* 历史模式提示 */}
      {historyEventId !== null && (
        <div className="bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center gap-3 shrink-0">
          <span className="text-amber-600 text-sm">⏳</span>
          <span className="text-sm text-amber-700 font-medium">正在查看 <b>{getHistoryDateByEventId(historyEventId)}</b> 历史快照</span>
          {historyLoading && <span className="text-xs text-amber-500">加载中…</span>}
          <button onClick={onExitHistory} className="ml-auto text-xs text-amber-600 hover:text-amber-800 underline">返回当前</button>
        </div>
      )}

      {/* 顶部卡片 */}
      <div className="bg-gradient-to-r from-emerald-800 to-emerald-700 px-5 py-3.5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-lg font-bold text-white shrink-0">🏠</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-base font-bold text-white">{hh.household_name}</span>
            <span className="text-emerald-300 text-xs font-mono">{hh.household_code}</span>
            {areaUsage?.is_overdrawn && <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">⚠️ 超领</span>}
            {historyEventId !== null && <span className="text-xs bg-amber-500/80 text-white px-1.5 py-0.5 rounded">⏳ 快照</span>}
          </div>
          <div className="text-emerald-200 text-xs">📍 {hh.village_full_name}
            {hh.address && <span className="ml-1 text-emerald-300">{hh.address}</span>}
          </div>
        </div>
        <div className="text-right shrink-0 mr-2">
          <div className="text-lg font-bold font-mono text-white">
            {historyEventId !== null && snapshotData?.snapshot
              ? (snapshotData.snapshot.contract_area > 0 ? `${snapshotData.snapshot.contract_area}亩` : '未设置')
              : (hh.contracted_area > 0 ? `${hh.contracted_area}亩` : '未设置')}
          </div>
          <div className="text-emerald-300 text-xs">承包面积</div>
        </div>
      </div>

      {/* 快照备注信息 */}
      {historyEventId !== null && (() => {
        const currentEvent = historyDates.find(e => e.event_id === historyEventId)
        if (currentEvent?.description) {
          const cfg = EVENT_TYPE_CFG[currentEvent.event_type] || EVENT_TYPE_CFG.REMARK
          return (
            <div className="bg-stone-50 border-b border-stone-200 px-5 py-3">
              <div className="flex items-start gap-2">
                <span className="text-lg shrink-0">{cfg.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-xs text-stone-500">{currentEvent.date || `${currentEvent.event_year}年`}</span>
                  </div>
                  <p className="text-sm text-stone-700">{currentEvent.description}</p>
                </div>
              </div>
            </div>
          )
        }
        return null
      })()}

      {/* Tab 栏 */}
      <div className="flex border-b border-stone-200 bg-stone-50 items-center">
        {([
          { id: 'members', label: `👥 成员 (${displayMembers.length})` },
          { id: 'subsidy', label: `💰 补贴记录 (${hh.app_summary.length})` },
        ] as { id: typeof detailTab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setDetailTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
              ${detailTab === t.id ? 'border-emerald-600 text-emerald-700 bg-white' : 'border-transparent text-stone-500 hover:text-stone-700'}`}>
            {t.label}
          </button>
        ))}
        {historyEventId === null && (
          <div className="ml-auto px-2 flex gap-1.5">
            {detailTab === 'members' && (
              <>
                <button onClick={onOpenMemberImport} className="text-xs border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-lg hover:bg-emerald-50 transition-colors">↑ 批量导入</button>
                <button onClick={() => {
                  onOpenMemberAdd()
                }}
                  className="text-xs bg-emerald-700 text-white px-2.5 py-1 rounded-lg hover:bg-emerald-600 transition-colors">＋ 成员</button>
                <button onClick={onOpenEvent} className="text-xs border border-stone-200 text-stone-600 px-2.5 py-1 rounded-lg hover:bg-stone-50 transition-colors">＋ 补录</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tab 内容 */}
      <div className="max-h-80 overflow-y-auto">
        {/* 成员 */}
        {detailTab === 'members' && (
          <div className="p-4 grid gap-2">
            {displayMembers.length === 0 && <div className="text-center py-8 text-stone-300 text-sm">暂无成员记录</div>}
            {displayMembers.map(m => (
              <div key={m.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors
                ${m.is_head ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50'}
                ${m.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                  ${m.is_head ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
                  {m.real_name.slice(-1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-stone-800">{m.real_name}</span>
                    {m.is_head === 1 && <Tag label="户主" color="green" />}
                    {m.relation && <Tag label={m.relation} color="gray" />}
                    {m.farmer_status !== 1 && <Tag label={FARMER_STATUS[m.farmer_status]?.label ?? '异常'} color="red" />}
                  </div>
                  <div className="text-xs text-stone-400 mt-0.5">
                    {m.gender === 1 ? '男' : '女'}
                    {m.phone_masked && <span className="ml-2">{m.phone_masked}</span>}
                    <span className="ml-2 font-mono">{m.id_card_masked}</span>
                  </div>
                </div>
                {historyEventId === null && (
                  <div className="flex gap-1.5 shrink-0">
                    {selectedFarmerId !== m.id && (
                      <button onClick={() => onOpenFarmer(m.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors">查看</button>
                    )}
                    <button onClick={() => onOpenMemberEdit(m)} className="text-xs border border-stone-200 text-stone-500 px-2 py-1 rounded-lg hover:border-stone-300 transition-colors">编辑</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 补贴记录 */}
        {detailTab === 'subsidy' && (
          <div>
            {Object.keys(appsByYear).length === 0 && <div className="py-10 text-center text-stone-300 text-sm">暂无补贴记录</div>}
            {Object.entries(appsByYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yr, apps]) => (
              <div key={yr}>
                <div className="px-5 py-2 bg-stone-50 border-b border-stone-100 text-xs font-bold text-stone-500">
                  {yr}年度 · {apps.length}条 · 合计 ¥{apps.reduce((s, a) => s + (a.actual_amount || 0), 0).toFixed(2)}
                </div>
                {apps.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-stone-50 hover:bg-stone-50 transition-colors">
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
    </div>
  )
}

// ── 历史记录侧边栏 Props ──
export interface HistorySidebarProps {
  householdId?: number
  historyEventId: number | null
  historyDates: HistoryDateEvent[]
  expandedYears: Set<number>
  onExitHistory: () => void
  onToggleYear: (yr: number) => void
  onLoadSnapshotAt: (date: string, householdId: number, eventId?: number) => void
}

// ── 历史记录侧边栏 ──
export function HistorySidebar({ householdId, historyEventId, historyDates, expandedYears, onExitHistory, onToggleYear, onLoadSnapshotAt }: HistorySidebarProps) {
  const hhId = householdId
  return (
    <div className="w-48 shrink-0">
      <div className="bg-white border border-stone-200 rounded-xl shadow-md">
        <div className="px-3 py-2 border-b border-stone-100 bg-stone-50">
          <div className="text-xs font-semibold text-stone-600">历史记录</div>
        </div>
        <div className="py-2 px-2 space-y-1 max-h-[50vh] overflow-y-auto">
          <button onClick={onExitHistory}
            className={`w-full py-2.5 rounded-lg text-xs font-medium transition-all text-left px-3
              ${historyEventId === null ? 'bg-emerald-600 text-white shadow-sm' : 'text-stone-500 hover:bg-stone-100'}`}>
            当前
          </button>
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
                {Object.entries(byYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yrStr, evts]) => {
                  const yr = Number(yrStr)
                  const expanded = expandedYears.has(yr)
                  return (
                    <div key={yr}>
                      <button onClick={() => onToggleYear(yr)}
                        className="w-full py-2 px-3 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 flex items-center gap-1.5 transition-colors">
                        <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
                        {yr}年
                        <span className="ml-auto text-[11px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">{evts.length}</span>
                      </button>
                      {expanded && (
                        <div className="ml-4 space-y-1 border-l-2 border-stone-100 pl-2 mt-1">
                          {evts.map(ev => {
                            const cfg = EVENT_TYPE_CFG[ev.event_type] || EVENT_TYPE_CFG.REMARK
                            return (
                              <button key={ev.event_id} onClick={() => hhId && onLoadSnapshotAt(ev.date, hhId, ev.event_id)}
                                className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all
                                  ${historyEventId === ev.event_id ? 'bg-amber-100 text-amber-800 font-medium shadow-sm' : 'text-stone-500 hover:bg-amber-50 hover:text-amber-800'}`}>
                                <div className="flex items-center gap-1.5">
                                  <span>{cfg.icon}</span>
                                  <span>{ev.date?.slice(5) || ev.event_year}</span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
                {originalEntry && (
                  <>
                    <div className="my-2 mx-2 border-t border-dashed border-stone-200" />
                    <button onClick={() => hhId && onLoadSnapshotAt(originalEntry.date, hhId, originalEntry.event_id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-all
                        ${historyEventId === originalEntry.event_id ? 'bg-blue-100 text-blue-800 font-medium shadow-sm' : 'text-stone-500 hover:bg-blue-50 hover:text-blue-800'}`}>
                      <span className="mr-1.5">{EVENT_TYPE_CFG.ORIGINAL.icon}</span>
                      初始状态
                    </button>
                  </>
                )}
              </>
            )
          })()}
          {historyDates.length === 0 && (
            <div className="text-center py-5 text-xs text-stone-300">暂无变更记录</div>
          )}
        </div>
      </div>
    </div>
  )
}
