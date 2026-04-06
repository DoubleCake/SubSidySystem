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
  proxy_farmer_name?: string
  proxy_id_card_masked?: string
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

  const loadProxies = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = {
        page,
        page_size: 20,
        subsidy_type_id: subsidyType.id,
      }
      if (search) params.search = search

      const response = await fetch(`/api/subsidies/proxies?${new URLSearchParams(params as Record<string, string>)}`).then(r => r.json())
      setProxies(response.items || [])
      setTotal(response.total || 0)
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

  const deleteProxy = async (id: number) => {
    try {
      const response = await fetch(`/api/subsidies/proxies/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('删除失败')
      show('✓ 代领关系已删除')
      setDeleteId(null)
      loadProxies()
    } catch (error) {
      show('删除失败: ' + (error as Error).message, 'err')
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      {/* 搜索栏 */}
      <div className="px-4 py-3 border-b border-stone-200 bg-stone-50/50 flex items-center gap-3">
        <span className="text-xs text-stone-400">搜索：</span>
        <div className="flex items-center gap-1 flex-1 min-w-[200px] max-w-[300px]">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="被代领人/代领人姓名"
            className="flex-1 border border-stone-200 rounded-lg px-2 py-1.5 text-xs outline-none" />
          <button onClick={() => setPage(1)} className="px-2 py-1 text-xs bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">搜索</button>
        </div>
        <span className="text-xs text-stone-400">共 {total} 条</span>
      </div>

      <table className="w-full border-collapse min-w-[800px]">
        <thead>
          <tr className="bg-stone-50 border-b-2 border-stone-200">
            {['被代领人', '被代领人身份证', '代领人', '代领人身份证', '关系类型', '备注', '创建时间', '操作'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="text-center py-10 text-stone-300">加载中…</td></tr>}
          {!loading && proxies.length === 0 && (
            <tr><td colSpan={8} className="text-center py-10 text-stone-300 text-sm">暂无代领关系记录</td></tr>
          )}
          {!loading && proxies.map(p => (
            <tr key={p.id} className="border-b border-stone-50 hover:bg-stone-50">
              <td className="px-3 py-2.5 text-sm font-semibold text-stone-700">{p.beneficiary_farmer_name || '—'}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-stone-400">{p.beneficiary_id_card_masked || '—'}</td>
              <td className="px-3 py-2.5 text-sm text-stone-600">{p.proxy_farmer_name || '—'}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-stone-400">{p.proxy_id_card_masked || '—'}</td>
              <td className="px-3 py-2.5"><Tag label={p.proxy_type || '代领'} color="amber" /></td>
              <td className="px-3 py-2.5 text-xs text-stone-400 max-w-[150px] truncate" title={p.remark || ''}>{p.remark || '—'}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-stone-400">{p.created_at?.split('T')[0] || '—'}</td>
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
      <div className="px-4 py-2 border-t border-stone-100 bg-stone-50/50 flex justify-end text-xs text-stone-400">
        <div className="flex gap-1">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">‹</button>
          <span className="px-2 py-1">第{page}/{Math.max(1, Math.ceil(total / 20))}页</span>
          <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}
            className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">›</button>
        </div>
      </div>

      {/* 删除确认 */}
      <Modal open={deleteId !== null} title="确认删除" onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteProxy(deleteId)} confirmText="确认删除">
        <p className="text-sm text-stone-600">删除后无法恢复，确认要删除这条代领关系吗？</p>
      </Modal>
    </div>
  )
}