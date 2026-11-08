import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../api'
import type { YearCompare, VillageSummary } from '../types'
import { fmt } from '../utils'
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

const SEASON_STYLE: Record<string, { color: string; bar: string }> = {
  '大春':        { color: 'text-[#234A38]', bar: 'bg-[#234A38]' },
  '小春':        { color: 'text-[#B8863B]', bar: 'bg-[#C9A24A]' },
  '耕地地力保护': { color: 'text-[#2F5C46]', bar: 'bg-[#2F5C46]' },
  '临时':        { color: 'text-[#B91C1C]', bar: 'bg-[#B91C1C]' },
}

export default function DashboardPage({ onGoTab }: { onGoTab: (t: Tab) => void }) {
  const navigate = useNavigate()
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
        api.getDashboardTodos(year),
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

  const c        = compare?.current_year
  const diff     = compare?.amount_diff ?? 0
  const totalV   = byVillage.reduce((s, v) => s + v.total_amount, 0)
  const maxV     = Math.max(...byVillage.map(v => v.total_amount), 1)
  const totalApply  = stats.reduce((s, x) => s + Number(x.total_apply || 0), 0)
  const totalActual = stats.reduce((s, x) => s + Number(x.total_actual || 0), 0)
  const completion  = totalApply > 0 ? Math.min(100, (totalActual / totalApply) * 100) : 0
  const pendingAmount = Math.max(0, totalApply - totalActual)
  const newFarmers = compare?.new_farmers?.length ?? 0

  // 季节进度：用项目统计汇总实发/应发，人数与面积用季节汇总
  const seasonRows = (seasonData.length > 0 ? seasonData : []).map(sd => {
    const list = stats.filter(s => (s.season || '耕地地力保护') === sd.season)
    const apply = list.reduce((s, x) => s + Number(x.total_apply || 0), 0)
    const actual = list.reduce((s, x) => s + Number(x.total_actual || 0), 0)
    const rate = apply > 0 ? Math.min(100, (actual / apply) * 100) : 0
    return { ...sd, rate }
  })

  const todoItems = todos ? [
    { key: 'incomplete_projects', label: `${year} 年未完成项目`, val: todos.incomplete_projects, unit: '个', tab: 'projects' as Tab, tone: 'amber' },
    { key: 'pending_records', label: '补贴记录待发放', val: todos.pending_records, unit: '条', tab: 'projects' as Tab, tone: 'amber' },
    { key: 'overdrawn', label: '家庭户超领预警', val: todos.overdrawn_households, unit: '户', tab: 'households' as Tab, tone: 'red' },
    { key: 'id_errors', label: '身份证格式异常', val: todos.id_card_errors, unit: '条', tab: 'farmers' as Tab, tone: 'red' },
  ].filter(t => t.val > 0) : []

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold text-primary leading-tight">补贴工作台</h1>
          <div className="text-meta text-text-muted mt-1">
            {year} 年度 · {byVillage.length || '—'} 个村 · {c?.farmer_count ?? 0} 户受益 · 数据更新于 {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="h-[32px] border border-border rounded-btn px-3 text-xs bg-white outline-none font-semibold text-text-primary">
            {years.map(y => <option key={y} value={y}>{y} 年度</option>)}
          </select>
          <button onClick={() => setYear(y => y)}
            className="h-[32px] px-3 border border-border rounded-btn bg-white text-xs text-text-muted hover:bg-warm/40 transition-colors">
            刷新
          </button>
          <button onClick={() => navigate('/settings/farmer-attribute-import')}
            className="h-[32px] px-3 border border-border rounded-btn bg-white text-xs text-text-primary hover:border-primary-500/30 transition-colors">
            导入数据
          </button>
          <button onClick={() => onGoTab('projects')}
            className="h-[32px] px-3 ui-btn-primary text-xs">
            新建补贴项目
          </button>
        </div>
      </div>

      {/* 深绿概览 */}
      <div className="relative overflow-hidden rounded-card ui-hero h-[118px] flex-shrink-0">
        <svg aria-hidden="true" className="absolute right-0 bottom-0 w-[520px] h-[200px] opacity-20" viewBox="0 0 520 200" fill="none" stroke="#DDBE84" strokeWidth="1.2">
          <path d="M0 170 80 118 140 146 220 82 286 132 352 96 420 140 520 104" />
          <path d="M0 194 96 146 168 172 244 118 320 160 390 128 460 162 520 138" />
        </svg>
        <div className="relative z-10 flex items-center h-full px-6">
          <div className="w-[320px]">
            <div className="text-[10px] tracking-[0.16em] text-[#D8B567]">{year} ANNUAL OVERVIEW</div>
            <div className="text-[12px] text-white/65 mt-1.5 leading-relaxed">全县补贴申报与发放总体情况，按项目与村组汇总。</div>
            {loading && <div className="text-[10px] text-white/50 mt-1">正在汇总…</div>}
          </div>
          <div className="flex items-center ml-auto">
            <div className="px-7 border-l border-white/15">
              <div className="text-[11px] text-white/55">年度补贴总额</div>
              <div className="text-[24px] font-bold text-[#DDBE84] mt-1 font-mono">{c ? fmt(c.total_amount) : '—'}</div>
            </div>
            <div className="px-7 border-l border-white/15">
              <div className="text-[11px] text-white/55">已发放</div>
              <div className="text-[24px] font-bold mt-1 font-mono">{fmt(totalActual || c?.total_amount || 0)}</div>
            </div>
            <div className="px-7 border-l border-white/15">
              <div className="text-[11px] text-white/55">完成率</div>
              <div className="text-[24px] font-bold mt-1 font-mono">{completion.toFixed(1)}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border border-border rounded-card px-4 py-2.5">
          <div className="text-[11px] text-text-muted">申报农户</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-[20px] font-bold font-mono">{c?.farmer_count ?? 0}</span>
            <span className={`text-[10px] ${diff >= 0 ? 'text-secondary-500' : 'text-danger'}`}>{diff >= 0 ? '+' : ''}{newFarmers} 户</span>
          </div>
        </div>
        <div className="bg-white border border-border rounded-card px-4 py-2.5">
          <div className="text-[11px] text-text-muted">待发放金额</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-[20px] font-bold font-mono">{fmt(pendingAmount)}</span>
            <span className="text-[10px] text-text-muted">{stats.filter(s => s.pay_status !== 2).length} 个项目</span>
          </div>
        </div>
        <div className="bg-white border border-border rounded-card px-4 py-2.5">
          <div className="text-[11px] text-text-muted">待核实异常</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-[20px] font-bold font-mono text-danger">{todos?.overdrawn_households ?? 0}</span>
            <span className="text-[10px] text-danger">超领家庭户</span>
          </div>
        </div>
        <div className="bg-white border border-border rounded-card px-4 py-2.5">
          <div className="text-[11px] text-text-muted">本年新增农户</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-[20px] font-bold font-mono">{newFarmers}</span>
            <span className="text-[10px] text-secondary-500">较上年新增</span>
          </div>
        </div>
      </div>

      {/* 中部：季节进度 + 异常提示 */}
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-3">
        <div className="bg-white border border-border rounded-card px-4 py-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold">季节发放进度</div>
            <button onClick={() => onGoTab('projects')} className="text-[11px] text-text-muted hover:text-primary">项目管理 →</button>
          </div>
          <div className="flex flex-col gap-2.5">
            {seasonRows.length === 0 && <div className="py-6 text-center text-xs text-text-muted/60">暂无季节数据</div>}
            {seasonRows.map(sd => {
              const st = SEASON_STYLE[sd.season] ?? { color: 'text-primary', bar: 'bg-primary-500' }
              return (
                <div key={sd.season}>
                  <div className="flex items-baseline justify-between text-[11.5px]">
                    <span>
                      <b className={st.color}>{sd.season}</b>
                      <span className="text-text-muted ml-2">{sd.farmer_count} 户 · {Number(sd.total_area || 0).toFixed(0)} 亩</span>
                    </span>
                    <span>
                      <b className="font-mono">{fmt(sd.total_amount)}</b>
                      <span className="text-text-muted ml-2">{sd.rate.toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="h-[5px] bg-[#E6E0D4] rounded-full mt-1 overflow-hidden">
                    <div className={`h-[5px] rounded-full ${st.bar}`} style={{ width: `${Math.max(2, sd.rate)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-auto pt-2 border-t border-dashed border-border text-[10.5px] text-text-muted">
            <span>在册项目 <b className="text-text-primary">{stats.length}</b></span>
            <span>已完成 <b className="text-text-primary">{stats.filter(s => s.pay_status === 2).length}</b></span>
            <span>待发放 <b className="text-danger">{stats.filter(s => s.pay_status !== 2).length}</b></span>
            <span className="ml-auto">口径：申报面积与实发金额</span>
          </div>
        </div>

        <div className="bg-white border border-border rounded-card px-4 py-3 flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-bold">待处理事项</span>
              <span className="text-[10px] bg-danger/10 text-danger rounded-full px-1.5 leading-4 font-semibold">{todoItems.reduce((s, t) => s + t.val, 0)}</span>
            </div>
            <button onClick={() => navigate('/anomalies')} className="text-[11px] text-text-muted hover:text-primary">全部 →</button>
          </div>
          <div className="flex flex-col">
            {todoItems.length === 0 && (
              <div className="flex items-center gap-2 py-8 text-xs text-text-muted">
                <Icon name="check" size={14} className="text-secondary-500" /> 当前年度没有待处理事项
              </div>
            )}
            {todoItems.slice(0, 3).map(t => (
              <button key={t.key} onClick={() => onGoTab(t.tab)}
                className="flex items-center gap-2 py-2 border-b border-[#E6E0D4] last:border-0 text-left hover:bg-warm/20 transition-colors">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.tone === 'red' ? 'bg-danger' : 'bg-orange-tag'}`} />
                <span className="flex-1 text-[11.5px] font-medium">{t.label}</span>
                <span className={`text-[11px] font-bold font-mono ${t.tone === 'red' ? 'text-danger' : 'text-[#8A6118]'}`}>{t.val} {t.unit}</span>
              </button>
            ))}
          </div>
          <button onClick={() => navigate('/anomalies')}
            className="mt-auto h-7 border border-border rounded-btn text-[11px] text-text-secondary hover:bg-warm/20 transition-colors">
            进入异常中心
          </button>
        </div>
      </div>

      {/* 底部：村组进度 + 快捷操作 */}
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-3">
        <div className="bg-white border border-border rounded-card px-4 py-2.5 overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-bold">村组发放进度</div>
            <span className="text-[10px] text-text-muted">金额占比</span>
          </div>
          <table className="w-full border-collapse text-[11px] mt-1">
            <thead>
              <tr className="text-text-muted text-[10px] text-left">
                <th className="font-medium py-1">村</th>
                <th className="font-medium py-1 text-right">人数</th>
                <th className="font-medium py-1 text-right">金额</th>
                <th className="font-medium py-1 pl-5">占比</th>
              </tr>
            </thead>
            <tbody>
              {byVillage.slice(0, 4).map(v => {
                const pct = totalV ? (v.total_amount / totalV) * 100 : 0
                return (
                  <tr key={v.village_name} className="border-t border-[#E6E0D4]">
                    <td className="py-1.5 font-semibold">{v.village_name}</td>
                    <td className="py-1.5 text-right font-mono">{v.beneficiaries}</td>
                    <td className="py-1.5 text-right font-mono">{fmt(v.total_amount)}</td>
                    <td className="py-1.5 pl-5">
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-[120px] bg-[#E6E0D4] rounded-full overflow-hidden">
                          <div className={`h-1 rounded-full ${pct >= 95 ? 'bg-[#234A38]' : pct >= 90 ? 'bg-[#2F5C46]' : 'bg-[#C9A24A]'}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                        </div>
                        <span className="text-text-secondary">{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {byVillage.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-text-muted/60">暂无村组数据</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-border rounded-card px-4 py-2.5">
          <div className="text-[13px] font-bold mb-2">快捷操作</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => navigate('/settings/farmer-attribute-import')}
              className="border border-border rounded-btn px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] hover:border-primary-500/30 hover:bg-warm/20 transition-colors">
              <span className="w-[22px] h-[22px] rounded-[5px] bg-[#E2EDE6] text-primary flex items-center justify-center"><Icon name="import" size={12} /></span>
              属性导入
            </button>
            <button onClick={() => navigate('/anomalies')}
              className="border border-border rounded-btn px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] hover:border-danger/30 hover:bg-danger/5 transition-colors">
              <span className="w-[22px] h-[22px] rounded-[5px] bg-[#FCEAE8] text-danger flex items-center justify-center"><Icon name="warning" size={12} /></span>
              异常扫描
            </button>
            <button onClick={() => navigate('/data-verify')}
              className="border border-border rounded-btn px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] hover:border-[#C9A24A]/40 hover:bg-[#FDF8EE] transition-colors">
              <span className="w-[22px] h-[22px] rounded-[5px] bg-[#FBF3E2] text-[#8A6118] flex items-center justify-center"><Icon name="chart" size={12} /></span>
              数据预检
            </button>
            <button onClick={() => navigate('/settings/excel-templates')}
              className="border border-border rounded-btn px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] hover:bg-warm/20 transition-colors">
              <span className="w-[22px] h-[22px] rounded-[5px] bg-[#F1EDE4] text-text-secondary flex items-center justify-center"><Icon name="subsidies" size={12} /></span>
              Excel 模板
            </button>
          </div>
          <div className="mt-2 pt-1.5 border-t border-dashed border-border flex items-center justify-between text-[10px] text-text-muted">
            <span>最近导入：大春预申请.xlsx</span><span className="text-secondary-500">2,801 行</span>
          </div>
        </div>
      </div>
    </div>
  )
}
