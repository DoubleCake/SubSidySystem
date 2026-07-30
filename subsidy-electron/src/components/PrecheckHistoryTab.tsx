/**
 * 预检记录 — 批次卡片 + 展开明细
 *
 * 流程：预检 → 保存 → 批次列表 → 点击展开 → 逐条标记 open/fixed
 * 自动比对：当前数据中不存在的身份证号，open → fixed
 */
import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import type { PrecheckRecordItem, PrecheckRecordBatch } from '../types'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

const ERROR_LABELS: Record<string, string> = {
  format_errors: '格式错误', village_errors: '村庄不存在', duplicate_errors: '重复身份证',
  gender_mismatch: '性别不符', error_library_hits: '错误库命中', area_anomalies: '面积异常',
  area_missing: '承包面积缺失', age_anomaly: '年龄异常', deceased_farmers: '死亡农户',
  restricted_farmers: '受限身份', household_duplicates: '家庭重复申请',
  new_farmers: '新增农户', removed_farmers: '减少农户', changed_farmers: '字段变更',
}

const ERROR_COLORS: Record<string, string> = {
  format_errors: 'bg-red-50 text-red-700 border-red-200',
  village_errors: 'bg-red-50 text-red-700 border-red-200',
  duplicate_errors: 'bg-red-50 text-red-700 border-red-200',
  gender_mismatch: 'bg-amber-50 text-amber-700 border-amber-200',
  error_library_hits: 'bg-red-50 text-red-700 border-red-200',
  area_anomalies: 'bg-orange-50 text-orange-700 border-orange-200',
  area_missing: 'bg-orange-50 text-orange-700 border-orange-200',
  age_anomaly: 'bg-amber-50 text-amber-700 border-amber-200',
  deceased_farmers: 'bg-red-50 text-red-700 border-red-200',
  restricted_farmers: 'bg-red-50 text-red-700 border-red-200',
  household_duplicates: 'bg-amber-50 text-amber-700 border-amber-200',
  new_farmers: 'bg-blue-50 text-blue-700 border-blue-200',
  removed_farmers: 'bg-blue-50 text-blue-700 border-blue-200',
  changed_farmers: 'bg-purple-50 text-purple-700 border-purple-200',
}

interface Props {
  subsidyType: { id: number; subsidy_year: number }
  preCheckResults: unknown | null
  refreshKey?: number
}

