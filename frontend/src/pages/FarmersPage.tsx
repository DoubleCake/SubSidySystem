/**
 * 户籍管理页 —— 以家庭户为主线的统一入口
 *
 * 左栏：Tab切换（农户列表 / 家庭户列表）- 32%
 * 右栏：详情面板 - 68%
 *   - 选中农户：上半部分个人信息 + 下半部分家庭户信息
 *   - 选中家庭户：家庭户详情（成员/面积/补贴/历史）
 */
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import * as api from '../api'
import type { VillageGroup, HH, HHDetail, HHMember, HHEvent, HistoryDateEvent, SnapshotAtResponse, FarmerDetail, FarmerOut, SnapshotMember, ExcelColumnTemplate } from '../types'
import { FARMER_STATUS, parseIdCardInfo } from '../utils'
import Icon from '../components/Icon'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

// Components
import FarmerList from './FarmerList'
import HouseholdList from './HouseholdList'
import { FarmerDetail as FarmerDetailCard, FarmerHouseholdDetail, HistorySidebar } from './FarmerDetail'
import { HouseholdDetailContent } from './HouseholdDetail'
import {
  CreateHhForm,
  CreateFarmerForm,
  MergeConfirmForm,
  MemberForm,
  SplitWizardForm,
  EventForm,
  ConfirmForm,
  DeleteConfirmForm,
  ConfirmedAreaImport,
  FarmerImport,
  MemberImport,
  EditHouseholdForm,
} from './FarmerForms'

type LeftTab = 'farmers' | 'households'

