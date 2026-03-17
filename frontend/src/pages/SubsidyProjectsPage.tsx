/**
 * 补贴项目管理页（替换原「补贴申请」Tab）
 *
 * 列表模式：补贴项目卡片，每项显示统计数据，点击「查看人员」进入记录子页
 * 子页模式：已筛选好的补贴申请记录，支持搜索/分页/新增/Excel导入/编辑
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

const PS_CFG: Record<number, { label: string; color: 'gray'|'amber'|'green' }> = {
  0: { label: '未发放',   color: 'gray'  },
  1: { label: '部分发放', color: 'amber' },
  2: { label: '已完成',   color: 'green' },
}

// ══════════════════════════════════════
//  项目列表页
// ══════════════════════════════════════
export default function SubsidyProjectsPage() {
  const { toast, show } = useToast()
  const [yearFilter, setYearFilter] = useState(thisYear)
  const [types, setTypes] = useState<StatsType[]>([])
  const [loading, setLoading] = useState(false)

  // 当前展开的项目（进入子页）
  const [activeType, setActiveType] = useState<StatsType | null>(null)

  // 新增/编辑项目弹窗
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<SubsidyType | null>(null)
  const [form, setForm] = useState<Partial<SubsidyTypeCreate>>({ subsidy_year: thisYear, calc_mode: 'fixed' })

  const loadTypes = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getSubsidyTypesWithStats(yearFilter)
      setTypes(data as StatsType[])
    } finally { setLoading(false) }
  }, [yearFilter])

  useEffect(() => { loadTypes() }, [loadTypes])

  const openAdd = () => {
    setEditing(null); setForm({ subsidy_year: yearFilter, calc_mode: 'fixed' }); setEditOpen(true)
  }
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

  // 进入子页时，把activeType传给RecordsPage
  if (activeType) {
    return (
      <RecordsPage
        subsidyType={activeType}
        onBack={() => { setActiveType(null); loadTypes() }}
        show={show}
        toast={toast}
      />
    )
  }

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <span className="text-xs text-stone-400">共 {types.length} 个补贴项目</span>
        <button onClick={openAdd} className="ml-auto px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
          ＋ 新增补贴项目
        </button>
      </div>

      {/* 说明 */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-sm text-blue-700">
        <strong>使用说明：</strong>先在此维护补贴项目（名称/标准/年度），再点击「查看人员」进入该项目的发放记录进行导入或逐条录入。
      </div>

      {loading && <div className="text-center py-12 text-stone-300">加载中…</div>}

      <div className="grid gap-3">
        {!loading && types.length === 0 && (
          <div className="text-center py-12 bg-white border border-stone-200 rounded-xl text-stone-300 text-sm">
            暂无 {yearFilter} 年度补贴项目，点击右上角新增
          </div>
        )}
        {types.map(t => {
          const ps = PS_CFG[t.pay_status] ?? PS_CFG[0]
          const rate = t.total_apply > 0
            ? Math.min(100, Math.round(t.total_actual / t.total_apply * 100))
            : (t.pay_status === 2 ? 100 : 0)
          return (
            <div key={t.id} className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm hover:border-stone-300 transition-colors">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  {/* 标题行 */}
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-bold text-stone-800 text-base">{t.subsidy_name}</span>
                    <Tag label={`${t.subsidy_year}年`} color="gray" />
                    <Tag label={t.calc_mode === 'per_mu' ? '按亩计算' : '固定金额'} color={t.calc_mode === 'per_mu' ? 'blue' : 'purple'} />
                    <Tag label={ps.label} color={ps.color} />
                  </div>
                  {/* 参数行 */}
                  <div className="flex gap-6 text-sm mb-3 flex-wrap">
                    <div>
                      <span className="text-stone-400">标准金额</span>
                      <span className="font-mono font-bold text-emerald-700 ml-2">
                        {t.standard_amount ? `¥${Number(t.standard_amount).toFixed(2)}` : '—'}
                        {t.standard_unit && <span className="text-xs text-stone-400 ml-1">{t.standard_unit}</span>}
                      </span>
                    </div>
                    {t.fund_source && <div><span className="text-stone-400">来源</span><span className="ml-2">{t.fund_source}</span></div>}
                    {t.apply_deadline && <div><span className="text-stone-400">截止</span><span className="font-mono text-xs ml-2">{t.apply_deadline}</span></div>}
                  </div>
                  {t.description && <p className="text-xs text-stone-400 mb-3">{t.description}</p>}
                  {/* 统计 + 进度条 */}
                  <div className="flex items-center gap-4">
                    <div className="flex gap-4 text-sm">
                      <span><span className="text-stone-400">受益</span><span className="font-bold text-blue-600 ml-1">{t.beneficiary_count}人</span></span>
                      <span><span className="text-stone-400">实发</span><span className="font-bold font-mono text-emerald-700 ml-1">{fmt(t.total_actual)}</span></span>
                      <span><span className="text-stone-400">记录</span><span className="text-stone-600 ml-1">{t.app_count}条</span></span>
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 bg-stone-100 rounded-full h-2 overflow-hidden">
                        <div className={`h-full rounded-full ${ps.color === 'green' ? 'bg-emerald-500' : ps.color === 'amber' ? 'bg-amber-400' : 'bg-stone-300'}`}
                          style={{ width: `${rate}%` }} />
                      </div>
                      <span className="text-xs text-stone-400 font-mono">{rate}%</span>
                    </div>
                  </div>
                </div>
                {/* 操作按钮 */}
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setActiveType(t)}
                    className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
                    查看人员 →
                  </button>
                  <button onClick={() => openEdit(t)}
                    className="px-3 py-2 text-sm border border-stone-200 text-stone-500 rounded-lg hover:border-stone-300">
                    编辑
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
            <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">补贴说明</label>
              <textarea rows={2} value={form.description ?? ''} onChange={e => setForm((f: typeof form) => ({ ...f, description: e.target.value || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" /></div>
          </div>
        </div>
      </Modal>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}

// ══════════════════════════════════════
//  补贴记录子页（某一项目下的人员）
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
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [subtypes, setSubtypes] = useState<(SubsidyType & { app_count?: number })[]>([])

  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ApplicationOut | null>(null)

  const [form, setForm] = useState<Partial<ApplicationCreate>>({
    pay_status: 2,
    subsidy_type_id: subsidyType.id,
    apply_year: subsidyType.subsidy_year,
  })
  const [idInput, setIdInput] = useState('')
  const [farmerHint, setFarmerHint] = useState('')
  const [farmerId, setFarmerId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = {
        page, page_size: 20,
        subsidy_type_id: subsidyType.id,  // 后端需支持此参数
      }
      if (search) params.search = search
      // 用 applications/search 接口
      const res = await api.searchApplications(params)
      setApps(res.items as ApplicationOut[]); setTotal(res.total)
    } finally { setLoading(false) }
  }, [page, search, subsidyType.id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.getVillageGroups().then(setGroups)
    api.getSubsidyTypes().then(setSubtypes)
  }, [])

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
      await api.updateApplication(editTarget.id, { actual_amount: form.actual_amount, pay_date: form.pay_date, remark: form.remark, pay_status: form.pay_status })
      show('✓ 更新成功'); setEditTarget(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openEdit = (a: ApplicationOut) => {
    setEditTarget(a)
    setForm({ pay_status: a.pay_status, actual_amount: a.actual_amount ? Number(a.actual_amount) : undefined, pay_date: a.pay_date ?? undefined, remark: a.remark ?? undefined })
  }

  // Excel导入
  const IMPORT_HEADERS = ['身份证号*', '年度*', '实发金额', '面积(亩)', '打款日期', '备注']
  const IMPORT_EXAMPLE = [{ '身份证号*': '510123196503154231', '年度*': subsidyType.subsidy_year, '实发金额': 420, '面积(亩)': 3.5, '打款日期': `${subsidyType.subsidy_year}-07-15`, '备注': '' }]

  const handleImport = async (rows: Record<string, unknown>[]): Promise<{ created: number; skipped: number; errors: string[] }> => {
    const toCreate: ApplicationCreate[] = []
    const errors: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const idCard = String(row['身份证号*'] || row['身份证号'] || '').trim()
      const year = Number(row['年度*'] || row['年度'] || subsidyType.subsidy_year)
      if (!idCard) { errors.push(`第${i+2}行：缺少身份证号`); continue }
      const fRes = await api.getFarmers({ search: idCard, page_size: 1 })
      if (!fRes.items.length) { errors.push(`第${i+2}行：找不到 ${idCard}`); continue }
      const f = fRes.items[0]
      const area = Number(row['面积(亩)']) || undefined
      const actual = Number(row['实发金额']) || (area ? area * Number(subsidyType.standard_amount || 0) : undefined)
      toCreate.push({
        farmer_id: f.id, subsidy_type_id: subsidyType.id, apply_year: year,
        apply_area: area, apply_amount: actual, actual_amount: actual,
        pay_status: 2,
        pay_date: String(row['打款日期'] || '').trim() || undefined,
        remark: String(row['备注'] || '').trim() || undefined,
      })
    }
    if (errors.length) { show(errors.slice(0,3).join('\n') + (errors.length>3?`…等${errors.length}个错误`:''), 'err'); return { created: 0, skipped: 0, errors } }
    const res = await api.batchImportApplications(toCreate)
    show(`✓ 导入成功 ${res.created} 条，跳过 ${res.skipped} 条`)
    load()
    return res
  }

  const totalAmt = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)

  return (
    <div>
      {/* 返回 + 标题 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-sm text-emerald-700 hover:underline">← 返回项目列表</button>
        <span className="text-stone-300">|</span>
        <span className="font-bold text-stone-800">{subsidyType.subsidy_name}</span>
        <Tag label={`${subsidyType.subsidy_year}年`} color="gray" />
        <Tag label={subsidyType.calc_mode === 'per_mu' ? '按亩计算' : '固定金额'} color={subsidyType.calc_mode === 'per_mu' ? 'blue' : 'purple'} />
        {subsidyType.standard_amount && (
          <span className="text-xs text-stone-400">
            标准：¥{Number(subsidyType.standard_amount).toFixed(2)}{subsidyType.standard_unit}
          </span>
        )}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="搜索姓名或身份证…"
          className="w-60 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 bg-white" />
        <span className="text-xs text-stone-400">共 {total} 条</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">
            ↑ Excel 导入人员
          </button>
          <button onClick={() => { setAddOpen(true); setIdInput(''); setFarmerHint(''); setFarmerId(null); setForm({ pay_status: 2, subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year }) }}
            className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
            ＋ 新增一条
          </button>
        </div>
      </div>

      {/* 记录表格 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
            {['姓名', '身份证', '所在位置', '申请面积', '申请金额', '实发金额', '状态', '打款日期', '操作'].map(h => (
              <th key={h} className="px-3.5 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="text-center py-10 text-stone-300">加载中…</td></tr>}
            {!loading && apps.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-stone-300">暂无记录，可通过「Excel导入」或「新增一条」添加</td></tr>}
            {!loading && apps.map(a => (
              <tr key={a.id} className="border-b border-stone-50 hover:bg-stone-50">
                <td className="px-3.5 py-2.5 text-sm font-semibold">{a.farmer_name}</td>
                <td className="px-3.5 py-2.5 text-xs font-mono text-stone-400">{(a as { id_card_masked?: string }).id_card_masked || '—'}</td>
                <td className="px-3.5 py-2.5 text-xs text-stone-400">{(a as { village?: string }).village || '—'}</td>
                <td className="px-3.5 py-2.5 text-sm font-mono">{a.apply_area ? `${a.apply_area}亩` : '—'}</td>
                <td className="px-3.5 py-2.5 text-sm font-mono text-stone-500">{fmt(a.apply_amount)}</td>
                <td className="px-3.5 py-2.5 text-sm font-mono font-bold text-emerald-700">{a.actual_amount ? fmt(a.actual_amount) : <span className="text-amber-500">待发放</span>}</td>
                <td className="px-3.5 py-2.5"><Tag label={PAY_STATUS[a.pay_status]?.label || '—'} color={PAY_STATUS[a.pay_status]?.color as 'green'} /></td>
                <td className="px-3.5 py-2.5 text-xs font-mono text-stone-400">{a.pay_date ?? '—'}</td>
                <td className="px-3.5 py-2.5">
                  <button onClick={() => openEdit(a)} className="text-xs text-stone-400 border border-stone-200 px-2.5 py-1 rounded-lg hover:text-emerald-700 hover:border-emerald-200">编辑</button>
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
          <div><label className="block text-xs text-stone-400 mb-1">实发金额(元)</label>
            <input type="number" step="0.01" value={form.actual_amount ?? ''} onChange={e => setForm(f => ({ ...f, actual_amount: Number(e.target.value) || undefined }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div><label className="block text-xs text-stone-400 mb-1">打款日期</label>
            <input type="date" value={form.pay_date ?? ''} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value || undefined }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">备注</label>
            <input value={form.remark ?? ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value || undefined }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
        </div>
      </Modal>

      <ExcelImport open={importOpen} onClose={() => setImportOpen(false)} title={`导入 · ${subsidyType.subsidy_name}`}
        templateHeaders={IMPORT_HEADERS} templateExample={IMPORT_EXAMPLE}
        onImport={handleImport} onSuccess={load} />

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
