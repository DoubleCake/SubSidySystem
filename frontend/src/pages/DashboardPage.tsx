import { useState, useEffect } from 'react'
import * as api from '../api'
import type { YearCompare, VillageSummary } from '../types'
import { FARMER_STATUS, fmt } from '../utils'
import Tag from '../components/Tag'
import Icon from '../components/Icon'

const thisYear = new Date().getFullYear()
const years = Array.from({ length: 8 }, (_, i) => thisYear + 1 - i)

type Tab = 'dashboard' | 'farmers' | 'projects' | 'links' | 'ai' | 'village-groups' | 'households'

type StatsType = {
  id: number; subsidy_name: string; subsidy_year: number; season: string | null
  calc_mode: string; standard_amount: string | null; standard_unit: string | null
  fund_source: string | null; pay_status: number
  app_count: number; beneficiary_count: number
  total_apply: number; total_actual: number
}

type Todos = {
  incomplete_projects: number
  pending_records: number
  overdrawn_households: number
  id_card_errors: number
}

type SeasonSummary = {
  season: string
  project_count: number
  farmer_count: number
  total_amount: number
  total_area: number
  application_count: number
}

const PS_CFG: Record<number, { label: string; cls: string; bar: string }> = {
  0: { label: '未发放', cls: 'bg-warm/60 text-text-muted',    bar: 'bg-border' },
  1: { label: '发放中', cls: 'bg-orange-tag/15 text-[#B8860B]', bar: 'bg-orange-tag' },
  2: { label: '已完成', cls: 'bg-primary/10 text-primary',      bar: 'bg-primary' },
}

const SEASON_CFG: Record<string, { icon: string; color: string; bg: string; border: string; tag: string }> = {
  '大春':   { icon: '🌾', color: 'text-primary', bg: 'bg-primary/5',  border: 'border-primary/20', tag: '主粮季' },
  '小春':   { icon: '🌿', color: 'text-[#5B8C5A]',    bg: 'bg-green-50',     border: 'border-green-200',    tag: '冬作物' },
  '耕地地力保护': { icon: '📅', color: 'text-blue-700',   bg: 'bg-blue-50',     border: 'border-blue-200',    tag: '全年' },
  '临时':   { icon: '⚡', color: 'text-orange-tag',   bg: 'bg-amber-50',    border: 'border-amber-200',   tag: '临时专项' },
}

function groupBySeasonOrder(stats: StatsType[]) {
  const order = ['大春', '小春', '耕地地力保护', '临时']
  const groups: Record<string, StatsType[]> = {}
  for (const s of stats) {
    const key = s.season || '耕地地力保护'
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  }
  const result: { season: string; items: StatsType[] }[] = []
  for (const k of order) {
    if (groups[k]?.length) result.push({ season: k, items: groups[k] })
  }
  for (const k of Object.keys(groups)) {
    if (!order.includes(k)) result.push({ season: k, items: groups[k] })
  }
  return result
}

