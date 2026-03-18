/**
 * 数据预检查页面
 * 流程：上传 Excel → 解析 → 发送后端校验 → 分类展示结果 → 导出报告
 */
import { useState, useCallback } from 'react'
import * as XLSX from 'xlsx'
import Tag from '../components/Tag'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { years } from '../utils'

interface ErrorLibEntry { id: number; id_card: string; real_name: string; error_reason: string; created_at: string | null }
interface MatchHit { id_card: string; real_name: string; error_reason: string; library_name: string }

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

interface CheckResult {
  summary: {
    total_rows: number; ok_rows: number; error_rows: number
    format_errors: number; village_errors: number
    duplicate_errors: number; gender_mismatch: number
    new_farmers: number; removed_farmers: number
    changed_farmers: number; pass_rate: number
  }
  format_errors:    { row: number; name: string; id_card: string; village: string; group: string; errors: string[] }[]
  village_errors:   { row: number; name: string; id_card: string; village: string; group: string; error: string }[]
  duplicate_errors: { row: number; name: string; id_card: string; error: string }[]
  gender_mismatch:  { row: number; name: string; id_card: string; excel_gender: string; id_card_gender: string; error: string }[]
  new_farmers:      { row: number; name: string; id_card: string; village: string; group: string }[]
  removed_farmers:  { name: string; id_card: string; village: string; group: string; note: string }[]
  changed_farmers:  { row: number; name: string; id_card: string; db_name: string; changes: string[] }[]
  year_compare: {
    year: number; db_count: number; excel_count: number
    new_count: number; removed_count: number
    new_farmers: { id_card: string; name: unknown }[]
    removed_farmers: { id_card: string; name: string; village: string }[]
  } | Record<string, never>
}

type ActiveTab = 'format' | 'village' | 'duplicate' | 'gender' | 'new' | 'removed' | 'changed' | 'year' | 'error-lib'

// ─── 列映射配置（支持不同列名的 Excel）───
const COLUMN_ALIASES: Record<keyof CheckRow | string, string[]> = {
  real_name:    ['姓名*', '姓名', '名字', '农户姓名'],
  id_card:      ['身份证号*', '身份证号', '身份证', '证件号码'],
  village_name: ['所在村*', '所在村', '村名', '村庄'],
  group_no:     ['所在组*', '所在组', '组号', '村组'],
  phone:        ['手机号', '电话', '联系电话', '手机'],
  land_area:    ['土地面积(亩)', '土地面积', '面积', '承包面积'],
  gender:       ['性别'],
}

