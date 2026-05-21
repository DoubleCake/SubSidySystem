import { useState, useCallback, useEffect } from 'react'
import * as XLSX from 'xlsx'
import Modal from './Modal'

interface ColumnMapping {
  excel_column: string
  system_field: string | null
  system_field_options: Array<{ field: string; label: string; required: boolean }>
  sample_value?: string
  confidence?: number
}

interface SavedTemplate {
  id: number
  template_name: string
  column_mapping: Array<{ excel_column: string; system_field: string | null; required?: boolean }>
}

interface Props {
  open: boolean
  onClose: () => void
  title: string
  // 模板相关参数
  templateHeaders?: string[]
  templateExample?: Record<string, unknown>[]
  systemFields: Array<{ field: string; label: string; required: boolean; type: string }>
  // 已保存的映射模板列表
  templates?: SavedTemplate[]
  // 是否显示覆盖导入选项
  overwriteOption?: boolean
  // API函数
  onDetectColumns?: (columns: string[], sampleRows: Record<string, unknown>[]) => Promise<{
    columns: Array<{
      excel_column: string
      suggested_field: string | null
      confidence: number
      alternatives: Array<{ field: string; confidence: number }>
    }>
    recommended_templates?: Array<{ id: number; template_name: string; match_rate: number }>
    auto_confirm_count?: number; unrecognized_count?: number
  }>
  onSaveTemplate?: (data: {
    template_name: string
    template_year?: number
    region_name?: string
    business_type: string
    column_mapping: Array<{
      excel_column: string
      system_field: string
      aliases: string[]
      required: boolean
      transform?: string
    }>
  }) => Promise<{ id: number }>
  onImport: (rows: Record<string, unknown>[], mapping?: Record<string, string>, overwrite?: boolean) => Promise<{ created: number; updated?: number; skipped: number; errors: string[] }>
  onSuccess: () => void
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'result'

export default function ExcelImportWithMapping({
  open, onClose, title,
  templateHeaders = [], templateExample = [],
  systemFields, templates = [],
  overwriteOption = false,
  onDetectColumns, onSaveTemplate,
  onImport, onSuccess
}: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [result, setResult] = useState<{ created: number; updated?: number; skipped: number; errors: string[] } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  
  // 映射相关状态
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([])
  const [detecting, setDetecting] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateForm, setSaveTemplateForm] = useState({
    name: '',
    year: new Date().getFullYear().toString(),
    region: '',
    business_type: 'SUBSIDY'
  })
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('')

  // 进度条状态
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')

  const reset = () => {
    setStep('upload')
    setRows([])
    setResult(null)
    setColumnMappings([])
    setProgress(0)
    setProgressMsg('')
    setSelectedTemplateId('')
    setSaveTemplateOpen(false)
  }

  const handleClose = () => { reset(); onClose() }

  const parseFile = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

        if (data.length === 0) {
          alert('Excel文件为空或格式不正确')
          return
        }

        const fileColumns = Object.keys(data[0])
        setRows(data)

        // 先创建空映射并进入映射步骤
        const baseMappings: ColumnMapping[] = fileColumns.map(col => ({
          excel_column: col,
          system_field: null,
          system_field_options: systemFields,
          sample_value: data[0]?.[col] ? String(data[0][col]).substring(0, 20) : ''
        }))
        setColumnMappings(baseMappings)
        setStep('mapping')

