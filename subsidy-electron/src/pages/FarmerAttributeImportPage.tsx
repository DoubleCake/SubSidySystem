/**
 * 人员基本属性导入
 * 规则：按身份证号匹配；姓名不一致的行展示出来并跳过；只改状态/状态日期/死亡日期。
 */
import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'

type ApiRes<T> = { code: number; data?: T; message?: string }

type Action = 'update' | 'skip' | 'error'

interface PreviewItem {
  row_index: number
  id_card_masked: string
  input_name: string
  db_name?: string
  current: { farmer_status?: number; status_date?: string | null; death_date?: string | null }
  next: { farmer_status?: number; status_date?: string | null; death_date?: string | null }
  action: Action
  messages: string[]
}

interface PreviewData {
  total: number
  summary: { update: number; skip: number; error: number }
  items: PreviewItem[]
}

interface ApplyResult {
  total: number
  updated: number
  skipped: number
  error_count: number
  errors: PreviewItem[]
  message: string
}

const STATUS_LABEL: Record<number, string> = { 1: '在册', 2: '注销', 3: '迁出', 4: '死亡' }

const FIELD_DEFS: Array<{ key: string; label: string; required?: boolean; aliases: string[] }> = [
  { key: 'id_card', label: '身份证号', required: true, aliases: ['身份证号', '身份证', '证件号', '公民身份号码'] },
  { key: 'real_name', label: '姓名', aliases: ['姓名', '名字'] },
  { key: 'farmer_status', label: '人员状态', aliases: ['人员状态', '状态', '存活状态'] },
  { key: 'status_date', label: '状态变更日期', aliases: ['状态变更日期', '状态日期', '变更日期'] },
  { key: 'death_date', label: '死亡日期', aliases: ['死亡日期', '死亡时间', '去世日期', '身故日期'] },
  { key: 'remark', label: '备注', aliases: ['备注', '说明'] },
]

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const statusText = (v?: number) => (v == null ? '—' : STATUS_LABEL[v] || String(v))
const dateText = (v?: string | null) => (v ? v : '—')

