/**
 * 身份信息验证 — 格式校验 + 重复检测 + 数据库比对
 */
import { useState } from 'react'
import * as XLSX from 'xlsx'
import Tag from '../components/Tag'

type MatchType = 'ok' | 'mismatch' | 'not_found' | 'invalid' | 'duplicate' | 'bad_format'

interface VerifyResult {
  row: number
  input_name: string
  input_id_card: string
  db_name: string | null
  db_village: string | null
  match: MatchType
  detail?: string
}

// 身份证格式校验
function validateIdCard(id: string): { ok: boolean; error: string } {
  if (!id || id.length !== 18) return { ok: false, error: '长度不为18位' }
  if (!/^\d{17}[\dXx]$/.test(id)) return { ok: false, error: '含非法字符' }
  // 出生日期
  const birth = id.substring(6, 14)
  const y = parseInt(birth.substring(0, 4)), m = parseInt(birth.substring(4, 6)), d = parseInt(birth.substring(6, 8))
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return { ok: false, error: '出生日期无效' }
  // 校验位
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checkMap = '10X98765432'
  let sum = 0
  for (let i = 0; i < 17; i++) sum += parseInt(id[i]) * weights[i]
  const expected = checkMap[sum % 11]
  if (id[17].toUpperCase() !== expected) return { ok: false, error: `校验位错误(应为${expected})` }
  return { ok: true, error: '' }
}

