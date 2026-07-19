import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

interface SidebarSection {
  id: string
  label: string
  items: { label: string; to: string; end?: boolean }[]
}

const sections: SidebarSection[] = [
  {
    id: 'farmers',
    label: '👥 户籍管理',
    items: [
      { label: '农户列表', to: '/farmers' },
      { label: '大户管理', to: '/large-farmers' },
      { label: '人员匹配', to: '/match-people' },
      { label: '户籍导入', to: '/settings/household-import' },
      { label: '家庭关系导入', to: '/settings/family-relation-import' },
    ],
  },
  {
    id: 'subsidies',
    label: '💰 补贴管理',
    items: [
      { label: '项目总览', to: '/projects' },
      { label: '项目进度', to: '/project-progress' },
      { label: '补贴查询', to: '/links' },
    ],
  },
  {
    id: 'land',
    label: '🏘 土地管理',
    items: [
      { label: '土地流转台账', to: '/land' },
    ],
  },
  {
    id: 'tools',
    label: '🛠 数据工具',
    items: [
      { label: '农业任务分解', to: '/agri-tasks' },
      { label: '身份信息验证', to: '/data-verify' },
      { label: 'Excel模板', to: '/settings/excel-templates' },
      { label: '数据备份', to: '/settings/backup' },
      { label: '操作流程', to: '/workflow' },
    ],
  },
]

const systemItems = [
  { label: '👤 用户管理', to: '/settings/users' },
  { label: '🏘 村组管理', to: '/settings/village-groups' },
  { label: '🔄 软件更新', to: '/settings/update' },
]

export default function SidebarNav() {
  const location = useLocation()
  // 默认全部展开
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleSection = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <nav className="w-44 shrink-0 hidden lg:block">
      <div className="sticky top-16 flex flex-col" style={{ maxHeight: 'calc(100vh - 64px)' }}>
        {/* 滚动区域：业务导航分组 */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-4">
          {sections.map(section => {
            const isOpen = !collapsed[section.id]
            // 判断当前路径是否属于这个分组
            const isInSection = section.items.some(item => location.pathname === item.to)

            return (
              <div key={section.id}>
                {/* 分组标题 */}
                <button
                  onClick={() => toggleSection(section.id)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold transition-colors rounded
                    ${isInSection
                      ? 'text-primary'
                      : 'text-text-muted hover:text-text-primary'}`}
                >
                  <span>{section.label}</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* 子项列表 */}
                {isOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {section.items.map(item => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end ?? true}
                        className={({ isActive }) =>
                          `block px-3 py-1.5 text-sm rounded-btn transition-colors truncate
                          ${isActive
                            ? 'bg-primary-500/10 text-primary font-medium'
                            : 'text-text-secondary hover:text-text-primary hover:bg-warm/30'}`
                        }
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 分隔线 + 系统设置（底部固定） */}
        <div className="shrink-0 border-t border-border pt-2 pb-1">
          <div className="px-3 pb-1 text-[11px] text-text-muted/50 font-semibold">
            ⚙ 系统设置
          </div>
          <div className="space-y-0.5">
            {systemItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `block px-3 py-1.5 text-sm rounded-btn transition-colors truncate
                  ${isActive
                    ? 'bg-primary-500/10 text-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-warm/30'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  )
}
