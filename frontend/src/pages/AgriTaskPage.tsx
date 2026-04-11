/**
 * 农业任务分解页
 * 任务列表：创建/预览/下达/撤回/填报完成情况
 * 村级土地信息维护入口：系统设置 → 村组管理 → 土地基础信息
 */
import { useState, useEffect, useCallback } from 'react'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

// ── 类型 ──────────────────────────────────
interface Task {
  id: number
  task_name: string
  crop_type: string
  total_area: number
  task_year: number
  season: string | null
  alloc_method: string
  alloc_method_label: string
  status: string
  status_label: string
  description: string | null
  operator: string | null
}

interface Allocation {
  village_id: number
  village_name: string
  alloc_area: number
  alloc_ratio: number
  basis_area: number
  actual_area: number | null
}

interface TaskDetail extends Task {
  allocations: Allocation[]
  total_actual_area: number | null
  completion_rate: number | null
}

interface PreviewAlloc {
  village_id: number
  village_name: string
  basis_area: number
  alloc_ratio: number
  alloc_area: number
}

interface PreviewResult {
  total_area: number
  alloc_method_label: string
  total_basis_area: number
  allocations: PreviewAlloc[]
}

interface Meta {
  alloc_methods: { value: string; label: string }[]
  statuses:      { value: string; label: string }[]
  crop_types:    string[]
}

// ── 工具 ──────────────────────────────────
const thisYear = new Date().getFullYear()
const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i)
const SEASONS = ['大春', '小春']

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) {
    const e = await r.json().catch(() => ({})) as { detail?: string }
    throw new Error(e.detail || '请求失败')
  }
  return r.json() as Promise<T>
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null ? '-' : Number(v).toFixed(digits)

const pct = (v: number | null | undefined) =>
  v == null ? '-' : `${Number(v).toFixed(1)}%`

const STATUS_COLOR: Record<string, string> = {
  DRAFT:  'bg-stone-100 text-stone-500',
  ISSUED: 'bg-blue-100 text-blue-700',
  DONE:   'bg-emerald-100 text-emerald-700',
}

const emptyForm = () => ({
  task_name: '', crop_type: '水稻', total_area: '',
  task_year: thisYear, season: '', alloc_method: 'CONTRACT_AREA', description: '',
})

