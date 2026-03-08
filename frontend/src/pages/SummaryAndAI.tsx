import { useState, useEffect } from 'react'
import * as api from '../api'
import type { YearCompare, VillageSummary } from '../types'
import { FARMER_STATUS, fmt } from '../utils'
import Tag from '../components/Tag'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

export function SummaryPage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [compare, setCompare] = useState<YearCompare | null>(null)
  const [byVillage, setByVillage] = useState<VillageSummary[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [c, v] = await Promise.all([
        api.getYearCompare(year),
        api.getSummaryByVillage(year),
      ])
      setCompare(c); setByVillage(v)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [year])

  const c = compare?.current_year
  const p = compare?.last_year
  const diff = compare?.amount_diff ?? 0
  const pct = compare?.amount_diff_pct
  const totalAll = byVillage.reduce((s, v) => s + v.total_amount, 0)

  return (
    <div>
      <div className="flex gap-2 mb-5 items-center">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
          {Array.from({length:8},(_,i)=>new Date().getFullYear()+1-i).map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <button onClick={load} className="ml-2 px-3 py-1.5 text-sm border border-stone-200 rounded-lg bg-white text-stone-500 hover:bg-stone-50">刷新</button>
      </div>

      {/* 统计卡片 */}
      {c && p && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: `${year}年实发总额`, val: `¥${c.total_amount.toFixed(0)}`, sub: `${c.application_count}笔记录`, color: 'text-emerald-700' },
            { label: '较上年变化', val: `${diff >= 0 ? '+' : ''}¥${diff.toFixed(0)}`, sub: pct != null ? `${diff >= 0 ? '+' : ''}${pct}%` : '—', color: diff >= 0 ? 'text-emerald-700' : 'text-red-500' },
            { label: `${year}年受益人数`, val: String(c.farmer_count), sub: `上年 ${p.farmer_count} 人`, color: 'text-blue-600' },
            { label: '新增/退出', val: `+${compare?.new_farmers.length ?? 0} / -${compare?.exit_farmers.length ?? 0}`, sub: '人', color: 'text-amber-600' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
              <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
              <div className="text-xs text-stone-400 mt-1">{s.label}</div>
              <div className="text-xs text-stone-300 mt-0.5 font-mono">{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* 新增/退出 */}
      {compare && (
        <div className="grid grid-cols-2 gap-4 mb-5">
          {[
            { title: '🆕 新增农户', list: compare.new_farmers, tagColor: 'green' as const, countColor: 'text-emerald-700' },
            { title: '📤 退出农户', list: compare.exit_farmers, tagColor: 'red' as const, countColor: 'text-red-500' },
          ].map(block => (
            <div key={block.title} className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
                <span className="font-semibold text-stone-700 text-sm">{block.title}</span>
                <Tag label={`${block.list.length} 人`} color={block.tagColor} />
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-stone-50">
                {block.list.length === 0
                  ? <div className="py-6 text-center text-stone-300 text-sm">无</div>
                  : block.list.map(f => (
                    <div key={f.id} className="flex justify-between items-center px-4 py-2.5">
                      <span className="text-sm">{f.name}</span>
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-stone-400">{f.village}</span>
                        {f.status && <Tag label={FARMER_STATUS[f.status]?.label ?? '—'} color={FARMER_STATUS[f.status]?.color as 'green'} />}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 按村汇总 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 font-semibold text-sm text-stone-700">📍 按村汇总（{year}年）</div>
        <table className="w-full border-collapse">
          <thead><tr className="border-b border-stone-100">
            {['村庄', '受益人数', '实发总额', '笔数', '占比'].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-xs text-stone-400 font-semibold">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {byVillage.map(v => (
              <tr key={v.village_name} className="border-b border-stone-50 hover:bg-stone-50">
                <td className="px-4 py-2.5 text-sm font-semibold">{v.village_name}</td>
                <td className="px-4 py-2.5 text-sm">{v.beneficiaries} 人</td>
                <td className="px-4 py-2.5 text-sm font-mono font-bold text-emerald-700">¥{v.total_amount.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-sm">{v.application_count} 笔</td>
                <td className="px-4 py-2.5 w-48">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-stone-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-emerald-500 h-full rounded-full"
                        style={{ width: `${totalAll ? Math.round(v.total_amount / totalAll * 100) : 0}%` }} />
                    </div>
                    <span className="text-xs font-mono text-stone-400 w-8">{totalAll ? Math.round(v.total_amount / totalAll * 100) : 0}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── AI 分析页 ───
export function AIPage() {
  const { toast, show } = useToast()
  const [year, setYear] = useState(new Date().getFullYear())
  const [village, setVillage] = useState('')
  const [question, setQuestion] = useState('请分析本年度补贴发放情况，指出异常并与上年对比，列出主要变化。')
  const [result, setResult] = useState('')
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [villages, setVillages] = useState<string[]>([])

  useEffect(() => {
    api.getVillageGroups().then(g => setVillages([...new Set(g.map(v => v.village_name))]))
  }, [])

  const run = async () => {
    setLoading(true); setResult(''); setPreview(null)
    try {
      const res = await api.aiAnalyze({ year, village_name: village || undefined, question })
      setResult(res.result)
      setPreview(res.data_preview)
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally { setLoading(false) }
  }

  return (
    <div className="grid grid-cols-[300px_1fr] gap-5">
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm self-start">
        <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 font-semibold text-sm text-stone-700">🤖 AI 分析设置</div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1">分析年度</label>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              {Array.from({length:8},(_,i)=>new Date().getFullYear()+1-i).map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">限定村庄（可选）</label>
            <select value={village} onChange={e => setVillage(e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">全部村庄</option>
              {villages.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">分析问题</label>
            <textarea rows={5} value={question} onChange={e => setQuestion(e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700 leading-relaxed">
            ⚠️ 发送前自动脱敏：身份证保留前6后4 · 手机保留前3后4 · 银行卡仅保留后4位
          </div>
          <button onClick={run} disabled={loading}
            className="w-full py-2 bg-emerald-700 text-white rounded-lg text-sm hover:bg-emerald-600 disabled:opacity-60 transition-colors">
            {loading ? '分析中…' : '发送给 AI 分析'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
          <span className="font-semibold text-sm text-stone-700">分析结果</span>
          {preview && (
            <span className="text-xs text-stone-400 font-mono">
              {String(preview.year)}年 · {String(preview.record_count)}条记录（已脱敏）
            </span>
          )}
        </div>
        <div className="p-5">
          {loading && (
            <div className="text-center py-16">
              <div className="w-8 h-8 border-3 border-stone-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-3" style={{ borderWidth: 3 }} />
              <p className="text-stone-400 text-sm">正在脱敏数据并调用 AI 分析…</p>
            </div>
          )}
          {!loading && !result && <div className="text-center py-16 text-stone-300 text-sm">点击左侧"发送给 AI 分析"开始</div>}
          {result && (
            <pre className="whitespace-pre-wrap text-sm text-stone-700 leading-relaxed font-sans bg-emerald-50/50 border border-emerald-100 rounded-xl p-5">{result}</pre>
          )}
        </div>
      </div>
      <Toast {...toast} />
    </div>
  )
}
