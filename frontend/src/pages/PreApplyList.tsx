/**
 * 预申请列表组件
 * 显示预申请记录的表格、筛选、分页功能
 */
import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import * as api from '../api'
import type { ApplicationSearchResult, ApplicationCreate, ApplicationOut, ExcelColumnTemplate } from '../types'
import { PAY_STATUS, fmt } from '../utils'

interface PreApplyListProps {
  subsidyType: {
    id: number
    subsidy_year: number
    subsidy_name: string
    calc_mode: 'fixed' | 'per_mu' | undefined
    standard_amount: string | null
    standard_unit: string | null
  }
  apps: ApplicationSearchResult[]
  total: number
  page: number
  loading: boolean
  selectedIds: number[]
  search: string
  filters: {
    village: string
    payStatus: string
    minAmount: string
    maxAmount: string
    dateFrom: string
    dateTo: string
  }
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

  // 状态 setters
  setApps: (apps: ApplicationSearchResult[]) => void
  setTotal: (total: number) => void
  setPage: (page: number | ((prev: number) => number)) => void
  setLoading: (loading: boolean) => void
  setSelectedIds: (ids: number[] | ((prev: number[]) => number[])) => void
  setSearch: (search: string) => void
  setFilters: (filters: PreApplyListProps['filters']) => void
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

  // 回调函数
  show: (msg: string, type?: 'ok' | 'err') => void
  load: () => void
  handleFilterChange: (field: string, value: string) => void
  handleSearchChange: (value: string) => void
  clearFilters: () => void
}

const SUBSIDY_IMPORT_FIELDS = [
  { field: "id_card", label: "身份证号", required: true, type: "id_card" },
  { field: "real_name", label: "姓名", required: true, type: "string" },
  { field: "apply_area", label: "种植面积", required: false, type: "decimal" },
  { field: "contract_area", label: "承包地面积", required: false, type: "decimal" },
  { field: "trust_area", label: "代耕代种面积", required: false, type: "decimal" },
  { field: "no_subsidy_area", label: "不予补贴面积", required: false, type: "decimal" },
  { field: "village_name", label: "所在村", required: false, type: "string" },
  { field: "group_no", label: "所在组", required: false, type: "string" },
  { field: "remark", label: "备注", required: false, type: "string" },
  { field: "proxy_remark", label: "代领备注", required: false, type: "string" },
]

