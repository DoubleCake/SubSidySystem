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
  const statusLabel = FARMER_STATUS[fd.farmer_status]?.label ?? '未知'

  return (
    <div className="bg-white border border-border rounded-card overflow-hidden shadow-card mb-2.5">
      {/* 档案头 */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#E6E0D4]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#DDBE84] flex items-center justify-center text-[14px] font-bold shrink-0">
            {fd.real_name.slice(-1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{fd.real_name}</h2>
              <span className={`text-[10px] rounded-full px-1.5 py-[1px] ${fd.farmer_status === 1 ? 'bg-[#E2EDE6] text-[#2F5C46]' : 'bg-[#F1EDE4] text-[#5C5749]'}`}>{statusLabel}</span>
              <span className={`text-[10px] rounded-[3px] px-1.5 py-[1px] ${fd.is_head ? 'bg-[#E2EDE6] text-[#2F5C46]' : 'bg-[#F1EDE4] text-[#5C5749]'}`}>
                {fd.is_head ? '户主' : (fd.relation || '成员')}
              </span>
              <span className="text-[10px] text-text-muted">{GENDER(fd.gender)}{age ? ` · ${age} 岁` : ''}</span>
            </div>
            <div className="text-[11px] text-[#7A7466] mt-[3px] truncate">
              {fd.id_card || fd.id_card_masked}
              <span className="mx-1.5">·</span>
              {fd.phone || fd.phone_masked || '—'}
              <span className="mx-1.5">·</span>
              {fd.village_full_name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-text-muted mr-1">
            累计 <b className="font-mono text-primary text-[13px]">{fmt(totalAmt)}</b>
          </span>
        </div>
      </div>

      {/* 四列基础信息 */}
      <div className="grid grid-cols-4 border-b border-[#E6E0D4]">
        {[
          ['身份证号', fd.id_card || fd.id_card_masked || '—'],
          ['手机号', fd.phone || fd.phone_masked || '—'],
          ['出生日期', fd.birth_date ? `${fd.birth_date.slice(0, 10)}${age ? ` · ${age} 岁` : ''}` : '—'],
          ['银行卡', fd.bank_card || fd.bank_card_masked || '—'],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#E6E0D4]' : ''}`}>
            <div className="text-[9.5px] text-[#7A7466]">{k}</div>
            <div className="text-[11.5px] text-[#5C5749] mt-px font-mono truncate">{v}</div>
          </div>
        ))}
      </div>

      {/* 补贴记录 */}
      {apps.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-[#E6E0D4]">
            <span className="text-[11.5px] font-semibold">补贴记录 <span className="text-[10px] text-text-muted font-normal">{apps.length}</span></span>
            <span className="text-[10px] text-text-muted">合计 <b className="font-mono text-primary">{fmt(totalAmt)}</b></span>
          </div>
          <div className="overflow-x-auto max-h-[196px] overflow-y-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0">
                <tr className="bg-[#F3EFE7] text-[#7A7466] text-[10px] text-left">
                  {['年度', '补贴项目', '面积', '申请金额', '实发金额', '状态'].map(h => (
                    <th key={h} className="font-medium px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apps.map((a, idx) => (
                  <tr key={a.id ?? `app-${a.farmer_id}-${a.apply_year}-${a.subsidy_name}`}
                    className="border-t border-[#E6E0D4] hover:bg-[#F2F7F4] transition-colors">
                    <td className="px-2.5 py-1.5 font-semibold text-primary">{a.apply_year}</td>
                    <td className="px-2.5 py-1.5">{a.subsidy_name}</td>
                    <td className="px-2.5 py-1.5 font-mono text-right">{a.apply_area ? `${a.apply_area}` : '—'}</td>
                    <td className="px-2.5 py-1.5 font-mono text-text-muted text-right">{a.apply_amount ? fmt(a.apply_amount) : '—'}</td>
                    <td className="px-2.5 py-1.5 font-mono font-semibold text-right" style={{ color: a.actual_amount ? '#2F5C46' : '#B8863B' }}>
                      {a.actual_amount ? fmt(a.actual_amount) : '待发放'}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${a.pay_status === 2 ? 'bg-[#E2EDE6] text-[#2F5C46]' : a.pay_status === 1 ? 'bg-[#FBF3E2] text-[#8A6118]' : 'bg-[#F1EDE4] text-[#5C5749]'}`}>
                        {PAY_STATUS[a.pay_status]?.label || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    restricted_identity: string
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
    restricted_identity: string
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
    <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
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
      <div className="bg-gradient-to-r from-emerald-50 to-emerald-100/70 border-b border-emerald-100 px-5 py-3.5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-card bg-primary-500/10 flex items-center justify-center text-lg font-bold text-primary shrink-0">🏠</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-base font-bold text-text-primary">{hh.household_name}</span>
            <span className="text-text-muted text-xs font-mono">{hh.household_code}</span>
            {areaUsage?.is_overdrawn && <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">⚠️ 超领</span>}
            {historyEventId !== null && <span className="text-xs bg-amber-500/80 text-white px-1.5 py-0.5 rounded">⏳ 快照</span>}
          </div>
          <div className="text-text-muted text-xs">📍 {hh.village_full_name}
            {hh.address && <span className="ml-1 text-text-muted">{hh.address}</span>}
          </div>
        </div>
        <div className="text-right shrink-0 mr-2">
          <div className="text-lg font-bold font-mono text-primary-100">
            {historyEventId !== null && snapshotData?.snapshot
              ? (snapshotData.snapshot.contract_area > 0 ? `${snapshotData.snapshot.contract_area}亩` : '未设置')
              : (hh.contracted_area > 0 ? `${hh.contracted_area}亩` : '未设置')}
          </div>
          <div className="text-text-muted text-xs">承包面积</div>
        </div>
      </div>

      {/* 快照备注信息 */}
      {historyEventId !== null && (() => {
        const currentEvent = historyDates.find(e => e.event_id === historyEventId)
        if (currentEvent?.description) {
          const cfg = EVENT_TYPE_CFG[currentEvent.event_type] || EVENT_TYPE_CFG.REMARK
          return (
            <div className="bg-warm/30 border-b border-border px-5 py-3">
              <div className="flex items-start gap-2">
                <span className="text-lg shrink-0">{cfg.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-xs text-text-muted">{currentEvent.date || `${currentEvent.event_year}年`}</span>
                  </div>
                  <p className="text-sm text-text-primary">{currentEvent.description}</p>
                </div>
              </div>
            </div>
          )
        }
        return null
      })()}

      {/* Tab 栏 */}
      <div className="flex border-b border-border bg-warm/30 items-center">
        {([
          { id: 'members', label: `👥 成员 (${displayMembers.length})` },
          { id: 'subsidy', label: `💰 补贴记录 (${hh.app_summary.length})` },
        ] as { id: typeof detailTab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setDetailTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
              ${detailTab === t.id ? 'border-emerald-600 text-primary bg-white' : 'border-transparent text-text-muted hover:text-text-primary'}`}>
            {t.label}
          </button>
        ))}
        {historyEventId === null && (
          <div className="ml-auto px-2 flex gap-1.5">
            {detailTab === 'members' && (
              <>
                <button onClick={onOpenMemberImport} className="text-xs border border-primary-500/20 text-primary px-2.5 py-1 rounded-btn hover:bg-primary-500/5 transition-colors">↑ 批量导入</button>
                <button onClick={() => {
                  onOpenMemberAdd()
                }}
                  className="text-xs bg-primary-500 text-white px-2.5 py-1 rounded-btn hover:bg-primary-500/90 transition-colors">＋ 成员</button>
                <button onClick={onOpenEvent} className="text-xs border border-border text-text-primary px-2.5 py-1 rounded-btn hover:bg-warm/30 transition-colors">＋ 补录</button>
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
            {displayMembers.length === 0 && <div className="text-center py-8 text-text-muted/50 text-sm">暂无成员记录</div>}
            {displayMembers.map(m => (
              <div key={m.id} className={`flex items-center gap-3 rounded-card px-4 py-3 border transition-colors
                ${m.is_head ? 'bg-primary-500/5 border-primary-500/20' : 'bg-white border-border hover:border-border hover:bg-warm/30'}
                ${m.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                  ${m.is_head ? 'bg-primary-500/90 text-white' : 'bg-warm/30 text-text-muted'}`}>
                  {m.real_name.slice(-1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-text-primary">{m.real_name}</span>
                    {m.is_head === 1 && <Tag label="户主" color="green" />}
                    {m.relation && <Tag label={m.relation} color="gray" />}
                    {m.farmer_status !== 1 && <Tag label={FARMER_STATUS[m.farmer_status]?.label ?? '异常'} color="red" />}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {m.gender === 1 ? '男' : '女'}
                    {m.phone_masked && <span className="ml-2">{m.phone_masked}</span>}
                    <span className="ml-2 font-mono">{m.id_card_masked}</span>
                  </div>
                </div>
                {historyEventId === null && (
                  <div className="flex gap-1.5 shrink-0">
                    {selectedFarmerId !== m.id && (
                      <button onClick={() => onOpenFarmer(m.id)} className="text-xs text-primary border border-primary-500/20 px-2 py-1 rounded-btn hover:bg-primary-500/5 transition-colors">查看</button>
                    )}
                    <button onClick={() => onOpenMemberEdit(m)} className="text-xs border border-border text-text-muted px-2 py-1 rounded-btn hover:border-border transition-colors">编辑</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 补贴记录 */}
        {detailTab === 'subsidy' && (
          <div>
            {Object.keys(appsByYear).length === 0 && <div className="py-10 text-center text-text-muted/50 text-sm">暂无补贴记录</div>}
            {Object.entries(appsByYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yr, apps]) => (
              <div key={yr}>
                <div className="px-5 py-2 bg-warm/30 border-b border-border/50 text-xs font-bold text-text-muted">
                  {yr}年度 · {apps.length}条 · 合计 ¥{apps.reduce((s, a) => s + (a.actual_amount || 0), 0).toFixed(2)}
                </div>
                {apps.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-border/50 hover:bg-warm/30 transition-colors">
                    <span className="text-sm text-text-muted w-16 shrink-0">{a.farmer_name}</span>
                    <span className="text-sm flex-1">{a.subsidy_name}</span>
                    {a.apply_area && <span className="text-xs text-text-muted font-mono">{a.apply_area}亩</span>}
                    <span className="text-sm font-mono font-bold text-primary">{a.actual_amount ? fmt(a.actual_amount) : '—'}</span>
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
      <div className="bg-white border border-border rounded-card shadow-card">
        <div className="px-3 py-2 border-b border-border/50 bg-warm/30">
          <div className="text-xs font-semibold text-text-primary">历史记录</div>
        </div>
        <div className="py-2 px-2 space-y-1 max-h-[50vh] overflow-y-auto">
          <button onClick={onExitHistory}
            className={`w-full py-2.5 rounded-btn text-xs font-medium transition-all text-left px-3
              ${historyEventId === null ? 'bg-primary-500/90 text-white shadow-card' : 'text-text-muted hover:bg-warm/30'}`}>
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
                        className="w-full py-2 px-3 rounded-btn text-xs font-medium text-text-primary hover:bg-warm/30 flex items-center gap-1.5 transition-colors">
                        <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
                        {yr}年
                        <span className="ml-auto text-[11px] text-text-muted bg-warm/30 px-1.5 py-0.5 rounded">{evts.length}</span>
                      </button>
                      {expanded && (
                        <div className="ml-4 space-y-1 border-l-2 border-border/50 pl-2 mt-1">
                          {evts.map(ev => {
                            const cfg = EVENT_TYPE_CFG[ev.event_type] || EVENT_TYPE_CFG.REMARK
                            return (
                              <button key={ev.event_id} onClick={() => hhId && onLoadSnapshotAt(ev.date, hhId, ev.event_id)}
                                className={`w-full text-left px-2.5 py-2 rounded-btn text-xs transition-all
                                  ${historyEventId === ev.event_id ? 'bg-amber-100 text-amber-800 font-medium shadow-card' : 'text-text-muted hover:bg-amber-50 hover:text-amber-800'}`}>
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
                    <div className="my-2 mx-2 border-t border-dashed border-border" />
                    <button onClick={() => hhId && onLoadSnapshotAt(originalEntry.date, hhId, originalEntry.event_id)}
                      className={`w-full text-left px-3 py-2.5 rounded-btn text-xs transition-all
                        ${historyEventId === originalEntry.event_id ? 'bg-blue-100 text-blue-800 font-medium shadow-card' : 'text-text-muted hover:bg-blue-50 hover:text-blue-800'}`}>
                      <span className="mr-1.5">{EVENT_TYPE_CFG.ORIGINAL.icon}</span>
                      初始状态
                    </button>
                  </>
                )}
              </>
            )
          })()}
          {historyDates.length === 0 && (
            <div className="text-center py-5 text-xs text-text-muted/50">暂无变更记录</div>
          )}
        </div>
      </div>
    </div>
  )
}
