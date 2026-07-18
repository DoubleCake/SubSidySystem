/**
 * 预检错误历史记录组件
 * - 查看历史预检错误，按批次分组
 * - 支持标记已解决（加删除线）/取消已解决
 * - 支持保存当前预检结果
 * - 支持自动比对
 */
import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import type { PrecheckHistoryItem, PrecheckHistoryBatch, CheckResult } from '../types'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

const ERROR_TYPE_COLORS: Record<string, string> = {
  format_errors: 'bg-red-100 text-red-700 border-red-200',
  village_errors: 'bg-red-100 text-red-700 border-red-200',
  duplicate_errors: 'bg-red-100 text-red-700 border-red-200',
  gender_mismatch: 'bg-amber-100 text-amber-700 border-amber-200',
  error_library_hits: 'bg-red-100 text-red-700 border-red-200',
  area_anomalies: 'bg-orange-100 text-orange-700 border-orange-200',
  area_missing: 'bg-orange-100 text-orange-700 border-orange-200',
  age_anomaly: 'bg-amber-100 text-amber-700 border-amber-200',
  deceased_farmers: 'bg-red-100 text-red-700 border-red-200',
  restricted_farmers: 'bg-red-100 text-red-700 border-red-200',
  household_duplicates: 'bg-amber-100 text-amber-700 border-amber-200',
  new_farmers: 'bg-blue-100 text-blue-700 border-blue-200',
  removed_farmers: 'bg-blue-100 text-blue-700 border-blue-200',
  changed_farmers: 'bg-purple-100 text-purple-700 border-purple-200',
}

const ERROR_TYPE_LABELS: Record<string, string> = {
  format_errors: '格式错误',
  village_errors: '村庄不存在',
  duplicate_errors: '重复身份证',
  gender_mismatch: '性别不符',
  error_library_hits: '错误库命中',
  area_anomalies: '面积异常',
  area_missing: '承包面积缺失',
  age_anomaly: '年龄异常',
  deceased_farmers: '已故农户',
  restricted_farmers: '受限身份',
  household_duplicates: '家庭重复申请',
  new_farmers: '新增农户',
  removed_farmers: '减少农户',
  changed_farmers: '字段变更',
}

interface PrecheckHistoryTabProps {
  subsidyType: { id: number; subsidy_year: number }
  preCheckResults: CheckResult | null
}

