import { NavLink } from 'react-router-dom'

interface SidebarItem {
  type: 'link' | 'group' | 'divider'
  label?: string
  to?: string
}

const sidebarItems: SidebarItem[] = [
  { type: 'group', label: '⚙ 系统管理' },
  { type: 'link', label: '👤 用户管理', to: '/settings/users' },
  { type: 'link', label: '🏘 村组管理', to: '/settings/village-groups' },
  { type: 'link', label: '📋 Excel模板', to: '/settings/excel-templates' },
  { type: 'link', label: '💾 备份迁移', to: '/settings/backup' },
  { type: 'link', label: '🔄 软件更新', to: '/settings/update' },
  { type: 'divider' },
  { type: 'group', label: '🔗 其他功能' },
]

export default function SidebarNav() {
  return (
    <nav className="w-44 shrink-0 hidden lg:block">
      <div className="sticky top-20 space-y-0.5">
        {sidebarItems.map((item, i) => {
          if (item.type === 'divider') {
            return <hr key={i} className="border-border/50 my-2" />
          }
          if (item.type === 'group') {
            return (
              <div key={i} className="px-3 pt-3 pb-1 text-[11px] text-text-muted/60 font-semibold tracking-wider">
                {item.label}
              </div>
            )
          }
          if (item.type === 'link' && item.to) {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/tools'}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 text-sm rounded-btn transition-colors
                  ${isActive
                    ? 'bg-primary-500/10 text-primary font-medium border-l-2 border-primary rounded-none'
                    : 'text-text-muted hover:text-text-primary hover:bg-warm/30'}`
                }
              >
                <span>{item.label}</span>
              </NavLink>
            )
          }
          return null
        })}
      </div>
    </nav>
  )
}
