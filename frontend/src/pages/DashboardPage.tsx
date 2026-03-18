/**
 * 首页概览 — 数据统计（原 SummaryPage 升级版）
 * - 核心指标卡
 * - 补贴项目发放进度
 * - 按村汇总横向条形图
 * - 新增/退出农户
 */
import { useState, useEffect } from 'react'
import * as api from '../api'
import type { YearCompare, VillageSummary } from '../types'
import { FARMER_STATUS, fmt } from '../utils'
import Tag from '../components/Tag'

const thisYear = new Date().getFullYear()
const years = Array.from({ length: 8 }, (_, i) => thisYear + 1 - i)

type StatsType = {
  id: number; subsidy_name: string; subsidy_year: number
  calc_mode: string; standard_amount: string | null; standard_unit: string | null
  fund_source: string | null; pay_status: number
  app_count: number; beneficiary_count: number
  total_apply: number; total_actual: number
}

const PS_CFG: Record<number, { label: string; cls: string }> = {
  0: { label: '未发放',   cls: 'bg-stone-100 text-stone-400' },
  1: { label: '部分发放', cls: 'bg-amber-100 text-amber-600' },
  2: { label: '已完成',   cls: 'bg-emerald-100 text-emerald-700' },
}

type Tab = 'dashboard'|'farmers'|'projects'|'precheck'|'links'|'ai'|'village-groups'|'households'
export default function DashboardPage({ onGoTab }: { onGoTab: (t: Tab) => void }) {
  const [year, setYear] = useState(thisYear)
  const [compare, setCompare] = useState<YearCompare | null>(null)
  const [byVillage, setByVillage] = useState<VillageSummary[]>([])
  const [stats, setStats] = useState<StatsType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 防抖：切换年份后 300ms 再发请求，避免快速切换时重复请求
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      Promise.all([
        api.getYearCompare(year),
        api.getSummaryByVillage(year),
        api.getSubsidyTypesWithStats(year),
      ]).then(([c, v, s]) => {
        if (ctrl.signal.aborted) return   // 已被新请求取消，丢弃结果
        setCompare(c); setByVillage(v); setStats(s as StatsType[])
      }).catch(e => {
        if (!ctrl.signal.aborted) console.error(e)
      }).finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    }, 300)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [year])

  const c = compare?.current_year
  const p = compare?.last_year
  const diff = compare?.amount_diff ?? 0
  const maxV = Math.max(...byVillage.map(v => v.total_amount), 1)
  const totalV = byVillage.reduce((s, v) => s + v.total_amount, 0)

  return (
    <div>
      {/* 年份选择 */}
      <div className="flex items-center gap-2 mb-5">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none font-semibold">
          {years.map(y => <option key={y} value={y}>{y} 年度</option>)}
        </select>
        <button onClick={() => setYear(y => y)}
          className="px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-500 hover:bg-stone-50">
          刷新
        </button>
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-stone-400">
            <span className="w-3 h-3 border border-stone-300 border-t-emerald-500 rounded-full animate-spin inline-block" style={{borderWidth:2}}/>
            加载中…
          </span>
        )}
      </div>

      {/* 核心指标卡 */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { icon:'💰', label:`${year}年实发总额`, val: c?`¥${c.total_amount.toLocaleString('zh-CN',{maximumFractionDigits:0})}`:'—', sub: c?`${c.application_count}笔记录`:'', color:'text-emerald-700', border:'border-emerald-200', bg:'bg-emerald-50/40' },
          { icon:'📈', label:'较上年变化', val: c&&p?`${diff>=0?'+':''}¥${Math.abs(diff).toLocaleString('zh-CN',{maximumFractionDigits:0})}`:'—', sub: compare?.amount_diff_pct!=null?`${diff>=0?'+':''}${compare.amount_diff_pct}%`:'—', color:diff>=0?'text-emerald-700':'text-red-500', border:diff>=0?'border-emerald-200':'border-red-200', bg:'' },
          { icon:'👥', label:'受益农户', val: c?String(c.farmer_count):'—', sub: p?`上年${p.farmer_count}人`:'', color:'text-blue-600', border:'border-blue-200', bg:'bg-blue-50/40' },
          { icon:'📋', label:'补贴项目数', val: String(stats.length), sub: `${stats.filter(s=>s.pay_status===2).length}项已完成`, color:'text-purple-600', border:'border-purple-200', bg:'bg-purple-50/40' },
        ].map(s => (
          <div key={s.label} className={`bg-white border rounded-xl p-4 shadow-sm ${s.border} ${s.bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{s.icon}</span>
              <span className="text-xs text-stone-400">{s.label}</span>
            </div>
            <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
            <div className="text-xs text-stone-300 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-4 mb-4">
        {/* 补贴项目发放进度 */}
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
            <span className="font-semibold text-stone-700 text-sm">📋 {year}年 补贴项目发放进度</span>
            <button onClick={() => onGoTab('projects')} className="text-xs text-emerald-700 hover:underline">管理项目 →</button>
          </div>
          {stats.length === 0
            ? <div className="py-10 text-center text-stone-300 text-sm">暂无补贴项目数据</div>
            : <div className="divide-y divide-stone-50">
                {stats.map(s => {
                  const cfg = PS_CFG[s.pay_status] ?? PS_CFG[0]
                  const rate = s.total_apply > 0 ? Math.min(100, Math.round(s.total_actual / s.total_apply * 100)) : (s.pay_status === 2 ? 100 : 0)
                  return (
                    <div key={s.id} className="px-5 py-3 hover:bg-stone-50/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-stone-800">{s.subsidy_name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>{cfg.label}</span>
                            <span className="text-xs text-stone-300">{s.calc_mode === 'per_mu' ? '按亩' : '固定'}</span>
                            {s.fund_source && <span className="text-xs text-stone-300">{s.fund_source}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-stone-100 rounded-full h-2 overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${s.pay_status===2?'bg-emerald-500':s.pay_status===1?'bg-amber-400':'bg-stone-300'}`}
                                style={{ width: `${rate}%` }} />
                            </div>
                            <span className="text-xs font-mono text-stone-400 w-8 text-right">{rate}%</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <div className="text-sm font-bold font-mono text-emerald-700">
                            ¥{s.total_actual.toLocaleString('zh-CN',{maximumFractionDigits:0})}
                          </div>
                          <div className="text-xs text-stone-400">{s.beneficiary_count}人 · {s.app_count}笔</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>

        {/* 新增/退出农户 */}
        <div className="space-y-3">
          {compare && [
            { title: '🆕 新增农户', list: compare.new_farmers, color: 'green' as const, textColor: 'text-emerald-700' },
            { title: '📤 退出农户', list: compare.exit_farmers, color: 'red' as const, textColor: 'text-red-500' },
          ].map(block => (
            <div key={block.title} className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
                <span className="font-semibold text-stone-700 text-sm">{block.title}</span>
                <Tag label={`${block.list.length}人`} color={block.color} />
              </div>
              <div className="max-h-40 overflow-y-auto">
                {block.list.length === 0
                  ? <div className="py-4 text-center text-stone-300 text-xs">无变化</div>
                  : block.list.map(f => (
                    <div key={f.id} className="flex justify-between items-center px-4 py-2 border-b border-stone-50 last:border-0">
                      <span className="text-sm">{f.name}</span>
                      <div className="flex gap-1.5 items-center">
                        <span className="text-xs text-stone-400">{f.village}</span>
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

      {/* 按村汇总横向条形图 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
          <span className="font-semibold text-stone-700 text-sm">📍 按村汇总（{year}年）</span>
          <span className="text-xs text-stone-400 font-mono">合计 ¥{totalV.toLocaleString('zh-CN',{maximumFractionDigits:0})}</span>
        </div>
        <div className="divide-y divide-stone-50">
          {byVillage.length === 0 && <div className="py-8 text-center text-stone-300 text-sm">暂无数据</div>}
          {byVillage.map(v => (
            <div key={v.village_name} className="px-5 py-3 flex items-center gap-4 hover:bg-stone-50/50">
              <div className="w-20 text-sm font-semibold text-stone-700 shrink-0">{v.village_name}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 bg-stone-100 rounded-full h-3 overflow-hidden">
                    <div className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-full rounded-full transition-all"
                      style={{ width: `${Math.round(v.total_amount / maxV * 100)}%` }} />
                  </div>
                  <span className="text-xs font-mono text-stone-400 w-8 text-right">
                    {totalV ? Math.round(v.total_amount / totalV * 100) : 0}%
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0 w-36">
                <div className="text-sm font-bold font-mono text-emerald-700">
                  {fmt(v.total_amount)}
                </div>
                <div className="text-xs text-stone-400">{v.beneficiaries}人 · {v.application_count}笔</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
