/**
 * 补贴项目管理页 — 全新活力版 🎨
 * ================================
 * 醒目、活泼、信息全面，忽略原有UI规范
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as api from '../api'
import type { SubsidyType, SubsidyTypeCreate } from '../types'
import { years } from '../utils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import Modal from '../components/Modal'
import SubsidyForms from './SubsidyForms'
import SubsidyRecordsPage from './SubsidyRecordsPage'

type StatsType = SubsidyType & {
  app_count: number; beneficiary_count: number
  total_apply: number; total_actual: number
}

// ══════════════════════════════════════════
//  缤纷配色 — 每个季节一种主色调
// ══════════════════════════════════════════
const SEASON_COLORS: Record<string, {
  gradient: string; badge: string; icon: string; chart: string
}> = {
  '耕地地力保护': {
    gradient: 'from-emerald-400 via-emerald-500 to-teal-500',
    badge: 'bg-emerald-500 text-white shadow-sm shadow-emerald-300',
    icon: '🌱', chart: 'text-emerald-600',
  },
  '大春': {
    gradient: 'from-amber-400 via-orange-500 to-rose-500',
    badge: 'bg-orange-500 text-white shadow-sm shadow-orange-300',
    icon: '🌻', chart: 'text-orange-600',
  },
  '小春': {
    gradient: 'from-sky-400 via-blue-500 to-indigo-500',
    badge: 'bg-blue-500 text-white shadow-sm shadow-blue-300',
    icon: '🌾', chart: 'text-blue-600',
  },
  '全年单补': {
    gradient: 'from-violet-400 via-purple-500 to-fuchsia-500',
    badge: 'bg-purple-500 text-white shadow-sm shadow-purple-300',
    icon: '📋', chart: 'text-purple-600',
  },
  '临时': {
    gradient: 'from-rose-400 via-pink-500 to-red-500',
    badge: 'bg-pink-500 text-white shadow-sm shadow-pink-300',
    icon: '⚡', chart: 'text-pink-600',
  },
}

const DEFAULT_COLOR = {
  gradient: 'from-gray-400 via-slate-500 to-gray-600',
  badge: 'bg-slate-500 text-white shadow-sm shadow-slate-300',
  icon: '📦', chart: 'text-slate-600',
}

function getSeasonStyle(season: string | null) {
  return (season && SEASON_COLORS[season]) || DEFAULT_COLOR
}

const FUND_COLORS: Record<string, string> = {
  '中央': 'bg-red-50 text-red-500 border-red-100',
  '省级': 'bg-blue-50 text-blue-500 border-blue-100',
  '市级': 'bg-purple-50 text-purple-500 border-purple-100',
  '县级': 'bg-amber-50 text-amber-500 border-amber-100',
  '镇级': 'bg-green-50 text-green-500 border-green-100',
}

// ── 迷你统计徽章 ──
function StatBadge({ icon, label, value, color }: { icon: string; label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/70 backdrop-blur-sm border border-white/60 shadow-sm">
      <span className="text-sm">{icon}</span>
      <span className="text-xs text-text-muted">{label}</span>
      <span className={`text-sm font-bold ${color || 'text-text-primary'}`}>{value}</span>
    </div>
  )
}

// ══════════════════════════════════════════
//  主页
// ══════════════════════════════════════════
export default function SubsidyProjectsPage() {
  const { toast, show } = useToast()
  const location = useLocation()
  const navigate = useNavigate()

  const thisYear = new Date().getFullYear()

  const searchParams = new URLSearchParams(location.search)
  const urlYear = searchParams.get('year')
  const initialYear = urlYear ? parseInt(urlYear, 10) : thisYear
  const urlFarmerName = searchParams.get('farmer_name') || undefined
  const [yearFilter, setYearFilter] = useState(initialYear)
  const [types, setTypes] = useState<StatsType[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [deletedTypes, setDeletedTypes] = useState<SubsidyType[]>([])
  const [restoring, setRestoring] = useState<number | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [activeType, setActiveType] = useState<StatsType | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<SubsidyType | null>(null)
  const [form, setForm] = useState<Partial<SubsidyTypeCreate>>({ subsidy_year: thisYear, calc_mode: 'fixed' })
  const pendingCheckConfig = useRef<object | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StatsType | null>(null)
  const [destroyTarget, setDestroyTarget] = useState<SubsidyType | null>(null)
  const [destroying, setDestroying] = useState(false)

  const handleYearChange = (year: number) => {
    setYearFilter(year)
    const params = new URLSearchParams(location.search)
    params.set('year', year.toString())
    navigate(`?${params.toString()}`, { replace: true })
  }

  const updateUrlType = (typeId: number | null) => {
    const params = new URLSearchParams(location.search)
    if (typeId) params.set('subsidy_type_id', typeId.toString())
    else params.delete('subsidy_type_id')
    navigate(`?${params.toString()}`, { replace: true })
  }

  const loadTypes = useCallback(async () => {
    setLoading(true)
    try { setTypes(await api.getSubsidyTypesWithStats(yearFilter) as StatsType[]) }
    finally { setLoading(false) }
  }, [yearFilter])

  const loadDeletedTypes = async () => {
    try { setDeletedTypes(await api.getDeletedSubsidyTypes() as StatsType[]) }
    catch (e) { console.error('加载回收站失败:', e) }
  }

  useEffect(() => { loadTypes() }, [loadTypes])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const typeIdParam = params.get('subsidy_type_id')
    if (!typeIdParam) return
    const typeId = parseInt(typeIdParam, 10)
    const found = types.find(t => t.id === typeId)
    if (found) { setActiveType(found); return }
    if (types.length > 0) {
      api.getSubsidyTypesWithStats().then((allTypes: StatsType[]) => {
        const crossYear = allTypes.find((t: StatsType) => t.id === typeId)
        if (crossYear) setActiveType(crossYear)
      }).catch(() => {})
    }
  }, [types, location.search])

  const openAdd = () => {
    setEditing(null)
    setForm({ subsidy_year: yearFilter, calc_mode: 'fixed', season: '耕地地力保护' })
    setFormKey(k => k + 1); setEditOpen(true)
  }

  const openEdit = (t: SubsidyType) => {
    setEditing(t); setFormKey(k => k + 1)
    setForm({
      subsidy_name: t.subsidy_name, subsidy_year: t.subsidy_year,
      season: t.season ?? undefined, calc_mode: t.calc_mode,
      standard_amount: t.standard_amount ? Number(t.standard_amount) : undefined,
      standard_unit: t.standard_unit ?? undefined,
      fund_source: t.fund_source ?? undefined, category: t.category ?? undefined,
      apply_deadline: t.apply_deadline ?? undefined, description: t.description ?? undefined,
      count_toward_area: (t as { count_toward_area?: number }).count_toward_area ?? 1,
    })
    setEditOpen(true)
  }

  const submitType = async () => {
    if (!form.subsidy_name) return show('请填写补贴名称', 'err')
    const autoUnit = form.calc_mode === 'per_mu' ? '元/亩' : (form.standard_unit || '元/户')
    const payload = { ...form, standard_unit: autoUnit }
    try {
      if (editing) {
        await api.updateSubsidyType(editing.id, payload)
        show('✓ 更新成功')
      } else {
        const res = await api.createSubsidyType(payload as SubsidyTypeCreate)
        if (pendingCheckConfig.current) {
          await api.updateCheckConfig(res.id, pendingCheckConfig.current as any)
        }
        show('✓ 创建成功')
      }
      setEditOpen(false); loadTypes()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const deleteProject = async (type_id: number) => {
    setDeleting(true)
    try {
      await window.electronAPI.invoke('subsidies:deleteType', type_id)
      setTypes(prev => prev.filter(t => t.id !== type_id))
      show('✓ 项目已移入回收站')
      if (showTrash) loadDeletedTypes()
    } catch (error) {
      show('删除失败：' + (error as Error).message, 'err')
    } finally { setDeleting(false) }
  }

  const restoreProject = async (type_id: number) => {
    setRestoring(type_id)
    try {
      await api.restoreSubsidyType(type_id)
      setDeletedTypes(prev => prev.filter(t => t.id !== type_id))
      show('✓ 项目已恢复'); loadTypes()
    } catch (error) {
      show('恢复失败：' + (error as Error).message, 'err')
    } finally { setRestoring(null) }
  }

  const destroyProject = async (type_id: number) => {
    setDestroying(true)
    try {
      await api.destroySubsidyType(type_id)
      setDeletedTypes(prev => prev.filter(t => t.id !== type_id))
      setDestroyTarget(null)
      show('✓ 项目已彻底删除（含关联申请/发放记录）')
    } catch (error) {
      show('彻底删除失败：' + (error as Error).message, 'err')
    } finally { setDestroying(false) }
  }

  const toggleTrash = () => {
    const next = !showTrash
    setShowTrash(next)
    if (next) loadDeletedTypes()
  }

  // 汇总统计
  const totalBeneficiaries = types.reduce((s, t) => s + t.beneficiary_count, 0)
  const totalRecords = types.reduce((s, t) => s + t.app_count, 0)
  const totalActual = types.reduce((s, t) => s + Number(t.total_actual || 0), 0)

  if (activeType) {
    return <SubsidyRecordsPage subsidyType={activeType} onBack={() => { setActiveType(null); updateUrlType(null); loadTypes() }} farmerName={urlFarmerName} />
  }

  return (
    <div className="space-y-5">
      {/* ═══ 顶部横幅 ═══ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-500 p-6 shadow-lg shadow-emerald-200/50">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 -left-6 w-28 h-28 rounded-full bg-white/5" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white drop-shadow-sm">📋 补贴项目</h1>
            <p className="text-emerald-50/80 text-sm mt-1">管理年度补贴项目，查看人员明细与发放记录</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 text-white text-center min-w-[64px]">
              <span className="block text-lg font-bold">{types.length}</span>
              <span className="text-[10px] text-white/70">项目</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 text-white text-center min-w-[64px]">
              <span className="block text-lg font-bold">{totalBeneficiaries}</span>
              <span className="text-[10px] text-white/70">受益人次</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 text-white text-center min-w-[80px]">
              <span className="block text-lg font-bold">¥{totalActual.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>
              <span className="text-[10px] text-white/70">实发总额</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 工具栏 ═══ */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-border">
          {years.slice(0, 6).map(y => (
            <button key={y} onClick={() => handleYearChange(y)}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-all duration-200
                ${yearFilter === y
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-200'
                  : 'text-text-muted hover:text-emerald-600 hover:bg-emerald-50'}`}>
              {y}年
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button onClick={openAdd}
          className="group inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-medium rounded-xl shadow-md shadow-emerald-200/50 hover:shadow-lg hover:shadow-emerald-200/70 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200">
          <span className="text-lg group-hover:rotate-90 transition-transform duration-300">＋</span>
          <span>新增项目</span>
        </button>

        <button onClick={toggleTrash}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 font-medium transition-all duration-200
            ${showTrash
              ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm'
              : 'border-border text-text-muted hover:border-amber-200 hover:text-amber-600 hover:bg-amber-50/50'}`}>
          <span>🗑️</span>
          <span>回收站</span>
          {deletedTypes.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
              {deletedTypes.length}
            </span>
          )}
        </button>
      </div>

      {/* ═══ 加载 ═══ */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="w-8 h-8 border-[3px] border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-text-muted/50">加载项目数据…</span>
        </div>
      )}

      {/* ═══ 空状态 ═══ */}
      {!loading && types.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border-2 border-dashed border-border">
          <span className="text-5xl mb-4">📭</span>
          <p className="text-lg font-medium text-text-muted/50 mb-1">暂无 {yearFilter} 年度补贴项目</p>
          <p className="text-sm text-text-muted/30 mb-4">点击上方「新增项目」开始创建</p>
          <button onClick={openAdd}
            className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl shadow-md hover:shadow-lg transition-all">
            ＋ 立即创建
          </button>
        </div>
      )}

      {/* ═══ 项目卡片列表 ═══ */}
      <div className="grid gap-4">
        {types.map(t => {
          const s = getSeasonStyle(t.season)
          const totalActualNum = Number(t.total_actual || 0)
          const totalApplyNum = Number(t.total_apply || 0)
          const payProgress = totalApplyNum > 0 ? Math.min(95, Math.round((totalActualNum / totalApplyNum) * 100)) : 0
          const standardAmt = t.standard_amount ? Number(t.standard_amount) : 0

          return (
            <div key={t.id}
              className="group relative overflow-hidden rounded-2xl bg-white border border-border/60 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5">
              {/* 顶部彩色装饰条 */}
              <div className={`h-2 bg-gradient-to-r ${s.gradient}`} />

              <div className="p-5">
                {/* 第一行：信息 + 操作 */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-2xl ${s.badge} flex items-center justify-center text-2xl`}>
                      {s.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold text-text-primary truncate">{t.subsidy_name}</h3>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-warm/60 text-text-muted text-xs font-medium">
                          📅 {t.subsidy_year}年
                        </span>
                        {t.season && (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium ${s.badge}`}>
                            {s.icon} {t.season}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-text-muted/60 flex items-center gap-1">
                          {t.calc_mode === 'per_mu' ? '📐' : '💰'}
                          {t.calc_mode === 'per_mu' ? '按亩计算' : '固定金额'}
                        </span>
                        {t.fund_source && (
                          <span className={`text-xs px-2 py-0.5 rounded-md border ${FUND_COLORS[t.fund_source] || 'bg-warm/60 text-text-muted border-border'}`}>
                            {t.fund_source}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 text-xs ${
                          t.pay_status === 2 ? 'text-success-600' : t.pay_status === 1 ? 'text-orange-tag' : 'text-text-muted/50'
                        }`}>
                          {['⏳', '🔄', '✅'][t.pay_status] || '⏳'}
                          {['未发放', '部分发放', '已完成'][t.pay_status] || '未知'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => { setActiveType(t); updateUrlType(t.id) }}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 bg-gradient-to-r ${s.gradient}`}>
                      查看人员 →
                    </button>
                    <button onClick={() => navigate(`/project-progress?subsidy_type_id=${t.id}`)}
                      className="px-3 py-2 rounded-xl border border-border bg-white/80 text-text-muted text-xs font-medium hover:bg-white hover:border-text-muted/30 hover:text-text-primary transition-all whitespace-nowrap">
                      📋 进度
                    </button>
                    <div className="relative group/more">
                      <button className="px-2 py-2 rounded-xl border border-border bg-white/80 text-text-muted/50 hover:bg-white hover:text-text-muted transition-all text-sm">
                        ⋯
                      </button>
                      <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-lg border border-border opacity-0 invisible group-hover/more:opacity-100 group-hover/more:visible transition-all duration-200 z-20 overflow-hidden">
                        <button onClick={() => openEdit(t)}
                          className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm text-text-muted hover:bg-blue-50 hover:text-blue-600 transition-colors">
                          ✏️ 编辑
                        </button>
                        <button onClick={() => setDeleteTarget(t)}
                          className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors">
                          🗑️ 删除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 第二行：数据指标 */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {standardAmt > 0 && (
                    <StatBadge icon="💰" label="标准" value={`¥${standardAmt.toFixed(2)}`} color={s.chart} />
                  )}
                  <StatBadge icon="👥" label="受益" value={`${t.beneficiary_count}人`} color={s.chart} />
                  <StatBadge icon="📄" label="记录" value={`${t.app_count}条`} color={s.chart} />
                  {totalApplyNum > 0 && (
                    <StatBadge icon="📊" label="应发" value={`¥${totalApplyNum.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`} color={s.chart} />
                  )}
                  {totalActualNum > 0 && (
                    <StatBadge icon="✅" label="实发" value={`¥${totalActualNum.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`} color={s.chart} />
                  )}
                </div>

                {/* 第三行：进度条 */}
                {totalApplyNum > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-text-muted/50">发放进度</span>
                      <span className={`font-bold ${s.chart}`}>{payProgress}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-warm/80 overflow-hidden">
                      <div className={`h-full rounded-full bg-gradient-to-r ${s.gradient} transition-all duration-1000 ease-out`}
                        style={{ width: `${payProgress}%` }} />
                    </div>
                  </div>
                )}

                {/* 第四行：辅助信息 */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted/50">
                  {t.apply_deadline && <span>🗓️ 截止：{t.apply_deadline}</span>}
                  {t.description && <span className="truncate max-w-[300px]">📌 {t.description}</span>}
                  {(t as { count_toward_area?: number }).count_toward_area === 1 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-500 border border-amber-100">
                      📐 累计面积
                    </span>
                  )}
                </div>

                {/* 扫描源目录 */}
                <div className="mt-3 pt-3 border-t border-border/40">
                  <ScanDirInput projectId={t.id} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ═══ 回收站 ═══ */}
      {showTrash && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-bold text-text-primary">🗑️ 回收站</span>
            <span className="text-xs text-text-muted">已删除项目（关联数据已保留）</span>
            <span className="text-xs text-text-muted/30">|</span>
            <span className="text-xs text-text-muted">{deletedTypes.length} 项</span>
          </div>
          {deletedTypes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 bg-white rounded-2xl border-2 border-dashed border-border">
              <span className="text-4xl mb-2">🗑️</span>
              <p className="text-sm text-text-muted/50">回收站是空的</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {deletedTypes.map(t => (
                <div key={t.id} className="bg-gradient-to-r from-amber-50/80 to-orange-50/80 border border-amber-200 rounded-2xl p-4 flex items-center gap-4 group hover:shadow-md transition-shadow">
                  <span className="text-2xl">📄</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-text-muted line-through">{t.subsidy_name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-md bg-warm/60 text-text-muted/60">{t.subsidy_year}年</span>
                      {t.season && <span className="text-xs text-text-muted/50">{t.season}</span>}
                    </div>
                  </div>
                  <button onClick={() => restoreProject(t.id)} disabled={restoring === t.id}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-medium rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0 transition-all duration-200">
                    <span>↩</span>
                    <span>{restoring === t.id ? '恢复中…' : '恢复项目'}</span>
                  </button>
                  <button onClick={() => setDestroyTarget(t)}
                    className="px-3 py-2 text-xs border border-red-200 text-red-500 rounded-xl hover:bg-red-50 transition-all whitespace-nowrap">
                    ⚠️ 彻底删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 编辑弹窗 */}
      <SubsidyForms
        key={formKey} open={editOpen} editing={editing} form={form}
        onFormChange={updater => setForm(prev => ({ ...prev, ...updater }))}
        onSubmit={submitType} onClose={() => setEditOpen(false)}
        thisYear={thisYear}
        onCheckConfigChange={cfg => { pendingCheckConfig.current = cfg }}
      />

      {/* 删除确认弹窗 */}
      <Modal open={deleteTarget !== null} title="确认删除" onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { deleteProject(deleteTarget.id); setDeleteTarget(null) } }}
        confirmText="确认删除">
        <p className="text-sm text-text-primary">
          确定要删除项目「<span className="font-bold">{deleteTarget?.subsidy_name}</span>」吗？
        </p>
        <p className="text-xs text-text-muted mt-2">删除后项目将移入回收站，可在回收站中恢复。</p>
      </Modal>

      {/* 彻底删除确认 */}
      <Modal open={destroyTarget !== null} title="⚠️ 彻底删除" onClose={() => setDestroyTarget(null)}
        onConfirm={() => { if (destroyTarget) destroyProject(destroyTarget.id) }} confirmText="彻底删除">
        <div className="bg-red-50 border border-red-200 rounded-btn p-3 mb-3">
          <p className="text-sm text-red-700 font-bold">此操作不可恢复！</p>
        </div>
        <p className="text-sm text-text-primary">
          确定要彻底删除项目「<span className="font-bold">{destroyTarget?.subsidy_name}</span>」吗？
        </p>
        <p className="text-xs text-text-muted mt-2">将同时删除所有关联的申请和发放记录。</p>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}

// ── 扫描目录设置 ──
function ScanDirInput({ projectId }: { projectId: number }) {
  const [path, setPath] = useState(() => localStorage.getItem(`scan_${projectId}`) || '')
  const updatePath = (v: string) => { setPath(v); localStorage.setItem(`scan_${projectId}`, v) }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1 shrink-0 text-text-muted/50">📁 本地路径:</span>
      <input value={path} onChange={e => updatePath(e.target.value)}
        placeholder="D:\材料\2024耕地补贴"
        className="flex-1 bg-white/60 border border-border/50 rounded-lg px-2.5 py-1 text-xs outline-none focus:border-emerald-300 focus:bg-white focus:shadow-sm transition-all placeholder:text-text-muted/20" />
      {path && (
        <button onClick={() => updatePath('')} className="text-text-muted/30 hover:text-red-400 transition-colors shrink-0 text-sm">✕</button>
      )}
      {path && (
        <span className="text-emerald-600 font-mono truncate max-w-[180px]" title={path}>📂 {path}</span>
      )}
    </div>
  )
}
