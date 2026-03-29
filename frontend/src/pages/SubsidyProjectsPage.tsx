/**
 * 补贴项目管理页 v2
 * - 项目卡片 + 状态切换 + 批量发放
 * - 进入子页查看/管理人员记录
 * - 记录支持搜索、新增、Excel导入、编辑、删除
 */
import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as api from '../api'
import type { SubsidyType, SubsidyTypeCreate, ApplicationOut, ApplicationCreate, VillageGroup, ApplicationForPrecheck, ApplicationSearchResult, ExcelColumnTemplate, CheckResult } from '../types'
import { SUBSIDY_PAY_STATUS, PAY_STATUS, fmt, years } from '../utils'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import ResultTable from '../components/ResultTable'
import { useToast } from '../hooks/useToast'
import EligibilityRulePage from './EligibilityRulePage'
import Toast from '../components/Toast'
import * as XLSX from 'xlsx'

const thisYear = new Date().getFullYear()
const FUND_SOURCES = ['中央', '省级', '市级', '县级', '镇级']
const UNITS = ['元/亩', '元/人', '元/户']

// 补贴业务系统字段定义
const SUBSIDY_SYSTEM_FIELDS = [
  { field: "id_card",       label: "身份证号", required: true,  type: "id_card" },
  { field: "real_name",     label: "姓名",     required: true,  type: "string" },
  { field: "actual_amount", label: "发放金额", required: false, type: "decimal" },
  { field: "apply_area",    label: "种植面积", required: false, type: "decimal" },
  { field: "contract_area", label: "承包地面积", required: false, type: "decimal" },
  { field: "trust_area",    label: "代耕代种面积", required: false, type: "decimal" },
  { field: "no_subsidy_area", label: "不予补贴面积", required: false, type: "decimal" },
  { field: "bank_card",     label: "银行卡号", required: false, type: "string" },
  { field: "pay_date",      label: "打款日期", required: false, type: "date" },
  { field: "remark",        label: "备注",     required: false, type: "string" },
  { field: "village_name",  label: "所在村",   required: false, type: "string" },
  { field: "group_no",      label: "所在组",   required: false, type: "string" },
]

