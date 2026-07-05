import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { getFarmers, getProxies, createProxy, deleteProxy } from '../api'
import type { FarmerOut, SubsidyProxyOut } from '../types'

export default function ProxyManagePage() {
  const { applicationId, paymentId } = useParams<{ applicationId?: string; paymentId?: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  const [loading, setLoading] = useState(false)
  const [farmers, setFarmers] = useState<FarmerOut[]>([])
  const [proxies, setProxies] = useState<SubsidyProxyOut[]>([])
  const [selectedProxyFarmerId, setSelectedProxyFarmerId] = useState<number | ''>('')
  const [proxyRemark, setProxyRemark] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')

  // 从 location state 中获取受益人信息
  const [beneficiaryInfo, setBeneficiaryInfo] = useState<{ id: number; name: string } | null>(() => {
    const state = location.state as { beneficiaryFarmerId?: number; beneficiaryFarmerName?: string }
    if (state?.beneficiaryFarmerId && state?.beneficiaryFarmerName) {
      return { id: state.beneficiaryFarmerId, name: state.beneficiaryFarmerName }
    }
    return null
  })

  const appId = applicationId ? Number(applicationId) : undefined
  const payId = paymentId ? Number(paymentId) : undefined

  // 加载农户列表和现有代领关系
  useEffect(() => {
    loadData()
  }, [applicationId, paymentId])

  async function loadData() {
    setLoading(true)
    try {
      // 加载农户列表
      const farmersResult = await getFarmers({ page: 1, page_size: 500 })
      setFarmers(farmersResult.items)

      // 加载现有代领关系
      const params: Record<string, string | number> = {}
      if (appId) params.application_id = appId
      if (payId) params.payment_id = payId
      const proxyList = await getProxies(params)
      setProxies(proxyList)

      // 如果没有从 state 中获取到受益人信息，但有代领关系，则从代领关系中获取
      if (!beneficiaryInfo && proxyList.length > 0) {
        const proxy = proxyList[0]
        const beneficiary = farmersResult.items.find(f => f.id === proxy.beneficiary_farmer_id)
        setBeneficiaryInfo({
          id: proxy.beneficiary_farmer_id,
          name: beneficiary?.real_name || proxy.beneficiary_farmer_name || '—'
        })
      }
    } catch (e) {
      console.error('加载数据失败', e)
    } finally {
      setLoading(false)
    }
  }

  // 过滤农户列表（排除受益人自己）
  const filteredFarmers = farmers.filter(f => {
    if (beneficiaryInfo && f.id === beneficiaryInfo.id) return false
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
    if (!selectedProxyFarmerId || !beneficiaryInfo) return
    try {
      await createProxy({
        application_id: appId,
        payment_id: payId,
        beneficiary_farmer_id: beneficiaryInfo.id,
        proxy_farmer_id: Number(selectedProxyFarmerId),
        proxy_type: 'proxy',
        remark: proxyRemark || undefined,
      })
      setSelectedProxyFarmerId('')
      setProxyRemark('')
      await loadData()
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
    } catch (e) {
      alert('取消代领失败')
    }
  }

  // 获取代领人姓名
  function getProxyFarmerName(proxy: SubsidyProxyOut) {
    const farmer = farmers.find(f => f.id === proxy.proxy_farmer_id)
    return farmer?.real_name || '未知'
  }

  // 返回上一页
  function handleBack() {
    navigate('/projects')
  }

  return (
    <div className="space-y-4">
      {/* 页面标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded-btn hover:bg-warm/30 text-text-primary"
          >
            ← 返回
          </button>
          <h1 className="text-lg font-bold text-text-primary">代领关系管理</h1>
        </div>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="text-center py-16 text-text-muted">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600 mx-auto mb-3"></div>
          加载中...
        </div>
      )}

      {!loading && (
        <div className="bg-white rounded-card shadow-card border border-border p-6">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* 受益人信息 */}
            {beneficiaryInfo && (
              <div className="bg-amber-50 border border-amber-200 rounded-btn p-4">
                <div className="text-xs text-amber-600 mb-1">受益人</div>
                <div className="font-semibold text-amber-800 text-lg">{beneficiaryInfo.name}</div>
              </div>
            )}

            {/* 没有受益人信息时的提示 */}
            {!beneficiaryInfo && !hasExistingProxy && (
              <div className="bg-red-50 border border-red-200 rounded-btn p-4">
                <div className="text-red-700">
                  无法获取受益人信息，请从补贴项目列表页面进入本页面。
                </div>
              </div>
            )}

            {/* 现有代领关系 */}
            {hasExistingProxy && (
              <div className="border border-border rounded-btn overflow-hidden">
                <div className="bg-warm/30 px-4 py-3 text-sm font-semibold text-text-muted border-b border-border">
                  当前代领关系
                </div>
                <div className="divide-y divide-stone-100">
                  {proxies.map(proxy => (
                    <div key={proxy.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-text-primary">
                          {getProxyFarmerName(proxy)}
                        </div>
                        {proxy.remark && (
                          <div className="text-xs text-text-muted mt-1">{proxy.remark}</div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteProxy(proxy.id)}
                        className="text-xs text-red-500 hover:text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50"
                      >
                        取消代领
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 设置新代领 */}
            {!hasExistingProxy && beneficiaryInfo && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1">搜索代领人</label>
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="输入姓名或身份证搜索"
                    className="w-full border border-border rounded-btn px-4 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs text-text-muted mb-1">选择代领人</label>
                  <select
                    value={selectedProxyFarmerId}
                    onChange={(e) => setSelectedProxyFarmerId(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full border border-border rounded-btn px-4 py-2.5 text-sm outline-none focus:border-primary"
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
                  <label className="block text-xs text-text-muted mb-1">代领备注（可选）</label>
                  <input
                    type="text"
                    value={proxyRemark}
                    onChange={(e) => setProxyRemark(e.target.value)}
                    placeholder="填写代领原因等说明"
                    className="w-full border border-border rounded-btn px-4 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleBack}
                    className="flex-1 px-4 py-2.5 border border-stone-300 text-text-primary rounded-btn hover:bg-warm/30"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateProxy}
                    disabled={!selectedProxyFarmerId}
                    className="flex-1 px-4 py-2.5 bg-primary text-white rounded-btn hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    设置代领
                  </button>
                </div>
              </div>
            )}

            <div className="text-xs text-text-muted pt-3 border-t border-border/50">
              提示：代领关系仅对当前这一条记录有效，每次代领都需要重新设置。
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
