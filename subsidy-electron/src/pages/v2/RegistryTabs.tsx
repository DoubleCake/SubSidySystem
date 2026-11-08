/**
 * 主体分类 Tab 栏（四个 List 共用）
 */
import { TabIcon, type SideTab } from './RegistryShell'

export interface TabItem {
  id: SideTab
  label: string
  icon: SideTab
  count?: number | null
}

export default function RegistryTabs({ tabs, active, onChange }: {
  tabs: TabItem[]
  active: SideTab
  onChange: (t: SideTab) => void
}) {
  return (
    <div className="flex items-center gap-3.5 px-3 h-[34px] border-b border-[#E6E0D4] shrink-0">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`h-[34px] flex items-center gap-1.5 border-b-2 text-[12px] transition-colors
            ${active === t.id
              ? 'border-[#2F5C46] text-[#234A38] font-bold'
              : 'border-transparent text-[#5C5749] hover:text-[#234A38]'}`}>
          <TabIcon name={t.icon} active={active === t.id} />
          {t.label}
          {t.count != null && (
            <span className={`text-[10px] font-normal ${active === t.id ? 'text-[#7A7466]' : 'text-[#A8A091]'}`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
