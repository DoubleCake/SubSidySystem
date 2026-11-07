/**
 * 户籍管理页 - 家庭户详情组件
 */
import Tag from '../components/Tag'
import { EVENT_TYPE_CFG } from './FarmerConstants'
import { FARMER_STATUS, PAY_STATUS, RESTRICTED_IDENTITY, fmt } from '../utils'
import type { HHDetail, HistoryDateEvent, SnapshotAtResponse, HHEvent, HHMember, SnapshotMember } from '../types'

// ── 家庭户详情组件 Props ──
export interface HouseholdDetailContentProps {
  detail: HHDetail
  detailTab: 'members' | 'subsidy'
  setDetailTab: (t: 'members' | 'subsidy') => void
  areaYear: number
  setAreaYear: (y: number) => void
  historyDate: string | null
  historyEventId: number | null
  historyDates: HistoryDateEvent[]
  snapshotData: SnapshotAtResponse | null
  events: HHEvent[]
  historyDateIsNull: boolean
  onOpenMemberImport: () => void
  onOpenMemberAdd: () => void
  onOpenEvent: () => void
  onOpenFarmer: (id: number) => void
  onOpenMemberEdit: (m: HHMember | SnapshotMember) => void
  onRemoveMember: (m: HHMember | SnapshotMember) => void
  onOpenEdit: () => void
  onOpenSplit: () => void
  canSplit: boolean
  onOpenManualConfirm: () => void
  onOpenCancelConfirm: () => void
  onDelete: () => void
  onNavigateToProject?: (subsidyTypeId: number, farmerName: string) => void
  onOpenHousehold?: (householdId: number) => void
}