export default function FarmersPage() {
  const { toast, show } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── 从 URL 恢复状态 ──
  const getInitialLeftTab = (): LeftTab => {
    const tab = searchParams.get('tab')
    return tab === 'farmers' ? 'farmers' : 'households'
  }
  const getInitialFarmerId = (): number | null => {
    const id = searchParams.get('farmerId')
    return id ? Number(id) : null
  }
  const getInitialHouseholdId = (): number | null => {
    const id = searchParams.get('householdId')
    return id ? Number(id) : null
  }

  // ── 左侧Tab ──
  const [leftTab, setLeftTab] = useState<LeftTab>(getInitialLeftTab)

  // ── 农户列表 ──
  const [farmerList, setFarmerList] = useState<FarmerOut[]>([])
  const [farmerTotal, setFarmerTotal] = useState(0)
  const [farmerPage, setFarmerPage] = useState(1)
  const [farmerLoading, setFarmerLoading] = useState(false)
  const [selectedFarmer, setSelectedFarmer] = useState<FarmerDetail | null>(null)
  const [selectedFarmerHousehold, setSelectedFarmerHousehold] = useState<HHDetail | null>(null)

  // ── 家庭户列表 ──
  const [hhList, setHhList] = useState<HH[]>([])
  const [hhTotal, setHhTotal] = useState(0)
  const [hhPage, setHhPage] = useState(1)
  const [hhLoading, setHhLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [villageFilter, setVillageFilter] = useState('')
  const [overdrawnOnly, setOverdrawnOnly] = useState(false)
  const [confirmedFilter, setConfirmedFilter] = useState<string>('') // ''=全部, '1'=已确认, '0'=未确认
  const [statusFilter, setStatusFilter] = useState<string>('1') // ''=全部, '1'=在册, '2'=注销, '3'=迁出
  const [highSubsidyOnly, setHighSubsidyOnly] = useState(false) // 补贴记录≥4条
  const yearFilter = new Date().getFullYear()

  // ── 批量确认状态 ──
  const [batchConfirmMode, setBatchConfirmMode] = useState(false)
  const [batchSelected, setBatchSelected] = useState<number[]>([])
  const [batchSelectedHouseholds, setBatchSelectedHouseholds] = useState<HH[]>([])
  const [batchConfirmLoading, setBatchConfirmLoading] = useState(false)

  // ── 删除确认状态 ──
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<HH | HHDetail | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── 户详情 ──
  const [detail, setDetail] = useState<HHDetail | null>(null)
  const detailYear = new Date().getFullYear()
  const [detailTab, setDetailTab] = useState<'members' | 'subsidy'>('members')
  const [areaYear, setAreaYear] = useState(detailYear)
  const [events, setEvents] = useState<HHEvent[]>([])

  // ── 历史快照 ──
  const [historyEventId, setHistoryEventId] = useState<number | null>(null)
  const [historyDates, setHistoryDates] = useState<HistoryDateEvent[]>([])
  const [snapshotData, setSnapshotData] = useState<SnapshotAtResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())

  // ── 辅助：根据 eventId 获取对应的 date ──
  const getHistoryDateByEventId = (eventId: number | null): string | null => {
    if (!eventId) return null
    const event = historyDates.find(e => e.event_id === eventId)
    return event?.date || null
  }

  // ── 辅助：根据 date 获取对应的 event (取第一个) ──
  const getFirstEventByDate = (date: string | null): HistoryDateEvent | null => {
    if (!date) return null
    return historyDates.find(e => e.date === date) || null
  }

  // ── 村组数据 ──
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [villages, setVillages] = useState<string[]>([])

  // ── 新建家庭户 ──
  const [createHhOpen, setCreateHhOpen] = useState(false)
  const [createHhForm, setCreateHhForm] = useState({ household_name: '', village_group_id: 0, contract_area: '', address: '', remark: '' })

  // ── 合并家庭户（内嵌模式） ──
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<number[]>([])
  const [mergeSelectedHouseholds, setMergeSelectedHouseholds] = useState<HH[]>([])
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false)
  const [mergeConfirmForm, setMergeConfirmForm] = useState({ contract_area: '', remark: '' })
  const [mergeLoading, setMergeLoading] = useState(false)

  const toggleMergeHousehold = (h: HH) => {
    const isSelected = mergeSelected.includes(h.id)
    if (isSelected) {
      setMergeSelected(prev => prev.filter(id => id !== h.id))
      setMergeSelectedHouseholds(prev => prev.filter(hh => hh.id !== h.id))
    } else {
      setMergeSelected(prev => [...prev, h.id])
      setMergeSelectedHouseholds(prev => {
        if (prev.some(hh => hh.id === h.id)) return prev
        return [...prev, h]
      })
    }
  }

  const clearMergeSelection = () => {
    setMergeSelected([])
    setMergeSelectedHouseholds([])
  }

  // ── 批量确认家庭户 ──
  const toggleBatchConfirm = (h: HH) => {
    const isSelected = batchSelected.includes(h.id)
    if (isSelected) {
      setBatchSelected(prev => prev.filter(id => id !== h.id))
      setBatchSelectedHouseholds(prev => prev.filter(hh => hh.id !== h.id))
    } else {
      setBatchSelected(prev => [...prev, h.id])
      setBatchSelectedHouseholds(prev => {
        if (prev.some(hh => hh.id === h.id)) return prev
        return [...prev, h]
      })
    }
  }

  const clearBatchSelection = () => {
    setBatchSelected([])
    setBatchSelectedHouseholds([])
  }

  const handleBatchConfirm = async () => {
    if (batchSelected.length === 0) return
    setBatchConfirmLoading(true)
    try {
      const r = await api.batchConfirmHouseholds({
        household_ids: batchSelected,
        operator: '系统批量确认'
      })
      show(`批量确认完成：${r.confirmed}个成功，${r.skipped}个已确认过`, 'ok')
      setBatchConfirmMode(false)
      clearBatchSelection()
      await loadHouseholds()
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally {
      setBatchConfirmLoading(false)
    }
  }

  // ── 删除家庭户 ──
  const handleDeleteHousehold = async () => {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await api.deleteHousehold(deleteTarget.id)
      show(`家庭户「${deleteTarget.household_name}」已删除`, 'ok')
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
      await loadHouseholds()
      if (detail?.id === deleteTarget.id) {
        setDetail(null)
        setSelectedFarmerHousehold(null)
      }
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally {
      setDeleteLoading(false)
    }
  }

  // ── 新建农户 ──
  const [createFarmerOpen, setCreateFarmerOpen] = useState(false)
  const [createFarmerForm, setCreateFarmerForm] = useState({ real_name: '', id_card: '', gender: 1 as 1|2, phone: '', village_name: '', group_no: '', address: '', contract_area: '', remark: '' })

  // ── 编辑家庭户 ──
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ household_name: '', contract_area: '', village_id: 0, group_no: 1, address: '', remark: '' })

  // ── 成员管理 ──
  const [memberAddOpen, setMemberAddOpen] = useState(false)
  const [memberEditTarget, setMemberEditTarget] = useState<HHMember | null>(null)
  const [memberForm, setMemberForm] = useState({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1', restricted_identity: '0', event_date: '', village_id: 0, group_no: 1, village_name: '', group_name: '' })
  const [memberImportOpen, setMemberImportOpen] = useState(false)

  // ── 分户向导 ──
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitStep, setSplitStep] = useState<1 | 2 | 3>(1)
  const [splitSelected, setSplitSelected] = useState<number[]>([])
  const [splitNewHead, setSplitNewHead] = useState<number | null>(null)
  const [splitForm, setSplitForm] = useState({ household_name: '', split_year: String(new Date().getFullYear()), split_date: '', new_land_area: '', origin_land_area: '', description: '', evidence_type: '', evidence_note: '' })

  // ── 手动补录事件 ──
  const [eventOpen, setEventOpen] = useState(false)
  const [eventForm, setEventForm] = useState({ event_type: 'REMARK', event_year: String(new Date().getFullYear()), event_date: '', description: '', evidence_type: 'NONE', evidence_note: '' })


  // ── 批量导入农户 ──
  const [importOpen, setImportOpen] = useState(false)
  const [importOverwrite, setImportOverwrite] = useState(false)
  const [templates, setTemplates] = useState<ExcelColumnTemplate[]>([])

  // ── 批量导入确权面积 ──
  const [confirmedAreaImportOpen, setConfirmedAreaImportOpen] = useState(false)
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [confirmForm, setConfirmForm] = useState({ operator: '', remark: '' })
  const [confirmedAreaRows, setConfirmedAreaRows] = useState<{ real_name: string; id_card: string; confirmed_area: number }[]>([])
  const [confirmedAreaImportResult, setConfirmedAreaImportResult] = useState<{ success: number; not_found: { id_card: string; real_name: string }[]; mismatch_name: { id_card: string; input_name: string; db_name: string }[]; errors: { id_card: string; reason: string }[] } | null>(null)
  const [confirmedAreaImporting, setConfirmedAreaImporting] = useState(false)

  // ── 加载农户列表 ──
  const loadFarmers = useCallback(async () => {
    setFarmerLoading(true)
    try {
      const p: Record<string, string | number> = { page: farmerPage, page_size: 20 }
      if (search) p.search = search
      if (villageFilter) p.village_name = villageFilter
      const r = await api.getFarmers(p)
      setFarmerList(r.items); setFarmerTotal(r.total)
    } finally { setFarmerLoading(false) }
  }, [farmerPage, search, villageFilter])

  // ── 加载家庭户列表 ──
  const loadHouseholds = useCallback(async () => {
    setHhLoading(true)
    try {
      const p: Record<string, string | number> = { page: hhPage, page_size: 20, year: yearFilter }
      if (search) p.search = search
      if (villageFilter) p.village_name = villageFilter
      if (overdrawnOnly) p.overdrawn_only = '1'
      if (confirmedFilter) p.confirmed_only = confirmedFilter
      if (statusFilter) p.status = statusFilter
      if (highSubsidyOnly) p.min_app_count = 4
      const r = await api.getHouseholds(p)
      setHhList(r.items); setHhTotal(r.total)
    } finally { setHhLoading(false) }
  }, [hhPage, search, yearFilter, villageFilter, overdrawnOnly, confirmedFilter, statusFilter, highSubsidyOnly])

  useEffect(() => {
    if (leftTab === 'farmers') loadFarmers()
    else loadHouseholds()
  }, [leftTab, loadFarmers, loadHouseholds])

  useEffect(() => {
    api.getVillageGroups().then(g => {
      setGroups(g); setVillages([...new Set(g.map(v => v.village_name))])
    })
    api.getExcelTemplates('FARMER').then(setTemplates).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      if (leftTab === 'farmers') setFarmerPage(1)
      else setHhPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search, leftTab])

  // ── 从 URL 恢复选中状态 ──
  useEffect(() => {
    const farmerId = getInitialFarmerId()
    const householdId = getInitialHouseholdId()

    if (farmerId && leftTab === 'farmers') {
      openFarmer(farmerId, true)
    } else if (householdId && leftTab === 'households') {
      openDetail(householdId, true)
    }
  }, [])

  // ── 更新 URL ──
  const updateUrl = useCallback((params: { tab?: LeftTab; farmerId?: number | null; householdId?: number | null }) => {
    const newParams = new URLSearchParams(searchParams)
    if (params.tab) {
      newParams.set('tab', params.tab)
    }
    if (params.farmerId !== undefined) {
      if (params.farmerId) {
        newParams.set('farmerId', String(params.farmerId))
        newParams.delete('householdId')
      } else {
        newParams.delete('farmerId')
      }
    }
    if (params.householdId !== undefined) {
      if (params.householdId) {
        newParams.set('householdId', String(params.householdId))
        newParams.delete('farmerId')
      } else {
        newParams.delete('householdId')
      }
    }
    setSearchParams(newParams, { replace: true })
  }, [searchParams, setSearchParams])

  // ── 加载家庭户历史日期 ──
  const loadHouseholdHistoryDates = useCallback(async (householdId: number) => {
    try {
      const hd = await api.getHouseholdHistoryDates(householdId)
      setHistoryDates(hd.events)
      const firstReal = hd.events.find(e => e.event_type !== 'ORIGINAL')
      if (firstReal) setExpandedYears(new Set([firstReal.event_year]))
    } catch {
      setHistoryDates([])
    }
  }, [])

  // ── 打开农户详情 ──
  const openFarmer = async (farmerId: number, skipUrlUpdate = false) => {
    try {
      const f = await api.getFarmer(farmerId) as FarmerDetail
      setSelectedFarmer(f)
      setDetail(null)
      setHistoryEventId(null)
      setSnapshotData(null)
      setEvents([])
      // 切换到农户时清除合并和批量确认状态
      setMergeMode(false); setMergeSelected([]); setMergeSelectedHouseholds([])
      setBatchConfirmMode(false); setBatchSelected([]); setBatchSelectedHouseholds([])
      // 同时加载所属家庭户信息
      if (f.household_id) {
        try {
          const hh = await api.getHouseholdDetail(f.household_id)
          setSelectedFarmerHousehold(hh)
          await loadHouseholdHistoryDates(f.household_id)
        } catch {
          setSelectedFarmerHousehold(null)
          setHistoryDates([])
        }
      } else {
        setSelectedFarmerHousehold(null)
        setHistoryDates([])
      }
      if (!skipUrlUpdate) {
        updateUrl({ tab: 'farmers', farmerId, householdId: null })
      }
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 打开户详情 ──
  const openDetail = async (id: number, skipUrlUpdate = false) => {
    setAreaYear(detailYear)
    const d = await api.getHouseholdDetail(id, detailYear)
    setDetail(d); setDetailTab('members'); setEvents([]); setSelectedFarmer(null); setSelectedFarmerHousehold(null)
    setHistoryEventId(null); setSnapshotData(null)
    // 打开详情时清除合并和批量确认状态
    setMergeMode(false); setMergeSelected([]); setMergeSelectedHouseholds([])
    setBatchConfirmMode(false); setBatchSelected([]); setBatchSelectedHouseholds([])
    await loadHouseholdHistoryDates(id)
    if (!skipUrlUpdate) {
      updateUrl({ tab: 'households', farmerId: null, householdId: id })
    }
  }

  // ── 刷新面积缓存 ──
  const [refreshingCache, setRefreshingCache] = useState(false)
  const handleRefreshCache = async (householdId?: number) => {
    if (refreshingCache) return
    setRefreshingCache(true)
    try {
      const r = await api.refreshAreaCache(householdId)
      show(r.message)
      if (householdId) {
        refreshDetail()
      } else {
        loadHouseholds()
        refreshDetail()
      }
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally {
      setRefreshingCache(false)
    }
  }

  // ── 重新计算未确认家庭户承包地面积 ──
  const [recalculatingArea, setRecalculatingArea] = useState(false)
  const handleRecalcUnconfirmedArea = async () => {
    if (recalculatingArea) return
    setRecalculatingArea(true)
    try {
      const r = await api.recalcUnconfirmedContractArea()
      show(r.message, 'ok')
      loadHouseholds()
      refreshDetail()
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally {
      setRecalculatingArea(false)
    }
  }

  // ── 刷新户详情 ──
  const refreshDetail = async () => {
    if (detail) {
      const d = await api.getHouseholdDetail(detail.id)
      setDetail(d)
    }
    if (selectedFarmer?.household_id) {
      try {
        const hh = await api.getHouseholdDetail(selectedFarmer.household_id)
        setSelectedFarmerHousehold(hh)
      } catch {
        setSelectedFarmerHousehold(null)
      }
    }
  }

  // ── 人工确认家庭户 ──
  const handleManualConfirm = async () => {
    if (!detail) return
    try {
      await api.manualConfirmHousehold(detail.id, {
        operator: confirmForm.operator || undefined,
        remark: confirmForm.remark || undefined,
      })
      show('✓ 家庭户信息已确认')
      setManualConfirmOpen(false)
      setConfirmForm({ operator: '', remark: '' })
      await refreshDetail()
      await loadHouseholds()
      await loadHouseholdHistoryDates(detail.id)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 取消人工确认 ──
  const handleCancelConfirm = async () => {
    if (!detail) return
    try {
      await api.cancelManualConfirm(detail.id, {
        operator: confirmForm.operator || undefined,
        remark: confirmForm.remark || undefined,
      })
      show('✓ 已取消人工确认')
      setCancelConfirmOpen(false)
      setConfirmForm({ operator: '', remark: '' })
      await refreshDetail()
      await loadHouseholds()
      await loadHouseholdHistoryDates(detail.id)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 历史快照 ──
  const loadSnapshotAt = async (date: string, householdId?: number, eventId?: number) => {
    const hhId = householdId ?? detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return
    setHistoryLoading(true)
    try {
      let snap: SnapshotAtResponse
      if (eventId !== undefined) {
        snap = await api.getHouseholdSnapshotByEvent(hhId, eventId)
        setHistoryEventId(eventId)
      } else {
        snap = await api.getHouseholdSnapshotAt(hhId, date)
        const ev = getFirstEventByDate(date)
        setHistoryEventId(ev?.event_id ?? null)
      }
      setSnapshotData(snap)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setHistoryLoading(false) }
  }

  const exitHistory = () => { setHistoryEventId(null); setSnapshotData(null) }

  // ── 加载事件 ──
  const loadEvents = useCallback(async () => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return
    const r = await api.getHouseholdEvents(hhId)
    setEvents(r)
  }, [detail?.id, selectedFarmerHousehold?.id])

  useEffect(() => {
    if (detail || selectedFarmerHousehold) loadEvents()
  }, [detail?.id, selectedFarmerHousehold?.id, loadEvents])

  // ── 年份切换时，重新获取该年度的流转数据和面积信息 ──
  useEffect(() => {
    if (!detail || historyEventId !== null) return
    const currentId = detail.id
    api.getHouseholdDetail(currentId, areaYear > 0 ? areaYear : undefined).then(d => {
      if (d.id === currentId) setDetail(d)
    })
  }, [areaYear]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 切换左侧 Tab ──
  const handleTabChange = (tab: LeftTab) => {
    setLeftTab(tab)
    setSelectedFarmer(null)
    setDetail(null)
    setSelectedFarmerHousehold(null)
    setHistoryEventId(null)
    setSnapshotData(null)
    setHistoryDates([])
    setEvents([])
    // 切换 Tab 时清除合并和批量确认状态
    setMergeMode(false)
    setMergeSelected([])
    setMergeSelectedHouseholds([])
    setBatchConfirmMode(false)
    setBatchSelected([])
    setBatchSelectedHouseholds([])
    updateUrl({ tab, farmerId: null, householdId: null })
  }

  // ── 新建家庭户 ──
  const submitCreateHh = async () => {
    if (!createHhForm.household_name.trim()) return show('请填写户名', 'err')
    if (!createHhForm.village_group_id) return show('请选择所在村组', 'err')
    try {
      const r = await api.createHousehold({
        household_name: createHhForm.household_name,
        village_group_id: createHhForm.village_group_id,
        contract_area: Number(createHhForm.contract_area) || undefined,
        address: createHhForm.address || undefined,
        remark: createHhForm.remark || undefined,
      })
      show('✓ 家庭户创建成功')
      setCreateHhOpen(false)
      setCreateHhForm({ household_name: '', village_group_id: 0, contract_area: '', address: '', remark: '' })
      if (leftTab === 'households') loadHouseholds()
      openDetail(r.id)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 新建农户 ──
  const submitCreateFarmer = async () => {
    if (!createFarmerForm.real_name.trim()) return show('请填写姓名', 'err')
    if (!createFarmerForm.id_card.trim()) return show('请填写身份证号', 'err')
    if (!createFarmerForm.village_name.trim()) return show('请选择所在村', 'err')
    if (!createFarmerForm.group_no) return show('请选择所在组', 'err')
    try {
      const r = await api.createFarmer({
        real_name: createFarmerForm.real_name,
        id_card: createFarmerForm.id_card,
        gender: createFarmerForm.gender,
        phone: createFarmerForm.phone || undefined,
        village_name: createFarmerForm.village_name,
        group_no_str: createFarmerForm.group_no,
        address: createFarmerForm.address || undefined,
        land_area: createFarmerForm.contract_area ? Number(createFarmerForm.contract_area) : undefined,
        farmer_status: 1,
        remark: createFarmerForm.remark || undefined,
      } as Parameters<typeof api.createFarmer>[0])
      show('✓ 农户创建成功')
      setCreateFarmerOpen(false)
      setCreateFarmerForm({ real_name: '', id_card: '', gender: 1, phone: '', village_name: '', group_no: '', address: '', contract_area: '', remark: '' })
      if (leftTab === 'farmers') loadFarmers()
      openFarmer(r.id, true)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 合并家庭户（内嵌模式） ──
  const handleMergeConfirm = () => {
    if (mergeSelectedHouseholds.length < 2) return show('请至少选择 2 个家庭户', 'err')
    const target = mergeSelectedHouseholds[0]
    setMergeConfirmForm({ contract_area: target?.contracted_area?.toString() || '', remark: '' })
    setMergeConfirmOpen(true)
  }

  const confirmMerge = async () => {
    const targetId = mergeSelected[0]
    const sourceIds = mergeSelected.slice(1)
    setMergeLoading(true)
    try {
      for (const srcId of sourceIds) {
        await api.mergeHouseholds({
          source_household_id: srcId,
          target_household_id: targetId,
        })
      }
      show(`✓ 已合并 ${sourceIds.length} 个家庭户到目标户`)
      setMergeConfirmOpen(false)
      setMergeMode(false)
      clearMergeSelection()
      setHhPage(1)
      await loadHouseholds()
    } catch (e: unknown) { show((e as Error).message, 'err') } finally {
      setMergeLoading(false)
    }
  }

  // ── 确权面积批量导入 ──
  const submitConfirmedAreaImport = async () => {
    if (confirmedAreaRows.length === 0) return show('请先解析 Excel 文件', 'err')
    setConfirmedAreaImporting(true)
    try {
      const result = await api.importConfirmedArea(confirmedAreaRows)
      setConfirmedAreaImportResult(result)
      show(`导入完成：成功 ${result.success} 条`, result.success > 0 ? 'ok' : 'err')
      loadHouseholds()
      if (detail) refreshDetail()
    } catch (e: unknown) { show((e as Error).message, 'err') } finally {
      setConfirmedAreaImporting(false)
    }
  }

  // ── 编辑家庭户 ──
  const submitEdit = async () => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return
    await api.updateHousehold(hhId, {
      household_name: editForm.household_name,
      contract_area: Number(editForm.contract_area) || undefined,
      village_id: editForm.village_id || undefined,
      group_no: editForm.group_no || undefined,
      address: editForm.address || undefined,
      remark: editForm.remark || undefined,
    })
    show('✓ 已更新'); setEditOpen(false); refreshDetail()
    if (leftTab === 'households') loadHouseholds()
  }

  // ── 成员增改 ──
  const submitMember = async () => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return
    if (!memberForm.real_name.trim()) return show('请填写姓名', 'err')
    if (!memberEditTarget && !memberForm.id_card.trim()) return show('请填写身份证号', 'err')
    try {
      if (memberEditTarget) {
        await api.updateHouseholdMember(hhId, memberEditTarget.id, {
          real_name: memberForm.real_name,
          relation: memberForm.relation,
          is_head: memberForm.is_head ? 1 : 0,
          phone: memberForm.phone || undefined,
          bank_card: memberForm.bank_card || undefined,
          bank_name: memberForm.bank_name || undefined,
          farmer_status: Number(memberForm.farmer_status),
          restricted_identity: Number(memberForm.restricted_identity) || 0,
          event_date: memberForm.event_date || undefined,
          village_id: memberForm.village_id || undefined,
          group_no: memberForm.group_no || undefined,
        })
        show('✓ 成员信息已更新')
      } else {
        await api.addHouseholdMember(hhId, {
          real_name: memberForm.real_name,
          id_card: memberForm.id_card,
          gender: Number(memberForm.gender),
          relation: memberForm.relation,
          is_head: memberForm.is_head ? 1 : 0,
          phone: memberForm.phone || undefined,
          bank_card: memberForm.bank_card || undefined,
          bank_name: memberForm.bank_name || undefined,
          farmer_status: 1,
          restricted_identity: Number(memberForm.restricted_identity) || 0,
        })
        show('✓ 成员已添加')
      }
      setMemberAddOpen(false); setMemberEditTarget(null); refreshDetail()
      if (leftTab === 'households') loadHouseholds()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const removeMember = async (m: HHMember | SnapshotMember) => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return
    if (!confirm(`确认移出「${m.real_name}」？移出后将标记为迁出，历史补贴记录保留。`)) return
    try {
      await api.removeHouseholdMember(hhId, m.id)
      show(`✓ 已移出「${m.real_name}」`); refreshDetail()
      if (leftTab === 'households') loadHouseholds()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openMemberEdit = (m: HHMember | SnapshotMember) => {
    setMemberEditTarget(m as HHMember)
    const hh = detail ?? selectedFarmerHousehold
    // 优先用农户个人村组，无则回落家庭户村组
    const hm = m as HHMember
    const effVid = hm.own_village_id ?? hh?.village_id
    const effGno = hm.own_group_no ?? hh?.group_no
    const v = groups.find(g => g.village_id === effVid)
    const g = groups.find(g => g.village_id === effVid && g.group_no === effGno)
    setMemberForm({
      real_name: m.real_name, id_card: '', gender: String(m.gender),
      relation: m.relation || '成员', is_head: m.is_head === 1,
      phone: '', bank_card: '', bank_name: '', farmer_status: String(m.farmer_status),
      restricted_identity: String((m as HHMember).restricted_identity ?? 0),
      event_date: '',
      village_id: effVid ?? 0,
      group_no: effGno ?? 1,
      village_name: v?.village_name ?? '',
      group_name: g ? g.full_name.replace(g.village_name, '').replace('村', '') : `第${effGno ?? 1}组`,
    })
    setMemberAddOpen(true)
  }

  // ── 成员批量导入 ──
  const MEMBER_IMPORT_ALIAS: Record<string, string> = {
    '身份证号*': 'id_card', '身份证号': 'id_card',
    '姓名*': 'real_name', '姓名': 'real_name',
    '是否户主': 'is_head',
    '与户主关系': 'relation',
    '手机号': 'phone',
    '银行卡号': 'bank_card',
    '开户行': 'bank_name',
    '状态': 'farmer_status',
  }

  const handleMemberImport = async (rows: Record<string, unknown>[]) => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return { created: 0, skipped: 0, errors: [] }
    // 列名映射：将Excel中文列名转为API英文字段名
    const mappedRows = rows.map(row => {
      const mapped: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(row)) {
        const apiField = MEMBER_IMPORT_ALIAS[key] || key
        mapped[apiField] = val
      }
      return mapped
    })
    const res = await api.batchImportHouseholdMembers(hhId, mappedRows)
    show(`✓ 新增 ${res.created} 条${res.skipped > 0 ? `，跳过 ${res.skipped} 条` : ''}`)
    refreshDetail()
    if (leftTab === 'households') loadHouseholds()
    return res
  }

  // ── 分户向导 ──
  const submitSplit = async () => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId || splitSelected.length === 0) return

    const members = (detail || selectedFarmerHousehold)?.members || []

    // 如果没有选择户主，使用第一位作为默认
    let actualHeadId = splitNewHead
    let actualHouseholdName = splitForm.household_name

    if (!actualHeadId) {
      actualHeadId = splitSelected[0]
      const defaultHeadName = members.find((m: any) => m.id === actualHeadId)?.real_name || ''

      // 如果没有填写户名，使用默认户主名
      if (!actualHouseholdName.trim()) {
        actualHouseholdName = defaultHeadName + '户'
      }

      // 询问用户是否确认使用第一位作为户主
      const confirmed = window.confirm(
        `未选择新户户主，将默认选择「${defaultHeadName}」作为新户户主，户名为「${actualHouseholdName}」。\n\n确认继续吗？`
      )
      if (!confirmed) return
    }

    if (!actualHouseholdName.trim()) return show('请填写新家庭户名称', 'err')

    try {
      const r = await api.splitHousehold(hhId, {
        split_year: Number(splitForm.split_year),
        split_date: splitForm.split_date || null,
        new_household_name: actualHouseholdName,
        member_ids: splitSelected,
        new_head_id: actualHeadId,
        new_land_area: splitForm.new_land_area ? Number(splitForm.new_land_area) : null,
        origin_land_area: splitForm.origin_land_area ? Number(splitForm.origin_land_area) : null,
        description: splitForm.description || `分户：${splitSelected.length}名成员独立组建「${actualHouseholdName}」`,
        evidence_type: splitForm.evidence_type || null,
        evidence_note: splitForm.evidence_note || null,
      })
      show(`✓ 分户成功，新户ID: ${r.new_household_id}`)
      setSplitOpen(false); setSplitStep(1); setSplitSelected([]); setSplitNewHead(null)
      refreshDetail(); if (leftTab === 'households') loadHouseholds()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 手动补录事件 ──
  const submitEvent = async () => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return
    if (!eventForm.description.trim()) return show('请填写事件描述', 'err')
    await api.addHouseholdEvent(hhId, { ...eventForm, event_year: Number(eventForm.event_year) })
    show('✓ 事件已记录'); setEventOpen(false); loadEvents()
  }

  // ── 撤销事件 ──
  const undoEvent = async (ev: HHEvent) => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return
    if (!confirm('确认撤销此操作？系统将恢复到操作前的状态。')) return
    try {
      await api.undoHouseholdEvent(hhId, ev.id)
      show('✓ 已撤销')
      loadEvents(); refreshDetail()
      const hd = await api.getHouseholdHistoryDates(hhId)
      setHistoryDates(hd.events)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 批量导入农户 ──
  const handleImport = async (rows: Record<string, unknown>[]) => {
    const toCreate: Record<string, unknown>[] = []
    const formatErrors: string[] = []
    rows.forEach((row, i) => {
      const name = String(row['real_name'] || row['姓名*'] || row['姓名'] || '').trim()
      const idCard = String(row['id_card'] || row['身份证号*'] || row['身份证号'] || '').trim()
      if (!name || !idCard) { formatErrors.push(`第${i + 2}行：姓名或身份证号为空`); return }
      const vn = String(row['village_name'] || row['所在村*'] || row['所在村'] || '').trim()
      const gn = String(row['group_no'] || row['所在组*'] || row['所在组'] || '').trim()
      if (!vn || !gn) { formatErrors.push(`第${i + 2}行 ${name}：请填写所在村和所在组`); return }
      const info = parseIdCardInfo(idCard)
      const statusMap: Record<string, number> = { '在册': 1, '注销': 2, '迁出': 3, '死亡': 4 }
      const rawStatus = String(row['farmer_status'] || row['状态'] || '').trim()
      toCreate.push({
        real_name: name, id_card: idCard,
        gender: info?.gender ?? (String(row['gender'] || row['性别'] || '').includes('女') ? 2 : 1),
        village_name: vn, group_no: gn,
        phone: String(row['phone'] || row['手机号'] || '').trim() || undefined,
        bank_card: String(row['bank_card'] || row['银行卡号'] || '').trim() || undefined,
        bank_name: String(row['bank_name'] || row['开户行'] || '').trim() || undefined,
        address: String(row['address'] || row['地址'] || '').trim() || undefined,
        land_area: Number(row['land_area'] || row['承包土地面积']) || undefined,
        farmer_status: statusMap[rawStatus] ?? 1,
      })
    })
    if (formatErrors.length > 0 && toCreate.length === 0) return { created: 0, skipped: 0, errors: formatErrors }
    const res = await api.batchImportFarmers(toCreate as unknown as Parameters<typeof api.batchImportFarmers>[0], importOverwrite)
    api.getVillageGroups().then(g => { setGroups(g); setVillages([...new Set(g.map(v => v.village_name))]) })
    const allErrors = [...formatErrors, ...(res.errors || [])]
    if (res.skipped > 0) allErrors.push(`已跳过 ${res.skipped} 条重复身份证（未开启覆盖）`)
    if (leftTab === 'farmers') loadFarmers()
    return { ...res, errors: allErrors }
  }

  const detectExcelColumns = async (columns: string[], sampleRows: Record<string, unknown>[]) => {
    try {
      const r = await fetch('/api/excel-templates/detect-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, sample_rows: sampleRows, business_type: 'FARMER' }),
      })
      const raw = await r.json()
      const cols = (raw.columns || []).map((d: Record<string, unknown>) => ({
        excel_column: d.excel_column,
        suggested_field: d.suggested_field,
        confidence: d.confidence ?? d.suggested_confidence ?? 0,
        alternatives: d.alternatives || [],
      }))
      return { columns: cols, recommended_templates: raw.recommended_templates || [] }
    } catch {
      return { columns: columns.map(c => ({ excel_column: c, suggested_field: null, confidence: 0, alternatives: [] as Array<{ field: string; confidence: number }> })), recommended_templates: [] as Array<{ field: string; confidence: number }> }
    }
  }

  const saveColumnMappingTemplate = async (data: Record<string, unknown>) => {
    const r = await fetch('/api/excel-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, business_type: 'FARMER' }),
    })
    const result = await r.json()
    api.getExcelTemplates('FARMER').then(setTemplates).catch(() => {})
    return result
  }

  // ── 导出 ──
  const exportCurrentList = async () => {
    if (leftTab === 'farmers') {
      const params: Record<string, string | number> = { page: 1, page_size: 5000 }
      if (search) params.search = search
      if (villageFilter) params.village_name = villageFilter
      const res = await api.getFarmers(params)
      const rows = res.items.map(f => ({
        '姓名': f.real_name,
        '身份证号': f.id_card_masked,
        '性别': f.gender === 1 ? '男' : '女',
        '所在村组': f.village_full_name,
        '手机号': f.phone_masked || '',
        '状态': FARMER_STATUS[f.farmer_status]?.label ?? '未知',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [12, 20, 6, 20, 14, 8].map(w => ({ wch: w }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '农户列表')
      const date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '')
      XLSX.writeFile(wb, `农户列表_${date}.xlsx`)
      show(`✓ 已导出 ${rows.length} 条记录`)
    } else {
      const params: Record<string, string | number> = { page: 1, page_size: 5000, year: yearFilter }
      if (search) params.search = search
      if (villageFilter) params.village_name = villageFilter
      const res = await api.getHouseholds(params)
      const rows = res.items.map(h => ({
        '户编码': h.household_code,
        '户名': h.household_name,
        '户主': h.head_name,
        '所在村组': h.village_full_name,
        '成员数': h.member_count,
        '承包面积': h.contracted_area || '',
        '已用面积': h.used_area || '',
        '状态': h.status === 1 ? '正常' : '注销',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [10, 14, 8, 14, 8, 10, 10, 8].map(w => ({ wch: w }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '家庭户列表')
      const date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '')
      XLSX.writeFile(wb, `家庭户列表_${date}.xlsx`)
      show(`✓ 已导出 ${rows.length} 条记录`)
    }
  }

  // ── 年份折叠 ──
  const toggleYear = (yr: number) => {
    setExpandedYears(prev => {
      const next = new Set(prev)
      if (next.has(yr)) next.delete(yr); else next.add(yr)
      return next
    })
  }

  // ═══════════════════════════════════════════════
  //  主渲染：两栏布局
  // ═══════════════════════════════════════════════
  return (
    <div className="flex gap-5">
      {/* ── 左侧：Tab + 列表 ── */}
      <div className="w-[32%] shrink-0 flex flex-col sticky top-[88px] self-start" style={{ maxHeight: 'calc(100vh - 104px)' }}>
        {/* Tab 切换 */}
        <div className="flex mb-4 bg-warm/50 rounded-card p-1.5 shadow-card">
          <button onClick={() => handleTabChange('households')}
            className={`flex-1 py-2.5 text-sm font-medium rounded-btn transition-all
              ${leftTab === 'households' ? 'bg-white text-primary shadow-card' : 'text-text-muted hover:text-text-primary hover:bg-warm/30'}`}>
            <Icon name="household" size={16} className="inline mr-1.5" />家庭户
          </button>
          <button onClick={() => handleTabChange('farmers')}
            className={`flex-1 py-2.5 text-sm font-medium rounded-btn transition-all
              ${leftTab === 'farmers' ? 'bg-white text-primary shadow-card' : 'text-text-muted hover:text-text-primary hover:bg-warm/30'}`}>
            <Icon name="person" size={16} className="inline mr-1.5" />农户
          </button>
        </div>

        {/* 工具栏 - 搜索和筛选 */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={leftTab === 'farmers' ? '搜索农户姓名或身份证…' : '搜索户名或户主…'}
            className="flex-1 min-w-32 border border-border rounded-btn px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 bg-white shadow-card transition-all" />
          <select value={villageFilter} onChange={e => { setVillageFilter(e.target.value); leftTab === 'farmers' ? setFarmerPage(1) : setHhPage(1) }}
            className="border border-border rounded-btn px-3 py-2.5 text-sm bg-white outline-none shadow-card focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all">
            <option value="">全部村庄</option>
            {villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {leftTab === 'households' && (
            <>
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setHhPage(1) }}
                className="border border-border rounded-btn px-3 py-2.5 text-sm bg-white outline-none shadow-card focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all">
                <option value="">全部状态</option>
                <option value="1">在册</option>
                <option value="2">注销</option>
                <option value="3">迁出</option>
              </select>
              <select value={confirmedFilter} onChange={e => { setConfirmedFilter(e.target.value); setHhPage(1) }}
                className="border border-border rounded-btn px-3 py-2.5 text-sm bg-white outline-none shadow-card focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all">
                <option value="">全部确认状态</option>
                <option value="1">✓ 已确认</option>
                <option value="0">✗ 未确认</option>
              </select>
            </>
          )}
        </div>

        {/* 工具栏 - 操作按钮 */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {leftTab === 'households' && !mergeMode && (
            <>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setCreateHhOpen(true)} className="px-3 py-2 text-sm bg-primary-500  rounded-btn hover:bg-primary/90 shadow-card hover:shadow-card-hover transition-all font-medium">
                  <Icon name="create" size={14} className="inline mr-1" />创建新家庭户
                </button>
                <button onClick={() => { setMergeMode(true); setMergeSelected([]); setMergeSelectedHouseholds([]); setBatchConfirmMode(false); setBatchSelected([]); setBatchSelectedHouseholds([]); setHhPage(1) }}
                  className="px-3 py-2 text-sm border border-orange-tag/30  bg-[#f7edd8] text-[#B8860B] rounded-btn hover:bg-orange-tag/10 shadow-card transition-all font-medium bg-orange-tag/5">
                  <Icon name="merge" size={14} className="inline mr-1" />合并家庭户
                </button>
                <button onClick={exportCurrentList} className="px-3 py-2 text-sm border border-border text-text-muted rounded-btn hover:bg-warm/30 shadow-card hover:shadow-card-hover transition-all font-medium">
                  <Icon name="export" size={14} className="inline mr-1" />导出
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => { setConfirmedAreaRows([]); setConfirmedAreaImportResult(null); setConfirmedAreaImportOpen(true) }}
                  className="px-3 py-2 text-sm border border-blue-200 text-blue-700 rounded-btn hover:bg-blue-50 shadow-card hover:shadow-card-hover transition-all font-medium">
                  <Icon name="upload" size={14} className="inline mr-1" />导入确权面积
                </button>
                <button onClick={() => { setBatchConfirmMode(true); setBatchSelected([]); setBatchSelectedHouseholds([]); setMergeMode(false); setMergeSelected([]); setMergeSelectedHouseholds([]) }}
                  className="px-3 py-2 text-sm border border-primary/20 text-primary bg-[#e3e7ec] rounded-btn hover:bg-primary/5 shadow-card hover:shadow-card-hover transition-all font-medium bg-primary/[0.02]">
                  <Icon name="confirm" size={14} className="inline mr-1" />批量确认
                </button>
                <button onClick={() => handleRefreshCache()} disabled={refreshingCache}
                  className="px-3 py-2 bg-[#edeaed]  hover:brightness-95 text-sm border-2 border-danger/30 text-danger bg-danger/5 rounded-btn hover:bg-danger/10 shadow-card transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-purple-700 ">
                  <Icon name="refresh" size={14} className="inline mr-1" />
                  {refreshingCache ? '刷新中…' : '刷新缓存'}
                </button>
                <button onClick={handleRecalcUnconfirmedArea} disabled={recalculatingArea}
                  className="px-3 py-2 text-sm border-2 border-orange-tag/30 text-[#B8860B] bg-orange-tag/5 rounded-btn hover:bg-orange-tag/10 shadow-card transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed font-semibold">
                  <Icon name="area" size={14} className="inline mr-1" />
                  {recalculatingArea ? '计算中…' : '重算未确认户承包面积'}
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer bg-warm/30  px-3 py-2 rounded-btn border border-border shadow-card hover:bg-warm/50 transition-all">
                <input type="checkbox" checked={overdrawnOnly} onChange={e => setOverdrawnOnly(e.target.checked)} className="w-4 h-4 text-primary rounded" />
                <span className="font-medium">仅看超领</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer bg-warm/30 px-3 py-2 rounded-btn border border-border shadow-card hover:bg-warm/50 transition-all">
                <input type="checkbox" checked={highSubsidyOnly} onChange={e => { setHighSubsidyOnly(e.target.checked); setHhPage(1) }} className="w-4 h-4 text-primary rounded" />
                <span className="font-medium">补贴≥4条</span>
              </label>
            </>
          )}
        </div>

        {/* 家庭户列表 - 标签说明 */}
        {leftTab === 'households' && !mergeMode && (
          <div className="bg-primary/5 border border-primary/10 rounded-card px-4 py-2.5 mb-3 flex items-center gap-3 text-sm">
            <Icon name="info" size={16} className="text-primary/60 shrink-0" />
            <span className="text-text-primary">
              <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-btn font-medium mr-2">
                <Icon name="confirm" size={12} />已确认
              </span>
              标签表示该家庭户信息已经通过人工确认核实
            </span>
          </div>
        )}
        {leftTab === 'households' && mergeMode && (
          <div className="flex items-center gap-2 w-full">
            <button onClick={() => { setMergeMode(false); clearMergeSelection() }}
              className="px-3 py-2 text-sm border border-border text-text-muted rounded-btn hover:bg-warm/30 transition-all">
              取消合并
            </button>
            <span className="text-sm text-orange-tag font-medium flex items-center gap-1">
              <Icon name="merge" size={14} />
              已选 {mergeSelectedHouseholds.length} 户
              {mergeSelectedHouseholds.length >= 2 && <span className="text-meta text-text-muted ml-1">（第1个为目标户）</span>}
            </span>
            <button onClick={handleMergeConfirm}
              disabled={mergeSelectedHouseholds.length < 2}
              className="ml-auto px-4 py-2 text-sm bg-primary  rounded-btn hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium">
              确认合并
            </button>
          </div>
        )}
        {/* 批量确认模式 */}
        {leftTab === 'households' && batchConfirmMode && (
          <div className="flex items-center gap-2 w-full">
            <button onClick={() => { setBatchConfirmMode(false); clearBatchSelection() }}
              className="px-3 py-2 text-sm border border-border text-text-muted rounded-btn hover:bg-warm/30 transition-all">
              取消批量确认
            </button>
            <span className="text-sm text-primary font-medium flex items-center gap-1">
              <Icon name="confirm" size={14} />
              已选 {batchSelectedHouseholds.length} 户
              <span className="text-meta text-text-muted ml-1">（仅确认未确认的家庭户）</span>
            </span>
            <button onClick={handleBatchConfirm}
              disabled={batchSelected.length === 0 || batchConfirmLoading}
              className="ml-auto px-4 py-2 text-sm bg-primary  rounded-btn hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium flex items-center gap-2">
              {batchConfirmLoading ? <><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>确认中...</> : '确认所选'}
            </button>
          </div>
        )}
        {leftTab === 'farmers' && (
          <>
            <button onClick={() => setCreateFarmerOpen(true)} className="px-4 py-2.5 text-sm bg-primary  rounded-btn hover:bg-primary/90 shadow-card hover:shadow-card-hover transition-all font-medium">
              <Icon name="create" size={14} className="inline mr-1" />新建农户
            </button>
            <div className="flex items-center gap-0 border border-border rounded-btn shadow-card overflow-hidden">
              <button onClick={() => setImportOpen(true)} className="px-4 py-2.5 text-sm text-text-primary hover:bg-warm/30 transition-all font-medium">
                <Icon name="import" size={14} className="inline mr-1" />导入农户
              </button>
              <label className={`flex items-center gap-1.5 px-3 py-2.5 text-meta cursor-pointer border-l border-border transition-colors select-none ${importOverwrite ? 'bg-orange-tag/10 text-[#B8860B]' : 'text-text-muted hover:bg-warm/30'}`}
                title="开启后，重复身份证的记录将被 Excel 中的数据覆盖更新">
                <input type="checkbox" checked={importOverwrite} onChange={e => setImportOverwrite(e.target.checked)} className="accent-orange-tag w-3 h-3" />
                覆盖重复
              </label>
            </div>
            <button onClick={exportCurrentList} className="px-4 py-2.5 text-sm border border-border text-text-muted rounded-btn hover:bg-warm/30 shadow-card hover:shadow-card-hover transition-all font-medium">
              <Icon name="export" size={14} className="inline mr-1" />导出
            </button>
          </>
        )}

        {/* 列表 */}
        <div className="flex-1 bg-warm-100 border border-border rounded-card overflow-hidden shadow-card flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto">
            {/* 农户列表 */}
            {leftTab === 'farmers' && (
              <FarmerList
                farmers={farmerList}
                loading={farmerLoading}
                selectedId={selectedFarmer?.id ?? null}
                onSelect={openFarmer}
              />
            )}

            {/* 家庭户列表 */}
            {leftTab === 'households' && (
              <HouseholdList
                households={hhList}
                loading={hhLoading}
                selectedId={detail?.id ?? null}
                mergeMode={mergeMode}
                batchConfirmMode={batchConfirmMode}
                mergeSelected={mergeSelected}
                batchSelected={batchSelected}
                mergeSelectedHouseholds={mergeSelectedHouseholds}
                onSelect={openDetail}
                onToggleMerge={toggleMergeHousehold}
                onToggleBatch={toggleBatchConfirm}
              />
            )}
          </div>

          {/* 分页 */}
          <div className="px-5 py-3 border-t border-border bg-warm/30 flex justify-between items-center text-meta text-text-muted shrink-0">
            <span className="font-medium">共{leftTab === 'farmers' ? farmerTotal : hhTotal}{leftTab === 'farmers' ? '人' : '户'}</span>
            <div className="flex gap-1 items-center">
              {leftTab === 'farmers' ? (
                <>
                  <button disabled={farmerPage <= 1} onClick={() => setFarmerPage(p => p - 1)} className="px-3 py-1.5 border border-border rounded-btn disabled:opacity-40 hover:bg-warm/30 transition-colors disabled:hover:bg-white">‹</button>
                  <span className="px-2 font-mono text-sm">{farmerPage}/{Math.max(1, Math.ceil(farmerTotal / 20))}</span>
                  <button disabled={farmerPage * 20 >= farmerTotal} onClick={() => setFarmerPage(p => p + 1)} className="px-3 py-1.5 border border-border rounded-btn disabled:opacity-40 hover:bg-warm/30 transition-colors disabled:hover:bg-white">›</button>
                </>
              ) : (
                <>
                  <button disabled={hhPage <= 1} onClick={() => setHhPage(p => p - 1)} className="px-3 py-1.5 border border-border rounded-btn disabled:opacity-40 hover:bg-warm/30 transition-colors disabled:hover:bg-white">‹</button>
                  <span className="px-2 font-mono text-sm">{hhPage}/{Math.max(1, Math.ceil(hhTotal / 20))}</span>
                  <button disabled={hhPage * 20 >= hhTotal} onClick={() => setHhPage(p => p + 1)} className="px-3 py-1.5 border border-border rounded-btn disabled:opacity-40 hover:bg-warm/30 transition-colors disabled:hover:bg-white">›</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* ── 右侧：详情面板 ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selectedFarmer ? (
          /* 选中农户：上半部分个人信息 + 下半部分家庭户信息 */
          <div className="flex-1 flex flex-col min-h-0">
            <FarmerDetailCard
              selectedFarmer={selectedFarmer}
              showAppSummary={true}
              appSummary={selectedFarmerHousehold?.app_summary}
              groups={groups}
              onUpdate={() => openFarmer(selectedFarmer!.id)}
            />
            {selectedFarmerHousehold && (
              <div className="flex gap-4 flex-1 min-h-0">
                <HistorySidebar
                  householdId={selectedFarmerHousehold.id}
                  historyEventId={historyEventId}
                  historyDates={historyDates}
                  expandedYears={expandedYears}
                  onExitHistory={exitHistory}
                  onToggleYear={toggleYear}
                  onLoadSnapshotAt={loadSnapshotAt}
                />
                <div className="flex-1 min-h-0">
                  <FarmerHouseholdDetail
                    selectedFarmerHousehold={selectedFarmerHousehold}
                    historyEventId={historyEventId}
                    snapshotData={snapshotData}
                    historyDates={historyDates}
                    historyLoading={historyLoading}
                    detailTab={detailTab}
                    setDetailTab={setDetailTab}
                    onExitHistory={exitHistory}
                    onLoadSnapshotAt={loadSnapshotAt}
                    selectedFarmerId={selectedFarmer?.id ?? null}
                    groups={groups}
                    onOpenMemberEdit={openMemberEdit}
                    onOpenFarmer={openFarmer}
                    onOpenMemberAdd={() => {
                      const v = groups.find(g => g.village_id === detail?.village_id)
                      const g = groups.find(g => g.village_id === detail?.village_id && g.group_no === detail?.group_no)
                      setMemberForm({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1', restricted_identity: '0', event_date: '', village_id: detail?.village_id ?? 0, group_no: detail?.group_no ?? 1, village_name: v?.village_name ?? '', group_name: g ? g.full_name.replace(g.village_name, '').replace('村', '') : `第${detail?.group_no ?? 1}组` })
                      setMemberAddOpen(true)
                    }}
                    onOpenMemberImport={() => setMemberImportOpen(true)}
                    onOpenEvent={() => setEventOpen(true)}
                    getHistoryDateByEventId={getHistoryDateByEventId}
                    memberForm={memberForm}
                    setMemberForm={setMemberForm}
                    memberEditTarget={memberEditTarget}
                  />
                </div>
              </div>
            )}
            {!selectedFarmerHousehold && (
              <div className="flex-1 bg-white border border-border rounded-card flex items-center justify-center text-text-muted/50 shadow-card">
                <div className="text-center">
                  <Icon name="household" size={40} className="mx-auto mb-3 text-border" />
                  <div className="text-sm">该农户暂未关联家庭户</div>
                </div>
              </div>
            )}
          </div>
        ) : detail ? (
          /* 选中家庭户：显示家庭户详情 */
          <div className="flex gap-4 flex-1 min-h-0">
            <HistorySidebar
              householdId={detail.id}
              historyEventId={historyEventId}
              historyDates={historyDates}
              expandedYears={expandedYears}
              onExitHistory={exitHistory}
              onToggleYear={toggleYear}
              onLoadSnapshotAt={loadSnapshotAt}
            />
            <div className="flex-1 min-h-0">
              <HouseholdDetailContent
                detail={detail}
                detailTab={detailTab}
                setDetailTab={setDetailTab}
                areaYear={areaYear}
                setAreaYear={setAreaYear}
                historyDate={getHistoryDateByEventId(historyEventId)}
                historyEventId={historyEventId}
                historyDates={historyDates}
                snapshotData={snapshotData}
                events={events}
                historyDateIsNull={historyEventId === null}
                onOpenMemberImport={() => setMemberImportOpen(true)}
                onOpenMemberAdd={() => {
                  const v = groups.find(g => g.village_id === detail?.village_id)
                  const g = groups.find(g => g.village_id === detail?.village_id && g.group_no === detail?.group_no)
                  setMemberForm({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1', restricted_identity: '0', event_date: '', village_id: detail?.village_id ?? 0, group_no: detail?.group_no ?? 1, village_name: v?.village_name ?? '', group_name: g ? g.full_name.replace(g.village_name, '').replace('村', '') : `第${detail?.group_no ?? 1}组` })
                  setMemberAddOpen(true)
                }}
                onOpenEvent={() => setEventOpen(true)}
                onOpenFarmer={openFarmer}
                onOpenMemberEdit={openMemberEdit}
                onRemoveMember={removeMember}
                onOpenEdit={() => { setEditForm({ household_name: detail.household_name, contract_area: String(detail.contracted_area || ''), village_id: detail.village_id || 0, group_no: detail.group_no || 1, address: detail.address || '', remark: detail.remark || '' }); setEditOpen(true) }}
                onOpenSplit={() => { setSplitOpen(true); setSplitStep(1); setSplitSelected([]); setSplitNewHead(null); setSplitForm({ household_name: '', split_year: String(new Date().getFullYear()), split_date: '', new_land_area: '', origin_land_area: String(detail.contracted_area || ''), description: '', evidence_type: '', evidence_note: '' }) }}
                canSplit={detail.members.filter(m => m.farmer_status === 1).length >= 2}
                onOpenManualConfirm={() => { setConfirmForm({ operator: '', remark: '' }); setManualConfirmOpen(true) }}
                onOpenCancelConfirm={() => { setConfirmForm({ operator: '', remark: '' }); setCancelConfirmOpen(true) }}
                onDelete={() => { setDeleteTarget(detail); setDeleteConfirmOpen(true) }}
                onRefreshCache={handleRefreshCache}
                refreshingCache={refreshingCache}
              />
            </div>
          </div>
        ) : (
          /* 未选中任何内容 */
          <div className="flex-1 bg-white border border-border rounded-card flex items-center justify-center shadow-card">
            <div className="text-center">
              <Icon name={leftTab === 'farmers' ? 'person' : 'household'} size={48} className="mx-auto mb-4 text-border" />
              <div className="text-base font-medium text-text-muted">请从左侧选择{leftTab === 'farmers' ? '农户' : '家庭户'}查看详情</div>
              <div className="text-sm text-text-muted/50 mt-2">支持搜索、筛选和批量操作</div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════ 弹窗 ═══════ */}

      {/* 新建家庭户 */}
      <CreateHhForm
        open={createHhOpen}
        groups={groups}
        createHhForm={createHhForm}
        setCreateHhForm={setCreateHhForm}
        onSubmit={submitCreateHh}
        onClose={() => setCreateHhOpen(false)}
      />

      {/* 新建农户 */}
      <CreateFarmerForm
        open={createFarmerOpen}
        villages={villages}
        createFarmerForm={createFarmerForm}
        setCreateFarmerForm={setCreateFarmerForm}
        onSubmit={submitCreateFarmer}
        onClose={() => setCreateFarmerOpen(false)}
      />

      {/* 合并家庭户确认 */}
      <MergeConfirmForm
        open={mergeConfirmOpen}
        mergeSelectedHouseholds={mergeSelectedHouseholds}
        mergeConfirmForm={mergeConfirmForm}
        setMergeConfirmForm={setMergeConfirmForm}
        onSubmit={confirmMerge}
        onClose={() => { setMergeConfirmOpen(false); setMergeMode(false); clearMergeSelection() }}
        loading={mergeLoading}
      />

      {/* 编辑家庭户 */}
      <EditHouseholdForm
        open={editOpen}
        editForm={editForm}
        groups={groups}
        onSubmit={submitEdit}
        onClose={() => setEditOpen(false)}
        setEditForm={setEditForm}
      />

      {/* 成员增改 */}
      <MemberForm
        open={memberAddOpen}
        memberEditTarget={memberEditTarget}
        memberForm={memberForm}
        setMemberForm={setMemberForm}
        groups={groups}
        onSubmit={submitMember}
        onClose={() => { setMemberAddOpen(false); setMemberEditTarget(null) }}
        showToast={show}
        setGroups={setGroups}
      />

      {/* 成员批量导入 */}
      {(detail || selectedFarmerHousehold) && (
        <MemberImport
          open={memberImportOpen}
          householdName={(detail || selectedFarmerHousehold)?.household_name || ''}
          onImport={handleMemberImport}
          onSuccess={refreshDetail}
          onClose={() => setMemberImportOpen(false)}
        />
      )}

      {/* 分户向导 */}
      {(detail || selectedFarmerHousehold) && (
        <SplitWizardForm
          open={splitOpen}
          splitStep={splitStep}
          splitSelected={splitSelected}
          splitNewHead={splitNewHead}
          splitForm={splitForm}
          members={(detail || selectedFarmerHousehold)?.members || []}
          householdName={(detail || selectedFarmerHousehold)?.household_name}
          setSplitStep={setSplitStep}
          setSplitSelected={setSplitSelected}
          setSplitNewHead={setSplitNewHead}
          setSplitForm={setSplitForm}
          onSubmit={submitSplit}
          onClose={() => setSplitOpen(false)}
        />
      )}

      {/* 补录事件 */}
      {(detail || selectedFarmerHousehold) && (
        <EventForm
          open={eventOpen}
          eventForm={eventForm}
          setEventForm={setEventForm}
          onSubmit={submitEvent}
          onClose={() => setEventOpen(false)}
        />
      )}

      {/* 人工确认弹窗 */}
      {manualConfirmOpen && detail && (
        <ConfirmForm
          open={manualConfirmOpen}
          title="人工确认家庭户信息"
          description={'确认后，该家庭户将标记为"已人工确认"，并记录历史快照。表示该家庭户的信息已经过人工核对无误。'}
          confirmForm={confirmForm}
          setConfirmForm={setConfirmForm}
          onSubmit={handleManualConfirm}
          onClose={() => setManualConfirmOpen(false)}
          submitText="确认"
          type="manual_confirm"
          detail={detail}
        />
      )}

      {/* 取消确认弹窗 */}
      {cancelConfirmOpen && detail && (
        <ConfirmForm
          open={cancelConfirmOpen}
          title="取消人工确认"
          description={'取消后，该家庭户的"已人工确认"标记将被移除。此操作也会记录在历史事件中。'}
          confirmForm={confirmForm}
          setConfirmForm={setConfirmForm}
          onSubmit={handleCancelConfirm}
          onClose={() => setCancelConfirmOpen(false)}
          submitText="确认取消"
          type="cancel_confirm"
          detail={detail}
        />
      )}

      {/* 确权面积批量导入 */}
      <ConfirmedAreaImport
        open={confirmedAreaImportOpen}
        confirmedAreaRows={confirmedAreaRows}
        setConfirmedAreaRows={setConfirmedAreaRows}
        confirmedAreaImportResult={confirmedAreaImportResult}
        confirmedAreaImporting={confirmedAreaImporting}
        onSubmit={submitConfirmedAreaImport}
        onClose={() => setConfirmedAreaImportOpen(false)}
      />

      {/* 删除家庭户确认 */}
      <DeleteConfirmForm
        open={deleteConfirmOpen}
        deleteTarget={deleteTarget}
        loading={deleteLoading}
        onSubmit={handleDeleteHousehold}
        onClose={() => setDeleteConfirmOpen(false)}
      />

      {/* 农户导入 */}
      <FarmerImport
        open={importOpen}
        templates={templates}
        importOverwrite={importOverwrite}
        onClose={() => setImportOpen(false)}
        onDetectColumns={detectExcelColumns}
        onSaveTemplate={saveColumnMappingTemplate}
        onImport={handleImport}
        onSuccess={() => leftTab === 'farmers' ? loadFarmers() : loadHouseholds()}
      />

      <Toast {...toast} />
    </div>
  )
}
