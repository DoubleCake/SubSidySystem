/**
 * 大户列表（左栏）
 */
import { Chip, ListRow } from '../shared'
import RegistryTabs from '../RegistryTabs'
import { SearchIcon, Empty, Pager } from '../farmers/FarmerList'
import { OPERATOR_LABEL } from '../types'
import type { TabItem } from '../RegistryTabs'

interface Props {
  tabs: TabItem[]
  sideTab: 'farmers' | 'households' | 'large' | 'villages'
  setSideTab: (t: any) => void

  list: any[]
  total: number
  page: number
  totalPages: number
  loading: boolean
  selectedId: number | null
  setSelectedId: (id: number) => void
  setPage: (p: number | ((prev: number) => number)) => void

  search: string
  setSearch: (v: string) => void
}

export default function LargeList(p: Props) {
  return (
    <>
      <RegistryTabs tabs={p.tabs} active={p.sideTab} onChange={p.setSideTab} />

      <div className="px-2.5 py-2 border-b border-[#E6E0D4]">
        <div className="flex items-center gap-1.5 border border-[#D2CBBC] rounded-btn px-2 h-[30px] focus-within:border-[#2F5C46]">
          <SearchIcon />
          <input value={p.search} onChange={e => p.setSearch(e.target.value)}
            placeholder="经营人 / 联系电话"
            className="flex-1 text-[12px] outline-none bg-transparent" />
          {p.search && (
            <button onClick={() => p.setSearch('')} aria-label="清空"
              className="text-[#A8A091] hover:text-[#5C5749] text-[14px] leading-none">×</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {p.loading && <Empty text="加载中…" />}
        {!p.loading && p.list.length === 0 && <Empty text="暂无大户" />}
        {!p.loading && p.list.map(l => (
          <ListRow key={l.id} active={p.selectedId === l.id} onClick={() => p.setSelectedId(l.id)}
            avatar={l.operator_name?.slice(0, 1) || '大'} avatarSquare name={l.operator_name}
            tags={<Chip tone="amber">{OPERATOR_LABEL[l.operator_type] || l.operator_type_label}</Chip>}
            sub={<>{l.village_name || '—'}{l.group_no ? ` ${l.group_no} 组` : ''} · 经营 {Number(l.total_managed_area || 0).toFixed(2)} 亩</>} />
        ))}
      </div>

      <Pager label={`共 ${p.total} 户大户`} page={p.page} totalPages={p.totalPages} setPage={p.setPage} />
    </>
  )
}
