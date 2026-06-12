/**
 * 人员模糊匹配页
 * 输入姓名+村名+电话 → 匹配数据库中的农户
 */
import { useState } from 'react'
import * as XLSX from 'xlsx'
import Tag from '../components/Tag'
import { FARMER_STATUS } from '../utils'

interface MatchResult {
  index: number
  input: { name: string; village: string; phone: string }
  matches: {
    farmer_id: number
    real_name: string
    village_name: string
    phone: string
    id_card: string
    id_card_masked?: string
    farmer_status: number
  }[]
  matched_by: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  match_count: number
  warning?: string
  note?: string
}

interface MatchResponse {
  total: number
  summary: { high: number; medium: number; low: number; none: number }
  results: MatchResult[]
}

const CONFIDENCE_CFG: Record<string, { label: string; color: 'green' | 'blue' | 'amber' | 'red'; bg: string }> = {
  high: { label: '高', color: 'green', bg: 'bg-green-50 border-green-200' },
  medium: { label: '中', color: 'blue', bg: 'bg-blue-50 border-blue-200' },
  low: { label: '低', color: 'amber', bg: 'bg-amber-50 border-amber-200' },
  none: { label: '无', color: 'red', bg: 'bg-red-50 border-red-200' },
}

export default function PeopleMatchPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<MatchResponse | null>(null)
  const [error, setError] = useState('')

  const parseInput = (text: string): Record<string, string>[] => {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length === 0) return []

    // 检测分隔符
    const firstLine = lines[0]
    const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(',') ? ',' : /\s{2,}/

    // 第一行可能是表头
    const headerLine = lines[0]
    const headers = typeof sep === 'string'
      ? headerLine.split(sep).map(h => h.trim())
      : headerLine.split(sep).map(h => h.trim())

    const isHeader = headers.some(h =>
      ['姓名', '名字', '村名', '电话', '手机', 'name', 'phone', 'village'].some(k =>
        h.includes(k) || h === k
      )
    )

    const dataLines = isHeader ? lines.slice(1) : lines
    const fieldNames = isHeader ? headers : ['姓名', '村名', '电话号码']

    return dataLines.map(line => {
      const vals = typeof sep === 'string'
        ? line.split(sep).map(v => v.trim())
        : line.split(sep).map(v => v.trim()).filter(v => v)
      const row: Record<string, string> = {}
      fieldNames.forEach((h, i) => {
        if (vals[i]) row[h] = vals[i]
      })
      // 同时映射到标准字段名
      const name = row['姓名'] || row['名字'] || row['name'] || vals[0] || ''
      const village = row['村名'] || row['村'] || row['village'] || vals[1] || ''
      const phone = row['电话'] || row['手机'] || row['电话号码'] || row['phone'] || vals[2] || ''
      return { name, village, phone }
    })
  }

  const handleMatch = async () => {
    setError('')
    const rows = parseInput(input)
    if (rows.length === 0) {
      setError('请输入至少一行数据')
      return
    }

    setLoading(true)
    try {
      const r = await fetch('/api/farmers/match-people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      if (!r.ok) throw new Error('匹配请求失败')
      const data: MatchResponse = await r.json()
      setResult(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const exportXlsx = () => {
    if (!result) return
    const sheetRows = result.results.map(r => {
      const m = r.matches[0]
      const cfg = CONFIDENCE_CFG[r.confidence]
      return {
        '输入姓名': r.input.name, '输入村名': r.input.village, '输入电话': r.input.phone,
        '匹配姓名': m?.real_name || '—', '匹配村名': m?.village_name || '—',
        '匹配电话': m?.phone || '—', '匹配身份证': m?.id_card || m?.id_card_masked || '—',
        '其他匹配': r.match_count > 1 ? `${r.match_count - 1}人` : '',
        '置信度': cfg.label, '匹配方式': r.matched_by, '备注': r.note || '',
      }
    })
    const ws = XLSX.utils.json_to_sheet(sheetRows)
    ws['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 20 }, { wch: 8 }, { wch: 6 }, { wch: 16 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '匹配结果')
    XLSX.writeFile(wb, `人员匹配结果_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-text-primary mb-2">🔍 人员模糊匹配</h1>
      <p className="text-sm text-text-muted mb-5">
        粘贴姓名、村名、电话数据，系统自动匹配数据库中的农户。支持 Tab / 逗号 / 双空格分隔。
      </p>

      {/* 输入区 */}
      <div className="bg-white border border-border rounded-card shadow-card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-text-primary">📋 粘贴数据</span>
          <span className="text-xs text-text-muted">
            {input.split('\n').filter(l => l.trim()).length} 行
            {' · '} 第一行含"姓名/村名/电话"字样会自动识别为表头
          </span>
        </div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`姓名\t村名\t电话号码
张三\t红星村\t13800138001
李四\t朝阳村\t13900139002
...`}
          className="w-full h-40 border border-border rounded-btn p-3 text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 resize-y"
        />
        <div className="flex gap-3 mt-3">
          <button
            onClick={handleMatch}
            disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-primary text-white rounded-btn hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium text-sm"
          >
            {loading ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full mr-2" />匹配中…</> : '🔍 开始匹配'}
          </button>
          {result && (
            <button onClick={exportXlsx} className="px-4 py-2.5 text-sm border border-border text-text-primary rounded-btn hover:bg-warm/30 transition-all">
              ↓ 导出 Excel
            </button>
          )}
        </div>
        {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
      </div>

      {/* 结果汇总 */}
      {result && (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: '高置信', count: result.summary.high, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
              { label: '中置信', count: result.summary.medium, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
              { label: '低置信', count: result.summary.low, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
              { label: '未匹配', count: result.summary.none, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} border rounded-card p-4 text-center`}>
                <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
                <div className="text-xs text-text-muted mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* 结果表格 */}
          <div className="bg-white border border-border rounded-card shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-warm/30 border-b-2 border-border">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">#</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">输入姓名</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">输入村名</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">输入电话</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">匹配姓名</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">匹配村名</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">匹配电话</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">身份证</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-text-muted">置信度</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">匹配方式</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {result.results.map((r, i) => {
                    const m = r.matches[0]
                    const cfg = CONFIDENCE_CFG[r.confidence]
                    return (
                      <tr key={i} className={`hover:bg-warm/30 ${cfg.bg.replace('border-', '')}`}>
                        <td className="px-3 py-2 text-xs text-text-muted">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-text-primary">{r.input.name || '—'}</td>
                        <td className="px-3 py-2 text-text-muted">{r.input.village || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-text-muted">{r.input.phone || '—'}</td>
                        <td className="px-3 py-2 font-semibold text-text-primary">
                          {m ? (
                            <span className="flex items-center gap-1.5">
                              {m.real_name}
                              {m.farmer_status !== 1 && (
                                <Tag label={FARMER_STATUS[m.farmer_status]?.label ?? '异常'} color="red" />
                              )}
                            </span>
                          ) : (
                            <span className="text-text-muted/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-muted text-xs">{m?.village_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-text-muted">{m?.phone || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-amber-700 font-semibold select-all">{m?.id_card || m?.id_card_masked || '—'}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color === 'green' ? 'bg-green-100 text-green-700' : cfg.color === 'blue' ? 'bg-blue-100 text-blue-700' : cfg.color === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-text-muted">
                          {r.matched_by.replace('name_village_phone', '姓名+村名+电话一致').replace('name_village_exact', '姓名+村名一致').replace('village_phone', '村名+电话一致')}
                          {r.note && <span className="ml-1 text-amber-600">({r.note})</span>}
                          {r.match_count > 1 && (
                            <span className="ml-1 text-amber-600">(+{r.match_count - 1})</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
