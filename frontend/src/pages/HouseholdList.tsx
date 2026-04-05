/**
 * 户籍管理页 - 家庭户列表组件
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
  return (
    <>
      {/* 合并模式：已选家庭户固定置顶显示 */}
      {mergeMode && mergeSelectedHouseholds.length > 0 && (
        <div className="border-b-2 border-amber-200 bg-amber-50/80">
          <div className="px-4 py-1.5 text-xs text-amber-600 font-semibold border-b border-amber-100 flex items-center gap-1">
            <span>已选（搜索不影响）</span>
            <span className="bg-amber-200 text-amber-800 rounded-full px-1.5 py-0.5 ml-1">{mergeSelectedHouseholds.length}</span>
          </div>
          {mergeSelectedHouseholds.map((h, i) => (
            <div key={`pinned-${h.id}`} className="px-4 py-2.5 border-b border-amber-100 flex items-center gap-2.5 bg-amber-50">
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${i === 0 ? 'bg-emerald-600 text-white' : 'bg-amber-200 text-amber-800'}`}>
                {i === 0 ? '目标' : `被合并${i}`}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-stone-800 truncate">{h.household_name}</div>
                <div className="text-xs text-stone-400">{h.head_name} · {h.member_count ?? '?'}人 · {h.village_full_name}</div>
              </div>
              <button onClick={() => onToggleMerge(h)}
                className="shrink-0 text-stone-400 hover:text-red-500 transition-colors text-lg leading-none px-1">×</button>
            </div>
          ))}
        </div>
      )}
      {loading && <div className="text-center py-12 text-stone-300">加载中…</div>}
      {!loading && households.length === 0 && <div className="text-center py-12 text-stone-300 text-sm">暂无数据</div>}
      {households.map(h => {
        const isSelected = mergeSelected.includes(h.id)
        const isBatchSelected = batchSelected.includes(h.id)
        if (mergeMode && isSelected) return null
        if (batchConfirmMode) {
          // 批量确认模式：显示复选框，已确认的显示为禁用状态
          return (
            <div key={h.id}
              className={`px-5 py-4 border-b border-stone-100 transition-all
                ${h.is_manually_confirmed === 1 ? 'bg-stone-50 opacity-60' : 'hover:bg-blue-50 cursor-pointer'}
                ${isBatchSelected && h.is_manually_confirmed !== 1 ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}>
              <div className="flex items-center gap-3">
                <input type="checkbox"
                  checked={isBatchSelected}
                  onChange={() => h.is_manually_confirmed !== 1 && onToggleBatch(h)}
                  disabled={h.is_manually_confirmed === 1}
                  className="w-4 h-4 text-blue-600 rounded disabled:opacity-40" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="font-semibold text-base text-stone-800">{h.household_name}</span>
                    <span className="text-xs font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">{h.household_code}</span>
                    {h.is_manually_confirmed === 1 && <span className="text-xs text-emerald-700 font-medium bg-emerald-100 px-2 py-0.5 rounded-full">✓已确认</span>}
                    {h.is_overdrawn && <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded-full">⚠️超领</span>}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-stone-400">
                    <span>{h.head_name ? `户主:${h.head_name}` : '无户主'}</span>
                    <span className="bg-stone-100 px-2 py-0.5 rounded">{h.member_count}人</span>
                    <span>{h.contracted_area > 0 ? `${h.contracted_area}亩` : '—'}</span>
                    <span className="ml-auto truncate max-w-[180px]">{h.village_full_name}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        }
        if (mergeMode) {
          return (
            <div key={h.id}
              onClick={() => onToggleMerge(h)}
              className={`px-5 py-4 border-b border-stone-100 cursor-pointer transition-all
                ${isSelected ? 'border-l-4 border-l-amber-500 bg-amber-50' : 'hover:bg-stone-50'}
                ${h.is_overdrawn && !isSelected ? 'bg-red-50/40' : ''}`}>
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={isSelected} onChange={() => onToggleMerge(h)}
                  className="w-4 h-4 text-amber-600 rounded" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="font-semibold text-base text-stone-800">{h.household_name}</span>
                    <span className="text-xs font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">{h.household_code}</span>
                    {h.is_manually_confirmed === 1 && <span className="text-xs text-emerald-700 font-medium bg-emerald-100 px-2 py-0.5 rounded-full">✓已确认</span>}
                    {h.is_overdrawn && <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded-full">⚠️超领</span>}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-stone-400">
                    <span>{h.head_name ? `户主:${h.head_name}` : '无户主'}</span>
                    <span className="bg-stone-100 px-2 py-0.5 rounded">{h.member_count}人</span>
                    <span>{h.contracted_area > 0 ? `${h.contracted_area}亩` : '—'}</span>
                    <span className="ml-auto truncate max-w-[180px]">{h.village_full_name}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        }
        return (
          <div key={h.id}
            onClick={() => onSelect(h.id)}
            className={`px-5 py-4 border-b border-stone-100 cursor-pointer transition-all hover:bg-stone-50
              ${selectedId === h.id ? 'bg-emerald-50 border-l-4 border-l-emerald-600 shadow-inner' : ''}
              ${h.is_overdrawn ? 'bg-red-50/40' : ''}`}>
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="font-semibold text-base text-stone-800">{h.household_name}</span>
              <span className="text-xs font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">{h.household_code}</span>
              {h.is_manually_confirmed === 1 && <span className="text-xs text-emerald-700 font-medium bg-emerald-100 px-2 py-0.5 rounded-full">✓已确认</span>}
              {h.is_overdrawn && <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded-full">⚠️超领</span>}
            </div>
            <div className="flex items-center gap-4 text-xs text-stone-400">
              <span>{h.head_name ? `户主:${h.head_name}` : '无户主'}</span>
              <span className="bg-stone-100 px-2 py-0.5 rounded">{h.member_count}人</span>
              <span>{h.contracted_area > 0 ? `${h.contracted_area}亩` : '—'}</span>
              <span className="ml-auto truncate max-w-[180px]">{h.village_full_name}</span>
            </div>
          </div>
        )
      })}
    </>
  )
}
