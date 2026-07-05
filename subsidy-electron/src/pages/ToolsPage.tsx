import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'

interface ToolCard {
  title: string
  desc: string
  icon: 'excel' | 'search' | 'link' | 'land' | 'household' | 'export' | 'download' | 'tasks' | 'dashboard'
  path: string
  color: string
}

const tools: ToolCard[] = [
  {
    title: '身份证验证',
    desc: '批量校验身份证号有效性，查看校验历史和错误明细',
    icon: 'search',
    path: '/data-verify',
    color: '#1A4D3A',
  },
  {
    title: '人员匹配',
    desc: '按姓名/身份证跨村组匹配人员，支持批量导入对照',
    icon: 'link',
    path: '/match-people',
    color: '#2C6B52',
  },
  {
    title: '家庭户批量导入',
    desc: 'Excel 批量导入家庭户和成员，自动建户、并入已有户或合并多户',
    icon: 'household',
    path: '/settings/household-import',
    color: '#5B8C5A',
  },
  {
    title: '家庭关系导入',
    desc: 'Excel 导入家庭关系（户主/配偶/子女等），自动拆分多户主家庭',
    icon: 'excel',
    path: '/settings/family-relation-import',
    color: '#3B7C6A',
  },
  {
    title: 'Excel 模板管理',
    desc: '管理 Excel 列映射模板，适配各村镇不同格式的导入文件',
    icon: 'export',
    path: '/settings/excel-templates',
    color: '#E6C288',
  },
  {
    title: '数据备份迁移',
    desc: '导出数据库备份、恢复历史数据、跨设备迁移',
    icon: 'download',
    path: '/settings/backup',
    color: '#8B7355',
  },
  {
    title: '土地流转台账',
    desc: '管理土地代耕代种流转记录，跟踪合同到期和补贴影响',
    icon: 'land',
    path: '/settings/land-trust',
    color: '#6B8E6B',
  },
  {
    title: '操作流程文档',
    desc: '查看系统各功能模块的操作流程和注意事项',
    icon: 'dashboard',
    path: '/workflow',
    color: '#4A7C6E',
  },
]

export default function ToolsPage() {
  const navigate = useNavigate()

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      {/* 标题区 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary">数据工具</h1>
        <p className="text-sm text-text-muted mt-1">常用的数据处理和导入工具，点击卡片进入</p>
      </div>

      {/* 工具卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tools.map(tool => (
          <div
            key={tool.path}
            onClick={() => navigate(tool.path)}
            className="bg-white rounded-card border border-border p-5 cursor-pointer
                       hover:shadow-card hover:border-primary/30 hover:-translate-y-0.5
                       transition-all duration-200 group"
          >
            {/* 图标 */}
            <div
              className="w-10 h-10 rounded-btn flex items-center justify-center mb-3"
              style={{ backgroundColor: tool.color + '15' }}
            >
              <Icon name={tool.icon} size={22} color={tool.color} />
            </div>

            {/* 标题 */}
            <h3 className="font-semibold text-text-primary mb-1.5 group-hover:text-primary transition-colors">
              {tool.title}
            </h3>

            {/* 描述 */}
            <p className="text-xs text-text-muted leading-relaxed line-clamp-2">
              {tool.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