export default function PrecheckHistoryTab({ subsidyType, refreshKey }: Props) {
  const { toast, show } = useToast()
  const [batches, setBatches] = useState<PrecheckRecordBatch[]>([])
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)
  const [records, setRecords] = useState<PrecheckRecordItem[]>([])
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const loadBatches = useCallback(async () => {
    try {
      const data = await api.getPrecheckBatches(subsidyType.id, subsidyType.subsidy_year)
      setBatches(data.batches || [])
    } catch { /* ignore */ }
  }, [subsidyType.id, subsidyType.subsidy_year, refreshKey])

  const loadRecords = useCallback(async (batchKey: string) => {
    setLoadingRecords(true)
    try {
      const params: Record<string, string | number> = { batch_key: batchKey, page: 1, page_size: 200 }
      if (statusFilter) params.status = statusFilter
      if (typeFilter) params.error_type = typeFilter
      const data = await api.getPrecheckRecords(params)
      setRecords(data.items || [])
    } catch { show('加载失败', 'err') }
    finally { setLoadingRecords(false) }
  }, [statusFilter, typeFilter, show])

  useEffect(() => { loadBatches() }, [loadBatches])
  useEffect(() => {
    if (expandedBatch) loadRecords(expandedBatch)
  }, [expandedBatch, statusFilter, typeFilter, loadRecords])

  const handleToggle = async (id: number) => {
    try {
      await api.togglePrecheckRecord(id)
      if (expandedBatch) loadRecords(expandedBatch)
      loadBatches()
    } catch { show('操作失败', 'err') }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这条记录？')) return
    try {
      await api.deletePrecheckRecord(id)
      if (expandedBatch) loadRecords(expandedBatch)
      loadBatches()
    } catch { show('删除失败', 'err') }
  }

  const label = (k: string) => ERROR_LABELS[k] || k
  const color = (k: string) => ERROR_COLORS[k] || 'bg-gray-50 text-gray-700 border-gray-200'

  return (
    <div>
      {/* 提示文字 */}
      <div className="text-xs text-text-muted mb-3">
        执行预检后点击「💾 保存」将结果存入此处。每次导入新数据后可点「🔄 比对」自动标记已修正的问题。
      </div>

      {batches.length === 0 && (
        <div className="text-center py-16 text-text-muted/50 text-sm">
          暂无预检记录，请先执行数据预检并保存
        </div>
      )}

      {/* 批量对比按钮 */}
      {batches.length > 0 && (
        <div className="mb-4">
          <button
            onClick={async () => {
              try {
                const res = await api.autoResolvePrecheck(subsidyType.id, subsidyType.subsidy_year)
                show(`✓ 自动比对完成：${res.resolved_count}/${res.total} 条已自动修正`)
                loadBatches()
                if (expandedBatch) loadRecords(expandedBatch)
              } catch { show('比对失败', 'err') }
            }}
            className="px-3 py-1.5 text-xs border border-green-200 text-green-700 bg-green-50 rounded-btn hover:bg-green-100"
          >
            🔄 自动比对
          </button>
          <span className="text-xs text-text-muted ml-2">对比当前数据，自动将不再存在的问题标记为「已修正」</span>
        </div>
      )}

      {/* 批次卡片列表 */}
      <div className="space-y-3">
        {batches.map(b => {
          const openCount = b.total - (b.fixed_count || 0)
          const allFixed = openCount === 0
          const isExpanded = expandedBatch === b.batch_key

          return (
            <div key={b.batch_key} className="bg-white border border-border rounded-card overflow-hidden shadow-sm">
              {/* 批次摘要行 */}
              <div
                onClick={() => setExpandedBatch(isExpanded ? null : b.batch_key)}
                className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors hover:bg-warm/20 ${
                  isExpanded ? 'bg-warm/20 border-b border-border/50' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted">{isExpanded ? '▼' : '▶'}</span>
                  <div>
                    <div className="text-sm font-medium text-text-primary">
                      {b.batch_key}
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {b.created_at || ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-text-muted">
                    共 <b className="text-text-primary">{b.total}</b> 条
                  </span>
                  <span className={`${allFixed ? 'text-green-600' : 'text-amber-600'} font-medium`}>
                    已修正 <b>{b.fixed_count || 0}</b>
                  </span>
                  {allFixed && <span className="text-green-500 text-xs">✓</span>}
                  {!allFixed && (
                    <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[11px]">
                      {openCount} 待处理
                    </span>
                  )}
                </div>
              </div>

              {/* 展开的明细 */}
              {isExpanded && (
                <div>
                  {/* 筛选栏 */}
                  <div className="px-4 py-2 border-b border-border/30 bg-warm/10 flex items-center gap-3">
                    <div className="flex items-center gap-0.5 text-xs bg-white border border-border rounded-btn overflow-hidden">
                      {(['', 'open', 'fixed'] as const).map(s => {
                        const lbl: Record<string, string> = { '': '全部', open: '待处理', fixed: '已修正' }
                        return (
                          <button key={s} onClick={() => setStatusFilter(s)}
                            className={`px-2.5 py-1.5 transition-colors ${
                              statusFilter === s
                                ? s === 'fixed' ? 'bg-green-100 text-green-800' : s === 'open' ? 'bg-amber-100 text-amber-800' : 'bg-primary-500/10 text-primary'
                                : 'text-text-muted hover:text-text-primary'
                            }`}>
                            {lbl[s]}
                          </button>
                        )
                      })}
                    </div>
                    <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                      className="border border-border rounded-btn px-2 py-1.5 text-xs bg-white outline-none">
                      <option value="">全部类型</option>
                      {Object.entries(ERROR_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>

                  {/* 记录表格 */}
                  {loadingRecords ? (
                    <div className="text-center py-12 text-text-muted/50 text-sm">加载中…</div>
                  ) : records.length === 0 ? (
                    <div className="text-center py-12 text-text-muted/50 text-sm">当前筛选无记录</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="bg-warm/20 border-b border-border/50">
                            <th className="px-3 py-2 text-left text-text-muted font-semibold w-[90px]">类型</th>
                            <th className="px-3 py-2 text-left text-text-muted font-semibold">姓名</th>
                            <th className="px-3 py-2 text-left text-text-muted font-semibold">身份证</th>
                            <th className="px-3 py-2 text-left text-text-muted font-semibold">村/组</th>
                            <th className="px-3 py-2 text-left text-text-muted font-semibold">描述</th>
                            <th className="px-3 py-2 text-center text-text-muted font-semibold w-[80px]">状态</th>
                            <th className="px-3 py-2 text-center text-text-muted font-semibold w-[60px]">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {records.map(item => {
                            const isFixed = item.status === 'fixed'
                            return (
                              <tr key={item.id} className={`hover:bg-warm/20 transition-colors ${isFixed ? 'opacity-50' : ''}`}>
                                <td className="px-3 py-1.5">
                                  <span className={`inline-block px-1.5 py-0.5 text-[11px] rounded border ${color(item.error_type)}`}>
                                    {label(item.error_type)}
                                  </span>
                                </td>
                                <td className={`px-3 py-1.5 ${isFixed ? 'line-through' : ''}`}>
                                  {item.farmer_name || '—'}
                                </td>
                                <td className={`px-3 py-1.5 font-mono ${isFixed ? 'line-through' : ''}`}>
                                  {item.id_card || '—'}
                                </td>
                                <td className={`px-3 py-1.5 ${isFixed ? 'line-through' : ''}`}>
                                  {[item.village, item.group_no].filter(Boolean).join(' ') || '—'}
                                </td>
                                <td className="px-3 py-1.5 text-text-muted max-w-[300px] truncate" title={item.error_message}>
                                  {item.error_message}
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <button onClick={() => handleToggle(item.id)}
                                    className={`text-[11px] px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                                      isFixed
                                        ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                                        : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                                    }`}>
                                    {isFixed ? '✓ 已修正' : '待处理'}
                                  </button>
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <button onClick={() => handleDelete(item.id)}
                                    className="text-red-300 hover:text-red-500 text-xs">✕</button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
