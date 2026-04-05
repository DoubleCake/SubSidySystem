/**
 * 户籍管理页 - 农户列表组件
 */
import Tag from '../components/Tag'
import { FARMER_STATUS } from '../utils'
import { GENDER } from './FarmerConstants'
import type { FarmerOut } from '../types'

export interface FarmerListProps {
  farmers: FarmerOut[]
  loading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
}

export default function FarmerList({ farmers, loading, selectedId, onSelect }: FarmerListProps) {
  return (
    <>
      {loading && <div className="text-center py-12 text-stone-300">加载中…</div>}
      {!loading && farmers.length === 0 && <div className="text-center py-12 text-stone-300 text-sm">暂无数据</div>}
      {farmers.map(f => (
        <div key={f.id}
          onClick={() => onSelect(f.id)}
          className={`px-5 py-4 border-b border-stone-100 cursor-pointer transition-all hover:bg-stone-50
            ${selectedId === f.id ? 'bg-emerald-50 border-l-4 border-l-emerald-600 shadow-inner' : ''}`}>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="font-semibold text-base text-stone-800">{f.real_name}</span>
            {f.is_head === 1 && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">户主</span>}
            <Tag label={FARMER_STATUS[f.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[f.farmer_status]?.color as 'green'} />
          </div>
          <div className="flex items-center gap-4 text-xs text-stone-400">
            <span className="font-mono">{f.id_card_masked}</span>
            <span className="bg-stone-100 px-2 py-0.5 rounded">{GENDER(f.gender)}</span>
            <span className="ml-auto truncate max-w-[180px]">{f.village_full_name}</span>
          </div>
        </div>
      ))}
    </>
  )
}
