/**
 * 主体管理 · 通用外壳
 *
 * 只负责最外层骨架：左右两栏的宽度与排列、右栏详情容器。
 * 左栏（Tab + 搜索 + 筛选 + 列表 + 分页）完全由各主体自己的 List 组件提供，
 * 外壳不感知任何列表内部结构，便于各主体独立演进。
 */
import type { ReactNode } from 'react'

export type SideTab = 'farmers' | 'households' | 'large' | 'villages'

interface Props {
  /** 左栏：各主体自行渲染（含 Tab、搜索、筛选、列表、分页） */
  sidebar: ReactNode
  /** 右栏：各主体详情面板 */
  detail: ReactNode
}

export default function RegistryShell({ sidebar, detail }: Props) {
  return (
    <div className="grid grid-cols-[338px_minmax(0,1fr)] gap-3 items-start">
      <div className="bg-white border border-[#E6E0D4] rounded-card flex flex-col overflow-hidden shadow-card sticky top-[88px] min-w-0"
        style={{ maxHeight: 'calc(100vh - 104px)' }}>
        {sidebar}
      </div>
      <div className="bg-white border border-[#E6E0D4] rounded-card flex flex-col overflow-hidden shadow-card min-w-0">
        {detail}
      </div>
    </div>
  )
}

/** Tab 小图标（各 List 组件共用） */
export function TabIcon({ name, active }: { name: SideTab; active: boolean }) {
  const stroke = active ? '#2F5C46' : '#7A7466'
  const paths: Record<SideTab, ReactNode> = {
    farmers: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    households: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
    large: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    villages: <><path d="M2 22V9l6-4 6 4v13" /><path d="M14 22V13l4-3 4 3v9" /><path d="M6 22v-4h4v4" /></>,
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
