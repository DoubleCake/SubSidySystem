import { useState } from 'react'

interface Section { id: string; title: string; icon: string }

const sections: Section[] = [
  { id: 'overview',     title: '系统概览',      icon: '📋' },
  { id: 'basics',       title: '基础数据管理',    icon: '🏘️' },
  { id: 'subsidy',      title: '补贴项目管理',    icon: '💰' },
  { id: 'land',         title: '土地流转管理',    icon: '🌾' },
  { id: 'agri-task',    title: '农业任务分解',    icon: '🌱' },
  { id: 'eligibility',  title: '资格规则引擎',    icon: '⚖️' },
  { id: 'import-export', title: '导入导出',      icon: '📥' },
  { id: 'ai',           title: 'AI 分析',       icon: '🤖' },
  { id: 'backup',       title: '备份维护',      icon: '💾' },
]

const stepColors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500']

function FlowDiagram({ steps }: { steps: { label: string; desc: string }[] }) {
  return (
    <div className="flex flex-wrap items-start gap-0 py-4">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start">
          <div className="flex flex-col items-center min-w-[100px]">
            <div className={`w-10 h-10 ${stepColors[i % stepColors.length]} rounded-full flex items-center justify-center  text-sm font-bold shadow`}>
              {i + 1}
            </div>
            <div className="mt-1.5 text-xs font-semibold text-stone-700 text-center px-1 leading-tight">{s.label}</div>
            <div className="text-[10px] text-stone-400 text-center px-1 mt-0.5 leading-relaxed">{s.desc}</div>
          </div>
          {i < steps.length - 1 && (
            <div className="flex items-center pt-5 px-1">
              <svg className="w-5 h-5 text-stone-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function BranchDiagram({ branches }: { branches: { label: string; items: string[] }[] }) {
  return (
    <div className="flex flex-wrap gap-4 py-3">
      {branches.map((b, i) => (
        <div key={i} className="flex-1 min-w-[160px] border border-stone-200 rounded-lg p-3 bg-white">
          <div className="text-xs font-bold text-stone-500 mb-2 pb-2 border-b border-stone-100">{b.label}</div>
          <ul className="space-y-1">
            {b.items.map((item, j) => (
              <li key={j} className="text-xs text-stone-600 flex items-start gap-1.5">
                <span className="text-emerald-400 mt-0.5">●</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function InfoCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-stone-50 border border-stone-200 rounded-lg p-4 my-3 ${className}`}>
      <div className="font-medium text-sm text-stone-700 mb-2 flex items-center gap-2">
        <span className="w-1 h-4 bg-emerald-400 rounded-full inline-block" />
        {title}
      </div>
      <div className="text-sm text-stone-600 leading-relaxed">{children}</div>
    </div>
  )
}

function SectionContent({ id }: { id: string }) {
  switch (id) {
    case 'overview':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            农户补贴管理系统是一个面向乡镇/村级单位的内网部署 Web 应用，核心功能是管理农户基础信息、补贴申报与发放、土地流转、农业任务分解等全流程业务。
          </p>
          <InfoCard title="业务数据流">
            <div className="flex flex-wrap items-center gap-2 text-xs mt-1">
              {['村组定义', '家庭户建档', '农户信息', '补贴类型', '补贴申报', '发放管理', '土地流转', '农业任务'].map((item, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded font-medium">{item}</span>
                  {i < 7 && <span className="text-stone-300">→</span>}
                </span>
              ))}
            </div>
          </InfoCard>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: '户籍管理', desc: '村组 → 家庭户 → 农户全生命周期管理', icon: '👤', color: 'bg-blue-50 border-blue-200' },
              { label: '补贴管理', desc: '类型定义 → 申报导入 → 审核发放', icon: '💰', color: 'bg-emerald-50 border-emerald-200' },
              { label: '土地管理', desc: '流转台账 → 面积计算 → 补贴依据', icon: '🌾', color: 'bg-amber-50 border-amber-200' },
              { label: '任务分解', desc: '上级任务 → 按村分配 → 进度追踪', icon: '🌱', color: 'bg-purple-50 border-purple-200' },
            ].map((c, i) => (
              <div key={i} className={`border rounded-lg p-3 ${c.color}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{c.icon}</span>
                  <span className="font-semibold text-sm text-stone-700">{c.label}</span>
                </div>
                <p className="text-xs text-stone-500">{c.desc}</p>
              </div>
            ))}
          </div>
          <InfoCard title="技术栈">
            <div className="flex flex-wrap gap-2 mt-1">
              {['Python FastAPI', 'SQLAlchemy + SQLite', 'React 18 + TypeScript', 'Vite + Tailwind CSS', 'Recharts 图表', 'openpyxl Excel处理', 'Anthropic Claude API'].map((t, i) => (
                <span key={i} className="px-2.5 py-1 bg-white border border-stone-200 rounded text-xs text-stone-600 font-mono">{t}</span>
              ))}
            </div>
          </InfoCard>
        </div>
      )

    case 'basics':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            基础数据是系统运行的前提，数据层级为：<strong>村 → 村组 → 家庭户 → 农户</strong>。
          </p>
          <FlowDiagram steps={[
            { label: '创建村庄', desc: '输入村庄名称' },
            { label: '创建村组', desc: '设置组编号(一组/二组…)' },
            { label: '建档家庭户', desc: '户编码、户主信息、承包面积' },
            { label: '录入农户', desc: '姓名、身份证、与户主关系' },
            { label: '批量导入', desc: 'Excel 批量导入农户/家庭户' },
          ]} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard title="家庭户关键字段">
              <ul className="space-y-1 mt-1 text-xs">
                <li>• 户编码 — 系统自动生成或手动指定</li>
                <li>• 承包面积 / 确权面积 — 补贴计算基准</li>
                <li>• 状态 — 正常 / 注销</li>
                <li>• 人工确认 — 数据核实标记</li>
              </ul>
            </InfoCard>
            <InfoCard title="农户关键字段">
              <ul className="space-y-1 mt-1 text-xs">
                <li>• 身份证号 — 唯一标识，系统校验合法性</li>
                <li>• 与户主关系 — 本人/配偶/子女/其他</li>
                <li>• 农户状态 — 在册/死亡/迁出/销户</li>
                <li>• 家庭关系导入 — 按户批量关联</li>
              </ul>
            </InfoCard>
          </div>
        </div>
      )

    case 'subsidy':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            补贴管理是系统的核心业务，支持按年度/季节管理多类补贴项目。
          </p>
          <FlowDiagram steps={[
            { label: '创建补贴类型', desc: '名称、年份、计算方式、标准金额' },
            { label: '导入申报', desc: 'Excel 导入或逐条录入' },
            { label: '数据预检', desc: '校验身份证/面积/重复' },
            { label: '审核', desc: '查看并确认申报数据' },
            { label: '发放管理', desc: '生成发放记录、代领处理' },
          ]} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard title="补贴类型配置">
              <ul className="space-y-1 mt-1 text-xs">
                <li>• 计算方式：<strong>固定金额</strong>（按人/户）或 <strong>按亩计算</strong>（面积 × 标准）</li>
                <li>• 季节控制：春耕 / 夏管 / 秋收 / 冬闲</li>
                <li>• 面积计入：是否计入家庭户总面积上限</li>
              </ul>
            </InfoCard>
            <InfoCard title="代领管理">
              <ul className="space-y-1 mt-1 text-xs">
                <li>• 因特殊原因由他人代领补贴</li>
                <li>• 记录代领人与受益人的关系</li>
                <li>• 支持申请级和发放级代领</li>
              </ul>
            </InfoCard>
          </div>
        </div>
      )

    case 'land':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            土地流转管理跟踪家庭户之间的土地流转关系，影响户级可耕种面积和补贴计算。
          </p>
          <FlowDiagram steps={[
            { label: '创建流转记录', desc: '选择流出/流入方' },
            { label: '流转类型', desc: '代耕代种/出租/转让/撂荒' },
            { label: '面积变动', desc: '更新双方可耕种面积' },
            { label: '补贴计算', desc: '基于净耕种面积计算' },
          ]} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard title="面积计算规则">
              <p className="text-xs mt-1">
                耕地补贴面积 = 承包面积 + 代耕代种转入 - 代耕代种转出 - 流转出租转出 - 撂荒面积 - 不予补贴面积
              </p>
            </InfoCard>
            <InfoCard title="年度汇总">
              <p className="text-xs mt-1">
                按家庭户维度统计每年度/季节的申报总面积，超出承包面积上限时触发预警
              </p>
            </InfoCard>
          </div>
        </div>
      )

    case 'agri-task':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            农业任务分解功能实现上级下达的农业生产任务按村分配，支持多种分配方式。
          </p>
          <FlowDiagram steps={[
            { label: '创建任务', desc: '作物类型、总面积、年度' },
            { label: '分配方式', desc: '选择分配策略' },
            { label: '按村分配', desc: '自动计算各村应分配面积' },
            { label: '任务下达', desc: '正式下达至各村' },
            { label: '完成填报', desc: '各村填报实际完成面积' },
          ]} />
          <BranchDiagram branches={[
            { label: '分配方式', items: ['按承包面积比例', '按水田面积比例', '按旱地面积比例', '按历史完成面积'] },
            { label: '任务状态', items: ['草稿 — 编辑中', '已下达 — 执行中', '已完成 — 填报完毕'] },
          ]} />
        </div>
      )

    case 'eligibility':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            资格规则引擎允许用户自定义补贴资格判定规则，自动批量检查。
          </p>
          <FlowDiagram steps={[
            { label: '配置规则', desc: '定义条件和阈值' },
            { label: '选择范围', desc: '指定检查的农户范围' },
            { label: '批量检查', desc: '引擎逐户判定' },
            { label: '结果输出', desc: '合格/不合格清单' },
          ]} />
          <InfoCard title="规则类型">
            <ul className="space-y-1 mt-1 text-xs">
              <li>• 在册状态 — 农户必须在册（排除死亡/迁出/销户）</li>
              <li>• 年龄限制 — 设置最小/最大年龄</li>
              <li>• 面积限制 — 承包面积或确权面积阈值</li>
              <li>• 互斥检查 — 不能同时享受互斥补贴项目</li>
              <li>• 叠加规则 — 不能超过多类补贴叠加上限</li>
            </ul>
          </InfoCard>
        </div>
      )

    case 'import-export':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            系统提供多场景的 Excel 导入导出功能，支持智能列名映射。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard title="导入场景">
              <ul className="space-y-1.5 mt-1 text-xs">
                <li><strong>农户信息导入</strong> — 批量创建/更新农户档案</li>
                <li><strong>家庭户导入</strong> — 批量建立家庭户并关联成员</li>
                <li><strong>家庭关系导入</strong> — 按户批量关联成员关系</li>
                <li><strong>补贴申报导入</strong> — 批量导入申请记录</li>
                <li><strong>补贴发放导入</strong> — 批量导入发放记录</li>
              </ul>
            </InfoCard>
            <InfoCard title="导出能力">
              <ul className="space-y-1.5 mt-1 text-xs">
                <li><strong>Excel 模板下载</strong> — 各场景标准导入模板</li>
                <li><strong>预检报告导出</strong> — 数据质量分析报告</li>
                <li><strong>全量数据导出</strong> — 备份/迁移用完整 Excel</li>
                <li><strong>按村面积统计</strong> — 村组维度面积汇总</li>
              </ul>
            </InfoCard>
          </div>
          <InfoCard title="智能列映射" className="bg-amber-50 border-amber-200">
            <p className="text-xs mt-1">
              导入时系统自动识别 Excel 列名并与系统字段匹配（如 "身份证号" → "身份证" → "id_card"），
              支持用户手动调整映射关系，支持保存映射模板复用。
            </p>
          </InfoCard>
        </div>
      )

    case 'ai':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            AI 分析功能对接 Anthropic Claude API，对补贴数据进行智能分析。
          </p>
          <FlowDiagram steps={[
            { label: '选择年度', desc: '选定分析年份范围' },
            { label: '选择维度', desc: '按村/补贴类型/季节等' },
            { label: '数据脱敏', desc: '系统自动脱敏敏感信息' },
            { label: 'AI 分析', desc: '调用 Claude API 生成分析' },
            { label: '查看结果', desc: '分析报告与建议' },
          ]} />
          <InfoCard title="分析能力" className="bg-purple-50 border-purple-200">
            <ul className="space-y-1 mt-1 text-xs">
              <li>• 补贴发放趋势分析（年度/季节对比）</li>
              <li>• 村组级补贴分布与异常检测</li>
              <li>• 补贴结构分析与优化建议</li>
              <li>• 数据质量评估</li>
            </ul>
          </InfoCard>
        </div>
      )

    case 'backup':
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600 leading-relaxed">
            系统提供完整的数据备份与恢复能力，支持自动备份和手动导出。
          </p>
          <FlowDiagram steps={[
            { label: '手动备份', desc: '下载当前数据库快照' },
            { label: '自动备份', desc: '每日定时自动备份' },
            { label: '备份恢复', desc: '从备份文件恢复数据' },
            { label: 'Excel 导出', desc: '全量数据导出为 Excel' },
          ]} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard title="备份方式">
              <ul className="space-y-1 mt-1 text-xs">
                <li>• 完整数据库下载（.db 文件）</li>
                <li>• 每日自动备份，保留最近 N 份</li>
                <li>• 全量 Excel 导出（openpyxl 生成）</li>
              </ul>
            </InfoCard>
            <InfoCard title="数据安全">
              <ul className="space-y-1 mt-1 text-xs">
                <li>• 内网部署，无外网暴露</li>
                <li>• 脱敏处理身份证/手机号等敏感信息</li>
                <li>• 备份文件按日期命名，便于管理</li>
              </ul>
            </InfoCard>
          </div>
        </div>
      )

    default:
      return null
  }
}