export default function FarmerAttributeImportPage() {
  const { toast, show } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [filter, setFilter] = useState<'all' | Action>('all')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const mappedRows = useMemo(() => {
    return rawRows.map(row => {
      const out: Record<string, unknown> = {}
      for (const def of FIELD_DEFS) {
        const header = mapping[def.key]
        if (!header) continue
        let v = row[header]
        if (v instanceof Date) v = fmtDate(v)
        // 身份证号若被 Excel 存成数字，保留数字交给后端给出明确提示（避免精度丢失后静默匹配失败）
        if (def.key === 'id_card' && typeof v === 'number') { out[def.key] = v; continue }
        out[def.key] = v == null ? '' : String(v).trim()
      }
      return out
    })
  }, [rawRows, mapping])

  const reset = () => {
    setFileName(''); setHeaders([]); setRawRows([]); setMapping({})
    setPreview(null); setResult(null); setFilter('all')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true })
        if (rows.length === 0) { show('Excel 为空', 'err'); return }

        const hdrs = Object.keys(rows[0])
        const nextMapping: Record<string, string> = {}
        for (const def of FIELD_DEFS) {
          // 先精确匹配，再模糊匹配；状态列不能被“状态变更日期”抢走
          const exact = hdrs.find(h => def.aliases.includes(h))
          const fuzzy = hdrs.find(h =>
            def.aliases.some(a => h.includes(a)) &&
            !(def.key === 'farmer_status' && (h.includes('日期') || h.includes('时间')))
          )
          nextMapping[def.key] = exact || fuzzy || ''
        }

        setFileName(file.name)
        setHeaders(hdrs)
        setRawRows(rows)
        setMapping(nextMapping)
        setPreview(null)
        setResult(null)
        show(`已读取 ${rows.length} 行，请核对列映射后预览`)
      } catch (err) {
        show('读取 Excel 失败：' + (err as Error).message, 'err')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handlePreview = async () => {
    if (!mapping.id_card) return show('请先选择身份证号列', 'err')
    if (mappedRows.length === 0) return show('没有可导入的数据', 'err')

    setLoading(true)
    setResult(null)
    try {
      const res = await window.electronAPI.invoke<ApiRes<PreviewData>>(
        'farmers:previewAttributeImport', { rows: mappedRows }
      )
      if (res?.code !== 0 || !res.data) throw new Error(res?.message || '预览失败')
      setPreview(res.data)
      setFilter(res.data.summary.error > 0 ? 'error' : 'all')
      show(`预览完成：可更新 ${res.data.summary.update} 条，跳过 ${res.data.summary.skip} 条，问题 ${res.data.summary.error} 条`)
    } catch (err) {
      show((err as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }

  const handleApply = async () => {
    if (!preview || preview.summary.update === 0) return show('没有可更新的记录', 'err')
    if (!window.confirm(`将更新 ${preview.summary.update} 条人员状态/日期，确认导入？\n\n姓名不一致、日期非法等 ${preview.summary.error} 条问题记录会被跳过。`)) return

    setApplying(true)
    try {
      const res = await window.electronAPI.invoke<ApiRes<ApplyResult>>(
        'farmers:applyAttributeImport', { rows: mappedRows, file_name: fileName || '人员属性导入' }
      )
      if (res?.code !== 0 || !res.data) throw new Error(res?.message || '导入失败')
      setResult(res.data)
      setPreview(null)
      show('✓ ' + res.data.message)
    } catch (err) {
      show((err as Error).message, 'err')
    } finally {
      setApplying(false)
    }
  }

  const downloadTemplate = () => {
    const headers = ['身份证号', '姓名', '人员状态', '状态变更日期', '死亡日期', '备注']
    const ws = XLSX.utils.aoa_to_sheet([
      headers,
      ['510123196503154231', '张三', '死亡', '2026-03-01', '2026-03-01', '示例行，可删除'],
    ])
    ws['!cols'] = headers.map(() => ({ wch: 18 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '人员属性导入')
    XLSX.writeFile(wb, '人员属性导入模板.xlsx')
  }

  const visibleItems = (preview?.items || []).filter(it => filter === 'all' || it.action === filter)

  const actionBadge = (a: Action) => {
    if (a === 'update') return <span className="px-2 py-0.5 rounded text-xs bg-primary-500/10 text-primary">更新</span>
    if (a === 'skip') return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500">跳过</span>
    return <span className="px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">问题</span>
  }

  return (
    <div className="space-y-5">
      <Toast msg={toast?.msg} type={toast?.type} />

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-primary leading-tight">人员属性导入</h1>
          <div className="text-meta text-text-muted mt-1">按身份证号匹配已有人员，只修改人员状态、状态变更日期、死亡日期</div>
        </div>
        <div className="text-meta text-text-muted">姓名不一致的行会展示并跳过</div>
      </div>

      <div className="bg-white border border-border rounded-card p-5">
        <ul className="text-xs text-text-muted space-y-1 list-disc pl-5">
          <li>姓名仅用于核对：与系统姓名不一致的行会展示出来，并跳过、不覆盖任何数据。</li>
          <li>系统中不存在该身份证号的行不会自动建档。</li>
          <li>重复导入相同数据会自动跳过，不会产生重复记录。</li>
        </ul>
      </div>

      <div className="bg-white border border-border rounded-card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-primary-500 text-white rounded-btn text-sm hover:bg-primary-600">
            选择 Excel 文件
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          <button onClick={downloadTemplate}
            className="px-3 py-2 border border-border rounded-btn text-sm text-text-secondary hover:bg-warm/30">
            下载模板
          </button>
          {fileName && <span className="text-sm text-text-muted">{fileName}（{rawRows.length} 行）</span>}
          {(rawRows.length > 0 || preview || result) && (
            <button onClick={reset} className="text-xs text-text-muted hover:text-red-500 ml-auto">清空</button>
          )}
        </div>

        {headers.length > 0 && (
          <div>
            <div className="text-sm font-semibold text-text-primary mb-2">列映射</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {FIELD_DEFS.map(def => (
                <div key={def.key}>
                  <label className="block text-xs text-text-muted mb-1">
                    {def.label}{def.required ? ' *' : ''}
                  </label>
                  <select
                    value={mapping[def.key] || ''}
                    onChange={e => { setMapping(m => ({ ...m, [def.key]: e.target.value })); setPreview(null) }}
                    className="w-full border border-border rounded-btn px-2.5 py-2 text-sm bg-white outline-none focus:border-primary-500">
                    <option value="">（不导入）</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={handlePreview} disabled={loading || !mapping.id_card}
                className="px-4 py-2 bg-primary-500 text-white rounded-btn text-sm hover:bg-primary-600 disabled:opacity-50">
                {loading ? '预览中…' : '预览变更'}
              </button>
              <span className="text-xs text-text-muted">预览不会修改数据库</span>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div className="bg-white border border-border rounded-card p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-sm font-semibold text-text-primary">预览结果</div>
            <span className="text-xs text-primary">可更新 {preview.summary.update}</span>
            <span className="text-xs text-text-muted">跳过 {preview.summary.skip}</span>
            <span className="text-xs text-red-600">问题 {preview.summary.error}</span>
            <div className="ml-auto flex gap-1">
              {(['all', 'update', 'skip', 'error'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded text-xs ${filter === f ? 'bg-primary-500 text-white' : 'bg-warm/40 text-text-muted hover:bg-warm/70'}`}>
                  {f === 'all' ? '全部' : f === 'update' ? '更新' : f === 'skip' ? '跳过' : '问题'}
                </button>
              ))}
            </div>
            {preview.summary.update > 0 && (
              <button onClick={handleApply} disabled={applying}
                className="px-4 py-2 bg-red-500 text-white rounded-btn text-sm hover:bg-red-600 disabled:opacity-50">
                {applying ? '导入中…' : `确认导入 ${preview.summary.update} 条`}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border">
                  <th className="text-left py-2 px-2">行</th>
                  <th className="text-left py-2 px-2">身份证号</th>
                  <th className="text-left py-2 px-2">输入姓名</th>
                  <th className="text-left py-2 px-2">系统姓名</th>
                  <th className="text-left py-2 px-2">状态</th>
                  <th className="text-left py-2 px-2">状态日期</th>
                  <th className="text-left py-2 px-2">死亡日期</th>
                  <th className="text-left py-2 px-2">结果</th>
                  <th className="text-left py-2 px-2">说明</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(it => (
                  <tr key={it.row_index} className={`border-b border-border/60 ${it.action === 'error' ? 'bg-red-50/40' : ''}`}>
                    <td className="py-2 px-2 text-text-muted">{it.row_index}</td>
                    <td className="py-2 px-2 font-mono">{it.id_card_masked || '—'}</td>
                    <td className="py-2 px-2">{it.input_name || '—'}</td>
                    <td className={`py-2 px-2 ${it.db_name && it.input_name && it.db_name !== it.input_name ? 'text-red-600 font-medium' : ''}`}>
                      {it.db_name || '—'}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      {statusText(it.current.farmer_status)}
                      {it.action === 'update' && it.next.farmer_status !== it.current.farmer_status && (
                        <span className="text-primary"> → {statusText(it.next.farmer_status)}</span>
                      )}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">{dateText(it.next.status_date ?? it.current.status_date)}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{dateText(it.next.death_date ?? it.current.death_date)}</td>
                    <td className="py-2 px-2">{actionBadge(it.action)}</td>
                    <td className={`py-2 px-2 ${it.action === 'error' ? 'text-red-600' : 'text-text-muted'}`}>
                      {it.messages.join('；') || '—'}
                    </td>
                  </tr>
                ))}
                {visibleItems.length === 0 && (
                  <tr><td colSpan={9} className="py-6 text-center text-text-muted">该分类下没有记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-white border border-border rounded-card p-5 space-y-3">
          <div className="text-sm font-semibold text-text-primary">导入结果</div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-primary">更新 {result.updated} 条</span>
            <span className="text-text-muted">跳过 {result.skipped} 条</span>
            <span className="text-red-600">问题 {result.error_count} 条</span>
          </div>
          {result.errors.length > 0 && (
            <div className="border border-red-100 bg-red-50/50 rounded-btn p-3">
              <div className="text-xs font-semibold text-red-600 mb-2">未导入的问题记录</div>
              <ul className="space-y-1 text-xs text-red-700">
                {result.errors.map(e => (
                  <li key={e.row_index}>
                    第 {e.row_index} 行 · {e.id_card_masked || '无身份证'} · 输入「{e.input_name || '—'}」/ 系统「{e.db_name || '—'}」：{e.messages.join('；')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
