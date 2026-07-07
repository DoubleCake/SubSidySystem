/**
 * 家庭户补贴导出 — 输入身份证号，导出该户所有补贴记录
 * 发放优先，无发放则显示预申请
 */
import { useState } from 'react'
import * as XLSX from 'xlsx-js-style'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface Record {
  farmer_name: string
  id_card: string
  subsidy_name: string
  subsidy_year: number
  apply_area: number
  apply_area_no_calc: number
  contract_area: number
  trust_area: number
  amount: number
  pay_status: string
  pay_date: string
  source: string
}

interface HouseholdResult {
  household_name: string
  household_code: string
  village_name: string
  group_no: string
  members: string[]
  records: Record[]
}

const HEADER_STYLE = {
  font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '4A5568' } },
  border: { bottom: { style: 'medium', color: { rgb: 'CBD5E0' } } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
}

const COL_WIDTHS = [12, 22, 20, 8, 10, 10, 10, 10, 10, 8, 14, 8]
const COL_HEADERS = ['姓名', '身份证号', '项目名称', '年度', '计入面积', '不计面积', '承包地面积', '代耕代种面积', '金额(元)', '状态', '日期', '来源']

export default function HouseholdSubsidyExport() {
  const { toast, show } = useToast()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const parseIdCards = (text: string): string[] => {
    return text.trim().split('\n')
      .map(l => l.match(/(\d{17}[\dXx])/i)?.[1]?.toUpperCase() || l.trim())
      .filter(Boolean)
  }

  const handleExport = async () => {
    const idCards = parseIdCards(input)
    if (!idCards.length) return show('请输入至少一个有效身份证号', 'err')

    setLoading(true)
    try {
      const res = await fetch('/api/export/household-subsidies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_cards: idCards }),
      }).then(r => r.json())

      if (!res.households?.length) {
        show('未找到相关家庭户或补贴记录', 'err')
        return
      }

      // 构建 Excel
      const wb = XLSX.utils.book_new()

      // ── 汇总 Sheet ──
      const summaryHeaders = ['家庭户', '编码', '所在村', '组', '成员', '补贴记录数']
      const summaryAoa: any[][] = [
        summaryHeaders.map(h => ({ v: h, s: HEADER_STYLE })),
      ]
      for (const hh of res.households) {
        summaryAoa.push([
          { v: hh.household_name, s: { font: { sz: 10 }, alignment: { vertical: 'center' } } },
          { v: hh.household_code, s: { font: { sz: 10, name: 'Consolas' }, alignment: { vertical: 'center' } } },
          { v: hh.village_name, s: { font: { sz: 10 }, alignment: { vertical: 'center' } } },
          { v: hh.group_no, s: { font: { sz: 10 }, alignment: { vertical: 'center' } } },
          { v: hh.members.join('、'), s: { font: { sz: 10 }, alignment: { vertical: 'center', wrapText: true } } },
          { v: hh.records.length, s: { font: { sz: 10 }, alignment: { horizontal: 'center', vertical: 'center' } } },
        ])
      }
      const sws = XLSX.utils.aoa_to_sheet(summaryAoa)
      sws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 24 }, { wch: 10 }]
      XLSX.utils.book_append_sheet(wb, sws, '汇总')

      // ── 补贴明细 Sheet ──
      const detailAoa: any[][] = [
        COL_HEADERS.map(h => ({ v: h, s: HEADER_STYLE })),
      ]
      const rowStyle = { font: { sz: 10 }, alignment: { vertical: 'center' } }
      const cellStyle = (align = 'left') => ({ ...rowStyle, alignment: { ...rowStyle.alignment, horizontal: align as any } })

      for (const hh of res.households) {
        // 家庭户分组头
        const grp: any[] = [{ v: `🏠 ${hh.household_name}（${hh.household_code}）`, s: { font: { sz: 10, bold: true }, fill: { fgColor: { rgb: 'EDF2F7' } } } }]
        for (let gi = 1; gi < COL_HEADERS.length; gi++) {
          grp.push({ v: '', s: { fill: { fgColor: { rgb: 'EDF2F7' } } } })
        }
        detailAoa.push(grp)
        for (const r of hh.records) {
          detailAoa.push([
            { v: r.farmer_name, s: rowStyle },
            { v: r.id_card, s: { ...rowStyle, font: { ...rowStyle.font, name: 'Consolas' } } },
            { v: r.subsidy_name, s: cellStyle() },
            { v: r.subsidy_year, s: cellStyle('center') },
            { v: r.apply_area, s: cellStyle('right') },
            { v: r.apply_area_no_calc, s: cellStyle('right') },
            { v: r.contract_area, s: cellStyle('right') },
            { v: r.trust_area, s: cellStyle('right') },
            { v: r.amount, s: cellStyle('right') },
            { v: r.pay_status, s: cellStyle('center') },
            { v: r.pay_date, s: cellStyle('center') },
            { v: r.source, s: cellStyle('center') },
          ])
        }
      }
      const dws = XLSX.utils.aoa_to_sheet(detailAoa)
      dws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, dws, '补贴明细')

      // 输出
      XLSX.writeFile(wb, `家庭户补贴记录_${new Date().toISOString().slice(0, 10)}.xlsx`)
      show(`✓ 已导出 ${res.total_households} 户 / ${res.total_records} 条记录`)
    } catch (e) {
      show('导出失败: ' + (e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <Toast msg={toast?.msg} type={toast?.type} />
      <div>
        <h1 className="text-xl font-bold text-text-primary">🏠 家庭户补贴导出</h1>
        <p className="text-sm text-text-muted mt-0.5">输入身份证号，导出该身份证所属家庭户的全部补贴记录（Excel）</p>
      </div>

      <div className="bg-white rounded-card border border-border p-4 shadow-card">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`每行一个身份证号，支持直接粘贴带身份证号的文本：\n510123196503154231\n510123197802156789`}
          className="w-full h-36 border border-border rounded-btn p-3 text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 resize-y"
        />
        <div className="flex items-center gap-3 mt-3">
          <button onClick={handleExport} disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-emerald-600 text-white rounded-btn hover:bg-emerald-700 disabled:opacity-40 font-medium text-sm flex items-center gap-1.5">
            {loading ? '⏳ 查询中…' : '📥 查询并导出'}
          </button>
          <span className="text-xs text-text-muted">
            同家庭户成员不重复导出 · 发放记录优先
          </span>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-card p-4 text-sm text-blue-700">
        <p className="font-medium mb-1">💡 使用说明</p>
        <ul className="text-xs space-y-1 list-disc pl-4">
          <li>每行输入一个身份证号，支持多个身份证同时查询</li>
          <li>同属一个家庭户的身份证号不会重复导出数据</li>
          <li>某项目同一年的发放记录和预申请记录同时存在时，<b>仅导出发放记录</b></li>
          <li>导出 Excel 包含 汇总 和 补贴明细 两个 Sheet</li>
        </ul>
      </div>
    </div>
  )
}
