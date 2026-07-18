import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import type { ApplicationOut, ApplicationCreate, SubsidyType, VillageGroup } from '../types'
import { PAY_STATUS, fmt, years } from '../utils'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImport from '../components/ExcelImport'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

export default function ApplicationsPage() {
  const { toast, show } = useToast()
  const [apps, setApps] = useState<ApplicationOut[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [villageFilter, setVillageFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [villages, setVillages] = useState<string[]>([])
  const [subsidyTypes, setSubsidyTypes] = useState<SubsidyType[]>([])
  const [groups, setGroups] = useState<VillageGroup[]>([])

  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ApplicationOut | null>(null)

  const [form, setForm] = useState<Partial<ApplicationCreate>>({ pay_status: 0 })
  const [farmerHint, setFarmerHint] = useState('')
  const [farmerId, setFarmerId] = useState<number | null>(null)
  const [idInput, setIdInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { year: yearFilter, page_size: 100 }
      if (villageFilter) params.village_name = villageFilter
      if (statusFilter !== '') params.pay_status = statusFilter
      const res = await api.getApplications(params)
      setApps(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }, [yearFilter, villageFilter, statusFilter])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.getVillageGroups().then(g => {
      setGroups(g)
      setVillages([...new Set(g.map(v => v.village_name))])
    })
    api.getSubsidyTypes().then(setSubsidyTypes)
  }, [])

  // 输入身份证查找农户
  useEffect(() => {
    if (idInput.length < 6) { setFarmerHint(''); setFarmerId(null); return }
    const t = setTimeout(async () => {
      try {
        const res = await api.getFarmers({ search: idInput, page_size: 1 })
        if (res.items.length) {
          const f = res.items[0]
          setFarmerHint(`✓ ${f.real_name} · ${f.village_full_name}`)
          setFarmerId(f.id)
        } else {
          setFarmerHint('未找到该农户')
          setFarmerId(null)
        }
      } catch { setFarmerHint('查询失败') }
    }, 400)
    return () => clearTimeout(t)
  }, [idInput])

  // 按亩自动计算金额
  useEffect(() => {
    if (!form.subsidy_type_id || !form.apply_area) return
    const st = subsidyTypes.find(t => t.id === form.subsidy_type_id)
    if (st?.calc_mode === 'per_mu' && st.standard_amount) {
      const calc = Number(st.standard_amount) * Number(form.apply_area)
      setForm(f => ({ ...f, apply_amount: Math.round(calc * 100) / 100 }))
    }
  }, [form.subsidy_type_id, form.apply_area, subsidyTypes])

  const selectedType = subsidyTypes.find(t => t.id === form.subsidy_type_id)

  const submitApp = async () => {
    if (!farmerId) return show('请输入有效的农户身份证号', 'err')
    if (!form.subsidy_type_id) return show('请选择补贴类型', 'err')
    try {
      await api.createApplication({ ...form, farmer_id: farmerId } as ApplicationCreate)
      show('✓ 补贴记录创建成功')
      setAddOpen(false); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const submitEdit = async () => {
    if (!editTarget) return
    try {
      await api.updateApplication(editTarget.id, {
        pay_status: form.pay_status,
        actual_amount: form.actual_amount,
        pay_date: form.pay_date,
        remark: form.remark,
      })
      show('✓ 更新成功')
      setEditTarget(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openEdit = (a: ApplicationOut) => {
    setEditTarget(a)
    setForm({ pay_status: a.pay_status, actual_amount: a.actual_amount ? Number(a.actual_amount) : undefined, pay_date: a.pay_date ?? undefined, remark: a.remark ?? undefined })
  }

  const totalAmt = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)

  // Excel 导入
  const IMPORT_HEADERS = ['身份证号*', '补贴类型名称*', '年度*', '申请金额', '实发金额', '面积(亩)', '发放状态', '打款日期', '备注']
  const IMPORT_EXAMPLE = [{ '身份证号*': '510123196503154231', '补贴类型名称*': '粮食直补', '年度*': 2024, '申请金额': 420, '实发金额': 420, '面积(亩)': 3.5, '发放状态': '已发放', '打款日期': '2024-07-15', '备注': '' }]

  const handleImport = async (rows: Record<string, unknown>[]) => {
    const toCreate: ApplicationCreate[] = []
    const errors: string[] = []
    const statusMap: Record<string, number> = { '待审核': 0, '审核通过': 1, '已发放': 2, '驳回': 3 }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const idCard = String(row['身份证号*'] || row['身份证号'] || '').trim()
      const stName = String(row['补贴类型名称*'] || row['补贴类型名称'] || '').trim()
      const year = Number(row['年度*'] || row['年度'])
      if (!idCard || !stName || !year) { errors.push(`第${i + 2}行：缺少必填字段`); continue }

      try {
        const fRes = await api.getFarmers({ search: idCard, page_size: 1 })
        if (!fRes.items.length) { errors.push(`第${i + 2}行：找不到身份证 ${idCard} 对应的农户`); continue }
        const farmer = fRes.items[0]
        const st = subsidyTypes.find(t => t.subsidy_name === stName && t.subsidy_year === year)
          || subsidyTypes.find(t => t.subsidy_name.includes(stName))
        if (!st) { errors.push(`第${i + 2}行：找不到补贴类型「${stName}」(${year}年)`); continue }
        toCreate.push({
          farmer_id: farmer.id,
          subsidy_type_id: st.id,
          apply_year: year,
          apply_amount: Number(row['申请金额']) || undefined,
          actual_amount: Number(row['实发金额']) || undefined,
          apply_area: Number(row['面积(亩)']) || undefined,
          pay_status: statusMap[String(row['发放状态'] || '')] ?? 0,
          pay_date: String(row['打款日期'] || '').trim() || undefined,
          remark: String(row['备注'] || '').trim() || undefined,
        })
      } catch { errors.push(`第${i + 2}行：查询失败`) }
    }

    if (toCreate.length === 0) return { created: 0, skipped: 0, errors }
    const res = await api.batchImportApplications(toCreate)
    return { ...res, errors: [...errors, ...res.errors] }
  }

  return (
    <div>
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <div className="flex gap-1">
          {[2024, 2023, 2022].map(y => (
            <button key={y} onClick={() => setYearFilter(y)}
              className={`px-3 py-1.5 text-sm rounded-btn border transition-colors
                ${yearFilter === y ? 'bg-primary-500 text-white border-emerald-700' : 'bg-white border-border text-text-primary hover:border-border'}`}>
              {y}年
            </button>
          ))}
        </div>
        <select value={villageFilter} onChange={e => setVillageFilter(e.target.value)}
          className="border border-border rounded-btn px-2 py-1.5 text-sm bg-white outline-none">
          <option value="">全部村庄</option>
          {villages.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-border rounded-btn px-2 py-1.5 text-sm bg-white outline-none">
          <option value="">全部状态</option>
          <option value="0">待审核</option><option value="1">审核通过</option>
          <option value="2">已发放</option><option value="3">驳回</option>
        </select>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setImportOpen(true)} className="px-3 py-1.5 text-sm border border-primary-500/20 text-primary rounded-btn hover:bg-primary-500/5">↑ Excel导入</button>
          <button onClick={() => { setAddOpen(true); setIdInput(''); setFarmerHint(''); setFarmerId(null); setForm({ pay_status: 0 }) }}
            className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-btn hover:bg-primary-500/90">＋ 新增记录</button>
        </div>
      </div>

      <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
        <table className="w-full border-collapse">
          <thead><tr className="bg-warm/30 border-b-2 border-border">
            {['农户姓名', '所在位置', '补贴类型', '计算方式', '申请金额', '实发金额', '面积(亩)', '状态', '打款日期', '操作'].map(h => (
              <th key={h} className="px-3.5 py-2.5 text-left text-xs text-text-muted font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="text-center py-10 text-text-muted text-sm">加载中…</td></tr>}
            {!loading && apps.map(a => (
              <tr key={a.id} className="border-b border-border/50 hover:bg-warm/30 transition-colors">
                <td className="px-3.5 py-2.5 text-sm font-semibold">{a.farmer_name}</td>
                <td className="px-3.5 py-2.5 text-xs text-text-muted">{(a as { village?: string }).village || '—'}</td>
                <td className="px-3.5 py-2.5 text-sm">{a.subsidy_name}</td>
                <td className="px-3.5 py-2.5">
                  <Tag label={(a as { calc_mode?: string }).calc_mode === 'per_mu' ? '按亩' : '固定'} color={(a as { calc_mode?: string }).calc_mode === 'per_mu' ? 'blue' : 'purple'} />
                </td>
                <td className="px-3.5 py-2.5 text-sm font-mono text-text-muted">{fmt(a.apply_amount)}</td>
                <td className="px-3.5 py-2.5 text-sm font-mono font-bold" style={{ color: a.actual_amount ? '#15803d' : '#d97706' }}>
                  {a.actual_amount ? fmt(a.actual_amount) : '待发放'}
                </td>
                <td className="px-3.5 py-2.5 text-sm">{a.apply_area ?? '—'}</td>
                <td className="px-3.5 py-2.5"><Tag label={PAY_STATUS[a.pay_status]?.label} color={PAY_STATUS[a.pay_status]?.color as 'green'} /></td>
                <td className="px-3.5 py-2.5 text-xs font-mono text-text-muted">{a.pay_date ?? '—'}</td>
                <td className="px-3.5 py-2.5">
                  <button onClick={() => openEdit(a)} className="text-xs text-text-muted border border-border px-2.5 py-1 rounded-btn hover:text-primary hover:border-primary-500/20">编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 text-xs text-text-muted border-t border-border/50 bg-warm/10 flex justify-between">
          <span>共 {total} 条记录</span>
          <span className="font-mono font-bold text-primary">实发合计 ¥{totalAmt.toFixed(2)}</span>
        </div>
      </div>

      {/* 新增弹窗 */}
      <Modal open={addOpen} title="新增补贴申请记录" onClose={() => setAddOpen(false)} onConfirm={submitApp}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">农户身份证号 *</label>
            <input value={idInput} onChange={e => setIdInput(e.target.value)} placeholder="输入身份证号自动查找农户"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            {farmerHint && <p className="text-xs mt-1" style={{ color: farmerId ? '#15803d' : '#dc2626' }}>{farmerHint}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">补贴类型 *</label>
              <select value={form.subsidy_type_id ?? ''} onChange={e => setForm(f => ({ ...f, subsidy_type_id: Number(e.target.value) }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                <option value="">请选择</option>
                {subsidyTypes.map(t => <option key={t.id} value={t.id}>{t.subsidy_name}（{t.subsidy_year}）</option>)}
              </select>
              {selectedType && (
                <p className="text-xs mt-1 text-blue-600">
                  {selectedType.calc_mode === 'per_mu'
                    ? `按亩计算：¥${selectedType.standard_amount}/亩，填写面积后自动计算`
                    : `固定金额：¥${selectedType.standard_amount} ${selectedType.standard_unit}`}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">申请年度</label>
              <select value={form.apply_year ?? yearFilter} onChange={e => setForm(f => ({ ...f, apply_year: Number(e.target.value) }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {selectedType?.calc_mode === 'per_mu' && (
              <div>
                <label className="block text-xs text-text-muted mb-1">申请面积(亩) — 填后自动计算金额</label>
                <input type="number" step="0.01" value={form.apply_area ?? ''} onChange={e => setForm(f => ({ ...f, apply_area: Number(e.target.value) || undefined }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
              </div>
            )}
            <div>
              <label className="block text-xs text-text-muted mb-1">申请金额(元)</label>
              <input type="number" step="0.01" value={form.apply_amount ?? ''} onChange={e => setForm(f => ({ ...f, apply_amount: Number(e.target.value) || undefined }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">实发金额(元)</label>
              <input type="number" step="0.01" value={form.actual_amount ?? ''} onChange={e => setForm(f => ({ ...f, actual_amount: Number(e.target.value) || undefined }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">发放状态</label>
              <select value={form.pay_status ?? 0} onChange={e => setForm(f => ({ ...f, pay_status: Number(e.target.value) }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                <option value={0}>待审核</option><option value={1}>审核通过</option>
                <option value={2}>已发放</option><option value={3}>驳回</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">打款日期</label>
              <input type="date" value={form.pay_date ?? ''} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value || undefined }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
          </div>
        </div>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal open={!!editTarget} title={`编辑记录 · ${editTarget?.farmer_name} · ${editTarget?.subsidy_name}`}
        onClose={() => setEditTarget(null)} onConfirm={submitEdit}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">实发金额(元)</label>
            <input type="number" step="0.01" value={form.actual_amount ?? ''} onChange={e => setForm(f => ({ ...f, actual_amount: Number(e.target.value) || undefined }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">发放状态</label>
            <select value={form.pay_status ?? 0} onChange={e => setForm(f => ({ ...f, pay_status: Number(e.target.value) }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              <option value={0}>待审核</option><option value={1}>审核通过</option>
              <option value={2}>已发放</option><option value={3}>驳回</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">打款日期</label>
            <input type="date" value={form.pay_date ?? ''} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value || undefined }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">备注</label>
            <input value={form.remark ?? ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value || undefined }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
          </div>
        </div>
      </Modal>

      <ExcelImport open={importOpen} onClose={() => setImportOpen(false)} title="补贴申请记录"
        templateHeaders={IMPORT_HEADERS} templateExample={IMPORT_EXAMPLE}
        onImport={handleImport} onSuccess={load} />

      <Toast {...toast} />
    </div>
  )
}
