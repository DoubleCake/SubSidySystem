/**
 * 家庭户列表（左栏）
 *
 * 自包含：Tab、搜索、筛选、列表行、分页。
 * 筛选区已预留给后续扩展（异常状态、超领年份、成员数区间等）。
 */
import { Chip, ListRow, HH_STATUS_LABEL } from '../shared'
import RegistryTabs from '../RegistryTabs'
import { SearchIcon, Empty, Pager } from '../farmers/FarmerList'
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
  village: string
  setVillage: (v: string) => void
  status: string
  setStatus: (v: string) => void
  villages: string[]

  /** 预留：异常筛选（后续接入） */
  anomaly?: string
  setAnomaly?: (v: string) => void
}

export default function HouseholdList(p: Props) {
  return (
    <>
      <RegistryTabs tabs={p.tabs} active={p.sideTab} onChange={p.setSideTab} />

      <div className="px-2.5 pt-2">
        <div className="flex items-center gap-1.5 border border-[#D2CBBC] rounded-btn px-2 h-[30px] focus-within:border-[#2F5C46]">
          <SearchIcon />
          <input value={p.search} onChange={e => p.setSearch(e.target.value)}
            placeholder="户名 / 户编码 / 户主"
            className="flex-1 text-[12px] outline-none bg-transparent" />
          {p.search && (
            <button onClick={() => p.setSearch('')} aria-label="清空"
              className="text-[#A8A091] hover:text-[#5C5749] text-[14px] leading-none">×</button>
          )}
        </div>
      </div>

      {/* 筛选：村 / 状态 /（待扩展：异常） */}
      <div className="px-2.5 py-2 border-b border-[#E6E0D4] flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <select value={p.village} onChange={e => { p.setVillage(e.target.value); p.setPage(1) }}
            className="flex-1 h-7 border border-[#D2CBBC] rounded-btn px-1.5 text-[11px] text-[#5C5749] bg-white outline-none">
            <option value="">全部村</option>
            {p.villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={p.status} onChange={e => { p.setStatus(e.target.value); p.setPage(1) }}
            className="flex-1 h-7 border border-[#D2CBBC] rounded-btn px-1.5 text-[11px] text-[#5C5749] bg-white outline-none">
            <option value="">全部状态</option>
            <option value="1">在册</option>
            <option value="2">注销</option>
            <option value="3">迁出</option>
          </select>
        </div>
        {/* 异常筛选占位：接入后在此渲染 */}
        {p.setAnomaly && (
          <select value={p.anomaly || ''} onChange={e => { p.setAnomaly!(e.target.value); p.setPage(1) }}
            className="h-7 border border-[#D2CBBC] rounded-btn px-1.5 text-[11px] text-[#5C5749] bg-white outline-none">
            <option value="">全部记录</option>
            <option value="over">仅超领</option>
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {p.loading && <Empty text="加载中…" />}
        {!p.loading && p.list.length === 0 && <Empty text="暂无数据" />}
        {!p.loading && p.list.map(h => (
          <ListRow key={h.id} active={p.selectedId === h.id} onClick={() => p.setSelectedId(h.id)}
            avatar={h.household_name?.slice(0, 1) || '户'} avatarSquare name={h.household_name}
            tags={<Chip tone={h.status === 1 ? 'green' : 'amber'}>{HH_STATUS_LABEL[h.status] || '未知'}</Chip>}
            right={(h.overdrawn_years?.length ?? 0) > 0
              ? <span className="text-[9px] bg-[#FCEAE8] text-[#A81D1D] rounded-[2px] px-1 shrink-0">{h.overdrawn_years!.slice(0, 2).join('、')}超领</span>
              : h.is_overdrawn ? <span className="text-[9px] bg-[#FCEAE8] text-[#A81D1D] rounded-[2px] px-1 shrink-0">超领</span> : null}
            sub={<>{h.village_full_name || '—'} · <span className="font-mono">{h.household_code}</span> · {h.member_count ?? '?'} 人{h.contracted_area > 0 ? ` · ${h.contracted_area} 亩` : ''}</>} />
        ))}
      </div>

      <Pager label={`共 ${p.total} 户`} page={p.page} totalPages={p.totalPages} setPage={p.setPage} />
    </>
  )
}