        // 后台智能检测列名
        if (onDetectColumns) {
          setDetecting(true)
          try {
            const sampleRows = data.slice(0, 3)
            const result = await onDetectColumns(fileColumns, sampleRows)

            const mappings: ColumnMapping[] = fileColumns.map(col => {
              const detected = (result as { columns?: Array<{ excel_column: string; suggested_field?: string | null; confidence?: number }> }).columns?.find(d => d.excel_column === col)
              const sampleValue = data[0]?.[col] ? String(data[0][col]).substring(0, 20) : ''
              return {
                excel_column: col,
                system_field: detected?.suggested_field || null,
                system_field_options: systemFields,
                sample_value: sampleValue,
                confidence: detected?.confidence ?? 0
              }
            })
            setColumnMappings(mappings)
          } catch (error) {
            console.error('检测列名失败:', error)
          } finally {
            setDetecting(false)
          }
        }
      } catch (error) {
        console.error('解析文件失败:', error)
        alert('解析Excel文件失败，请检查文件格式')
      }
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
    if (templateExample.length === 0 || templateHeaders.length === 0) {
      alert('模板数据未配置')
      return
    }
    
    const ws = XLSX.utils.json_to_sheet(templateExample, { header: templateHeaders })
    ws['!cols'] = templateHeaders.map(() => ({ wch: 18 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '导入模板')
    XLSX.writeFile(wb, `${title}导入模板.xlsx`)
  }

  const handleMappingConfirm = () => {
    // 检查是否有必填字段未映射
    const requiredFields = systemFields.filter(f => f.required).map(f => f.field)
    const mappedRequiredFields = columnMappings
      .filter(m => m.system_field && requiredFields.includes(m.system_field))
      .map(m => m.system_field!)
    
    const missingRequired = requiredFields.filter(f => !mappedRequiredFields.includes(f))
    
    if (missingRequired.length > 0) {
      const fieldLabels = missingRequired.map(f => {
        const fieldInfo = systemFields.find(sf => sf.field === f)
        return fieldInfo?.label || f
      })
      alert(`以下必填字段未映射：${fieldLabels.join('、')}`)
      return
    }
    
    setStep('preview')
  }

  const handleImportConfirm = async () => {
    setStep('importing')
    setProgress(0)
    setProgressMsg(`准备导入 ${rows.length} 条记录…`)

    // 根据映射转换数据
    const mapping: Record<string, string> = {}
    const dataToImport = rows.map(row => {
      const mappedRow: Record<string, unknown> = {}
      columnMappings.forEach(cm => {
        if (cm.system_field && row[cm.excel_column] !== undefined) {
          mappedRow[cm.system_field] = row[cm.excel_column]
        }
      })
      return mappedRow
    })
    columnMappings.forEach(m => {
      if (m.system_field) mapping[m.excel_column] = m.system_field
    })

    // 分批导入，每批 200 行
    const BATCH_SIZE = 200
    const totalBatches = Math.ceil(dataToImport.length / BATCH_SIZE)
    let totalCreated = 0, totalSkipped = 0, totalUpdated = 0
    const allErrors: string[] = []

    for (let i = 0; i < dataToImport.length; i += BATCH_SIZE) {
      const batch = dataToImport.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const pct = Math.round((i / dataToImport.length) * 90)
      setProgress(pct)
      setProgressMsg(`正在导入第 ${batchNum}/${totalBatches} 批（${i + 1}-${Math.min(i + BATCH_SIZE, dataToImport.length)}/${dataToImport.length}）…`)

      try {
        const res = await onImport(batch, mapping, overwrite)
        totalCreated += res.created || 0
        totalSkipped += res.skipped || 0
        totalUpdated += res.updated || 0
        if (res.errors?.length) allErrors.push(...res.errors)
      } catch (e: unknown) {
        const err = e as Error
        allErrors.push(`第${batchNum}批导入失败: ${err.message}`)
      }
    }

    setProgress(100)
    setProgressMsg('导入完成！')
    await new Promise(r => setTimeout(r, 400))
    setResult({ created: totalCreated, updated: totalUpdated, skipped: totalSkipped, errors: allErrors })
    setStep('result')
    if (totalCreated > 0 || totalUpdated > 0) onSuccess()
  }

  // ── 导出导入异常数据为 Excel ──
  const handleExportErrors = useCallback(() => {
    if (!result || result.errors.length === 0 || rows.length === 0) return

    const rowIndexRegex = /^第(\d+)行/
    const errorsByRow = new Map<number, string[]>()
    const unparsableErrors: string[] = []

    for (const err of result.errors) {
      const match = err.match(rowIndexRegex)
      if (match) {
        const excelRowNum = parseInt(match[1], 10)
        const rowIndex = excelRowNum - 2 // 第3行 → rows[1]
        if (rowIndex >= 0 && rowIndex < rows.length) {
          const existing = errorsByRow.get(rowIndex) || []
          existing.push(err)
          errorsByRow.set(rowIndex, existing)
        } else {
          unparsableErrors.push(err)
        }
      } else {
        unparsableErrors.push(err)
      }
    }

    const wb = XLSX.utils.book_new()
    const originalColumns = rows.length > 0 ? Object.keys(rows[0] as object) : []

    // Sheet 1: 有行号映射的错误行
    if (errorsByRow.size > 0) {
      const sortedRowIndices = Array.from(errorsByRow.keys()).sort((a, b) => a - b)
      const exportData: Record<string, unknown>[] = []

      for (const rowIndex of sortedRowIndices) {
        const row = rows[rowIndex] as Record<string, unknown> | undefined
        if (!row) continue
        const exportRow: Record<string, unknown> = {}
        for (const col of originalColumns) {
          exportRow[col] = row[col] ?? ''
        }
        const errorMessages = errorsByRow.get(rowIndex)!
        const cleanErrors = errorMessages.map(e =>
          e.replace(/^第\d+行(\s*\S+)?[:：]?\s*/, '')
        )
        exportRow['错误原因'] = cleanErrors.join('; ')
        exportData.push(exportRow)
      }

      const ws = XLSX.utils.json_to_sheet(exportData, { header: [...originalColumns, '错误原因'] })
      ws['!cols'] = [
        ...originalColumns.map(() => ({ wch: 18 })),
        { wch: 50 }
      ]
      XLSX.utils.book_append_sheet(wb, ws, '异常数据')
    }

    // Sheet 2: 无行号的后端错误
    if (unparsableErrors.length > 0) {
      const errorData = unparsableErrors.map(err => ({ '错误信息': err }))
      const ws2 = XLSX.utils.json_to_sheet(errorData)
      ws2['!cols'] = [{ wch: 60 }]
      XLSX.utils.book_append_sheet(wb, ws2, '其他错误')
    }

    const dateStr = new Date().toISOString().slice(0, 10)
    const fileName = `${title}_导入异常数据_${dateStr}.xlsx`
    XLSX.writeFile(wb, fileName)
  }, [result, rows, title])

  const handleSaveTemplate = async () => {
    if (!onSaveTemplate) {
      alert('保存模板功能未配置')
      return
    }

    if (!saveTemplateForm.name.trim()) {
      alert('请输入模板名称')
      return
    }

    try {
      const column_mapping = columnMappings
        .filter(m => m.system_field)
        .map(m => ({
          excel_column: m.excel_column,
          system_field: m.system_field!,
          aliases: [m.excel_column],
          required: systemFields.find(f => f.field === m.system_field)?.required || false,
          transform: ''
        }))

      await onSaveTemplate({
        template_name: saveTemplateForm.name,
        template_year: saveTemplateForm.year ? parseInt(saveTemplateForm.year) : undefined,
        region_name: saveTemplateForm.region || undefined,
        business_type: saveTemplateForm.business_type,
        column_mapping
      })

      alert('模板保存成功！')
      setSaveTemplateOpen(false)
    } catch (error) {
      console.error('保存模板失败:', error)
      alert('保存模板失败：' + (error as Error).message)
    }
  }

  // 应用已保存的模板到当前列映射
  const applyTemplate = (templateId: number) => {
    setSelectedTemplateId(templateId)
    const tmpl = templates.find(t => t.id === templateId)
    if (!tmpl) return
    const tmplMap = Object.fromEntries(
      tmpl.column_mapping.filter(m => m.system_field).map(m => [m.excel_column, m.system_field!])
    )
    setColumnMappings(prev => prev.map(m => ({
      ...m,
      system_field: tmplMap[m.excel_column] || m.system_field
    })))
  }

  // 步骤标签
  const displayStep = step === 'importing' ? 'importing' : step
  const stepLabels = [
    { key: 'upload',    label: '上传文件' },
    { key: 'mapping',   label: '字段映射' },
    { key: 'preview',   label: '预览确认' },
    { key: 'importing', label: '导入中' },
    { key: 'result',    label: '导入结果' },
  ]

  const confirmText = step === 'preview'
    ? `确认导入 ${rows.length} 条`
    : step === 'mapping'
    ? '确认映射并继续'
    : undefined

  const handleConfirm = step === 'preview'
    ? handleImportConfirm
    : step === 'mapping'
    ? handleMappingConfirm
    : undefined

  return (
    <Modal open={open} title={`Excel批量导入 · ${title}`} onClose={handleClose} width={800}
      onConfirm={handleConfirm}
      confirmText={confirmText}>

      {/* 步骤指示 */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto">
        {stepLabels.map((s, i) => {
          const curIdx = stepLabels.findIndex(x => x.key === displayStep)
          const isPast = i < curIdx
          const isCur = i === curIdx
          return (
            <div key={s.key} className="flex items-center gap-2 shrink-0">
              {i > 0 && <div className={`w-8 h-px transition-colors ${isPast || isCur ? 'bg-emerald-300' : 'bg-stone-200'}`} />}
              <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors
                ${isCur ? 'text-primary' : isPast ? 'text-text-muted' : 'text-text-muted/50'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs transition-colors
                  ${isCur ? 'bg-primary ' : isPast ? 'bg-emerald-100 text-primary' : 'bg-warm/30 text-text-muted/50'}`}>
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
          {templateHeaders.length > 0 && (
            <div className="bg-warm/30 border border-border/50 rounded-btn p-3 mb-4">
              <p className="text-xs text-text-muted mb-2 font-medium">模板列（标 * 为必填）：</p>
              <div className="flex flex-wrap gap-1.5">
                {templateHeaders.map(h => (
                  <span key={h} className={`text-xs border px-2 py-0.5 rounded font-mono
                    ${h.includes('*') ? 'bg-primary/5 border-primary/20 text-primary' : 'bg-white border-border text-text-muted'}`}>
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div
            className={`border-2 border-dashed rounded-card p-10 text-center cursor-pointer transition-colors
              ${dragOver ? 'border-emerald-400 bg-primary/5' : 'border-border hover:border-border hover:bg-warm/30'}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('xlsx-input')?.click()}>
            <div className="text-4xl mb-3">📊</div>
            <p className="text-text-muted text-sm">拖拽 Excel 文件到这里，或点击选择文件</p>
            <p className="text-text-muted/50 text-xs mt-1">支持 .xlsx / .xls，系统将自动识别列名</p>
            <input id="xlsx-input" type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
          </div>
        </div>
      )}

      {/* Step 2: 字段映射 */}
      {step === 'mapping' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-semibold text-text-primary">字段映射配置</h3>
              <p className="text-sm text-text-muted">请将Excel列映射到系统字段，未映射的列将被忽略</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSaveTemplateOpen(true)}
                className="text-xs border border-purple-200 text-purple-700 px-3 py-1.5 rounded-btn hover:bg-purple-50">
                💾 保存为模板
              </button>
              <button onClick={() => setStep('upload')}
                className="text-xs border bg-danger-200 border-border text-white text-text-muted px-3 py-1.5 rounded-btn hover:bg-warm/30">
                重新上传
              </button>
            </div>
          </div>

          {detecting && (
            <div className="mb-3 bg-blue-50 border border-blue-100 rounded-btn px-4 py-2.5 flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin shrink-0" />
              <span className="text-sm text-blue-700">正在智能识别列名，匹配结果将自动填充…</span>
            </div>
          )}

          {templates.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-text-muted">快速应用模板：</span>
              <select
                value={selectedTemplateId}
                onChange={e => {
                  const id = e.target.value ? Number(e.target.value) : ''
                  if (id) applyTemplate(id)
                  else setSelectedTemplateId('')
                }}
                className="border border-border rounded-btn px-3 py-1.5 text-sm bg-white outline-none focus:border-primary"
              >
                <option value="">— 手动配置 —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.template_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
            <div className="px-4 py-3 bg-warm/30 border-b border-border grid grid-cols-[200px_1fr_200px] gap-4 text-xs font-semibold text-text-muted">
              <span>Excel列名</span>
              <span>数据示例</span>
              <span>映射到系统字段</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {columnMappings.map((mapping, index) => {
                const confidenceLabel = mapping.confidence != null && mapping.confidence > 0
                  ? mapping.confidence >= 0.9 ? '高' : mapping.confidence >= 0.6 ? '中' : '低'
                  : null
                const confidenceColor = mapping.confidence != null && mapping.confidence >= 0.9
                  ? 'bg-emerald-100 text-primary'
                  : mapping.confidence != null && mapping.confidence >= 0.6
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-warm/30 text-text-muted'
                return (
                <div key={index} className={`px-4 py-3 border-b border-border/50 grid grid-cols-[200px_1fr_200px] gap-4 items-center
                  ${!mapping.system_field ? 'bg-amber-50/30' : 'bg-primary/5/20'}`}>
                  <div>
                    <span className="font-medium text-text-primary">{mapping.excel_column}</span>
                  </div>
                  <div className="text-sm text-text-muted font-mono truncate">
                    {mapping.sample_value || '—'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={mapping.system_field || ''}
                      onChange={(e) => {
                        const newMappings = [...columnMappings]
                        newMappings[index].system_field = e.target.value || null
                        setColumnMappings(newMappings)
                      }}
                      className="flex-1 border rounded-btn px-3 py-1.5 text-sm outline-none bg-white focus:border-primary"
                    >
                      <option value="">— 忽略此列 —</option>
                      {systemFields.map(field => (
                        <option key={field.field} value={field.field}>
                          {field.label} {field.required && '*'}
                        </option>
                      ))}
                    </select>
                    {confidenceLabel && mapping.system_field && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${confidenceColor}`}>
                        {confidenceLabel}
                      </span>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          </div>

          <div className="mt-4 bg-warm/30 border border-border/50 rounded-btn p-3">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary/50"></div>
                <span className="text-text-primary">已映射：{columnMappings.filter(m => m.system_field).length} 列</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                <span className="text-text-primary">未映射：{columnMappings.filter(m => !m.system_field).length} 列</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-text-primary">必填字段：{systemFields.filter(f => f.required).length} 个</span>
              </div>
            </div>
            {columnMappings.some(m => m.confidence != null && m.confidence > 0) && (
              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border text-xs text-text-muted">
                <span>匹配置信度：</span>
                <span className="flex items-center gap-1"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-primary">高</span>≥90%</span>
                <span className="flex items-center gap-1"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">中</span>≥60%</span>
                <span className="flex items-center gap-1"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-warm/30 text-text-muted">低</span>&lt;60%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: 预览 */}
      {step === 'preview' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-text-primary">
              共解析 <strong className="text-primary">{rows.length}</strong> 行，请确认后导入
              <span className="ml-2 text-amber-600">（已应用字段映射）</span>
            </p>
            <button onClick={() => setStep('mapping')} className="text-xs text-text-muted hover:text-text-primary">
              ← 修改映射
            </button>
          </div>
          {overwriteOption && (
            <div className="mb-3 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-btn px-4 py-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={e => setOverwrite(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-500"
                />
                <span className="text-sm text-amber-800 font-medium">覆盖导入</span>
              </label>
              <span className="text-xs text-amber-600">勾选后，已存在的农户（相同身份证）将更新信息，而非跳过</span>
            </div>
          )}
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
                    <th key={k} className="px-3 py-2 text-left text-text-muted font-semibold border-b border-border whitespace-nowrap">
                      {k}
                      {columnMappings.find(m => m.excel_column === k)?.system_field && (
                        <span className="ml-1 text-primary text-xs">
                          → {columnMappings.find(m => m.excel_column === k)?.system_field}
                        </span>
                      )}
                    </th>
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

      {/* Step 5: 进度条 */}
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

      {/* Step 6: 结果 */}
      {step === 'result' && result && (
        <div className="text-center py-4">
          <div className="text-5xl mb-4">{result.errors.length === 0 ? '✅' : '⚠️'}</div>
          <div className={`grid gap-4 mb-5 ${result.updated ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <div className="bg-primary/5 border border-primary/10 rounded-card p-4">
              <div className="text-2xl font-bold text-primary">{result.created}</div>
              <div className="text-xs text-text-muted mt-1">成功导入</div>
            </div>
            {result.updated !== undefined && result.updated > 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-card p-4">
                <div className="text-2xl font-bold text-blue-700">{result.updated}</div>
                <div className="text-xs text-text-muted mt-1">覆盖更新</div>
              </div>
            )}
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
          {result.errors.length > 0 && (
            <div className="mb-4">
              <button onClick={handleExportErrors}
                className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-btn text-sm hover:bg-red-100">
                ↓ 导出异常数据
              </button>
            </div>
          )}
          <button onClick={handleClose} className="px-6 py-2 bg-primary  rounded-btn text-sm hover:bg-primary/90">
            完成
          </button>
        </div>
      )}

      {/* 保存模板弹窗 */}
      <Modal open={saveTemplateOpen} title="保存字段映射模板" onClose={() => setSaveTemplateOpen(false)} onConfirm={handleSaveTemplate}>
        <div className="space-y-4">
          <div className="bg-primary/5 border border-primary/10 rounded-card p-3 text-xs text-primary">
            将保存 {columnMappings.filter(m => m.system_field).length} 列的映射关系。下次相同格式的 Excel 可直接复用此模板。
          </div>
          
          <div>
            <label className="block text-sm text-text-primary mb-1">模板名称 *</label>
            <input
              value={saveTemplateForm.name}
              onChange={(e) => setSaveTemplateForm(f => ({ ...f, name: e.target.value }))}
              placeholder="例如：补贴发放导入模板"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-text-primary mb-1">适用年度</label>
              <input
                value={saveTemplateForm.year}
                onChange={(e) => setSaveTemplateForm(f => ({ ...f, year: e.target.value }))}
                placeholder="例如：2025"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-primary mb-1">适用村组</label>
              <input
                value={saveTemplateForm.region}
                onChange={(e) => setSaveTemplateForm(f => ({ ...f, region: e.target.value }))}
                placeholder="例如：红星村"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm text-text-primary mb-1">业务类型</label>
            <select
              value={saveTemplateForm.business_type}
              onChange={(e) => setSaveTemplateForm(f => ({ ...f, business_type: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none focus:border-primary"
            >
              <option value="SUBSIDY">补贴发放</option>
              <option value="FARMER">农户档案</option>
              <option value="ERROR_LIBRARY">错误库</option>
            </select>
          </div>
        </div>
      </Modal>
    </Modal>
  )
}