export default function WorkflowDocPage() {
  const [activeId, setActiveId] = useState<string>('overview')

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <span>📖</span> 操作流程文档
        </h1>
        <p className="text-sm text-stone-400 mt-1">系统功能模块的操作流程和技术说明</p>
      </div>

      {/* 桌面端：侧边栏 + 内容区 */}
      <div className="flex gap-6">
        {/* 侧边导航 */}
        <nav className="hidden lg:block w-48 shrink-0">
          <div className="sticky top-20 space-y-0.5">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2
                  ${activeId === s.id
                    ? 'bg-emerald-100 text-emerald-800 font-medium'
                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'
                  }`}
              >
                <span>{s.icon}</span>
                <span>{s.title}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* 移动端：标签选择器 */}
        <div className="lg:hidden w-full mb-4">
          <select
            value={activeId}
            onChange={e => setActiveId(e.target.value)}
            className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            {sections.map(s => (
              <option key={s.id} value={s.id}>{s.icon} {s.title}</option>
            ))}
          </select>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-w-0">
          <div className="bg-white border border-stone-200 rounded-xl p-5 lg:p-6">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-stone-100">
              <span className="text-lg">{sections.find(s => s.id === activeId)?.icon}</span>
              <h2 className="text-base font-bold text-stone-800">{sections.find(s => s.id === activeId)?.title}</h2>
            </div>
            <SectionContent id={activeId} />
          </div>
        </div>
      </div>

      {/* 页脚 */}
      <div className="mt-8 text-center text-[10px] text-stone-300 pb-4">
        农户补贴管理系统 · 操作流程文档 · 内网部署版
      </div>
    </div>
  )
}
