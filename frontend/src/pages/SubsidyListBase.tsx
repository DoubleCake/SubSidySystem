/**
 * 补贴列表基组件
 * 抽取 PreApplyList 和 DisbursementList 的公共逻辑
 */
import { useState, useEffect, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import * as XLSX from 'xlsx'
import * as api from '../api'
import type { ApplicationSearchResult, ApplicationCreate, ApplicationOut, ExcelColumnTemplate } from '../types'
import { PAY_STATUS, fmt } from '../utils'

// ── 配置接口 ──
export interface SubsidyListConfig {
  /** API 基础路径 */
  apiBase: string
  /** 导入弹窗标题 */
  importTitle: string
  /** 导出文件名前缀 */
  exportPrefix: string
  /** 导入覆盖时的批量导入端点 */
  batchImportEndpoint: string
  /** 导出函数 */
  onExport: (subsidyTypeId: number) => Promise<{ items: ApplicationSearchResult[] }>
  /** 额外工具栏按钮（放在导出按钮后面） */
  extraToolbar?: (props: { selectedIds: number[]; load: () => void; show: (msg: string, type?: 'ok' | 'err') => void }) => ReactNode
  /** 预检回调 */
  preCheck?: (rows: Record<string, unknown>[], mapping?: Record<string, string>) => Promise<{
    passed_rows: number[]
    failed_rows: { index: number; real_name: string; id_card_masked: string; issues: string[] }[]
    warning_rows: { index: number; real_name: string; id_card_masked: string; warnings: string[] }[]
    comparison?: { missing_from_import: { id_card: string; real_name: string; village?: string; apply_area?: number }[]; new_in_import: { id_card: string; real_name: string; village?: string; apply_area?: number }[]; area_changed: { id_card: string; real_name: string; app_area: number; import_area: number; diff: number }[] }
  }>
  /** 新增表单额外的字段渲染 */
  renderAddFields?: () => ReactNode
  /** 编辑表单额外的字段渲染 */
  renderEditFields?: () => ReactNode
  /** 新增提交（返回 true 则调用 load，false 则自行处理） */
  onSubmitAdd?: () => Promise<boolean>
  /** 编辑提交 */
  onSubmitEdit?: () => Promise<boolean>
  /** 删除端点格式，默认 `${apiBase}/${id}` */
  deleteEndpoint?: (id: number) => string
  /** 导入字段映射 */
  importFields?: { field: string; label: string; required: boolean; type: string }[]
  /** 编辑时额外字段设置 */
  onOpenEditExtra?: (a: ApplicationSearchResult) => Partial<Record<string, unknown>>
  /** 导入行字段映射（发放列表用于 apply_year→payment_year 等字段名转换） */
  buildImportRow?: (common: Record<string, unknown>) => Record<string, unknown>
}

const DEFAULT_IMPORT_FIELDS = [
  { field: "id_card", label: "身份证号", required: true, type: "id_card" },
  { field: "real_name", label: "姓名", required: true, type: "string" },
  { field: "apply_area", label: "计入超限计算的补贴面积", required: false, type: "decimal" },
  { field: "apply_area_no_calc", label: "不计入超限计算的补贴面积", required: false, type: "decimal" },
  { field: "contract_area", label: "承包地面积", required: false, type: "decimal" },
  { field: "trust_area", label: "代耕代种面积", required: false, type: "decimal" },
  { field: "no_subsidy_area", label: "不予补贴面积", required: false, type: "decimal" },
  { field: "village_name", label: "所在村", required: false, type: "string" },
  { field: "group_no", label: "所在组", required: false, type: "string" },
  { field: "remark", label: "备注", required: false, type: "string" },
  { field: "proxy_remark", label: "代领备注", required: false, type: "string" },
]

const SORTABLE_COLS: Record<string, string> = {
  '计入超限面积': 'apply_area', '不计超限面积': 'apply_area_no_calc',
  '承包地面积': 'contract_area', '代耕代种面积': 'trust_area',
  '不予补贴面积': 'no_subsidy_area', '申请金额': 'apply_amount', '发放金额': 'actual_amount',
}
const NARROW_COLS = new Set(['计入超限面积', '不计超限面积', '承包地面积', '代耕代种面积', '不予补贴面积', '申请金额', '发放金额'])
const HEADERS = ['姓名', '身份证', '手机号', '所在村', '所在组', '计入超限面积', '不计超限面积', '承包地面积', '代耕代种面积', '不予补贴面积', '申请金额', '发放金额', '状态', '打款日期', '备注', '代领备注', '操作']

// ── Props ──
export interface SubsidyListBaseProps {
  subsidyType: { id: number; subsidy_year: number; subsidy_name: string; calc_mode: 'fixed' | 'per_mu' | undefined; standard_amount: string | null; standard_unit: string | null }
  apps: ApplicationSearchResult[]
  total: number
  page: number
  loading: boolean
  selectedIds: number[]
  search: string
  filters: { village: string; payStatus: string; minAmount: string; maxAmount: string; dateFrom: string; dateTo: string }
  villages: string[]
  loadingVillages: boolean
  templates: ExcelColumnTemplate[]
  addOpen: boolean
  editTarget: ApplicationOut | null
  deleteId: number | null
  form: Partial<ApplicationCreate> & { proxy_remark?: string }
  idInput: string
  farmerHint: string
  farmerId: number | null
  setApps: (apps: ApplicationSearchResult[]) => void
  setTotal: (total: number) => void
  setPage: (page: number | ((prev: number) => number)) => void
  setLoading: (loading: boolean) => void
  setSelectedIds: (ids: number[] | ((prev: number[]) => number[])) => void
  setSearch: (search: string) => void
  setFilters: (filters: SubsidyListBaseProps['filters']) => void
  setAddOpen: (open: boolean) => void
  setEditTarget: (target: ApplicationOut | null) => void
  setDeleteId: (id: number | null) => void
  setForm: (form: Partial<ApplicationCreate> & { proxy_remark?: string } | ((prev: Partial<ApplicationCreate> & { proxy_remark?: string }) => Partial<ApplicationCreate> & { proxy_remark?: string })) => void
  setIdInput: (input: string) => void
  setFarmerHint: (hint: string) => void
  setFarmerId: (id: number | null) => void
  setTemplates: (templates: ExcelColumnTemplate[]) => void
  setLoadingVillages: (loading: boolean) => void
  setVillages: (villages: string[]) => void
  show: (msg: string, type?: 'ok' | 'err') => void
  load: () => void
  onSearch?: () => void
  sortField: string
  sortDir: 'asc' | 'desc'
  onSortChange: (field: string) => void
  handleFilterChange: (field: string, value: string) => void
  handleSearchChange: (value: string) => void
  clearFilters: () => void
  config: SubsidyListConfig
}

export default function SubsidyListBase({
  subsidyType, apps, total, page, loading, selectedIds, search, filters, villages, loadingVillages, templates,
  addOpen, editTarget, deleteId, form, idInput, farmerHint, farmerId,
  setApps, setTotal, setPage, setLoading, setSelectedIds, setSearch, setFilters,
  setAddOpen, setEditTarget, setDeleteId, setForm, setIdInput, setFarmerHint, setFarmerId,
  setTemplates, setLoadingVillages, setVillages,
  show, load, onSearch, handleFilterChange, handleSearchChange, clearFilters,
  sortField, sortDir, onSortChange,
  config,
}: SubsidyListBaseProps) {
  const navigate = useNavigate()
  const { apiBase, importTitle, exportPrefix, batchImportEndpoint, onExport, extraToolbar, preCheck, importFields } = config

  // 加载模板
  useEffect(() => { api.getExcelTemplates('SUBSIDY').then(setTemplates).catch(() => {}) }, [setTemplates])

  // 身份证查人
  useEffect(() => {
    if (idInput.length < 6) { setFarmerHint(''); setFarmerId(null); return }
    const t = setTimeout(async () => {
      const res = await api.getFarmers({ search: idInput, page_size: 1 })
      if (res.items.length) {
        const f = res.items[0]; setFarmerHint(`✓ ${f.real_name} · ${f.village_full_name}`); setFarmerId(f.id)
      } else { setFarmerHint('未找到该农户'); setFarmerId(null) }
    }, 400)
    return () => clearTimeout(t)
  }, [idInput, setFarmerHint, setFarmerId])

  // 按亩自动计算
  useEffect(() => {
    if (subsidyType.calc_mode !== 'per_mu') return
    const totalArea = Number(form.apply_area || 0) + Number((form as any).apply_area_no_calc || 0)
    if (totalArea <= 0) return
    const amt = Number(subsidyType.standard_amount || 0) * totalArea
    setForm(f => ({ ...f, apply_amount: Math.round(amt * 100) / 100, actual_amount: Math.round(amt * 100) / 100 }))
  }, [form.apply_area, (form as any).apply_area_no_calc, subsidyType, setForm])

  // ── 提交新增 ──
  const submitAdd = async () => {
    if (config.onSubmitAdd) {
      const ok = await config.onSubmitAdd()
      if (ok) { setAddOpen(false); load() }
      return
    }
    if (!farmerId) return show('请输入有效身份证号', 'err')
    try {
      await api.createApplication({ ...form, farmer_id: farmerId } as ApplicationCreate)
      show('✓ 记录创建成功'); setAddOpen(false); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 提交编辑 ──
  const submitEdit = async () => {
    if (config.onSubmitEdit) { await config.onSubmitEdit(); return }
    if (!editTarget) return
    try {
      await api.updateApplication(editTarget.id, {
        actual_amount: form.actual_amount, apply_area: form.apply_area,
        apply_area_no_calc: (form as any).apply_area_no_calc,
        contract_area: form.contract_area, trust_area: form.trust_area,
        no_subsidy_area: form.no_subsidy_area, pay_date: form.pay_date,
        remark: form.remark, pay_status: form.pay_status,
      })
      show('✓ 更新成功'); setEditTarget(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 打开编辑 ──
  const openEdit = (a: ApplicationSearchResult & { proxy_remark?: string | null }) => {
    const appOut: ApplicationOut = {
      id: a.id, farmer_id: a.farmer_id, farmer_name: a.farmer_name,
      village: a.village, subsidy_type_id: a.subsidy_type_id, subsidy_name: a.subsidy_name,
      calc_mode: a.calc_mode as 'fixed' | 'per_mu' | undefined, apply_year: a.apply_year,
      apply_amount: a.apply_amount, actual_amount: a.actual_amount, apply_area: a.apply_area,
      pay_status: a.pay_status, pay_date: a.pay_date, remark: a.remark,
    }
    setEditTarget(appOut)
    setForm({
      pay_status: a.pay_status, actual_amount: a.actual_amount ? Number(a.actual_amount) : undefined,
      apply_area: a.apply_area ? Number(a.apply_area) : undefined,
      contract_area: a.contract_area ? Number(a.contract_area) : undefined,
      trust_area: a.trust_area ? Number(a.trust_area) : undefined,
      no_subsidy_area: a.no_subsidy_area ? Number(a.no_subsidy_area) : undefined,
      pay_date: a.pay_date ?? undefined, remark: a.remark ?? undefined,
      proxy_remark: a.proxy_remark ?? undefined,
    })
  }

  // ── 删除 ──
  const deleteApp = async (id: number) => {
    try {
      const endpoint = config.deleteEndpoint ? config.deleteEndpoint(id) : `${apiBase}/${id}`
      await fetch(endpoint, { method: 'DELETE' })
      show('✓ 已删除'); setDeleteId(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 批量选择 ──
  const toggleSelectAll = () => setSelectedIds(selectedIds.length === apps.length ? [] : apps.map(a => a.id))
  const toggleSelect = (id: number) => {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }

  // ── Excel 导入 ──
  const handleImport = async (rows: Record<string, unknown>[], mapping?: Record<string, string>, overwrite?: boolean): Promise<{ created: number; skipped: number; errors: string[]; updated?: number }> => {
    const toCreate: Record<string, unknown>[] = []
    const errors: string[] = []
    const allIdCards = rows.map(r => String(r['身份证号*'] || r['身份证号'] || '').trim()).filter(Boolean)
    let farmerMap: Record<string, number> = {}
    if (allIdCards.length) {
      try { const res = await api.batchLookupFarmers(allIdCards); farmerMap = res.results } catch { /* ignore */ }
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const idCard = String(row['id_card'] || row['身份证号*'] || row['身份证号'] || '').trim()
      const realName = String(row['real_name'] || row['姓名*'] || row['姓名'] || '').trim()
      if (!idCard) { errors.push(`第${i + 2}行：缺少身份证号`); continue }
      if (!realName) { errors.push(`第${i + 2}行：缺少姓名`); continue }
      const farmerId = farmerMap[idCard] || 0
      const contractArea = Number(row['contract_area'] || row['承包地面积(亩)']) || 0
      const trustArea = Number(row['trust_area'] || row['代耕代种面积(亩)']) || 0
      const noSubsidyArea = Number(row['no_subsidy_area'] || row['不予补贴面积']) || undefined
      const applyAreaExplicit = Number(row['apply_area'] || row['计入超限面积'] || row['实际补贴面积'] || row['面积(亩)']) || 0
      const applyAreaNoCalc = Number(row['apply_area_no_calc'] || row['不计入超限面积'] || 0) || undefined
      const totalArea = applyAreaExplicit + (applyAreaNoCalc || 0)
      const area = applyAreaExplicit || (contractArea + trustArea || undefined)
      const amount = Number(row['actual_amount'] || row['实发金额']) || (totalArea ? totalArea * Number(subsidyType.standard_amount || 0) : undefined)
      const common = {
        farmer_id: farmerId, id_card: idCard, real_name: realName,
        village_name: String(row['village_name'] || row['所在村'] || '').trim() || undefined,
        group_no: String(row['group_no'] || row['所在组'] || '').trim() || undefined,
        subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year,
        apply_area: area, apply_area_no_calc: applyAreaNoCalc,
        contract_area: contractArea || undefined, trust_area: trustArea || undefined,
        no_subsidy_area: noSubsidyArea,
        remark: String(row['remark'] || row['备注'] || '').trim() || undefined,
        proxy_remark: String(row['proxy_remark'] || row['代领备注'] || '').trim() || undefined,
      }
      const rowData = { ...common, apply_amount: amount, actual_amount: undefined, pay_status: 0, pay_date: undefined }
      toCreate.push(config.buildImportRow ? config.buildImportRow(rowData) : rowData)
    }
    if (errors.length && !toCreate.length) return { created: 0, skipped: 0, errors }
    // 资格检查
    try {
      const chk = await fetch('/api/eligibility/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subsidy_type_id: subsidyType.id, year: subsidyType.subsidy_year, rows: toCreate.map(r => ({ id_card: String(r.id_card || ''), real_name: String(r.real_name || ''), apply_area: r.apply_area })) }),
      }).then(r => r.json()) as { passed: number; failed: number; rules_applied: number; passed_list: { id_card: string }[]; failed_list: { issues: string[] }[] }
      if (chk.rules_applied > 0 && chk.failed > 0) {
        const passedIds = new Set(chk.passed_list.map(p => p.id_card))
        const passedRows = toCreate.filter(r => passedIds.has(String(r.id_card || '')))
        if (passedRows.length === 0) return { created: 0, skipped: 0, errors: [`规则检查：全部 ${chk.failed} 条不通过`] }
        const res2 = await fetch(batchImportEndpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: passedRows, overwrite: overwrite || false }),
        }).then(r => r.json()) as { created: number; skipped: number; errors: string[]; new_farmers?: number; updated?: number }
        const newMsg = res2.new_farmers ? `，新建农户 ${res2.new_farmers} 人` : ''
        const updMsg = res2.updated ? `，覆盖 ${res2.updated} 条` : ''
        show(`✓ 通过规则 ${chk.passed} 条，导入 ${res2.created} 条${updMsg}；规则拒绝 ${chk.failed} 条${newMsg}`)
        load()
        return { ...res2, errors: [...errors, ...(res2.errors || [])] }
      }
    } catch (_) { /* 规则引擎出错不阻断 */ }
    const res = await fetch(batchImportEndpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: toCreate, overwrite: overwrite || false }),
    }).then(r => r.json()) as { created: number; skipped: number; errors: string[]; new_farmers?: number; updated?: number }
    const newMsg = res.new_farmers ? `，新建农户 ${res.new_farmers} 人` : ''
    const updMsg = res.updated ? `，覆盖 ${res.updated} 条` : ''
    show(`✓ 导入 ${res.created} 条${updMsg}，跳过 ${res.skipped} 条${newMsg}`)
    load()
    return { ...res, errors: [...errors, ...(res.errors || [])] }
  }

  // ── 导出 ──
  const handleExport = async () => {
    try {
      const res = await onExport(subsidyType.id)
      const rows = res.items.map(a => ({
        '姓名': a.farmer_name + (a.is_proxy === 1 ? '（代领）' : ''),
        '身份证': (a as any).id_card || a.id_card_masked || '', '手机号': a.phone || '',
        '所在村': a.village || '', '所在组': a.group_no || '',
        '计入超限面积': a.apply_area ?? '', '不计超限面积': a.apply_area_no_calc ?? '',
        '承包地面积': a.contract_area ?? '', '代耕代种面积': a.trust_area ?? '',
        '不予补贴面积': a.no_subsidy_area ?? '',
        '申请金额': a.apply_amount ? Number(a.apply_amount).toFixed(2) : '',
        '发放金额': a.actual_amount ? Number(a.actual_amount).toFixed(2) : '',
        '状态': PAY_STATUS[a.pay_status]?.label || '', '打款日期': a.pay_date ?? '',
        '备注': a.remark || '', '代领备注': a.proxy_remark || '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 14 }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, exportPrefix)
      XLSX.writeFile(wb, `${exportPrefix}_${subsidyType.subsidy_name}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) { show('导出失败：' + (e as Error).message, 'err') }
  }

  const totalAmt = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)

  // 模板
  const selectedTmpl = templates.find(t => t.id) || null
  const IMPORT_HEADERS = selectedTmpl
    ? selectedTmpl.column_mapping.filter(m => m.system_field).map(m => m.excel_column + (m.required ? '*' : ''))
    : ['身份证号*', '姓名*', '计入超限面积', '不计入超限面积', '承包地面积(亩)', '代耕代种面积(亩)', '不予补贴面积(亩)', '所在村', '所在组', '备注']
  const IMPORT_EXAMPLE = selectedTmpl
    ? [Object.fromEntries(selectedTmpl.column_mapping.filter(m => m.system_field).map(m => {
        const sample: Record<string, unknown> = { id_card: '510123196503154231', real_name: '张国强', actual_amount: 420, contract_area: 2.5, trust_area: 1.0, village_name: '红星村', group_no: '一组', remark: '', proxy_remark: '' }
        return [m.excel_column, sample[m.system_field!] ?? '']
      }))]
    : [{ '身份证号*': '510123196503154231', '姓名*': '张国强', '计入超限面积': 3.5, '不计入超限面积': 0.0, '承包地面积(亩)': 2.5, '代耕代种面积(亩)': 1.0, '不予补贴面积(亩)': 0.5, '所在村': '红星村', '所在组': '一组', '备注': '' }]

  const detectExcelColumns = async (columns: string[], sampleRows: Record<string, unknown>[]) => {
    try {
      const response = await fetch('/api/excel-templates/detect-columns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, business_type: 'SUBSIDY', sample_rows: sampleRows }),
      })
      if (!response.ok) throw new Error(`检测失败: ${response.status}`)
      const raw = await response.json()
      return { columns: (raw.columns || []).map((d: Record<string, unknown>) => ({ excel_column: d.excel_column, suggested_field: d.suggested_field, confidence: d.confidence ?? 0, alternatives: d.alternatives || [] })), recommended_templates: raw.recommended_templates || [] }
    } catch { return { columns: columns.map(col => ({ excel_column: col, suggested_field: null, confidence: 0, alternatives: [] })) } }
  }

  const saveColumnMappingTemplate = async (data: { template_name: string; template_year?: number; region_name?: string; business_type: string; column_mapping: Array<{ excel_column: string; system_field: string; aliases: string[]; required: boolean; transform?: string }> }) => {
    const response = await fetch('/api/excel-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!response.ok) throw new Error(`保存失败: ${response.status}`)
    return await response.json()
  }

  const importSysFields = importFields || DEFAULT_IMPORT_FIELDS

  return (
    <>
      {/* 表格区域 */}
      <div className="bg-white border border-border rounded-card overflow-x-auto shadow-card">
        {/* 筛选栏 */}
        <div className="px-4 py-3 border-b border-border bg-warm/10 flex flex-wrap items-center gap-3">
          <span className="text-xs text-text-muted">筛选：</span>
          <select value={filters.village} onChange={e => handleFilterChange('village', e.target.value)} className="border border-border rounded-btn px-2 py-1.5 text-xs bg-white outline-none">
            <option value="">全部村庄</option>
            {loadingVillages ? <option disabled>加载中...</option> : villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.payStatus} onChange={e => handleFilterChange('payStatus', e.target.value)} className="border border-border rounded-btn px-2 py-1.5 text-xs bg-white outline-none">
            <option value="">全部状态</option>
            <option value="0">待发放</option>
            <option value="1">发放中</option>
            <option value="2">已完成</option>
          </select>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-text-muted">金额:</span>
            <input type="number" value={filters.minAmount} onChange={e => handleFilterChange('minAmount', e.target.value)} placeholder="最低" className="w-16 border border-border rounded px-1.5 py-1 text-xs outline-none" />
            <span className="text-text-muted/50">-</span>
            <input type="number" value={filters.maxAmount} onChange={e => handleFilterChange('maxAmount', e.target.value)} placeholder="最高" className="w-16 border border-border rounded px-1.5 py-1 text-xs outline-none" />
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-text-muted">日期:</span>
            <input type="date" value={filters.dateFrom} onChange={e => handleFilterChange('dateFrom', e.target.value)} className="border border-border rounded px-1.5 py-1 text-xs outline-none" />
            <span className="text-text-muted/50">-</span>
            <input type="date" value={filters.dateTo} onChange={e => handleFilterChange('dateTo', e.target.value)} className="border border-border rounded px-1.5 py-1 text-xs outline-none" />
          </div>
          <div className="flex items-center gap-1 flex-1 min-w-[200px] max-w-[300px]">
            <input type="text" value={search} onChange={e => handleSearchChange(e.target.value)} placeholder="姓名/身份证" className="flex-1 border border-border rounded-btn px-2 py-1.5 text-xs outline-none" />
            <button onClick={() => onSearch ? onSearch() : setPage(1)} className="px-2 py-1 text-xs bg-primary rounded-btn hover:bg-primary/90 text-white">搜索</button>
          </div>
          <button onClick={clearFilters} className="text-xs text-text-muted hover:text-text-primary border border-border px-2 py-1 rounded" disabled={Object.values(filters).every(v => !v) && !search}>清除</button>
          <button onClick={handleExport} className="text-xs border border-emerald-300 text-emerald-700 px-2.5 py-1 rounded hover:bg-emerald-50 font-medium whitespace-nowrap">导出</button>
          {extraToolbar?.({ selectedIds, load, show })}
        </div>

        <table className="w-full border-collapse min-w-[950px]">
          <thead>
            <tr className="bg-warm/30 border-b-2 border-border">
              <th className="px-2 py-2 text-left text-xs text-text-muted font-semibold whitespace-nowrap">
                <button onClick={toggleSelectAll} className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${apps.length > 0 && selectedIds.length === apps.length ? 'bg-primary/90 border-emerald-600 text-white' : 'border-stone-300 hover:border-emerald-400'}`}>
                  {apps.length > 0 && selectedIds.length === apps.length && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  )}
                </button>
              </th>
              {HEADERS.map(h => {
                const field = SORTABLE_COLS[h]; const isNarrow = NARROW_COLS.has(h)
                return (
                  <th key={h} className={`px-1.5 py-2 text-center text-[11px] font-semibold leading-tight ${isNarrow ? 'max-w-[55px]' : 'text-left whitespace-nowrap'} ${field ? 'cursor-pointer select-none hover:text-text-primary' : 'text-text-muted'}`} onClick={field ? () => onSortChange(field) : undefined}>
                    {h}{field && sortField === field && <span className="ml-1 text-[10px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}{field && sortField !== field && <span className="ml-1 text-[10px] text-text-muted/20">⇅</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={16} className="text-center py-10 text-text-muted/50">加载中…</td></tr>}
            {!loading && (!apps || apps.length === 0) && (<tr><td colSpan={16} className="text-center py-10 text-text-muted/50 text-sm">暂无记录，通过「Excel 导入」或「＋ 新增一条」添加</td></tr>)}
            {!loading && apps && apps.map(a => (
              <tr key={a.id} className={`border-b border-border/50 hover:bg-warm/30 ${a.pay_status === 0 ? 'bg-amber-50/30' : ''}`}>
                <td className="px-2 py-2 text-center">
                  <button onClick={() => toggleSelect(a.id)} className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.includes(a.id) ? 'bg-primary/90 border-emerald-600 text-white' : 'border-stone-300 hover:border-emerald-400'}`}>
                    {selectedIds.includes(a.id) && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </button>
                </td>
                <td className="px-2 py-2 text-sm font-semibold whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <span className="cursor-pointer hover:text-primary/80 hover:underline decoration-dotted underline-offset-2" title="点击查看家庭户详情" onClick={() => { if (a.household_id) navigate(`/farmers?tab=households&householdId=${a.household_id}`) }}>{a.farmer_name}</span>
                    {a.is_proxy === 1 && <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">代领</span>}
                  </div>
                </td>
                <td className="px-2 py-2 text-xs font-mono text-text-muted whitespace-nowrap">{a.id_card_masked || '—'}</td>
                <td className="px-2 py-2 text-xs font-mono text-text-muted whitespace-nowrap">{a.phone || '—'}</td>
                <td className="px-2 py-2 text-xs text-text-muted whitespace-nowrap">{a.village || '—'}</td>
                <td className="px-2 py-2 text-xs text-text-muted whitespace-nowrap">{a.group_no || '—'}</td>
                <td className="px-1.5 py-2 text-xs font-mono font-bold text-text-primary text-right max-w-[55px]">{a.apply_area ? `${a.apply_area}` : '—'}</td>
                <td className="px-1.5 py-2 text-xs font-mono text-text-muted text-right max-w-[55px]">{a.apply_area_no_calc || '—'}</td>
                <td className="px-1.5 py-2 text-xs font-mono text-text-muted text-right max-w-[55px]">{a.contract_area || '—'}</td>
                <td className="px-1.5 py-2 text-xs font-mono text-text-muted text-right max-w-[55px]">{a.trust_area || '—'}</td>
                <td className="px-1.5 py-2 text-xs font-mono text-red-400 text-right max-w-[55px]">{a.no_subsidy_area || '—'}</td>
                <td className="px-1.5 py-2 text-xs font-mono text-text-muted text-right max-w-[55px]">{a.apply_amount ? `¥${fmt(a.apply_amount)}` : '—'}</td>
                <td className="px-2 py-2 text-sm font-mono font-bold text-primary whitespace-nowrap">
                  {a.actual_amount ? <span title={a.apply_amount && a.apply_amount !== a.actual_amount ? `申请：${fmt(a.apply_amount)}` : ''}>{fmt(a.actual_amount)}</span> : <span className="text-amber-500 font-normal text-xs">待发放</span>}
                </td>
                <td className="px-2 py-2"><Tag label={PAY_STATUS[a.pay_status]?.label || '—'} color={PAY_STATUS[a.pay_status]?.color as 'green'} /></td>
                <td className="px-2 py-2 text-xs font-mono text-text-muted whitespace-nowrap">{a.pay_date ?? '—'}</td>
                <td className="px-2 py-2 text-xs text-text-muted max-w-[120px] truncate" title={a.remark || ''}>{a.remark || '—'}</td>
                <td className="px-2 py-2 text-xs text-text-muted max-w-[120px] truncate" title={a.proxy_remark || ''}>{a.proxy_remark || '—'}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(a)} className="text-xs text-text-muted border border-border px-2 py-1 rounded hover:text-primary hover:border-primary/20">编辑</button>
                    <button onClick={() => navigate(`/proxy/application/${a.id}`, { state: { beneficiaryFarmerId: a.farmer_id, beneficiaryFarmerName: a.farmer_name } })} className={`text-xs px-2 py-1 rounded border ${a.is_proxy === 1 ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100' : 'text-text-muted border-border hover:text-text-primary hover:border-border'}`}>{a.is_proxy === 1 ? '代领中' : '代领'}</button>
                    <button onClick={() => setDeleteId(a.id)} className="text-xs text-red-400 border border-red-100 px-2 py-1 rounded hover:bg-red-50">删</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border/50 bg-warm/10 flex justify-between text-xs text-text-muted">
          <span>共{total}条</span>
          <span className="font-mono font-bold text-primary">实发合计 ¥{totalAmt.toFixed(2)}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 border border-border rounded disabled:opacity-40">‹</button>
            <span className="px-2 py-1">第{page}/{Math.max(1, Math.ceil(total / 20))}页</span>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 border border-border rounded disabled:opacity-40">›</button>
          </div>
        </div>
      </div>

      {/* 新增弹窗 */}
      <Modal open={addOpen} title={`新增 · ${subsidyType.subsidy_name}`} onClose={() => setAddOpen(false)} onConfirm={submitAdd}>
        <div className="space-y-3">
          <div><label className="block text-xs text-text-muted mb-1">农户身份证号 *</label>
            <input value={idInput} onChange={e => setIdInput(e.target.value)} placeholder="输入身份证号自动查找农户" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
            {farmerHint && <p className="text-xs mt-1" style={{ color: farmerId ? '#15803d' : '#dc2626' }}>{farmerHint}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {subsidyType.calc_mode === 'per_mu' && (<>
              <div><label className="block text-xs text-text-muted mb-1">承包地面积(亩)</label>
                <input type="number" step="0.01" value={form.contract_area ?? ''} onChange={e => { const ca = Number(e.target.value) || undefined; setForm(f => ({ ...f, contract_area: ca, apply_area: (ca || 0) + (f.trust_area || 0) || undefined })) }} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
              <div><label className="block text-xs text-text-muted mb-1">代耕代种面积(亩)</label>
                <input type="number" step="0.01" value={form.trust_area ?? ''} onChange={e => { const ta = Number(e.target.value) || undefined; setForm(f => ({ ...f, trust_area: ta, apply_area: (f.contract_area || 0) + (ta || 0) || undefined })) }} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <div><label className="block text-xs text-text-muted mb-1">计入超限计算的补贴面积(亩) <span className="text-text-muted/50">— 可手动填写</span></label>
                  <input type="number" step="0.01" value={form.apply_area ?? ''} onChange={e => setForm(f => ({ ...f, apply_area: Number(e.target.value) || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
                <div><label className="block text-xs text-text-muted mb-1">不计入超限计算的补贴面积(亩)</label>
                  <input type="number" step="0.01" value={(form as any).apply_area_no_calc ?? ''} onChange={e => setForm(f => ({ ...f, apply_area_no_calc: Number(e.target.value) || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
              </div>
            </>)}
            <div><label className="block text-xs text-text-muted mb-1">不予补贴面积(亩)</label>
              <input type="number" step="0.01" value={form.no_subsidy_area ?? ''} onChange={e => setForm(f => ({ ...f, no_subsidy_area: Number(e.target.value) || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
            <div><label className="block text-xs text-text-muted mb-1">实发金额(元)</label>
              <input type="number" step="0.01" value={form.actual_amount ?? ''} onChange={e => setForm(f => ({ ...f, actual_amount: Number(e.target.value) || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
            <div><label className="block text-xs text-text-muted mb-1">打款日期</label>
              <input type="date" value={form.pay_date ?? ''} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
            <div><label className="block text-xs text-text-muted mb-1">备注</label>
              <input value={form.remark ?? ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
            {config.renderAddFields?.()}
          </div>
        </div>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal open={!!editTarget} title={`编辑 · ${editTarget?.farmer_name}`} onClose={() => setEditTarget(null)} onConfirm={submitEdit}>
        <div className="grid grid-cols-2 gap-3">
          {subsidyType.calc_mode === 'per_mu' && (<>
            <div><label className="block text-xs text-text-muted mb-1">承包地面积(亩)</label>
              <input type="number" step="0.01" value={form.contract_area ?? ''} onChange={e => { const ca = Number(e.target.value) || undefined; setForm(f => ({ ...f, contract_area: ca, apply_area: (ca || 0) + (f.trust_area || 0) || undefined })) }} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
            <div><label className="block text-xs text-text-muted mb-1">代耕代种面积(亩)</label>
              <input type="number" step="0.01" value={form.trust_area ?? ''} onChange={e => { const ta = Number(e.target.value) || undefined; setForm(f => ({ ...f, trust_area: ta, apply_area: (f.contract_area || 0) + (ta || 0) || undefined })) }} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-text-muted mb-1">计入超限计算的补贴面积(亩) <span className="text-text-muted/50">— 可手动填写</span></label>
                <input type="number" step="0.01" value={form.apply_area ?? ''} onChange={e => setForm(f => ({ ...f, apply_area: Number(e.target.value) || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
              <div><label className="block text-xs text-text-muted mb-1">不计入超限计算的补贴面积(亩)</label>
                <input type="number" step="0.01" value={(form as any).apply_area_no_calc ?? ''} onChange={e => setForm(f => ({ ...f, apply_area_no_calc: Number(e.target.value) || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
            </div>
          </>)}
          <div><label className="block text-xs text-text-muted mb-1">不予补贴面积(亩)</label>
            <input type="number" step="0.01" value={form.no_subsidy_area ?? ''} onChange={e => setForm(f => ({ ...f, no_subsidy_area: Number(e.target.value) || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          <div><label className="block text-xs text-text-muted mb-1">实发金额(元)</label>
            <input type="number" step="0.01" value={form.actual_amount ?? ''} onChange={e => setForm(f => ({ ...f, actual_amount: Number(e.target.value) || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          <div><label className="block text-xs text-text-muted mb-1">发放状态</label>
            <select value={form.pay_status ?? 0} onChange={e => setForm(f => ({ ...f, pay_status: Number(e.target.value) }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
              <option value={0}>待发放</option><option value={1}>部分发放</option><option value={2}>已发放</option></select></div>
          <div><label className="block text-xs text-text-muted mb-1">打款日期</label>
            <input type="date" value={form.pay_date ?? ''} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          <div className="col-span-2"><label className="block text-xs text-text-muted mb-1">备注</label>
            <input value={form.remark ?? ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          <div className="col-span-2"><label className="block text-xs text-text-muted mb-1">代领备注</label>
            <input value={form.proxy_remark ?? ''} onChange={e => setForm(f => ({ ...f, proxy_remark: e.target.value || undefined }))} className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          {config.renderEditFields?.()}
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal open={deleteId !== null} title="确认删除" onClose={() => setDeleteId(null)} onConfirm={() => deleteApp(deleteId!)} confirmText="确认删除">
        <p className="text-sm text-text-primary">删除后无法恢复，确认要删除这条补贴记录吗？</p>
      </Modal>

      {/* Excel导入 */}
      <ExcelImportWithMapping open={addOpen} onClose={() => setAddOpen(false)}
        title={`${importTitle} · ${subsidyType.subsidy_name}`}
        templateHeaders={IMPORT_HEADERS} templateExample={IMPORT_EXAMPLE}
        systemFields={importSysFields} templates={templates} overwriteOption={true}
        onDetectColumns={detectExcelColumns} onSaveTemplate={saveColumnMappingTemplate}
        onImport={handleImport} onSuccess={load} preCheck={preCheck} />
    </>
  )
}
