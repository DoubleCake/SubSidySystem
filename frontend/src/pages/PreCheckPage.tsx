/**
 * 数据预检查页面
 * 流程：通过 ExcelImportWithMapping 上传映射 → 发送后端校验 → 分类展示结果 → 导出报告
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import Tag from '../components/Tag'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import ErrorLibraryPage from './ErrorLibraryPage'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { years } from '../utils'
import { getExcelTemplates } from '../api'
import type { CheckResult, ExcelColumnTemplate } from '../types'

// ─── 类型定义 ───
interface CheckRow {
  row_index: number
  real_name: string
  id_card: string
  village_name: string
  group_no: string
  phone?: string
  land_area?: number
  gender?: string
}

type ActiveTab = 'error-library-hits' | 'format' | 'village' | 'duplicate' | 'gender' | 'area-exceeds' | 'new' | 'removed' | 'changed' | 'year'
type PageTab = 'check' | 'error-lib'

// ─── 预检系统字段（传给 ExcelImportWithMapping）───
const PRECHECK_SYSTEM_FIELDS = [
  { field: "real_name",    label: "姓名",     required: true,  type: "string" },
  { field: "id_card",      label: "身份证号", required: true,  type: "id_card" },
  { field: "village_name", label: "所在村",   required: true,  type: "string" },
  { field: "group_no",     label: "所在组",   required: true,  type: "string" },
  { field: "gender",       label: "性别",     required: false, type: "string" },
  { field: "phone",        label: "手机号",   required: false, type: "string" },
  { field: "land_area",    label: "土地面积", required: false, type: "decimal" },
]

const PRECHECK_TEMPLATE_HEADERS = ['姓名*', '身份证号*', '所在村*', '所在组*', '性别', '手机号', '银行卡号', '开户行', '土地面积(亩)', '备注']
const PRECHECK_TEMPLATE_EXAMPLE = [
  { '姓名*': '张国强', '身份证号*': '510123196503154231', '所在村*': '红星村', '所在组*': '一组', '性别': '男', '手机号': '13812340001', '银行卡号': '', '开户行': '', '土地面积(亩)': 3.5, '备注': '' },
]

// ─── 导出报告到 Excel ───
function exportReport(result: CheckResult, fileName = '预检查报告') {
  const wb = XLSX.utils.book_new()

  const addSheet = (name: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }

  // 汇总
  addSheet('汇总', [{
    '检查总行数': result.summary.total_rows,
    '通过行数': result.summary.ok_rows,
    '错误行数': result.summary.error_rows,
    '通过率': result.summary.pass_rate + '%',
    '格式错误': result.summary.format_errors,
    '村组不存在': result.summary.village_errors,
    '重复身份证': result.summary.duplicate_errors,
    '性别不符': result.summary.gender_mismatch,
    '错误库命中': result.summary.error_library_hits,
    '面积超限': result.summary.area_exceeds,
    '新增农户': result.summary.new_farmers,
    '减少农户': result.summary.removed_farmers,
    '字段变更': result.summary.changed_farmers,
  }])

  addSheet('错误库命中', result.error_library_hits.map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group,
    '错误类型': r.error_type, '错误原因': r.error_reason, '来源': r.source,
  })))

  addSheet('格式错误', result.format_errors.map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group,
    '错误内容': r.errors.join('；'),
  })))

  addSheet('村组不存在', result.village_errors.map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group, '错误信息': r.error,
  })))

  addSheet('重复身份证', result.duplicate_errors.map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card, '错误信息': r.error,
  })))

  addSheet('性别不符', result.gender_mismatch.map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    'Excel性别': r.excel_gender, '身份证性别': r.id_card_gender,
  })))

  addSheet('面积超限', result.area_exceeds.map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group,
    '填报面积': r.land_area, '承包面积': r.contracted_area,
  })))

  addSheet('新增农户', result.new_farmers.map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group, '说明': '数据库中不存在，将新增',
  })))

  addSheet('减少农户', result.removed_farmers.map(r => ({
    '姓名': r.name, '身份证号': r.id_card,
    '所在村': r.village, '所在组': r.group, '说明': r.note,
  })))

  addSheet('字段变更', result.changed_farmers.map(r => ({
    '行号': r.row, '姓名': r.name, '身份证号': r.id_card,
    '变更内容': r.changes.join('；'),
  })))

  if (result.year_compare && (result.year_compare as { year?: number }).year) {
    const yc = result.year_compare as { year: number; new_farmers: { id_card: string; name: unknown }[]; removed_farmers: { id_card: string; name: string; village: string }[] }
    addSheet(`${yc.year}年对比-新增`, (yc.new_farmers || []).map(r => ({
      '身份证号': r.id_card, '姓名': String(r.name), '说明': `${yc.year}年补贴新增`,
    })))
    addSheet(`${yc.year}年对比-减少`, (yc.removed_farmers || []).map(r => ({
      '身份证号': r.id_card, '姓名': r.name, '所在村': r.village, '说明': `${yc.year}年补贴减少`,
    })))
  }

  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// ─── 主页面 ───
export default function PreCheckPage() {
  const { toast, show } = useToast()
  const [step, setStep] = useState<'upload' | 'checking' | 'result'>('upload')
  const [rawRows, setRawRows] = useState<CheckRow[]>([])
  const [result, setResult] = useState<CheckResult | null>(null)
  const [compareYear, setCompareYear] = useState<number | ''>('')
  const [activeTab, setActiveTab] = useState<ActiveTab>('format')
  const [pageTab, setPageTab] = useState<PageTab>('check')

  // ExcelImportWithMapping 状态
  const [importOpen, setImportOpen] = useState(false)
  const [templates, setTemplates] = useState<ExcelColumnTemplate[]>([])
  const pendingRows = useRef<CheckRow[] | null>(null)

  // 加载预检模板
  useEffect(() => {
    getExcelTemplates('PRECHECK').then(setTemplates).catch(() => {})
  }, [])

  // 执行后端检查
  const runCheck = useCallback(async (rows: CheckRow[]) => {
    if (!rows.length) return show('请先上传 Excel 文件', 'err')
    setStep('checking')
    try {
      const res = await fetch('/api/precheck/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          compare_year: compareYear || null,
        })
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail) }
      const data: CheckResult = await res.json()
      setResult(data)
      setStep('result')

      // 默认展示有数据的第一个 tab
      const tabs: { id: ActiveTab; count: number }[] = [
        { id: 'error-library-hits', count: data.summary.error_library_hits },
        { id: 'format', count: data.summary.format_errors },
        { id: 'village', count: data.summary.village_errors },
        { id: 'duplicate', count: data.summary.duplicate_errors },
        { id: 'gender', count: data.summary.gender_mismatch },
        { id: 'area-exceeds', count: data.summary.area_exceeds },
        { id: 'new', count: data.summary.new_farmers },
        { id: 'removed', count: data.summary.removed_farmers },
        { id: 'changed', count: data.summary.changed_farmers },
      ]
      const yearCompare = data.year_compare as { year?: number; new_count?: number }
      if (yearCompare?.year) {
        tabs.push({ id: 'year', count: (yearCompare.new_count || 0) + ((yearCompare as { removed_count?: number }).removed_count || 0) })
      }
      setActiveTab(tabs.find(t => t.count > 0)?.id || 'new')
    } catch (e: unknown) {
      show((e as Error).message, 'err')
      setStep('upload')
    }
  }, [compareYear, show])

  // ExcelImportWithMapping 的 onImport：捕获映射后的行数据，不写入数据库
  const handlePrecheckImport = useCallback(async (mappedRows: Record<string, unknown>[]): Promise<{ created: number; skipped: number; errors: string[] }> => {
    const rows: CheckRow[] = mappedRows.map((r, i) => ({
      row_index: i + 2,
      real_name: String(r.real_name || '').trim(),
      id_card: String(r.id_card || '').trim(),
      village_name: String(r.village_name || '').trim(),
      group_no: String(r.group_no || '').trim(),
      phone: r.phone ? String(r.phone).trim() : undefined,
      land_area: r.land_area != null && r.land_area !== '' ? Number(r.land_area) : undefined,
      gender: r.gender ? String(r.gender).trim() : undefined,
    }))
    pendingRows.current = rows
    setRawRows(rows)
    return { created: rows.length, skipped: 0, errors: [] }
  }, [])

  // ExcelImportWithMapping 的 onSuccess：映射完成，关闭弹窗并开始检查
  const handleImportSuccess = useCallback(() => {
    setImportOpen(false)
    if (pendingRows.current && pendingRows.current.length > 0) {
      const rows = pendingRows.current
      pendingRows.current = null
      runCheck(rows)
    }
  }, [runCheck])

  const reset = () => { setStep('upload'); setRawRows([]); setResult(null); pendingRows.current = null }

  // ─── 结果 tab 定义 ───
  const getTabs = (r: CheckResult) => {
    const yc = r.year_compare as { year?: number; new_count?: number; removed_count?: number }
    return [
      { id: 'error-library-hits' as ActiveTab, label: '错误库命中', count: r.summary.error_library_hits, color: 'red' as const },
      { id: 'format' as ActiveTab,    label: '格式错误',   count: r.summary.format_errors,    color: 'red'    as const },
      { id: 'village' as ActiveTab,   label: '村组不存在', count: r.summary.village_errors,   color: 'red'    as const },
      { id: 'duplicate' as ActiveTab, label: '重复身份证', count: r.summary.duplicate_errors, color: 'amber'  as const },
      { id: 'gender' as ActiveTab,    label: '性别不符',   count: r.summary.gender_mismatch,  color: 'amber'  as const },
      { id: 'area-exceeds' as ActiveTab, label: '面积超限', count: r.summary.area_exceeds,   color: 'orange' as const },
      { id: 'new' as ActiveTab,       label: '新增农户',   count: r.summary.new_farmers,      color: 'green'  as const },
      { id: 'removed' as ActiveTab,   label: '减少农户',   count: r.summary.removed_farmers,  color: 'blue'   as const },
      { id: 'changed' as ActiveTab,   label: '字段变更',   count: r.summary.changed_farmers,  color: 'purple' as const },
      ...(yc.year ? [{ id: 'year' as ActiveTab, label: `${yc.year}年对比`, count: (yc.new_count || 0) + (yc.removed_count || 0), color: 'blue' as const }] : []),
    ]
  }

  return (
    <div>
      {/* ── 顶层 Tab ── */}
      <div className="flex gap-1 mb-5">
        {([
          { id: 'check' as PageTab, label: '数据检查', icon: '🔍' },
          { id: 'error-lib' as PageTab, label: '历史错误库', icon: '📋' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setPageTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${pageTab === t.id ? 'bg-emerald-700 text-white shadow' : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── 历史错误库 Tab ── */}
      {pageTab === 'error-lib' && <ErrorLibraryPage embedded />}

      {/* ── 数据检查 Tab ── */}
      {pageTab === 'check' && <>
      {/* ── 上传区 ── */}
      {step !== 'result' && (
        <div className="grid grid-cols-[1fr_280px] gap-5">
          <div className="bg-white border border-stone-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-stone-700">上传待检查 Excel 文件</h3>
            </div>

            {rawRows.length > 0 ? (
              <div className="border-2 border-emerald-300 bg-emerald-50/40 rounded-xl p-12 text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-stone-700 font-semibold">已导入 {rawRows.length} 行数据</p>
                <p className="text-stone-400 text-sm mt-1">正在执行预检查…</p>
              </div>
            ) : (
              <button
                onClick={() => setImportOpen(true)}
                className="w-full border-2 border-dashed border-stone-200 rounded-xl p-12 text-center hover:border-emerald-400 hover:bg-emerald-50 transition-colors cursor-pointer">
                <div className="text-4xl mb-3">📊</div>
                <p className="text-stone-500 text-sm">点击选择 Excel 文件上传</p>
                <p className="text-stone-300 text-xs mt-1">支持 .xlsx / .xls，可配置列映射</p>
              </button>
            )}
          </div>

          {/* 右侧设置 */}
          <div className="space-y-4">
            <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm">
              <h4 className="font-semibold text-stone-700 text-sm mb-3">检查选项</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-stone-400 mb-1">与哪年的补贴数据对比（可选）</label>
                  <select value={compareYear} onChange={e => setCompareYear(e.target.value ? Number(e.target.value) : '')}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                    <option value="">不对比历史年度</option>
                    {years.map(y => <option key={y} value={y}>{y}年</option>)}
                  </select>
                  <p className="text-xs text-stone-300 mt-1">选择后会对比该年度已有补贴记录，找出新增/减少</p>
                </div>
              </div>
            </div>

            {/* 说明 */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-1.5">
              <p className="font-semibold mb-2">检查项目：</p>
              <p>✓ 姓名：长度、字符合法性</p>
              <p>✓ 身份证：18位格式、出生日期、校验码</p>
              <p>✓ 性别：与身份证是否一致</p>
              <p>✓ 村组：是否在数据库中存在</p>
              <p>✓ 内部重复：同一身份证是否出现多次</p>
              <p>✓ 错误库：与历史错误记录交叉比对</p>
              <p>✓ 面积：土地面积是否超过承包面积</p>
              <p>✓ 与数据库比对：新增/减少/变更</p>
              {compareYear && <p>✓ 与 {compareYear} 年补贴数据对比</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── 结果页 ── */}
      {step === 'result' && result && (
        <div>
          {/* 汇总栏 */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            <div className={`rounded-xl p-4 border shadow-sm ${result.summary.error_rows === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className={`text-3xl font-bold font-mono ${result.summary.error_rows === 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {result.summary.pass_rate}%
              </div>
              <div className="text-xs text-stone-500 mt-1">通过率（{result.summary.ok_rows}/{result.summary.total_rows} 行）</div>
            </div>
            {[
              { label: '格式/村组错误', val: result.summary.format_errors + result.summary.village_errors + result.summary.duplicate_errors, color: 'text-red-600' },
              { label: '错误库命中', val: result.summary.error_library_hits, color: 'text-amber-600' },
              { label: '新增农户', val: result.summary.new_farmers, color: 'text-emerald-700' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
                <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
                <div className="text-xs text-stone-400 mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* 操作栏 */}
          <div className="flex gap-2 mb-4">
            <button onClick={reset}
              className="px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-600 hover:bg-stone-50">
              ← 重新上传
            </button>
            <button onClick={() => exportReport(result)}
              className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
              ↓ 导出完整报告 Excel
            </button>
            <div className="ml-auto text-xs text-stone-400 flex items-center">
              {result.summary.total_rows} 行
            </div>
          </div>

          {/* 分类 Tab */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {getTabs(result).map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                  ${activeTab === t.id ? 'bg-stone-800 text-white border-stone-800' : 'bg-white border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                {t.label}
                {t.count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded text-xs font-mono
                    ${activeTab === t.id ? 'bg-white/20 text-white' : `bg-${t.color}-100 text-${t.color}-700`}`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab 内容 */}
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
            {/* 错误库命中 */}
            {activeTab === 'error-library-hits' && (
              <ResultTable
                title="错误库命中 — 这些人员在历史错误记录中出现，请重点关注"
                empty={result.error_library_hits.length === 0}
                headers={['行号','姓名','身份证号','所在村','所在组','错误类型','错误原因','来源']}
                rows={result.error_library_hits.map(r => [
                  r.row, r.name, r.id_card, r.village, r.group,
                  <Tag key="t" label={r.error_type} color="red" />,
                  <span key="r" className="text-red-600 text-xs">{r.error_reason}</span>,
                  r.source,
                ])} />
            )}
            {/* 格式错误 */}
            {activeTab === 'format' && (
              <ResultTable
                title="格式错误 — 需修复后重新检查"
                empty={result.format_errors.length === 0}
                headers={['行号','姓名','身份证号','所在村','所在组','错误详情']}
                rows={result.format_errors.map(r => [
                  r.row, r.name || '(空)', r.id_card || '(空)',
                  r.village || '(空)', r.group || '(空)',
                  <ul key="e" className="list-none">{r.errors.map((e, i) => <li key={i} className="text-red-600 text-xs">• {e}</li>)}</ul>
                ])} />
            )}
            {/* 村组不存在 */}
            {activeTab === 'village' && (
              <ResultTable
                title="村组不存在 — 请先在「系统设置→村组管理」中添加对应村组"
                empty={result.village_errors.length === 0}
                headers={['行号','姓名','身份证号','填写的村','填写的组','提示']}
                rows={result.village_errors.map(r => [r.row, r.name, r.id_card, r.village, r.group, <span key="e" className="text-amber-600 text-xs">{r.error}</span>])} />
            )}
            {/* 重复 */}
            {activeTab === 'duplicate' && (
              <ResultTable
                title="Excel 内部重复身份证 — 同一身份证出现多次"
                empty={result.duplicate_errors.length === 0}
                headers={['行号','姓名','身份证号','说明']}
                rows={result.duplicate_errors.map(r => [r.row, r.name, r.id_card, r.error])} />
            )}
            {/* 性别不符 */}
            {activeTab === 'gender' && (
              <ResultTable
                title="性别与身份证不符 — 请核实后修正"
                empty={result.gender_mismatch.length === 0}
                headers={['行号','姓名','身份证号','Excel填写性别','身份证推断性别']}
                rows={result.gender_mismatch.map(r => [r.row, r.name, r.id_card, r.excel_gender, <Tag key="g" label={r.id_card_gender} color={r.id_card_gender === '男' ? 'blue' : 'purple'} />])} />
            )}
            {/* 面积超限 */}
            {activeTab === 'area-exceeds' && (
              <ResultTable
                title="面积超限 — 填报面积超过数据库承包面积，请核实"
                empty={result.area_exceeds.length === 0}
                headers={['行号','姓名','身份证号','所在村','所在组','填报面积','承包面积']}
                rows={result.area_exceeds.map(r => [
                  r.row, r.name, r.id_card, r.village, r.group,
                  <span key="a" className="text-orange-600 font-semibold">{r.land_area} 亩</span>,
                  <span key="c" className="text-stone-500">{r.contracted_area} 亩</span>,
                ])} />
            )}
            {/* 新增农户 */}
            {activeTab === 'new' && (
              <ResultTable
                title={`新增农户（${result.new_farmers.length}人）— 数据库中未存在，本次将新增`}
                empty={result.new_farmers.length === 0}
                headers={['行号','姓名','身份证号','所在村','所在组']}
                rows={result.new_farmers.map(r => [r.row, r.name, r.id_card, r.village, r.group])} />
            )}
            {/* 减少农户 */}
            {activeTab === 'removed' && (
              <ResultTable
                title={`减少农户（${result.removed_farmers.length}人）— 数据库在册但本次 Excel 未出现，请确认是否迁出/注销`}
                empty={result.removed_farmers.length === 0}
                headers={['姓名','身份证号','所在村','所在组','说明']}
                rows={result.removed_farmers.map(r => [r.name, r.id_card, r.village, r.group, <span key="n" className="text-blue-600 text-xs">{r.note}</span>])} />
            )}
            {/* 字段变更 */}
            {activeTab === 'changed' && (
              <ResultTable
                title="字段变更 — 与数据库已有数据不一致，请人工确认"
                empty={result.changed_farmers.length === 0}
                headers={['行号','姓名','身份证号','变更内容']}
                rows={result.changed_farmers.map(r => [
                  r.row, r.name, r.id_card,
                  <ul key="c">{r.changes.map((c, i) => <li key={i} className="text-amber-700 text-xs">• {c}</li>)}</ul>
                ])} />
            )}
            {/* 年度对比 */}
            {activeTab === 'year' && result.year_compare && (result.year_compare as { year?: number }).year && (() => {
              const yc = result.year_compare as { year: number; db_count: number; excel_count: number; new_count: number; removed_count: number; new_farmers: { id_card: string; name: unknown }[]; removed_farmers: { id_card: string; name: string; village: string }[] }
              return (
                <div className="p-5">
                  <div className="flex gap-4 mb-5">
                    {[
                      { label: `${yc.year}年有补贴记录`, val: yc.db_count, color: 'text-stone-700' },
                      { label: '本次 Excel 行数', val: yc.excel_count, color: 'text-stone-700' },
                      { label: '新增受益农户', val: yc.new_count, color: 'text-emerald-700' },
                      { label: '减少受益农户', val: yc.removed_count, color: 'text-blue-600' },
                    ].map(s => (
                      <div key={s.label} className="bg-stone-50 border border-stone-200 rounded-xl p-4 flex-1">
                        <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
                        <div className="text-xs text-stone-400 mt-1">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-semibold text-emerald-700 mb-2">新增受益（{yc.new_count}人）</p>
                      <div className="border border-stone-100 rounded-lg overflow-auto max-h-64">
                        <table className="w-full text-xs">
                          <thead className="bg-stone-50"><tr>
                            <th className="px-3 py-2 text-left text-stone-400">姓名</th>
                            <th className="px-3 py-2 text-left text-stone-400 font-mono">身份证号</th>
                          </tr></thead>
                          <tbody>
                            {yc.new_farmers.slice(0, 100).map((r, i) => (
                              <tr key={i} className="border-t border-stone-50">
                                <td className="px-3 py-1.5">{String(r.name)}</td>
                                <td className="px-3 py-1.5 font-mono text-stone-400">{r.id_card}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-blue-700 mb-2">减少受益（{yc.removed_count}人）</p>
                      <div className="border border-stone-100 rounded-lg overflow-auto max-h-64">
                        <table className="w-full text-xs">
                          <thead className="bg-stone-50"><tr>
                            <th className="px-3 py-2 text-left text-stone-400">姓名</th>
                            <th className="px-3 py-2 text-left text-stone-400 font-mono">身份证号</th>
                            <th className="px-3 py-2 text-left text-stone-400">所在村</th>
                          </tr></thead>
                          <tbody>
                            {yc.removed_farmers.slice(0, 100).map((r, i) => (
                              <tr key={i} className="border-t border-stone-50">
                                <td className="px-3 py-1.5">{r.name}</td>
                                <td className="px-3 py-1.5 font-mono text-stone-400">{r.id_card}</td>
                                <td className="px-3 py-1.5 text-stone-400">{r.village}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
      </>}

      {/* ExcelImportWithMapping 弹窗 */}
      <ExcelImportWithMapping
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="导入预检查数据"
        templateHeaders={PRECHECK_TEMPLATE_HEADERS}
        templateExample={PRECHECK_TEMPLATE_EXAMPLE}
        systemFields={PRECHECK_SYSTEM_FIELDS}
        templates={templates.map(t => ({
          id: t.id,
          template_name: t.template_name,
          column_mapping: t.column_mapping.map(m => ({
            excel_column: m.excel_column,
            system_field: m.system_field,
            required: m.required,
          })),
        }))}
        onDetectColumns={async (columns, sampleRows) => {
          const r = await fetch('/api/excel-templates/detect-columns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ columns, sample_rows: sampleRows, business_type: 'PRECHECK' }),
          })
          const raw = await r.json()
          const cols = (raw.columns || []).map((d: Record<string, unknown>) => ({
            excel_column: d.excel_column,
            suggested_field: d.suggested_field,
            confidence: d.confidence ?? d.suggested_confidence ?? 0,
            alternatives: d.alternatives || [],
          }))
          return { columns: cols, recommended_templates: raw.recommended_templates || [] }
        }}
        onSaveTemplate={async (data) => {
          const r = await fetch('/api/excel-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, business_type: 'PRECHECK' }),
          })
          return r.json()
        }}
        onImport={handlePrecheckImport}
        onSuccess={handleImportSuccess}
      />

      <Toast {...toast} />
    </div>
  )
}

// ─── 结果表格组件 ───
function ResultTable({ title, headers, rows, empty }: {
  title: string
  headers: string[]
  rows: (string | number | React.ReactNode)[][]
  empty: boolean
}) {
  return (
    <div>
      <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 text-sm text-stone-600">
        {title}
      </div>
      {empty ? (
        <div className="py-12 text-center text-stone-300">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-sm">此类问题为零，很好！</p>
        </div>
      ) : (
        <div className="overflow-auto max-h-96">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-white border-b border-stone-100">
              <tr>{headers.map(h => <th key={h} className="px-4 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-stone-50 hover:bg-stone-50">
                  {row.map((cell, j) => <td key={j} className="px-4 py-2.5 text-sm align-top">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
