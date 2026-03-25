import { useState, useEffect, useCallback } from 'react'
import Modal from '../components/Modal'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import type { ErrorLibraryItem, ErrorLibraryCreate, PageResult, ExcelColumnTemplate } from '../types'

const ERROR_TYPES = ['身份证错误', '重复人员', '已故', '身份冒用', '其他']
const SOURCES = ['预检发现', '外部核查', '手动录入']

const ERROR_LIBRARY_SYSTEM_FIELDS = [
  { field: "real_name",       label: "姓名",       required: true,  type: "string" },
  { field: "id_card",         label: "身份证号",   required: true,  type: "id_card" },
  { field: "error_type",      label: "错误类型",   required: true,  type: "string" },
  { field: "error_reason",    label: "错误原因",   required: true,  type: "string" },
  { field: "source",          label: "来源",       required: false, type: "string" },
  { field: "village_name",    label: "所在村",     required: false, type: "string" },
  { field: "group_no",        label: "所在组",     required: false, type: "string" },
  { field: "subsidy_name",    label: "补贴分类",   required: false, type: "string" },
  { field: "discovered_date", label: "发现日期",   required: false, type: "date" },
  { field: "remark",          label: "备注",       required: false, type: "string" },
]

const IMPORT_HEADERS = ['姓名*', '身份证号*', '错误类型*', '错误原因*', '来源', '所在村', '所在组', '补贴分类', '发现日期', '备注']
const IMPORT_EXAMPLE = [
  { '姓名*': '张三', '身份证号*': '510123196503154231', '错误类型*': '身份证错误', '错误原因*': '身份证号码校验不通过', '来源': '预检发现', '所在村': '红星村', '所在组': '一组', '补贴分类': '耕地地力保护补贴', '发现日期': '2025-03-15', '备注': '' },
]

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

