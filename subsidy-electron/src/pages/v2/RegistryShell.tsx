/**
 * 主体管理 · 通用外壳
 *
 * 只负责骨架：页面标题、四个分类 Tab、搜索栏、左侧列表容器、右侧详情容器。
 * 各主体（农户/家庭户/大户/村组）通过 props 注入列表行渲染与详情面板，
 * 状态（搜索词、筛选、分页）由外壳持有并通过回调下发给页面。
 */
import type { ReactNode } from 'react'

export type SideTab = 'farmers' | 'households' | 'large' | 'villages'

export interface TabDef {
  id: SideTab
  label: string
  icon: 'person' | 'household' | 'farmers' | 'village'
  count?: number | null
}

interface Props {
  /** 页面标题区右侧按钮 */
  headerActions?: ReactNode
  /** 顶部四个分类 Tab */
  tabs: TabDef[]
  activeTab: SideTab
  onTabChange: (tab: SideTab) => void
  /** 搜索框占位符与当前值 */
  searchPlaceholder: string
  searchValue: string
  onSearchChange: (v: string) => void
  /** 筛选下拉（村、状态等），由各主体自行提供 */
  filters?: ReactNode
  /** 列表区 */
  listHeader?: ReactNode
  listBody: ReactNode
  /** 分页 */
  totalLabel: string
  page?: number
  totalPages?: number
  onPageChange?: (p: number) => void
  /** 右侧详情 */
  detail: ReactNode
  loading?: boolean
}

export default function RegistryShell({
  headerActions, tabs, activeTab, onTabChange,
  searchPlaceholder, searchValue, onSearchChange, filters,
  listHeader, listBody, totalLabel, page, totalPages, onPageChange,
  detail,
}: Props) {
  return (
    <div className="grid grid-cols-[338px_minmax(0,1fr)] gap-3 items-start">

      {/* ── 左列：分类 + 搜索 + 列表 ── */}
      <div className="bg-white border border-[#E6E0D4] rounded-card flex flex-col overflow-hidden shadow-card sticky top-[88px]"
        style={{ maxHeight: 'calc(100vh - 104px)' }}>

        {/* 分类 Tab */}
        <div className="flex items-center gap-3.5 px-3 h-[34px] border-b border-[#E6E0D4]">
          {tabs.map(t => (
            <button key={t.id} onClick={() => onTabChange(t.id)}
              className={`h-[34px] flex items-center gap-1.5 border-b-2 text-[12px] transition-colors
                ${activeTab === t.id
                  ? 'border-[#2F5C46] text-[#234A38] font-bold'
                  : 'border-transparent text-[#5C5749] hover:text-[#234A38]'}`}>
              <TabIcon name={t.icon} active={activeTab === t.id} />
              {t.label}
              {t.count != null && (
                <span className={`text-[10px] font-normal ${activeTab === t.id ? 'text-[#7A7466]' : 'text-[#A8A091]'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 搜索 + 筛选 */}
        <div className="px-2.5 py-2 border-b border-[#E6E0D4] flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 border border-[#D2CBBC] rounded-btn px-2 h-[30px] focus-within:border-[#2F5C46] transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7A7466" strokeWidth="1.8" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
            </svg>
            <input value={searchValue} onChange={e => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 text-[12px] outline-none bg-transparent" />
            {searchValue && (
              <button onClick={() => onSearchChange('')} aria-label="清空搜索"
                className="text-[#A8A091] hover:text-[#5C5749] text-[14px] leading-none">×</button>
            )}
          </div>
          {filters && <div className="flex gap-1.5">{filters}</div>}
        </div>

        {listHeader}

        {/* 列表体 */}
        <div className="flex-1 overflow-y-auto min-h-0">{listBody}</div>

        {/* 分页 */}
        <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-[#E6E0D4] text-[10px] text-[#7A7466] shrink-0">
          <span>{totalLabel}</span>
          {onPageChange && totalPages != null && totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button disabled={(page ?? 1) <= 1} onClick={() => onPageChange((page ?? 1) - 1)}
                className="h-[22px] px-1.5 border border-[#D2CBBC] rounded-[3px] bg-white disabled:opacity-40 hover:bg-[#F2F7F4] transition-colors">上一页</button>
              <span className="bg-[#2F5C46] text-white rounded-[3px] px-1.5">{page}</span>
              <span>/ {totalPages}</span>
              <button disabled={(page ?? 1) >= totalPages} onClick={() => onPageChange((page ?? 1) + 1)}
                className="h-[22px] px-1.5 border border-[#D2CBBC] rounded-[3px] bg-white disabled:opacity-40 hover:bg-[#F2F7F4] transition-colors">下一页</button>
            </div>
          ) : (
            <span className="text-[9.5px]">{totalPages != null ? '—' : '不分页'}</span>
          )}
        </div>
      </div>

      {/* ── 右列：详情 ── */}
      <div className="bg-white border border-[#E6E0D4] rounded-card flex flex-col overflow-hidden shadow-card min-w-0">
        {detail}
      </div>
    </div>
  )
}

/** Tab 小图标 */
function TabIcon({ name, active }: { name: TabDef['icon']; active: boolean }) {
  const stroke = active ? '#2F5C46' : '#7A7466'
  const paths: Record<string, ReactNode> = {
    person: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    household: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
    farmers: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    village: <><path d="M2 22V9l6-4 6 4v13" /><path d="M14 22V13l4-3 4 3v9" /><path d="M6 22v-4h4v4" /></>,
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