export default function PrecheckHistoryTab({ subsidyType, preCheckResults }: PrecheckHistoryTabProps) {
  const { toast, show } = useToast()
  const [items, setItems] = useState<PrecheckHistoryItem[]>([])
  const [batches, setBatches] = useState<PrecheckHistoryBatch[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [autoResolving, setAutoResolving] = useState(false)
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [selectedErrorTypes, setSelectedErrorTypes] = useState<string[]>([])

  const pageSize = 30

  const loadBatches = useCallback(async () => {
    try {
      const data = await api.getPrecheckHistoryBatches(subsidyType.id, subsidyType.subsidy_year)
      setBatches(data.batches)
    } catch { /* ignore */ }
  }, [subsidyType.id, subsidyType.subsidy_year])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = {
        subsidy_type_id: subsidyType.id,
        year: subsidyType.subsidy_year,
        page,
        page_size: pageSize,
      }
      if (selectedBatch) params.batch_key = selectedBatch
      if (statusFilter) params.status = statusFilter
      if (errorTypeFilter) params.error_type = errorTypeFilter

      const data = await api.getPrecheckHistory(params)
      setItems(data.items)
      setTotal(data.total)
    } catch { show('加载历史记录失败', 'err') }
    finally { setLoading(false) }
  }, [subsidyType.id, subsidyType.subsidy_year, page, selectedBatch, statusFilter, errorTypeFilter, show])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadBatches() }, [loadBatches])

  // 打开保存对话框，列出当前预检结果中存在的错误类型
  const openSaveModal = () => {
    if (!preCheckResults) {
      show('请先执行数据预检', 'err')
      return
    }
    const available = Object.keys(ERROR_TYPE_LABELS).filter(
      k => Array.isArray((preCheckResults as unknown as Record<string, unknown>)[k])
        && ((preCheckResults as unknown as Record<string, unknown>)[k] as unknown[]).length > 0
    )
    setSelectedErrorTypes(available)
    setShowSaveModal(true)
  }

  // 保存当前预检结果（带错误类型选择）
  const handleSave = async () => {
    if (!preCheckResults) return
    if (selectedErrorTypes.length === 0) {
      show('请至少选择一种错误类型', 'err')
      return
    }
    setSaving(true)
    setShowSaveModal(false)
    try {
      const res = await api.savePrecheckHistory(
        subsidyType.id, subsidyType.subsidy_year,
        preCheckResults, selectedErrorTypes,
      )
      show(`✓ 已保存 ${res.saved} 条错误记录`)
      loadBatches()
      setSelectedBatch(res.batch_key)
      setPage(1)
      load()
    } catch { show('保存失败', 'err') }
    finally { setSaving(false) }
  }

  // 标记已解决
  const handleResolve = async (id: number) => {
    try {
      await api.resolvePrecheckHistory(id)
      load()
      loadBatches()
    } catch { show('操作失败', 'err') }
  }

  // 取消已解决
  const handleUnresolve = async (id: number) => {
    try {
      await api.unresolvePrecheckHistory(id)
      load()
      loadBatches()
    } catch { show('操作失败', 'err') }
  }

  // 删除
  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条记录吗？')) return
    try {
      await api.deletePrecheckHistory(id)
      load()
      loadBatches()
    } catch { show('删除失败', 'err') }
  }

  // 自动比对
  const handleAutoResolve = async () => {
    setAutoResolving(true)
    try {
      const res = await api.autoResolvePrecheckHistory(subsidyType.id, subsidyType.subsidy_year)
      show(`✓ 自动比对完成，已解决 ${res.resolved_count} 条（共 ${res.total} 条待处理）`)
      loadBatches()
      load()
    } catch { show('自动比对失败', 'err') }
    finally { setAutoResolving(false) }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      {/* 顶部操作栏 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={openSaveModal} disabled={saving || !preCheckResults}
          className={`px-3 py-1.5 text-sm rounded-btn flex items-center gap-1.5 ${
            saving ? 'bg-blue-100 text-blue-600' : 'bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100'
          } disabled:opacity-50 disabled:cursor-not-allowed`}>
          {saving ? '⏳ 保存中...' : '💾 保存当前预检结果'}
        </button>
        {preCheckResults && (
          <span className="text-xs text-text-muted">
            (当前预检结果：{preCheckResults.summary?.error_rows || 0} 条错误)
          </span>
        )}
        <button onClick={handleAutoResolve} disabled={autoResolving}
          className={`px-3 py-1.5 text-sm rounded-btn flex items-center gap-1.5 ${
            autoResolving ? 'bg-green-100 text-green-600' : 'bg-green-50 border border-green-200 text-green-700 hover:bg-green-100'
          } disabled:opacity-50 disabled:cursor-not-allowed`}>
          {autoResolving ? '⏳ 比对中...' : '🔄 自动比对'}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* 批次筛选 */}
          <select value={selectedBatch || ''} onChange={e => { setSelectedBatch(e.target.value || null); setPage(1) }}
            className="border border-border rounded-btn px-2 py-1.5 text-xs bg-white outline-none">
            <option value="">全部批次</option>
            {batches.map(b => (
              <option key={b.batch_key} value={b.batch_key}>
                {b.batch_key} ({b.resolved_count}/{b.total})
              </option>
            ))}
          </select>
          {/* 状态筛选 — 三态切换 */}
          <div className="flex items-center gap-0.5 bg-white border border-border rounded-btn overflow-hidden text-xs">
            {(['', 'active', 'resolved'] as const).map(s => {
              const labels: Record<string, string> = { '': '全部', active: '待处理', resolved: '已解决' }
              const colors: Record<string, string> = {
                '': 'text-text-muted hover:text-text-primary',
                active: 'text-amber-700 hover:bg-amber-50',
                resolved: 'text-green-700 hover:bg-green-50',
              }
              const activeColors: Record<string, string> = {
                '': 'bg-warm/40 text-text-primary',
                active: 'bg-amber-100 text-amber-800',
                resolved: 'bg-green-100 text-green-800',
              }
              return (
                <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
                  className={`px-2.5 py-1.5 font-medium transition-colors ${
                    statusFilter === s ? activeColors[s] : colors[s]
                  }`}>
                  {labels[s]}
                </button>
              )
            })}
          </div>
          {/* 错误类型筛选 */}
          <select value={errorTypeFilter} onChange={e => { setErrorTypeFilter(e.target.value); setPage(1) }}
            className="border border-border rounded-btn px-2 py-1.5 text-xs bg-white outline-none">
            <option value="">全部类型</option>
            {Object.entries(ERROR_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 统计数据 */}
      {batches.length > 0 && !selectedBatch && (
        <div className="flex flex-wrap gap-2 mb-4">
          {batches.map(b => (
            <div key={b.batch_key}
              className="px-3 py-2 bg-white border border-border rounded-card text-xs cursor-pointer hover:border-primary-500/30"
              onClick={() => { setSelectedBatch(b.batch_key); setPage(1) }}>
              <div className="font-medium text-text-primary mb-1">{b.batch_key}</div>
              <div className="text-text-muted">
                共 <span className="font-bold text-text-primary">{b.total}</span> 条，
                已解决 <span className="font-bold text-green-600">{b.resolved_count}</span> 条
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 列表 */}
      <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
        {loading && (
          <div className="text-center py-12 text-text-muted/50">加载中…</div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-center py-12 text-text-muted/50 text-sm">
            {batches.length === 0
              ? '暂无预检历史记录，请先执行数据预检并点击「保存当前预检结果」'
              : '当前筛选条件下无记录'}
          </div>
        )}
        {!loading && items.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-warm/30 border-b-2 border-border">
                <th className="px-3 py-2 text-left text-xs text-text-muted font-semibold">错误类型</th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-semibold">姓名</th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-semibold">身份证</th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-semibold">村组</th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-semibold">错误描述</th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-semibold">批次</th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-semibold">状态</th>
                <th className="px-3 py-2 text-center text-xs text-text-muted font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map(item => {
                const isResolved = item.status === 'resolved'
                const colorClass = ERROR_TYPE_COLORS[item.error_type] || 'bg-gray-100 text-gray-700 border-gray-200'
                const label = ERROR_TYPE_LABELS[item.error_type] || item.error_type

                return (
                  <tr key={item.id} className={`hover:bg-warm/30 ${isResolved ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded border ${colorClass}`}>
                        {label}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-sm font-medium ${isResolved ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                      {item.farmer_name || '—'}
                    </td>
                    <td className={`px-3 py-2 text-xs font-mono ${isResolved ? 'line-through text-text-muted' : 'text-text-muted'}`}>
                      {item.id_card || '—'}
                    </td>
                    <td className={`px-3 py-2 text-xs ${isResolved ? 'line-through text-text-muted' : 'text-text-muted'}`}>
                      {[item.village, item.group_no].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className={`px-3 py-2 text-xs max-w-[260px] truncate ${isResolved ? 'line-through text-text-muted' : 'text-text-primary'}`}
                      title={item.error_message}>
                      {item.error_message}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {item.batch_key}
                    </td>
                    <td className="px-3 py-2">
                      {isResolved ? (
                        <span onClick={() => handleUnresolve(item.id)}
                          className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded cursor-pointer hover:brightness-95 inline-block">已解决</span>
                      ) : (
                        <span onClick={() => handleResolve(item.id)}
                          className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded cursor-pointer hover:brightness-95 inline-block">待处理</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-center">
                        {isResolved ? (
                          <button onClick={() => handleUnresolve(item.id)}
                            className="text-xs border border-border px-2 py-1 rounded text-text-muted hover:text-primary hover:border-primary-500/20">
                            取消
                          </button>
                        ) : (
                          <button onClick={() => handleResolve(item.id)}
                            className="text-xs border border-green-200 px-2 py-1 rounded text-green-700 hover:bg-green-50">
                            ✓ 已解决
                          </button>
                        )}
                        <button onClick={() => handleDelete(item.id)}
                          className="text-xs text-red-400 border border-red-100 px-2 py-1 rounded hover:bg-red-50">
                          删
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {/* 分页 */}
        {total > pageSize && (
          <div className="px-4 py-2 border-t border-border/50 bg-warm/10 flex justify-between text-xs text-text-muted">
            <span>共 {total} 条</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-2.5 py-1 border border-border rounded disabled:opacity-40">‹</button>
              <span className="px-2 py-1">第 {page}/{totalPages} 页</span>
              <button disabled={page * pageSize >= total} onClick={() => setPage(p => p + 1)}
                className="px-2.5 py-1 border border-border rounded disabled:opacity-40">›</button>
            </div>
          </div>
        )}
      </div>

      {/* 保存预检结果对话框 */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setShowSaveModal(false)}>
          <div className="bg-white rounded-card shadow-xl border border-border p-5 w-[420px] max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-text-primary mb-1">选择要保存的错误类型</h3>
            <p className="text-xs text-text-muted mb-4">
              当前预检结果共 {selectedErrorTypes.reduce((s, k) => s + ((preCheckResults as unknown as Record<string, unknown[]>)[k]?.length || 0), 0)} 条错误
            </p>
            <div className="space-y-2">
              {Object.entries(ERROR_TYPE_LABELS).map(([key, label]) => {
                const count = ((preCheckResults as unknown as Record<string, unknown[]>)[key]?.length || 0)
                if (count === 0) return null
                return (
                  <label key={key}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded border cursor-pointer text-sm
                      ${selectedErrorTypes.includes(key) ? 'border-primary-500/40 bg-primary-500/5' : 'border-border'}`}>
                    <input type="checkbox" checked={selectedErrorTypes.includes(key)}
                      onChange={() => setSelectedErrorTypes(prev =>
                        prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]
                      )} className="accent-primary" />
                    <span className="flex-1">{label}</span>
                    <span className="text-xs text-text-muted">{count} 条</span>
                  </label>
                )
              })}
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowSaveModal(false)}
                className="px-4 py-1.5 text-sm border border-border rounded-btn text-text-muted hover:bg-warm/30">
                取消
              </button>
              <button onClick={handleSave} disabled={selectedErrorTypes.length === 0}
                className="px-4 py-1.5 text-sm bg-primary-500 rounded-btn hover:bg-primary-500/90 disabled:opacity-50">
                确定保存 ({selectedErrorTypes.reduce((s, k) => s + ((preCheckResults as unknown as Record<string, unknown[]>)[k]?.length || 0), 0)} 条)
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
