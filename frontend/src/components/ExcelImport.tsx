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

type Step = 'upload' | 'preview' | 'importing' | 'result'
const steps: Step[] = ['upload', 'preview', 'importing', 'result']

export default function ExcelImport({ open, onClose, title, templateHeaders, templateExample, onImport, onSuccess }: Props) {
  const [step, setStep]       = useState<Step>('upload')
  const [rows, setRows]       = useState<Record<string, unknown>[]>([])
  const [result, setResult]   = useState<{ created: number; skipped: number; errors: string[] } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // 进度条状态
  const [progress, setProgress] = useState(0)      // 0-100
  const [progressMsg, setProgressMsg] = useState('')

  const reset = () => { setStep('upload'); setRows([]); setResult(null); setProgress(0); setProgressMsg('') }
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
    ws['!cols'] = templateHeaders.map(() => ({ wch: 18 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '导入模板')
    XLSX.writeFile(wb, `${title}导入模板.xlsx`)
  }

  const handleConfirm = async () => {
    setStep('importing')
    setProgress(5)
    setProgressMsg(`准备导入 ${rows.length} 条记录…`)

    // 模拟进度：每100ms涨一点，直到90%等后端返回
    let fake = 5
    const ticker = setInterval(() => {
      fake = Math.min(fake + (90 - fake) * 0.08, 88)
      setProgress(Math.round(fake))
      if (fake < 30) setProgressMsg(`正在校验数据…`)
      else if (fake < 60) setProgressMsg(`正在写入数据库…`)
      else setProgressMsg(`即将完成，请稍候…`)
    }, 200)

    try {
      const res = await onImport(rows)
      clearInterval(ticker)
      setProgress(100)
      setProgressMsg('导入完成！')
      await new Promise(r => setTimeout(r, 400)) // 让进度条显示100%
      setResult(res)
      setStep('result')
      if (res.created > 0) onSuccess()
    } catch (e: unknown) {
      clearInterval(ticker)
      const err = e as Error
      setResult({ created: 0, skipped: 0, errors: [err.message] })
      setStep('result')
    }
  }

  // 步骤标签（importing 时显示为第3步）
  const displayStep = step === 'importing' ? 'importing' : step
  const stepLabels = [
    { key: 'upload',    label: '上传文件' },
    { key: 'preview',   label: '预览确认' },
    { key: 'importing', label: '导入中' },
    { key: 'result',    label: '导入结果' },
  ]

  const confirmText = step === 'preview'
    ? `确认导入 ${rows.length} 条`
    : undefined

  return (
    <Modal open={open} title={`Excel批量导入 · ${title}`} onClose={handleClose} width={680}
      onConfirm={step === 'preview' ? handleConfirm : undefined}
      confirmText={confirmText}>

      {/* 步骤指示 */}
      <div className="flex items-center gap-2 mb-5">
        {stepLabels.map((s, i) => {
          const curIdx  = stepLabels.findIndex(x => x.key === displayStep)
          const isPast  = i < curIdx
          const isCur   = i === curIdx
          return (
            <div key={s.key} className="flex items-center gap-2">
              {i > 0 && <div className={`w-8 h-px transition-colors ${isPast || isCur ? 'bg-emerald-300' : 'bg-stone-200'}`} />}
              <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors
                ${isCur ? 'text-primary' : isPast ? 'text-text-muted' : 'text-text-muted/50'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs transition-colors
                  ${isCur ? 'bg-primary text-white' : isPast ? 'bg-emerald-100 text-primary' : 'bg-warm/30 text-text-muted/50'}`}>
                  {isPast ? '✓' : i + 1}
                </div>
                {s.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Step 1: 上传 */}
      {step === 'upload' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-text-muted">请按模板格式准备 Excel 文件（.xlsx / .xls）</p>
            <button onClick={downloadTemplate}
              className="text-xs text-primary border border-primary/20 px-3 py-1.5 rounded-btn hover:bg-primary/5 flex items-center gap-1">
              ↓ 下载模板
            </button>
          </div>
          <div className="bg-warm/30 border border-border/50 rounded-btn p-3 mb-4">
            <p className="text-xs text-text-muted mb-2 font-medium">必需列（标 * 为必填）：</p>
            <div className="flex flex-wrap gap-1.5">
              {templateHeaders.map(h => (
                <span key={h} className={`text-xs border px-2 py-0.5 rounded font-mono
                  ${h.includes('*') ? 'bg-primary/5 border-primary/20 text-primary' : 'bg-white border-border text-text-muted'}`}>
                  {h}
                </span>
              ))}
            </div>
          </div>
          <div
            className={`border-2 border-dashed rounded-card p-10 text-center cursor-pointer transition-colors
              ${dragOver ? 'border-emerald-400 bg-primary/5' : 'border-border hover:border-border hover:bg-warm/30'}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('xlsx-input')?.click()}>
            <div className="text-4xl mb-3">📊</div>
            <p className="text-text-muted text-sm">拖拽 Excel 文件到这里，或点击选择文件</p>
            <p className="text-text-muted/50 text-xs mt-1">支持 .xlsx / .xls</p>
            <input id="xlsx-input" type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
          </div>
        </div>
      )}

      {/* Step 2: 预览 */}
      {step === 'preview' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-text-primary">共解析 <strong className="text-primary">{rows.length}</strong> 行，请确认后导入</p>
            <button onClick={reset} className="text-xs text-text-muted hover:text-text-primary">← 重新上传</button>
          </div>
          {rows.length > 500 && (
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded-btn px-3 py-2 text-xs text-amber-700">
              ⏱ 本次导入 {rows.length} 条记录，数据量较大，预计需要等待 {Math.ceil(rows.length / 100)} 秒，请耐心等待
            </div>
          )}
          <div className="border border-border rounded-btn overflow-auto max-h-64">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-warm/30 sticky top-0">
                <tr>
                  {Object.keys(rows[0] || {}).slice(0, 8).map(k => (
                    <th key={k} className="px-3 py-2 text-left text-text-muted font-semibold border-b border-border whitespace-nowrap">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 30).map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-warm/30">
                    {Object.values(row).slice(0, 8).map((v, j) => (
                      <td key={j} className="px-3 py-1.5 text-text-primary whitespace-nowrap font-mono">{String(v ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 30 && <p className="text-xs text-text-muted mt-2">预览前30行，共{rows.length}行数据</p>}
        </div>
      )}

      {/* Step 3: 进度条 */}
      {step === 'importing' && (
        <div className="py-6">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">⏳</div>
            <p className="text-text-primary text-sm font-medium">{progressMsg}</p>
            <p className="text-text-muted text-xs mt-1">正在处理 {rows.length} 条记录，请勿关闭页面</p>
          </div>

          {/* 主进度条 */}
          <div className="bg-warm/30 rounded-full h-4 overflow-hidden mb-3 shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300 ease-out relative overflow-hidden"
              style={{ width: `${progress}%` }}>
              {/* 光泽动画 */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse" />
            </div>
          </div>
          <div className="flex justify-between items-center text-xs text-text-muted">
            <span>{progressMsg.includes('完成') ? '✅ 完成' : '处理中…'}</span>
            <span className="font-mono font-bold text-primary">{progress}%</span>
          </div>

          {/* 分段状态指示 */}
          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              { label: '数据校验', threshold: 30 },
              { label: '写入数据库', threshold: 60 },
              { label: '完成确认', threshold: 95 },
            ].map(stage => (
              <div key={stage.label} className={`text-center py-2 rounded-btn text-xs transition-colors
                ${progress >= stage.threshold
                  ? 'bg-primary/5 text-primary border border-primary/20'
                  : 'bg-warm/30 text-text-muted/50 border border-border/50'}`}>
                {progress >= stage.threshold ? '✓ ' : ''}{stage.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 4: 结果 */}
      {step === 'result' && result && (
        <div className="text-center py-4">
          <div className="text-5xl mb-4">{result.errors.length === 0 ? '✅' : '⚠️'}</div>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-primary/5 border border-primary/10 rounded-card p-4">
              <div className="text-2xl font-bold text-primary">{result.created}</div>
              <div className="text-xs text-text-muted mt-1">成功导入</div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-card p-4">
              <div className="text-2xl font-bold text-amber-600">{result.skipped}</div>
              <div className="text-xs text-text-muted mt-1">跳过（重复）</div>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-card p-4">
              <div className="text-2xl font-bold text-red-500">{result.errors.length}</div>
              <div className="text-xs text-text-muted mt-1">异常提示</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-card p-3 text-left max-h-40 overflow-y-auto mb-4">
              <p className="text-xs text-red-600 font-semibold mb-2">提示信息：</p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 mb-1">• {e}</p>
              ))}
            </div>
          )}
          <button onClick={handleClose} className="px-6 py-2 bg-primary text-white rounded-btn text-sm hover:bg-primary/90">
            完成
          </button>
        </div>
      )}
    </Modal>
  )
}