// ══════════════════════════════════════════
export default function AgriTaskPage() {
  const { toast, show } = useToast()
  const [tasks, setTasks]     = useState<Task[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [filterYear, setFilterYear] = useState<number>(thisYear)
  const [filterStatus, setFilterStatus] = useState('')
  const [meta, setMeta]       = useState<Meta | null>(null)
  const [loading, setLoading] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm]       = useState(emptyForm())
  const [saving, setSaving]   = useState(false)

  const [detail, setDetail]   = useState<TaskDetail | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  const [editActual, setEditActual] = useState<Record<number, string>>({})

  const loadMeta = useCallback(async () => {
    try { setMeta(await req<Meta>('/api/agri-tasks/meta')) } catch { /* ignore */ }
  }, [])

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20' })
      if (filterYear)   p.set('task_year', String(filterYear))
      if (filterStatus) p.set('status', filterStatus)
      const res = await req<{ total: number; items: Task[] }>(`/api/agri-tasks?${p}`)
      setTasks(res.items); setTotal(res.total)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setLoading(false) }
  }, [page, filterYear, filterStatus, show])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadTasks() }, [loadTasks])

  const handleCreate = async () => {
    if (!form.task_name || !form.total_area) { show('任务名称和面积为必填', 'err'); return }
    setSaving(true)
    try {
      await req('/api/agri-tasks', { method: 'POST', body: JSON.stringify(form) })
      show('创建成功')
      setShowCreate(false); setForm(emptyForm()); loadTasks()
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setSaving(false) }
  }

  const handlePreview = async (taskId: number) => {
    setPreviewing(true)
    try {
      setPreview(await req<PreviewResult>(`/api/agri-tasks/${taskId}/preview`))
      setShowPreview(true)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setPreviewing(false) }
  }

  const handleIssue = async (taskId: number) => {
    if (!confirm('确认下达任务？下达后将保存分配方案。')) return
    try {
      const res = await req<{ village_count: number }>(`/api/agri-tasks/${taskId}/issue`, { method: 'POST' })
      show(`已下达，共分配至 ${res.village_count} 个村`)
      loadTasks()
      if (showDetail) loadDetail(taskId)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleRevoke = async (taskId: number) => {
    if (!confirm('确认撤回任务？将清除已保存的分配方案。')) return
    try {
      await req(`/api/agri-tasks/${taskId}/revoke`, { method: 'POST' })
      show('已撤回'); loadTasks()
      if (showDetail) loadDetail(taskId)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleDone = async (taskId: number) => {
    if (!confirm('确认标记为完成？')) return
    try {
      await req(`/api/agri-tasks/${taskId}/done`, { method: 'PUT' })
      show('已标记完成'); loadTasks()
      if (showDetail) loadDetail(taskId)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleDelete = async (taskId: number) => {
    if (!confirm('确认删除该任务？')) return
    try {
      await req(`/api/agri-tasks/${taskId}`, { method: 'DELETE' })
      show('已删除'); loadTasks()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const loadDetail = async (taskId: number) => {
    try {
      const d = await req<TaskDetail>(`/api/agri-tasks/${taskId}`)
      setDetail(d)
      const init: Record<number, string> = {}
      d.allocations.forEach(a => { init[a.village_id] = a.actual_area != null ? String(a.actual_area) : '' })
      setEditActual(init)
      setShowDetail(true)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleSaveActual = async (taskId: number, villageId: number) => {
    try {
      await req(`/api/agri-tasks/${taskId}/allocations/${villageId}/actual`, {
        method: 'PUT',
        body: JSON.stringify({ actual_area: editActual[villageId] === '' ? null : Number(editActual[villageId]) }),
      })
      show('保存成功'); loadDetail(taskId)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const totalPages = Math.ceil(total / 20)

  return (
    <div>
      <Toast {...toast} />
      <h1 className="text-xl font-bold text-stone-800 mb-4">农业任务分解</h1>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={filterYear} onChange={e => { setFilterYear(Number(e.target.value)); setPage(1) }}
          className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm bg-white">
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
          className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">全部状态</option>
          {(meta?.statuses || []).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button onClick={() => setShowCreate(true)}
          className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-1.5 rounded-lg">
          + 新建任务
        </button>
      </div>

      {/* 任务列表 */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              {['任务名称', '作物', '年度/季节', '总面积(亩)', '分配方式', '状态', '操作'].map(h => (
                <th key={h} className="px-4 py-3 text-left font-medium text-stone-500 text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-8 text-stone-400">加载中...</td></tr>}
            {!loading && tasks.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-stone-300">
                <div className="text-3xl mb-2">🌾</div>
                <div className="text-sm">暂无任务，点击「新建任务」开始</div>
              </td></tr>
            )}
            {tasks.map(t => (
              <tr key={t.id} className="border-b border-stone-100 hover:bg-stone-50 transition-colors">
                <td className="px-4 py-3 font-medium text-stone-800">{t.task_name}</td>
                <td className="px-4 py-3 text-stone-600">{t.crop_type}</td>
                <td className="px-4 py-3 text-stone-600">{t.task_year}{t.season ? `·${t.season}` : ''}</td>
                <td className="px-4 py-3 font-mono text-stone-700">{fmt(t.total_area)}</td>
                <td className="px-4 py-3 text-stone-500 text-xs">{t.alloc_method_label}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[t.status] || 'bg-stone-100 text-stone-500'}`}>
                    {t.status_label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={() => loadDetail(t.id)} className="text-blue-600 hover:underline">详情</button>
                    {t.status === 'DRAFT' && <>
                      <button onClick={() => handlePreview(t.id)} disabled={previewing} className="text-amber-600 hover:underline">预览</button>
                      <button onClick={() => handleIssue(t.id)} className="text-emerald-600 hover:underline">下达</button>
                      <button onClick={() => handleDelete(t.id)} className="text-red-400 hover:underline">删除</button>
                    </>}
                    {t.status === 'ISSUED' && <>
                      <button onClick={() => handleDone(t.id)} className="text-emerald-600 hover:underline">完成</button>
                      <button onClick={() => handleRevoke(t.id)} className="text-stone-400 hover:underline">撤回</button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 text-sm rounded ${p === page ? 'bg-emerald-600 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:border-emerald-300'}`}>
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ── 新建弹窗 ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建农业任务"
        onConfirm={handleCreate} confirmText={saving ? '保存中...' : '保存为草稿'}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">任务名称 *</label>
            <input value={form.task_name} onChange={e => setForm(f => ({ ...f, task_name: e.target.value }))}
              placeholder="如：2026年水稻种植任务"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">作物类型 *</label>
            <select value={form.crop_type} onChange={e => setForm(f => ({ ...f, crop_type: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white">
              {(meta?.crop_types || []).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">总面积（亩）*</label>
            <input type="number" min="0" step="0.01" value={form.total_area}
              onChange={e => setForm(f => ({ ...f, total_area: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">年度 *</label>
            <select value={form.task_year} onChange={e => setForm(f => ({ ...f, task_year: Number(e.target.value) }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">季节</label>
            <select value={form.season} onChange={e => setForm(f => ({ ...f, season: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">不限</option>
              {SEASONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">分配方式 *</label>
            <div className="grid grid-cols-2 gap-2">
              {(meta?.alloc_methods || []).map(m => (
                <label key={m.value} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors
                  ${form.alloc_method === m.value ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-stone-200 hover:border-stone-300'}`}>
                  <input type="radio" name="alloc_method" value={m.value}
                    checked={form.alloc_method === m.value}
                    onChange={() => setForm(f => ({ ...f, alloc_method: m.value }))}
                    className="accent-emerald-600" />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-stone-400 mt-1.5">
              {form.alloc_method === 'CONTRACT_AREA' && '依据：在册家庭户承包地面积汇总（自动统计）'}
              {form.alloc_method === 'PADDY_AREA'    && '依据：村组管理→土地基础信息 中的水田面积'}
              {form.alloc_method === 'DRY_AREA'      && '依据：村组管理→土地基础信息 中的旱地面积'}
              {form.alloc_method === 'ARABLE_AREA'   && '依据：村组管理→土地基础信息 中的可耕种面积'}
              {form.alloc_method === 'HISTORY_AREA'  && `依据：${form.task_year - 1}年补贴申请记录各村申报面积之和`}
            </p>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">任务说明</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
          </div>
        </div>
      </Modal>

      {/* ── 预览弹窗 ── */}
      <Modal open={showPreview} onClose={() => setShowPreview(false)} title="分配方案预览">
        {preview && (
          <div>
            <div className="flex flex-wrap gap-4 mb-4 text-sm bg-stone-50 rounded-lg p-3">
              <span>分配方式：<b className="text-stone-800">{preview.alloc_method_label}</b></span>
              <span>总面积：<b className="text-stone-800">{fmt(preview.total_area)} 亩</b></span>
              <span>依据总量：<b className="text-stone-800">{fmt(preview.total_basis_area)} 亩</b></span>
              <span>参与村数：<b className="text-stone-800">{preview.allocations.length} 个</b></span>
            </div>
            <div className="overflow-auto max-h-72 border border-stone-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 sticky top-0">
                  <tr>
                    {['村名', '依据面积(亩)', '分配比例', '分配面积(亩)'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs text-stone-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.allocations.map(a => (
                    <tr key={a.village_id} className="border-t border-stone-100">
                      <td className="px-3 py-2 font-medium">{a.village_name}</td>
                      <td className="px-3 py-2 font-mono text-stone-600">{fmt(a.basis_area)}</td>
                      <td className="px-3 py-2 text-stone-500">{pct(a.alloc_ratio * 100)}</td>
                      <td className="px-3 py-2 font-mono text-emerald-700 font-semibold">{fmt(a.alloc_area)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-stone-400 mt-3">预览仅供参考，实际下达时重新计算。</p>
          </div>
        )}
      </Modal>

      {/* ── 详情弹窗 ── */}
      <Modal open={showDetail} onClose={() => setShowDetail(false)}
        title={detail ? `${detail.task_name} · 详情` : '详情'}>
        {detail && (
          <div>
            <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
              {([
                ['作物', detail.crop_type],
                ['年度', `${detail.task_year}${detail.season ? '·' + detail.season : ''}`],
                ['总面积', `${fmt(detail.total_area)} 亩`],
                ['分配方式', detail.alloc_method_label],
                ['状态', detail.status_label],
                ['完成率', detail.completion_rate != null ? pct(detail.completion_rate) : '-'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="bg-stone-50 rounded-lg p-2">
                  <div className="text-xs text-stone-400">{k}</div>
                  <div className="font-medium text-stone-800 mt-0.5">{v}</div>
                </div>
              ))}
            </div>

            {detail.status === 'DRAFT' && (
              <div className="text-sm text-amber-600 bg-amber-50 rounded-lg p-3 mb-3">
                任务尚未下达，暂无分配明细。可先「预览」查看方案，确认后「下达」保存。
              </div>
            )}

            {detail.allocations.length > 0 && (
              <div className="overflow-auto max-h-56 border border-stone-200 rounded-lg mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 sticky top-0">
                    <tr>
                      {['村名', '依据面积', '分配比例', '分配面积', '实际完成', ''].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-xs text-stone-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.allocations.map(a => (
                      <tr key={a.village_id} className="border-t border-stone-100">
                        <td className="px-3 py-2 font-medium">{a.village_name}</td>
                        <td className="px-3 py-2 font-mono text-stone-500 text-xs">{fmt(a.basis_area)}</td>
                        <td className="px-3 py-2 text-stone-400 text-xs">{pct((a.alloc_ratio || 0) * 100)}</td>
                        <td className="px-3 py-2 font-mono text-emerald-700 font-semibold">{fmt(a.alloc_area)}</td>
                        <td className="px-3 py-2">
                          {detail.status !== 'DRAFT'
                            ? <input type="number" min="0" step="0.01"
                                value={editActual[a.village_id] ?? ''}
                                onChange={e => setEditActual(prev => ({ ...prev, [a.village_id]: e.target.value }))}
                                className="w-20 border border-stone-200 rounded px-2 py-0.5 text-xs font-mono" />
                            : <span className="text-stone-300">-</span>}
                        </td>
                        <td className="px-3 py-2">
                          {detail.status !== 'DRAFT' && (
                            <button onClick={() => handleSaveActual(detail.id, a.village_id)}
                              className="text-xs text-blue-600 hover:underline">保存</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-stone-50 border-t-2 border-stone-200">
                    <tr>
                      <td className="px-3 py-2 font-medium text-stone-600" colSpan={3}>合计</td>
                      <td className="px-3 py-2 font-mono font-bold text-emerald-700">{fmt(detail.total_area)}</td>
                      <td className="px-3 py-2 font-mono font-bold text-blue-700">
                        {detail.total_actual_area != null ? fmt(detail.total_actual_area) : '-'}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {detail.status === 'DRAFT' && <>
                <button onClick={() => { setShowDetail(false); handlePreview(detail.id) }}
                  className="px-3 py-1.5 text-sm text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50">预览分配</button>
                <button onClick={() => handleIssue(detail.id)}
                  className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">下达任务</button>
              </>}
              {detail.status === 'ISSUED' && <>
                <button onClick={() => handleRevoke(detail.id)}
                  className="px-3 py-1.5 text-sm text-stone-500 border border-stone-200 rounded-lg hover:bg-stone-50">撤回</button>
                <button onClick={() => handleDone(detail.id)}
                  className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">标记完成</button>
              </>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
