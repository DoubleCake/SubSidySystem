import { useState, useCallback, useEffect, useMemo } from 'react'
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
  onImport: (rows: Record<string, unknown>[], mapping?: Record<string, string>, overwrite?: boolean, onProgress?: (s: { stage: string; text: string; written?: number; total?: number }) => void) => Promise<{ created: number; updated?: number; skipped: number; errors: string[]; message?: string }>
  onSuccess: () => void
  preCheck?: (rows: Record<string, unknown>[], mapping?: Record<string, string>) => Promise<{
    passed_rows: number[]
    failed_rows: Array<{ index: number; real_name: string; id_card_masked: string; issues: string[] }>
    warning_rows: Array<{ index: number; real_name: string; id_card_masked: string; warnings: string[] }>
    comparison?: {
      missing_from_import: Array<{ id_card: string; real_name: string; village?: string; apply_area?: number }>
      new_in_import: Array<{ id_card: string; real_name: string; village?: string; apply_area?: number }>
      area_changed: Array<{ id_card: string; real_name: string; app_area: number; import_area: number; diff: number }>
    }
  }>
}

type PreCheckStatus = {
  result: 'checking' | 'done' | 'error'
  failedIndices: Set<number>
  warningIndices: Set<number>
  failedRows: Array<{ index: number; real_name: string; id_card_masked: string; issues: string[] }>
  warningRows: Array<{ index: number; real_name: string; id_card_masked: string; warnings: string[] }>
  comparison?: {
    missing_from_import: Array<{ id_card: string; real_name: string; village?: string; apply_area?: number }>
    new_in_import: Array<{ id_card: string; real_name: string; village?: string; apply_area?: number }>
    area_changed: Array<{ id_card: string; real_name: string; app_area: number; import_area: number; diff: number }>
  }
  errorMsg?: string
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'result'

export default function ExcelImportWithMapping({
  open, onClose, title,
  templateHeaders = [], templateExample = [],
  systemFields, templates = [],
  overwriteOption = false,
  onDetectColumns, onSaveTemplate,
  onImport, onSuccess, preCheck
}: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [result, setResult] = useState<{ created: number; updated?: number; skipped: number; errors: string[]; message?: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  
  // 映射相关状态
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([])
  const [detecting, setDetecting] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)

  // 预检查状态
  const [preCheckStatus, setPreCheckStatus] = useState<PreCheckStatus | null>(null)

  // 多 Sheet 状态
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string>('')
  // 跳过行数：输入即时显示，实际解析延迟 300ms 防抖
  const [skipRowsInput, setSkipRowsInput] = useState(0)
  const [skipRows, setSkipRows] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setSkipRows(skipRowsInput), 300)
    return () => clearTimeout(t)
  }, [skipRowsInput])

  // Sheet 或跳行变化时实时重新解析
  useEffect(() => {
    if (!workbook || !selectedSheet) return
    parseSheet(workbook, selectedSheet, skipRows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSheet, skipRows])

  const [saveTemplateForm, setSaveTemplateForm] = useState({
    name: '',
    year: new Date().getFullYear().toString(),
    region: '',
    business_type: 'SUBSIDY'
  })
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('')

  // 导入进度状态（方案A：不确定进度条+实时计数）
  const [importStage, setImportStage] = useState('')
  const [statusText, setStatusText] = useState('')
  const [written, setWritten] = useState(0)
  const [importTotal, setImportTotal] = useState(0)

  const reset = () => {
    setStep('upload')
    setRows([])
    setResult(null)
    setColumnMappings([])
    setImportStage('')
    setStatusText('')
    setWritten(0)
    setImportTotal(0)
    setSelectedTemplateId('')
    setSaveTemplateOpen(false)
    setWorkbook(null)
    setSheetNames([])
    setSkipRowsInput(0)
    setSkipRows(0)
    setSelectedSheet('')
  }

  const handleClose = () => { reset(); onClose() }
  const handleReset = () => { setWorkbook(null); setSheetNames([]); setSelectedSheet(''); setSkipRowsInput(0); setSkipRows(0); setRows([]); setStep('upload') }

  const parseFile = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        setWorkbook(wb)
        setSheetNames(wb.SheetNames)
        setSelectedSheet(wb.SheetNames[0] || '')
        setSkipRowsInput(0)
        setSkipRows(0)
        setStep('mapping')
      } catch (error) {
        console.error('解析文件失败:', error)
        alert('解析Excel文件失败，请检查文件格式')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // 解析指定 Sheet 的数据（支持跳过前N行）
  const parseSheetData = (wb: XLSX.WorkBook, sheetName: string, skip: number) => {
    const ws = wb.Sheets[sheetName]
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    const headerRowNum = range.s.r + skip
    const newRange = XLSX.utils.encode_range({ s: { r: headerRowNum, c: range.s.c }, e: range.e })
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { range: newRange, defval: '' })

    if (data.length === 0) {
      alert(`Sheet「${sheetName}」${skip > 0 ? `跳过前${skip}行后` : ''}为空或格式不正确`)
      return null
    }
    return data
  }

  const parseSheet = async (wb: XLSX.WorkBook, sheetName: string, skip: number) => {
    const data = parseSheetData(wb, sheetName, skip)
    if (!data) return

    const fileColumns = Object.keys(data[0])
    setRows(data)
    // 保留 workbook 以便映射页可切换 Sheet/跳行重新解析

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

  // 映射后的数据（Excel原始值+系统字段键名）
  const mappedData = useMemo(() => {
    // 映射的列名列表（已映射的系统字段按映射表顺序排列）
    const fields = columnMappings.filter(cm => cm.system_field).map(cm => cm.system_field!)
    const mapping: Record<string, string> = {}
    columnMappings.forEach(cm => { if (cm.system_field) mapping[cm.excel_column] = cm.system_field })
    const mappedRows = rows.map(row => {
      const mr: Record<string, unknown> = {}
      columnMappings.forEach(cm => {
        if (cm.system_field && row[cm.excel_column] !== undefined) {
          mr[cm.system_field] = row[cm.excel_column]
        }
      })
      return mr
    })
    return { fields, rows: mappedRows }
  }, [rows, columnMappings])

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
    setPreCheckStatus(null)
  }

  // 预检查
  const handlePreCheck = async () => {
    if (!preCheck) return
    setPreCheckStatus({ result: 'checking', failedIndices: new Set(), warningIndices: new Set(), failedRows: [], warningRows: [] })
    try {
      const mapping: Record<string, string> = {}
      columnMappings.forEach(m => { if (m.system_field) mapping[m.excel_column] = m.system_field })
      const res = await preCheck(rows, mapping)
      setPreCheckStatus({
        result: 'done',
        failedIndices: new Set(res.failed_rows.map(r => r.index)),
        warningIndices: new Set(res.warning_rows.map(r => r.index)),
        failedRows: res.failed_rows,
        warningRows: res.warning_rows,
        comparison: res.comparison,
      })
    } catch (e) {
      setPreCheckStatus({ result: 'error', errorMsg: String(e), failedIndices: new Set(), warningIndices: new Set(), failedRows: [], warningRows: [] })
    }
  }

  // 删除所有检查失败的行
  const handleDeleteFailed = () => {
    if (!preCheckStatus) return
    const failedSet = preCheckStatus.failedIndices
    setRows(prev => prev.filter((_, i) => !failedSet.has(i)))
    setPreCheckStatus(null)
  }

    const handleImportConfirm = async () => {
    setStep('importing')
    setImportStage('validating')
    setStatusText('准备导入…')
    setWritten(0)
    setImportTotal(rows.length)

    // 给 React 一帧时间渲染进度条 UI
    await new Promise(r => requestAnimationFrame(r))

    // 映射关系（Excel列名→系统字段）
    const mapping: Record<string, string> = {}
    columnMappings.forEach(m => { if (m.system_field) mapping[m.excel_column] = m.system_field })
    const dataToImport = mappedData.rows

    try {
      const res = await onImport(dataToImport, mapping, overwrite, (s) => {
        setImportStage(s.stage)
        setStatusText(s.text)
        if (s.written != null) setWritten(s.written)
        if (s.total != null) setImportTotal(s.total)
      })

      setImportStage('done')
      setStatusText('导入完成！')
      await new Promise(r => setTimeout(r, 400))
      setResult({ created: res.created || 0, updated: res.updated, skipped: res.skipped || 0, errors: res.errors || [], message: res.message })
      setStep('result')
      if ((res.created || 0) > 0 || (res.updated || 0) > 0) onSuccess()
    } catch (e: unknown) {
      const err = e as Error
      setResult({ created: 0, skipped: 0, errors: [`导入失败: ${err.message}`] })
      setStep('result')
    }
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
      onConfirm={handleConfirm} confirmText={confirmText}>

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
                  ${isCur ? 'bg-primary-500 ' : isPast ? 'bg-emerald-100 text-primary' : 'bg-warm/30 text-text-muted/50'}`}>
                  {isPast ? '✓' : i + 1}
                </div>
                {s.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Step 1: 上传 / 选择Sheet */}
      {step === 'upload' && (
        <div>
          {!workbook && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm text-text-muted">请按模板格式准备 Excel 文件（.xlsx / .xls）</p>
                <button onClick={downloadTemplate}
                  className="text-xs text-primary border border-primary-500/20 px-3 py-1.5 rounded-btn hover:bg-primary-500/5 flex items-center gap-1">
                  ↓ 下载模板
                </button>
              </div>
              {templateHeaders.length > 0 && (
                <div className="bg-warm/30 border border-border/50 rounded-btn p-3 mb-4">
                  <p className="text-xs text-text-muted mb-2 font-medium">模板列（标 * 为必填）：</p>
                  <div className="flex flex-wrap gap-1.5">
                    {templateHeaders.map(h => (
                      <span key={h} className={`text-xs border px-2 py-0.5 rounded font-mono
                        ${h.includes('*') ? 'bg-primary-500/5 border-primary-500/20 text-primary' : 'bg-white border-border text-text-muted'}`}>
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div
                className={`border-2 border-dashed rounded-card p-10 text-center cursor-pointer transition-colors
                  ${dragOver ? 'border-emerald-400 bg-primary-500/5' : 'border-border hover:border-border hover:bg-warm/30'}`}
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
              <button onClick={handleReset}
                className="text-xs border border-border text-text-muted px-3 py-1.5 rounded-btn hover:bg-warm/30">
                重新上传
              </button>
            </div>
          </div>

          {/* Sheet 选择 + 跳行 + 重新解析（内嵌于映射页） */}
          {workbook && sheetNames.length > 0 && (
            <div className="mb-3 bg-warm/30 border border-border rounded-btn px-3 py-2 flex items-center gap-3 flex-wrap">
              <span className="text-xs text-text-muted shrink-0">📑 数据源</span>
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] text-text-muted">Sheet</label>
                <select value={selectedSheet} onChange={e => setSelectedSheet(e.target.value)}
                  className="border border-border rounded-btn px-2 py-1 text-xs outline-none bg-white">
                  {sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] text-text-muted">跳过</label>
                <input type="number" min={0} max={20} value={skipRowsInput}
                  onChange={e => setSkipRowsInput(Math.max(0, Number(e.target.value) || 0))}
                  className="w-14 border border-border rounded-btn px-2 py-1 text-xs outline-none text-center bg-white" />
                <span className="text-[11px] text-text-muted">行</span>
                {skipRowsInput > 0 && <span className="text-[10px] text-amber-600">从第{skipRowsInput+1}行起</span>}
              </div>
              {rows.length > 0 && (
                <span className="text-[11px] text-text-muted ml-auto">
                  {rows.length} 行数据
                </span>
              )}
            </div>
          )}

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
                className="border border-border rounded-btn px-3 py-1.5 text-sm bg-white outline-none focus:border-primary-500"
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
                const isAuto = mapping.confidence != null && mapping.confidence >= 0.6 && mapping.system_field
                const isManual = mapping.system_field && !isAuto
                const isMapped = !!mapping.system_field
                const rowBg = isMapped ? (isAuto ? 'bg-emerald-100 border-l-4 border-l-emerald-500' : 'bg-blue-100 border-l-4 border-l-blue-500') : 'bg-amber-50 border-l-4 border-l-amber-300'
                const sourceTag = isAuto ? { label: '✓ 自动', cls: 'bg-emerald-500 text-white shadow-sm' } : isManual ? { label: '👆 手动', cls: 'bg-blue-500 text-white shadow-sm' } : null
                return (
                <div key={index} className={`px-4 py-3 border-b border-border/50 grid grid-cols-[200px_1fr_200px] gap-4 items-center ${rowBg} transition-colors`}>
                  <div>
                    <span className={`text-sm ${isMapped ? 'font-semibold text-text-primary' : 'text-text-muted/60'}`}>{mapping.excel_column}</span>
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
                        if (e.target.value && newMappings[index].confidence != null && newMappings[index].confidence! >= 0.6) {
                          newMappings[index].confidence = 0.5
                        }
                        setColumnMappings(newMappings)
                      }}
                      className={`flex-1 border-2 rounded-btn px-3 py-1.5 text-sm outline-none transition-all
                        ${isMapped
                          ? 'border-emerald-400 bg-emerald-50 font-semibold text-emerald-800 shadow-sm'
                          : 'border-stone-200 bg-white text-text-muted hover:border-stone-300'}`}
                    >
                      <option value="">— 忽略此列 —</option>
                      {systemFields.map(field => (
                        <option key={field.field} value={field.field}>
                          {field.label} {field.required && '*'}
                        </option>
                      ))}
                    </select>
                    {sourceTag && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${sourceTag.cls}`}>
                        {sourceTag.label}
                      </span>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          </div>

          <div className="mt-4 bg-warm/30 border border-border/50 rounded-btn p-3">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                <span className="text-text-primary">自动匹配：{columnMappings.filter(m => m.confidence != null && m.confidence >= 0.6 && m.system_field).length} 列</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span className="text-text-primary">手动选择：{columnMappings.filter(m => m.system_field && !(m.confidence != null && m.confidence >= 0.6)).length} 列</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                <span className="text-text-primary">未映射：{columnMappings.filter(m => !m.system_field).length} 列</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-text-muted text-xs">必填字段 {systemFields.filter(f => f.required).length} 个</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: 预览 */}
      {step === 'preview' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-text-primary">
              共解析 <strong className="text-primary">{rows.length}</strong> 行，请确认后导入
            </p>
            <button onClick={() => setStep('mapping')} className="text-xs text-text-muted hover:text-text-primary">
              ← 修改映射
            </button>
          </div>
          {/* 预检查区域 */}
          {preCheck && (
            <div className="mb-3">
              {!preCheckStatus && (
                <button onClick={handlePreCheck}
                  className="text-xs border border-primary-500/30 text-primary px-3 py-1.5 rounded-btn hover:bg-primary-500/5 transition-colors">
                  🔍 预检查
                </button>
              )}
              {preCheckStatus?.result === 'checking' && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span className="inline-block w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  正在预检查…
                </div>
              )}
              {preCheckStatus?.result === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-btn px-3 py-2 text-xs text-red-600">
                  预检查出错：{preCheckStatus.errorMsg}
                </div>
              )}
              {preCheckStatus?.result === 'done' && (
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-emerald-600 font-medium">✓ {rows.length - preCheckStatus.failedRows.length} 条通过</span>
                    {preCheckStatus.failedRows.length > 0 && (
                      <span className="text-red-500 font-medium">✗ {preCheckStatus.failedRows.length} 条失败</span>
                    )}
                    {preCheckStatus.warningRows.length > 0 && (
                      <span className="text-amber-600 font-medium">! {preCheckStatus.warningRows.length} 条警告</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {preCheckStatus.failedRows.length > 0 && (
                      <button onClick={handleDeleteFailed}
                        className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-btn hover:bg-red-50 transition-colors">
                        🗑 删除 {preCheckStatus.failedRows.length} 条失败行
                      </button>
                    )}
                    <button onClick={handlePreCheck}
                      className="text-xs border border-border text-text-muted px-3 py-1.5 rounded-btn hover:bg-warm/30 transition-colors">
                      重新检查
                    </button>
                  </div>
                </div>
              )}
              {preCheckStatus?.result === 'done' && preCheckStatus.failedRows.length > 0 && (
                <div className="mt-2 bg-red-50 border border-red-200 rounded-btn px-3 py-2 max-h-24 overflow-y-auto">
                  {preCheckStatus.failedRows.map((r, i) => (
                    <p key={i} className="text-xs text-red-600 mb-0.5">
                      第{r.index + 2}行 · {r.real_name}（{r.id_card_masked}）：{r.issues.join('；')}
                    </p>
                  ))}
                </div>
              )}
              {/* 与预申请数据比对 */}
              {preCheckStatus?.result === 'done' && preCheckStatus.comparison && (
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  {preCheckStatus.comparison.missing_from_import.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-btn p-2">
                      <div className="font-semibold text-red-700 mb-1">⚠ 申请有但导入无 ({preCheckStatus.comparison.missing_from_import.length}人)</div>
                      <div className="max-h-20 overflow-y-auto space-y-0.5">
                        {preCheckStatus.comparison.missing_from_import.map((m, i) => (
                          <div key={i} className="text-red-600">{m.real_name} <span className="text-red-400">({m.id_card.slice(-4)})</span> {m.apply_area ? `${m.apply_area}亩` : ''}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {preCheckStatus.comparison.new_in_import.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-btn p-2">
                      <div className="font-semibold text-blue-700 mb-1">＋ 导入新增 ({preCheckStatus.comparison.new_in_import.length}人)</div>
                      <div className="max-h-20 overflow-y-auto space-y-0.5">
                        {preCheckStatus.comparison.new_in_import.map((m, i) => (
                          <div key={i} className="text-blue-600">{m.real_name} <span className="text-blue-400">({m.id_card.slice(-4)})</span> {m.apply_area ? `${m.apply_area}亩` : ''}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {preCheckStatus.comparison.area_changed.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-btn p-2">
                      <div className="font-semibold text-amber-700 mb-1">📐 面积变化 ({preCheckStatus.comparison.area_changed.length}人)</div>
                      <div className="max-h-20 overflow-y-auto space-y-0.5">
                        {preCheckStatus.comparison.area_changed.map((m, i) => (
                          <div key={i} className="text-amber-700">{m.real_name}: {m.app_area}→{m.import_area}亩
                            <span className={m.diff > 0 ? 'text-red-500 ml-1' : m.diff < 0 ? 'text-green-500 ml-1' : 'text-text-muted ml-1'}>
                              ({m.diff > 0 ? '+' : ''}{m.diff.toFixed(2)})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
                  <th className="px-2 py-2 text-center text-xs text-text-muted font-semibold border-b border-border w-8">#</th>
                  {mappedData.fields.map(f => {
                    const fieldInfo = systemFields.find(sf => sf.field === f)
                    return (
                      <th key={f} className="px-3 py-2 text-left text-text-muted font-semibold border-b border-border whitespace-nowrap">
                        {fieldInfo?.label || f}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {mappedData.rows.slice(0, 30).map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-warm/30">
                    <td className="px-2 py-1.5 text-center text-xs text-text-muted/50">{i + 1}</td>
                    {mappedData.fields.map(f => (
                      <td key={f} className="px-3 py-1.5 text-text-primary whitespace-nowrap font-mono">{String(row[f] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 30 && <p className="text-xs text-text-muted mt-2">预览前30行，共{rows.length}行数据</p>}
        </div>
      )}

      {/* Step 5: 进度条（方案A：不确定动画+实时计数） */}
      {step === 'importing' && (
        <div className="py-8">
          <div className="text-center mb-6">
            <div className="text-4xl mb-4">⏳</div>
            <p className="text-text-primary text-sm font-medium">{statusText || '准备导入…'}</p>
            <p className="text-text-muted text-xs mt-1">
              正在处理 {importTotal || rows.length} 条记录，请勿关闭页面
            </p>
          </div>

          {/* 不确定进度条 — 无限循环滑动动画，不依赖百分比 */}
          <div className="bg-warm/30 rounded-full h-3 overflow-hidden mb-6 shadow-inner">
            <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400"
              style={{ animation: 'import-slide 1.5s ease-in-out infinite' }} />
          </div>

          {/* 实时写入计数 */}
          <div className="text-center mb-5">
            {written > 0 && (
              <span className="text-xs text-text-muted">
                已写入 <strong className="text-primary font-mono">{written}</strong>/{importTotal || rows.length} 条
              </span>
            )}
          </div>

          {/* 阶段指示器 */}
          <div className="space-y-1">
            {[
              { key: 'validating', label: '校验农户信息' },
              { key: 'writing',    label: `写入数据库${written > 0 ? ` — 已处理 ${written}/${importTotal || rows.length} 条` : ''}` },
              { key: 'done',       label: '导入完成' },
            ].map(item => {
              const order = ['validating', 'writing', 'done']
              const curIdx = order.indexOf(importStage)
              const itemIdx = order.indexOf(item.key)
              const done = curIdx > itemIdx || importStage === 'done'
              const active = curIdx === itemIdx && importStage !== 'done'
              return (
                <div key={item.key} className={`flex items-center gap-2.5 px-3 py-1.5 rounded text-xs transition-colors
                  ${done ? 'text-emerald-600' : active ? 'text-primary bg-primary-500/5 font-medium' : 'text-text-muted/30'}`}>
                  <span className="w-4 text-center shrink-0">
                    {done ? '✓' : active ? <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" /> : '○'}
                  </span>
                  {item.label}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Step 6: 结果 */}
      {step === 'result' && result && (
        <div className="text-center py-4">
          <div className="text-5xl mb-4">{result.errors.length === 0 ? '✅' : '⚠️'}</div>
          {result.message && (
            <div className="bg-blue-50 border border-blue-100 rounded-btn px-3 py-2 text-xs text-blue-700 mb-4">
              {result.message}
            </div>
          )}
          <div className={`grid gap-4 mb-5 ${result.updated ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <div className="bg-primary-500/5 border border-primary-500/10 rounded-card p-4">
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
          <button onClick={handleClose} className="px-6 py-2 bg-primary-500  rounded-btn text-sm hover:bg-primary-500/90">
            完成
          </button>
        </div>
      )}

      {/* 保存模板弹窗 */}
      <Modal open={saveTemplateOpen} title="保存字段映射模板" onClose={() => setSaveTemplateOpen(false)} onConfirm={handleSaveTemplate}>
        <div className="space-y-4">
          <div className="bg-primary-500/5 border border-primary-500/10 rounded-card p-3 text-xs text-primary">
            将保存 {columnMappings.filter(m => m.system_field).length} 列的映射关系。下次相同格式的 Excel 可直接复用此模板。
          </div>
          
          <div>
            <label className="block text-sm text-text-primary mb-1">模板名称 *</label>
            <input
              value={saveTemplateForm.name}
              onChange={(e) => setSaveTemplateForm(f => ({ ...f, name: e.target.value }))}
              placeholder="例如：补贴发放导入模板"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-text-primary mb-1">适用年度</label>
              <input
                value={saveTemplateForm.year}
                onChange={(e) => setSaveTemplateForm(f => ({ ...f, year: e.target.value }))}
                placeholder="例如：2025"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm text-text-primary mb-1">适用村组</label>
              <input
                value={saveTemplateForm.region}
                onChange={(e) => setSaveTemplateForm(f => ({ ...f, region: e.target.value }))}
                placeholder="例如：红星村"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm text-text-primary mb-1">业务类型</label>
            <select
              value={saveTemplateForm.business_type}
              onChange={(e) => setSaveTemplateForm(f => ({ ...f, business_type: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none focus:border-primary-500"
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