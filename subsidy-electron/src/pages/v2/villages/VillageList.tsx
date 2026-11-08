/**
 * 村组列表（左栏）
 *
 * 村组数量少，不分页。
 */
import { Chip, ListRow } from '../shared'
import RegistryTabs from '../RegistryTabs'
import type { TabItem } from '../RegistryTabs'

interface Props {
  tabs: TabItem[]
  sideTab: 'farmers' | 'households' | 'large' | 'villages'
  setSideTab: (t: any) => void

  list: any[]
  selectedId: number | null
  setSelectedId: (id: number) => void
}

export default function VillageList(p: Props) {
  return (
    <>
      <RegistryTabs tabs={p.tabs} active={p.sideTab} onChange={p.setSideTab} />

      <div className="flex-1 overflow-y-auto min-h-0 pt-1">
        {p.list.length === 0 && (
          <div className="py-10 text-center text-[11px] text-[#A8A091]">暂无村组</div>
        )}
        {p.list.map(v => (
          <ListRow key={v.id} active={p.selectedId === v.id} onClick={() => p.setSelectedId(v.id)}
            avatar={v.village_name?.slice(0, 1) || '村'} avatarSquare name={v.village_name}
            tags={<Chip tone="gray">村集体</Chip>}
            sub={<>{v.leader_name ? `负责人 ${v.leader_name}` : '非在册负责人'}{v.leader_phone ? ` · ${v.leader_phone}` : ''}</>} />
        ))}
      </div>

      <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-[#E6E0D4] text-[10px] text-[#7A7466] shrink-0">
        <span>共 {p.list.length} 个村</span>
        <span className="text-[9.5px]">村组不分页</span>
      </div>
    </>
  )
}
