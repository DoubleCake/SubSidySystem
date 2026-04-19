/**
 * 种植大户/家庭农场/合作社管理页
 * 管理规模经营主体信息，以及与普通农户的代耕代种关联
 */
import { useState, useEffect, useCallback } from 'react'
import Modal from '../components/Modal'
import Tag from '../components/Tag'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface LargeFarmer {
  id: number
  operator_name: string
  operator_type: string
  operator_type_label: string
  id_card: string | null
  phone: string | null
  bank_card: string | null
  bank_name: string | null
  village_id: number
  village_name: string
  group_no: number | null
  address: string | null
  total_managed_area: number | null
  own_contract_area: number | null
  trust_in_area: number | null
  total_trust_in_area: number | null
  main_crops: string | null
  registration_no: string | null
  registration_date: string | null
  status: number
  is_verified: number
  verified_by: string | null
  verified_date: string | null
  remark: string | null
  operator: string | null
  created_at: string
  updated_at: string
}

interface LargeFarmerTrust {
  id: number
  large_farmer_id: number
  owner_household_id: number
  owner_household_name: string
  owner_household_code: string
  land_trust_id: number | null
  trust_year: number
  area: number
  trust_type: string
  trust_type_label: string
  parcel_desc: string | null
  parcel_location: string | null
  contract_no: string | null
  start_date: string | null
  end_date: string | null
  annual_fee: number | null
  total_fee: number | null
  payment_method: string | null
  data_reliability: string
  reliability_label: string
  is_active: number
  affect_subsidy_calc: number
  note: string | null
  operator: string | null
  created_at: string
  updated_at: string
}

interface VillageOption { id: number; village_name: string }
interface HHOption { id: number; household_code: string; household_name: string; head_name: string; village_full_name: string; contract_area: number | null }

const OPERATOR_TYPE_OPTS = [
  { val: 'FAMILY_FARM', label: '家庭农场', icon: '🏠', color: 'blue' as const },
  { val: 'COOPERATIVE', label: '合作社', icon: '🏘️', color: 'green' as const },
  { val: 'LARGE_PLANTER', label: '种植大户', icon: '🌾', color: 'amber' as const },
  { val: 'OTHER', label: '其他', icon: '📋', color: 'gray' as const },
]

const TRUST_TYPE_OPTS = [
  { val: 'ENTRUST', label: '代耕代种', desc: '口头委托' },
  { val: 'RENT', label: '出租', desc: '有租赁合同' },
  { val: 'TRANSFER', label: '流转', desc: '正式转让' },
]

const RELIABILITY_OPTS = [
  { val: 'CERTIFIED', label: '有书面合同', color: 'green' as const },
  { val: 'VILLAGE_CONFIRM', label: '村委确认', color: 'blue' as const },
  { val: 'SELF_REPORT', label: '农户自报', color: 'amber' as const },
  { val: 'SUSPECTED', label: '存疑', color: 'red' as const },
]

const thisYear = new Date().getFullYear()
const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i)

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

const emptyFarmerForm = () => ({
  operator_name: '',
  operator_type: 'FAMILY_FARM' as const,
  id_card: '',
  phone: '',
  bank_card: '',
  bank_name: '',
  village_id: null as number | null,
  group_no: '',
  address: '',
  total_managed_area: '',
  own_contract_area: '',
  main_crops: '',
  registration_no: '',
  registration_date: '',
  status: 1,
  is_verified: 0,
  remark: '',
})

const emptyTrustForm = () => ({
  owner_household_id: null as number | null,
  land_trust_id: null as number | null,
  trust_year: thisYear,
  area: '',
  trust_type: 'ENTRUST' as const,
  parcel_desc: '',
  parcel_location: '',
  contract_no: '',
  start_date: '',
  end_date: '',
  annual_fee: '',
  total_fee: '',
  payment_method: '',
  data_reliability: 'VILLAGE_CONFIRM' as const,
  affect_subsidy_calc: 1,
  note: '',
})

