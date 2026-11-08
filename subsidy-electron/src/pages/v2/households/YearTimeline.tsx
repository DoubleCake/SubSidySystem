/**
 * 家庭户年度时间轴
 *
 * 横向年份条：点选年份后整页联动（补贴记录过滤、成员按当年快照还原）。
 * 年份上的红点表示该年触发超领。
 */
import { useEffect, useState } from 'react'
import * as api from '../../../api'
import type { HHMember, HHEvent, SnapshotAtResponse } from '../../../types'

export interface YearInfo {
  year: number
  /** 该年是否触发超领 */
  over: boolean
  /** 该年补贴记录条数 */
  apps: number
  /** 该年成员人数 */
  members: number
  /** 该年是否有变更事件 */
  hasEvent: boolean
}

interface Props {
  years: YearInfo[]
  value: number
  onChange: (year: number) => void
  /** 历史年份只读提示 */
  isCurrent: boolean
}

export default function YearTimeline({ years, value, onChange, isCurrent }: Props) {
  if (years.length === 0) return null
  const cur = years.find(y => y.year === value)

  return (
    <div className="border-b border-[#E6E0D4] bg-gradient-to-r from-[#F2F7F4] to-white px-3 py-1.5 flex items-center gap-2">
      <span className="text-[10px] text-[#7A7466] shrink-0">年度</span>
      <div className="flex items-center gap-1 overflow-x-auto">
        {years.map(y => {
          const active = value === y.year
          return (
            <button key={y.year} onClick={() => onChange(y.year)}
              className={`relative h-[24px] px-2.5 rounded-full text-[11px] transition-all shrink-0 inline-flex items-center gap-1
                ${active
                  ? 'bg-[#2F5C46] text-white font-bold shadow-[0_1px_4px_rgba(26,58,44,.32)]'
                  : 'bg-white border border-[#E6E0D4] text-[#5C5749] hover:border-[#2F5C46] hover:text-[#234A38]'}`}>
              {y.year}
              {y.over && <span className={`w-[5px] h-[5px] rounded-full ${active ? 'bg-[#FFD5D0]' : 'bg-danger'}`} />}
            </button>
          )
        })}
      </div>
      {cur && (
        <div className="ml-auto flex items-center gap-2.5 shrink-0">
          {cur.over && <span className="text-[9px] bg-danger text-white font-semibold rounded-full px-1.5 py-[1px]">超领</span>}
          <span className="text-[10px] text-[#7A7466]">
            成员 <b className="text-[#5C5749]">{cur.members}</b> 人 · 补贴 <b className="text-[#5C5749]">{cur.apps}</b> 条
          </span>
          {!isCurrent && (
            <span className="text-[9px] text-[#8A6118] bg-[#FBF3E2] border border-[#F2E0B8] rounded-[3px] px-1.5 py-[1px]">
              历史视图 · 只读
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** 从详情数据推导年度列表 */
export function buildYears(
  apps: { apply_year: number; actual_amount: number | null; apply_amount: number | null }[],
  usage: { year_totals?: Record<string, Record<string, number>> } | undefined,
  refArea: number,
  currentMembers: HHMember[],
  currentYear: number,
  snapshotMembers?: Map<number, number>,
): YearInfo[] {
  const years = new Set<number>()
  apps.forEach(a => { if (a.apply_year) years.add(Number(a.apply_year)) })
  Object.keys(usage?.year_totals || {}).forEach(y => years.add(Number(y)))
  years.add(currentYear)

  return [...years].sort((a, b) => b - a).map(year => {
    const seasons = usage?.year_totals?.[String(year)] || {}
    const vals = Object.values(seasons)
    const maxUsed = vals.length ? Math.max(...vals) : 0
    return {
      year,
      over: refArea > 0 && maxUsed > refArea + 0.001,
      apps: apps.filter(a => Number(a.apply_year) === year).length,
      members: snapshotMembers?.get(year) ?? currentMembers.length,
      hasEvent: snapshotMembers?.has(year) ?? false,
    }
  })
}

/**
 * 按年份加载快照成员数（每年最后一个事件的状态）
 * 返回 Map<year, 成员数>
 */
export function useYearSnapshots(householdId: number | null, years: number[]) {
  const [map, setMap] = useState<Map<number, number>>(new Map())

  useEffect(() => {
    if (!householdId || years.length === 0) { setMap(new Map()); return }
    let cancelled = false
    api.getHouseholdEvents(householdId).then(async (events: HHEvent[]) => {
      const result = new Map<number, number>()
      const valid = (events || []).filter(e => e.event_date)
      // 每年取最后一个事件
      for (const y of years) {
        const inYear = valid.filter(e => e.event_date!.slice(0, 4) === String(y))
        if (inYear.length === 0) continue
        const last = inYear.sort((a, b) => (a.event_date! < b.event_date! ? 1 : -1))[0]
        try {
          const snap: SnapshotAtResponse = await api.getHouseholdSnapshotByEvent(householdId, last.id)
          if (snap?.snapshot?.members) result.set(y, snap.snapshot.members.length)
        } catch { /* 忽略单年失败 */ }
      }
      if (!cancelled) setMap(result)
    }).catch(() => { if (!cancelled) setMap(new Map()) })
    return () => { cancelled = true }
  }, [householdId, years.join(',')])

  return map
}