export default function ErrorLibraryPage({ embedded = false }: { embedded?: boolean }) {
  const { toast, show } = useToast()
  const [items, setItems] = useState<ErrorLibraryItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterVillage, setFilterVillage] = useState('')
  const [filterSubsidy, setFilterSubsidy] = useState('')
  const [stats, setStats] = useState<{ total: number; by_type: Record<string, number> }>({ total: 0, by_type: {} })
  const [filterOptions, setFilterOptions] = useState<{ villages: string[]; subsidies: string[] }>({ villages: [], subsidies: [] })

  // 选择
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  // 新增/编辑弹窗
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<ErrorLibraryCreate>({
    real_name: '', id_card: '', error_type: '', error_reason: '', source: '手动录入',
    village_name: '', group_no: '', subsidy_name: '',
    discovered_date: '', subsidy_type_id: undefined, remark: '',
  })

  // Excel导入
  const [importOpen, setImportOpen] = useState(false)
  const [templates, setTemplates] = useState<ExcelColumnTemplate[]>([])

  const loadStats = useCallback(async () => {
    try { setStats(await req('/api/error-library/stats')) } catch { /* ignore */ }
  }, [])

  const loadFilterOptions = useCallback(async () => {
    try { setFilterOptions(await req('/api/error-library/filter-options')) } catch { /* ignore */ }
  }, [])

  const loadTemplates = useCallback(async () => {
    try {
      const res = await req<ExcelColumnTemplate[]>('/api/excel-templates?business_type=ERROR_LIBRARY')
      setTemplates(res)
    } catch { /* ignore */ }
  }, [])

  // Excel列名智能检测
  const detectExcelColumns = async (columns: string[], sampleRows: Record<string, unknown>[]) => {
    try {
      const response = await fetch('/api/excel-templates/detect-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, business_type: 'ERROR_LIBRARY', sample_rows: sampleRows }),
      })
      if (!response.ok) throw new Error(`检测失败: ${response.status}`)
      const raw = await response.json()
      const detected_mappings = (raw.columns || raw.detected_mappings || []).map((d: Record<string, unknown>) => ({
        excel_column: d.excel_column,
        suggested_field: d.suggested_field,
        confidence: d.confidence ?? d.suggested_confidence ?? 0,
        alternatives: d.alternatives || [],
      }))
      return { detected_mappings, recommended_templates: raw.recommended_templates || [] }
    } catch {
      return {
        detected_mappings: columns.map(col => ({ excel_column: col, suggested_field: null, confidence: 0, alternatives: [] }))
      }
    }
  }

  // 保存字段映射模板
  const saveColumnMappingTemplate = async (data: {
    template_name: string; template_year?: number; region_name?: string; business_type: string
    column_mapping: Array<{ excel_column: string; system_field: string; aliases: string[]; required: boolean; transform?: string }>
  }): Promise<{ id: number }> => {
    const response = await fetch('/api/excel-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`保存失败: ${response.status}`)
    const res = await response.json()
    loadTemplates()
    return res
  }

  // Excel导入处理
  const handleImport = async (rows: Record<string, unknown>[], _mapping?: Record<string, string>): Promise<{ created: number; skipped: number; errors: string[] }> => {
    const res = await req<{ created: number; skipped: number }>('/api/error-library/batch-import', {
      method: 'POST', body: JSON.stringify({ rows }),
    })
    return { created: res.created, skipped: res.skipped, errors: [] }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize }
      if (search) params.search = search
      if (filterType) params.error_type = filterType
      if (filterVillage) params.village_name = filterVillage
      if (filterSubsidy) params.subsidy_name = filterSubsidy
      const qs = new URLSearchParams(params as Record<string, string>).toString()
      const res = await req<PageResult<ErrorLibraryItem>>('/api/error-library?' + qs)
      setItems(res.items)
      setTotal(res.total)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setLoading(false) }
  }, [page, pageSize, search, filterType, filterVillage, filterSubsidy, show])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadFilterOptions() }, [loadFilterOptions])
  useEffect(() => { loadTemplates() }, [loadTemplates])

  const resetForm = () => {
    setEditId(null)
    setForm({
      real_name: '', id_card: '', error_type: '', error_reason: '', source: '手动录入',
      village_name: '', group_no: '', subsidy_name: '',
      discovered_date: '', subsidy_type_id: undefined, remark: '',
    })
  }

  const openAdd = () => { resetForm(); setModalOpen(true) }
  const openEdit = (item: ErrorLibraryItem) => {
    setEditId(item.id)
    setForm({
      real_name: item.real_name, id_card: item.id_card, error_type: item.error_type,
      error_reason: item.error_reason, source: item.source,
      village_name: item.village_name || '', group_no: item.group_no || '',
      subsidy_name: item.subsidy_name || '',
      discovered_date: item.discovered_date || '', subsidy_type_id: item.subsidy_type_id || undefined,
      remark: item.remark || '',
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.real_name.trim() || !form.id_card.trim() || !form.error_type || !form.error_reason.trim()) {
      show('请填写姓名、身份证、错误类型和错误原因', 'err'); return
    }
    try {
      if (editId) {
        await req('/api/error-library/' + editId, { method: 'PUT', body: JSON.stringify(form) })
        show('✓ 更新成功')
      } else {
        await req('/api/error-library', { method: 'POST', body: JSON.stringify(form) })
        show('✓ 创建成功')
      }
      setModalOpen(false); load(); loadStats(); loadFilterOptions()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除该记录？')) return
    try {
      await req('/api/error-library/' + id, { method: 'DELETE' })
      show('✓ 已删除'); load(); loadStats(); loadFilterOptions()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) { show('请先选择要删除的记录', 'err'); return }
    if (!confirm(`确认删除选中的 ${selectedIds.length} 条记录？`)) return
    try {
      const res = await req<{ deleted: number }>('/api/error-library/batch-delete', {
        method: 'POST', body: JSON.stringify({ ids: selectedIds }),
      })
      show(`✓ 已删除 ${res.deleted} 条记录`); setSelectedIds([]); load(); loadStats(); loadFilterOptions()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }
  const toggleSelectAll = () => {
    if (items.length > 0 && selectedIds.length === items.length) setSelectedIds([])
    else setSelectedIds(items.map(i => i.id))
  }

  const totalPages = Math.ceil(total / pageSize) || 1

  return (
    <div>
      {/* 统计卡片 - 非嵌入模式时显示 */}
      {!embedded && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
          <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
            <div className="text-2xl font-bold font-mono text-red-600">{stats.total}</div>
            <div className="text-xs text-stone-400 mt-1">错误记录总数</div>
          </div>
          {ERROR_TYPES.map(t => (
            <div key={t} className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
              <div className="text-lg font-bold font-mono text-stone-700">{stats.by_type[t] || 0}</div>
              <div className="text-xs text-stone-400 mt-1">{t}</div>
            </div>
          ))}
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="搜索姓名或身份证…" className="border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 w-56" />
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1) }}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400">
          <option value="">全部类型</option>
          {ERROR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterVillage} onChange={e => { setFilterVillage(e.target.value); setPage(1) }}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400">
          <option value="">全部村</option>
          {filterOptions.villages.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={filterSubsidy} onChange={e => { setFilterSubsidy(e.target.value); setPage(1) }}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400">
          <option value="">全部补贴分类</option>
          {filterOptions.subsidies.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex-1" />
        {selectedIds.length > 0 && (
          <button onClick={handleBatchDelete}
            className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-500">
            删除选中 ({selectedIds.length})
          </button>
        )}
        <button onClick={() => setImportOpen(true)}
          className="px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">
          Excel导入
        </button>
        <button onClick={openAdd}
          className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
          ＋ 新增
        </button>
      </div>

      {/* 数据表格 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-100 text-stone-500">
              <th className="px-3 py-2.5 text-left w-10">
                <button onClick={toggleSelectAll}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    items.length > 0 && selectedIds.length === items.length
                      ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-stone-300 hover:border-emerald-400'
                  }`}>
                  {items.length > 0 && selectedIds.length === items.length && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5 text-left">姓名</th>
              <th className="px-3 py-2.5 text-left">身份证号</th>
              <th className="px-3 py-2.5 text-left">错误类型</th>
              <th className="px-3 py-2.5 text-left">所在村</th>
              <th className="px-3 py-2.5 text-left">所在组</th>
              <th className="px-3 py-2.5 text-left">补贴分类</th>
              <th className="px-3 py-2.5 text-left">错误原因</th>
              <th className="px-3 py-2.5 text-left">来源</th>
              <th className="px-3 py-2.5 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="text-center py-10 text-stone-300">加载中…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={10} className="text-center py-10 text-stone-300">暂无数据</td></tr>
            )}
            {items.map(item => (
              <tr key={item.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                <td className="px-3 py-2.5">
                  <button onClick={() => toggleSelect(item.id)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedIds.includes(item.id)
                        ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-stone-300 hover:border-emerald-400'
                    }`}>
                    {selectedIds.includes(item.id) && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </td>
                <td className="px-3 py-2.5 font-medium text-stone-800">{item.real_name}</td>
                <td className="px-3 py-2.5 font-mono text-stone-600">{item.id_card}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    item.error_type === '已故' ? 'bg-gray-100 text-gray-600'
                    : item.error_type === '身份证错误' ? 'bg-red-50 text-red-600'
                    : item.error_type === '重复人员' ? 'bg-amber-50 text-amber-600'
                    : item.error_type === '身份冒用' ? 'bg-purple-50 text-purple-600'
                    : 'bg-stone-100 text-stone-500'
                  }`}>{item.error_type}</span>
                </td>
                <td className="px-3 py-2.5 text-stone-600">{item.village_name || '-'}</td>
                <td className="px-3 py-2.5 text-stone-600">{item.group_no || '-'}</td>
                <td className="px-3 py-2.5 text-stone-600 text-xs">{item.subsidy_name || '-'}</td>
                <td className="px-3 py-2.5 text-stone-600 max-w-xs truncate" title={item.error_reason}>{item.error_reason}</td>
                <td className="px-3 py-2.5 text-stone-400 text-xs">{item.source}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(item)} className="text-xs text-blue-500 hover:text-blue-700">编辑</button>
                    <button onClick={() => handleDelete(item.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 text-sm border border-stone-200 rounded-lg disabled:opacity-30 hover:bg-stone-50">上一页</button>
          <span className="text-sm text-stone-400">第 {page} / {totalPages} 页 · 共 {total} 条</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 text-sm border border-stone-200 rounded-lg disabled:opacity-30 hover:bg-stone-50">下一页</button>
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      <Modal open={modalOpen} title={editId ? '编辑错误记录' : '新增错误记录'}
        onClose={() => setModalOpen(false)} onConfirm={handleSave} confirmText={editId ? '保存' : '创建'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">姓名 *</label>
              <input value={form.real_name} onChange={e => setForm(f => ({ ...f, real_name: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">身份证号 *</label>
              <input value={form.id_card} onChange={e => setForm(f => ({ ...f, id_card: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">错误类型 *</label>
              <select value={form.error_type} onChange={e => setForm(f => ({ ...f, error_type: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400">
                <option value="">请选择</option>
                {ERROR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">来源</label>
              <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400">
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">所在村</label>
              <input value={form.village_name || ''} onChange={e => setForm(f => ({ ...f, village_name: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">所在组</label>
              <input value={form.group_no || ''} onChange={e => setForm(f => ({ ...f, group_no: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">补贴分类</label>
              <input value={form.subsidy_name || ''} onChange={e => setForm(f => ({ ...f, subsidy_name: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">错误原因 *</label>
            <textarea rows={3} value={form.error_reason} onChange={e => setForm(f => ({ ...f, error_reason: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">发现日期</label>
              <input type="date" value={form.discovered_date || ''} onChange={e => setForm(f => ({ ...f, discovered_date: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">备注</label>
              <input value={form.remark || ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>
        </div>
      </Modal>

      {/* Excel批量导入 */}
      <ExcelImportWithMapping
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="错误库导入"
        templateHeaders={IMPORT_HEADERS}
        templateExample={IMPORT_EXAMPLE}
        systemFields={ERROR_LIBRARY_SYSTEM_FIELDS}
        templates={templates.map(t => ({ id: t.id, template_name: t.template_name, column_mapping: t.column_mapping }))}
        onDetectColumns={detectExcelColumns}
        onSaveTemplate={saveColumnMappingTemplate}
        onImport={handleImport}
        onSuccess={() => { load(); loadStats(); loadFilterOptions() }} />

      <Toast {...toast} />
    </div>
  )
}
