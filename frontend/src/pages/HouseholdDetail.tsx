/**
 * 户籍管理页 - 家庭户详情组件
 */
import Tag from '../components/Tag'
import { EVENT_TYPE_CFG } from './FarmerConstants'
import { FARMER_STATUS, PAY_STATUS, fmt } from '../utils'
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
  onRefreshCache: (householdId: number) => void
  refreshingCache: boolean
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
  onRefreshCache,
  refreshingCache,
}: HouseholdDetailContentProps) {
  const appsByYear: Record<number, typeof detail.app_summary> = {}
  detail.app_summary.forEach(a => {
    if (!appsByYear[a.apply_year]) appsByYear[a.apply_year] = []
    appsByYear[a.apply_year].push(a)
  })
  const displayMembers = historyDate !== null && snapshotData?.snapshot ? snapshotData.snapshot.members : detail.members
  const defaultAreaUsage = {
    contracted_area: detail.contracted_area || 0,
    trust_out_area: 0,
    trust_in_area: 0,
    cultivable_area: detail.contracted_area || 0,
    used_area: 0,
    remaining_area: detail.contracted_area || 0,
    is_overdrawn: false,
    overdraw_amount: 0,
    has_trust_data: false,
    subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[],
    season_breakdown: {} as Record<string, any>,
    year_totals: {} as Record<string, Record<string, number>>
  }
  const areaUsage = historyDate !== null && snapshotData?.snapshot
    ? { contracted_area: snapshotData.snapshot.contract_area, trust_out_area: 0, trust_in_area: 0, cultivable_area: snapshotData.snapshot.contract_area, used_area: 0, remaining_area: snapshotData.snapshot.contract_area, is_overdrawn: false, overdraw_amount: 0, has_trust_data: false, subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[], season_breakdown: {} as Record<string, any>, year_totals: {} as Record<string, Record<string, number>> }
    : (detail.area_usage || defaultAreaUsage)

  // 按选定年份计算有效统计值（areaYear=0 表示"全部年份"，使用后端已算好的总值）
  const effectiveUsedArea = areaYear > 0 && areaUsage.year_totals?.[String(areaYear)]
    ? Object.values(areaUsage.year_totals[String(areaYear)]).reduce((s, v) => s + v, 0)
    : areaUsage.used_area
  const effectiveRemainingArea = areaUsage.contracted_area - effectiveUsedArea
  const effectiveIsOverdrawn = areaUsage.contracted_area > 0 && effectiveUsedArea > areaUsage.contracted_area
  const effectiveOverdrawAmount = Math.max(0, effectiveUsedArea - areaUsage.contracted_area)

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* 顶部卡片 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md mb-3 shrink-0">
        <div className="bg-gradient-to-r from-emerald-800 to-emerald-700 px-5 py-3.5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-lg font-bold text-white shrink-0">🏠</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-base font-bold text-white">{detail.household_name}</span>
              <span className="text-emerald-300 text-xs font-mono">{detail.household_code}</span>
              {detail.is_manually_confirmed === 1 && <span className="text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded">✓ 已确认</span>}
              {effectiveIsOverdrawn && <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">⚠️ 超领</span>}
              {historyDate !== null && <span className="text-xs bg-amber-500/80 text-white px-1.5 py-0.5 rounded">⏳ 快照</span>}
            </div>
            <div className="text-emerald-200 text-xs">📍 {detail.village_full_name}
              {detail.address && <span className="ml-1 text-emerald-300">{detail.address}</span>}
            </div>
          </div>
          <div className="text-right shrink-0 mr-2">
            <div className="text-lg font-bold font-mono text-white">
              {historyDate !== null && snapshotData?.snapshot
                ? (snapshotData.snapshot.contract_area > 0 ? `${snapshotData.snapshot.contract_area}亩` : '未设置')
                : (detail.contracted_area > 0 ? `${detail.contracted_area}亩` : '未设置')}
            </div>
            <div className="text-emerald-300 text-xs">承包面积</div>
          </div>
          {historyDateIsNull && (
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={onOpenEdit}
                className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">✏️ 编辑</button>
              {detail.is_manually_confirmed === 1 ? (
                <button onClick={onOpenCancelConfirm}
                  className="text-xs bg-amber-500/80 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">↩️ 取消确认</button>
              ) : (
                <button onClick={onOpenManualConfirm}
                  className="text-xs bg-blue-500/80 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">✓ 人工确认</button>
              )}
              {canSplit && (
                <button onClick={onOpenSplit}
                  className="text-xs bg-orange-500/80 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">🔀 分户</button>
              )}
              <button onClick={() => onRefreshCache(detail.id)} disabled={refreshingCache}
                className="text-xs bg-purple-500/80 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {refreshingCache ? '⏳' : '🔄'} 刷新缓存
              </button>
              <button onClick={onDelete}
                className="text-xs bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">🗑️ 删除</button>
            </div>
          )}
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

        {/* 人口和面积概览 */}
        <div className="px-4 py-3 bg-gradient-to-b from-stone-50 to-white border-b border-stone-200">
          <div className="flex items-center gap-4">
            {/* 人口 */}
            <div className="flex items-center gap-2">
              <span className="text-2xl">👥</span>
              <div>
                <div className="text-lg font-bold text-stone-700">{displayMembers.length}</div>
                <div className="text-xs text-stone-400">人口</div>
              </div>
            </div>

            <div className="w-px h-10 bg-stone-200" />

            {/* 承包面积 */}
            <div className="flex items-center gap-2">
              <span className="text-2xl">📐</span>
              <div>
                <div className="text-lg font-bold font-mono text-stone-700">{areaUsage.contracted_area} 亩</div>
                <div className="text-xs text-stone-400">承包面积</div>
              </div>
            </div>

            {detail.confirmed_area != null && (
              <>
                <div className="w-px h-10 bg-stone-200" />
                {/* 确权面积 */}
                <div className="flex items-center gap-2">
                  <span className="text-2xl">📋</span>
                  <div>
                    <div className="text-lg font-bold font-mono text-blue-700">{detail.confirmed_area} 亩</div>
                    <div className="text-xs text-stone-400">确权面积</div>
                  </div>
                </div>
                {(() => {
                  const diff = Math.round((detail.confirmed_area! - areaUsage.contracted_area) * 100) / 100
                  if (Math.abs(diff) <= 0.001) return null
                  return (
                    <>
                      <div className="w-px h-10 bg-stone-200" />
                      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${diff > 0 ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-sky-50 border-sky-200 text-sky-700'}`}>
                        {diff > 0 ? `确权多 ${diff}亩` : `承包多 ${Math.abs(diff)}亩`}
                      </div>
                    </>
                  )
                })()}
              </>
            )}

            <div className="w-px h-10 bg-stone-200" />

            {/* 已用面积 */}
            <div className="flex items-center gap-2">
              <span className="text-2xl">📊</span>
              <div>
                <div className={"text-lg font-bold font-mono " + (effectiveIsOverdrawn ? 'text-red-500' : 'text-emerald-600')}>
                  {effectiveUsedArea.toFixed(1)} 亩
                </div>
                <div className="text-xs text-stone-400">已用面积</div>
              </div>
            </div>

            <div className="w-px h-10 bg-stone-200" />

            {/* 剩余 */}
            <div className="flex items-center gap-2">
              <span className="text-2xl">✨</span>
              <div>
                <div className={"text-lg font-bold font-mono " + (effectiveRemainingArea < 0 ? 'text-red-500' : 'text-blue-600')}>
                  {effectiveRemainingArea.toFixed(1)} 亩
                </div>
                <div className="text-xs text-stone-400">剩余可申请</div>
              </div>
            </div>

            {effectiveIsOverdrawn && (
              <>
                <div className="w-px h-10 bg-stone-200" />
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1">
                  <span className="text-lg">⚠️</span>
                  <div>
                    <div className="text-sm font-bold text-red-600">超限 {effectiveOverdrawAmount.toFixed(1)} 亩</div>
                    <div className="text-xs text-red-400">请注意</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 人工确认信息 */}
        {detail.is_manually_confirmed === 1 && (
          <div className="bg-blue-50 border-b border-blue-100 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-blue-700">
              <span className="text-lg">✅</span>
              <span className="font-medium">已人工确认</span>
              {detail.manually_confirmed_at && (
                <span className="text-blue-500">
                  · {new Date(detail.manually_confirmed_at).toLocaleString('zh-CN')}
                </span>
              )}
              {detail.manually_confirmed_by && (
                <span className="text-blue-500">· 操作人: {detail.manually_confirmed_by}</span>
              )}
            </div>
          </div>
        )}

        {/* 补贴面积使用情况 - 大春小春等直接展示 */}
        {areaUsage && areaUsage.season_breakdown && Object.keys(areaUsage.season_breakdown).length > 0 && (
          <div className="bg-white border-b border-stone-200 px-4 py-3">
            {/* 年份选择器 - 从 app_summary 获取年份 */}
            {(() => {
              const allYears = [...new Set(
                (detail.app_summary || []).map((a: { apply_year: number }) => a.apply_year)
              )].sort((a, b) => b - a)
              return (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-stone-500 font-medium">📊 补贴面积使用情况</span>
                  {allYears.length > 0 && (
                    <select
                      value={areaYear}
                      onChange={e => setAreaYear(Number(e.target.value))}
                      className="border border-stone-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-emerald-400 bg-white"
                    >
                      <option value={0}>全部年份</option>
                      {allYears.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  )}
                  {areaYear !== 0 && (
                    <span className="text-xs text-emerald-600">已筛选至 {areaYear} 年度</span>
                  )}
                </div>
              )
            })()}
            <div className="space-y-2">
              {Object.entries(areaUsage.season_breakdown).map(([season, usage]) => {
                // 计算该季节在该年度的使用面积
                let yearUsedArea = 0
                let yearApplyArea = 0  // 预申请面积
                let yearPaymentArea = 0  // 已发布面积
                if (areaYear === 0) {
                  // 全部年份：使用季节的总使用面积
                  yearUsedArea = usage.used_area || 0
                  yearApplyArea = usage.apply_area || 0
                  yearPaymentArea = usage.payment_area || 0
                } else {
                  // 指定年份：从 year_totals 中获取
                  yearUsedArea = areaUsage.year_totals?.[String(areaYear)]?.[season] || 0
                  // 注意：这里我们需要从 season_breakdown 中获取 apply_area 和 payment_area
                  yearApplyArea = usage.apply_area || 0
                  yearPaymentArea = usage.payment_area || 0
                }
                const pct = areaUsage.contracted_area > 0 ? Math.round(yearUsedArea / areaUsage.contracted_area * 100) : 0
                const paymentPct = areaUsage.contracted_area > 0 ? Math.round(yearPaymentArea / areaUsage.contracted_area * 100) : 0
                const applyPct = areaUsage.contracted_area > 0 ? Math.round((yearApplyArea - yearPaymentArea) / areaUsage.contracted_area * 100) : 0
                const isOverdrawn = yearUsedArea > areaUsage.contracted_area
                return (
                  <div key={season} className="border border-stone-200 rounded-lg overflow-hidden">
                    <div className={"flex items-center justify-between px-3 py-2 " + (isOverdrawn ? 'bg-red-50' : 'bg-stone-50')}>
                      <div className="flex items-center gap-2">
                        <span className={"text-sm font-bold " + (isOverdrawn ? 'text-red-600' : 'text-stone-700')}>{season}</span>
                        {isOverdrawn && <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">超 {(yearUsedArea - areaUsage.contracted_area).toFixed(2)} 亩</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={"text-sm font-mono font-bold " + (isOverdrawn ? 'text-red-500' : 'text-emerald-600')}>{yearUsedArea.toFixed(2)} 亩</span>
                        <span className="text-xs text-stone-400">/ {areaUsage.contracted_area} 亩</span>
                        <span className="text-xs text-stone-500">({pct}%)</span>
                      </div>
                    </div>
                    <div className="px-3 py-1.5 bg-white">
                      <div className="bg-stone-100 rounded-full h-1.5 overflow-hidden flex">
                        {/* 已发布面积用绿色 */}
                        {yearPaymentArea > 0 && (
                          <div
                            className="h-full bg-emerald-400"
                            style={{ width: Math.min(100, paymentPct) + "%" }}
                          />
                        )}
                        {/* 预申请面积用蓝色 */}
                        {(yearApplyArea - yearPaymentArea) > 0 && (
                          <div
                            className="h-full bg-blue-400"
                            style={{ width: Math.min(100 - paymentPct, applyPct) + "%" }}
                          />
                        )}
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-stone-500">
                        {yearPaymentArea > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                            已发布 {yearPaymentArea.toFixed(2)} 亩
                          </span>
                        )}
                        {(yearApplyArea - yearPaymentArea) > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                            预申请 {(yearApplyArea - yearPaymentArea).toFixed(2)} 亩
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tab 栏 */}
        <div className="flex border-b border-stone-200 bg-stone-50 items-center">
          {([
            { id: 'members', label: `👥 成员 (${displayMembers.length})` },
            { id: 'subsidy', label: `💰 补贴记录 (${detail.app_summary.length})` },
          ] as { id: typeof detailTab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${detailTab === t.id ? 'border-emerald-600 text-emerald-700 bg-white' : 'border-transparent text-stone-500 hover:text-stone-700'}`}>
              {t.label}
            </button>
          ))}
          {historyDateIsNull && (
            <div className="ml-auto px-2 flex gap-1.5">
              {detailTab === 'members' && (
                <>
                  <button onClick={onOpenMemberImport} className="text-xs border border-emerald-200 text-emerald-700 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors">↑ 批量导入</button>
                  <button onClick={onOpenMemberAdd} className="text-xs bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg hover:bg-emerald-600 transition-colors">＋ 成员</button>
                  <button onClick={onOpenEvent} className="text-xs border border-stone-200 text-stone-600 px-2.5 py-1.5 rounded-lg hover:bg-stone-50 transition-colors">＋ 补录</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md">
        {/* 成员 */}
        {detailTab === 'members' && (
          <div className="p-4 grid gap-2">
            {displayMembers.length === 0 && <div className="text-center py-8 text-stone-300 text-sm">暂无成员记录</div>}
            {displayMembers.map(m => (
              <div key={m.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all
                ${m.is_head ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50'}
                ${m.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                  ${m.is_head ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
                  {m.real_name.slice(-1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-stone-800">{m.real_name}</span>
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
                {historyDateIsNull && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => onOpenFarmer(m.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors">查看农户</button>
                    <button onClick={() => onOpenMemberEdit(m)} className="text-xs border border-stone-200 text-stone-500 px-2 py-1 rounded-lg hover:border-stone-300 transition-colors">编辑</button>
                    {m.is_head !== 1 && (
                      <button onClick={() => onRemoveMember(m)} className="text-xs border border-amber-200 text-amber-600 px-2 py-1 rounded-lg hover:bg-amber-50 transition-colors">移出</button>
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
            {Object.keys(appsByYear).length === 0 && <div className="py-10 text-center text-stone-300 text-sm">暂无补贴记录</div>}
            {Object.entries(appsByYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yr, apps]) => (
              <div key={yr}>
                <div className="px-5 py-2 bg-stone-50 border-b border-stone-100 text-xs font-bold text-stone-500">
                  {yr}年度 · {apps.length}条 · 合计 ¥{apps.reduce((s, a) => s + (a.actual_amount || 0), 0).toFixed(2)}
                </div>
                {apps.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-stone-50 hover:bg-stone-50 transition-colors">
                    <span className="text-sm text-stone-500 w-16 shrink-0">{a.farmer_name}</span>
                    {/* 村组信息 */}
                    {(a.apply_village_name || a.apply_group_display) && (
                      <span className="text-xs text-stone-400 font-mono bg-stone-100 px-1.5 py-0.5 rounded">
                        {a.apply_village_name}{a.apply_group_display}
                      </span>
                    )}
                    <span className="text-sm flex-1">{a.subsidy_name}</span>
                    {a.apply_area && <span className="text-xs text-stone-400 font-mono">{a.apply_area}亩</span>}
                    {a.proxy_info && (
                      <span className="group relative">
                        <Tag label={a.proxy_info.type} color="amber" />
                        <div className="absolute right-0 top-full mt-1 bg-stone-800 text-white text-xs px-2 py-1.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                          {a.proxy_info.type === '代领'
                            ? <>代领人: {a.proxy_info.beneficiary_name}</>
                            : <>代领人: {a.proxy_info.proxy_name}</>}
                          {a.proxy_info.remark && <div className="text-stone-400 mt-0.5">{a.proxy_info.remark}</div>}
                        </div>
                      </span>
                    )}
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
