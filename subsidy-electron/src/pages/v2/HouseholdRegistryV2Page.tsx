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
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { Card, Chip, FieldRow, ListRow, FARMER_STATUS_LABEL, HH_STATUS_LABEL, PAY_STATUS_LABEL, money } from './shared'
import HouseholdActions, { AddMemberButton, MemberRowActions } from './households/HouseholdActions'
import { CreateFarmerButton, FarmerActions } from './farmers/FarmerActions'
import FarmerDetailPanel from './farmers/FarmerDetail'
import HouseholdDetailPanel from './households/HouseholdDetail'
import LargeFarmerPanel from './large/LargeDetail'
import VillagePanel from './villages/VillageDetail'
import { Ico } from './Icons'
import RegistryView from './RegistryView'
import { OPERATOR_LABEL } from './types'
import type { LargeFarmer, LargeFarmerTrust, VillageDetail, VillageRow } from './types'
import type { FarmerOut, FarmerDetail, HH, HHDetail, HHEvent, SnapshotAtResponse, VillageGroup } from '../../types'

type SideTab = 'farmers' | 'households' | 'large' | 'villages'


const PAGE_SIZE = 20
const HH_PAGE_SIZE = 20
const LARGE_PAGE_SIZE = 20


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
      const params: Record<string, unknown> = { page: largePage, page_size: LARGE_PAGE_SIZE }
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
  // ── 搜索防抖：输入后 350ms 自动生效 ──
  const debouncedSearch = useDebouncedValue(searchInput, 350)
  const debouncedHhSearch = useDebouncedValue(hhSearchInput, 350)

  useEffect(() => {
    setSearch(debouncedSearch.trim())
    setPage(1)
  }, [debouncedSearch])

  useEffect(() => {
    setHhSearch(debouncedHhSearch.trim())
    setHhPage(1)
  }, [debouncedHhSearch])


  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hhTotalPages = Math.max(1, Math.ceil(hhTotal / HH_PAGE_SIZE))
  const largeTotalPages = Math.max(1, Math.ceil(largeTotal / LARGE_PAGE_SIZE))

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
    <RegistryView
      navigate={navigate}
      sideTab={sideTab} setSideTab={setSideTab}
      list={list} total={total} page={page} totalPages={totalPages} loadingList={loadingList}
      searchInput={searchInput} setSearchInput={setSearchInput}
      village={village} setVillage={setVillage} status={status} setStatus={setStatus}
      villages={villages} householdTotal={householdTotal} setPage={setPage}
      hhList={hhList} hhTotal={hhTotal} hhPage={hhPage} hhTotalPages={hhTotalPages} loadingHhList={loadingHhList}
      hhSearchInput={hhSearchInput} setHhSearchInput={setHhSearchInput}
      hhVillage={hhVillage} setHhVillage={setHhVillage} hhStatus={hhStatus} setHhStatus={setHhStatus}
      selectedHhId={selectedHhId} setSelectedHhId={setSelectedHhId} setHhPage={setHhPage}
      largeList={largeList} largeTotal={largeTotal} largePage={largePage} largeTotalPages={largeTotalPages} loadingLarge={loadingLarge}
      selectedLargeId={selectedLargeId} setSelectedLargeId={setSelectedLargeId} setLargePage={setLargePage}
      largeTrusts={largeTrusts} loadingTrusts={loadingTrusts}
      villageList={villageList} selectedVillageId={selectedVillageId} setSelectedVillageId={setSelectedVillageId}
      villageDetail={villageDetail} loadingVillage={loadingVillage}
      selectedId={selectedId} setSelectedId={setSelectedId}
      farmer={farmer} household={household} loadingDetail={loadingDetail}
      reloadHousehold={reloadHousehold} reloadFarmer={reloadFarmer}
    />
  )
}

/** 农户详情面板 */
