/**
 * 新版界面 - 户籍管理 · 农户（完全复刻画布 Farmers）
 *
 * 左侧 338px：农户 / 家庭户切换、搜索、村组与状态筛选、人员列表、分页
 * 右侧：人员档案头、家庭户面积条、四列基础信息、
 *       左栏三块垂直排列：家庭人口、补贴记录（各自限高滚动）、土地流转/异常（内部 Tab）
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
import FarmerDetailPanel from './FarmerDetailPanel'
import HouseholdDetailPanel from './HouseholdDetailPanel'
import LargeFarmerPanel from './LargeFarmerPanel'
import VillagePanel from './VillagePanel'
import { OPERATOR_LABEL } from './types'
import type { LargeFarmer, LargeFarmerTrust, VillageDetail, VillageRow } from './types'
import type { FarmerOut, FarmerDetail, HH, HHDetail, HHEvent, SnapshotAtResponse, VillageGroup } from '../../types'

type SideTab = 'farmers' | 'households' | 'large' | 'villages'


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
