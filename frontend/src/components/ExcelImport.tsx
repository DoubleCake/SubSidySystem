import { useState, useCallback } from 'react'
import * as XLSX from 'xlsx'
import Modal from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  templateHeaders: string[]
  templateExample: Record<string, unknown>[]
  onImport: (rows: Record<string, unknown>[]) => Promise<{ created: number; skipped: number; errors: string[] }>
  onSuccess: () => void
}

type Step = 'upload' | 'preview' | 'result'

export default function ExcelImport({ open, onClose, title, templateHeaders, templateExample, onImport, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const reset = () => { setStep('upload'); setRows([]); setResult(null) }
  const handleClose = () => { reset(); onClose() }

  const parseFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const wb = XLSX.read(e.target?.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      setRows(data)
      setStep('preview')
    }
    reader.readAsArrayBuffer(file)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }, [])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet(templateExample, { header: templateHeaders })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '导入模板')
    XLSX.writeFile(wb, `${title}导入模板.xlsx`)
  }

  const handleConfirm = async () => {
    setLoading(true)
    try {
      const res = await onImport(rows)
      setResult(res)
      setStep('result')
      if (res.created > 0) onSuccess()
    } catch (e: unknown) {
      const err = e as Error
      setResult({ created: 0, skipped: 0, errors: [err.message] })
      setStep('result')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} title={`Excel批量导入 · ${title}`} onClose={handleClose} width={680}
      onConfirm={step === 'preview' ? handleConfirm : undefined}
      confirmText={loading ? '导入中…' : `确认导入 ${rows.length} 条`}>

      {/* 步骤指示 */}
      <div className="flex items-center gap-2 mb-5">
        {(['upload', 'preview', 'result'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-stone-200" />}
            <div className={`flex items-center gap-1.5 text-xs font-medium
              ${step === s ? 'text-emerald-700' : steps.indexOf(step) > i ? 'text-stone-400' : 'text-stone-300'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs
                ${step === s ? 'bg-emerald-700 text-white' : steps.indexOf(step) > i ? 'bg-stone-200 text-stone-400' : 'bg-stone-100 text-stone-300'}`}>
                {i + 1}
              </div>
              {['上传文件', '预览确认', '导入结果'][i]}
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: 上传 */}
      {step === 'upload' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-stone-500">请按模板格式准备 Excel 文件（.xlsx / .xls）</p>
            <button onClick={downloadTemplate}
              className="text-xs text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg hover:bg-emerald-50 flex items-center gap-1">
              ↓ 下载模板
            </button>
          </div>

          {/* 模板字段说明 */}
          <div className="bg-stone-50 border border-stone-100 rounded-lg p-3 mb-4">
            <p className="text-xs text-stone-500 mb-2 font-medium">必需列（标 * 为必填）：</p>
            <div className="flex flex-wrap gap-1.5">
              {templateHeaders.map(h => (
                <span key={h} className="text-xs bg-white border border-stone-200 px-2 py-0.5 rounded font-mono text-stone-600">{h}</span>
              ))}
            </div>
          </div>

          {/* 拖拽区 */}
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-stone-200 hover:border-stone-300'}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('xlsx-input')?.click()}>
            <div className="text-4xl mb-3">📊</div>
            <p className="text-stone-500 text-sm">拖拽 Excel 文件到这里，或点击选择文件</p>
            <p className="text-stone-300 text-xs mt-1">支持 .xlsx / .xls</p>
            <input id="xlsx-input" type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
          </div>
        </div>
      )}

      {/* Step 2: 预览 */}
      {step === 'preview' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-stone-600">共解析 <strong className="text-emerald-700">{rows.length}</strong> 行数据，请确认后导入</p>
            <button onClick={reset} className="text-xs text-stone-400 hover:text-stone-600">← 重新上传</button>
          </div>
          <div className="border border-stone-200 rounded-lg overflow-auto max-h-64">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-stone-50 sticky top-0">
                <tr>
                  {Object.keys(rows[0] || {}).slice(0, 8).map(k => (
                    <th key={k} className="px-3 py-2 text-left text-stone-400 font-semibold border-b border-stone-200 whitespace-nowrap">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((row, i) => (
                  <tr key={i} className="border-b border-stone-50 hover:bg-stone-50">
                    {Object.values(row).slice(0, 8).map((v, j) => (
                      <td key={j} className="px-3 py-1.5 text-stone-600 whitespace-nowrap font-mono">{String(v ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 20 && <p className="text-xs text-stone-400 mt-2">仅展示前20行，共{rows.length}行</p>}
        </div>
      )}

      {/* Step 3: 结果 */}
      {step === 'result' && result && (
        <div className="text-center py-4">
          <div className="text-5xl mb-4">{result.errors.length === 0 ? '✅' : '⚠️'}</div>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-emerald-50 rounded-xl p-4">
              <div className="text-2xl font-bold text-emerald-700">{result.created}</div>
              <div className="text-xs text-stone-500 mt-1">成功导入</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-4">
              <div className="text-2xl font-bold text-amber-600">{result.skipped}</div>
              <div className="text-xs text-stone-500 mt-1">跳过（重复）</div>
            </div>
            <div className="bg-red-50 rounded-xl p-4">
              <div className="text-2xl font-bold text-red-500">{result.errors.length}</div>
              <div className="text-xs text-stone-500 mt-1">导入失败</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-left max-h-40 overflow-y-auto">
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 mb-1">• {e}</p>
              ))}
            </div>
          )}
          <button onClick={handleClose} className="mt-4 px-6 py-2 bg-emerald-700 text-white rounded-lg text-sm hover:bg-emerald-600">完成</button>
        </div>
      )}
    </Modal>
  )
}

const steps: Step[] = ['upload', 'preview', 'result']
