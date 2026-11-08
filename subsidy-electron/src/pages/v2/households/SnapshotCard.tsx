/** 历史快照卡片：按家庭户事件回放，可切换时点 */
import { useEffect, useMemo, useState } from 'react'
import * as api from '../../../api'
import { EVENT_TYPE_CFG } from '../../FarmerConstants'
import { FARMER_STATUS_LABEL } from '../shared'
import type { HHEvent, SnapshotAtResponse } from '../../../types'
export default function SnapshotCard({ householdId }: { householdId: number | null }) {
  const [events, setEvents] = useState<HHEvent[]>([])
  const [snapshot, setSnapshot] = useState<SnapshotAtResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setSnapshot(null)
    if (!householdId) { setEvents([]); return }
    let cancelled = false
    api.getHouseholdEvents(householdId)
      .then(ev => { if (!cancelled) setEvents(ev || []) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [householdId])

  const openSnapshot = async (eventId: number) => {
    if (!householdId) return
    setLoading(true)
    try { setSnapshot(await api.getHouseholdSnapshotByEvent(householdId, eventId)) }
    catch { setSnapshot(null) }
    finally { setLoading(false) }
  }

  const steps = useMemo(
    () => [...events].filter(e => e.event_date).sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1)),
    [events]
  )
  const idx = snapshot ? steps.findIndex(e => e.event_date === snapshot.target_date) : -1
  const stepTo = (i: number) => { const ev = steps[i]; if (ev) openSnapshot(ev.id) }

  return (
    <div className="border border-[#E6E0D4] rounded-card px-2.5 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11.5px] font-semibold">历史快照</span>
        <span className="text-[10px] text-[#7A7466]">{events.length} 条</span>
      </div>
      {events.length === 0 && <div className="py-4 text-center text-[10.5px] text-text-muted/60">暂无变更记录</div>}
      <div className="flex flex-col overflow-y-auto" style={{ maxHeight: 180 }}>
        {events.map(ev => {
          const active = snapshot?.target_date && ev.event_date === snapshot.target_date
          const cfg = EVENT_TYPE_CFG[ev.event_type] || EVENT_TYPE_CFG.REMARK
          return (
            <div key={ev.id} onClick={() => openSnapshot(ev.id)}
              className={`cursor-pointer border-b border-[#E6E0D4] py-1.5 px-1 rounded-[3px] transition-colors ${active ? 'bg-[#F2F7F4]' : 'hover:bg-[#F2F7F4]'}`}>
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] rounded-[2px] px-1 ${cfg.color}`}>{cfg.label}</span>
                <span className="text-[10px] text-[#7A7466] font-mono">{ev.event_date || `${ev.event_year} 年`}</span>
                <span className="ml-auto text-[9.5px] text-primary">快照 →</span>
              </div>
              <div className="text-[10.5px] mt-0.5 truncate" title={ev.description}>{ev.description || '（无说明）'}</div>
            </div>
          )
        })}
      </div>
      {loading && <div className="py-1 text-[10px] text-text-muted">快照加载中…</div>}
      {snapshot && snapshot.snapshot && (
        <div className="mt-1.5 pt-1.5 border-t border-[#E6E0D4] text-[10.5px]">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-[#2F5C46]">{snapshot.target_date} 快照</span>
            <button onClick={() => setSnapshot(null)} className="text-[10px] text-text-muted hover:text-primary">退出</button>
          </div>
          <div className="flex justify-between"><span className="text-[#7A7466]">参考面积</span><span className="font-mono">{Number(snapshot.snapshot.contract_area || 0).toFixed(2)} 亩</span></div>
          <div className="flex justify-between"><span className="text-[#7A7466]">成员</span><span>{snapshot.snapshot.members?.length ?? 0} 人</span></div>
          <div className="flex justify-between"><span className="text-[#7A7466]">补贴记录</span><span>{snapshot.snapshot.app_summary?.length ?? 0} 条</span></div>
          {(snapshot.snapshot.members || []).slice(0, 4).map(m => (
            <div key={m.id} className="flex justify-between text-[10px] pl-2">
              <span className="truncate">{m.real_name}{m.is_head === 1 ? '（户主）' : ''}</span>
              <span className="text-text-muted">{FARMER_STATUS_LABEL[m.farmer_status] || '—'}</span>
            </div>
          ))}
        </div>
      )}
      {steps.length > 1 && (
        <div className="flex items-center gap-1.5 pt-1.5 mt-1.5 border-t border-[#E6E0D4]">
          <button onClick={() => stepTo(idx - 1)} disabled={idx <= 0}
            className="h-6 px-1.5 border border-border rounded-[3px] bg-white text-[10px] text-[#5C5749] disabled:opacity-40">‹ 上一时点</button>
          <button onClick={() => stepTo(idx + 1)} disabled={idx < 0 || idx >= steps.length - 1}
            className="h-6 px-1.5 border border-border rounded-[3px] bg-white text-[10px] text-[#5C5749] disabled:opacity-40">下一时点 ›</button>
          <span className="ml-auto text-[9.5px] text-[#7A7466]">{idx >= 0 ? `${idx + 1} / ${steps.length}` : '—'}</span>
        </div>
      )}
    </div>
  )
}

/** 大户详情面板 */
