/**
 * 数据预检查页面
 * 流程：通过 ExcelImportWithMapping 上传映射 → 发送后端校验 → 分类展示结果 → 导出报告
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import Tag from '../components/Tag'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import ResultTable from '../components/ResultTable'
import ErrorLibraryPage from './ErrorLibraryPage'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { years } from '../utils'
import { PRECHECK_TABLE_CONFIGS } from '../utils/precheckConfig'
import { exportPrecheckReport } from '../utils/exportPrecheckReport'
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
  bank_card?: string
  bank_name?: string
  contract_area?: number
  trust_out_area?: number
  trust_in_area?: number
  no_subsidy_area?: number
  actual_subsidy_area?: number
  gender?: string
  address?: string
  remark?: string
}

type ActiveTab = 'error-library-hits' | 'format' | 'village' | 'duplicate' | 'gender' | 'area-anomalies' | 'new' | 'removed' | 'changed' | 'year'
type PageTab = 'check' | 'error-lib'

// ─── 预检系统字段（传给 ExcelImportWithMapping）───
const PRECHECK_SYSTEM_FIELDS = [
  { field: "real_name",       label: "姓名",       required: true,  type: "string" },
  { field: "id_card",         label: "身份证号",   required: true,  type: "id_card" },
  { field: "village_name",    label: "所在村",     required: true,  type: "string" },
  { field: "group_no",        label: "所在组",     required: true,  type: "string" },
  { field: "gender",          label: "性别",       required: false, type: "string" },
  { field: "phone",           label: "手机号",     required: false, type: "string" },
  { field: "bank_card",       label: "银行卡号",   required: false, type: "string" },
  { field: "bank_name",       label: "开户行",     required: false, type: "string" },
  { field: "contract_area",       label: "承包地面积",   required: false, type: "decimal" },
  { field: "trust_out_area",          label: "流转出面积",   required: false, type: "decimal" },
  { field: "trust_in_area",       label: "代耕代种面积",   required: false, type: "decimal" },
  { field: "no_subsidy_area",     label: "不补贴面积",   required: false, type: "decimal" },
  { field: "actual_subsidy_area", label: "实际补贴面积", required: false, type: "decimal" },
  { field: "address",         label: "家庭地址",   required: false, type: "string" },
  { field: "remark",          label: "备注",       required: false, type: "string" },
]

const PRECHECK_TEMPLATE_HEADERS = ['姓名*', '身份证号*', '所在村*', '所在组*', '性别', '手机号', '银行卡号', '开户行', '承包地面积(亩)', '流转出面积(亩)', '代耕代种进(亩)', '不补贴面积(亩)', '实际补贴面积(亩)', '家庭地址', '备注']
const PRECHECK_TEMPLATE_EXAMPLE = [
  { '姓名*': '张国强', '身份证号*': '510123196503154231', '所在村*': '红星村', '所在组*': '一组', '性别': '男', '手机号': '13812340001', '银行卡号': '', '开户行': '农业银行', '承包地面积(亩)': 3.5, '流转出面积(亩)': 0.5, '代耕代种进(亩)': 0, '不补贴面积(亩)': 0, '实际补贴面积(亩)': 3.0, '家庭地址': '红星村一组12号', '备注': '' },
]

// ─── 主页面 ───
export default function PreCheckPage() {
  const { toast, show } = useToast()
  const [step, setStep] = useState<'upload' | 'checking' | 'result'>('upload')
  const [rawRows, setRawRows] = useState<CheckRow[]>([])
  const [result, setResult] = useState<CheckResult | null>(null)
  const [season, setSeason] = useState<string>('')
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
          season: season || null,
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
        { id: 'area-anomalies', count: data.summary.area_anomalies },
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
  }, [season, compareYear, show])

  // ExcelImportWithMapping 的 onImport：捕获映射后的行数据，不写入数据库
  const handlePrecheckImport = useCallback(async (mappedRows: Record<string, unknown>[]): Promise<{ created: number; skipped: number; errors: string[] }> => {
    const toNum = (v: unknown) => v != null && v !== '' ? Number(v) : undefined
    const toStr = (v: unknown) => v ? String(v).trim() : undefined
    const rows: CheckRow[] = mappedRows.map((r, i) => ({
      row_index: i + 2,
      real_name: String(r.real_name || '').trim(),
      id_card: String(r.id_card || '').trim(),
      village_name: String(r.village_name || '').trim(),
      group_no: String(r.group_no || '').trim(),
      phone: toStr(r.phone),
      bank_card: toStr(r.bank_card),
      bank_name: toStr(r.bank_name),
      contract_area: toNum(r.contract_area),
      trust_out_area: toNum(r.trust_out_area),
      trust_in_area: toNum(r.trust_in_area),
      no_subsidy_area: toNum(r.no_subsidy_area),
      actual_subsidy_area: toNum(r.actual_subsidy_area),
      gender: toStr(r.gender),
      address: toStr(r.address),
      remark: toStr(r.remark),
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
      { id: 'area-anomalies' as ActiveTab, label: '面积异常', count: r.summary.area_anomalies,   color: 'orange' as const },
      { id: 'new' as ActiveTab,       label: '新增农户',   count: r.summary.new_farmers,      color: 'green'  as const },
      { id: 'removed' as ActiveTab,   label: '减少农户',   count: r.summary.removed_farmers,  color: 'blue'   as const },
      { id: 'changed' as ActiveTab,   label: '字段变更',   count: r.summary.changed_farmers,  color: 'purple' as const },
      ...(yc.year ? [{ id: 'year' as ActiveTab, label: `${yc.year}年对比`, count: (yc.new_count || 0) + (yc.removed_count || 0), color: 'blue' as const }] : []),
    ]
  }

  // ActiveTab 到配置字段的映射
  const getTabConfig = (tabId: ActiveTab) => {
    const map: Record<ActiveTab, keyof typeof PRECHECK_TABLE_CONFIGS | null> = {
      'error-library-hits': 'error_library_hits',
      'format': 'format_errors',
      'village': 'village_errors',
      'duplicate': 'duplicate_errors',
      'gender': 'gender_mismatch',
      'area-anomalies': 'area_anomalies',
      'new': 'new_farmers',
      'removed': 'removed_farmers',
      'changed': 'changed_farmers',
      'year': null, // 特殊处理
    }
    const field = map[tabId]
    return field ? PRECHECK_TABLE_CONFIGS[field] : null
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
                  <label className="block text-xs text-stone-400 mb-1">补贴分类 <span className="text-red-400">*</span></label>
                  <select value={season} onChange={e => setSeason(e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm bg-white outline-none ${!season ? 'border-amber-300' : 'border-stone-200'}`}>
                    <option value="">— 请选择 —</option>
                    {['大春', '小春', '全年单补', '临时'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <p className="text-xs text-stone-300 mt-1">用于户级累计面积超限检测</p>
                </div>
                <div>
                  <label className="block text-xs text-stone-400 mb-1">与哪年的补贴数据对比（可选）</label>
                  <select value={compareYear} onChange={e => setCompareYear(e.target.value ? Number(e.target.value) : '')}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                    <option value="">不对比历史年度</option>
                    {years.map(y => <option key={y} value={y}>{y}年</option>)}
                  </select>
                  <p className="text-xs text-stone-300 mt-1">选择后会对比该年度已有补贴记录，找出新增/减少；同时启用户级累计超限检测</p>
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
            <button onClick={() => exportPrecheckReport(result)}
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
            {/* 使用共享配置渲染预检表格 */}
            {(() => {
              if (activeTab === 'year') return null // 年度对比特殊处理，稍后渲染

              const config = getTabConfig(activeTab)
              if (!config) return null

              const data = result[config.field] as any[]
              if (!data || data.length === 0) {
                return (
                  <div className="p-8 text-center text-stone-400">
                    <div className="text-2xl mb-2">📋</div>
                    <p className="text-sm">暂无{config.headers[0]?.replace('行号', '')}数据</p>
                  </div>
                )
              }

              const title = typeof config.title === 'function'
                ? config.title(data.length)
                : config.title

              return (
                <ResultTable
                  key={activeTab}
                  title={title}
                  empty={data.length === 0}
                  headers={config.headers}
                  rows={data.map((row, index) => config.rowMapper(row, index))}
                />
              )
            })()}
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