export default function LargeFarmersPage() {
  const { toast, show } = useToast()

  // 列表筛选
  const [villageFilter, setVillageFilter] = useState<number | ''>('')
  const [typeFilter, setTypeFilter] = useState('')
  const [keywordFilter, setKeywordFilter] = useState('')

  // 大户列表
  const [list, setList] = useState<LargeFarmer[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // 村组选项
  const [villages, setVillages] = useState<VillageOption[]>([])

  // 新增/编辑大户
  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<LargeFarmer | null>(null)
  const [farmerForm, setFarmerForm] = useState(emptyFarmerForm())

  // 大户详情 & 代耕代种列表
  const [selectedFarmer, setSelectedFarmer] = useState<LargeFarmer | null>(null)
  const [trustList, setTrustList] = useState<LargeFarmerTrust[]>([])
  const [trustYear, setTrustYear] = useState(thisYear)
  const [detailLoading, setDetailLoading] = useState(false)

  // 新增/编辑代耕代种
  const [trustEditOpen, setTrustEditOpen] = useState(false)
  const [trustEditTarget, setTrustEditTarget] = useState<LargeFarmerTrust | null>(null)
  const [trustForm, setTrustForm] = useState(emptyTrustForm())
  const [ownerSearch, setOwnerSearch] = useState('')
  const [ownerOpts, setOwnerOpts] = useState<HHOption[]>([])

  const loadVillages = useCallback(async () => {
    try {
      const r = await req<{ id: number; village_name: string }[]>('/api/settings/villages')
      setVillages(r)
    } catch (e) {
      console.error('加载村组失败', e)
    }
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20' })
      if (villageFilter) p.set('village_id', String(villageFilter))
      if (typeFilter) p.set('operator_type', typeFilter)
      if (keywordFilter) p.set('keyword', keywordFilter)
      const r = await req<{ total: number; items: LargeFarmer[] }>(`/api/large-farmers?${p}`)
      setList(r.items); setTotal(r.total)
    } finally { setLoading(false) }
  }, [page, villageFilter, typeFilter, keywordFilter])

  const loadFarmerDetail = useCallback(async (farmer: LargeFarmer) => {
    setSelectedFarmer(farmer)
    setDetailLoading(true)
    try {
      const r = await req<{ items: LargeFarmerTrust[] }>(`/api/large-farmers/${farmer.id}/trusts?year=${trustYear}`)
      setTrustList(r.items)
    } finally { setDetailLoading(false) }
  }, [trustYear])

  useEffect(() => { loadVillages() }, [loadVillages])
  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { if (selectedFarmer) loadFarmerDetail(selectedFarmer) }, [loadFarmerDetail, selectedFarmer, trustYear])

  // 家庭户搜索
  const searchHH = async (q: string) => {
    if (q.length < 1) { setOwnerOpts([]); return }
    const r = await req<HHOption[]>(`/api/land/search-household?q=${encodeURIComponent(q)}`).catch(() => [])
    setOwnerOpts(r)
  }
  useEffect(() => { searchHH(ownerSearch) }, [ownerSearch])

  // 大户表单操作
  const openAddFarmer = () => {
    setEditTarget(null); setFarmerForm(emptyFarmerForm()); setEditOpen(true)
  }
  const openEditFarmer = (f: LargeFarmer) => {
    setEditTarget(f)
    setFarmerForm({
      operator_name: f.operator_name,
      operator_type: f.operator_type as any,
      id_card: f.id_card || '',
      phone: f.phone || '',
      bank_card: f.bank_card || '',
      bank_name: f.bank_name || '',
      village_id: f.village_id,
      group_no: f.group_no ? String(f.group_no) : '',
      address: f.address || '',
      total_managed_area: f.total_managed_area ? String(f.total_managed_area) : '',
      own_contract_area: f.own_contract_area ? String(f.own_contract_area) : '',
      main_crops: f.main_crops || '',
      registration_no: f.registration_no || '',
      registration_date: f.registration_date || '',
      status: f.status,
      is_verified: f.is_verified,
      remark: f.remark || '',
    })
    setEditOpen(true)
  }
  const submitFarmer = async () => {
    if (!farmerForm.operator_name) return show('请填写经营者名称', 'err')
    if (!farmerForm.village_id) return show('请选择所属村', 'err')

    const payload = {
      ...farmerForm,
      group_no: farmerForm.group_no ? Number(farmerForm.group_no) : null,
      total_managed_area: farmerForm.total_managed_area ? Number(farmerForm.total_managed_area) : null,
      own_contract_area: farmerForm.own_contract_area ? Number(farmerForm.own_contract_area) : null,
      registration_date: farmerForm.registration_date || null,
    }
    try {
      if (editTarget) {
        await req(`/api/large-farmers/${editTarget.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        show('✓ 更新成功')
      } else {
        await req('/api/large-farmers', { method: 'POST', body: JSON.stringify(payload) })
        show('✓ 创建成功')
      }
      setEditOpen(false); loadList()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }
  const deleteFarmer = async (id: number) => {
    if (!confirm('确认删除此大户信息？')) return
    await req(`/api/large-farmers/${id}`, { method: 'DELETE' })
    show('✓ 已删除'); loadList()
    if (selectedFarmer?.id === id) setSelectedFarmer(null)
  }

  // 代耕代种表单操作
  const openAddTrust = () => {
    setTrustEditTarget(null); setTrustForm(emptyTrustForm()); setOwnerSearch(''); setOwnerOpts([]); setTrustEditOpen(true)
  }
  const openEditTrust = (t: LargeFarmerTrust) => {
    setTrustEditTarget(t)
    setTrustForm({
      owner_household_id: t.owner_household_id,
      land_trust_id: t.land_trust_id,
      trust_year: t.trust_year,
      area: String(t.area),
      trust_type: t.trust_type as any,
      parcel_desc: t.parcel_desc || '',
      parcel_location: t.parcel_location || '',
      contract_no: t.contract_no || '',
      start_date: t.start_date || '',
      end_date: t.end_date || '',
      annual_fee: t.annual_fee ? String(t.annual_fee) : '',
      total_fee: t.total_fee ? String(t.total_fee) : '',
      payment_method: t.payment_method || '',
      data_reliability: t.data_reliability as any,
      affect_subsidy_calc: t.affect_subsidy_calc,
      note: t.note || '',
    })
    setOwnerSearch(t.owner_household_name)
    setTrustEditOpen(true)
  }
  const submitTrust = async () => {
    if (!selectedFarmer) return
    if (!trustForm.owner_household_id) return show('请选择流出方（承包人家庭户）', 'err')
    if (!trustForm.trust_year) return show('请选择流转年度', 'err')
    if (!trustForm.area) return show('请填写流转面积', 'err')

    const payload = {
      ...trustForm,
      area: Number(trustForm.area),
      annual_fee: trustForm.annual_fee ? Number(trustForm.annual_fee) : null,
      total_fee: trustForm.total_fee ? Number(trustForm.total_fee) : null,
      start_date: trustForm.start_date || null,
      end_date: trustForm.end_date || null,
      payment_method: trustForm.payment_method || null,
      parcel_desc: trustForm.parcel_desc || null,
      parcel_location: trustForm.parcel_location || null,
      contract_no: trustForm.contract_no || null,
      note: trustForm.note || null,
    }
    try {
      if (trustEditTarget) {
        await req(`/api/large-farmers/${selectedFarmer.id}/trusts/${trustEditTarget.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        show('✓ 更新成功')
      } else {
        await req(`/api/large-farmers/${selectedFarmer.id}/trusts`, { method: 'POST', body: JSON.stringify(payload) })
        show('✓ 创建成功')
      }
      setTrustEditOpen(false); loadFarmerDetail(selectedFarmer); loadList()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }
  const deleteTrust = async (id: number) => {
    if (!selectedFarmer || !confirm('确认删除此代耕代种关联？')) return
    await req(`/api/large-farmers/${selectedFarmer.id}/trusts/${id}`, { method: 'DELETE' })
    show('✓ 已删除'); loadFarmerDetail(selectedFarmer); loadList()
  }

  const sff = (k: keyof ReturnType<typeof emptyFarmerForm>, v: unknown) => setFarmerForm(f => ({ ...f, [k]: v }))
  const sft = (k: keyof ReturnType<typeof emptyTrustForm>, v: unknown) => setTrustForm(f => ({ ...f, [k]: v }))

  const OPERATOR_COLOR: Record<string, 'blue'|'green'|'amber'|'gray'> = {
    FAMILY_FARM: 'blue', COOPERATIVE: 'green', LARGE_PLANTER: 'amber', OTHER: 'gray'
  }

  const totalTrustArea = trustList.reduce((sum, t) => sum + (t.area || 0), 0)
  const ownArea = selectedFarmer?.own_contract_area || 0
  const totalManaged = ownArea + totalTrustArea

  return (
    <div className="grid grid-cols-[1fr_440px] gap-4">
      {/* ── 左列：大户列表 ── */}
      <div>
        {/* 工具栏 */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <select value={villageFilter} onChange={e => { setVillageFilter(e.target.value ? Number(e.target.value) : ''); setPage(1) }}
            className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
            <option value="">所有村</option>
            {villages.map(v => <option key={v.id} value={v.id}>{v.village_name}</option>)}
          </select>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
            className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
            <option value="">所有类型</option>
            {OPERATOR_TYPE_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
          <input value={keywordFilter} onChange={e => { setKeywordFilter(e.target.value); setPage(1) }}
            placeholder="搜索名称、电话、身份证…"
            className="border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none flex-1 min-w-[160px]" />
          <span className="text-xs text-stone-400">共 {total} 条</span>
          <button onClick={openAddFarmer}
            className="ml-auto px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
            ＋ 新增大户
          </button>
        </div>

        {/* 说明栏 */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-xs text-blue-700">
          <p>管理种植大户、家庭农场、合作社等规模经营主体信息。点击右侧「代耕代种」标签可管理与普通农户的关联关系。</p>
        </div>

        {/* 列表 */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full border-collapse">
            <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
              {['经营者名称','类型','所属村','经营面积','状态','操作'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="text-center py-10 text-stone-300">加载中…</td></tr>}
              {!loading && list.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-stone-300 text-sm">
                  暂无大户信息，点击「＋ 新增大户」添加
                </td></tr>
              )}
              {list.map(f => (
                <tr key={f.id} className={`border-b border-stone-50 hover:bg-stone-50 cursor-pointer ${selectedFarmer?.id === f.id ? 'bg-emerald-50' : ''}`}
                  onClick={() => loadFarmerDetail(f)}>
                  <td className="px-3 py-2.5">
                    <div className="text-sm font-semibold">{f.operator_name}</div>
                    {f.phone && <div className="text-xs text-stone-400">{f.phone}</div>}
                  </td>
                  <td className="px-3 py-2.5"><Tag label={f.operator_type_label} color={OPERATOR_COLOR[f.operator_type] || 'gray'} /></td>
                  <td className="px-3 py-2.5 text-sm">{f.village_name}</td>
                  <td className="px-3 py-2.5 text-sm font-mono">
                    {f.total_managed_area ? `${f.total_managed_area}亩` : <span className="text-stone-300">未填</span>}
                    {f.total_trust_in_area ? <div className="text-xs text-emerald-600">+{f.total_trust_in_area}亩流入</div> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {f.status === 1 ? <Tag label="正常" color="green" /> : <Tag label="注销" color="gray" />}
                      {f.is_verified === 1 && <Tag label="已审核" color="blue" />}
                    </div>
                  </td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button onClick={() => openEditFarmer(f)} className="text-xs border border-stone-200 text-stone-500 px-2 py-1 rounded hover:border-stone-300">编辑</button>
                      <button onClick={() => deleteFarmer(f.id)} className="text-xs border border-red-100 text-red-400 px-2 py-1 rounded hover:bg-red-50">删</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-stone-100 bg-stone-50/50 flex justify-between text-xs text-stone-400">
            <span>共{total}条</span>
            <div className="flex gap-1">
              <button disabled={page<=1} onClick={() => setPage(p=>p-1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">‹</button>
              <span className="px-2">{page}/{Math.max(1,Math.ceil(total/20))}</span>
              <button disabled={page*20>=total} onClick={() => setPage(p=>p+1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">›</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 右列：大户详情 & 代耕代种列表 ── */}
      <div>
        {!selectedFarmer ? (
          <div className="bg-white border border-stone-200 rounded-xl p-6 shadow-sm sticky top-4 text-center text-stone-400 text-sm">
            点击左侧大户查看详情和代耕代种关联
          </div>
        ) : (
          <div className="space-y-4">
            {/* 大户基本信息卡片 */}
            <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-stone-800">{selectedFarmer.operator_name}</h3>
                <Tag label={selectedFarmer.operator_type_label} color={OPERATOR_COLOR[selectedFarmer.operator_type] || 'gray'} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-stone-400">所属村：</span>{selectedFarmer.village_name}</div>
                {selectedFarmer.phone && <div><span className="text-stone-400">电话：</span>{selectedFarmer.phone}</div>}
                <div><span className="text-stone-400">自有承包：</span><span className="font-mono">{ownArea}亩</span></div>
                <div><span className="text-stone-400">流入面积：</span><span className="font-mono text-emerald-600">+{totalTrustArea}亩</span></div>
                <div className="col-span-2"><span className="text-stone-400">总计经营：</span><span className="font-mono font-bold text-stone-800">{totalManaged}亩</span></div>
              </div>
            </div>

            {/* 代耕代种列表 */}
            <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-stone-700 text-sm">代耕代种关联</h3>
                  <select value={trustYear} onChange={e => setTrustYear(Number(e.target.value))}
                    className="border border-stone-200 rounded px-2 py-1 text-xs bg-white outline-none">
                    {years.map(y => <option key={y} value={y}>{y}年</option>)}
                  </select>
                </div>
                <button onClick={openAddTrust} className="text-xs px-2 py-1 bg-emerald-700 text-white rounded hover:bg-emerald-600">
                  ＋ 添加关联
                </button>
              </div>

              {detailLoading && <div className="py-4 text-center text-stone-300 text-sm">加载中…</div>}

              {!detailLoading && trustList.length === 0 && (
                <div className="py-4 text-center text-stone-300 text-sm">
                  {trustYear}年暂无代耕代种关联
                </div>
              )}

              {!detailLoading && trustList.length > 0 && (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {trustList.map(t => (
                    <div key={t.id} className="border border-stone-100 rounded-lg p-3">
                      <div className="flex justify-between items-start mb-1">
                        <div>
                          <div className="text-sm font-semibold">{t.owner_household_name}</div>
                          <div className="text-xs text-stone-400 font-mono">{t.owner_household_code}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono font-bold text-emerald-700">{t.area}亩</div>
                          <Tag label={t.trust_type_label} size="sm" color="blue" />
                        </div>
                      </div>
                      {t.parcel_desc && <div className="text-xs text-stone-400 mb-1">地块：{t.parcel_desc}</div>}
                      <div className="flex items-center justify-between">
                        <Tag label={t.reliability_label} size="sm" color={
                          t.data_reliability === 'CERTIFIED' ? 'green' :
                          t.data_reliability === 'VILLAGE_CONFIRM' ? 'blue' :
                          t.data_reliability === 'SELF_REPORT' ? 'amber' : 'red'
                        } />
                        <div className="flex gap-1">
                          <button onClick={() => openEditTrust(t)} className="text-xs text-stone-400 hover:text-stone-600">编辑</button>
                          <button onClick={() => deleteTrust(t.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!detailLoading && trustList.length > 0 && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-400">当年流入总面积</span>
                    <span className="font-mono font-bold text-emerald-700">{totalTrustArea}亩</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 新增/编辑大户弹窗 */}
      <Modal open={editOpen} title={editTarget ? '编辑大户信息' : '新增大户'}
        onClose={() => setEditOpen(false)} onConfirm={submitFarmer} width={560}>
        <div className="space-y-4">
          {/* 类型选择 */}
          <div>
            <label className="block text-xs text-stone-400 mb-2">主体类型</label>
            <div className="grid grid-cols-4 gap-1.5">
              {OPERATOR_TYPE_OPTS.map(o => (
                <div key={o.val} onClick={() => sff('operator_type', o.val)}
                  className={`border-2 rounded-xl p-2 cursor-pointer transition-colors text-center
                    ${farmerForm.operator_type === o.val ? 'border-emerald-500 bg-emerald-50' : 'border-stone-200 hover:border-stone-300'}`}>
                  <div className="text-lg mb-0.5">{o.icon}</div>
                  <div className="text-xs font-semibold">{o.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-stone-400 mb-1">经营者/主体名称 *</label>
              <input value={farmerForm.operator_name} onChange={e => sff('operator_name', e.target.value)}
                placeholder="请填写"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">身份证号</label>
              <input value={farmerForm.id_card} onChange={e => sff('id_card', e.target.value)}
                placeholder="负责人身份证"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">联系电话</label>
              <input value={farmerForm.phone} onChange={e => sff('phone', e.target.value)}
                placeholder="联系电话"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">所属村 *</label>
              <select value={farmerForm.village_id || ''} onChange={e => sff('village_id', e.target.value ? Number(e.target.value) : null)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                <option value="">请选择</option>
                {villages.map(v => <option key={v.id} value={v.id}>{v.village_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">组号</label>
              <input value={farmerForm.group_no} onChange={e => sff('group_no', e.target.value)}
                placeholder="如：1"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">自有承包面积（亩）</label>
              <input type="number" step="0.01" value={farmerForm.own_contract_area} onChange={e => sff('own_contract_area', e.target.value)}
                placeholder="如：10.5"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">总经营面积（亩）</label>
              <input type="number" step="0.01" value={farmerForm.total_managed_area} onChange={e => sff('total_managed_area', e.target.value)}
                placeholder="可通过代耕代种自动计算"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-stone-400 mb-1">主要种植作物</label>
            <input value={farmerForm.main_crops} onChange={e => sff('main_crops', e.target.value)}
              placeholder="如：水稻、小麦、玉米"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>

          <div>
            <label className="block text-xs text-stone-400 mb-1">备注</label>
            <textarea rows={2} value={farmerForm.remark} onChange={e => sff('remark', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
          </div>
        </div>
      </Modal>

      {/* 新增/编辑代耕代种关联弹窗 */}
      <Modal open={trustEditOpen} title={trustEditTarget ? '编辑代耕代种关联' : '添加代耕代种关联'}
        onClose={() => setTrustEditOpen(false)} onConfirm={submitTrust} width={560}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-stone-400 mb-1">流出方（承包人家庭户）*</label>
            <div className="relative">
              <input value={ownerSearch}
                onChange={e => { setOwnerSearch(e.target.value); sft('owner_household_id', null) }}
                placeholder="输入户名或户主姓名搜索"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              {ownerOpts.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto">
                  {ownerOpts.map(h => (
                    <button key={h.id} onClick={() => { sft('owner_household_id', h.id); setOwnerSearch(h.household_name); setOwnerOpts([]) }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 border-b border-stone-50 last:border-0">
                      <span className="font-semibold">{h.household_name}</span>
                      <span className="text-stone-400 text-xs ml-2">{h.head_name}</span>
                      {h.contract_area && <span className="text-emerald-700 text-xs ml-2">{h.contract_area}亩</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {trustForm.owner_household_id && <p className="text-xs text-emerald-700 mt-0.5">✓ 已选择</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">流转年度 *</label>
              <select value={trustForm.trust_year} onChange={e => sft('trust_year', Number(e.target.value))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">面积（亩）*</label>
              <input type="number" step="0.01" value={trustForm.area} onChange={e => sft('area', e.target.value)}
                placeholder="如：5.0"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">流转类型</label>
              <select value={trustForm.trust_type} onChange={e => sft('trust_type', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                {TRUST_TYPE_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">地块描述</label>
              <input value={trustForm.parcel_desc} onChange={e => sft('parcel_desc', e.target.value)}
                placeholder="如：东山坡地"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">地块位置</label>
              <input value={trustForm.parcel_location} onChange={e => sft('parcel_location', e.target.value)}
                placeholder="如：村东头"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">年租金（元/亩）</label>
              <input type="number" step="0.01" value={trustForm.annual_fee} onChange={e => sft('annual_fee', e.target.value)}
                placeholder="无偿可不填"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">总租金（元）</label>
              <input type="number" step="0.01" value={trustForm.total_fee} onChange={e => sft('total_fee', e.target.value)}
                placeholder="可不填"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">数据可信度</label>
              <select value={trustForm.data_reliability} onChange={e => sft('data_reliability', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                {RELIABILITY_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">补贴面积计算</label>
              <select value={trustForm.affect_subsidy_calc} onChange={e => sft('affect_subsidy_calc', Number(e.target.value))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                <option value={1}>纳入计算</option>
                <option value={0}>仅作记录</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-stone-400 mb-1">备注</label>
            <textarea rows={2} value={trustForm.note} onChange={e => sft('note', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
          </div>
        </div>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}