export default function PreApplyList({
  subsidyType,
  apps,
  total,
  page,
  loading,
  selectedIds,
  search,
  filters,
  villages,
  loadingVillages,
  templates,
  addOpen,
  editTarget,
  deleteId,
  form,
  idInput,
  farmerHint,
  farmerId,
  setApps,
  setTotal,
  setPage,
  setLoading,
  setSelectedIds,
  setSearch,
  setFilters,
  setAddOpen,
  setEditTarget,
  setDeleteId,
  setForm,
  setIdInput,
  setFarmerHint,
  setFarmerId,
  setTemplates,
  setLoadingVillages,
  setVillages,
  show,
  load,
  handleFilterChange,
  handleSearchChange,
  clearFilters,
}: PreApplyListProps) {
  const navigate = useNavigate()

  // 加载模板列表
  useEffect(() => {
    api.getExcelTemplates('SUBSIDY').then(setTemplates).catch(() => {})
  }, [setTemplates])

  // 身份证查人
  useEffect(() => {
    if (idInput.length < 6) { setFarmerHint(''); setFarmerId(null); return }
    const t = setTimeout(async () => {
      const res = await api.getFarmers({ search: idInput, page_size: 1 })
      if (res.items.length) {
        const f = res.items[0]
        setFarmerHint(`✓ ${f.real_name} · ${f.village_full_name}`)
        setFarmerId(f.id)
      } else { setFarmerHint('未找到该农户'); setFarmerId(null) }
    }, 400)
    return () => clearTimeout(t)
  }, [idInput, setFarmerHint, setFarmerId])

  // 按亩自动计算
  useEffect(() => {
    if (subsidyType.calc_mode !== 'per_mu' || !form.apply_area) return
    const amt = Number(subsidyType.standard_amount || 0) * Number(form.apply_area)
    setForm(f => ({ ...f, apply_amount: Math.round(amt * 100) / 100, actual_amount: Math.round(amt * 100) / 100 }))
  }, [form.apply_area, subsidyType, setForm])

  const submitAdd = async () => {
    if (!farmerId) return show('请输入有效身份证号', 'err')
    try {
      await api.createApplication({ ...form, farmer_id: farmerId } as ApplicationCreate)
      show('✓ 记录创建成功'); setAddOpen(false); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const submitEdit = async () => {
    if (!editTarget) return
    try {
      await api.updateApplication(editTarget.id, {
        actual_amount: form.actual_amount,
        apply_area: form.apply_area,
        contract_area: form.contract_area,
        trust_area: form.trust_area,
        no_subsidy_area: form.no_subsidy_area,
        pay_date: form.pay_date,
        remark: form.remark,
        pay_status: form.pay_status
      })
      show('✓ 更新成功'); setEditTarget(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openEdit = (a: ApplicationSearchResult & { proxy_remark?: string | null }) => {
    const appOut: ApplicationOut = {
      id: a.id,
      farmer_id: a.farmer_id,
      farmer_name: a.farmer_name,
      village: a.village,
      subsidy_type_id: a.subsidy_type_id,
      subsidy_name: a.subsidy_name,
      calc_mode: a.calc_mode as 'fixed' | 'per_mu' | undefined,
      apply_year: a.apply_year,
      apply_amount: a.apply_amount,
      actual_amount: a.actual_amount,
      apply_area: a.apply_area,
      pay_status: a.pay_status,
      pay_date: a.pay_date,
      remark: a.remark
    }
    setEditTarget(appOut)
    setForm({
      pay_status: a.pay_status,
      actual_amount: a.actual_amount ? Number(a.actual_amount) : undefined,
      apply_area: a.apply_area ? Number(a.apply_area) : undefined,
      contract_area: a.contract_area ? Number(a.contract_area) : undefined,
      trust_area: a.trust_area ? Number(a.trust_area) : undefined,
      no_subsidy_area: a.no_subsidy_area ? Number(a.no_subsidy_area) : undefined,
      pay_date: a.pay_date ?? undefined,
      remark: a.remark ?? undefined,
      proxy_remark: a.proxy_remark ?? undefined
    })
  }

  const deleteApp = async (id: number) => {
    try {
      await fetch(`/api/subsidies/applications/${id}`, { method: 'DELETE' })
      show('✓ 已删除'); setDeleteId(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // 批量选择
  const toggleSelectAll = () => {
    if (selectedIds.length === apps.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(apps.map(a => a.id))
    }
  }

  const toggleSelect = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(selectedId => selectedId !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  // 批量删除
  const batchDelete = async () => {
    if (selectedIds.length === 0) {
      show('请先选择要删除的记录', 'err')
      return
    }
    if (!confirm(`确定要删除选中的 ${selectedIds.length} 条记录吗？此操作不可恢复。`)) {
      return
    }
    try {
      const response = await fetch('/api/subsidies/applications/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      })
      if (!response.ok) throw new Error('批量删除失败')
      show(`✓ 已删除 ${selectedIds.length} 条记录`)
      setSelectedIds([])
      load()
    } catch (error) {
      console.error('批量删除失败:', error)
      show('批量删除失败: ' + (error as Error).message, 'err')
    }
  }

  // Excel导入
  const handleImport = async (rows: Record<string, unknown>[], mapping?: Record<string, string>): Promise<{ created: number; skipped: number; errors: string[] }> => {
    const toCreate: Record<string, unknown>[] = []
    const errors: string[] = []

    const allIdCards = rows.map(r => String(r['身份证号*'] || r['身份证号'] || '').trim()).filter(Boolean)
    let farmerMap: Record<string, number> = {}
    if (allIdCards.length) {
      try {
        const res = await api.batchLookupFarmers(allIdCards)
        farmerMap = res.results
      } catch { /* 批量查找失败不阻断 */ }
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const idCard = String(row['id_card'] || row['身份证号*'] || row['身份证号'] || '').trim()
      const realName = String(row['real_name'] || row['姓名*'] || row['姓名'] || '').trim()
      const villageName = String(row['village_name'] || row['所在村'] || '').trim()
      const groupNo = String(row['group_no'] || row['所在组'] || '').trim()
      if (!idCard) { errors.push(`第${i + 2}行：缺少身份证号`); continue }
      if (!realName) { errors.push(`第${i + 2}行：缺少姓名`); continue }
      const farmerId = farmerMap[idCard] || 0
      const contractArea = Number(row['contract_area'] || row['承包地面积(亩)']) || 0
      const trustArea = Number(row['trust_area'] || row['代耕代种面积(亩)']) || 0
      const noSubsidyArea = Number(row['no_subsidy_area'] || row['不予补贴面积']) || undefined
      const applyAreaExplicit = Number(row['apply_area'] || row['种植面积'] || row['面积(亩)']) || 0
      const area = applyAreaExplicit || (contractArea + trustArea || undefined)
      const amount = Number(row['actual_amount'] || row['实发金额']) || (area ? area * Number(subsidyType.standard_amount || 0) : undefined)

      toCreate.push({
        farmer_id: farmerId,
        id_card: idCard,
        real_name: realName,
        village_name: villageName || undefined,
        group_no: groupNo || undefined,
        subsidy_type_id: subsidyType.id,
        apply_year: subsidyType.subsidy_year,
        apply_area: area,
        contract_area: contractArea || undefined,
        trust_area: trustArea || undefined,
        no_subsidy_area: noSubsidyArea,
        apply_amount: amount,
        actual_amount: undefined,
        pay_status: 0,
        pay_date: undefined,
        remark: String(row['remark'] || row['备注'] || '').trim() || undefined,
        proxy_remark: String(row['proxy_remark'] || row['代领备注'] || '').trim() || undefined,
      })
    }
    if (errors.length && !toCreate.length) return { created: 0, skipped: 0, errors }

    // 资格规则检查
    try {
      const checkPayload = {
        subsidy_type_id: subsidyType.id,
        year: subsidyType.subsidy_year,
        rows: toCreate.map(r => ({
          id_card: String(r.id_card || ''),
          real_name: String(r.real_name || ''),
          apply_area: r.apply_area,
        })),
      }
      const chk = await fetch('/api/eligibility/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkPayload),
      }).then(r => r.json()) as {
        passed: number; failed: number; warning: number; rules_applied: number
        passed_list: { id_card: string }[]
        failed_list: { real_name: string; id_card_masked: string; issues: string[] }[]
        warning_list: { real_name: string; id_card_masked: string; warnings: string[] }[]
      }
      if (chk.rules_applied > 0 && (chk.failed > 0 || chk.warning > 0)) {
        const passedIds = new Set(chk.passed_list.map(p => p.id_card))
        const passedRows = toCreate.filter(r => passedIds.has(String(r.id_card || '')))
        if (passedRows.length === 0) return { created: 0, skipped: 0, errors: [`规则检查：全部 ${chk.failed} 条不通过`] }
        const res2 = await fetch('/api/subsidies/applications/batch-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: passedRows }),
        }).then(r => r.json()) as { created: number; skipped: number; errors: string[]; new_farmers?: number }
        const newMsg = res2.new_farmers ? `，新建农户 ${res2.new_farmers} 人` : ''
        show(`✓ 通过规则 ${chk.passed} 条，导入 ${res2.created} 条；规则拒绝 ${chk.failed} 条${newMsg}`)
        load()
        return { ...res2, errors: [...errors, ...(res2.errors || [])] }
      }
    } catch (_) { /* 规则引擎出错不阻断 */ }

    const res = await fetch('/api/subsidies/applications/batch-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: toCreate }),
    }).then(r => r.json()) as { created: number; skipped: number; errors: string[]; new_farmers?: number }
    const newMsg = res.new_farmers ? `，新建农户 ${res.new_farmers} 人` : ''
    show(`✓ 导入 ${res.created} 条，跳过 ${res.skipped} 条${newMsg}`)
    load()
    return { ...res, errors: [...errors, ...(res.errors || [])] }
  }

  const totalAmt = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)

  // 模板相关
  const selectedTmpl = templates.find(t => t.id) || null
  const IMPORT_HEADERS = selectedTmpl
    ? selectedTmpl.column_mapping.filter(m => m.system_field).map(m => m.excel_column + (m.required ? '*' : ''))
    : ['身份证号*', '姓名*', '种植面积', '承包地面积(亩)', '代耕代种面积(亩)', '不予补贴面积(亩)', '所在村', '所在组', '备注']
  const IMPORT_EXAMPLE = selectedTmpl
    ? [Object.fromEntries(selectedTmpl.column_mapping.filter(m => m.system_field).map(m => {
        const sample: Record<string, unknown> = {
          id_card: '510123196503154231', real_name: '张国强', actual_amount: 420,
          contract_area: 2.5, trust_area: 1.0,
          village_name: '红星村', group_no: '一组', remark: '', proxy_remark: '',
        }
        return [m.excel_column, sample[m.system_field!] ?? '']
      }))]
    : [{ '身份证号*': '510123196503154231', '姓名*': '张国强', '种植面积': 3.5, '承包地面积(亩)': 2.5, '代耕代种面积(亩)': 1.0, '不予补贴面积(亩)': 0.5, '所在村': '红星村', '所在组': '一组', '备注': '' }]

  const detectExcelColumns = async (columns: string[], sampleRows: Record<string, unknown>[]) => {
    try {
      const response = await fetch('/api/excel-templates/detect-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, business_type: 'SUBSIDY', sample_rows: sampleRows }),
      })
      if (!response.ok) throw new Error(`检测失败: ${response.status}`)
      const raw = await response.json()
      return {
        columns: (raw.columns || []).map((d: Record<string, unknown>) => ({
          excel_column: d.excel_column,
          suggested_field: d.suggested_field,
          confidence: d.confidence ?? 0,
          alternatives: d.alternatives || [],
        })),
        recommended_templates: raw.recommended_templates || [],
      }
    } catch (error) {
      return { columns: columns.map(col => ({ excel_column: col, suggested_field: null, confidence: 0, alternatives: [] })) }
    }
  }

  const saveColumnMappingTemplate = async (data: {
    template_name: string; template_year?: number; region_name?: string; business_type: string
    column_mapping: Array<{ excel_column: string; system_field: string; aliases: string[]; required: boolean; transform?: string }>
  }) => {
    const response = await fetch('/api/excel-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`保存失败: ${response.status}`)
    return await response.json()
  }

  return (
    <>
      {/* 表格区域 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto shadow-sm">
        {/* 筛选栏 */}
        <div className="px-4 py-3 border-b border-stone-200 bg-stone-50/50 flex flex-wrap items-center gap-3">
          <span className="text-xs text-stone-400">筛选：</span>
          <select value={filters.village} onChange={e => handleFilterChange('village', e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
            <option value="">全部村庄</option>
            {loadingVillages ? <option disabled>加载中...</option> : villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.payStatus} onChange={e => handleFilterChange('payStatus', e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
            <option value="">全部状态</option>
            <option value="0">待发放</option>
            <option value="1">发放中</option>
            <option value="2">已完成</option>
          </select>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-stone-400">金额:</span>
            <input type="number" value={filters.minAmount} onChange={e => handleFilterChange('minAmount', e.target.value)}
              placeholder="最低" className="w-16 border border-stone-200 rounded px-1.5 py-1 text-xs outline-none" />
            <span className="text-stone-300">-</span>
            <input type="number" value={filters.maxAmount} onChange={e => handleFilterChange('maxAmount', e.target.value)}
              placeholder="最高" className="w-16 border border-stone-200 rounded px-1.5 py-1 text-xs outline-none" />
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-stone-400">日期:</span>
            <input type="date" value={filters.dateFrom} onChange={e => handleFilterChange('dateFrom', e.target.value)}
              className="border border-stone-200 rounded px-1.5 py-1 text-xs outline-none" />
            <span className="text-stone-300">-</span>
            <input type="date" value={filters.dateTo} onChange={e => handleFilterChange('dateTo', e.target.value)}
              className="border border-stone-200 rounded px-1.5 py-1 text-xs outline-none" />
          </div>
          <div className="flex items-center gap-1 flex-1 min-w-[200px] max-w-[300px]">
            <input type="text" value={search} onChange={e => handleSearchChange(e.target.value)}
              placeholder="姓名/身份证" className="flex-1 border border-stone-200 rounded-lg px-2 py-1.5 text-xs outline-none" />
            <button onClick={() => setPage(1)} className="px-2 py-1 text-xs bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">搜索</button>
          </div>
          <button onClick={clearFilters} className="text-xs text-stone-400 hover:text-stone-600 border border-stone-200 px-2 py-1 rounded"
            disabled={Object.values(filters).every(v => !v) && !search}>清除</button>
        </div>

        <table className="w-full border-collapse min-w-[950px]">
          <thead>
            <tr className="bg-stone-50 border-b-2 border-stone-200">
              <th className="px-2 py-2 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">
                <button onClick={toggleSelectAll}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    apps.length > 0 && selectedIds.length === apps.length ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-stone-300 hover:border-emerald-400'
                  }`}>
                  {apps.length > 0 && selectedIds.length === apps.length && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </th>
              {['姓名', '身份证', '手机号', '所在村', '所在组', '实际补贴面积', '承包地面积', '代耕代种面积', '不予补贴面积', '申请金额', '发放金额', '状态', '打款日期', '备注', '代领备注', '操作'].map(h => (
                <th key={h} className="px-2 py-2 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={16} className="text-center py-10 text-stone-300">加载中…</td></tr>}
            {!loading && (!apps || apps.length === 0) && (
              <tr><td colSpan={16} className="text-center py-10 text-stone-300 text-sm">暂无记录，通过「Excel 导入」或「＋ 新增一条」添加</td></tr>
            )}
            {!loading && apps && apps.map(a => (
              <tr key={a.id} className={`border-b border-stone-50 hover:bg-stone-50 ${a.pay_status === 0 ? 'bg-amber-50/30' : ''}`}>
                <td className="px-2 py-2 text-center">
                  <button onClick={() => toggleSelect(a.id)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedIds.includes(a.id) ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-stone-300 hover:border-emerald-400'
                    }`}>
                    {selectedIds.includes(a.id) && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </td>
                <td className="px-2 py-2 text-sm font-semibold whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {a.farmer_name}
                    {a.is_proxy === 1 && <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">代领</span>}
                  </div>
                </td>
                <td className="px-2 py-2 text-xs font-mono text-stone-400 whitespace-nowrap">{a.id_card_masked || '—'}</td>
                <td className="px-2 py-2 text-xs font-mono text-stone-400 whitespace-nowrap">{a.phone || '—'}</td>
                <td className="px-2 py-2 text-xs text-stone-400 whitespace-nowrap">{a.village || '—'}</td>
                <td className="px-2 py-2 text-xs text-stone-400 whitespace-nowrap">{a.group_no || '—'}</td>
                <td className="px-2 py-2 text-xs font-mono font-bold text-stone-700">{a.apply_area ? `${a.apply_area}` : '—'}</td>
                <td className="px-2 py-2 text-xs font-mono text-stone-500">{a.contract_area || '—'}</td>
                <td className="px-2 py-2 text-xs font-mono text-stone-500">{a.trust_area || '—'}</td>
                <td className="px-2 py-2 text-xs font-mono text-red-400">{a.no_subsidy_area || '—'}</td>
                <td className="px-2 py-2 text-xs font-mono text-stone-500">{a.apply_amount ? `¥${fmt(a.apply_amount)}` : '—'}</td>
                <td className="px-2 py-2 text-sm font-mono font-bold text-emerald-700 whitespace-nowrap">
                  {a.actual_amount
                    ? <span title={a.apply_amount && a.apply_amount !== a.actual_amount ? `申请：${fmt(a.apply_amount)}` : ''}>{fmt(a.actual_amount)}</span>
                    : <span className="text-amber-500 font-normal text-xs">待发放</span>}
                </td>
                <td className="px-2 py-2"><Tag label={PAY_STATUS[a.pay_status]?.label || '—'} color={PAY_STATUS[a.pay_status]?.color as 'green'} /></td>
                <td className="px-2 py-2 text-xs font-mono text-stone-400 whitespace-nowrap">{a.pay_date ?? '—'}</td>
                <td className="px-2 py-2 text-xs text-stone-400 max-w-[120px] truncate" title={a.remark || ''}>{a.remark || '—'}</td>
                <td className="px-2 py-2 text-xs text-stone-500 max-w-[120px] truncate" title={a.proxy_remark || ''}>{a.proxy_remark || '—'}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(a)} className="text-xs text-stone-400 border border-stone-200 px-2 py-1 rounded hover:text-emerald-700 hover:border-emerald-200">编辑</button>
                    <button onClick={() => navigate(`/proxy/application/${a.id}`, { state: { beneficiaryFarmerId: a.farmer_id, beneficiaryFarmerName: a.farmer_name } })}
                      className={`text-xs px-2 py-1 rounded border ${a.is_proxy === 1 ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100' : 'text-stone-400 border-stone-200 hover:text-stone-600 hover:border-stone-300'}`}>
                      {a.is_proxy === 1 ? '代领中' : '代领'}
                    </button>
                    <button onClick={() => setDeleteId(a.id)} className="text-xs text-red-400 border border-red-100 px-2 py-1 rounded hover:bg-red-50">删</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-stone-100 bg-stone-50/50 flex justify-between text-xs text-stone-400">
          <span>共{total}条</span>
          <span className="font-mono font-bold text-emerald-700">实发合计 ¥{totalAmt.toFixed(2)}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">‹</button>
            <span className="px-2 py-1">第{page}/{Math.max(1, Math.ceil(total / 20))}页</span>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">›</button>
          </div>
        </div>
      </div>

      {/* 新增弹窗 */}
      <Modal open={addOpen} title={`新增 · ${subsidyType.subsidy_name}`} onClose={() => setAddOpen(false)} onConfirm={submitAdd}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1">农户身份证号 *</label>
            <input value={idInput} onChange={e => setIdInput(e.target.value)} placeholder="输入身份证号自动查找农户"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            {farmerHint && <p className="text-xs mt-1" style={{ color: farmerId ? '#15803d' : '#dc2626' }}>{farmerHint}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {subsidyType.calc_mode === 'per_mu' && (
              <>
                <div>
                  <label className="block text-xs text-stone-400 mb-1">承包地面积(亩)</label>
                  <input type="number" step="0.01" value={form.contract_area ?? ''} onChange={e => {
                    const ca = Number(e.target.value) || undefined
                    setForm(f => ({ ...f, contract_area: ca, apply_area: (ca || 0) + (f.trust_area || 0) || undefined }))
                  }}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                </div>
                <div>
                  <label className="block text-xs text-stone-400 mb-1">代耕代种面积(亩)</label>
                  <input type="number" step="0.01" value={form.trust_area ?? ''} onChange={e => {
                    const ta = Number(e.target.value) || undefined
                    setForm(f => ({ ...f, trust_area: ta, apply_area: (f.contract_area || 0) + (ta || 0) || undefined }))
                  }}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-stone-400 mb-1">实际补贴面积(亩) <span className="text-stone-300">— 可手动填写</span></label>
                  <input type="number" step="0.01" value={form.apply_area ?? ''} onChange={e => setForm(f => ({ ...f, apply_area: Number(e.target.value) || undefined }))}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs text-stone-400 mb-1">不予补贴面积(亩)</label>
              <input type="number" step="0.01" value={form.no_subsidy_area ?? ''} onChange={e => setForm(f => ({ ...f, no_subsidy_area: Number(e.target.value) || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">实发金额(元)</label>
              <input type="number" step="0.01" value={form.actual_amount ?? ''} onChange={e => setForm(f => ({ ...f, actual_amount: Number(e.target.value) || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">打款日期</label>
              <input type="date" value={form.pay_date ?? ''} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">备注</label>
              <input value={form.remark ?? ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>
        </div>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal open={!!editTarget} title={`编辑 · ${editTarget?.farmer_name}`} onClose={() => setEditTarget(null)} onConfirm={submitEdit}>
        <div className="grid grid-cols-2 gap-3">
          {subsidyType.calc_mode === 'per_mu' && (
            <>
              <div>
                <label className="block text-xs text-stone-400 mb-1">承包地面积(亩)</label>
                <input type="number" step="0.01" value={form.contract_area ?? ''} onChange={e => {
                  const ca = Number(e.target.value) || undefined
                  setForm(f => ({ ...f, contract_area: ca, apply_area: (ca || 0) + (f.trust_area || 0) || undefined }))
                }}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">代耕代种面积(亩)</label>
                <input type="number" step="0.01" value={form.trust_area ?? ''} onChange={e => {
                  const ta = Number(e.target.value) || undefined
                  setForm(f => ({ ...f, trust_area: ta, apply_area: (f.contract_area || 0) + (ta || 0) || undefined }))
                }}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-stone-400 mb-1">实际补贴面积(亩) <span className="text-stone-300">— 可手动填写</span></label>
                <input type="number" step="0.01" value={form.apply_area ?? ''} onChange={e => setForm(f => ({ ...f, apply_area: Number(e.target.value) || undefined }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs text-stone-400 mb-1">不予补贴面积(亩)</label>
            <input type="number" step="0.01" value={form.no_subsidy_area ?? ''} onChange={e => setForm(f => ({ ...f, no_subsidy_area: Number(e.target.value) || undefined }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div><label className="block text-xs text-stone-400 mb-1">实发金额(元)</label>
            <input type="number" step="0.01" value={form.actual_amount ?? ''} onChange={e => setForm(f => ({ ...f, actual_amount: Number(e.target.value) || undefined }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div><label className="block text-xs text-stone-400 mb-1">发放状态</label>
            <select value={form.pay_status ?? 0} onChange={e => setForm(f => ({ ...f, pay_status: Number(e.target.value) }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
              <option value={0}>待发放</option><option value={1}>部分发放</option><option value={2}>已发放</option>
            </select></div>
          <div><label className="block text-xs text-stone-400 mb-1">打款日期</label>
            <input type="date" value={form.pay_date ?? ''} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value || undefined }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">备注</label>
            <input value={form.remark ?? ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value || undefined }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">代领备注</label>
            <input value={form.proxy_remark ?? ''} onChange={e => setForm(f => ({ ...f, proxy_remark: e.target.value || undefined }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal open={deleteId !== null} title="确认删除" onClose={() => setDeleteId(null)}
        onConfirm={() => deleteApp(deleteId!)} confirmText="确认删除">
        <p className="text-sm text-stone-600">删除后无法恢复，确认要删除这条补贴记录吗？</p>
      </Modal>

      {/* Excel导入 */}
      <ExcelImportWithMapping open={addOpen} onClose={() => setAddOpen(false)}
        title={`导入预申请 · ${subsidyType.subsidy_name}`}
        templateHeaders={IMPORT_HEADERS}
        templateExample={IMPORT_EXAMPLE}
        systemFields={SUBSIDY_IMPORT_FIELDS}
        templates={templates}
        onDetectColumns={detectExcelColumns}
        onSaveTemplate={saveColumnMappingTemplate}
        onImport={handleImport}
        onSuccess={load} />
    </>
  )
}