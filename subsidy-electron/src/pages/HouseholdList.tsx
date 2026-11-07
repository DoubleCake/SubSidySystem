/**
 * 户籍管理页 - 家庭户列表组件
 *
 * 画布样式：首行「户名 + 状态/超领标签」，次行「村组 · 编码 · 人数 · 面积」。
 * 合并模式与批量确认模式沿用同一行骨架，只切换左侧选择控件。
 */
import type { HH } from '../types'

export interface HouseholdListProps {
  households: HH[]
  loading: boolean
  selectedId: number | null
  mergeMode: boolean
  batchConfirmMode: boolean
  mergeSelected: number[]
  batchSelected: number[]
  mergeSelectedHouseholds: HH[]
  onSelect: (id: number) => void
  onToggleMerge: (h: HH) => void
  onToggleBatch: (h: HH) => void
}

const AVATAR_TONES = [
  'bg-[#1A4D3A] text-[#E6C288]',
  'bg-[#F6EEDC] text-[#8A6620]',
  'bg-[#EDF3EF] text-[#1A4D3A]',
  'bg-[#E3EEF2] text-[#2E6478]',
  'bg-[#F1EDE4] text-[#5A5A4F]',
]

function tone(name: string) {
  const code = name.charCodeAt(0) || 0
  return AVATAR_TONES[code % AVATAR_TONES.length]
}

export default function HouseholdList({
  households,
  loading,
  selectedId,
  mergeMode,
  batchConfirmMode,
  mergeSelected,
  batchSelected,
  mergeSelectedHouseholds,
  onSelect,
  onToggleMerge,
  onToggleBatch,
}: HouseholdListProps) {
  const rowBody = (h: HH) => (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-6 h-6 rounded-card flex items-center justify-center text-[10px] font-bold shrink-0 ${tone(h.household_name)}`}>
            {h.household_name?.slice(0, 1) || '—'}
          </span>
          <b className="text-[12.5px] text-text-primary truncate">{h.household_name}</b>
          {h.is_manually_confirmed === 1 && (
            <span className="text-[9px] bg-[#EDF3EF] text-[#2C6B52] rounded-[2px] px-1 shrink-0">已确认</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(h.overdrawn_years?.length ?? 0) > 0
            ? h.overdrawn_years!.slice(0, 2).map(y => (
                <span key={y} className="text-[9px] bg-[#FDECEA] text-danger rounded-[2px] px-1">{y}超领</span>
              ))
            : h.is_overdrawn && <span className="text-[9px] bg-[#FDECEA] text-danger rounded-[2px] px-1">超领</span>}
        </div>
      </div>
      <div className="text-[10px] text-[#8C877A] mt-[3px] pl-[32px] truncate">
        {h.village_full_name || '—'}
        <span className="mx-1">·</span>
        <span className="font-mono">{h.household_code}</span>
        <span className="mx-1">·</span>
        {h.member_count ?? '?'} 人
        {h.contracted_area > 0 && <><span className="mx-1">·</span>{h.contracted_area} 亩</>}
      </div>
    </>
  )

  const rowClass = (active: boolean, extra = '') =>
    `cursor-pointer border-b border-[#F2EDE3] transition-colors ${extra} ${
      active ? 'bg-[#F3F7F4] border-l-[3px] border-l-primary pl-[13px] pr-2.5' : 'pl-4 pr-2.5 hover:bg-[#F7FAF8]'
    }`

  return (
    <>
      {/* 合并模式：已选家庭户固定置顶 */}
      {mergeMode && mergeSelectedHouseholds.length > 0 && (
        <div className="bg-[#FDFAF3] border-b border-[#E8D8B8]">
          <div className="px-3 py-1 text-[9.5px] text-[#8A6620] font-semibold flex items-center gap-1">
            <span>已选（搜索不影响）</span>
            <span className="bg-[#F6EEDC] rounded-full px-1.5">{mergeSelectedHouseholds.length}</span>
          </div>
          {mergeSelectedHouseholds.map((h, i) => (
            <div key={`pinned-${h.id}`} className="px-3 py-2 border-t border-[#F0E6D2] flex items-center gap-2">
              <span className={`text-[9px] font-bold px-1 py-[1px] rounded-[2px] shrink-0 ${i === 0 ? 'bg-primary text-[#F7F3E7]' : 'bg-[#F6EEDC] text-[#8A6620]'}`}>
                {i === 0 ? '目标' : `被合并${i}`}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[11.5px] font-semibold truncate">{h.household_name}</div>
                <div className="text-[9.5px] text-text-muted truncate">{h.head_name} · {h.member_count ?? '?'} 人 · {h.village_full_name}</div>
              </div>
              <button onClick={() => onToggleMerge(h)}
                className="shrink-0 text-text-muted hover:text-danger text-base leading-none px-1">×</button>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="text-center py-12 text-text-muted/60 text-xs">加载中…</div>}
      {!loading && households.length === 0 && <div className="text-center py-12 text-text-muted/60 text-xs">暂无数据</div>}

      {households.map(h => {
        const isSelected = mergeSelected.includes(h.id)
        const isBatchSelected = batchSelected.includes(h.id)
        if (mergeMode && isSelected) return null

        if (batchConfirmMode) {
          const done = h.is_manually_confirmed === 1
          return (
            <div key={h.id}
              onClick={() => !done && onToggleBatch(h)}
              className={rowClass(isBatchSelected && !done, done ? 'opacity-60' : '')}>
              <div className="flex items-start gap-2">
                <input type="checkbox" checked={isBatchSelected} disabled={done}
                  onChange={() => !done && onToggleBatch(h)}
                  className="mt-1 w-3.5 h-3.5 accent-[#1A4D3A] shrink-0" />
                <div className="flex-1 min-w-0">{rowBody(h)}</div>
              </div>
            </div>
          )
        }

        if (mergeMode) {
          return (
            <div key={h.id} onClick={() => onToggleMerge(h)} className={rowClass(isSelected)}>
              <div className="flex items-start gap-2">
                <input type="checkbox" checked={isSelected} onChange={() => onToggleMerge(h)}
                  className="mt-1 w-3.5 h-3.5 accent-[#1A4D3A] shrink-0" />
                <div className="flex-1 min-w-0">{rowBody(h)}</div>
              </div>
            </div>
          )
        }

        return (
          <div key={h.id} onClick={() => onSelect(h.id)} className={rowClass(selectedId === h.id)} style={{ paddingTop: 9, paddingBottom: 9 }}>
            {rowBody(h)}
          </div>
        )
      })}
    </>
  )
}
