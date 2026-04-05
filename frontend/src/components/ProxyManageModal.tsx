import { useEffect, useState } from 'react'
import Modal from './Modal'
import { getFarmers, getProxies, createProxy, deleteProxy } from '../api'
import type { FarmerOut, SubsidyProxyOut } from '../types'

interface ProxyManageModalProps {
  open: boolean
  onClose: () => void
  applicationId?: number
  paymentId?: number
  beneficiaryFarmerId?: number
  beneficiaryFarmerName?: string
  onProxyChanged?: () => void
}

export default function ProxyManageModal({
  open,
  onClose,
  applicationId,
  paymentId,
  beneficiaryFarmerId,
  beneficiaryFarmerName,
  onProxyChanged,
}: ProxyManageModalProps) {
  const [loading, setLoading] = useState(false)
  const [farmers, setFarmers] = useState<FarmerOut[]>([])
  const [proxies, setProxies] = useState<SubsidyProxyOut[]>([])
  const [selectedProxyFarmerId, setSelectedProxyFarmerId] = useState<number | ''>('')
  const [proxyRemark, setProxyRemark] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')

  // 加载农户列表和现有代领关系
  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open, applicationId, paymentId])

  async function loadData() {
    setLoading(true)
    try {
      // 加载农户列表
      const farmersResult = await getFarmers({ page: 1, page_size: 500 })
      setFarmers(farmersResult.items)

      // 加载现有代领关系
      const params: Record<string, string | number> = {}
      if (applicationId) params.application_id = applicationId
      if (paymentId) params.payment_id = paymentId
      const proxyList = await getProxies(params)
      setProxies(proxyList)
    } catch (e) {
      console.error('加载数据失败', e)
    } finally {
      setLoading(false)
    }
  }

  // 过滤农户列表（排除受益人自己）
  const filteredFarmers = farmers.filter(f => {
    if (beneficiaryFarmerId && f.id === beneficiaryFarmerId) return false
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase()
      return (
        f.real_name.toLowerCase().includes(keyword) ||
        f.id_card_masked.includes(keyword) ||
        f.village_full_name.toLowerCase().includes(keyword)
      )
    }
    return true
  })

  // 检查是否已存在代领关系
  const hasExistingProxy = proxies.length > 0

  // 创建代领关系
  async function handleCreateProxy() {
    if (!selectedProxyFarmerId) return
    try {
      await createProxy({
        application_id: applicationId,
        payment_id: paymentId,
        beneficiary_farmer_id: beneficiaryFarmerId!,
        proxy_farmer_id: Number(selectedProxyFarmerId),
        proxy_type: 'proxy',
        remark: proxyRemark || undefined,
      })
      setSelectedProxyFarmerId('')
      setProxyRemark('')
      await loadData()
      onProxyChanged?.()
    } catch (e) {
      alert('设置代领失败')
    }
  }

  // 删除代领关系
  async function handleDeleteProxy(proxyId: number) {
    if (!confirm('确定要取消代领关系吗？')) return
    try {
      await deleteProxy(proxyId)
      await loadData()
      onProxyChanged?.()
    } catch (e) {
      alert('取消代领失败')
    }
  }

  // 获取代领人姓名
  function getProxyFarmerName(proxy: SubsidyProxyOut) {
    const farmer = farmers.find(f => f.id === proxy.proxy_farmer_id)
    return farmer?.real_name || '未知'
  }

  return (
    <Modal
      open={open}
      title="代领关系管理"
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* 加载状态 */}
        {loading && (
          <div className="text-center py-8 text-stone-400">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-2"></div>
            加载中...
          </div>
        )}

        {!loading && (
          <>
            {/* 受益人信息 */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-xs text-amber-600 mb-1">受益人</div>
              <div className="font-semibold text-amber-800">{beneficiaryFarmerName || '—'}</div>
            </div>

            {/* 现有代领关系 */}
            {hasExistingProxy && (
              <div className="border border-stone-200 rounded-lg overflow-hidden">
                <div className="bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-500 border-b border-stone-200">
                  当前代领关系
                </div>
                <div className="divide-y divide-stone-100">
                  {proxies.map(proxy => (
                    <div key={proxy.id} className="px-3 py-2 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-stone-700">
                          {getProxyFarmerName(proxy)}
                        </div>
                        {proxy.remark && (
                          <div className="text-xs text-stone-400">{proxy.remark}</div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteProxy(proxy.id)}
                        className="text-xs text-red-500 hover:text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-50"
                      >
                        取消代领
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 设置新代领 */}
            {!hasExistingProxy && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-stone-400 mb-1">搜索代领人</label>
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="输入姓名或身份证搜索"
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-xs text-stone-400 mb-1">选择代领人</label>
                  <select
                    value={selectedProxyFarmerId}
                    onChange={(e) => setSelectedProxyFarmerId(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  >
                    <option value="">— 请选择代领人 —</option>
                    {filteredFarmers.map(farmer => (
                      <option key={farmer.id} value={farmer.id}>
                        {farmer.real_name} ({farmer.village_full_name})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-stone-400 mb-1">代领备注（可选）</label>
                  <input
                    type="text"
                    value={proxyRemark}
                    onChange={(e) => setProxyRemark(e.target.value)}
                    placeholder="填写代领原因等说明"
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  />
                </div>

                <button
                  onClick={handleCreateProxy}
                  disabled={!selectedProxyFarmerId}
                  className="w-full px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  设置代领
                </button>
              </div>
            )}

            <div className="text-xs text-stone-400 pt-2 border-t border-stone-100">
              提示：代领关系仅对当前这一条记录有效，每次代领都需要重新设置。
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