// 预申请导入系统字段（不含发放金额、打款日期、银行卡号）
const PRE_APPLY_SYSTEM_FIELDS = [
  { field: "id_card",         label: "身份证号",     required: true,  type: "id_card" },
  { field: "real_name",       label: "姓名",         required: true,  type: "string" },
  { field: "apply_area",      label: "种植面积",     required: false, type: "decimal" },
  { field: "contract_area",   label: "承包地面积",   required: false, type: "decimal" },
  { field: "trust_area",      label: "代耕代种面积", required: false, type: "decimal" },
  { field: "no_subsidy_area", label: "不予补贴面积", required: false, type: "decimal" },
  { field: "village_name",    label: "所在村",       required: false, type: "string" },
  { field: "group_no",        label: "所在组",       required: false, type: "string" },
  { field: "remark",          label: "备注",         required: false, type: "string" },
]

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
  const location = useLocation()
  const navigate = useNavigate()
  
  // 从URL参数获取年份，如果没有则使用当前年份
  const searchParams = new URLSearchParams(location.search)
  const urlYear = searchParams.get('year')
  const initialYear = urlYear ? parseInt(urlYear, 10) : thisYear
  const [yearFilter, setYearFilter] = useState(initialYear)
  const [types, setTypes] = useState<StatsType[]>([])
  const [loading, setLoading] = useState(false)
  const [activeType, setActiveType] = useState<StatsType | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<SubsidyType | null>(null)
  const [form, setForm] = useState<Partial<SubsidyTypeCreate>>({ subsidy_year: thisYear, calc_mode: 'fixed' })
  const [statusLoading, setStatusLoading] = useState<number | null>(null)
  const [rulesPanelId, setRulesPanelId] = useState<number | null>(null)

  // 更新URL参数和状态
  const handleYearChange = (year: number) => {
    setYearFilter(year)
    // 更新URL参数
    const params = new URLSearchParams(location.search)
    params.set('year', year.toString())
    navigate(`?${params.toString()}`, { replace: true })
  }

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
      category: t.category ?? undefined,
      apply_deadline: t.apply_deadline ?? undefined, description: t.description ?? undefined,
      count_toward_area: (t as {count_toward_area?:number}).count_toward_area ?? 1 })
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

  const deleteProject = async (type_id: number) => {
    try {
      const response = await fetch(`/api/subsidies/types/${type_id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('删除失败')
      show('✓ 项目删除成功')
      loadTypes()
    } catch (error) {
      show('删除失败：' + (error as Error).message, 'err')
    }
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
        <select value={yearFilter} onChange={e => handleYearChange(Number(e.target.value))}
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
                  <button onClick={() => {
                    if (confirm(`确定要删除项目「${t.subsidy_name}」吗？\n\n⚠️ 警告：此操作会同时删除该项目下的所有补贴申请记录，且无法恢复！`)) {
                      deleteProject(t.id)
                    }
                  }}
                    className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-center">
                    删除项目
                  </button>
                  <button onClick={() => setRulesPanelId(rulesPanelId === t.id ? null : t.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg border text-center transition-colors ${rulesPanelId === t.id ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-stone-200 text-stone-500 hover:border-purple-200 hover:text-purple-600'}`}>
                    {rulesPanelId === t.id ? '▲ 收起规则' : '📋 资格规则'}
                  </button>
                </div>
              </div>
              {/* 资格规则面板（在卡片内部展开）*/}
              {rulesPanelId === t.id && (
                <div className="mt-4 pt-4 border-t border-stone-100">
                  <EligibilityRulePage subsidyTypeId={t.id} subsidyName={t.subsidy_name} />
                </div>
              )}
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
            <div><label className="block text-xs text-stone-400 mb-1">项目分类</label>
              <select value={form.category ?? ''} onChange={e => setForm((f: typeof form) => ({ ...f, category: e.target.value || undefined }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="">不分类</option>
                <option value="耕地保护">耕地保护补贴</option>
                <option value="大豆">大豆补贴</option>
                <option value="玉米">玉米补贴</option>
                <option value="稻谷">稻谷补贴</option>
                <option value="油菜">油菜补贴</option>
                <option value="其他">其他补贴</option>
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
            <div><label className="block text-xs text-stone-400 mb-1">计入承包面积</label>
              <select value={form.count_toward_area ?? 1} onChange={e => setForm((f: typeof form) => ({ ...f, count_toward_area: Number(e.target.value) }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value={1}>是（按亩补贴累计入承包面积）</option>
                <option value={0}>否（固定金额类不占用面积）</option>
              </select>
              <p className="text-xs text-stone-300 mt-1">影响家庭户超领预警的计算</p>
            </div>
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
  const [apps, setApps] = useState<ApplicationSearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  // 筛选状态
  const [filters, setFilters] = useState({
    village: '',
    payStatus: '',
    minAmount: '',
    maxAmount: '',
    dateFrom: '',
    dateTo: ''
  })
  // 村庄列表用于筛选
  const [villages, setVillages] = useState<string[]>([])
  const [loadingVillages, setLoadingVillages] = useState(false)

  // 当 subsidyType 改变时重置状态
  useEffect(() => {
    setApps([])
    setTotal(0)
    setPage(1)
    setSearch('')
  }, [subsidyType.id])

  // 加载模板列表
  useEffect(() => {
    api.getExcelTemplates('SUBSIDY').then(setTemplates).catch(() => {})
  }, [])

  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ApplicationOut | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [batchPayOpen, setBatchPayOpen] = useState(false)
  const [templates, setTemplates] = useState<ExcelColumnTemplate[]>([])
  const [selectedTmplId, setSelectedTmplId] = useState<number | null>(null)
  const [checkResult, setCheckResult] = useState<{
    passed:number; failed:number; warning:number
    failed_list:{real_name:string;id_card_masked:string;issues:string[]}[]
    warning_list:{real_name:string;id_card_masked:string;warnings:string[]}[]
  } | null>(null)
  const [checkOpen, setCheckOpen] = useState(false)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [batchLoading, setBatchLoading] = useState(false)

  const [form, setForm] = useState<Partial<ApplicationCreate>>({
    pay_status: 2, subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year,
  })
  const [idInput, setIdInput] = useState('')
  const [farmerHint, setFarmerHint] = useState('')
  const [farmerId, setFarmerId] = useState<number | null>(null)

  // 处理筛选变化
  const handleFilterChange = (field: string, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }))
    // 重置页码到第一页
    setPage(1)
  }

  // 清除所有筛选
  const clearFilters = () => {
    setFilters({
      village: '',
      payStatus: '',
      minAmount: '',
      maxAmount: '',
      dateFrom: '',
      dateTo: ''
    })
    setPage(1)
  }

  // 批量选择相关函数
  const toggleSelectAll = () => {
    if (selectedIds.length === apps.length) {
      // 如果已全选，则取消全选
      setSelectedIds([])
    } else {
      // 否则全选当前页所有记录
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

  // 批量删除选中的记录
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
      load() // 重新加载数据
    } catch (error) {
      console.error('批量删除失败:', error)
      show('批量删除失败: ' + (error as Error).message, 'err')
    }
  }

  // 获取村庄列表
  const loadVillages = useCallback(async () => {
    setLoadingVillages(true)
    try {
      const params = new URLSearchParams({
        subsidy_type_id: String(subsidyType.id),
        year: String(subsidyType.subsidy_year)
      })
      const response = await fetch(`/api/subsidies/applications/villages?${params}`)
      if (!response.ok) throw new Error('获取村庄列表失败')
      const data = await response.json()
      setVillages(data.villages || [])
    } catch (error) {
      console.error('加载村庄列表失败:', error)
    } finally {
      setLoadingVillages(false)
    }
  }, [subsidyType.id, subsidyType.subsidy_year])

  // Tab状态管理（必须在 load 之前声明，因为 load 依赖 activeTab）
  const [activeTab, setActiveTab] = useState<'preApply' | 'disbursement'>('preApply')
  const switchTab = (tab: 'preApply' | 'disbursement') => {
    setActiveTab(tab)
    setPage(1)
    setSelectedIds([])
  }

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
      // 按当前Tab自动过滤：预申请只显示 pay_status=0，发放只显示 pay_status>0
      if (filters.payStatus) {
        params.pay_status = filters.payStatus
      } else {
        params.pay_status = activeTab === 'preApply' ? 0 : '1,2'
      }
      if (filters.village) params.village = filters.village
      if (filters.minAmount) params.min_amount = filters.minAmount
      if (filters.maxAmount) params.max_amount = filters.maxAmount
      if (filters.dateFrom) params.date_from = filters.dateFrom
      if (filters.dateTo) params.date_to = filters.dateTo

      const res = await api.searchApplications(params)
      setApps(res.items)
      setTotal(res.total)
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally { setLoading(false) }
  }, [page, search, filters, subsidyType.id, subsidyType.subsidy_year, activeTab])

  useEffect(() => { 
    load()
    loadVillages()
  }, [load, loadVillages])

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
        actual_amount: form.actual_amount,
        apply_area: form.apply_area,
        contract_area: form.contract_area,
        trust_area: form.trust_area,
        no_subsidy_area: form.no_subsidy_area,
        pay_date: form.pay_date,
        remark: form.remark, pay_status: form.pay_status
      })
      show('✓ 更新成功'); setEditTarget(null); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openEdit = (a: ApplicationSearchResult) => {
    // 将ApplicationSearchResult转换为ApplicationOut
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

  // 将选中的预申请记录同步到发放列表（标记为 pay_status=2）
  const syncToDisbursement = async () => {
    if (selectedIds.length === 0) {
      show('请先选择要同步的记录', 'err')
      return
    }
    setBatchLoading(true)
    try {
      const r = await fetch('/api/subsidies/applications/batch-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_ids: selectedIds, pay_date: payDate || new Date().toISOString().slice(0, 10), pay_status: 2 })
      }).then(r => r.json()) as { updated: number }
      show(`✓ 已同步 ${r.updated} 条记录到发放列表`)
      setSelectedIds([])
      load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setBatchLoading(false) }
  }

  // 检测Excel列名
  const detectExcelColumns = async (columns: string[], sampleRows: Record<string, unknown>[]): Promise<{
    columns: Array<{
      excel_column: string
      suggested_field: string | null
      confidence: number
      alternatives: Array<{ field: string; confidence: number }>
    }>
    recommended_templates?: Array<{ id: number; template_name: string; match_rate: number }>
  }> => {
    try {
      const response = await fetch('/api/excel-templates/detect-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns,
          business_type: 'SUBSIDY',
          sample_rows: sampleRows
        }),
      })
      if (!response.ok) {
        throw new Error(`检测失败: ${response.status}`)
      }
      const raw = await response.json()
      const cols = (raw.columns || []).map((d: Record<string, unknown>) => ({
        excel_column: d.excel_column,
        suggested_field: d.suggested_field,
        confidence: d.confidence ?? d.suggested_confidence ?? 0,
        alternatives: d.alternatives || [],
      }))
      return {
        columns: cols,
        recommended_templates: raw.recommended_templates || [],
      }
    } catch (error) {
      console.error('检测列名失败:', error)
      return {
        columns: columns.map(col => ({
          excel_column: col,
          suggested_field: null,
          confidence: 0,
          alternatives: []
        }))
      }
    }
  }

  // 保存字段映射模板
  const saveColumnMappingTemplate = async (data: {
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
  }): Promise<{ id: number }> => {
    try {
      const response = await fetch('/api/excel-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(`保存失败: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      console.error('保存模板失败:', error)
      throw error
    }
  }


  // 选中的模板
  const selectedTmpl = templates.find(t => t.id === selectedTmplId) || null

  // 根据模板生成动态表头和示例，无模板时用默认（按当前 tab 区分）
  const isPreApply = activeTab === 'preApply'
  const IMPORT_HEADERS = selectedTmpl
    ? selectedTmpl.column_mapping.filter(m => m.system_field).map(m => m.excel_column + (m.required ? '*' : ''))
    : isPreApply
      ? ['身份证号*', '姓名*', '种植面积', '承包地面积(亩)', '代耕代种面积(亩)', '不予补贴面积(亩)', '所在村', '所在组', '备注']
      : ['身份证号*', '姓名*', '实发金额', '承包地面积(亩)', '代耕代种面积(亩)', '不予补贴面积(亩)', '打款日期', '所在村', '所在组', '备注']
  const IMPORT_EXAMPLE = selectedTmpl
    ? [Object.fromEntries(selectedTmpl.column_mapping.filter(m => m.system_field).map(m => {
        const sample: Record<string, unknown> = {
          id_card: '510123196503154231', real_name: '张国强', actual_amount: 420,
          contract_area: 2.5, trust_area: 1.0, pay_date: `${subsidyType.subsidy_year}-07-15`,
          village_name: '红星村', group_no: '一组', remark: '',
        }
        return [m.excel_column, sample[m.system_field!] ?? '']
      }))]
    : isPreApply
      ? [{ '身份证号*': '510123196503154231', '姓名*': '张国强', '种植面积': 3.5, '承包地面积(亩)': 2.5, '代耕代种面积(亩)': 1.0, '不予补贴面积(亩)': 0.5, '所在村': '红星村', '所在组': '一组', '备注': '' }]
      : [{ '身份证号*': '510123196503154231', '姓名*': '张国强', '实发金额': 420, '承包地面积(亩)': 2.5, '代耕代种面积(亩)': 1.0, '不予补贴面积(亩)': 0.5, '打款日期': `${subsidyType.subsidy_year}-07-15`, '所在村': '红星村', '所在组': '一组', '备注': '' }]

  // 模板列名→系统字段映射表（excel_column → system_field）
  const tmplMapping = selectedTmpl
    ? Object.fromEntries(selectedTmpl.column_mapping.filter(m => m.system_field).map(m => [m.excel_column, m.system_field!]))
    : null

  const handleImport = async (rows: Record<string, unknown>[], mapping?: Record<string, string>): Promise<{ created: number; skipped: number; errors: string[] }> => {
    // 如果有映射关系，先将 Excel 列名映射为系统字段名
    const effectiveMapping = mapping || tmplMapping
    if (effectiveMapping) {
      rows = rows.map(row => {
        const mapped: Record<string, unknown> = {}
        for (const [excelCol, val] of Object.entries(row)) {
          const sysField = effectiveMapping[excelCol]
          if (sysField) {
            mapped[sysField] = val
          } else {
            mapped[excelCol] = val
          }
        }
        return mapped
      })
    }

    const isPreApplyMode = activeTab === 'preApply'
    const toCreate: Record<string, unknown>[] = []
    const errors: string[] = []

    // ── 批量预加载农户映射（1次HTTP替代N次）──
    const allIdCards = rows
      .map(r => String(r['身份证号*'] || r['身份证号'] || '').trim())
      .filter(Boolean)
    let farmerMap: Record<string, number> = {}
    if (allIdCards.length) {
      try {
        const res = await api.batchLookupFarmers(allIdCards)
        farmerMap = res.results
      } catch { /* 批量查找失败不阻断，回退到后端自动创建 */ }
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const idCard    = String(row['id_card'] || row['身份证号*'] || row['身份证号'] || '').trim()
      const realName  = String(row['real_name'] || row['姓名*']   || row['姓名']   || '').trim()
      const villageName = String(row['village_name'] || row['所在村'] || '').trim()
      const groupNo   = String(row['group_no'] || row['所在组']  || '').trim()
      if (!idCard) { errors.push(`第${i + 2}行：缺少身份证号`); continue }
      if (!realName) { errors.push(`第${i + 2}行：缺少姓名（导入补贴时必须填姓名，用于自动创建农户）`); continue }
      // 从批量查找结果中获取 farmer_id，找不到则设 0（后端自动创建）
      const farmerId = farmerMap[idCard] || 0
      const contractArea = Number(row['contract_area'] || row['承包地面积(亩)']) || 0
      const trustArea = Number(row['trust_area'] || row['代耕代种面积(亩)']) || 0
      const noSubsidyArea = Number(row['no_subsidy_area'] || row['不予补贴面积']) || undefined
      const area = contractArea + trustArea || Number(row['apply_area'] || row['面积(亩)']) || undefined
      const amount = Number(row['actual_amount'] || row['实发金额']) || (area ? area * Number(subsidyType.standard_amount || 0) : undefined)

      toCreate.push({
        farmer_id: farmerId,   // 0 表示后端用 id_card 自动创建
        id_card: idCard,
        real_name: realName,
        village_name: villageName || undefined,
        group_no: groupNo || undefined,
        subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year,
        apply_area: area, contract_area: contractArea || undefined, trust_area: trustArea || undefined,
        no_subsidy_area: noSubsidyArea,
        apply_amount: isPreApplyMode ? amount : undefined,
        actual_amount: isPreApplyMode ? undefined : amount,
        pay_status: isPreApplyMode ? 0 : 2,
        pay_date: isPreApplyMode ? undefined : (String(row['pay_date'] || row['打款日期'] || '').trim() || undefined),
        remark: String(row['remark'] || row['备注'] || '').trim() || undefined,
      })
    }
    if (errors.length && !toCreate.length) return { created: 0, skipped: 0, errors }

    // ── 资格规则检查 ──
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkPayload),
      }).then(r => r.json()) as {
        passed:number; failed:number; warning:number; rules_applied:number
        passed_list:{farmer_id?:number;id_card:string}[]
        failed_list:{real_name:string;id_card_masked:string;issues:string[]}[]
        warning_list:{real_name:string;id_card_masked:string;warnings:string[]}[]
      }
      if (chk.rules_applied > 0 && (chk.failed > 0 || chk.warning > 0)) {
        setCheckResult({ passed:chk.passed, failed:chk.failed, warning:chk.warning,
          failed_list:chk.failed_list, warning_list:chk.warning_list })
        setCheckOpen(true)
        // 只保留通过规则检查的行
        const passedIds = new Set(chk.passed_list.map((p:{id_card:string}) => p.id_card))
        const passedRows = toCreate.filter(r => passedIds.has(String(r.id_card || '')))
        if (passedRows.length === 0) return { created: 0, skipped: 0, errors: [`规则检查：全部 ${chk.failed} 条不通过`] }
        // 继续只导入通过的
        const res2 = await fetch('/api/subsidies/applications/batch-import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: passedRows }),
        }).then(r => r.json()) as { created: number; skipped: number; errors: string[]; new_farmers?: number }
        const newMsg = res2.new_farmers ? `，新建农户 ${res2.new_farmers} 人` : ''
        show(`✓ 通过规则 ${chk.passed} 条，导入 ${res2.created} 条；规则拒绝 ${chk.failed} 条，警告 ${chk.warning} 条${newMsg}`)
        load()
        return { ...res2, errors: [...errors, ...(res2.errors || [])] }
      }
    } catch (_) { /* 规则引擎出错不阻断导入 */ }

    const res = await fetch('/api/subsidies/applications/batch-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: toCreate }),
    }).then(r => r.json()) as { created: number; skipped: number; errors: string[]; new_farmers?: number }
    const newMsg = res.new_farmers ? `，新建农户 ${res.new_farmers} 人` : ''
    show(`✓ 导入 ${res.created} 条，跳过 ${res.skipped} 条${newMsg}`)
    load()
    return { ...res, errors: [...errors, ...(res.errors || [])] }
  }

  const totalAmt = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
  const unpaidCount = apps.filter(a => a.pay_status === 0).length

  // 数据预检状态
  const [preCheckLoading, setPreCheckLoading] = useState(false)
  const [preCheckResults, setPreCheckResults] = useState<CheckResult | null>(null)

  // 批量选择状态
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  // 执行数据预检
  const runPreCheck = async () => {
    if (apps.length === 0) {
      show('暂无数据可预检', 'err')
      return
    }

    setPreCheckLoading(true)
    try {
      // 直接调用后端预检接口，在数据库端处理全部数据
      const params = new URLSearchParams()
      params.append('subsidy_typeId', String(subsidyType.id))
      if (filters.payStatus) {
        params.append('payStatus', String(filters.payStatus))
      } else {
        params.append('payStatus', activeTab === 'preApply' ? '0' : '1,2')
      }
      if (filters.village) params.append('villageName', filters.village)

      const response = await fetch(`/api/subsidies/applications/precheck?${params}`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('预检请求失败')

      const result = await response.json()
      const summary = result.summary || {}
      const okCount = summary.ok_rows || 0
      const errorCount = summary.error_rows || 0
      const total = summary.total_rows || 0

      setPreCheckResults(result as CheckResult)

      show(`预检完成：共${total}条，${okCount}条通过，${errorCount}条错误，${summary.gender_mismatch || 0}条警告`)
    } catch (error) {
      show('数据预检失败：' + (error as Error).message, 'err')
    } finally {
      setPreCheckLoading(false)
    }
  }

  // 可视化统计数据
  const [stats, setStats] = useState<{
    totalAmount: number
    totalFarmers: number
    villageDistribution: Array<{ village: string; amount: number; count: number }>
    yearComparison: {
      current_year: number
      compare_year: number
      compare_type_id: number
      compare_type_name: string
      new_farmers_count: number
      removed_farmers_count: number
      total_apply_area: number
      total_farmers: number
      new_farmers: number[]
      removed_farmers: number[]
    } | null
  }>({
    totalAmount: 0,
    totalFarmers: 0,
    villageDistribution: [],
    yearComparison: null
  })
  
  const [comparableTypes, setComparableTypes] = useState<Array<{id: number, subsidy_name: string, subsidy_year: number}>>([])
  const [selectedCompareType, setSelectedCompareType] = useState<number | null>(null)

  // 获取可对比项目列表
  const loadComparableTypes = useCallback(async () => {
    if (!subsidyType.category) return
    
    try {
      const response = await fetch(`/api/subsidies/types/comparable?category=${encodeURIComponent(subsidyType.category)}&current_type_id=${subsidyType.id}`)
      if (!response.ok) throw new Error('获取可对比项目失败')
      
      const data = await response.json()
      setComparableTypes(data)
    } catch (error) {
      console.error('加载可对比项目失败:', error)
    }
  }, [subsidyType.category, subsidyType.id])

  // 获取全部统计数据（不分页）
  const loadStats = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        subsidy_type_id: String(subsidyType.id),
        year: String(subsidyType.subsidy_year)
      })
      
      if (selectedCompareType) {
        params.append('compare_type_id', String(selectedCompareType))
      }
      
      const response = await fetch(`/api/subsidies/applications/stats?${params}`)
      if (!response.ok) throw new Error('获取统计数据失败')
      
      const data = await response.json()
      setStats(data)
    } catch (error) {
      console.error('加载统计数据失败:', error)
      show('加载统计数据失败', 'err')
    }
  }, [subsidyType.id, subsidyType.subsidy_year, selectedCompareType])

  // Excel导出函数
  const exportToExcel = useCallback(() => {
    if (!stats.yearComparison) {
      show('暂无数据可导出', 'err')
      return
    }
    
    try {
      // 创建工作簿
      const wb = XLSX.utils.book_new()
      
      // 1. 汇总数据工作表
      const summaryData = [
        ['补贴项目统计报表'],
        [`项目：${subsidyType.subsidy_name}`],
        [`年度：${subsidyType.subsidy_year}年`],
        [''],
        ['统计项', '数值'],
        ['发放总额', `¥${stats.totalAmount.toLocaleString()}`],
        ['总人数', `${stats.totalFarmers}人`],
        ['涉及村庄', `${stats.villageDistribution.length}个`],
        [''],
        ['年度对比数据'],
        ['对比年度', `${stats.yearComparison.compare_year}年`],
        ['新增农户', `${stats.yearComparison.new_farmers_count}人`],
        ['减少农户', `${stats.yearComparison.removed_farmers_count}人`],
        ['申报总面积', `${stats.yearComparison.total_apply_area}亩`],
        ['总人数', `${stats.yearComparison.total_farmers}人`]
      ]
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryData)
      XLSX.utils.book_append_sheet(wb, summaryWs, '汇总数据')
      
      // 2. 各村分布工作表
      const villageData = [
        ['村名', '发放金额(元)', '人数', '占比(%)'],
        ...stats.villageDistribution.map(item => {
          const total = stats.villageDistribution.reduce((sum, v) => sum + v.amount, 0)
          const percentage = total > 0 ? ((item.amount / total) * 100).toFixed(2) : '0.00'
          return [item.village, item.amount, item.count, percentage]
        })
      ]
      const villageWs = XLSX.utils.aoa_to_sheet(villageData)
      XLSX.utils.book_append_sheet(wb, villageWs, '各村分布')
      
      // 3. 新增农户工作表
      if (stats.yearComparison.new_farmers.length > 0) {
        const newFarmersData = [
          ['新增农户ID'],
          ...stats.yearComparison.new_farmers.map(id => [id])
        ]
        const newFarmersWs = XLSX.utils.aoa_to_sheet(newFarmersData)
        XLSX.utils.book_append_sheet(wb, newFarmersWs, '新增农户')
      }
      
      // 4. 减少农户工作表
      if (stats.yearComparison.removed_farmers.length > 0) {
        const removedFarmersData = [
          ['减少农户ID'],
          ...stats.yearComparison.removed_farmers.map(id => [id])
        ]
        const removedFarmersWs = XLSX.utils.aoa_to_sheet(removedFarmersData)
        XLSX.utils.book_append_sheet(wb, removedFarmersWs, '减少农户')
      }
      
      // 下载文件
      const fileName = `${subsidyType.subsidy_name}_${subsidyType.subsidy_year}年统计_${new Date().toLocaleDateString('zh-CN')}.xlsx`
      XLSX.writeFile(wb, fileName)
      
      show('Excel导出成功', 'ok')
    } catch (error) {
      console.error('Excel导出失败:', error)
      show('Excel导出失败', 'err')
    }
  }, [stats, subsidyType, show])

  useEffect(() => {
    loadStats()
    loadComparableTypes()
  }, [loadStats, loadComparableTypes])

  // 数据概览展开/收起状态
  const [statsExpanded, setStatsExpanded] = useState(false)

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

      {/* 数据概览 - 可折叠下拉框 */}
      <div className="mb-4 bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => setStatsExpanded(!statsExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-700">📊 数据概览</span>
            {statsExpanded && (
              <span className="text-xs text-stone-400">发放总额 ¥{stats.totalAmount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} · {stats.totalFarmers}人 · {stats.villageDistribution.length}个村</span>
            )}
          </div>
          <span className="text-stone-400 text-sm">{statsExpanded ? '▲ 收起' : '▼ 展开'}</span>
        </button>

        {statsExpanded && (
          <div className="px-4 pb-4 border-t border-stone-100">
            <div className="flex items-center justify-end gap-2 pt-3 mb-4">
              {subsidyType.category && (
                <select
                  value={selectedCompareType ?? ''}
                  onChange={e => setSelectedCompareType(e.target.value ? Number(e.target.value) : null)}
                  className="px-2 py-1 text-xs border border-stone-200 rounded bg-white"
                >
                  <option value="">不对比</option>
                  {comparableTypes.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.subsidy_name} ({t.subsidy_year}年)
                    </option>
                  ))}
                </select>
              )}
              <span className="text-xs text-stone-400">全镇数据统计</span>
              {stats.yearComparison && (
                <button
                  onClick={exportToExcel}
                  className="px-2 py-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100"
                >
                  导出Excel
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                <div className="text-sm text-emerald-600 mb-2">发放总额</div>
                <div className="text-2xl font-bold font-mono text-emerald-700">
                  ¥{stats.totalAmount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-sm text-emerald-600 mt-2">
                  {stats.totalFarmers}人
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="text-sm text-blue-600 mb-2">涉及村庄</div>
                <div className="text-2xl font-bold text-blue-700">{stats.villageDistribution.length}</div>
                <div className="text-sm text-blue-600 mt-2">个村</div>
              </div>
            </div>

            {/* 各村金额分布 - 饼图展示 */}
            {stats.villageDistribution.length > 0 && (
              <div className="border-t border-stone-100 pt-4">
                <div className="text-sm font-medium text-stone-700 mb-3">各村发放金额分布</div>
                <div className="grid grid-cols-2 gap-6">
                  {/* 左侧：饼图 */}
                  <div className="flex justify-center">
                    <div className="relative w-48 h-48">
                      <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                        {(() => {
                          const total = stats.villageDistribution.reduce((sum, item) => sum + item.amount, 0)
                          let cumulativePercent = 0
                          const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#f97316']

                          return stats.villageDistribution.slice(0, 8).map((item, index) => {
                            const percentage = (item.amount / total) * 100
                            const dashArray = `${percentage} ${100 - percentage}`
                            const dashOffset = -cumulativePercent
                            cumulativePercent += percentage

                            return (
                              <circle
                                key={item.village}
                                cx="50"
                                cy="50"
                                r="40"
                                fill="transparent"
                                stroke={colors[index % colors.length]}
                                strokeWidth="20"
                                strokeDasharray={dashArray}
                                strokeDashoffset={dashOffset}
                              />
                            )
                          })
                        })()}
                      </svg>
                    </div>
                  </div>

                  {/* 右侧：图例 */}
                  <div className="space-y-2">
                    {stats.villageDistribution.slice(0, 8).map((item, index) => {
                      const total = stats.villageDistribution.reduce((sum, v) => sum + v.amount, 0)
                      const percentage = total > 0 ? ((item.amount / total) * 100).toFixed(1) : '0.0'
                      const colors = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-red-500', 'bg-cyan-500', 'bg-lime-500', 'bg-orange-500']

                      return (
                        <div key={item.village} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${colors[index % colors.length]}`}></div>
                            <span className="text-stone-600">{item.village}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-mono text-stone-700">¥{(item.amount / 10000).toFixed(1)}万</span>
                            <span className="text-xs text-stone-400 ml-2">{percentage}%</span>
                          </div>
                        </div>
                      )
                    })}
                    {stats.villageDistribution.length > 8 && (
                      <div className="text-xs text-stone-400 text-center pt-1">
                        还有 {stats.villageDistribution.length - 8} 个村...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 年度对比数据 */}
            {stats.yearComparison && (
              <div className="border-t border-stone-100 pt-4 mt-4">
                <div className="text-sm font-medium text-stone-700 mb-3">
                  📈 年度对比（{stats.yearComparison.current_year}年 vs {stats.yearComparison.compare_year}年）
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                    <div className="text-xs text-emerald-600 mb-1">新增农户</div>
                    <div className="text-lg font-bold text-emerald-700">
                      {stats.yearComparison.new_farmers_count}人
                    </div>
                    <div className="text-xs text-stone-400 mt-1">{stats.yearComparison.compare_year}年无记录</div>
                  </div>

                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <div className="text-xs text-amber-600 mb-1">减少农户</div>
                    <div className="text-lg font-bold text-amber-700">
                      {stats.yearComparison.removed_farmers_count}人
                    </div>
                    <div className="text-xs text-stone-400 mt-1">{stats.yearComparison.compare_year}年有，今年无</div>
                  </div>

                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <div className="text-xs text-blue-600 mb-1">申报总面积</div>
                    <div className="text-lg font-bold text-blue-700">
                      {stats.yearComparison.total_apply_area}亩
                    </div>
                    <div className="text-xs text-stone-400 mt-1">{stats.yearComparison.current_year}年</div>
                  </div>

                  <div className="bg-purple-50 border border-purple-100 rounded-lg p-3">
                    <div className="text-xs text-purple-600 mb-1">总人数</div>
                    <div className="text-lg font-bold text-purple-700">
                      {stats.yearComparison.total_farmers}人
                    </div>
                    <div className="text-xs text-stone-400 mt-1">{stats.yearComparison.current_year}年</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab切换 */}
      <div className="flex items-center gap-2 mb-4 border-b border-stone-200">
        <button
          onClick={() => switchTab('preApply')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'preApply'
              ? 'border-emerald-500 text-emerald-700'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          📋 预申请列表
        </button>
        <button
          onClick={() => switchTab('disbursement')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'disbursement'
              ? 'border-emerald-500 text-emerald-700'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          💰 发放信息列表
        </button>
        <div className="ml-auto flex items-center gap-2">
          {/* 预申请列表专属：数据预检按钮 */}
          {activeTab === 'preApply' && (
            <button
              onClick={runPreCheck}
              disabled={preCheckLoading || apps.length === 0}
              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 ${
                preCheckLoading
                  ? 'bg-blue-100 border border-blue-200 text-blue-600'
                  : 'bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100'
              }`}
            >
              {preCheckLoading ? (
                <>
                  <span className="w-3 h-3 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                  预检中…
                </>
              ) : (
                '🔍 数据预检'
              )}
            </button>
          )}
          
          <span className="text-xs text-stone-400">共 {total} 条</span>
          {unpaidCount > 0 && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
              {unpaidCount} 条待发放
            </span>
          )}
          <div className="flex gap-2 items-center">
            {/* 批量删除按钮 */}
            {selectedIds.length > 0 && (
              <button
                onClick={batchDelete}
                className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-1.5"
              >
                🗑️ 删除选中 ({selectedIds.length})
              </button>
            )}

            {/* 同步到发放按钮（仅预申请tab） */}
            {selectedIds.length > 0 && activeTab === 'preApply' && (
              <button
                onClick={syncToDisbursement}
                disabled={batchLoading}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-50"
              >
                {batchLoading ? '同步中…' : `→ 同步到发放 (${selectedIds.length})`}
              </button>
            )}
            
            {templates.length > 0 && (
              <select value={selectedTmplId ?? ''} onChange={e => setSelectedTmplId(e.target.value ? Number(e.target.value) : null)}
                className="px-2 py-1.5 text-xs border border-stone-200 rounded-lg bg-white outline-none">
                <option value="">默认列映射</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}
              </select>
            )}
            {total > 0 && (
              <button onClick={() => setBatchPayOpen(true)}
                className="px-3 py-2 text-sm border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50">
                💰 批量标记发放
              </button>
            )}
            <button onClick={() => setImportOpen(true)}
              className="px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">
              ↑ Excel 导入{activeTab === 'preApply' ? '预申请' : '发放'}
            </button>
            <button onClick={() => {
              setAddOpen(true); setIdInput(''); setFarmerHint(''); setFarmerId(null)
              setForm({ pay_status: 2, subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year })
            }} className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
              ＋ 新增一条
            </button>
          </div>
        </div>
      </div>

      {/* 记录表格 + 内嵌筛选 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto shadow-sm">
        {/* 筛选栏 - 嵌入表格区域 */}
        <div className="px-4 py-3 border-b border-stone-200 bg-stone-50/50 flex flex-wrap items-center gap-3">
          <span className="text-xs text-stone-400">筛选：</span>
          {/* 村庄筛选 */}
          <select
            value={filters.village}
            onChange={e => handleFilterChange('village', e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none"
          >
            <option value="">全部村庄</option>
            {loadingVillages ? (
              <option disabled>加载中...</option>
            ) : (
              villages.map(v => (
                <option key={v} value={v}>{v}</option>
              ))
            )}
          </select>

          {/* 发放状态筛选 */}
          <select
            value={filters.payStatus}
            onChange={e => handleFilterChange('payStatus', e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none"
          >
            <option value="">全部状态</option>
            <option value="0">待发放</option>
            <option value="1">发放中</option>
            <option value="2">已完成</option>
          </select>

          {/* 金额范围 */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-stone-400">金额:</span>
            <input
              type="number"
              value={filters.minAmount}
              onChange={e => handleFilterChange('minAmount', e.target.value)}
              placeholder="最低"
              className="w-16 border border-stone-200 rounded px-1.5 py-1 text-xs outline-none"
            />
            <span className="text-stone-300">-</span>
            <input
              type="number"
              value={filters.maxAmount}
              onChange={e => handleFilterChange('maxAmount', e.target.value)}
              placeholder="最高"
              className="w-16 border border-stone-200 rounded px-1.5 py-1 text-xs outline-none"
            />
          </div>

          {/* 日期范围 */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-stone-400">日期:</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => handleFilterChange('dateFrom', e.target.value)}
              className="border border-stone-200 rounded px-1.5 py-1 text-xs outline-none"
            />
            <span className="text-stone-300">-</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => handleFilterChange('dateTo', e.target.value)}
              className="border border-stone-200 rounded px-1.5 py-1 text-xs outline-none"
            />
          </div>

          {/* 搜索框 */}
          <div className="flex items-center gap-1 flex-1 min-w-[200px] max-w-[300px]">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="姓名/身份证"
              className="flex-1 border border-stone-200 rounded-lg px-2 py-1.5 text-xs outline-none"
            />
            <button
              onClick={() => setPage(1)}
              className="px-2 py-1 text-xs bg-emerald-700 text-white rounded-lg hover:bg-emerald-600"
            >
              搜索
            </button>
          </div>

          {/* 清除筛选 */}
          <button
            onClick={clearFilters}
            className="text-xs text-stone-400 hover:text-stone-600 border border-stone-200 px-2 py-1 rounded"
            disabled={Object.values(filters).every(v => !v) && !search}
          >
            清除
          </button>
        </div>

        <table className="w-full border-collapse min-w-[950px]">
          <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
            <th className="px-2 py-2 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">
              <button
                onClick={toggleSelectAll}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                  apps.length > 0 && selectedIds.length === apps.length
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-stone-300 hover:border-emerald-400'
                }`}
              >
                {apps.length > 0 && selectedIds.length === apps.length && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            </th>
            {['姓名', '身份证', '手机号', '所在村', '所在组', '实际补贴面积', '承包地面积', '代耕代种面积', '不予补贴面积', '申请金额', '发放金额', '状态', '打款日期', '备注', '操作'].map(h => (
              <th key={h} className="px-2 py-2 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={16} className="text-center py-10 text-stone-300">加载中…</td></tr>}
            {!loading && (!apps || apps.length === 0) && (
              <tr><td colSpan={16} className="text-center py-10 text-stone-300 text-sm">
                暂无记录，通过「Excel 导入」或「＋ 新增一条」添加
              </td></tr>
            )}
            {!loading && apps && apps.map(a => (
              <tr key={a.id} className={`border-b border-stone-50 hover:bg-stone-50 ${a.pay_status === 0 ? 'bg-amber-50/30' : ''}`}>
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={() => toggleSelect(a.id)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedIds.includes(a.id)
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-stone-300 hover:border-emerald-400'
                    }`}
                  >
                    {selectedIds.includes(a.id) && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </td>
                <td className="px-2 py-2 text-sm font-semibold whitespace-nowrap">{a.farmer_name}</td>
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
                <td className="px-2 py-2">
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

      {/* 预检结果展示 */}
      {preCheckResults && activeTab === 'preApply' && (
        <div className="mb-4 bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
            <span className="font-semibold text-stone-700 text-sm">🔍 数据预检结果</span>
            <button onClick={() => setPreCheckResults(null)} className="text-xs text-stone-400 hover:text-stone-600">✕ 关闭</button>
          </div>
          <div className="p-4 space-y-4">
            {/* 汇总统计 */}
            <div className="grid grid-cols-4 gap-3">
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.summary?.ok_rows || 0) > 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-emerald-700">{preCheckResults.summary?.ok_rows || 0}</div>
                <div className="text-xs text-stone-500">通过</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.summary?.error_rows || 0) > 0 ? 'bg-red-50 border border-red-100' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-red-600">{preCheckResults.summary?.error_rows || 0}</div>
                <div className="text-xs text-stone-500">错误</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.summary?.gender_mismatch || 0) > 0 ? 'bg-amber-50 border border-amber-100' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-amber-600">{preCheckResults.summary?.gender_mismatch || 0}</div>
                <div className="text-xs text-stone-500">警告</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.changed_farmers?.length || 0) > 0 ? 'bg-blue-50 border border-blue-100' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-blue-600">{preCheckResults.changed_farmers?.length || 0}</div>
                <div className="text-xs text-stone-500">字段变更</div>
              </div>
            </div>

            {/* 错误库命中 */}
            {(preCheckResults.error_library_hits?.length || 0) > 0 && (
              <ResultTable
                title={`⚠️ 错误库命中（${preCheckResults.error_library_hits.length}条）— 这些人员在历史错误记录中出现，请重点关注`}
                headers={['行号', '姓名', '身份证号', '所在村', '所在组', '错误类型', '错误原因', '来源']}
                rows={preCheckResults.error_library_hits.map(r => [
                  r.row, r.name, r.id_card, r.village, r.group,
                  <Tag key="t" label={r.error_type} color="red" />,
                  <span key="r" className="text-red-600 text-xs">{r.error_reason}</span>,
                  r.source,
                ])}
              />
            )}

            {/* 格式错误 */}
            {preCheckResults.format_errors.length > 0 && (
              <ResultTable
                title={`❌ 格式错误（${preCheckResults.format_errors.length}条）— 需修复后重新检查`}
                headers={['行号', '姓名', '身份证号', '所在村', '所在组', '错误详情']}
                rows={preCheckResults.format_errors.map(r => [
                  r.row, r.name || '(空)', r.id_card || '(空)',
                  r.village || '(空)', r.group || '(空)',
                  <ul key="e" className="list-none">{r.errors.map((e: string, i: number) => <li key={i} className="text-red-600 text-xs">• {e}</li>)}</ul>
                ])}
              />
            )}

            {/* 村组不存在 */}
            {preCheckResults.village_errors.length > 0 && (
              <ResultTable
                title={`⚠️ 村组不存在（${preCheckResults.village_errors.length}条）— 请先在「系统设置→村组管理」中添加`}
                headers={['行号', '姓名', '身份证号', '填写的村', '填写的组', '提示信息']}
                rows={preCheckResults.village_errors.map(r => [
                  r.row, r.name, r.id_card, r.village, r.group,
                  <span key="e" className="text-amber-600 text-xs">{r.error}</span>
                ])}
              />
            )}

            {/* 重复身份证 */}
            {(preCheckResults.duplicate_errors?.length || 0) > 0 && (
              <ResultTable
                title={`⚠️ Excel内部重复（${preCheckResults.duplicate_errors.length}条）— 同一身份证出现多次`}
                headers={['行号', '姓名', '身份证号', '所在村', '所在组', '说明']}
                rows={preCheckResults.duplicate_errors.map(r => [
                  r.row, r.name, r.id_card, r.village, r.group,
                  <span key="e" className="text-amber-600 text-xs">{r.error}</span>
                ])}
              />
            )}

            {/* 性别不符 */}
            {(preCheckResults.gender_mismatch?.length || 0) > 0 && (
              <ResultTable
                title={`⚠️ 性别与身份证不符（${preCheckResults.gender_mismatch.length}条）— 请核实后修正`}
                headers={['行号', '姓名', '身份证号', '所在村', '所在组', 'Excel性别', '身份证推断']}
                rows={preCheckResults.gender_mismatch.map(r => [
                  r.row, r.name, r.id_card, r.village, r.group,
                  r.excel_gender, <Tag key="g" label={r.id_card_gender} color={r.id_card_gender === '男' ? 'blue' : 'purple'} />
                ])}
              />
            )}

            {/* 面积超限 */}
            {(preCheckResults.area_exceeds?.length || 0) > 0 && (
              <ResultTable
                title={`⚠️ 面积超限（${preCheckResults.area_exceeds.length}条）— 填报面积超过数据库承包面积`}
                headers={['行号', '姓名', '身份证号', '所在村', '所在组', '填报面积', '承包面积']}
                rows={preCheckResults.area_exceeds.map(r => [
                  r.row, r.name, r.id_card, r.village, r.group,
                  <span key="a" className="text-orange-600 font-semibold">{r.land_area} 亩</span>,
                  <span key="c" className="text-stone-500">{r.contracted_area} 亩</span>
                ])}
              />
            )}

            {/* 字段变更 */}
            {(preCheckResults.changed_farmers?.length || 0) > 0 && (
              <ResultTable
                title={`ℹ️ 字段变更（${preCheckResults.changed_farmers.length}条）— 与数据库已有数据不一致，请人工确认`}
                headers={['行号', '姓名', '身份证号', '所在村', '所在组', '变更内容']}
                rows={preCheckResults.changed_farmers.map(r => [
                  r.row, r.name, r.id_card, r.village, r.group,
                  <ul key="c" className="list-none">{r.changes.map((c: string, i: number) => <li key={i} className="text-blue-600 text-xs">• {c}</li>)}</ul>
                ])}
              />
            )}
          </div>
        </div>
      )}

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

      {/* 规则检查结果 */}
      <Modal open={checkOpen} title="资格规则检查结果" onClose={() => setCheckOpen(false)} onConfirm={() => setCheckOpen(false)} confirmText="我知道了">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 text-center">
            {[{label:'通过',val:checkResult?.passed??0,cls:'text-emerald-700 bg-emerald-50 border-emerald-100'},
              {label:'警告',val:checkResult?.warning??0,cls:'text-amber-600 bg-amber-50 border-amber-100'},
              {label:'拒绝',val:checkResult?.failed??0,cls:'text-red-600 bg-red-50 border-red-100'},
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-3 border ${s.cls}`}>
                <div className="text-2xl font-bold font-mono">{s.val}</div>
                <div className="text-xs mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          {(checkResult?.failed_list?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-700 mb-1">规则拒绝（未导入）：</p>
              <div className="max-h-40 overflow-y-auto space-y-1.5">
                {checkResult?.failed_list.map((f,i) => (
                  <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <span className="text-xs font-semibold text-red-700">{f.real_name} {f.id_card_masked}</span>
                    {f.issues.map((iss,j) => <p key={j} className="text-xs text-red-500 mt-0.5">• {iss}</p>)}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(checkResult?.warning_list?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1">警告（已导入，请复核）：</p>
              <div className="max-h-32 overflow-y-auto space-y-1.5">
                {checkResult?.warning_list.map((f,i) => (
                  <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <span className="text-xs font-semibold text-amber-700">{f.real_name} {f.id_card_masked}</span>
                    {f.warnings.map((w,j) => <p key={j} className="text-xs text-amber-600 mt-0.5">• {w}</p>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ExcelImportWithMapping
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={`导入${activeTab === 'preApply' ? '预申请' : '发放'} · ${subsidyType.subsidy_name}`}
        templateHeaders={IMPORT_HEADERS}
        templateExample={IMPORT_EXAMPLE}
        systemFields={activeTab === 'preApply' ? PRE_APPLY_SYSTEM_FIELDS : SUBSIDY_SYSTEM_FIELDS}
        templates={templates}
        onDetectColumns={detectExcelColumns}
        onSaveTemplate={saveColumnMappingTemplate}
        onImport={handleImport}
        onSuccess={load} />

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
