/**
 * 工具聚合页 — 卡片式入口 + 内嵌使用
 */
import { useState } from 'react'
import PeopleMatchPage from './PeopleMatchPage'
import HouseholdImportPage from './HouseholdImportPage'
import { AIPage } from './SummaryAndAI'
import WorkflowDocPage from './WorkflowDocPage'
import DataVerifyPage from './DataVerifyPage'
import HouseholdSubsidyExport from './HouseholdSubsidyExport'

interface Tool {
  id: string
  title: string
  desc: string
  icon: string
  color: string
  component?: React.ComponentType
}

const TOOLS: Tool[] = [
  {
    id: 'verify', title: '数据验证', desc: '批量比对姓名+身份证号与数据库是否一致',
    icon: '✅', color: 'from-rose-50 to-rose-100 border-rose-200',
    component: DataVerifyPage,
  },
  {
    id: 'ai', title: 'AI 分析', desc: '智能分析补贴发放数据，发现异常并生成报告',
    icon: '🤖', color: 'from-purple-50 to-purple-100 border-purple-200',
    component: AIPage,
  },
  {
    id: 'match', title: '人员匹配', desc: '输入姓名+村名+电话，模糊匹配数据库中的农户',
    icon: '🔍', color: 'from-blue-50 to-blue-100 border-blue-200',
    component: PeopleMatchPage,
  },
  {
    id: 'household-import', title: '家庭户导入', desc: '智能识别表格列映射，自动分组创建/合并家庭户',
    icon: '📥', color: 'from-green-50 to-green-100 border-green-200',
    component: HouseholdImportPage,
  },
  {
    id: 'hh-subsidy-export', title: '家庭户补贴导出', desc: '输入身份证号，导出该户全部补贴记录（Excel）',
    icon: '🏠', color: 'from-teal-50 to-teal-100 border-teal-200',
    component: HouseholdSubsidyExport,
  },
  {
    id: 'excel', title: 'Excel 模板', desc: '管理各业务场景的 Excel 列映射模板',
    icon: '📋', color: 'from-amber-50 to-amber-100 border-amber-200',
    // component: ExcelTemplatePage,  // 直接跳转
  },
  {
    id: 'workflow', title: '操作流程', desc: '系统各功能模块的使用说明和操作指引',
    icon: '📖', color: 'from-teal-50 to-teal-100 border-teal-200',
    component: WorkflowDocPage,
  },
]

export default function ToolsPage() {
  const [active, setActive] = useState<string | null>(null)

  const activeTool = TOOLS.find(t => t.id === active)

  if (activeTool && activeTool.component) {
    const Comp = activeTool.component
    return (
      <div>
        <button onClick={() => setActive(null)} className="text-sm text-primary hover:underline mb-4 inline-block">
          ← 返回工具列表
        </button>
        <Comp />
      </div>
    )
  }

  // Excel模板直接跳转
  if (active === 'excel') {
    window.location.href = '/settings/excel-templates'
    return null
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-text-primary">🔧 数据工具</h1>
        <p className="text-sm text-text-muted mt-0.5">集中管理数据导入、匹配、分析等常用工具</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map(tool => (
          <button
            key={tool.id}
            onClick={() => {
              if (tool.id === 'excel') {
                window.location.href = '/settings/excel-templates'
              } else {
                setActive(tool.id)
              }
            }}
            className={`bg-gradient-to-br ${tool.color} border rounded-card p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group`}>
            <div className="text-3xl mb-3">{tool.icon}</div>
            <h3 className="font-bold text-text-primary text-sm mb-1 group-hover:text-primary transition-colors">{tool.title}</h3>
            <p className="text-xs text-text-muted leading-relaxed">{tool.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
