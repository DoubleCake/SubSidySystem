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
    <div className="space-y-3">
      <Toast msg={toast?.msg} type={toast?.type} />

      {/* 页头 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold text-primary leading-tight">人员属性导入</h1>
          <div className="text-meta text-text-muted mt-1">按身份证号匹配已有人员，只修改人员状态、状态变更日期、死亡日期</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadTemplate}
            className="h-[30px] px-3 border border-border rounded-btn bg-white text-xs text-text-secondary hover:bg-warm/30 transition-colors">
            下载模板
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="h-[30px] px-3 border border-border rounded-btn bg-white text-xs text-text-primary hover:border-primary-500/30 transition-colors">
            {fileName ? '重新选择文件' : '选择 Excel 文件'}
          </button>
          <button onClick={handlePreview} disabled={loading || !mapping.id_card || rawRows.length === 0}
            className="h-[30px] px-3 ui-btn-primary text-xs disabled:opacity-50">
            {loading ? '预览中…' : '预览变更'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
        </div>
      </div>

      {/* 步骤条 */}
      <div className="flex items-center bg-white border border-border rounded-card px-4 py-2.5 text-[11.5px]">
        {[
          { n: 1, t: '选择文件', d: fileName || '支持 .xlsx / .xls' },
          { n: 2, t: '核对列映射', d: headers.length > 0 ? `已识别 ${headers.length} 列` : '上传后自动识别' },
          { n: 3, t: '预览并导入', d: '确认后写库' },
        ].map((s, i) => {
          const done = s.n === 1 ? !!fileName : s.n === 2 ? !!preview : !!result
          const active = s.n === 1 ? !fileName : s.n === 2 ? (!!fileName && !preview && !result) : (!!preview)
          return (
            <div key={s.n} className="flex items-center flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${done ? 'bg-[#2C6B52] text-white' : active ? 'bg-[#1A4D3A] text-[#F7F3E7]' : 'bg-[#F1EDE4] text-[#9A9588]'}`}>{s.n}</span>
                <div className="min-w-0">
                  <div className={`truncate ${active || done ? 'font-semibold text-text-primary' : 'text-text-muted'}`}>{s.t}</div>
                  <div className="text-[9.5px] text-text-muted truncate">{s.d}</div>
                </div>
              </div>
              {i < 2 && <div className="flex-1 h-px bg-border mx-3" />}
            </div>
          )
        })}
      </div>

      {/* 主体：左侧文件与预览，右侧规则与统计 */}
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-3">
        <div className="bg-white border border-border rounded-card flex flex-col overflow-hidden">
          {!fileName && (
            <button onClick={() => fileRef.current?.click()}
              className="m-4 py-14 border border-dashed border-border rounded-card flex flex-col items-center gap-2 text-text-muted hover:border-primary-500/40 hover:bg-[#FBFCFA] transition-colors">
              <span className="w-9 h-9 rounded-card bg-[#EDF3EF] text-primary flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" /><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>
              </span>
              <span className="text-xs">点击选择 Excel 文件，或拖入此处</span>
            </button>
          )}

          {fileName && (
            <div className="flex items-center gap-2.5 px-3.5 py-2 border-b border-[#F2EDE3]">
              <span className="w-6 h-6 rounded-[4px] bg-[#EDF3EF] text-primary flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 4h10l6 6v10H4z" /><path d="M14 4v6h6" /></svg>
              </span>
              <div className="min-w-0">
                <div className="text-[11.5px] font-semibold truncate">{fileName}</div>
                <div className="text-[9.5px] text-text-muted">Sheet1 · {rawRows.length} 行 · 读取完成</div>
              </div>
              <div className="ml-auto flex items-center gap-3 text-[10.5px]">
                <button onClick={reset} className="text-text-muted hover:text-primary">清空</button>
                <button onClick={handlePreview} disabled={loading || !mapping.id_card}
                  className="text-primary font-semibold disabled:opacity-40">预览</button>
              </div>
            </div>
          )}

          {headers.length > 0 && (
            <div className="px-3.5 py-2.5 border-b border-[#F2EDE3]">
              <div className="text-[11.5px] font-semibold mb-2">列映射</div>
              <div className="grid grid-cols-3 gap-2">
                {FIELD_DEFS.map(def => (
                  <div key={def.key}>
                    <label className="block text-[9.5px] text-text-muted mb-1">
                      {def.label}{def.required ? <span className="text-danger"> *</span> : ''}
                    </label>
                    <select value={mapping[def.key] || ''}
                      onChange={e => { setMapping(m => ({ ...m, [def.key]: e.target.value })); setPreview(null) }}
                      className={`w-full h-7 border rounded-btn px-2 text-[10.5px] outline-none bg-white transition-colors ${mapping[def.key] ? 'border-[#9FBDB0] text-text-primary' : 'border-border text-[#B9B3A4]'} focus:border-primary-500`}>
                      <option value="">（不导入）</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview && (
            <div className="flex items-center gap-2.5 px-3.5 py-1.5 border-b border-[#F2EDE3] bg-[#FBF8F1] text-[10.5px]">
              <span className="font-semibold text-text-primary">预览</span>
              <span className="text-[#2C6B52]">可更新 {preview.summary.update}</span>
              <span className="text-text-muted">跳过 {preview.summary.skip}</span>
              <span className="text-danger">问题 {preview.summary.error}</span>
              <div className="ml-auto flex gap-1">
                {(['all', 'update', 'skip', 'error'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-2 py-[2px] rounded-full text-[9.5px] border transition-colors ${filter === f ? 'bg-primary text-[#F7F3E7] border-primary' : 'bg-white border-border text-text-muted hover:border-primary/30'}`}>
                    {f === 'all' ? '全部' : f === 'update' ? '更新' : f === 'skip' ? '跳过' : '问题'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {preview ? (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full border-collapse text-[10.5px]">
                <thead className="sticky top-0">
                  <tr className="bg-[#F6F1E7] text-text-muted text-[9.5px] text-left">
                    <th className="font-medium px-3 py-1.5">行</th>
                    <th className="font-medium px-1.5 py-1.5">身份证号</th>
                    <th className="font-medium px-1.5 py-1.5">输入姓名</th>
                    <th className="font-medium px-1.5 py-1.5">系统姓名</th>
                    <th className="font-medium px-1.5 py-1.5">状态</th>
                    <th className="font-medium px-1.5 py-1.5">状态日期</th>
                    <th className="font-medium px-1.5 py-1.5">死亡日期</th>
                    <th className="font-medium px-1.5 py-1.5">结果</th>
                    <th className="font-medium px-3 py-1.5">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map(it => (
                    <tr key={it.row_index} className={`border-t border-[#F2EDE3] ${it.action === 'error' ? 'bg-[#FDF7F5]' : ''}`}>
                      <td className="px-3 py-1.5 text-text-muted">{it.row_index}</td>
                      <td className="px-1.5 py-1.5 font-mono text-text-secondary">{it.id_card_masked || '—'}</td>
                      <td className="px-1.5 py-1.5">{it.input_name || '—'}</td>
                      <td className={`px-1.5 py-1.5 ${it.db_name && it.input_name && it.db_name !== it.input_name ? 'text-danger font-semibold' : ''}`}>
                        {it.db_name || '—'}
                      </td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap">
                        {statusText(it.current.farmer_status)}
                        {it.action === 'update' && it.next.farmer_status !== it.current.farmer_status && (
                          <span className="text-primary"> → {statusText(it.next.farmer_status)}</span>
                        )}
                      </td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap">{dateText(it.next.status_date ?? it.current.status_date)}</td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap">{dateText(it.next.death_date ?? it.current.death_date)}</td>
                      <td className="px-1.5 py-1.5">{actionBadge(it.action)}</td>
                      <td className={`px-3 py-1.5 ${it.action === 'error' ? 'text-danger' : 'text-text-muted'}`}>
                        {it.messages.join('；') || '—'}
                      </td>
                    </tr>
                  ))}
                  {visibleItems.length === 0 && (
                    <tr><td colSpan={9} className="py-8 text-center text-text-muted">该分类下没有记录</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : fileName ? (
            <div className="py-10 text-center text-[11px] text-text-muted">核对列映射后点击「预览」，预览不会修改数据库</div>
          ) : null}

          {result && (
            <div className="px-3.5 py-2.5 border-t border-[#F2EDE3]">
              <div className="flex items-center gap-3 text-[11px]">
                <span className="font-semibold">导入结果</span>
                <span className="text-[#2C6B52]">更新 {result.updated} 条</span>
                <span className="text-text-muted">跳过 {result.skipped} 条</span>
                <span className="text-danger">问题 {result.error_count} 条</span>
                <button onClick={reset} className="ml-auto text-[10.5px] text-text-muted hover:text-primary">再导入一批</button>
              </div>
              {result.errors.length > 0 && (
                <div className="mt-2 border border-[#E8C9C2] bg-[#FDF7F5] rounded-btn p-2 text-[10px] text-[#A6402E] max-h-28 overflow-y-auto">
                  <div className="font-semibold mb-1">未导入的问题记录</div>
                  <ul className="space-y-0.5">
                    {result.errors.map(e => (
                      <li key={e.row_index}>第 {e.row_index} 行 · {e.id_card_masked || '无身份证'} · 输入「{e.input_name || '—'}」/ 系统「{e.db_name || '—'}」：{e.messages.join('；')}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {preview && (
            <div className="flex items-center justify-between px-3.5 py-2 border-t border-border mt-auto">
              <span className="text-[10px] text-text-muted">姓名不一致、日期非法等 {preview.summary.error} 条问题记录会被跳过，不覆盖任何数据</span>
              <div className="flex gap-1.5">
                <button onClick={() => setPreview(null)} className="h-7 px-2.5 border border-border rounded-btn text-[11px] text-text-secondary hover:bg-warm/30">取消</button>
                <button onClick={handleApply} disabled={applying || preview.summary.update === 0}
                  className="h-7 px-3 ui-btn-primary text-[11px] disabled:opacity-50">
                  {applying ? '导入中…' : `确认导入 ${preview.summary.update} 条`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧 */}
        <div className="flex flex-col gap-2.5">
          <div className="bg-[#FBF8F0] border border-[#E8DCC2] rounded-card px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#6B5322]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A6620" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.1" /></svg>
              导入规则
            </div>
            <ul className="mt-1.5 pl-4 list-disc text-[10px] leading-relaxed text-[#6B5322]">
              <li>只按身份证号匹配已有人员，不自动建档</li>
              <li>姓名只做核对，不一致的行展示并跳过</li>
              <li>只修改状态、状态日期、死亡日期</li>
              <li>重复导入相同数据自动跳过</li>
            </ul>
          </div>

          <div className="bg-white border border-border rounded-card px-3.5 py-2.5">
            <div className="text-[11.5px] font-bold mb-1.5">本批统计</div>
            <div className="flex flex-col gap-1 text-[10.5px]">
              <div className="flex justify-between"><span className="text-text-secondary">文件总行数</span><span className="font-mono">{rawRows.length}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">可更新</span><span className="font-mono text-[#2C6B52]">{preview?.summary.update ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">无变化跳过</span><span className="font-mono">{preview?.summary.skip ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">问题记录</span><span className="font-mono text-danger">{preview?.summary.error ?? '—'}</span></div>
              <div className="flex justify-between border-t border-[#F2EDE3] pt-1.5"><b>预计写入事件</b><b className="font-mono">{preview?.summary.update ?? 0} 条</b></div>
            </div>
          </div>

          <div className="bg-white border border-border rounded-card px-3.5 py-2.5 flex-1">
            <div className="text-[11.5px] font-bold mb-1.5">字段说明</div>
            <div className="flex flex-col gap-1 text-[10px] text-text-secondary">
              <div><b className="text-text-primary">人员状态</b>：在册 / 注销 / 迁出 / 死亡</div>
              <div><b className="text-text-primary">状态变更日期</b>：该状态生效的日期</div>
              <div><b className="text-text-primary">死亡日期</b>：仅死亡状态需要填写</div>
            </div>
            <div className="mt-2 pt-1.5 border-t border-dashed border-border text-[9.5px] text-text-muted">
              系统不存在的身份证号不会被自动建档；如需新增人员请在户籍管理中操作。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}