function mapRow(raw: Record<string, unknown>, rowIndex: number): CheckRow {
  const get = (key: string): string => {
    const aliases = COLUMN_ALIASES[key] || [key]
    for (const alias of aliases) {
      if (raw[alias] !== undefined && raw[alias] !== null && raw[alias] !== '') {
        return String(raw[alias]).trim()
      }
    }
    return ''
  }
  const landStr = get('land_area')
  return {
    row_index:    rowIndex,
    real_name:    get('real_name'),
    id_card:      get('id_card'),
    village_name: get('village_name'),
    group_no:     get('group_no'),
    phone:        get('phone') || undefined,
    gender:       get('gender') || undefined,
    land_area:    landStr ? parseFloat(landStr) : undefined,
  }
}

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
    '新增农户': result.summary.new_farmers,
    '减少农户': result.summary.removed_farmers,
    '字段变更': result.summary.changed_farmers,
  }])

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

  if (result.year_compare && result.year_compare.year) {
    const yc = result.year_compare as CheckResult['year_compare'] & { year: number }
    addSheet(`${yc.year}年对比-新增`, (yc.new_farmers || []).map(r => ({
      '身份证号': r.id_card, '姓名': String(r.name), '说明': `${yc.year}年补贴新增`,
    })))
    addSheet(`${yc.year}年对比-减少`, (yc.removed_farmers || []).map(r => ({
      '身份证号': r.id_card, '姓名': r.name, '所在村': r.village, '说明': `${yc.year}年补贴减少`,
    })))
  }

  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0,10)}.xlsx`)
}

// ─── 下载导入模板 ───
function downloadTemplate() {
  const headers = ['姓名*', '身份证号*', '所在村*', '所在组*', '性别', '手机号', '银行卡号', '开户行', '土地面积(亩)', '备注']
  const example = [{ '姓名*': '张国强', '身份证号*': '510123196503154231', '所在村*': '红星村', '所在组*': '一组', '性别': '男', '手机号': '13812340001', '银行卡号': '', '开户行': '', '土地面积(亩)': 3.5, '备注': '' }]
  const ws = XLSX.utils.json_to_sheet(example, { header: headers })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '预检查模板')
  XLSX.writeFile(wb, '预检查数据模板.xlsx')
}

// ─── 主页面 ───
export default function PreCheckPage() {
  const { toast, show } = useToast()
  const [step, setStep]             = useState<'upload' | 'checking' | 'result'>('upload')
  const [rawRows, setRawRows]       = useState<CheckRow[]>([])
  const [fileName, setFileName]     = useState('')
  const [result, setResult]         = useState<CheckResult | null>(null)
  const [compareYear, setCompareYear] = useState<number | ''>('')
  const [activeTab, setActiveTab]   = useState<ActiveTab>('format')

  // ── 历史错误库 ──
  const [errorLib, setErrorLib]     = useState<ErrorLibEntry[]>([])
  const [libLoading, setLibLoading] = useState(false)
  const [libForm, setLibForm]       = useState({ id_card: '', real_name: '', error_reason: '' })
  const [libImportOpen, setLibImportOpen] = useState(false)
  const [matchHits, setMatchHits]   = useState<MatchHit[]>([])
  const [matchLoading, setMatchLoading] = useState(false)
  const [dragOver, setDragOver]     = useState(false)

  // 解析 Excel 文件
  const parseFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const wb = XLSX.read(e.target?.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      const rows = data.map((raw, i) => mapRow(raw, i + 2)) // 行号从2开始（1是表头）
      setRawRows(rows)
      setFileName(file.name)
      setStep('upload')
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  // 发送后端检查
  const runCheck = async () => {
    if (!rawRows.length) return show('请先上传 Excel 文件', 'err')
    setStep('checking')
    try {
      const res = await fetch('/api/precheck/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: rawRows,
          compare_year: compareYear || null,
        })
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail) }
      const data: CheckResult = await res.json()
      setResult(data)
      setStep('result')
      // 默认展示有数据的第一个 tab
      const tabs: ActiveTab[] = ['format','village','duplicate','gender','new','removed','changed','year']
      const counts: Record<ActiveTab, number> = {
        'error-lib': 0,   // 不参与自动跳转
        format: data.summary.format_errors, village: data.summary.village_errors,
        duplicate: data.summary.duplicate_errors, gender: data.summary.gender_mismatch,
        new: data.summary.new_farmers, removed: data.summary.removed_farmers,
        changed: data.summary.changed_farmers,
        year: data.year_compare && (data.year_compare as { new_count?: number }).new_count !== undefined ? 1 : 0,
      }
      setActiveTab(tabs.find(t => counts[t] > 0) || 'new')
    } catch (e: unknown) {
      show((e as Error).message, 'err')
      setStep('upload')
    }
  }

  const reset = () => { setStep('upload'); setRawRows([]); setResult(null); setFileName('') }

  // ─── 结果 tab 定义 ───
  const getTabs = (r: CheckResult) => {
    const yc = r.year_compare as { year?: number; new_count?: number; removed_count?: number }
    return [
      { id: 'error-lib' as ActiveTab,  label: '历史错误库', count: errorLib.length,            color: 'amber'  as const },
      { id: 'format' as ActiveTab,    label: '格式错误',   count: r.summary.format_errors,    color: 'red'    as const },
      { id: 'village' as ActiveTab,   label: '村组不存在', count: r.summary.village_errors,   color: 'red'    as const },
      { id: 'duplicate' as ActiveTab, label: '重复身份证', count: r.summary.duplicate_errors, color: 'amber'  as const },
      { id: 'gender' as ActiveTab,    label: '性别不符',   count: r.summary.gender_mismatch,  color: 'amber'  as const },
      { id: 'new' as ActiveTab,       label: '新增农户',   count: r.summary.new_farmers,      color: 'green'  as const },
      { id: 'removed' as ActiveTab,   label: '减少农户',   count: r.summary.removed_farmers,  color: 'blue'   as const },
      { id: 'changed' as ActiveTab,   label: '字段变更',   count: r.summary.changed_farmers,  color: 'purple' as const },
      ...(yc.year ? [{ id: 'year' as ActiveTab, label: `${yc.year}年对比`, count: (yc.new_count || 0) + (yc.removed_count || 0), color: 'blue' as const }] : []),
    ]
  }


  const loadErrorLib = async () => {
    setLibLoading(true)
    try {
      const r = await fetch('/api/precheck/error-library').then(r=>r.json()) as ErrorLibEntry[]
      setErrorLib(r)
    } finally { setLibLoading(false) }
  }

  const addToLib = async () => {
    if (!libForm.id_card || !libForm.real_name || !libForm.error_reason)
      return show('请填写完整信息', 'err')
    await fetch('/api/precheck/error-library', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(libForm)
    })
    show('✓ 已添加'); setLibForm({ id_card:'', real_name:'', error_reason:'' }); loadErrorLib()
  }

  const deleteFromLib = async (id: number) => {
    if (!confirm('确认删除？')) return
    await fetch(`/api/precheck/error-library/${id}`, { method:'DELETE' })
    loadErrorLib()
  }

  const runMatch = async () => {
    if (!result) return show('请先运行预检查', 'err')
    setMatchLoading(true)
    try {
      // 收集本次上传的所有人员
      const allRows: {id_card:string;real_name:string}[] = []
      const pushRows = (arr: {id_card:string;name:string}[]) => arr.forEach(r => allRows.push({id_card:r.id_card,real_name:r.name}))
      pushRows(result.format_errors.map(r=>({id_card:r.id_card,name:r.name})))
      pushRows(result.new_farmers.map(r=>({id_card:r.id_card,name:r.name})))
      result.changed_farmers.forEach(r=>allRows.push({id_card:r.id_card,real_name:r.name}))
      // 也加上全部年度对比中的新增
      if ((result.year_compare as {new_farmers?:{id_card:string;name:unknown}[]}).new_farmers) {
        const yc = result.year_compare as {new_farmers:{id_card:string;name:unknown}[]}
        yc.new_farmers.forEach(r=>allRows.push({id_card:r.id_card,real_name:String(r.name)}))
      }
      const res = await fetch('/api/precheck/error-library/match', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({rows:allRows})
      }).then(r=>r.json()) as {total:number;hits:MatchHit[]}
      setMatchHits(res.hits)
      if (res.hits.length === 0) show('✓ 无命中历史错误记录')
      else show(`⚠️ 命中 ${res.hits.length} 条历史错误`, 'err')
    } finally { setMatchLoading(false) }
  }

  const exportMatchHits = () => {
    if (matchHits.length === 0) return
    const rows = matchHits.map(h => ({
      '身份证号': h.id_card, '姓名': h.real_name,
      '库中姓名': h.library_name, '历史错误原因': h.error_reason
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [20,10,10,40].map(w=>({wch:w}))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '历史错误命中')
    XLSX.writeFile(wb, `历史错误命中_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.xlsx`)
  }

  const importErrorLib = async (rows: Record<string, unknown>[]) => {
    const toImport = rows.map(r => ({
      id_card:      String(r['身份证号*']||r['身份证号']||'').trim(),
      real_name:    String(r['姓名*']    ||r['姓名']    ||'').trim(),
      error_reason: String(r['错误原因*']||r['错误原因']||'').trim(),
    })).filter(r => r.id_card && r.real_name)
    const res = await fetch('/api/precheck/error-library/batch-import', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({rows:toImport})
    }).then(r=>r.json()) as {created:number}
    show(`✓ 导入 ${res.created} 条`); loadErrorLib()
    return {created:res.created, skipped:0, errors:[]}
  }

  const downloadLibTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['身份证号*','姓名*','错误原因*'],
      ['510123196503154231','张国强','2023年补贴重复申领，已处理'],
      ['510123197808224567','李秀英','身份证与人脸核验不符'],
    ])
    ws['!cols'] = [20,10,40].map(w=>({wch:w}))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '历史错误库模板')
    XLSX.writeFile(wb, '历史错误库导入模板.xlsx')
  }

  return (
    <div>
      {/* ── 上传区 ── */}
      {step !== 'result' && (
        <div className="grid grid-cols-[1fr_280px] gap-5">
          <div className="bg-white border border-stone-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-stone-700">上传待检查 Excel 文件</h3>
              <button onClick={downloadTemplate}
                className="text-xs text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg hover:bg-emerald-50">
                ↓ 下载数据模板
              </button>
            </div>

            {/* 拖拽上传区 */}
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors
                ${dragOver ? 'border-emerald-400 bg-emerald-50' : rawRows.length ? 'border-emerald-300 bg-emerald-50/40' : 'border-stone-200 hover:border-stone-300'}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => document.getElementById('precheck-file')?.click()}>
              {rawRows.length ? (
                <div>
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-stone-700 font-semibold">{fileName}</p>
                  <p className="text-stone-400 text-sm mt-1">已解析 <strong className="text-emerald-700">{rawRows.length}</strong> 行数据，点击可重新上传</p>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-3">📊</div>
                  <p className="text-stone-500 text-sm">拖拽 Excel 文件到这里，或点击选择</p>
                  <p className="text-stone-300 text-xs mt-1">支持 .xlsx / .xls</p>
                </div>
              )}
              <input id="precheck-file" type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = '' }} />
            </div>

            {/* 预览前5行 */}
            {rawRows.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-stone-400 mb-2">前5行预览（共 {rawRows.length} 行）：</p>
                <div className="border border-stone-100 rounded-lg overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50"><tr>
                      {['行号','姓名','身份证号','所在村','所在组','性别','手机号','土地面积'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-stone-400 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {rawRows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-t border-stone-50">
                          <td className="px-3 py-1.5 text-stone-400">{r.row_index}</td>
                          <td className="px-3 py-1.5">{r.real_name || <span className="text-red-400">空</span>}</td>
                          <td className="px-3 py-1.5 font-mono">{r.id_card || <span className="text-red-400">空</span>}</td>
                          <td className="px-3 py-1.5">{r.village_name || <span className="text-red-400">空</span>}</td>
                          <td className="px-3 py-1.5">{r.group_no || <span className="text-red-400">空</span>}</td>
                          <td className="px-3 py-1.5">{r.gender || '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{r.phone || '—'}</td>
                          <td className="px-3 py-1.5">{r.land_area ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
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
              <p>✓ 与数据库比对：新增/减少/变更</p>
              <p>✓ 土地面积合理性</p>
              {compareYear && <p>✓ 与 {compareYear} 年补贴数据对比</p>}
            </div>

            <button onClick={runCheck} disabled={!rawRows.length || step === 'checking'}
              className="w-full py-3 bg-emerald-700 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50 transition-colors">
              {step === 'checking' ? '检查中…' : `开始检查（${rawRows.length} 行）`}
            </button>
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
              { label: '新增农户',      val: result.summary.new_farmers,   color: 'text-emerald-700' },
              { label: '减少农户',      val: result.summary.removed_farmers, color: 'text-blue-600' },
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
            <button onClick={() => exportReport(result, fileName.replace(/\.(xlsx|xls)$/, ''))}
              className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
              ↓ 导出完整报告 Excel
            </button>
            <div className="ml-auto text-xs text-stone-400 flex items-center">
              文件：{fileName} · {result.summary.total_rows} 行
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
              const yc = result.year_compare as CheckResult['year_compare'] & { year: number }
              return (
                <div className="p-5">
                  <div className="flex gap-4 mb-5">
                    {[
                      { label: `${yc.year}年有补贴记录`, val: yc.db_count, color: 'text-stone-700' },
                      { label: '本次 Excel 行数',          val: yc.excel_count, color: 'text-stone-700' },
                      { label: '新增受益农户',              val: yc.new_count, color: 'text-emerald-700' },
                      { label: '减少受益农户',              val: yc.removed_count, color: 'text-blue-600' },
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

            {/* 历史错误库 Tab */}
            {activeTab === 'error-lib' && (
              <div className="space-y-4">
                {/* 与预检结果比对 */}
                {result && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-amber-800">与本次预检结果比对</span>
                      <div className="flex gap-2">
                        <button onClick={runMatch} disabled={matchLoading}
                          className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-60">
                          {matchLoading ? '比对中…' : '🔍 立即比对'}
                        </button>
                        {matchHits.length > 0 && (
                          <button onClick={exportMatchHits}
                            className="px-3 py-1.5 text-sm border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100">
                            ⬇️ 导出命中名单
                          </button>
                        )}
                      </div>
                    </div>
                    {matchHits.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-amber-700 font-semibold">命中 {matchHits.length} 条历史错误记录：</p>
                        <table className="w-full border-collapse text-sm">
                          <thead><tr className="border-b border-amber-200">
                            {['身份证号','本次姓名','库中姓名','历史错误原因'].map(h=>(
                              <th key={h} className="px-3 py-1.5 text-left text-xs text-amber-600 font-semibold">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {matchHits.map((h,i)=>(
                              <tr key={i} className="border-b border-amber-100 bg-white">
                                <td className="px-3 py-2 font-mono text-xs">{h.id_card}</td>
                                <td className="px-3 py-2 font-semibold">{h.real_name}</td>
                                <td className="px-3 py-2 text-stone-500">{h.library_name}</td>
                                <td className="px-3 py-2 text-red-600 text-xs">{h.error_reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-600 mt-1">点击「立即比对」，将本次预检人员与历史错误库交叉比对</p>
                    )}
                  </div>
                )}

                {/* 新增到错误库 */}
                <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 bg-stone-50 border-b border-stone-100 flex justify-between items-center">
                    <span className="font-semibold text-stone-700 text-sm">📚 历史错误库</span>
                    <div className="flex gap-2">
                      <button onClick={downloadLibTemplate}
                        className="text-xs border border-stone-200 text-stone-500 px-3 py-1.5 rounded-lg hover:bg-stone-50">
                        ⬇️ 下载导入模板
                      </button>
                      <label className="text-xs border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50 cursor-pointer">
                        ↑ 批量导入
                        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={async e=>{
                          if(!e.target.files?.[0]) return
                          const reader = new FileReader()
                          reader.onload = async(ev) => {
                            const XLSX2 = await import('xlsx')
                            const wb = XLSX2.read(ev.target?.result,{type:'array'})
                            const ws = wb.Sheets[wb.SheetNames[0]]
                            const rows = XLSX2.utils.sheet_to_json(ws,{defval:''}) as Record<string,unknown>[]
                            await importErrorLib(rows)
                          }
                          reader.readAsArrayBuffer(e.target.files[0])
                        }} />
                      </label>
                    </div>
                  </div>

                  {/* 手动新增 */}
                  <div className="p-4 border-b border-stone-100 bg-stone-50/50">
                    <p className="text-xs text-stone-400 mb-2">手动添加一条</p>
                    <div className="grid grid-cols-3 gap-2">
                      <input value={libForm.id_card} onChange={e=>setLibForm(f=>({...f,id_card:e.target.value}))}
                        placeholder="身份证号 *"
                        className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-400"/>
                      <input value={libForm.real_name} onChange={e=>setLibForm(f=>({...f,real_name:e.target.value}))}
                        placeholder="姓名 *"
                        className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-400"/>
                      <input value={libForm.error_reason} onChange={e=>setLibForm(f=>({...f,error_reason:e.target.value}))}
                        placeholder="错误原因 *"
                        className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-400"/>
                    </div>
                    <button onClick={addToLib}
                      className="mt-2 px-3 py-1.5 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
                      ＋ 添加
                    </button>
                  </div>

                  {/* 列表 */}
                  {libLoading ? <div className="py-8 text-center text-stone-300 text-sm">加载中…</div>
                    : errorLib.length === 0
                    ? <div className="py-10 text-center text-stone-300 text-sm">
                        <p>暂无历史错误记录</p>
                        <p className="text-xs mt-1">可手动添加或批量导入，下次预检时自动比对</p>
                      </div>
                    : <table className="w-full border-collapse">
                        <thead><tr className="bg-stone-50 border-b border-stone-200">
                          {['身份证号','姓名','错误原因','添加时间',''].map(h=>(
                            <th key={h} className="px-4 py-2.5 text-left text-xs text-stone-400 font-semibold">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {errorLib.map(e=>(
                            <tr key={e.id} className="border-b border-stone-50 hover:bg-stone-50">
                              <td className="px-4 py-2.5 text-xs font-mono text-amber-700">{e.id_card}</td>
                              <td className="px-4 py-2.5 text-sm font-semibold">{e.real_name}</td>
                              <td className="px-4 py-2.5 text-sm text-red-600">{e.error_reason}</td>
                              <td className="px-4 py-2.5 text-xs text-stone-300">{e.created_at?.slice(0,10)}</td>
                              <td className="px-4 py-2.5">
                                <button onClick={()=>deleteFromLib(e.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                  }
                </div>
              </div>
            )}

      <Toast {...toast} />
    </div>
  )
}

// ─── 通用结果表格 ───
function ResultTable({ title, headers, rows, empty }: {
  title: string
  headers: string[]
  rows: (string | number | React.ReactNode)[][]
  empty: boolean
}) {  return (
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
