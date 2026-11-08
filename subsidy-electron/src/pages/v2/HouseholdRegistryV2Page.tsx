/**
 * 新版界面 - 户籍管理 · 农户（完全复刻画布 Farmers）
 *
 * 左侧 338px：农户 / 家庭户切换、搜索、村组与状态筛选、人员列表、分页
 * 右侧：人员档案头、家庭户面积条、四列基础信息、
 *       家庭成员与补贴记录垂直排列；土地流转/异常为分类切换（异常可在设置中关闭）
 *
 * 这一版以复刻版式为主，数据只读；编辑/新增等操作后续再接。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../../api'
import { EVENT_TYPE_CFG } from '../FarmerConstants'
import { useHouseholdAnomalyTab } from '../../hooks/useUiSettings'
import { Card, Chip, FieldRow, ListRow, FARMER_STATUS_LABEL, HH_STATUS_LABEL, PAY_STATUS_LABEL, money } from './shared'
import HouseholdActions, { AddMemberButton, MemberRowActions } from './HouseholdActions'
import { CreateFarmerButton, FarmerActions } from './FarmerActions'
import type { FarmerOut, FarmerDetail, HH, HHDetail, HHEvent, SnapshotAtResponse, VillageGroup } from '../../types'

type SideTab = 'farmers' | 'households' | 'large' | 'villages'

interface LargeFarmer {
  id: number; operator_name: string; operator_type: string; operator_type_label: string
  id_card: string | null; phone: string | null; village_id: number; village_name: string
  group_no: number | null; address: string | null
  total_managed_area: number | null; own_contract_area: number | null; trust_in_area: number | null
}

interface VillageRow {
  id: number; village_name: string; leader_name?: string | null; leader_phone?: string | null
}

interface VillageDetail {
  id: number; village_name: string; leader_name?: string; leader_phone?: string
  groups?: { id: number; group_no: number; leader_name?: string | null }[]
  contacts?: { id: number; leader_name: string; leader_phone: string; start_year: number; end_year: number | null }[]
}

interface LargeFarmerTrust {
  id: number; owner_household_name: string; owner_household_code: string
  trust_year: number; area: number; trust_type_label: string; start_date: string | null; end_date: string | null
}

const OPERATOR_LABEL: Record<string, string> = { FAMILY_FARM: '家庭农场', COOPERATIVE: '合作社', LARGE_PLANTER: '种植大户', OTHER: '其他' }
const PAGE_SIZE = 20
const HH_PAGE_SIZE = 20


export default function HouseholdRegistryV2Page() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // ── 左侧 Tab：农户 / 家庭户 ──
  const [sideTab, setSideTab] = useState<SideTab>(
    searchParams.get('tab') === 'households' ? 'households' : 'farmers'
  )

  // ── 列表 ──
  const [list, setList] = useState<FarmerOut[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingList, setLoadingList] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [village, setVillage] = useState('')
  const [status, setStatus] = useState('')
  const [villages, setVillages] = useState<string[]>([])
  const [householdTotal, setHouseholdTotal] = useState<number | null>(null)

  // ── 家庭户列表 ──
  const [hhList, setHhList] = useState<HH[]>([])
  const [hhTotal, setHhTotal] = useState(0)
  const [hhPage, setHhPage] = useState(1)
  const [loadingHhList, setLoadingHhList] = useState(false)
  const [hhSearch, setHhSearch] = useState('')
  const [hhSearchInput, setHhSearchInput] = useState('')
  const [hhVillage, setHhVillage] = useState('')
  const [hhStatus, setHhStatus] = useState('')

  const [selectedHhId, setSelectedHhId] = useState<number | null>(
    searchParams.get('householdId') ? Number(searchParams.get('householdId')) : null
  )

  // ── 大户 ──
  const [largeList, setLargeList] = useState<LargeFarmer[]>([])
  const [largeTotal, setLargeTotal] = useState(0)
  const [largePage, setLargePage] = useState(1)
  const [loadingLarge, setLoadingLarge] = useState(false)
  const [largeKeyword, setLargeKeyword] = useState('')
  const [largeKeywordInput, setLargeKeywordInput] = useState('')
  const [largeType, setLargeType] = useState('')
  const [selectedLargeId, setSelectedLargeId] = useState<number | null>(null)
  const [largeTrusts, setLargeTrusts] = useState<LargeFarmerTrust[]>([])
  const [loadingTrusts, setLoadingTrusts] = useState(false)
  const [villageOptions, setVillageOptions] = useState<{ id: number; village_name: string }[]>([])
  const [largeVillage, setLargeVillage] = useState<number | ''>('')

  // ── 村组 ──
  const [villageList, setVillageList] = useState<VillageRow[]>([])
  const [selectedVillageId, setSelectedVillageId] = useState<number | null>(null)
  const [villageDetail, setVillageDetail] = useState<VillageDetail | null>(null)
  const [loadingVillage, setLoadingVillage] = useState(false)
  

  // ── 详情 ──
  const [selectedId, setSelectedId] = useState<number | null>(
    searchParams.get('farmerId') ? Number(searchParams.get('farmerId')) : null
  )
  const [farmer, setFarmer] = useState<FarmerDetail | null>(null)
  const [household, setHousehold] = useState<HHDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    api.getVillageGroups().then((gs: VillageGroup[]) => setVillages([...new Set(gs.map(g => g.village_name))])).catch(() => {})
    api.getHouseholds({ page: 1, pageSize: 1 }).then(r => setHouseholdTotal(r.total)).catch(() => {})
  }, [])
  const loadList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await api.getFarmers({
        page, pageSize: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(village ? { village_name: village } : {}),
        ...(status ? { status: Number(status) } : {}),
      })
      setList(res.items || [])
      setTotal(res.total || 0)
      setSelectedId(prev => {
        if (prev && (res.items || []).some(f => f.id === prev)) return prev
        return res.items?.[0]?.id ?? null
      })
    } catch {
      setList([]); setTotal(0)
    } finally {
      setLoadingList(false)
    }
  }, [page, search, village, status])

  useEffect(() => { loadList() }, [loadList])

  // 家庭户列表
  const loadHhList = useCallback(async () => {
    setLoadingHhList(true)
    try {
      const res = await api.getHouseholds({
        page: hhPage, pageSize: HH_PAGE_SIZE,
        ...(hhSearch ? { search: hhSearch } : {}),
        ...(hhVillage ? { village_name: hhVillage } : {}),
        ...(hhStatus ? { status: Number(hhStatus) } : {}),
      })
      setHhList(res.items || [])
      setHhTotal(res.total || 0)
      setHouseholdTotal(res.total || 0)
      setSelectedHhId(prev => {
        if (prev && (res.items || []).some(h => h.id === prev)) return prev
        return res.items?.[0]?.id ?? null
      })
    } catch {
      setHhList([]); setHhTotal(0)
    } finally {
      setLoadingHhList(false)
    }
  }, [hhPage, hhSearch, hhVillage, hhStatus])

  useEffect(() => { loadHhList() }, [loadHhList])

  // 大户列表
  useEffect(() => {
    window.electronAPI.invoke<any>('settings:listVillages').then((r: any) => {
      const arr = r?.data ?? r ?? []
      setVillageOptions(arr)
      setVillageList(arr)
      setSelectedVillageId(prev => prev ?? (arr[0]?.id ?? null))
    }).catch(() => {})
  }, [])

  const loadLargeList = useCallback(async () => {
    setLoadingLarge(true)
    try {
      const params: Record<string, unknown> = { page: largePage, page_size: 20 }
      if (largeVillage) params.village_id = largeVillage
      if (largeType) params.operator_type = largeType
      const r = await window.electronAPI.invoke<any>('land:listLargeFarmers', params)
      const data = r?.data ?? r
      setLargeList(data?.items ?? [])
      setLargeTotal(data?.total ?? 0)
      setSelectedLargeId(prev => {
        if (prev && (data?.items ?? []).some((x: LargeFarmer) => x.id === prev)) return prev
        return data?.items?.[0]?.id ?? null
      })
    } catch { setLargeList([]); setLargeTotal(0) }
    finally { setLoadingLarge(false) }
  }, [largePage, largeVillage, largeType, largeKeyword])

  useEffect(() => { loadLargeList() }, [loadLargeList])

  // 村组详情
  useEffect(() => {
    if (selectedVillageId == null) { setVillageDetail(null); return }
    let cancelled = false
    setLoadingVillage(true)
    window.electronAPI.invoke<any>('settings:villageDetail', selectedVillageId)
      .then((r: any) => { if (!cancelled) setVillageDetail(r?.data ?? r ?? null) })
      .catch(() => { if (!cancelled) setVillageDetail(null) })
      .finally(() => { if (!cancelled) setLoadingVillage(false) })
    return () => { cancelled = true }
  }, [selectedVillageId])

  // 大户流转明细
  useEffect(() => {
    if (selectedLargeId == null) { setLargeTrusts([]); return }
    let cancelled = false
    setLoadingTrusts(true)
    window.electronAPI.invoke<any>('land:listLargeFarmerTrusts', { id: selectedLargeId, year: new Date().getFullYear() })
      .then((r: any) => { if (!cancelled) setLargeTrusts((r?.data ?? r ?? [])) })
      .catch(() => { if (!cancelled) setLargeTrusts([]) })
      .finally(() => { if (!cancelled) setLoadingTrusts(false) })
    return () => { cancelled = true }
  }, [selectedLargeId])

  // 选中家庭户 → 详情（左侧 Tab 切到家庭户时使用）
  useEffect(() => {
    if (sideTab !== 'households' || selectedHhId == null) return
    let cancelled = false
    setLoadingDetail(true)
    api.getHouseholdDetail(selectedHhId)
      .then(d => { if (!cancelled) setHousehold(d) })
      .catch(() => { if (!cancelled) setHousehold(null) })
      .finally(() => { if (!cancelled) setLoadingDetail(false) })
    return () => { cancelled = true }
  }, [sideTab, selectedHhId])

  // 选中人员 → 详情 + 所属家庭户
  useEffect(() => {
    if (selectedId == null) { setFarmer(null); setHousehold(null); return }
    let cancelled = false
    setLoadingDetail(true)
    api.getFarmer(selectedId)
      .then(async f => {
        if (cancelled) return
        setFarmer(f)
        if (f.household_id) {
          try {
            const hh = await api.getHouseholdDetail(f.household_id)
            if (!cancelled) setHousehold(hh)
          } catch { if (!cancelled) setHousehold(null) }
        } else setHousehold(null)
      })
      .catch(() => { if (!cancelled) setFarmer(null) })
      .finally(() => { if (!cancelled) setLoadingDetail(false) })
    return () => { cancelled = true }
  }, [selectedId])


  // 重新加载当前家庭户 / 农户详情

  const reloadFarmer = useCallback(() => {
    if (selectedId == null) return
    api.getFarmer(selectedId).then(f => {
      setFarmer(f)
      if (f.household_id) api.getHouseholdDetail(f.household_id).then(setHousehold).catch(() => {})
    }).catch(() => {})
  }, [selectedId])
  const reloadHousehold = useCallback(() => {
    if (selectedHhId == null) return
    api.getHouseholdDetail(selectedHhId).then(setHousehold).catch(() => {})
  }, [selectedHhId])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ── 派生 ──
  const apps = farmer?.applications || []
  const appTotal = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
  const usage = household?.area_usage
  const refArea = (usage?.cultivable_area ?? usage?.contracted_area ?? 0) || 0
  const usedArea = usage?.used_area ?? 0
  const overAmount = Math.max(0, usedArea - refArea)
  const isOver = overAmount > 0.001
  const members = household?.members || []
  const overYears = useMemo(() => {
    const yt = usage?.year_totals
    if (!yt || !refArea) return [] as string[]
    return Object.entries(yt)
      .filter(([, seasons]) => Object.values(seasons).some(v => v > refArea + 0.001))
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([y]) => y)
  }, [usage, refArea])

  const age = (() => {
    const b = farmer?.birth_date
    if (!b) return null
    const y = Number(b.slice(0, 4))
    if (!y) return null
    return new Date().getFullYear() - y
  })()

  return (
    <div className="space-y-3">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-primary leading-tight">主体管理</h1>
          <div className="text-[11px] text-[#8C877A] mt-1">农户、家庭户、大户与村组统一管理，左侧选择对象，右侧查看档案与关联信息</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate('/settings/farmer-attribute-import')}
            className="h-[30px] px-3 border border-border rounded-btn bg-white text-[12px] text-[#5A5A4F] hover:bg-warm/30 transition-colors">
            导入户籍
          </button>
          <CreateFarmerButton villages={villages} onCreated={loadList} />
        </div>
      </div>

      <div className="grid grid-cols-[338px_minmax(0,1fr)] gap-3 items-start">
        {/* ── 左列 ── */}
        <div className="bg-white border border-border rounded-card flex flex-col overflow-hidden shadow-card sticky top-[88px]"
          style={{ maxHeight: 'calc(100vh - 104px)' }}>
          {/* 农户 / 家庭户 / 大户 / 村组 */}
          <div className="flex items-center gap-3.5 px-3 h-[34px] border-b border-border">
            {([
              ['farmers', '农户', total],
              ['households', '家庭户', householdTotal],
              ['large', '大户', null],
              ['villages', '村组', null],
            ] as const).map(([id, label, count]) => (
              <button key={id} onClick={() => setSideTab(id as SideTab)}
                className={`h-[34px] flex items-center gap-1 border-b-2 text-[12px] transition-colors ${sideTab === id ? 'border-primary text-primary font-bold' : 'border-transparent text-[#6B6B60] hover:text-text-primary'}`}>
                {label}
                {count != null && <span className={`text-[10px] font-normal ${sideTab === id ? 'text-[#8C877A]' : 'text-[#9A9588]'}`}>{count}</span>}
              </button>
            ))}
          </div>
          <div className="px-2.5 py-2 border-b border-[#F2EDE3] flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 border border-border rounded-btn px-2 h-[30px]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9A9588" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
              {sideTab === 'farmers' ? (
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput.trim()); setPage(1) } }}
                  placeholder="姓名 / 身份证 / 手机号" className="flex-1 text-[12px] outline-none bg-transparent" />
              ) : (
                <input value={hhSearchInput} onChange={e => setHhSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { setHhSearch(hhSearchInput.trim()); setHhPage(1) } }}
                  placeholder="户名 / 户编码 / 户主" className="flex-1 text-[12px] outline-none bg-transparent" />
              )}
            </div>
            <div className="flex gap-1.5">
              <select value={sideTab === 'farmers' ? village : hhVillage}
                onChange={e => { if (sideTab === 'farmers') { setVillage(e.target.value); setPage(1) } else { setHhVillage(e.target.value); setHhPage(1) } }}
                className="flex-1 h-7 border border-border rounded-btn px-1.5 text-[11px] text-[#5A5A4F] bg-white outline-none">
                <option value="">全部村</option>
                {villages.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={sideTab === 'farmers' ? status : hhStatus}
                onChange={e => { if (sideTab === 'farmers') { setStatus(e.target.value); setPage(1) } else { setHhStatus(e.target.value); setHhPage(1) } }}
                className="flex-1 h-7 border border-border rounded-btn px-1.5 text-[11px] text-[#5A5A4F] bg-white outline-none">
                <option value="">全部状态</option>
                <option value="1">在册</option>
                <option value="2">注销</option>
                <option value="3">迁出</option>
                {sideTab === 'farmers' && <option value="4">死亡</option>}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {sideTab === 'farmers' && (
              <>
                {loadingList && <div className="py-10 text-center text-[11px] text-text-muted/60">加载中…</div>}
                {!loadingList && list.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无数据</div>}
                {!loadingList && list.map(f => (
                  <ListRow key={f.id} active={selectedId === f.id} onClick={() => setSelectedId(f.id)}
                    avatar={f.real_name?.slice(-1) || '—'} name={f.real_name}
                    tags={
                      <>
                        <Chip tone={f.is_head === 1 ? 'green' : 'gray'}>{f.is_head === 1 ? '户主' : (f.relation || '成员')}</Chip>
                        <Chip tone={f.farmer_status === 1 ? 'green' : f.farmer_status === 3 ? 'amber' : 'gray'}>
                          {FARMER_STATUS_LABEL[f.farmer_status] || '未知'}
                        </Chip>
                      </>
                    }
                    sub={<>{f.village_full_name || '—'}{f.contract_area ? ` · ${f.contract_area} 亩` : ''} · <span className="font-mono">{f.id_card_masked}</span></>} />
                ))}
              </>
            )}
            {sideTab === 'households' && (
              <>
                {loadingHhList && <div className="py-10 text-center text-[11px] text-text-muted/60">加载中…</div>}
                {!loadingHhList && hhList.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无数据</div>}
                {!loadingHhList && hhList.map(h => (
                  <ListRow key={h.id} active={selectedHhId === h.id} onClick={() => setSelectedHhId(h.id)}
                    avatar={h.household_name?.slice(0, 1) || '户'} avatarSquare name={h.household_name}
                    tags={<Chip tone={h.status === 1 ? 'green' : 'amber'}>{HH_STATUS_LABEL[h.status] || '未知'}</Chip>}
                    right={(h.overdrawn_years?.length ?? 0) > 0
                      ? <span className="text-[9px] bg-[#FDECEA] text-danger rounded-[2px] px-1 shrink-0">{h.overdrawn_years!.slice(0, 2).join('、')}超领</span>
                      : h.is_overdrawn ? <span className="text-[9px] bg-[#FDECEA] text-danger rounded-[2px] px-1 shrink-0">超领</span> : null}
                    sub={<>{h.village_full_name || '—'} · <span className="font-mono">{h.household_code}</span> · {h.member_count ?? '?'} 人{h.contracted_area > 0 ? ` · ${h.contracted_area} 亩` : ''}</>} />
                ))}
              </>
            )}
            {sideTab === 'large' && (
              <>
                {loadingLarge && <div className="py-10 text-center text-[11px] text-text-muted/60">加载中…</div>}
                {!loadingLarge && largeList.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无大户</div>}
                {!loadingLarge && largeList.map(l => (
                  <ListRow key={l.id} active={selectedLargeId === l.id} onClick={() => setSelectedLargeId(l.id)}
                    avatar={l.operator_name?.slice(0, 1) || '大'} avatarSquare name={l.operator_name}
                    tags={<Chip tone="amber">{OPERATOR_LABEL[l.operator_type] || l.operator_type_label}</Chip>}
                    sub={<>{l.village_name || '—'}{l.group_no ? ` ${l.group_no} 组` : ''} · 经营 {Number(l.total_managed_area || 0).toFixed(2)} 亩</>} />
                ))}
              </>
            )}
            {sideTab === 'villages' && (
              <>
                {villageList.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无村组</div>}
                {villageList.map(v => (
                  <ListRow key={v.id} active={selectedVillageId === v.id} onClick={() => setSelectedVillageId(v.id)}
                    avatar={v.village_name?.slice(0, 1) || '村'} avatarSquare name={v.village_name}
                    tags={<Chip tone="gray">村集体</Chip>}
                    sub={<>{v.leader_name ? `负责人 ${v.leader_name}` : '非在册负责人'}{v.leader_phone ? ` · ${v.leader_phone}` : ''}</>} />
                ))}
              </>
            )}
          </div>

          <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-border text-[10px] text-[#8C877A]">
            <span>{sideTab === 'farmers' ? `共 ${total} 人` : `共 ${hhTotal} 户`}</span>
            {sideTab === 'farmers' ? (
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-[22px] px-1.5 border border-border rounded-[3px] bg-white disabled:opacity-40">上一页</button>
                <span className="bg-primary text-[#F7F3E7] rounded-[3px] px-1.5">{page}</span>
                <span>/ {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="h-[22px] px-1.5 border border-border rounded-[3px] bg-white disabled:opacity-40">下一页</button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button disabled={hhPage <= 1} onClick={() => setHhPage(p => p - 1)} className="h-[22px] px-1.5 border border-border rounded-[3px] bg-white disabled:opacity-40">上一页</button>
                <span className="bg-primary text-[#F7F3E7] rounded-[3px] px-1.5">{hhPage}</span>
                <span>/ {Math.max(1, Math.ceil(hhTotal / HH_PAGE_SIZE))}</span>
                <button disabled={hhPage >= Math.max(1, Math.ceil(hhTotal / HH_PAGE_SIZE))} onClick={() => setHhPage(p => p + 1)} className="h-[22px] px-1.5 border border-border rounded-[3px] bg-white disabled:opacity-40">下一页</button>
              </div>
            )}
          </div>
        </div>

        {/* ── 右列 ── */}
        <div className="bg-white border border-border rounded-card flex flex-col overflow-hidden shadow-card min-w-0">
          {sideTab === 'households' && <HouseholdDetailPanel detail={household} loading={loadingDetail} onChanged={reloadHousehold} />}
          {sideTab === 'large' && (
            <LargeFarmerPanel farmer={largeList.find(l => l.id === selectedLargeId) || null} trusts={largeTrusts} loading={loadingTrusts} />
          )}
          {sideTab === 'villages' && <VillagePanel detail={villageDetail} loading={loadingVillage} />}
          {sideTab === 'farmers' && <FarmerDetailPanel farmer={farmer} household={household} loading={loadingDetail} onChanged={reloadFarmer} />}
        </div>
      </div>
    </div>
  )
}

/** 农户详情面板 */
function FarmerDetailPanel({ farmer, household, loading, onChanged }: { farmer: FarmerDetail | null; household: HHDetail | null; loading: boolean; onChanged: () => void }) {
  if (!farmer) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一名农户'}</div>
  }
  const members = household?.members || []
  const usage = household?.area_usage
  const refArea = (usage?.cultivable_area ?? usage?.contracted_area ?? 0) || 0
  const usedArea = usage?.used_area ?? 0
  const overAmount = Math.max(0, usedArea - refArea)
  const isOver = overAmount > 0.001
  const apps = farmer.applications || []
  const appTotal = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
  const age = (() => {
    const b = farmer.birth_date
    if (!b) return null
    const y = Number(b.slice(0, 4))
    return y ? new Date().getFullYear() - y : null
  })()
  const overYears = Object.entries(usage?.year_totals || {})
    .filter(([, seasons]) => refArea > 0 && Object.values(seasons).some(v => v > refArea + 0.001))
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([y]) => y)

  return (
    <>
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#F2EDE3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
            {farmer.real_name?.slice(-1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{farmer.real_name}</h2>
              <span className={`text-[10px] rounded-full px-1.5 py-[1px] ${farmer.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                {FARMER_STATUS_LABEL[farmer.farmer_status] || '未知'}
              </span>
              <span className={`text-[10px] rounded-[3px] px-1.5 py-[1px] ${farmer.is_head === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                {farmer.is_head === 1 ? '户主' : (farmer.relation || '成员')}
              </span>
              {overYears.length > 0 && <span className="text-[10px] bg-[#FDECEA] text-danger rounded-full px-1.5 py-[1px]">超领 {overYears.length} 项</span>}
            </div>
            <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
              <span className="font-mono">{farmer.id_card || farmer.id_card_masked || '—'}</span>
              <span className="mx-1.5">·</span>
              <span className="font-mono">{farmer.phone || farmer.phone_masked || '—'}</span>
              <span className="mx-1.5">·</span>
              {farmer.village_full_name}
            </div>
          </div>
        </div>
        <FarmerActions farmer={farmer} onChanged={onChanged} />
      </div>

      <div className="flex items-center px-4 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7] shadow-[0_6px_16px_rgba(15,61,46,.14)] shrink-0" style={{ height: 58 }}>
        <div className="flex items-center gap-2 w-[210px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D8B567" strokeWidth="1.6" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 11v9h14v-9" /><path d="M9 20v-5h6v5" /></svg>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold truncate">{household?.household_name || '未关联家庭户'}</div>
            <div className="text-[9.5px] text-white/55 truncate">{household ? `${household.household_code} · ${members.length} 名成员` : '—'}</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-[18px] border-l border-white/15">
            <div className="text-[9.5px] text-white/55">参考面积</div>
            <div className="text-[16px] font-bold text-[#E6C288] font-mono">{refArea.toFixed(2)} 亩</div>
          </div>
          <div className="px-[18px] border-l border-white/15">
            <div className="text-[9.5px] text-white/55">已使用</div>
            <div className="text-[16px] font-bold font-mono">{usedArea.toFixed(2)} 亩</div>
          </div>
          <div className="px-[18px] border-l border-white/15">
            <div className="text-[9.5px] text-white/55">超出</div>
            <div className={`text-[16px] font-bold font-mono ${isOver ? 'text-[#F2B8A8]' : ''}`}>{isOver ? `+${overAmount.toFixed(2)} 亩` : '—'}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-[#F2EDE3]">
        {[
          ['身份证号', farmer.id_card || farmer.id_card_masked || '—'],
          ['手机号', farmer.phone || farmer.phone_masked || '—'],
          ['出生日期 / 年龄', farmer.birth_date ? `${farmer.birth_date.slice(0, 10)}${age ? ` · ${age} 岁` : ''}` : '—'],
          ['银行卡', farmer.bank_card || farmer.bank_card_masked || '—'],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
            <div className="text-[9.5px] text-[#9A9588]">{k}</div>
            <div className="text-[11.5px] text-[#5A5A4F] mt-px font-mono truncate">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        <div className="flex flex-col gap-2.5 min-w-0 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 430px)' }}>
          <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
              <span className="text-[11.5px] font-semibold">补贴记录 <span className="text-[10px] text-[#8C877A] font-normal">{apps.length}</span></span>
              <span className="text-[10px] text-[#8C877A]">累计 <b className="font-mono text-primary">{money(appTotal)}</b></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                  <th className="font-medium px-2.5">年度</th>
                  <th className="font-medium px-1.5">补贴项目</th>
                  <th className="font-medium px-1.5 text-right">面积</th>
                  <th className="font-medium px-1.5 text-right">金额</th>
                  <th className="font-medium px-1.5">状态</th>
                  <th className="font-medium px-2.5">发放日期</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a, i) => (
                  <tr key={a.id ?? i} className="border-t border-[#F2EDE3] h-[34px] hover:bg-[#F7FAF8] transition-colors">
                    <td className="px-2.5 font-semibold text-[#1A4D3A]">{a.apply_year}</td>
                    <td className="px-1.5 truncate">{a.subsidy_name}</td>
                    <td className="px-1.5 text-right font-mono">{a.apply_area != null ? Number(a.apply_area).toFixed(2) : '—'}</td>
                    <td className="px-1.5 text-right font-mono">{a.actual_amount ? money(a.actual_amount) : (a.apply_amount ? money(a.apply_amount) : '—')}</td>
                    <td className="px-1.5">
                      <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${a.pay_status === 2 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F6EEDC] text-[#8A6620]'}`}>
                        {PAY_STATUS_LABEL[a.pay_status] || '—'}
                      </span>
                    </td>
                    <td className="px-2.5 text-[#8C877A]">{a.pay_date || '—'}</td>
                  </tr>
                ))}
                {apps.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[11px] text-text-muted/60">暂无补贴记录</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
              <span className="text-[11.5px] font-semibold">家庭成员 <span className="text-[10px] text-[#8C877A] font-normal">{members.length}</span></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <tbody>
                {members.map(m => (
                  <tr key={m.id} className="border-t border-[#F2EDE3] h-[30px] hover:bg-[#F7FAF8] transition-colors">
                    <td className="px-2.5 font-semibold">
                      {m.real_name}
                      {m.is_head === 1 && <span className="ml-1 text-[9px] bg-[#EDF3EF] text-[#2C6B52] rounded-[2px] px-1">户主</span>}
                    </td>
                    <td className="px-1.5 text-[#6B6B60]">{m.relation || (m.is_head === 1 ? '本人' : '成员')}</td>
                    <td className="px-1.5">
                      <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${m.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                        {FARMER_STATUS_LABEL[m.farmer_status] || '—'}
                      </span>
                    </td>
                    <td className="px-1.5 font-mono text-[#8C877A]">{m.id_card_masked || '—'}</td>
                  </tr>
                ))}
                {members.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-[11px] text-text-muted/60">暂无成员</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="各季面积使用">
            <SeasonBars usage={usage} refArea={refArea} />
          </Card>
          <Card title="家庭户信息">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="户名" value={household?.household_name || '—'} />
              <FieldRow label="户编码" value={household?.household_code || '—'} />
              <FieldRow label="村组" value={household?.village_full_name || farmer.village_full_name || '—'} />
              <FieldRow label="成员" value={household ? `${members.length} 人 · 在册 ${members.filter(m => m.farmer_status === 1).length}` : '—'} />
              <FieldRow label="参考面积" value={household ? `${refArea.toFixed(2)} 亩` : '—'} />
              <FieldRow label="人工确认" value={household?.manually_confirmed_at ? household.manually_confirmed_at.slice(0, 10) : '未确认'} />
            </div>
          </Card>
          <SnapshotCard householdId={household?.id ?? null} />
        </div>
      </div>
    </>
  )
}

/** 各季面积使用条（超限标红） */
function SeasonBars({ usage, refArea }: { usage: HHDetail['area_usage'] | undefined; refArea: number }) {
  const seasons = Object.entries(usage?.season_breakdown || {})
  if (seasons.length === 0) return <div className="text-[10.5px] text-text-muted/60 py-2 text-center">暂无面积使用记录</div>
  return (
    <div className="flex flex-col gap-1.5">
      {seasons.map(([season, s]) => {
        const seasonRef = (s as { reference_area?: number }).reference_area ?? refArea
        const used = s.used_area || 0
        const over = used > seasonRef + 0.001
        const pct = seasonRef > 0 ? Math.min(100, Math.round(used / seasonRef * 100)) : 0
        return (
          <div key={season}>
            <div className="flex items-baseline justify-between text-[10.5px]">
              <span className={over ? 'text-danger font-semibold' : 'text-primary font-semibold'}>{season}</span>
              <span className={`font-mono ${over ? 'text-danger font-semibold' : 'text-text-muted'}`}>{used.toFixed(2)} / {seasonRef.toFixed(2)}</span>
            </div>
            <div className="h-[4px] bg-[#F2EDE3] rounded-full mt-1 overflow-hidden">
              <div className={`h-[4px] rounded-full ${over ? 'bg-danger' : 'bg-[#1A4D3A]'}`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            {over && <div className="text-[9.5px] text-danger mt-0.5">超出 {(used - seasonRef).toFixed(2)} 亩</div>}
          </div>
        )
      })}
    </div>
  )
}

/** 家庭户详情面板 */
function HouseholdDetailPanel({ detail, loading, onChanged }: { detail: HHDetail | null; loading: boolean; onChanged: () => void }) {
  const navigate = useNavigate()
  const [hhTab, setHhTab] = useState<'trust' | 'anomaly'>('trust')
  const [anomalyEnabled] = useHouseholdAnomalyTab()

  if (!detail) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一个家庭户'}</div>
  }

  const usage = detail.area_usage
  const refArea = (usage?.cultivable_area ?? usage?.contracted_area ?? 0) || 0
  const usedArea = usage?.used_area ?? 0
  const remaining = Math.max(0, refArea - usedArea)
  const overAmount = Math.max(0, usedArea - refArea)
  const isOver = overAmount > 0.001
  const members = detail.members || []
  const apps = detail.app_summary || []
  const appTotal = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
  const overYears = Object.entries(usage?.year_totals || {})
    .filter(([, seasons]) => refArea > 0 && Object.values(seasons).some(v => v > refArea + 0.001))
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([y, seasons]) => ({ year: y, used: Math.max(...Object.values(seasons)) }))
  const trustIn = Number(usage?.trust_in_area ?? 0)
  const trustOut = Number(usage?.trust_out_area ?? 0)

  return (
    <>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#F2EDE3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
            {detail.household_name?.slice(0, 1) || '户'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{detail.household_name}</h2>
              <span className="text-[10px] border border-border rounded-[3px] px-1.5 py-[1px] text-[#8C877A] font-mono">{detail.household_code}</span>
              <span className="text-[10px] bg-[#EDF3EF] text-[#2C6B52] rounded-full px-1.5 py-[1px]">{HH_STATUS_LABEL[detail.status] || '在册'}</span>
              {overYears.length > 0 && <span className="text-[10px] bg-[#FDECEA] text-danger rounded-full px-1.5 py-[1px]">超领 {overYears.length} 项</span>}
              {detail.is_manually_confirmed === 1 && <span className="text-[10px] bg-[#EDF3EF] text-[#2C6B52] rounded-[3px] px-1.5 py-[1px]">已确认</span>}
            </div>
            <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
              {detail.village_full_name}
              {detail.address ? ` · ${detail.address}` : ''}
              <span className="mx-1.5">·</span>
              {members.length} 名成员 · 在册 {members.filter(m => m.farmer_status === 1).length}
              {detail.manually_confirmed_at && <><span className="mx-1.5">·</span>人工确认 {detail.manually_confirmed_at.slice(0, 10)}</>}
            </div>
          </div>
        </div>
        <HouseholdActions detail={detail} onChanged={onChanged} />
      </div>

      <div className="flex items-center px-4 py-2.5 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7]">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D8B567" strokeWidth="1.6" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 11v9h14v-9" /><path d="M9 20v-5h6v5" /></svg>
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold truncate">面积与发放</div>
            <div className="text-[9.5px] text-white/55">按季节取最大 · 全部年度</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">参考面积</div><div className="text-[15px] font-bold text-[#E6C288] font-mono">{refArea.toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">已使用</div><div className="text-[15px] font-bold font-mono">{usedArea.toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">剩余</div><div className="text-[15px] font-bold font-mono">{remaining.toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">超出</div><div className={`text-[15px] font-bold font-mono ${isOver ? 'text-[#F2B8A8]' : ''}`}>{isOver ? `+${overAmount.toFixed(2)} 亩` : '—'}</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">累计发放</div><div className="text-[15px] font-bold font-mono">{money(appTotal)}</div></div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-[#F2EDE3]">
        {[
          ['承包面积', `${Number(usage?.contracted_area ?? 0).toFixed(2)} 亩`],
          ['确权面积', detail.confirmed_area != null ? `${detail.confirmed_area} 亩` : '—'],
          ['转入 / 转出', `${trustIn.toFixed(2)} / ${trustOut.toFixed(2)}`],
          ['可耕种', usage?.cultivable_area != null ? `${Number(usage.cultivable_area).toFixed(2)} 亩` : '—'],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
            <div className="text-[9.5px] text-[#9A9588]">{k}</div>
            <div className="text-[11.5px] text-[#5A5A4F] mt-px font-mono">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        <div className="flex flex-col gap-2.5 min-w-0">
          <div className="flex flex-col gap-2.5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 545px)' }}>
            <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
                <span className="text-[11.5px] font-semibold">家庭成员 <span className="text-[10px] text-[#8C877A] font-normal">{members.length}</span></span>
                <AddMemberButton detail={detail} onChanged={onChanged} />
              </div>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                    <th className="font-medium px-2.5">姓名</th>
                    <th className="font-medium px-1.5">关系</th>
                    <th className="font-medium px-2.5">状态</th>
                    <th className="font-medium px-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className={`border-t border-[#F2EDE3] h-[34px] hover:bg-[#F7FAF8] transition-colors ${m.farmer_status !== 1 ? 'opacity-70' : ''}`}>
                      <td className="px-2.5 font-semibold">
                        {m.real_name}
                        {m.is_head === 1 && <span className="ml-1 text-[9px] bg-[#EDF3EF] text-[#2C6B52] rounded-[2px] px-1">户主</span>}
                      </td>
                      <td className="px-1.5 text-[#6B6B60]">{m.relation || (m.is_head === 1 ? '本人' : '成员')}</td>
                      <td className="px-1.5 font-mono text-[#8C877A]">{m.id_card_masked || '—'}</td>
                      <td className="px-2.5">
                        <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${m.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                          {FARMER_STATUS_LABEL[m.farmer_status] || '—'}
                        </span>
                      </td>
                      <td className="px-2.5 text-right whitespace-nowrap">
                        <MemberRowActions detail={detail} member={m} onChanged={onChanged} />
                      </td>
                    </tr>
                  ))}
                  {members.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[11px] text-text-muted/60">暂无成员</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
                <span className="text-[11.5px] font-semibold">补贴记录 <span className="text-[10px] text-[#8C877A] font-normal">{apps.length}</span></span>
                <span className="text-[10px] text-[#8C877A]">累计 <b className="font-mono text-primary">{money(appTotal)}</b></span>
              </div>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                    <th className="font-medium px-2.5">年度</th>
                    <th className="font-medium px-1.5">补贴项目</th>
                    <th className="font-medium px-1.5">成员</th>
                    <th className="font-medium px-1.5 text-right">面积</th>
                    <th className="font-medium px-1.5 text-right">金额</th>
                    <th className="font-medium px-2.5">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a, i) => (
                    <tr key={`${a.farmer_id}-${a.subsidy_name}-${i}`} className="border-t border-[#F2EDE3] h-[34px] hover:bg-[#F7FAF8] transition-colors">
                      <td className="px-2.5 font-semibold text-[#1A4D3A]">{a.apply_year}</td>
                      <td className="px-1.5 truncate">{a.subsidy_name}</td>
                      <td className="px-1.5 text-[#6B6B60]">{a.farmer_name}</td>
                      <td className="px-1.5 text-right font-mono">{a.apply_area != null ? Number(a.apply_area).toFixed(2) : '—'}</td>
                      <td className="px-1.5 text-right font-mono">{a.actual_amount ? money(a.actual_amount) : (a.apply_amount ? money(a.apply_amount) : '—')}</td>
                      <td className="px-2.5">
                        <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${a.pay_status === 2 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F6EEDC] text-[#8A6620]'}`}>
                          {PAY_STATUS_LABEL[a.pay_status] || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {apps.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[11px] text-text-muted/60">暂无补贴记录</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-end gap-5 px-1 h-7 border-b border-[#E8E2D9]">
            <button onClick={() => setHhTab('trust')}
              className={`h-7 flex items-center gap-1 border-b-2 text-[12px] transition-colors ${hhTab === 'trust' ? 'border-primary text-primary font-bold' : 'border-transparent text-[#6B6B60] hover:text-text-primary'}`}>
              土地流转
            </button>
            {anomalyEnabled && (
              <button onClick={() => setHhTab('anomaly')}
                className={`relative h-7 flex items-center gap-1 border-b-2 text-[12px] transition-colors ${hhTab === 'anomaly' ? 'border-primary text-primary font-bold' : 'border-transparent text-[#6B6B60] hover:text-text-primary'}`}>
                异常
                {overYears.length > 0 && <span className="text-[10px] font-normal text-danger">{overYears.length}</span>}
                {overYears.length > 0 && <span className="absolute -top-0.5 -right-2 w-1.5 h-1.5 rounded-full bg-danger" />}
              </button>
            )}
          </div>

          <div className="border border-[#F0EBE1] rounded-card p-3">
            {hhTab === 'trust' && (
              <div className="flex flex-col gap-2 text-[11px]">
                <div className="flex items-center justify-between"><span className="text-[#8C877A]">转入面积</span><b className="font-mono">{trustIn.toFixed(2)} 亩</b></div>
                <div className="flex items-center justify-between"><span className="text-[#8C877A]">转出面积</span><b className="font-mono">{trustOut.toFixed(2)} 亩</b></div>
                <div className="flex items-center justify-between border-t border-[#F2EDE3] pt-2"><span className="text-[#8C877A]">可耕种面积</span><b className="font-mono text-primary">{Number(usage?.cultivable_area ?? 0).toFixed(2)} 亩</b></div>
                <div className="text-[10px] text-text-muted pt-1">
                  {usage?.has_trust_data ? '本户存在流转记录，详细台账请在「土地流转」中查看。' : '本户暂无土地流转记录。'}
                </div>
                <button onClick={() => navigate('/land')} className="mt-1 h-7 border border-border rounded-btn text-[11px] text-[#5A5A4F]">打开土地流转台账</button>
              </div>
            )}
            {hhTab === 'anomaly' && (
              overYears.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-text-muted/60">本户没有超领记录</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {overYears.map(o => (
                    <div key={o.year} className="flex items-center gap-2">
                      <span className="text-[9px] bg-[#FDECEA] text-danger rounded-[2px] px-1">超领</span>
                      <span className="text-[11.5px] font-semibold">{o.year} 年度</span>
                      <span className="text-[10px] text-[#9A9588]">{o.used.toFixed(2)} / {refArea.toFixed(2)} 亩</span>
                      <span className="ml-auto text-[11px] font-bold text-danger">+{Math.max(0, o.used - refArea).toFixed(2)}</span>
                    </div>
                  ))}
                  <button onClick={() => navigate('/anomalies')} className="mt-1 h-7 border border-border rounded-btn text-[11px] text-[#5A5A4F]">进入异常中心</button>
                </div>
              )
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="各季面积使用"><SeasonBars usage={usage} refArea={refArea} /></Card>
          <Card title="家庭户信息">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="户名" value={detail.household_name} />
              <FieldRow label="户编码" value={detail.household_code} />
              <FieldRow label="村组" value={detail.village_full_name} />
              <FieldRow label="成员" value={`${members.length} 人 · 在册 ${members.filter(m => m.farmer_status === 1).length}`} />
              <FieldRow label="参考面积" value={`${refArea.toFixed(2)} 亩`} />
              <FieldRow label="人工确认" value={detail.manually_confirmed_at?.slice(0, 10) || '未确认'} />
            </div>
          </Card>
          <SnapshotCard householdId={detail.id} />
        </div>
      </div>
    </>
  )
}

/** 历史快照卡片 */
function SnapshotCard({ householdId }: { householdId: number | null }) {
  const [events, setEvents] = useState<HHEvent[]>([])
  const [snapshot, setSnapshot] = useState<SnapshotAtResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setSnapshot(null)
    if (!householdId) { setEvents([]); return }
    let cancelled = false
    api.getHouseholdEvents(householdId)
      .then(ev => { if (!cancelled) setEvents(ev || []) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [householdId])

  const openSnapshot = async (eventId: number) => {
    if (!householdId) return
    setLoading(true)
    try { setSnapshot(await api.getHouseholdSnapshotByEvent(householdId, eventId)) }
    catch { setSnapshot(null) }
    finally { setLoading(false) }
  }

  const steps = useMemo(
    () => [...events].filter(e => e.event_date).sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1)),
    [events]
  )
  const idx = snapshot ? steps.findIndex(e => e.event_date === snapshot.target_date) : -1
  const stepTo = (i: number) => { const ev = steps[i]; if (ev) openSnapshot(ev.id) }

  return (
    <div className="border border-[#F0EBE1] rounded-card px-2.5 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11.5px] font-semibold">历史快照</span>
        <span className="text-[10px] text-[#8C877A]">{events.length} 条</span>
      </div>
      {events.length === 0 && <div className="py-4 text-center text-[10.5px] text-text-muted/60">暂无变更记录</div>}
      <div className="flex flex-col overflow-y-auto" style={{ maxHeight: 180 }}>
        {events.map(ev => {
          const active = snapshot?.target_date && ev.event_date === snapshot.target_date
          const cfg = EVENT_TYPE_CFG[ev.event_type] || EVENT_TYPE_CFG.REMARK
          return (
            <div key={ev.id} onClick={() => openSnapshot(ev.id)}
              className={`cursor-pointer border-b border-[#F2EDE3] py-1.5 px-1 rounded-[3px] transition-colors ${active ? 'bg-[#F3F7F4]' : 'hover:bg-[#F7FAF8]'}`}>
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] rounded-[2px] px-1 ${cfg.color}`}>{cfg.label}</span>
                <span className="text-[10px] text-[#8C877A] font-mono">{ev.event_date || `${ev.event_year} 年`}</span>
                <span className="ml-auto text-[9.5px] text-primary">快照 →</span>
              </div>
              <div className="text-[10.5px] mt-0.5 truncate" title={ev.description}>{ev.description || '（无说明）'}</div>
            </div>
          )
        })}
      </div>
      {loading && <div className="py-1 text-[10px] text-text-muted">快照加载中…</div>}
      {snapshot && snapshot.snapshot && (
        <div className="mt-1.5 pt-1.5 border-t border-[#F2EDE3] text-[10.5px]">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-[#2C6B52]">{snapshot.target_date} 快照</span>
            <button onClick={() => setSnapshot(null)} className="text-[10px] text-text-muted hover:text-primary">退出</button>
          </div>
          <div className="flex justify-between"><span className="text-[#8C877A]">参考面积</span><span className="font-mono">{Number(snapshot.snapshot.contract_area || 0).toFixed(2)} 亩</span></div>
          <div className="flex justify-between"><span className="text-[#8C877A]">成员</span><span>{snapshot.snapshot.members?.length ?? 0} 人</span></div>
          <div className="flex justify-between"><span className="text-[#8C877A]">补贴记录</span><span>{snapshot.snapshot.app_summary?.length ?? 0} 条</span></div>
          {(snapshot.snapshot.members || []).slice(0, 4).map(m => (
            <div key={m.id} className="flex justify-between text-[10px] pl-2">
              <span className="truncate">{m.real_name}{m.is_head === 1 ? '（户主）' : ''}</span>
              <span className="text-text-muted">{FARMER_STATUS_LABEL[m.farmer_status] || '—'}</span>
            </div>
          ))}
        </div>
      )}
      {steps.length > 1 && (
        <div className="flex items-center gap-1.5 pt-1.5 mt-1.5 border-t border-[#F2EDE3]">
          <button onClick={() => stepTo(idx - 1)} disabled={idx <= 0}
            className="h-6 px-1.5 border border-border rounded-[3px] bg-white text-[10px] text-[#5A5A4F] disabled:opacity-40">‹ 上一时点</button>
          <button onClick={() => stepTo(idx + 1)} disabled={idx < 0 || idx >= steps.length - 1}
            className="h-6 px-1.5 border border-border rounded-[3px] bg-white text-[10px] text-[#5A5A4F] disabled:opacity-40">下一时点 ›</button>
          <span className="ml-auto text-[9.5px] text-[#8C877A]">{idx >= 0 ? `${idx + 1} / ${steps.length}` : '—'}</span>
        </div>
      )}
    </div>
  )
}

/** 大户详情面板 */
function LargeFarmerPanel({ farmer, trusts, loading }: { farmer: LargeFarmer | null; trusts: LargeFarmerTrust[]; loading: boolean }) {
  if (!farmer) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一名大户'}</div>
  }
  const trustTotal = trusts.reduce((s, t) => s + Number(t.area || 0), 0)
  return (
    <>
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#F2EDE3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
            {farmer.operator_name?.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{farmer.operator_name}</h2>
              <span className="text-[10px] bg-[#F6EEDC] text-[#8A6620] rounded-full px-1.5 py-[1px]">{OPERATOR_LABEL[farmer.operator_type] || farmer.operator_type_label}</span>
            </div>
            <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
              <span className="font-mono">{farmer.id_card || '—'}</span>
              <span className="mx-1.5">·</span>
              <span className="font-mono">{farmer.phone || '—'}</span>
              <span className="mx-1.5">·</span>
              {farmer.village_name}{farmer.group_no ? ` ${farmer.group_no} 组` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-7 px-2.5 border border-[#E6C288] rounded-btn bg-[#E6C288] text-[11px] text-[#5A4215] flex items-center">只读预览</span>
        </div>
      </div>

      <div className="flex items-center px-4 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7]" style={{ height: 58 }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold">经营规模</div>
            <div className="text-[9.5px] text-white/55">按当前流转台账汇总</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">经营面积</div><div className="text-[15px] font-bold text-[#E6C288] font-mono">{Number(farmer.total_managed_area || 0).toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">自有承包</div><div className="text-[15px] font-bold font-mono">{Number(farmer.own_contract_area || 0).toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">流入</div><div className="text-[15px] font-bold font-mono">{Number(farmer.trust_in_area || 0).toFixed(2)} 亩</div></div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-[#F2EDE3]">
        {[
          ['身份证号', farmer.id_card || '—'],
          ['手机号', farmer.phone || '—'],
          ['所在村组', `${farmer.village_name}${farmer.group_no ? ` ${farmer.group_no} 组` : ''}`],
          ['地址', farmer.address || '—'],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
            <div className="text-[9.5px] text-[#9A9588]">{k}</div>
            <div className="text-[11.5px] text-[#5A5A4F] mt-px truncate">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
            <span className="text-[11.5px] font-semibold">流转明细 <span className="text-[10px] text-[#8C877A] font-normal">{trusts.length}</span></span>
            <span className="text-[10px] text-[#8C877A]">合计 <b className="font-mono text-primary">{trustTotal.toFixed(2)} 亩</b></span>
          </div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                <th className="font-medium px-2.5">转出户</th>
                <th className="font-medium px-1.5">类型</th>
                <th className="font-medium px-1.5 text-right">面积</th>
                <th className="font-medium px-2.5">起止</th>
              </tr>
            </thead>
            <tbody>
              {trusts.map(t => (
                <tr key={t.id} className="border-t border-[#F2EDE3] h-[34px] hover:bg-[#F7FAF8] transition-colors">
                  <td className="px-2.5">
                    <b>{t.owner_household_name}</b>
                    <span className="ml-1 text-[9.5px] text-[#8C877A] font-mono">{t.owner_household_code}</span>
                  </td>
                  <td className="px-1.5 text-[#6B6B60]">{t.trust_type_label}</td>
                  <td className="px-1.5 text-right font-mono">{Number(t.area || 0).toFixed(2)}</td>
                  <td className="px-2.5 text-[10px] text-[#8C877A]">
                    {t.trust_year} 年{t.start_date ? ` · ${t.start_date.slice(0, 10)}` : ''}
                  </td>
                </tr>
              ))}
              {trusts.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-[11px] text-text-muted/60">{loading ? '加载中…' : '暂无流转记录'}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="经营构成">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="自有承包" value={`${Number(farmer.own_contract_area || 0).toFixed(2)} 亩`} />
              <FieldRow label="流入面积" value={`${Number(farmer.trust_in_area || 0).toFixed(2)} 亩`} />
              <FieldRow label="流转笔数" value={`${trusts.length} 笔`} />
              <FieldRow label="合计" value={`${trustTotal.toFixed(2)} 亩`} />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

/** 村组详情面板（村集体作为申报主体） */
function VillagePanel({ detail, loading }: { detail: VillageDetail | null; loading: boolean }) {
  if (!detail) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一个村'}</div>
  }
  const groups = detail.groups || []
  const contacts = detail.contacts || []
  return (
    <>
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#F2EDE3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
            {detail.village_name?.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{detail.village_name}</h2>
              <span className="text-[10px] bg-[#EDF3EF] text-[#2C6B52] rounded-[3px] px-1.5 py-[1px]">村集体主体</span>
            </div>
            <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
              {detail.leader_name ? `负责人 ${detail.leader_name}` : '暂无在册负责人'}
              {detail.leader_phone ? <><span className="mx-1.5">·</span><span className="font-mono">{detail.leader_phone}</span></> : null}
              <span className="mx-1.5">·</span>
              {groups.length} 个组
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-7 px-2.5 border border-[#E6C288] rounded-btn bg-[#E6C288] text-[11px] text-[#5A4215] flex items-center">只读预览</span>
        </div>
      </div>

      <div className="flex items-center px-4 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7]" style={{ height: 58 }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold">村集体概况</div>
            <div className="text-[9.5px] text-white/55">村集体可作为补贴申报主体</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">村民组</div><div className="text-[15px] font-bold text-[#E6C288] font-mono">{groups.length} 个</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">历任负责人</div><div className="text-[15px] font-bold font-mono">{contacts.length} 人</div></div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        <div className="flex flex-col gap-2.5 min-w-0">
          <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
              <span className="text-[11.5px] font-semibold">村民组 <span className="text-[10px] text-[#8C877A] font-normal">{groups.length}</span></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                  <th className="font-medium px-2.5">组号</th>
                  <th className="font-medium px-2.5">组长</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id} className="border-t border-[#F2EDE3] h-[30px] hover:bg-[#F7FAF8] transition-colors">
                    <td className="px-2.5 font-semibold">{g.group_no} 组</td>
                    <td className="px-2.5 text-[#6B6B60]">{g.leader_name || '—'}</td>
                  </tr>
                ))}
                {groups.length === 0 && <tr><td colSpan={2} className="py-8 text-center text-[11px] text-text-muted/60">暂无村民组</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
              <span className="text-[11.5px] font-semibold">负责人记录 <span className="text-[10px] text-[#8C877A] font-normal">{contacts.length}</span></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id} className="border-t border-[#F2EDE3] h-[30px] hover:bg-[#F7FAF8] transition-colors">
                    <td className="px-2.5 font-semibold">{c.leader_name}</td>
                    <td className="px-1.5 font-mono text-[#8C877A]">{c.leader_phone}</td>
                    <td className="px-2.5 text-[10px] text-[#8C877A] text-right">{c.start_year} — {c.end_year ?? '至今'}</td>
                  </tr>
                ))}
                {contacts.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-[11px] text-text-muted/60">暂无负责人记录</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="村集体信息">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="村名" value={detail.village_name} />
              <FieldRow label="负责人" value={detail.leader_name || '—'} />
              <FieldRow label="联系电话" value={detail.leader_phone || '—'} />
              <FieldRow label="村民组" value={`${groups.length} 个`} />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