export default function DashboardPage({ onGoTab }: { onGoTab: (t: Tab) => void }) {
  const [year, setYear]             = useState(thisYear)
  const [compare, setCompare]       = useState<YearCompare | null>(null)
  const [byVillage, setByVillage]   = useState<VillageSummary[]>([])
  const [stats, setStats]           = useState<StatsType[]>([])
  const [seasonData, setSeasonData] = useState<SeasonSummary[]>([])
  const [todos, setTodos]           = useState<Todos | null>(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      Promise.all([
        api.getYearCompare(year),
        api.getSummaryByVillage(year),
        api.getSubsidyTypesWithStats(year),
        api.getSummaryBySeason(year),
        fetch(`/api/subsidies/dashboard/todos?year=${year}`).then(r => r.json()),
      ]).then(([c, v, s, ss, t]) => {
        if (ctrl.signal.aborted) return
        setCompare(c)
        setByVillage(v)
        setStats(s as StatsType[])
        setSeasonData(ss as SeasonSummary[])
        setTodos(t as Todos)
      }).catch(e => { if (!ctrl.signal.aborted) console.error(e) })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    }, 300)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [year])

  const c      = compare?.current_year
  const p      = compare?.last_year
  const diff   = compare?.amount_diff ?? 0
  const maxV   = Math.max(...byVillage.map(v => v.total_amount), 1)
  const totalV = byVillage.reduce((s, v) => s + v.total_amount, 0)
  const seasonGroups = groupBySeasonOrder(stats)

  const todoItems = todos ? [
    { key: 'incomplete_projects', icon: 'tasks', label: `${year}年有未完成项目`, val: todos.incomplete_projects, color: 'amber' as const, tab: 'projects' as Tab, hide: todos.incomplete_projects === 0 },
    { key: 'pending_records',     icon: 'money', label: '补贴记录待发放',        val: todos.pending_records,      color: 'amber' as const, tab: 'projects' as Tab, hide: todos.pending_records === 0 },
    { key: 'overdrawn',           icon: 'warning', label: '家庭户超领预警',         val: todos.overdrawn_households, color: 'red' as const,   tab: 'households' as Tab, hide: todos.overdrawn_households === 0 },
    { key: 'id_errors',           icon: 'error', label: '身份证格式异常',         val: todos.id_card_errors,       color: 'red' as const,   tab: 'farmers' as Tab, hide: todos.id_card_errors === 0 },
  ].filter(t => !t.hide) : []

  return (
    <div>
      {/* 年份选择器 */}
      <div className="flex items-center gap-2 mb-4">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="border border-border rounded-btn px-3 py-2 text-body bg-white outline-none font-semibold text-text-primary shadow-card">
          {years.map(y => <option key={y} value={y}>{y} 年度</option>)}
        </select>
        <button onClick={() => setYear(y => y)}
          className="px-3 py-2 text-body border border-border rounded-btn bg-white text-text-muted hover:bg-warm/40 transition-colors">
          刷新
        </button>
        {loading && (
          <span className="flex items-center gap-1.5 text-meta text-text-muted">
            <span className="w-3 h-3 border-2 border-border border-t-primary rounded-full animate-spin inline-block" />
            加载中…
          </span>
        )}
      </div>

      {/* 待办预警栏 */}
      {todoItems.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {todoItems.map(t => (
            <button key={t.key} onClick={() => onGoTab(t.tab)}
              className={`flex items-center gap-3 px-4 py-3 rounded-card border text-left transition-all hover:shadow-card-hover
                ${t.color === 'red'
                  ? 'bg-danger/5 border-danger/20 hover:border-danger/30'
                  : 'bg-orange-tag/5 border-orange-tag/20 hover:border-orange-tag/30'}`}>
              <Icon name={t.icon as any} size={22}
                className={t.color === 'red' ? 'text-danger' : 'text-orange-tag'} />
              <div className="flex-1 min-w-0">
                <div className={`text-body font-semibold ${t.color === 'red' ? 'text-danger' : 'text-[#B8860B]'}`}>
                  {t.label}
                </div>
                <div className={`text-meta mt-0.5 ${t.color === 'red' ? 'text-danger/70' : 'text-orange-tag/70'}`}>
                  共 {t.val} {t.key === 'incomplete_projects' ? '个' : t.key === 'pending_records' ? '条' : '户/条'} · 点击前往处理 →
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {todos && todoItems.length === 0 && !loading && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-card mb-4 text-body text-primary">
          <Icon name="check" size={16} />
          <span>{year} 年度数据状态正常，无待处理事项</span>
        </div>
      )}

      {/* 核心指标卡 - 墨绿背景 for 主要数据 */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { icon: 'money', label: `${year}年实发总额`,
            val: c ? `¥${c.total_amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '—',
            sub: c ? `${c.application_count} 笔记录` : '',
            primary: true },
          { icon: 'chart', label: '较上年变化',
            val: c && p ? `${diff >= 0 ? '+' : ''}¥${Math.abs(diff).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '—',
            sub: compare?.amount_diff_pct != null ? `${diff >= 0 ? '+' : ''}${compare.amount_diff_pct}%` : p ? '上年无数据' : '—',
            positive: diff >= 0, primary: false },
          { icon: 'farmers', label: '受益农户数',
            val: c ? String(c.farmer_count) : '—',
            sub: p ? `上年 ${p.farmer_count} 户` : '上年无记录',
            primary: false },
          { icon: 'subsidies', label: '补贴项目',
            val: String(stats.length),
            sub: `${stats.filter(s => s.pay_status === 2).length} 项已完成`,
            primary: false },
        ].map((s, idx) => {
          const bgNum = (idx % 4) + 1
          const bgStyle = {
            backgroundImage: `url(/images/chart_bg_0${bgNum}.png)`,
            backgroundSize: 'cover' as const,
            backgroundPosition: 'center' as const,
            backgroundRepeat: 'no-repeat' as const,
          }
          return s.primary ? (
            <div key={idx} className="rounded-card p-4 shadow-card" style={bgStyle}>
              <div className="flex items-center gap-2 mb-2">
                <Icon name={s.icon as any} size={18} className="text-primary/60" />
                <span className="text-meta text-text-muted">{s.label}</span>
              </div>
              <div className="text-h2 font-bold font-mono text-primary">{s.val}</div>
              <div className="text-meta text-text-muted mt-1">{s.sub}</div>
            </div>
          ) : (
            <div key={idx} className="bg-white border border-border rounded-card p-4 shadow-card" style={bgStyle}>
              <div className="flex items-center gap-2 mb-2">
                <Icon name={s.icon as any} size={18}
                  className={idx === 2 ? 'text-blue-600' : idx === 3 ? 'text-purple-600' : s.positive !== false ? 'text-primary' : 'text-danger'} />
                <span className="text-meta text-text-muted">{s.label}</span>
              </div>
              <div className={`text-h2 font-bold font-mono ${s.positive !== false ? 'text-text-primary' : 'text-danger'}`}>
                {s.val}
              </div>
              <div className="text-meta text-text-muted mt-1">{s.sub}</div>
            </div>
          )
        })}
      </div>

      {/* 季节概览卡 */}
      {seasonData.length > 0 && (
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${seasonData.length}, 1fr)` }}>
          {seasonData.map(sd => {
            const cfg = SEASON_CFG[sd.season] ?? { icon: '📌', color: 'text-text-primary', bg: 'bg-warm/30', border: 'border-border', tag: sd.season }
            return (
              <div key={sd.season} className={`${cfg.bg} border ${cfg.border} rounded-card px-4 py-3 shadow-card`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{cfg.icon}</span>
                  <span className={`text-body font-semibold ${cfg.color}`}>{sd.season}</span>
                  <span className="ml-auto text-meta text-text-muted bg-white/60 px-1.5 py-0.5 rounded-btn">{cfg.tag}</span>
                </div>
                <div className={`text-xl font-bold font-mono ${cfg.color}`}>
                  ¥{sd.total_amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                </div>
                <div className="flex gap-3 mt-1.5 text-meta text-text-muted">
                  <span>{sd.farmer_count} 人</span>
                  <span>·</span>
                  <span>{sd.project_count} 项</span>
                  {sd.total_area > 0 && (
                    <>
                      <span>·</span>
                      <span>{sd.total_area.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 亩</span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-[1fr_300px] gap-4 mb-4">
        {/* 补贴项目列表（按季节分组） */}
        <div className="bg-white border border-border rounded-card shadow-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-warm/30 flex justify-between items-center">
            <span className="font-semibold text-text-primary text-card-title flex items-center gap-2">
              <Icon name="subsidies" size={16} />
              {year}年 补贴项目
            </span>
            <button onClick={() => onGoTab('projects')} className="text-meta text-primary hover:underline font-medium">
              管理 <Icon name="back" size={12} className="inline rotate-180" />
            </button>
          </div>
          {stats.length === 0
            ? <div className="py-10 text-center text-text-muted/50 text-body">暂无补贴项目</div>
            : <div>
                {seasonGroups.map(group => {
                  const scfg = SEASON_CFG[group.season] ?? { icon: '📌', color: 'text-text-primary', bg: '', border: '', tag: '' }
                  return (
                    <div key={group.season}>
                      <div className={`px-5 py-1.5 flex items-center gap-2 border-y border-border bg-warm/20`}>
                        <span className="text-sm">{scfg.icon}</span>
                        <span className={`text-meta font-semibold ${scfg.color}`}>{group.season}</span>
                        <span className="text-meta text-text-muted">{group.items.length} 个项目</span>
                      </div>
                      <div className="divide-y divide-border/30">
                        {group.items.map(s => {
                          const cfg = PS_CFG[s.pay_status] ?? PS_CFG[0]
                          const rate = s.total_actual > 0 && s.total_apply > 0
                            ? Math.min(100, Math.round(s.total_actual / s.total_apply * 100))
                            : s.pay_status === 2 ? 100 : 0
                          return (
                            <button key={s.id} onClick={() => onGoTab('projects')}
                              className="w-full px-5 py-3 hover:bg-warm/20 transition-colors text-left">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                    <span className="text-body font-semibold text-text-primary">{s.subsidy_name}</span>
                                    <span className={`text-meta px-2 py-0.5 rounded-btn font-medium ${cfg.cls}`}>{cfg.label}</span>
                                    <span className="text-meta text-text-muted">{s.calc_mode === 'per_mu' ? '按亩' : '固定'}</span>
                                    {s.fund_source && <span className="text-meta text-text-muted">{s.fund_source}</span>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-warm rounded-full h-2 overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${rate}%` }} />
                                    </div>
                                    <span className="text-meta font-mono text-text-muted w-8 text-right">{rate}%</span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                  <div className="text-sm font-bold font-mono text-primary">
                                    ¥{s.total_actual.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                                  </div>
                                  <div className="text-meta text-text-muted">{s.beneficiary_count} 人 · {s.app_count} 笔</div>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>

        {/* 右侧：新增/待核实农户 */}
        <div className="space-y-3">
          {compare && [
            { title: '新增农户', list: compare.new_farmers, icon: 'person' as const, color: 'green' as const },
            { title: '待核实农户', list: compare.exit_farmers, icon: 'warning' as const, color: 'amber' as const },
          ].map(block => (
            <div key={block.title} className="bg-white border border-border rounded-card overflow-hidden shadow-card">
              <div className="px-4 py-2.5 border-b border-border bg-warm/30 flex justify-between items-center">
                <span className="font-semibold text-text-primary text-body flex items-center gap-2">
                  <Icon name={block.icon} size={16} className={block.color === 'amber' ? 'text-orange-tag' : 'text-primary'} />
                  {block.title}
                </span>
                {block.title === '待核实农户' && block.list.length > 0 &&
                  <span className="text-meta text-text-muted">去年有今年无</span>}
                <Tag label={`${block.list.length}人`} color={block.color} />
              </div>
              <div className="max-h-40 overflow-y-auto">
                {block.list.length === 0
                  ? <div className="py-4 text-center text-text-muted/50 text-meta">无变化</div>
                  : block.list.map(f => (
                    <div key={f.id} className="flex justify-between items-center px-4 py-2 border-b border-border/30 last:border-0">
                      <span className="text-body">{f.name}</span>
                      <div className="flex gap-1.5 items-center">
                        <span className="text-meta text-text-muted">{f.village}</span>
                        {f.status && <Tag label={FARMER_STATUS[f.status]?.label ?? '—'} color={FARMER_STATUS[f.status]?.color as 'green'} />}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 按村分布 */}
      <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
        <div className="px-5 py-3 border-b border-border bg-warm/30 flex justify-between items-center">
          <span className="font-semibold text-text-primary text-card-title flex items-center gap-2">
            <Icon name="village" size={16} />
            按村汇总（{year}年）
          </span>
          <span className="text-meta text-text-muted font-mono">合计 ¥{totalV.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>
        </div>
        <div className="divide-y divide-border/30">
          {byVillage.length === 0 && <div className="py-8 text-center text-text-muted/50 text-body">暂无数据</div>}
          {byVillage.map(v => (
            <div key={v.village_name} className="px-5 py-3 flex items-center gap-4 hover:bg-warm/20 transition-colors">
              <div className="w-20 text-body font-semibold text-text-primary shrink-0">{v.village_name}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-warm rounded-full h-3 overflow-hidden">
                    <div className="bg-primary/60 h-full rounded-full transition-all"
                      style={{ width: `${Math.round(v.total_amount / maxV * 100)}%` }} />
                  </div>
                  <span className="text-meta font-mono text-text-muted w-8 text-right">
                    {totalV ? Math.round(v.total_amount / totalV * 100) : 0}%
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0 w-36">
                <div className="text-sm font-bold font-mono text-primary">{fmt(v.total_amount)}</div>
                <div className="text-meta text-text-muted">{v.beneficiaries} 人 · {v.application_count} 笔</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