export default function DataVerifyPage() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<VerifyResult[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)

  const parseData = (text: string) => {
    const lines = text.trim().split('\n').filter(l => l.trim())
    const rows: { name: string; id_card: string }[] = []
    for (const line of lines) {
      const idMatch = line.match(/(\d{17}[\dXx])/i)
      const idCard = idMatch ? idMatch[1].toUpperCase() : ''
      let name = line.replace(idCard, '').replace(/[\t,;|，；]+/g, ' ').replace(/\s+/g, ' ').trim()
      if (!name && !idCard) continue
      rows.push({ name, id_card: idCard })
    }
    return rows
  }

  const handleVerify = async () => {
    const rows = parseData(input)
    if (!rows.length) return

    setLoading(true)

    // ── 第1步：本地格式校验 + 重复检测 ──
    const idCounts: Record<string, number[]> = {}
    const localResults: VerifyResult[] = []

    rows.forEach((r, i) => {
      const ic = r.id_card
      // 统计重复
      if (ic && ic.length === 18) {
        if (!idCounts[ic]) idCounts[ic] = []
        idCounts[ic].push(i)
      }
    })

    rows.forEach((r, i) => {
      const ic = r.id_card
      // 1. 格式校验
      if (!ic || ic.length !== 18) {
        localResults.push({ row: i + 1, input_name: r.name, input_id_card: ic, db_name: null, db_village: null, match: 'invalid', detail: '长度不为18位' })
        return
      }
      const fmt = validateIdCard(ic)
      if (!fmt.ok) {
        localResults.push({ row: i + 1, input_name: r.name, input_id_card: ic, db_name: null, db_village: null, match: 'bad_format', detail: fmt.error })
        return
      }
      // 2. 重复检测
      const occurrences = idCounts[ic] || []
      if (occurrences.length > 1 && occurrences[0] === i) {
        const others = occurrences.filter(j => j !== i).map(j => j + 1).join('、')
        localResults.push({ row: i + 1, input_name: r.name, input_id_card: ic, db_name: null, db_village: null, match: 'duplicate', detail: `与第${others}行重复` })
        return
      }
      // 待数据库验证
      localResults.push({ row: i + 1, input_name: r.name, input_id_card: ic, db_name: null, db_village: null, match: 'ok', detail: '' })
    })

    // ── 第2步：后端数据库比对（仅格式正确的） ──
    const toVerify = rows.filter((_, i) => localResults[i]?.match === 'ok')
    if (toVerify.length > 0) {
      try {
        const res = await fetch('/api/farmers/verify-names', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: toVerify }),
        }).then(r => r.json())

        // 合并结果
        let vi = 0
        for (let i = 0; i < localResults.length; i++) {
          if (localResults[i].match === 'ok') {
            const v = res.results[vi++]
            if (v) {
              localResults[i].match = v.match
              localResults[i].db_name = v.db_name
              localResults[i].db_village = v.db_village
            }
          }
        }
      } catch (e) {
        alert('数据库验证失败: ' + (e as Error).message)
      }
    }

    // 排序：错误优先
    const order: Record<string, number> = { duplicate: 0, bad_format: 1, invalid: 2, mismatch: 3, not_found: 4, ok: 5 }
    setResults([...localResults].sort((a, b) => (order[a.match] ?? 9) - (order[b.match] ?? 9)))
    setLoading(false)
  }

  const counts: Record<string, number> = {}
  results.forEach(r => { counts[r.match] = (counts[r.match] || 0) + 1 })

  const cards = [
    { key: null, label: '全部', count: results.length, color: 'text-text-primary', bg: 'bg-white border-border' },
    { key: 'duplicate', label: '重复', count: counts['duplicate'] || 0, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
    { key: 'bad_format', label: '格式有误', count: counts['bad_format'] || 0, color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
    { key: 'invalid', label: '格式错误', count: counts['invalid'] || 0, color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200' },
    { key: 'mismatch', label: '姓名不符', count: counts['mismatch'] || 0, color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
    { key: 'not_found', label: '未找到', count: counts['not_found'] || 0, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    { key: 'ok', label: '一致', count: counts['ok'] || 0, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  ]

  const TAG_MAP: Record<string, { label: string; color: 'green' | 'red' | 'amber' | 'gray' | 'purple' | 'blue' }> = {
    ok: { label: '一致', color: 'green' },
    mismatch: { label: '姓名不符', color: 'red' },
    not_found: { label: '未找到', color: 'amber' },
    invalid: { label: '格式错误', color: 'gray' },
    duplicate: { label: '重复', color: 'purple' },
    bad_format: { label: '格式有误', color: 'blue' },
  }

  const exportExcel = () => {
    const wb = XLSX.utils.book_new()
    const headers = ['行号', '输入姓名', '输入身份证', 'DB姓名', 'DB村组', '详情', '验证结果']
    const COLS = [
      { wch: 6 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 10 },
    ]
    const HEADER_STYLE = {
      font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '4A5568' } },
      border: { bottom: { style: 'medium', color: { rgb: 'CBD5E0' } } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    }

    const buildHeader = () => headers.map(h => ({ v: h, s: HEADER_STYLE }))
    const buildRow = (r: VerifyResult) => {
      const tag = TAG_MAP[r.match]
      const rowStyle: any = {
        font: { sz: 10 },
        alignment: { vertical: 'center', wrapText: true },
        ...(r.match !== 'ok' ? { fill: { fgColor: { rgb: 'FFF5F5' } } } : {}),
      }
      return [
        { v: r.row, s: { ...rowStyle, alignment: { ...rowStyle.alignment, horizontal: 'center' } } },
        { v: r.input_name || '', s: rowStyle },
        { v: r.input_id_card || '', s: { ...rowStyle, font: { ...rowStyle.font, name: 'Consolas' } } },
        { v: r.db_name || '', s: rowStyle },
        { v: r.db_village || '', s: rowStyle },
        { v: r.detail || '', s: { ...rowStyle, font: { ...rowStyle.font, color: { rgb: 'C53030' } } } },
        { v: tag?.label || r.match, s: { ...rowStyle, alignment: { ...rowStyle.alignment, horizontal: 'center' }, font: { ...rowStyle.font, bold: true } } },
      ]
    }
    const appendSheet = (name: string, rows: VerifyResult[]) => {
      const aoa: any[][] = [buildHeader()]
      rows.forEach(r => aoa.push(buildRow(r)))
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = COLS
      XLSX.utils.book_append_sheet(wb, ws, name)
    }

    // 按问题类型分 sheet
    const groups: { label: string; key: MatchType; rows: VerifyResult[] }[] = [
      { label: '重复', key: 'duplicate', rows: results.filter(r => r.match === 'duplicate') },
      { label: '格式有误', key: 'bad_format', rows: results.filter(r => r.match === 'bad_format') },
      { label: '格式错误', key: 'invalid', rows: results.filter(r => r.match === 'invalid') },
      { label: '姓名不符', key: 'mismatch', rows: results.filter(r => r.match === 'mismatch') },
      { label: '未找到', key: 'not_found', rows: results.filter(r => r.match === 'not_found') },
      { label: '一致', key: 'ok', rows: results.filter(r => r.match === 'ok') },
    ]

    // 汇总 sheet
    const summaryHeader = [
      { v: '类型', s: HEADER_STYLE },
      { v: '数量', s: HEADER_STYLE },
    ]
    const totalStyle: any = {
      font: { sz: 11, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' },
      fill: { fgColor: { rgb: 'EDF2F7' } },
    }
    const rowStyle: any = { font: { sz: 11 }, alignment: { vertical: 'center' } }
    const countStyle: any = { font: { sz: 11, bold: true }, alignment: { horizontal: 'center', vertical: 'center' } }
    const summaryRows: any[][] = [summaryHeader]
    groups.forEach(g => {
      summaryRows.push([
        { v: g.label, s: rowStyle },
        { v: g.rows.length, s: countStyle },
      ])
    })
    summaryRows.push([
      { v: '合计', s: totalStyle },
      { v: results.length, s: totalStyle },
    ])
    const sws = XLSX.utils.aoa_to_sheet(summaryRows)
    sws['!cols'] = [{ wch: 14 }, { wch: 8 }]
    XLSX.utils.book_append_sheet(wb, sws, '汇总')

    // 仅导出有数据的分类 sheet
    for (const g of groups) {
      if (g.rows.length > 0) {
        appendSheet(g.label, g.rows)
      }
    }

    XLSX.writeFile(wb, `身份信息验证结果_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const ROW_BG: Record<string, string> = {
    duplicate: 'bg-purple-50/50',
    bad_format: 'bg-orange-50/30',
    invalid: 'bg-gray-50/50',
    mismatch: 'bg-red-50/50',
    not_found: 'bg-amber-50/30',
    ok: '',
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-text-primary">📋 身份信息验证</h1>
        <p className="text-sm text-text-muted mt-0.5">粘贴姓名+身份证号，自动校验格式、检测重复、比对数据库</p>
      </div>

      {/* 输入区 */}
      <div className="bg-white rounded-card border border-border p-4 shadow-card">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`姓名\t身份证号\n张三\t510123196503154231\n李四\t510123197802156789`}
          className="w-full h-40 border border-border rounded-btn p-3 text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 resize-y"
        />
        <div className="flex gap-2 mt-3 items-center">
          <button onClick={handleVerify} disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-primary text-white rounded-btn hover:bg-primary/90 disabled:opacity-40 font-medium text-sm">
            {loading ? '验证中…' : '🔍 开始验证'}
          </button>
          {results.length > 0 && (
            <button onClick={exportExcel}
              className="px-4 py-2.5 border-2 border-emerald-500 bg-emerald-500 text-white rounded-btn hover:bg-emerald-600 hover:border-emerald-600 shadow-sm transition-all font-medium text-sm flex items-center gap-1.5">
              📥 导出 Excel
            </button>
          )}
          <span className="text-xs text-text-muted">
            支持 Tab / 逗号 / 分号 / 空格分隔，每行一条记录
          </span>
        </div>
      </div>

      {/* 结果汇总 */}
      {results.length > 0 && (
        <>
          <div className="grid grid-cols-7 gap-2">
            {cards.map(({ key, label, count, color, bg }) => (
              <button key={label} onClick={() => setFilter(key)}
                className={`${bg} border rounded-card p-3 text-center cursor-pointer transition-all hover:shadow-md ${filter === key ? 'ring-2 ring-primary ring-offset-1 scale-[1.02]' : ''}`}>
                <div className={`text-xl font-bold ${color}`}>{count}</div>
                <div className="text-[11px] text-text-muted mt-0.5">{label}</div>
              </button>
            ))}
          </div>

          {/* 明细表格 */}
          <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-warm/30 border-b-2 border-border">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted w-10">#</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">输入姓名</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">输入身份证</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">DB姓名</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">DB村组</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">详情</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-text-muted">结果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {results.filter(r => !filter || r.match === filter).map((r, i) => (
                    <tr key={i} className={ROW_BG[r.match] || ''}>
                      <td className="px-3 py-2 text-xs text-text-muted">{r.row}</td>
                      <td className="px-3 py-2 font-medium text-text-primary">{r.input_name || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-text-muted">{r.input_id_card || '—'}</td>
                      <td className="px-3 py-2 font-medium text-text-primary">{r.db_name || '—'}</td>
                      <td className="px-3 py-2 text-xs text-text-muted">{r.db_village || '—'}</td>
                      <td className="px-3 py-2 text-xs text-text-muted">{r.detail || ''}</td>
                      <td className="px-3 py-2 text-center">
                        <Tag label={TAG_MAP[r.match]?.label || r.match} color={TAG_MAP[r.match]?.color || 'gray'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
