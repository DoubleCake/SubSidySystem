/**
 * 补贴项目管理页 v2
 * - 项目卡片 + 状态切换 + 批量发放
 * - 进入子页查看/管理人员记录
 * - 记录支持搜索、新增、Excel导入、编辑、删除
 */
import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import type { SubsidyType, SubsidyTypeCreate, ApplicationOut, ApplicationCreate, VillageGroup } from '../types'
import { SUBSIDY_PAY_STATUS, PAY_STATUS, fmt, years } from '../utils'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImport from '../components/ExcelImport'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

const thisYear = new Date().getFullYear()
const FUND_SOURCES = ['中央', '省级', '市级', '县级', '镇级']
const UNITS = ['元/亩', '元/人', '元/户']

type StatsType = SubsidyType & {
  app_count: number; beneficiary_count: number
  total_apply: number; total_actual: number
}

const PS_CFG: Record<number, { label: string; color: 'gray'|'amber'|'green'; btn: string }> = {
  0: { label: '未发放',   color: 'gray',  btn: '标记发放中' },
  1: { label: '发放中',   color: 'amber', btn: '标记已完成' },
  2: { label: '已完成',   color: 'green', btn: '重置为未发放' },
}

// ══════════════════════════════════════
//  项目列表页
// ══════════════════════════════════════
export default function SubsidyProjectsPage() {
  const { toast, show } = useToast()
  const [yearFilter, setYearFilter] = useState(thisYear)
  const [types, setTypes] = useState<StatsType[]>([])
  const [loading, setLoading] = useState(false)
  const [activeType, setActiveType] = useState<StatsType | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<SubsidyType | null>(null)
  const [form, setForm] = useState<Partial<SubsidyTypeCreate>>({ subsidy_year: thisYear, calc_mode: 'fixed' })
  const [statusLoading, setStatusLoading] = useState<number | null>(null)

  const loadTypes = useCallback(async () => {
    setLoading(true)
    try { setTypes(await api.getSubsidyTypesWithStats(yearFilter) as StatsType[]) }
    finally { setLoading(false) }
  }, [yearFilter])

  useEffect(() => { loadTypes() }, [loadTypes])

  const openAdd = () => { setEditing(null); setForm({ subsidy_year: yearFilter, calc_mode: 'fixed' }); setEditOpen(true) }
  const openEdit = (t: SubsidyType) => {
    setEditing(t)
    setForm({ subsidy_name: t.subsidy_name, subsidy_year: t.subsidy_year, calc_mode: t.calc_mode,
      standard_amount: t.standard_amount ? Number(t.standard_amount) : undefined,
      standard_unit: t.standard_unit ?? undefined, fund_source: t.fund_source ?? undefined,
      apply_deadline: t.apply_deadline ?? undefined, description: t.description ?? undefined })
    setEditOpen(true)
  }

  const submitType = async () => {
    if (!form.subsidy_name) return show('请填写补贴名称', 'err')
    const autoUnit = form.calc_mode === 'per_mu' ? '元/亩' : (form.standard_unit || '元/户')
    const payload = { ...form, standard_unit: autoUnit }
    try {
      if (editing) { await api.updateSubsidyType(editing.id, payload); show('✓ 更新成功') }
      else { await api.createSubsidyType(payload as SubsidyTypeCreate); show('✓ 创建成功') }
      setEditOpen(false); loadTypes()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // 切换项目状态（0→1→2→0 循环，或直接设置）
  const changeStatus = async (t: StatsType, newStatus: number) => {
    setStatusLoading(t.id)
    try {
      await api.updateSubsidyType(t.id, { pay_status: newStatus })
      // 项目状态 → 已完成时，同步把所有记录也标为已发放
      if (newStatus === 2 && t.app_count > 0) {
        await fetch('/api/subsidies/applications/batch-pay', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subsidy_type_id: t.id, pay_status: 2,
            pay_date: new Date().toISOString().slice(0, 10) })
        })
        show(`✓ 项目已完成，${t.app_count} 条记录同步标为已发放`)
      } else {
        show(`✓ 已更新为「${PS_CFG[newStatus]?.label}」`)
      }
      loadTypes()
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setStatusLoading(null) }
  }

  if (activeType) {
    return <RecordsPage subsidyType={activeType} onBack={() => { setActiveType(null); loadTypes() }} show={show} toast={toast} />
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <span className="text-xs text-stone-400">共 {types.length} 个项目</span>
        <button onClick={openAdd} className="ml-auto px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">＋ 新增项目</button>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-xs text-blue-700">
        先在此维护补贴项目，再点「查看人员」进入发放记录。项目状态可随时手动切换，也可在记录页批量标记发放。
      </div>

      {loading && <div className="text-center py-12 text-stone-300">加载中…</div>}

      <div className="grid gap-3">
        {!loading && types.length === 0 && (
          <div className="text-center py-12 bg-white border border-stone-200 rounded-xl text-stone-300 text-sm">
            暂无 {yearFilter} 年度补贴项目
          </div>
        )}
        {types.map(t => {
          const ps = PS_CFG[t.pay_status] ?? PS_CFG[0]
          const nextStatus = (t.pay_status + 1) % 3
          const rate = t.total_apply > 0
            ? Math.min(100, Math.round(t.total_actual / t.total_apply * 100))
            : (t.pay_status === 2 ? 100 : 0)
          return (
            <div key={t.id} className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm hover:border-stone-300 transition-colors">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-bold text-stone-800 text-base">{t.subsidy_name}</span>
                    <Tag label={`${t.subsidy_year}年`} color="gray" />
                    <Tag label={t.calc_mode === 'per_mu' ? '按亩计算' : '固定金额'} color={t.calc_mode === 'per_mu' ? 'blue' : 'purple'} />
                    <Tag label={ps.label} color={ps.color} />
                    {t.fund_source && <span className="text-xs text-stone-300">{t.fund_source}</span>}
                  </div>
                  <div className="flex gap-6 text-sm mb-3 flex-wrap">
                    {t.standard_amount && (
                      <div><span className="text-stone-400">标准</span>
                        <span className="font-mono font-bold text-emerald-700 ml-1">¥{Number(t.standard_amount).toFixed(2)}</span>
                        <span className="text-xs text-stone-300 ml-0.5">{t.standard_unit}</span>
                      </div>
                    )}
                    <div><span className="text-stone-400">受益</span><span className="font-bold text-blue-600 ml-1">{t.beneficiary_count}人</span></div>
                    <div><span className="text-stone-400">实发</span><span className="font-bold font-mono text-emerald-700 ml-1">{fmt(t.total_actual)}</span></div>
                    <div><span className="text-stone-400">记录</span><span className="text-stone-600 ml-1">{t.app_count}条</span></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-stone-100 rounded-full h-2 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${ps.color==='green'?'bg-emerald-500':ps.color==='amber'?'bg-amber-400':'bg-stone-300'}`}
                        style={{ width: `${rate}%` }} />
                    </div>
                    <span className="text-xs text-stone-400 font-mono w-8">{rate}%</span>
                  </div>
                  {t.apply_deadline && <p className="text-xs text-stone-300 mt-1.5">截止：{t.apply_deadline}</p>}
                </div>

                {/* 操作区 */}
                <div className="flex flex-col gap-2 shrink-0">
                  <button onClick={() => setActiveType(t)}
                    className="px-3 py-1.5 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600 whitespace-nowrap">
                    查看人员 →
                  </button>
                  {/* 状态快速切换 */}
                  <div className="flex gap-1">
                    {[0, 1, 2].map(s => (
                      <button key={s}
                        onClick={() => changeStatus(t, s)}
                        disabled={statusLoading === t.id || t.pay_status === s}
                        title={PS_CFG[s].label}
                        className={`flex-1 py-1 text-xs rounded border transition-colors
                          ${t.pay_status === s
                            ? `${s===0?'bg-stone-100 border-stone-200 text-stone-500':s===1?'bg-amber-100 border-amber-300 text-amber-700':'bg-emerald-100 border-emerald-300 text-emerald-700'} font-semibold cursor-default`
                            : 'bg-white border-stone-200 text-stone-400 hover:border-stone-300'
                          }`}>
                        {PS_CFG[s].label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => openEdit(t)}
                    className="px-3 py-1.5 text-xs border border-stone-200 text-stone-500 rounded-lg hover:border-stone-300 text-center">
                    编辑项目
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 新增/编辑弹窗 */}
      <Modal open={editOpen} title={editing ? '编辑补贴项目' : '新增补贴项目'} onClose={() => setEditOpen(false)} onConfirm={submitType}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[{ val: 'fixed', title: '固定金额', desc: '每户/每人发固定金额', icon: '💰' },
              { val: 'per_mu', title: '按亩计算', desc: '每亩金额 × 土地面积', icon: '🌾' }].map(opt => (
              <div key={opt.val} onClick={() => setForm((f: typeof form) => ({ ...f, calc_mode: opt.val as 'fixed' | 'per_mu' }))}
                className={`border-2 rounded-xl p-3 cursor-pointer transition-colors
                  ${form.calc_mode === opt.val ? 'border-emerald-500 bg-emerald-50' : 'border-stone-200 hover:border-stone-300'}`}>
                <div className="text-xl mb-1">{opt.icon}</div>
                <div className="font-semibold text-sm">{opt.title}</div>
                <div className="text-xs text-stone-400">{opt.desc}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-stone-400 mb-1">补贴名称 *</label>
              <input value={form.subsidy_name ?? ''} onChange={e => setForm((f: typeof form) => ({ ...f, subsidy_name: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            <div><label className="block text-xs text-stone-400 mb-1">补贴年度 *</label>
              <select value={form.subsidy_year ?? thisYear} onChange={e => setForm((f: typeof form) => ({ ...f, subsidy_year: Number(e.target.value) }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select></div>
            <div><label className="block text-xs text-stone-400 mb-1">{form.calc_mode === 'per_mu' ? '每亩金额(元)' : '标准金额(元)'}</label>
              <input type="number" step="0.01" value={form.standard_amount ?? ''} onChange={e => setForm((f: typeof form) => ({ ...f, standard_amount: Number(e.target.value) || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            {form.calc_mode === 'fixed' && (
              <div><label className="block text-xs text-stone-400 mb-1">发放单位</label>
                <select value={form.standard_unit ?? '元/户'} onChange={e => setForm((f: typeof form) => ({ ...f, standard_unit: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select></div>
            )}
            <div><label className="block text-xs text-stone-400 mb-1">资金来源</label>
              <select value={form.fund_source ?? ''} onChange={e => setForm((f: typeof form) => ({ ...f, fund_source: e.target.value || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="">不限</option>{FUND_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div><label className="block text-xs text-stone-400 mb-1">申请截止日期</label>
              <input type="date" value={form.apply_deadline ?? ''} onChange={e => setForm((f: typeof form) => ({ ...f, apply_deadline: e.target.value || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            <div><label className="block text-xs text-stone-400 mb-1">发放状态</label>
              <select value={form.pay_status ?? 0} onChange={e => setForm((f: typeof form) => ({ ...f, pay_status: Number(e.target.value) }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value={0}>未发放</option><option value={1}>发放中</option><option value={2}>已完成</option>
              </select></div>
            <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">补贴说明</label>
              <textarea rows={2} value={form.description ?? ''} onChange={e => setForm((f: typeof form) => ({ ...f, description: e.target.value || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" /></div>
          </div>
        </div>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}

// ══════════════════════════════════════
//  补贴记录子页
// ══════════════════════════════════════
function RecordsPage({ subsidyType, onBack, show, toast }: {
  subsidyType: StatsType
  onBack: () => void
  show: (msg: string, type?: 'ok' | 'err') => void
  toast: { msg: string; type: 'ok' | 'err' } | null
}) {
  const [apps, setApps] = useState<ApplicationOut[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ApplicationOut | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [batchPayOpen, setBatchPayOpen] = useState(false)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [batchLoading, setBatchLoading] = useState(false)

  const [form, setForm] = useState<Partial<ApplicationCreate>>({
    pay_status: 2, subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year,
  })
  const [idInput, setIdInput] = useState('')
  const [farmerHint, setFarmerHint] = useState('')
  const [farmerId, setFarmerId] = useState<number | null>(null)

  // 关键修复：直接用 /applications 接口，传 subsidy_type_id 过滤
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = {
        page, page_size: 20,
        subsidy_type_id: subsidyType.id,
        year: subsidyType.subsidy_year,
      }
      if (search) params.search = search
      const res = await api.searchApplications(params)
      setApps(res.items as ApplicationOut[])
      setTotal(res.total)
    } finally { setLoading(false) }
  }, [page, search, subsidyType.id, subsidyType.subsidy_year])

  useEffect(() => { load() }, [load])

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
  }, [idInput])

  // 按亩自动计算
  useEffect(() => {
    if (subsidyType.calc_mode !== 'per_mu' || !form.apply_area) return
    const amt = Number(subsidyType.standard_amount || 0) * Number(form.apply_area)
    setForm(f => ({ ...f, apply_amount: Math.round(amt * 100) / 100, actual_amount: Math.round(amt * 100) / 100 }))
  }, [form.apply_area, subsidyType])

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
        actual_amount: form.actual_amount, pay_date: form.pay_date,
        remark: form.remark, pay_status: form.pay_status
      })
      show('✓ 更新成功'); setEditTarget(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openEdit = (a: ApplicationOut) => {
    setEditTarget(a)
    setForm({
      pay_status: a.pay_status,
      actual_amount: a.actual_amount ? Number(a.actual_amount) : undefined,
      apply_area: a.apply_area ? Number(a.apply_area) : undefined,
      pay_date: a.pay_date ?? undefined,
      remark: a.remark ?? undefined
    })
  }

  const deleteApp = async (id: number) => {
    try {
      await fetch(`/api/subsidies/applications/${id}`, { method: 'DELETE' })
      show('✓ 已删除'); setDeleteId(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // 批量标记已发放（对本项目所有未发放记录）
  const batchMarkPaid = async () => {
    setBatchLoading(true)
    try {
      const r = await fetch('/api/subsidies/applications/batch-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subsidy_type_id: subsidyType.id, pay_date: payDate, pay_status: 2 })
      }).then(r => r.json()) as { updated: number }
      show(`✓ 已批量标记 ${r.updated} 条为已发放`)
      setBatchPayOpen(false); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setBatchLoading(false) }
  }

  const IMPORT_HEADERS = ['身份证号*', '实发金额', '面积(亩)', '打款日期', '备注']
  const IMPORT_EXAMPLE = [{ '身份证号*': '510123196503154231', '实发金额': 420, '面积(亩)': 3.5, '打款日期': `${subsidyType.subsidy_year}-07-15`, '备注': '' }]

  const handleImport = async (rows: Record<string, unknown>[]): Promise<{ created: number; skipped: number; errors: string[] }> => {
    const toCreate: ApplicationCreate[] = []
    const errors: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const idCard = String(row['身份证号*'] || row['身份证号'] || '').trim()
      if (!idCard) { errors.push(`第${i + 2}行：缺少身份证号`); continue }
      const fRes = await api.getFarmers({ search: idCard, page_size: 1 })
      if (!fRes.items.length) { errors.push(`第${i + 2}行：找不到 ${idCard}`); continue }
      const f = fRes.items[0]
      const area = Number(row['面积(亩)']) || undefined
      const actual = Number(row['实发金额']) || (area ? area * Number(subsidyType.standard_amount || 0) : undefined)
      toCreate.push({
        farmer_id: f.id, subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year,
        apply_area: area, apply_amount: actual, actual_amount: actual,
        pay_status: 2,
        pay_date: String(row['打款日期'] || '').trim() || undefined,
        remark: String(row['备注'] || '').trim() || undefined,
      })
    }
    if (errors.length && !toCreate.length) return { created: 0, skipped: 0, errors }
    const res = await api.batchImportApplications(toCreate)
    show(`✓ 导入 ${res.created} 条，跳过 ${res.skipped} 条`)
    load()
    return { ...res, errors: [...errors, ...(res.errors || [])] }
  }

  const totalAmt = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
  const unpaidCount = apps.filter(a => a.pay_status === 0).length

  type AppRow = ApplicationOut & { id_card_masked?: string; village?: string }

  return (
    <div>
      {/* 面包屑 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={onBack} className="text-sm text-emerald-700 hover:underline">← 返回项目列表</button>
        <span className="text-stone-300">|</span>
        <span className="font-bold text-stone-800">{subsidyType.subsidy_name}</span>
        <Tag label={`${subsidyType.subsidy_year}年`} color="gray" />
        <Tag label={subsidyType.calc_mode === 'per_mu' ? '按亩计算' : '固定金额'} color={subsidyType.calc_mode === 'per_mu' ? 'blue' : 'purple'} />
        {subsidyType.standard_amount && (
          <span className="text-xs text-stone-400">标准：¥{Number(subsidyType.standard_amount).toFixed(2)}{subsidyType.standard_unit}</span>
        )}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="搜索姓名或身份证…"
          className="w-56 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 bg-white" />
        <span className="text-xs text-stone-400">共 {total} 条</span>
        {unpaidCount > 0 && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
            {unpaidCount} 条待发放
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {total > 0 && (
            <button onClick={() => setBatchPayOpen(true)}
              className="px-3 py-2 text-sm border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50">
              💰 批量标记发放
            </button>
          )}
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">
            ↑ Excel 导入
          </button>
          <button onClick={() => {
            setAddOpen(true); setIdInput(''); setFarmerHint(''); setFarmerId(null)
            setForm({ pay_status: 2, subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year })
          }} className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
            ＋ 新增一条
          </button>
        </div>
      </div>

      {/* 记录表格 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
            {['姓名', '身份证', '所在村组', '申请面积', '发放金额', '状态', '打款日期', '操作'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-10 text-stone-300">加载中…</td></tr>}
            {!loading && apps.length === 0 && (
              <tr><td colSpan={8} className="text-center py-10 text-stone-300 text-sm">
                暂无记录，通过「Excel 导入」或「＋ 新增一条」添加
              </td></tr>
            )}
            {!loading && (apps as AppRow[]).map(a => (
              <tr key={a.id} className={`border-b border-stone-50 hover:bg-stone-50 ${a.pay_status === 0 ? 'bg-amber-50/30' : ''}`}>
                <td className="px-3 py-2.5 text-sm font-semibold">{a.farmer_name}</td>
                <td className="px-3 py-2.5 text-xs font-mono text-stone-400">{a.id_card_masked || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-stone-400">{a.village || '—'}</td>
                <td className="px-3 py-2.5 text-sm font-mono">{a.apply_area ? `${a.apply_area}亩` : '—'}</td>
                <td className="px-3 py-2.5 text-sm font-mono font-bold text-emerald-700">
                  {a.actual_amount
                    ? <span title={a.apply_amount && a.apply_amount !== a.actual_amount ? `申请：${fmt(a.apply_amount)}` : ''}>{fmt(a.actual_amount)}</span>
                    : <span className="text-amber-500 font-normal text-xs">待发放</span>}
                </td>
                <td className="px-3 py-2.5"><Tag label={PAY_STATUS[a.pay_status]?.label || '—'} color={PAY_STATUS[a.pay_status]?.color as 'green'} /></td>
                <td className="px-3 py-2.5 text-xs font-mono text-stone-400">{a.pay_date ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(a)} className="text-xs text-stone-400 border border-stone-200 px-2 py-1 rounded hover:text-emerald-700 hover:border-emerald-200">编辑</button>
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
              <div>
                <label className="block text-xs text-stone-400 mb-1">申请面积(亩) — 填后自动计算</label>
                <input type="number" step="0.01" value={form.apply_area ?? ''} onChange={e => setForm(f => ({ ...f, apply_area: Number(e.target.value) || undefined }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
            )}
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
            <div><label className="block text-xs text-stone-400 mb-1">申请面积(亩)</label>
              <input type="number" step="0.01" value={form.apply_area ?? ''} onChange={e => setForm(f => ({ ...f, apply_area: Number(e.target.value) || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          )}
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
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal open={deleteId !== null} title="确认删除" onClose={() => setDeleteId(null)}
        onConfirm={() => deleteApp(deleteId!)} confirmText="确认删除">
        <p className="text-sm text-stone-600">删除后无法恢复，确认要删除这条补贴记录吗？</p>
      </Modal>

      {/* 批量标记发放 */}
      <Modal open={batchPayOpen} title="批量标记已发放" onClose={() => setBatchPayOpen(false)}
        onConfirm={batchMarkPaid} confirmText={batchLoading ? '处理中…' : '确认批量发放'}>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            将把「{subsidyType.subsidy_name}」下<strong>所有记录</strong>的状态更新为已发放，并统一设置打款日期。
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">打款日期 *</label>
            <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <p className="text-xs text-stone-400">当前共 {total} 条记录，其中 {unpaidCount} 条待发放</p>
        </div>
      </Modal>

      <ExcelImport open={importOpen} onClose={() => setImportOpen(false)} title={`导入 · ${subsidyType.subsidy_name}`}
        templateHeaders={IMPORT_HEADERS} templateExample={IMPORT_EXAMPLE}
        onImport={handleImport} onSuccess={load} />

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
