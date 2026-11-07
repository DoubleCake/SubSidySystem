/**
 * 户籍管理页 - 农户列表组件
 *
 * 画布样式：首行「姓名 + 关系/状态标签」，次行「村组 · 编码 · 面积」，
 * 选中行左侧 3px 深绿标识线 + 浅绿底。
 */
import { FARMER_STATUS } from '../utils'
import type { FarmerOut } from '../types'

export interface FarmerListProps {
  farmers: FarmerOut[]
  loading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
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

const STATUS_TONE: Record<number, string> = {
  1: 'bg-[#EDF3EF] text-[#2C6B52]',
  2: 'bg-[#F1EDE4] text-[#6B6B60]',
  3: 'bg-[#F6EEDC] text-[#8A6620]',
  4: 'bg-[#F1EDE4] text-[#8C877A]',
}

export default function FarmerList({ farmers, loading, selectedId, onSelect }: FarmerListProps) {
  return (
    <>
      {loading && <div className="text-center py-12 text-text-muted/60 text-xs">加载中…</div>}
      {!loading && farmers.length === 0 && <div className="text-center py-12 text-text-muted/60 text-xs">暂无数据</div>}
      {farmers.map(f => {
        const selected = selectedId === f.id
        const st = FARMER_STATUS[f.farmer_status]
        return (
          <div key={f.id}
            onClick={() => onSelect(f.id)}
            className={`cursor-pointer border-b border-[#F2EDE3] transition-colors
              ${selected ? 'bg-[#F3F7F4] border-l-[3px] border-l-primary pl-[13px] pr-2.5' : 'pl-4 pr-2.5 hover:bg-[#F7FAF8]'}`}
            style={{ paddingTop: 9, paddingBottom: 9 }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${tone(f.real_name)}`}>
                  {f.real_name?.slice(-1) || '—'}
                </span>
                <b className="text-[12.5px] text-text-primary truncate">{f.real_name}</b>
                {f.is_head === 1 && (
                  <span className="text-[9px] bg-[#EDF3EF] text-[#2C6B52] rounded-[2px] px-1 shrink-0">户主</span>
                )}
                <span className={`text-[9px] rounded-[2px] px-1 shrink-0 ${STATUS_TONE[f.farmer_status] || 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                  {st?.label ?? '未知'}
                </span>
              </div>
            </div>
            <div className="text-[10px] text-[#8C877A] mt-[3px] pl-[32px] truncate">
              {f.village_full_name || '—'}
              <span className="mx-1">·</span>
              <span className="font-mono">{f.id_card_masked}</span>
            </div>
          </div>
        )
      })}
    </>
  )
}
