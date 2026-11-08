/**
 * 农户列表（左栏）
 *
 * 自包含：Tab、搜索、筛选、列表行、分页、空态文案。
 * 后续可在此独立增加筛选条件，不影响其他主体。
 */
import { Chip, ListRow, FARMER_STATUS_LABEL } from '../shared'
import RegistryTabs from '../RegistryTabs'
import type { SideTab } from '../RegistryShell'

interface Props {
  tabs: { id: SideTab; label: string; icon: SideTab; count?: number | null }[]
  sideTab: SideTab
  setSideTab: (t: SideTab) => void

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
}

export default function FarmerList(p: Props) {
  return (
    <>
      <RegistryTabs tabs={p.tabs} active={p.sideTab} onChange={p.setSideTab} />

      {/* 搜索 */}
      <div className="px-2.5 pt-2">
        <div className="flex items-center gap-1.5 border border-[#D2CBBC] rounded-btn px-2 h-[30px] focus-within:border-[#2F5C46]">
          <SearchIcon />
          <input value={p.search} onChange={e => p.setSearch(e.target.value)}
            placeholder="姓名 / 身份证 / 手机号"
            className="flex-1 text-[12px] outline-none bg-transparent" />
          {p.search && (
            <button onClick={() => p.setSearch('')} aria-label="清空"
              className="text-[#A8A091] hover:text-[#5C5749] text-[14px] leading-none">×</button>
          )}
        </div>
      </div>

      {/* 筛选 */}
      <div className="px-2.5 py-2 border-b border-[#E6E0D4] flex gap-1.5">
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
          <option value="4">死亡</option>
        </select>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {p.loading && <Empty text="加载中…" />}
        {!p.loading && p.list.length === 0 && <Empty text="暂无数据" />}
        {!p.loading && p.list.map(f => (
          <ListRow key={f.id} active={p.selectedId === f.id} onClick={() => p.setSelectedId(f.id)}
            avatar={f.real_name?.slice(-1) || '—'} name={f.real_name} strike={f.farmer_status !== 1}
            tags={
              <>
                <Chip tone={f.is_head === 1 ? 'green' : 'gray'}>{f.is_head === 1 ? '户主' : (f.relation || '成员')}</Chip>
                <Chip tone={f.farmer_status === 1 ? 'green' : f.farmer_status === 3 ? 'amber' : 'gray'}>
                  {FARMER_STATUS_LABEL[f.farmer_status] || '未知'}
                </Chip>
              </>
            }
            sub={<>{f.village_full_name || '—'}{f.contract_area ? ` · ${f.contract_area} 亩` : ''} · <span className="font-mono">{f.id_card_masked}</span></>} />
        ))}
      </div>

      <Pager label={`共 ${p.total} 人`} page={p.page} totalPages={p.totalPages} setPage={p.setPage} />
    </>
  )
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7A7466" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
    </svg>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="py-10 text-center text-[11px] text-[#A8A091]">{text}</div>
}

function Pager({ label, page, totalPages, setPage }: {
  label: string; page: number; totalPages: number
  setPage: (p: number | ((prev: number) => number)) => void
}) {
  return (
    <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-[#E6E0D4] text-[10px] text-[#7A7466] shrink-0">
      <span>{label}</span>
      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage(prev => prev - 1)}
            className="h-[22px] px-1.5 border border-[#D2CBBC] rounded-[3px] bg-white disabled:opacity-40 hover:bg-[#F2F7F4]">上一页</button>
          <span className="bg-[#2F5C46] text-white rounded-[3px] px-1.5">{page}</span>
          <span>/ {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(prev => prev + 1)}
            className="h-[22px] px-1.5 border border-[#D2CBBC] rounded-[3px] bg-white disabled:opacity-40 hover:bg-[#F2F7F4]">下一页</button>
        </div>
      ) : <span className="text-[9.5px]">—</span>}
    </div>
  )
}

export { SearchIcon, Empty, Pager }
