/**
 * 代领列表组件
 * 显示某补贴项目下的代领关系列表
 */
import { useState, useEffect, useCallback } from 'react'
import Modal from '../components/Modal'
import Tag from '../components/Tag'
import * as api from '../api'

interface ProxyRelation {
  id: number
  application_id?: number
  payment_id?: number
  beneficiary_farmer_id: number
  proxy_farmer_id: number
  proxy_type: string
  remark?: string
  created_at: string
  updated_at: string
  beneficiary_farmer_name?: string
  beneficiary_id_card_masked?: string
  beneficiary_id_card?: string
  proxy_farmer_name?: string
  proxy_id_card_masked?: string
  proxy_id_card?: string
  subsidy_type_id?: number
}

interface ProxyListProps {
  subsidyType: {
    id: number
    subsidy_year: number
    subsidy_name: string
  }
  show: (msg: string, type?: 'ok' | 'err') => void
}

export default function ProxyList({ subsidyType, show }: ProxyListProps) {
  const [proxies, setProxies] = useState<ProxyRelation[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  const loadProxies = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = {
        page,
        page_size: 20,
        subsidy_type_id: subsidyType.id,
      }
      if (search) params.search = search

      const response = await api.getProxies(params)
      setProxies(response || [])
      setTotal((response || []).length)
    } catch (error) {
      console.error('加载代领关系失败:', error)
      show('加载代领关系失败', 'err')
    } finally {
      setLoading(false)
    }
  }, [page, search, subsidyType.id, show])

  useEffect(() => {
    loadProxies()
  }, [loadProxies])

  // 切换页码或搜索时清空选中
  useEffect(() => {
    setSelectedIds(new Set())
    setSelectAll(false)
  }, [page, search])

  const deleteProxy = async (id: number) => {
    try {
      await api.deleteProxy(id)
      show('✓ 代领关系已删除')
      setDeleteId(null)
      loadProxies()
    } catch (error) {
      show('删除失败: ' + (error as Error).message, 'err')
    }
  }

  // 批量删除
  const batchDelete = async () => {
    if (selectedIds.size === 0) {
      show('请先选择要删除的代领关系', 'err')
      return
    }
    try {
      await Promise.all([...selectedIds].map(id => api.deleteProxy(id)))
      show(`✓ 已删除 ${selectedIds.size} 条代领关系`)
      setSelectedIds(new Set())
      setSelectAll(false)
      loadProxies()
    } catch (error) {
      show('批量删除失败: ' + (error as Error).message, 'err')
    }
  }

  // 切换单选
  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
    setSelectAll(false)
  }

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedIds(new Set())
      setSelectAll(false)
    } else {
      setSelectedIds(new Set(proxies.map(p => p.id)))
      setSelectAll(true)
    }
  }

  return (
    <div className="bg-white border border-border rounded-card overflow-hidden">
      {/* 搜索栏 */}
      <div className="px-4 py-3 border-b border-border bg-warm/10 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-text-muted">搜索：</span>
        <div className="flex items-center gap-1 min-w-[200px] max-w-[300px]">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="被代领人/代领人姓名"
            className="flex-1 border border-border rounded-btn px-2 py-1.5 text-xs outline-none" />
          <button onClick={() => setPage(1)} className="px-2 py-1 text-xs bg-primary  rounded-btn hover:bg-primary/90">搜索</button>
        </div>
        <span className="text-xs text-text-muted">共 {total} 条</span>
        {selectedIds.size > 0 && (
          <button onClick={batchDelete}
            className="px-3 py-1.5 text-xs bg-red-600  rounded-btn hover:bg-red-500">
            批量删除 ({selectedIds.size})
          </button>
        )}
      </div>

      <table className="w-full border-collapse min-w-[800px]">
        <thead>
          <tr className="bg-warm/30 border-b-2 border-border">
            <th className="px-3 py-2.5 text-left text-xs text-text-muted font-semibold whitespace-nowrap w-10">
              <input type="checkbox" checked={selectAll && proxies.length > 0} onChange={toggleSelectAll} className="rounded" />
            </th>
            {['被代领人', '被代领人身份证', '代领人', '代领人身份证', '关系类型', '备注', '创建时间', '操作'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs text-text-muted font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={9} className="text-center py-10 text-text-muted/50">加载中…</td></tr>}
          {!loading && proxies.length === 0 && (
            <tr><td colSpan={9} className="text-center py-10 text-text-muted/50 text-sm">暂无代领关系记录</td></tr>
          )}
          {!loading && proxies.map(p => (
            <tr key={p.id} className={`border-b border-border/50 hover:bg-warm/30 ${selectedIds.has(p.id) ? 'bg-amber-50' : ''}`}>
              <td className="px-3 py-2.5">
                <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} className="rounded" />
              </td>
              <td className="px-3 py-2.5 text-sm font-semibold text-text-primary">{p.beneficiary_farmer_name || '—'}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-text-muted">{p.beneficiary_id_card || '—'}</td>
              <td className="px-3 py-2.5 text-sm text-text-primary">{p.proxy_farmer_name || '—'}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-text-muted">{p.proxy_id_card || '—'}</td>
              <td className="px-3 py-2.5"><Tag label={p.proxy_type || '代领'} color="amber" /></td>
              <td className="px-3 py-2.5 text-xs text-text-muted max-w-[150px] truncate" title={p.remark || ''}>{p.remark || '—'}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-text-muted">{p.created_at?.split('T')[0] || '—'}</td>
              <td className="px-3 py-2.5">
                <button onClick={() => setDeleteId(p.id)}
                  className="text-xs text-red-400 border border-red-100 px-2 py-1 rounded hover:bg-red-50">
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 分页 */}
      <div className="px-4 py-2 border-t border-border/50 bg-warm/10 flex justify-end text-xs text-text-muted">
        <div className="flex gap-1">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-2.5 py-1 border border-border rounded disabled:opacity-40">‹</button>
          <span className="px-2 py-1">第{page}/{Math.max(1, Math.ceil(total / 20))}页</span>
          <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}
            className="px-2.5 py-1 border border-border rounded disabled:opacity-40">›</button>
        </div>
      </div>

      {/* 删除确认 */}
      <Modal open={deleteId !== null} title="确认删除" onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteProxy(deleteId)} confirmText="确认删除">
        <p className="text-sm text-text-primary">删除后无法恢复，确认要删除这条代领关系吗？</p>
      </Modal>
    </div>
  )
}