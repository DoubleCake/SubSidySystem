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
      {loading && <div className="text-center py-12 text-text-muted/50">加载中…</div>}
      {!loading && farmers.length === 0 && <div className="text-center py-12 text-text-muted/50 text-sm">暂无数据</div>}
      {farmers.map(f => (
        <div key={f.id}
          onClick={() => onSelect(f.id)}
          className={`px-5 py-4 border-b border-border/50 cursor-pointer transition-all hover:bg-warm/20
            ${selectedId === f.id ? 'bg-primary-500/5 border-l-4 border-l-primary-500 shadow-inner' : ''}`}>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="font-semibold text-base text-text-primary">{f.real_name}</span>
            {f.is_head === 1 && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">户主</span>}
            <Tag label={FARMER_STATUS[f.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[f.farmer_status]?.color as 'green'} />
          </div>
          <div className="flex items-center gap-4 text-xs text-text-muted">
            <span className="font-mono">{f.id_card_masked}</span>
            <span className="bg-warm/30 px-2 py-0.5 rounded">{GENDER(f.gender)}</span>
            <span className="ml-auto truncate max-w-[180px]">{f.village_full_name}</span>
          </div>
        </div>
      ))}
    </>
  )
}
