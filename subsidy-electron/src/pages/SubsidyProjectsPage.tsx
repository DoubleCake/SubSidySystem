/**
 * 补贴项目管理页
 * - 项目卡片 + 状态切换 + 批量发放
 * - 进入子页查看/管理人员记录
 * - 记录支持搜索、新增、Excel导入、编辑、删除
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as api from '../api'
import type { SubsidyType, SubsidyTypeCreate } from '../types'
import { years } from '../utils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import Tag from '../components/Tag'
import SubsidyForms from './SubsidyForms'
import SubsidyRecordsPage from './SubsidyRecordsPage'

type StatsType = SubsidyType & {
  app_count: number; beneficiary_count: number
  total_apply: number; total_actual: number
}

// ══════════════════════════════════════
//  项目列表页
// ══════════════════════════════════════
export default function SubsidyProjectsPage() {
  const { toast, show } = useToast()
  const location = useLocation()
  const navigate = useNavigate()

  const thisYear = new Date().getFullYear()

  // 从URL参数获取年份，如果没有则使用当前年份
  const searchParams = new URLSearchParams(location.search)
  const urlYear = searchParams.get('year')
  const initialYear = urlYear ? parseInt(urlYear, 10) : thisYear
  const urlFarmerName = searchParams.get('farmer_name') || undefined
  const [yearFilter, setYearFilter] = useState(initialYear)
  const [types, setTypes] = useState<StatsType[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showTrash, setShowTrash] = useState(false)  // 回收站模式
  const [deletedTypes, setDeletedTypes] = useState<SubsidyType[]>([])
  const [restoring, setRestoring] = useState<number | null>(null)  // 正在恢复的项目ID
  const [activeType, setActiveType] = useState<StatsType | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<SubsidyType | null>(null)
  const [form, setForm] = useState<Partial<SubsidyTypeCreate>>({ subsidy_year: thisYear, calc_mode: 'fixed' })
  const pendingCheckConfig = useRef<object | null>(null)

  // 更新URL参数和状态
  const handleYearChange = (year: number) => {
    setYearFilter(year)
    const params = new URLSearchParams(location.search)
    params.set('year', year.toString())
    navigate(`?${params.toString()}`, { replace: true })
  }

  // 更新URL参数（添加或移除 subsidy_type_id）
  const updateUrlType = (typeId: number | null) => {
    const params = new URLSearchParams(location.search)
    if (typeId) {
      params.set('subsidy_type_id', typeId.toString())
    } else {
      params.delete('subsidy_type_id')
    }
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

  // 检查URL参数，自动选中补贴项目
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const typeIdParam = params.get('subsidy_type_id')
    if (!typeIdParam) return
    const typeId = parseInt(typeIdParam, 10)
    // 先在当前列表中查找
    const found = types.find(t => t.id === typeId)
    if (found) {
      setActiveType(found)
      return
    }
    // 未找到：可能跨年度，从后台直接获取
    if (types.length > 0) {
      api.getSubsidyTypesWithStats().then((allTypes: StatsType[]) => {
        const crossYear = allTypes.find((t: StatsType) => t.id === typeId)
        if (crossYear) setActiveType(crossYear)
      }).catch(() => {})
    }
  }, [types, location.search])

  const openAdd = () => { setEditing(null); setForm({ subsidy_year: yearFilter, calc_mode: 'fixed', season: '耕地地力保护' }); setEditOpen(true) }
  const openEdit = (t: SubsidyType) => {
    setEditing(t)
    setForm({
      subsidy_name: t.subsidy_name,
      subsidy_year: t.subsidy_year,
      season: t.season ?? undefined,
      calc_mode: t.calc_mode,
      standard_amount: t.standard_amount ? Number(t.standard_amount) : undefined,
      standard_unit: t.standard_unit ?? undefined,
      fund_source: t.fund_source ?? undefined,
      category: t.category ?? undefined,
      apply_deadline: t.apply_deadline ?? undefined,
      description: t.description ?? undefined,
      count_toward_area: (t as { count_toward_area?: number }).count_toward_area ?? 1
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
        // SubsidyForms 内部已自动保存 check_config（编辑模式）
        show('✓ 更新成功')
      } else {
        const res = await api.createSubsidyType(payload as SubsidyTypeCreate)
        // 新建项目：将表单里的预检配置保存到新类型
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
      // 立即从本地状态移除
      setTypes(prev => prev.filter(t => t.id !== type_id))
      show('✓ 项目已移入回收站')
      if (showTrash) loadDeletedTypes()
    } catch (error) {
      show('删除失败：' + (error as Error).message, 'err')
    } finally {
      setDeleting(false)
    }
  }

  const restoreProject = async (type_id: number) => {
    setRestoring(type_id)
    try {
      await api.restoreSubsidyType(type_id)
      // 从回收站状态移除
      setDeletedTypes(prev => prev.filter(t => t.id !== type_id))
      show('✓ 项目已恢复')
      loadTypes()
    } catch (error) {
      show('恢复失败：' + (error as Error).message, 'err')
    } finally {
      setRestoring(null)
    }
  }

  const toggleTrash = () => {
    const next = !showTrash
    setShowTrash(next)
    if (next) loadDeletedTypes()
  }

  if (activeType) {
    return <SubsidyRecordsPage subsidyType={activeType} onBack={() => { setActiveType(null); updateUrlType(null); loadTypes() }} farmerName={urlFarmerName} />
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select value={yearFilter} onChange={e => handleYearChange(Number(e.target.value))}
          className="border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <span className="text-xs text-text-muted">共 {types.length} 个项目</span>
        <button onClick={openAdd} className="px-3 py-2 text-sm bg-primary-500 text-white rounded-btn hover:bg-primary/90 transition-all">＋ 新增项目</button>
        <button onClick={toggleTrash}
          className={`px-3 py-2 text-sm border rounded-btn transition-all ${showTrash ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-border text-text-muted hover:bg-warm/30'}`}>
          🗑️ 回收站{deletedTypes.length > 0 && <span className="ml-1 text-amber-600">({deletedTypes.length})</span>}
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-card px-4 py-3 mb-4 text-xs text-blue-700">
        先在此维护补贴项目，再点「查看人员」进入补贴发放记录。
      </div>

      {loading && <div className="text-center py-12 text-text-muted/50">加载中…</div>}

      <div className="grid gap-3">
        {!loading && types.length === 0 && (
          <div className="text-center py-12 bg-white border border-border rounded-card text-text-muted/50 text-sm">
            暂无 {yearFilter} 年度补贴项目
          </div>
        )}
        {types.map(t => (
          <div key={t.id} className="bg-white border border-border rounded-card p-5 shadow-card hover:border-border transition-colors">
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="font-bold text-text-primary text-base">{t.subsidy_name}</span>
                  <Tag label={`${t.subsidy_year}年`} color="gray" />
                  <Tag label={t.calc_mode === 'per_mu' ? '按亩计算' : '固定金额'} color={t.calc_mode === 'per_mu' ? 'blue' : 'purple'} />
                  {t.season && <Tag label={t.season} color={t.season === '大春' ? 'green' : t.season === '小春' ? 'blue' : t.season === '临时' ? 'amber' : 'gray'} />}
                  {t.fund_source && <span className="text-xs text-text-muted/50">{t.fund_source}</span>}
                </div>
                <div className="flex gap-6 text-sm mb-3 flex-wrap">
                  {t.standard_amount && (
                    <div><span className="text-text-muted">标准</span>
                      <span className="font-mono font-bold text-primary ml-1">¥{Number(t.standard_amount).toFixed(2)}</span>
                      <span className="text-xs text-text-muted/50 ml-0.5">{t.standard_unit}</span>
                    </div>
                  )}
                  <div><span className="text-text-muted">受益</span><span className="font-bold text-blue-600 ml-1">{t.beneficiary_count}人</span></div>
                  <div><span className="text-text-muted">记录</span><span className="text-text-primary ml-1">{t.app_count}条</span></div>
                </div>
                {t.apply_deadline && <p className="text-xs text-text-muted/50 mt-1.5">截止：{t.apply_deadline}</p>}

                {/* 扫描源目录 */}
                <ScanDirInput projectId={t.id} />
              </div>

              {/* 操作区 */}
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => { setActiveType(t); updateUrlType(t.id) }}
                  className="px-3 py-1.5 text-sm bg-primary/10 text-primary-700 rounded-btn hover:bg-primary/20 whitespace-nowrap font-medium">
                  查看人员 →
                </button>
                <button onClick={() => navigate(`/project-progress?subsidy_type_id=${t.id}`)}
                  className="px-3 py-1.5 text-xs border border-blue-200 text-blue-700 rounded-btn hover:bg-blue-50 whitespace-nowrap">
                  📋 管理进度
                </button>
                <button onClick={() => openEdit(t)}
                  className="px-3 py-1.5 text-xs border border-border text-text-muted rounded-btn hover:border-border text-center">
                  编辑项目
                </button>
                <button onClick={() => {
                  if (confirm(`确定要删除项目「${t.subsidy_name}」吗？\n\n删除后项目将移入回收站，关联的申请记录会被保留。可在回收站中恢复。`)) {
                    deleteProject(t.id)
                  }
                }}
                  className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-btn hover:bg-red-50 text-center">
                  删除项目
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 新增/编辑弹窗 */}
      <SubsidyForms
        open={editOpen}
        editing={editing}
        form={form}
        onFormChange={updater => setForm(prev => ({ ...prev, ...updater }))}
        onSubmit={submitType}
        onClose={() => setEditOpen(false)}
        thisYear={thisYear}
        onCheckConfigChange={cfg => { pendingCheckConfig.current = cfg }}
      />

      {/* 回收站 */}
      {showTrash && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold text-text-primary">🗑️ 回收站</span>
            <span className="text-xs text-text-muted">已删除项目（关联数据已保留）</span>
          </div>
          {deletedTypes.length === 0 ? (
            <div className="text-center py-8 bg-white border border-border rounded-card text-text-muted/50 text-sm">
              回收站为空
            </div>
          ) : (
            <div className="grid gap-2">
              {deletedTypes.map(t => (
                <div key={t.id} className="bg-amber-50/50 border border-amber-200 rounded-card px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-text-muted line-through">{t.subsidy_name}</span>
                      <Tag label={`${t.subsidy_year}年`} color="gray" />
                      {t.season && <Tag label={t.season} color="gray" />}
                    </div>
                  </div>
                  <button
                    onClick={() => restoreProject(t.id)}
                    disabled={restoring === t.id}
                    className="px-3 py-1.5 text-xs bg-emerald-500 text-white rounded-btn hover:bg-emerald-600 disabled:opacity-50 transition-all whitespace-nowrap">
                    {restoring === t.id ? '恢复中…' : '↩ 恢复项目'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 删除中遮罩 */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/20">
          <div className="bg-white rounded-card shadow-xl border border-border px-8 py-6 flex flex-col items-center gap-3">
            <span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-text-muted">删除项目中，请稍候…</span>
          </div>
        </div>
      )}

      <Toast {...toast} />
    </div>
  )
}

// ── 扫描目录设置组件（嵌入项目卡片） ──
function ScanDirInput({ projectId }: { projectId: number }) {
  const [path, setPath] = useState(() => localStorage.getItem(`scan_${projectId}`) || '')

  const updatePath = (v: string) => { setPath(v); localStorage.setItem(`scan_${projectId}`, v) }

  return (
    <div className="mt-2 pt-2 border-t border-border/30 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-text-muted shrink-0">📁 项目本地路径:</span>
        <input value={path} onChange={e => updatePath(e.target.value)}
          placeholder="D:\材料\2024耕地补贴"
          className="flex-1 border border-border/50 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-primary/40" />
        {path && (
          <button onClick={() => updatePath('')} className="text-[9px] text-red-400 hover:text-red-600 shrink-0">✕</button>
        )}
      </div>
      {path && (
        <div className="text-[10px] text-green-600 font-mono mt-1 truncate" title={path}>📂 {path}</div>
      )}
    </div>
  )
}