// ── 家庭户详情内容组件 ──
export function HouseholdDetailContent({
  detail,
  detailTab,
  setDetailTab,
  areaYear,
  setAreaYear,
  historyDate,
  historyEventId,
  historyDates,
  snapshotData,
  events,
  historyDateIsNull,
  onOpenMemberImport,
  onOpenMemberAdd,
  onOpenEvent,
  onOpenFarmer,
  onOpenMemberEdit,
  onRemoveMember,
  onOpenEdit,
  onOpenSplit,
  canSplit,
  onOpenManualConfirm,
  onOpenCancelConfirm,
  onDelete,
  onNavigateToProject,
  onOpenHousehold,
}: HouseholdDetailContentProps) {
  const appsByYear: Record<number, typeof detail.app_summary> = {}
  detail.app_summary.forEach(a => {
    if (!appsByYear[a.apply_year]) appsByYear[a.apply_year] = []
    appsByYear[a.apply_year].push(a)
  })
  // 统计不计入超限面积（apply_area_no_calc）按年度汇总
  const noCalcByYear: Record<number, number> = {}
  detail.app_summary.forEach(a => {
    const area = Number(a.apply_area_no_calc || 0)
    if (area > 0) noCalcByYear[a.apply_year] = (noCalcByYear[a.apply_year] || 0) + area
  })
  const displayMembers = historyDate !== null && snapshotData?.snapshot ? snapshotData.snapshot.members : detail.members
  const defaultAreaUsage = {
    contracted_area: detail.contracted_area || 0,
    trust_out_area: 0,
    trust_in_area: 0,
    trust_in_arable_area: 0,
    trust_in_cash_crop_area: 0,
    cultivable_area: detail.contracted_area || 0,
    used_area: 0,
    remaining_area: detail.contracted_area || 0,
    is_overdrawn: false,
    overdraw_amount: 0,
    has_trust_data: false,
    subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[],
    season_reference: {} as Record<string, number>,
    season_breakdown: {} as Record<string, any>,
    year_totals: {} as Record<string, Record<string, number>>,
    year_apply_totals: {} as Record<string, Record<string, number>>,
    year_payment_totals: {} as Record<string, Record<string, number>>
  }
  const areaUsage = historyDate !== null && snapshotData?.snapshot
    ? { contracted_area: snapshotData.snapshot.contract_area, trust_out_area: 0, trust_in_area: 0, trust_in_arable_area: 0, trust_in_cash_crop_area: 0, cultivable_area: snapshotData.snapshot.contract_area, used_area: 0, remaining_area: snapshotData.snapshot.contract_area, is_overdrawn: false, overdraw_amount: 0, has_trust_data: false, subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[], season_reference: {} as Record<string, number>, season_breakdown: {} as Record<string, any>, year_totals: {} as Record<string, Record<string, number>>, year_apply_totals: {} as Record<string, Record<string, number>>, year_payment_totals: {} as Record<string, Record<string, number>> }
    : (detail.area_usage || defaultAreaUsage)

  // 不同季节不跨季累加，取单季最大面积作为概览
  const calcSeasonMax = (yt: Record<string, number> | undefined): number => {
    if (!yt || Object.keys(yt).length === 0) return 0
    return Math.max(...Object.values(yt).filter(v => v > 0), 0)
  }
  const effectiveUsedArea = areaYear > 0 && areaUsage.year_totals?.[String(areaYear)]
    ? calcSeasonMax(areaUsage.year_totals[String(areaYear)])
    : areaUsage.used_area
  const effectiveRemainingArea = Math.max(0, (areaUsage.cultivable_area ?? areaUsage.contracted_area) - effectiveUsedArea)
  // 任一季节超面积即超领
  const effectiveIsOverdrawn = areaYear > 0 && areaUsage.year_totals?.[String(areaYear)]
    ? Object.values(areaUsage.year_totals[String(areaYear)]).some(v => (areaUsage.cultivable_area ?? areaUsage.contracted_area) > 0 && v > (areaUsage.cultivable_area ?? areaUsage.contracted_area) + 0.001)
    : areaUsage.is_overdrawn
  const effectiveOverdrawAmount = Math.max(0, effectiveUsedArea - (areaUsage.cultivable_area ?? areaUsage.contracted_area))

  const refArea = (areaUsage.cultivable_area ?? areaUsage.contracted_area) || 0
  const overYears = Object.entries(areaUsage.year_totals || {})
    .filter(([, seasons]) => refArea > 0 && Object.values(seasons).some((v: number) => v > refArea + 0.001))
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([year]) => year)
  const activeMembers = displayMembers.filter(m => m.farmer_status === 1).length
  const areaYears = [...new Set((detail.app_summary || []).map((a: { apply_year: number }) => a.apply_year))].sort((a, b) => b - a)

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* 户档案头 */}
      <div className="bg-white border border-border rounded-card overflow-hidden shadow-card mb-2.5 shrink-0">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#F2EDE3]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
              {detail.household_name?.slice(0, 1) || '户'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{detail.household_name}</h2>
                <span className="text-[10px] border border-border rounded-[3px] px-1.5 py-[1px] text-[#8C877A] font-mono">{detail.household_code}</span>
                {overYears.length > 0
                  ? <span className="text-[10px] bg-[#FDECEA] text-danger rounded-full px-1.5 py-[1px]">超领 {overYears.length} 项</span>
                  : <span className="text-[10px] bg-[#EDF3EF] text-[#2C6B52] rounded-full px-1.5 py-[1px]">面积正常</span>}
                {detail.is_manually_confirmed === 1 && <span className="text-[10px] bg-[#EDF3EF] text-[#2C6B52] rounded-[3px] px-1.5 py-[1px]">已确认</span>}
                {historyDate !== null && <span className="text-[10px] bg-[#F6EEDC] text-[#8A6620] rounded-[3px] px-1.5 py-[1px]">快照</span>}
              </div>
              <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
                {detail.village_full_name}
                {detail.address ? ` · ${detail.address}` : ''}
                <span className="mx-1.5">·</span>
                {displayMembers.length} 名成员 · 在册 {activeMembers}
                {detail.manually_confirmed_at && <><span className="mx-1.5">·</span>人工确认 {detail.manually_confirmed_at.slice(0, 10)}</>}
              </div>
            </div>
          </div>
          {historyDateIsNull && (
            <div className="flex items-center gap-1.5 shrink-0">
              {canSplit && (
                <button onClick={onOpenSplit} className="h-7 px-2.5 border border-border rounded-btn bg-white text-[11px] text-text-secondary hover:bg-warm/30 transition-colors">分户</button>
              )}
              {detail.is_manually_confirmed === 1 ? (
                <button onClick={onOpenCancelConfirm} className="h-7 px-2.5 border border-border rounded-btn bg-white text-[11px] text-[#8A6620] hover:bg-[#FDFAF3] transition-colors">取消确认</button>
              ) : (
                <button onClick={onOpenManualConfirm} className="h-7 px-2.5 border border-[#C9DCC9] rounded-btn bg-[#F7FAF7] text-[11px] text-[#2C6B52] hover:bg-[#EDF3EF] transition-colors">人工确认</button>
              )}
              <button onClick={onOpenEdit} className="h-7 px-2.5 border border-[#E8D8B8] rounded-btn bg-[#FDFAF3] text-[11px] text-[#8A6620] hover:bg-[#F6EEDC] transition-colors">编辑档案</button>
              <button onClick={onDelete} className="h-7 px-2 text-[11px] text-text-muted hover:text-danger transition-colors">删除</button>
            </div>
          )}
        </div>

        {/* 面积与发放条 */}
        <div className="flex items-center gap-0 px-4 py-2.5 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7]">
          <div className="flex items-center gap-2 min-w-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D8B567" strokeWidth="1.6" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 11v9h14v-9" /><path d="M9 20v-5h6v5" /></svg>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold truncate">面积与发放</div>
              <div className="text-[9.5px] text-white/55">{areaYear > 0 ? `${areaYear} 年度` : '全部年度'} · 按季节累计</div>
            </div>
          </div>
          <div className="flex items-center ml-auto">
            <div className="px-4 border-l border-white/15">
              <div className="text-[9.5px] text-white/55">参考面积</div>
              <div className="text-[15px] font-bold text-[#E6C288] font-mono">{refArea.toFixed(2)} 亩</div>
            </div>
            <div className="px-4 border-l border-white/15">
              <div className="text-[9.5px] text-white/55">已使用</div>
              <div className="text-[15px] font-bold font-mono">{effectiveUsedArea.toFixed(2)} 亩</div>
            </div>
            <div className="px-4 border-l border-white/15">
              <div className="text-[9.5px] text-white/55">剩余</div>
              <div className="text-[15px] font-bold font-mono">{effectiveRemainingArea.toFixed(2)} 亩</div>
            </div>
            <div className="px-4 border-l border-white/15">
              <div className="text-[9.5px] text-white/55">超出</div>
              <div className={`text-[15px] font-bold font-mono ${effectiveIsOverdrawn ? 'text-[#F2B8A8]' : ''}`}>
                {effectiveIsOverdrawn ? `+${effectiveOverdrawAmount.toFixed(2)} 亩` : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* 快照备注 */}
        {historyEventId !== null && (() => {
          const currentEvent = historyDates.find(e => e.event_id === historyEventId)
          if (currentEvent?.description) {
            const cfg = EVENT_TYPE_CFG[currentEvent.event_type] || EVENT_TYPE_CFG.REMARK
            return (
              <div className="bg-[#FBF8F1] border-t border-[#F0E6D2] px-4 py-2 flex items-start gap-2">
                <span className={`text-[9.5px] px-1.5 py-[1px] rounded-[2px] shrink-0 ${cfg.color}`}>{cfg.label}</span>
                <span className="text-[11px] text-[#6B5322] flex-1">
                  {currentEvent.date || `${currentEvent.event_year} 年`} · {currentEvent.description}
                </span>
              </div>
            )
          }
          return null
        })()}

        {/* 面积构成 */}
        <div className="grid grid-cols-4 border-t border-[#F2EDE3]">
          {[
            ['承包面积', `${areaUsage.contracted_area ?? 0} 亩`],
            ['确权面积', detail.confirmed_area != null ? `${detail.confirmed_area} 亩` : '—'],
            ['转入 / 转出', `${(areaUsage.trust_in_area ?? 0).toFixed(2)} / ${(areaUsage.trust_out_area ?? 0).toFixed(2)}`],
            ['不予补贴', `${detail.no_subsidy_area ?? 0} 亩`],
          ].map(([k, v], i) => (
            <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
              <div className="text-[9.5px] text-[#9A9588]">{k}</div>
              <div className="text-[11.5px] text-[#5A5A4F] mt-px font-mono">{v}</div>
            </div>
          ))}
        </div>

        {/* 季节面积使用 */}
        {areaUsage.season_breakdown && Object.keys(areaUsage.season_breakdown).length > 0 && (
          <div className="border-t border-[#F2EDE3] px-4 py-2">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-semibold">各季面积使用</span>
              {areaYears.length > 0 && (
                <select value={areaYear || areaYears[0]} onChange={e => setAreaYear(Number(e.target.value))}
                  className="h-6 border border-border rounded-btn px-1.5 text-[10.5px] bg-white outline-none">
                  {areaYears.map(y => <option key={y} value={y}>{y} 年</option>)}
                </select>
              )}
              <span className="ml-auto text-[9.5px] text-text-muted">深绿=已发放 · 鎏金=预申请</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {Object.entries(areaUsage.season_breakdown).map(([season, usage]) => {
                const used = areaYear === 0 ? (usage.used_area || 0) : (areaUsage.year_totals?.[String(areaYear)]?.[season] || 0)
                const applyArea = areaYear === 0 ? (usage.apply_area || 0) : (areaUsage.year_apply_totals?.[String(areaYear)]?.[season] || 0)
                const payArea = areaYear === 0 ? (usage.payment_area || 0) : (areaUsage.year_payment_totals?.[String(areaYear)]?.[season] || 0)
                const seasonRef = usage.reference_area ?? (areaUsage.season_reference?.[season]) ?? refArea
                const pct = seasonRef > 0 ? Math.round(used / seasonRef * 100) : 0
                const payPct = seasonRef > 0 ? Math.round(payArea / seasonRef * 100) : 0
                const applyPct = seasonRef > 0 ? Math.round((applyArea - payArea) / seasonRef * 100) : 0
                const over = used > seasonRef + 0.001
                return (
                  <div key={season}>
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span>
                        <b className={over ? 'text-danger' : 'text-primary'}>{season}</b>
                        <span className="text-text-muted ml-2">{used.toFixed(2)} / {seasonRef.toFixed(2)} 亩</span>
                        {over && <span className="ml-2 text-[9.5px] bg-[#FDECEA] text-danger rounded-[2px] px-1">超 {(used - seasonRef).toFixed(2)}</span>}
                      </span>
                      <span className="text-text-muted">{pct}%</span>
                    </div>
                    <div className="h-[5px] bg-[#F2EDE3] rounded-full mt-1 overflow-hidden flex">
                      <div className="h-[5px] bg-[#1A4D3A]" style={{ width: `${Math.min(100, payPct)}%` }} />
                      <div className="h-[5px] bg-[#C9A24A]" style={{ width: `${Math.min(100 - payPct, applyPct)}%` }} />
                    </div>
                  </div>
                )
              })}
              {(() => {
                const noCalcTotal = areaYear === 0
                  ? Object.values(noCalcByYear).reduce((s, v) => s + v, 0)
                  : (noCalcByYear[areaYear] || 0)
                if (noCalcTotal <= 0) return null
                return (
                  <div className="flex items-center justify-between text-[10.5px] text-text-muted pt-1 border-t border-dashed border-border">
                    <span>不占用补贴面积</span><b className="font-mono">{noCalcTotal.toFixed(2)} 亩</b>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {/* 流转记录 */}
        {detail.trust_records && detail.trust_records.length > 0 && (
          <div className="border-t border-[#F2EDE3] px-4 py-2">
            <details>
              <summary className="text-[11px] font-semibold cursor-pointer">流转记录 <span className="text-text-muted font-normal">{detail.trust_records.length}</span></summary>
              <div className="mt-1 max-h-32 overflow-y-auto">
                {detail.trust_records.map((t, i) => (
                  <div key={t.id || i} className="flex items-center gap-2 text-[10.5px] py-1 border-b border-[#F2EDE3] last:border-0">
                    <span className={`shrink-0 font-semibold ${t.direction === '流入' ? 'text-[#2C6B52]' : 'text-[#B8863B]'}`}>
                      {t.direction === '流入' ? '＋流入' : '－流出'}
                    </span>
                    <span className="text-text-muted shrink-0 truncate max-w-[120px]">{t.counterparty || '—'}</span>
                    <span className="font-mono shrink-0">{t.area?.toFixed(2)} 亩</span>
                    <span className="text-text-muted/70 shrink-0 truncate">{t.trust_type}</span>
                    <span className="text-text-muted/70 shrink-0">{t.trust_year} 年</span>
                    {t.end_date && <span className="text-text-muted/50 shrink-0">至 {t.end_date}</span>}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {historyDateIsNull && (
          <div className="flex items-center justify-end gap-3 px-4 py-1.5 border-t border-[#F2EDE3] text-[10.5px]">
            <button onClick={onOpenMemberImport} className="text-text-muted hover:text-primary transition-colors">导入成员</button>
            <button onClick={onOpenEvent} className="text-text-muted hover:text-primary transition-colors">补录事件</button>
            <button onClick={() => alert('导出功能开发中')} className="text-text-muted hover:text-primary transition-colors">导出补贴</button>
          </div>
        )}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 bg-white border border-border rounded-card overflow-hidden shadow-card flex min-h-0">
        <div className="w-[128px] shrink-0 border-r border-border bg-warm/20 p-2 flex flex-col gap-1">
          {([
            { id: 'members', label: '家庭成员', count: displayMembers.length },
            { id: 'subsidy', label: '补贴记录', count: detail.app_summary.length },
          ] as { id: typeof detailTab; label: string; count: number }[]).map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)}
              className={`flex items-center justify-between h-9 px-2.5 rounded-btn text-sm transition-colors border-l-[3px]
                ${detailTab === t.id
                  ? 'border-primary bg-primary-500/10 text-primary font-semibold'
                  : 'border-transparent text-text-muted hover:text-text-primary hover:bg-warm/30'}`}>
              <span>{t.label}</span>
              <span className="text-meta opacity-70">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-b border-border/60 min-h-[40px]">
            {historyDateIsNull && detailTab === 'members' && (
              <>
                <button onClick={onOpenMemberImport} className="text-xs border border-primary-500/30 text-primary bg-primary-500/[0.04] px-2.5 py-1.5 rounded-btn hover:bg-primary-500/10 transition-colors font-medium">批量导入</button>
                <button onClick={onOpenMemberAdd} className="text-xs bg-primary-500 text-white px-2.5 py-1.5 rounded-btn hover:bg-primary-500/90 transition-colors">＋ 成员</button>
                <button onClick={onOpenEvent} className="text-xs border border-border text-text-primary px-2.5 py-1.5 rounded-btn hover:bg-warm/30 transition-colors">＋ 补录</button>
              </>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
        {/* 成员 */}
        {detailTab === 'members' && (
          <div className="p-4 grid gap-2">
            {displayMembers.length === 0 && <div className="text-center py-8 text-text-muted/50 text-sm">暂无成员记录</div>}
            {displayMembers.map(m => (
              <div key={m.id} className={`flex items-center gap-3 rounded-card px-4 py-3 border transition-all
                ${m.is_head ? 'bg-primary-500/5 border-primary-500/20' : 'bg-main border-border hover:border-border hover:bg-warm/30'}
                ${m.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                  ${m.is_head ? 'bg-primary-500/90 ' : 'bg-warm/30 text-text-muted'}`}>
                  {m.real_name.slice(-1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-text-primary">{m.real_name}</span>
                    {m.is_head === 1 && <Tag label="户主" color="green" />}
                    {m.relation && <Tag label={m.relation} color="gray" />}
                    {m.farmer_status !== 1 && <Tag label={FARMER_STATUS[m.farmer_status]?.label ?? '异常'} color="red" />}
                    {m.restricted_identity === 1 && <Tag label={RESTRICTED_IDENTITY[1]?.label} color="red" />}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {m.gender === 1 ? '男' : '女'}
                    <span className="ml-2">{m.phone_masked || '—'}</span>
                    <span className="ml-2 font-mono">{m.id_card || m.id_card_masked}</span>
                  </div>
                </div>
                {historyDateIsNull && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => onOpenFarmer(m.id)} className="text-xs text-primary border border-primary-500/20 px-2 py-1 rounded-btn hover:bg-primary-500/5 transition-colors">查看农户</button>
                    <button onClick={() => onOpenMemberEdit(m)} className="text-xs border border-border text-text-muted px-2 py-1 rounded-btn hover:border-border transition-colors">编辑</button>
                    {m.is_head !== 1 && (
                      <button onClick={() => onRemoveMember(m)} className="text-xs border border-amber-200 text-amber-600 px-2 py-1 rounded-btn hover:bg-amber-50 transition-colors">移出</button>
                    )}
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
                    <div className="flex items-center gap-2 flex-wrap w-16 shrink-0">
                      <span className="text-sm text-text-muted">{a.farmer_name}</span>
                    </div>
                    {/* 村组信息 */}
                    {(a.apply_village_name || a.apply_group_display) && (
                      <span className="text-xs text-text-muted font-mono bg-warm/30 px-1.5 py-0.5 rounded">
                        {a.apply_village_name}{a.apply_group_display}
                      </span>
                    )}
                    <span className="text-sm flex-1">{a.subsidy_name}</span>
                    {/* 代领标签：根据当前记录的人是受益人还是代领人显示 */}
                    {a.proxy_info && (() => {
                      const proxy = a.proxy_info
                      const farmerId = Number(a.farmer_id)
                      const isBenefit = farmerId === Number(proxy.beneficiary_farmer_id)
                      // 跳转到对方的家庭户
                      const targetHhId = isBenefit ? proxy.proxy_household_id : proxy.beneficiary_household_id
                      return (
                        <span className="group relative shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (targetHhId) onOpenHousehold(Number(targetHhId))
                            }}
                            disabled={!targetHhId}
                            className="cursor-pointer hover:brightness-90 transition-all disabled:opacity-50 disabled:cursor-default"
                            title={`受益: ${proxy.beneficiary_name || '?'}\n代领: ${proxy.proxy_name || '?'}${proxy.remark ? '\n备注: ' + proxy.remark : ''}\n点击跳转 →`}
                          >
                            <span className={`px-1.5 py-0.5 text-xs font-semibold rounded-full border ${
                              isBenefit
                                ? 'bg-red-50 text-red-700 border-red-300'
                                : 'bg-blue-50 text-blue-700 border-blue-300'
                            }`}>
                              {isBenefit ? '受益' : '代领'}
                            </span>
                          </button>
                        </span>
                      )
                    })()}
                    {(a.apply_area != null || a.apply_area_no_calc != null) && (
                      <span className="text-xs text-text-muted font-mono" title={`计入超限 ${a.apply_area || 0}亩 / 不计超限 ${a.apply_area_no_calc || 0}亩`}>
                        <span>{Number(a.apply_area || 0).toFixed(2)}</span>
                        {a.apply_area_no_calc ? <span className="text-text-muted/50">+{Number(a.apply_area_no_calc).toFixed(2)}</span> : null}亩
                      </span>
                    )}
                    <span className="text-sm font-mono font-bold text-primary">{a.actual_amount ? fmt(a.actual_amount) : '—'}</span>
                    <Tag label={PAY_STATUS[a.pay_status]?.label || '—'} color={PAY_STATUS[a.pay_status]?.color as 'green'} />
                    {onNavigateToProject && (
                      <button onClick={() => onNavigateToProject(Number(a.subsidy_type_id) || 0, a.farmer_name)}
                        className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded-btn hover:bg-blue-50 whitespace-nowrap shrink-0">
                        ↗ 查看明细
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

          </div>
        </div>
      </div>
    </div>
  )
}