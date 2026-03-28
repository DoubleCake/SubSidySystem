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
import type { VillageGroup, HH, HHDetail, HHMember, HHEvent, HistoryDateEvent, SnapshotAtResponse, FarmerDetail, FarmerOut, SnapshotMember } from '../types'
import { FARMER_STATUS, PAY_STATUS, fmt, parseIdCardInfo, years } from '../utils'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import ExcelImport from '../components/ExcelImport'
import type { ExcelColumnTemplate } from '../types'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

// ── 样式常量 ──
const COLORS = {
  primary: {
    50: 'bg-emerald-50',
    100: 'bg-emerald-100',
    500: 'bg-emerald-500',
    600: 'bg-emerald-600',
    700: 'bg-emerald-700',
    text: 'text-emerald-600',
    textHover: 'hover:text-emerald-700',
    border: 'border-emerald-600',
    borderLight: 'border-emerald-200',
  },
  secondary: {
    50: 'bg-blue-50',
    500: 'bg-blue-500',
    600: 'bg-blue-600',
    text: 'text-blue-600',
    border: 'border-blue-600',
    borderLight: 'border-blue-200',
  },
  warning: {
    50: 'bg-amber-50',
    100: 'bg-amber-100',
    500: 'bg-amber-500',
    text: 'text-amber-600',
  },
  danger: {
    50: 'bg-red-50',
    500: 'bg-red-500',
    text: 'text-red-600',
    borderLight: 'border-red-200',
  },
  neutral: {
    50: 'bg-slate-50',
    100: 'bg-slate-100',
    200: 'bg-slate-200',
    text: 'text-slate-600',
    textMuted: 'text-slate-400',
    border: 'border-slate-200',
  }
}

// ── 事件类型配置 ──
const EVENT_TYPE_CFG: Record<string, { label: string; color: string; icon: string }> = {
  ORIGINAL:       { label: '原始数据',   color: 'bg-slate-100 text-slate-600',     icon: '📌' },
  FOUND:          { label: '建档登记',   color: 'bg-blue-100 text-blue-700',       icon: '📝' },
  MEMBER_ADD:     { label: '成员新增',   color: 'bg-emerald-100 text-emerald-700', icon: '➕' },
  MEMBER_REMOVE:  { label: '成员移出',   color: 'bg-amber-100 text-amber-700',     icon: '➖' },
  MEMBER_STATUS:  { label: '状态变更',   color: 'bg-slate-100 text-slate-600',     icon: '🔄' },
  HEAD_CHANGE:    { label: '户主变更',   color: 'bg-purple-100 text-purple-700',   icon: '👤' },
  SPLIT:          { label: '分户',       color: 'bg-orange-100 text-orange-700',   icon: '🔀' },
  MERGE:          { label: '合户',       color: 'bg-teal-100 text-teal-700',       icon: '🔗' },
  LAND_CHANGE:    { label: '土地变更',   color: 'bg-green-100 text-green-700',     icon: '🌾' },
  STATUS_CHANGE:  { label: '户籍变更',   color: 'bg-red-100 text-red-700',         icon: '📋' },
  VILLAGE_CHANGE: { label: '整户迁移',   color: 'bg-cyan-100 text-cyan-700',       icon: '🏠' },
  REMARK:         { label: '备注说明',   color: 'bg-slate-100 text-slate-500',     icon: '💬' },
}

const GENDER = (g: number) => g === 1 ? '男' : '女'
const calcAge = (birth?: string | null) => {
  if (!birth) return null
  const b = new Date(birth)
  const now = new Date()
  return now.getFullYear() - b.getFullYear() - (now < new Date(now.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
}

const FARMER_TEMPLATE_HEADERS = ['姓名*', '身份证号*', '所在村*', '所在组*', '手机号', '银行卡号', '开户行', '地址', '土地面积', '状态']
const FARMER_TEMPLATE_EXAMPLE = [
  { '姓名*': '张国强', '身份证号*': '510123196503154231', '所在村*': '红星村', '所在组*': '一组', '手机号': '13812340001', '银行卡号': '6222021234560001', '开户行': '农业银行红星支行', '地址': '红星村一组12号', '土地面积': 3.5, '状态': '在册' },
]

const FARMER_SYSTEM_FIELDS = [
  { field: 'real_name',     label: '姓名',     required: true,  type: 'string' },
  { field: 'id_card',       label: '身份证号', required: true,  type: 'id_card' },
  { field: 'village_name',  label: '所在村',   required: true,  type: 'string' },
  { field: 'group_no',      label: '所在组',   required: true,  type: 'string' },
  { field: 'phone',         label: '手机号',   required: false, type: 'phone' },
  { field: 'bank_card',     label: '银行卡号', required: false, type: 'string' },
  { field: 'bank_name',     label: '开户行',   required: false, type: 'string' },
  { field: 'address',       label: '地址',     required: false, type: 'string' },
  { field: 'land_area',     label: '土地面积', required: false, type: 'decimal' },
  { field: 'farmer_status', label: '状态',     required: false, type: 'status' },
]

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
  const yearFilter = new Date().getFullYear()

  // ── 户详情 ──
  const [detail, setDetail] = useState<HHDetail | null>(null)
  const detailYear = new Date().getFullYear()
  const [detailTab, setDetailTab] = useState<'members' | 'area' | 'subsidy'>('members')
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
  const [createHhForm, setCreateHhForm] = useState({ household_name: '', village_group_id: 0, land_area: '', address: '', remark: '' })

  // ── 合并家庭户（内嵌模式） ──
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<number[]>([])
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false)
  const [mergeConfirmForm, setMergeConfirmForm] = useState({ land_area: '', remark: '' })
  const [mergeLoading, setMergeLoading] = useState(false)

  // ── 新建农户 ──
  const [createFarmerOpen, setCreateFarmerOpen] = useState(false)
  const [createFarmerForm, setCreateFarmerForm] = useState({ real_name: '', id_card: '', gender: 1 as 1|2, phone: '', village_name: '', group_no: '', address: '', land_area: '', remark: '' })

  // ── 编辑家庭户 ──
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ household_name: '', land_area: '', village_id: 0, group_no: 1, address: '', remark: '' })

  // ── 成员管理 ──
  const [memberAddOpen, setMemberAddOpen] = useState(false)
  const [memberEditTarget, setMemberEditTarget] = useState<HHMember | null>(null)
  const [memberForm, setMemberForm] = useState({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1', event_date: '', village_id: 0, group_no: 1 })
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
  const [templates, setTemplates] = useState<ExcelColumnTemplate[]>([])

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
      const r = await api.getHouseholds(p)
      setHhList(r.items); setHhTotal(r.total)
    } finally { setHhLoading(false) }
  }, [hhPage, search, yearFilter, villageFilter, overdrawnOnly])

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
      // 同时加载所属家庭户信息
      if (f.household_id) {
        try {
          const hh = await api.getHouseholdDetail(f.household_id, detailYear)
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
    const d = await api.getHouseholdDetail(id, detailYear)
    setDetail(d); setDetailTab('members'); setEvents([]); setSelectedFarmer(null); setSelectedFarmerHousehold(null)
    setHistoryEventId(null); setSnapshotData(null)
    await loadHouseholdHistoryDates(id)
    if (!skipUrlUpdate) {
      updateUrl({ tab: 'households', farmerId: null, householdId: id })
    }
  }

  // ── 刷新户详情 ──
  const refreshDetail = async () => {
    if (detail) {
      const d = await api.getHouseholdDetail(detail.id, detailYear)
      setDetail(d)
    }
    if (selectedFarmer?.household_id) {
      try {
        const hh = await api.getHouseholdDetail(selectedFarmer.household_id, detailYear)
        setSelectedFarmerHousehold(hh)
      } catch {
        setSelectedFarmerHousehold(null)
      }
    }
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
        land_area: Number(createHhForm.land_area) || undefined,
        address: createHhForm.address || undefined,
        remark: createHhForm.remark || undefined,
      })
      show('✓ 家庭户创建成功')
      setCreateHhOpen(false)
      setCreateHhForm({ household_name: '', village_group_id: 0, land_area: '', address: '', remark: '' })
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
        land_area: createFarmerForm.land_area ? Number(createFarmerForm.land_area) : undefined,
        farmer_status: 1,
        remark: createFarmerForm.remark || undefined,
      } as Parameters<typeof api.createFarmer>[0])
      show('✓ 农户创建成功')
      setCreateFarmerOpen(false)
      setCreateFarmerForm({ real_name: '', id_card: '', gender: 1, phone: '', village_name: '', group_no: '', address: '', land_area: '', remark: '' })
      if (leftTab === 'farmers') loadFarmers()
      openFarmer(r.id, true)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 合并家庭户（内嵌模式） ──
  // 点击"确认合并"→弹出确认框，预填土地面积（取目标户已有值）
  const handleMergeConfirm = () => {
    if (mergeSelected.length < 2) return show('请至少选择 2 个家庭户', 'err')
    const target = hhList.find(h => h.id === mergeSelected[0])
    setMergeConfirmForm({ land_area: target?.contracted_area?.toString() || '', remark: '' })
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
      setMergeMode(false)
      setMergeSelected([])
      setMergeConfirmOpen(false)
      loadHouseholds()
    } catch (e: unknown) { show((e as Error).message, 'err') } finally {
      setMergeLoading(false)
    }
  }

  // ── 编辑家庭户 ──
  const submitEdit = async () => {
    const hhId = detail?.id ?? selectedFarmerHousehold?.id
    if (!hhId) return
    await api.updateHousehold(hhId, {
      household_name: editForm.household_name,
      land_area: Number(editForm.land_area) || undefined,
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
    setMemberForm({
      real_name: m.real_name, id_card: '', gender: String(m.gender),
      relation: m.relation || '成员', is_head: m.is_head === 1,
      phone: '', bank_card: '', bank_name: '', farmer_status: String(m.farmer_status),
      event_date: '',
      village_id: hh?.village_id ?? 0,
      group_no: hh?.group_no ?? 1,
    })
    setMemberAddOpen(true)
  }

  // ── 成员批量导入 ──
  // Excel列名 -> API字段名 映射
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
    if (!hhId || !splitNewHead || splitSelected.length === 0) return
    if (!splitForm.household_name.trim()) return show('请填写新家庭户名称', 'err')
    try {
      const r = await api.splitHousehold(hhId, {
        split_year: Number(splitForm.split_year),
        split_date: splitForm.split_date || null,
        new_household_name: splitForm.household_name,
        member_ids: splitSelected,
        new_head_id: splitNewHead,
        new_land_area: splitForm.new_land_area ? Number(splitForm.new_land_area) : null,
        origin_land_area: splitForm.origin_land_area ? Number(splitForm.origin_land_area) : null,
        description: splitForm.description || `分户：${splitSelected.length}名成员独立组建「${splitForm.household_name}」`,
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
        land_area: Number(row['land_area'] || row['土地面积']) || undefined,
        farmer_status: statusMap[rawStatus] ?? 1,
      })
    })
    if (formatErrors.length > 0 && toCreate.length === 0) return { created: 0, skipped: 0, errors: formatErrors }
    const res = await api.batchImportFarmers(toCreate as unknown as Parameters<typeof api.batchImportFarmers>[0])
    api.getVillageGroups().then(g => { setGroups(g); setVillages([...new Set(g.map(v => v.village_name))]) })
    const allErrors = [...formatErrors, ...(res.errors || [])]
    if (res.skipped > 0) allErrors.push(`已跳过 ${res.skipped} 条重复身份证记录`)
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
      return { columns: columns.map(c => ({ excel_column: c, suggested_field: null, confidence: 0, alternatives: [] as Array<{ field: string; confidence: number }> })) }
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
        '性别': GENDER(f.gender),
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

  // ── 共享弹窗（新建家庭户 / 导入农户）──
  const renderHouseholdModals = () => (
    <>
      <Modal open={createHhOpen} title="新建家庭户" onClose={() => setCreateHhOpen(false)} onConfirm={submitCreateHh}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">户名 *</label>
            <input value={createHhForm.household_name} onChange={e => setCreateHhForm(f => ({ ...f, household_name: e.target.value }))} placeholder="如：张三户"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">所在村组 *</label>
            <select value={createHhForm.village_group_id || ''} onChange={e => setCreateHhForm(f => ({ ...f, village_group_id: Number(e.target.value) }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">请选择</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">承包土地面积（亩）</label>
            <input type="number" step="0.01" value={createHhForm.land_area} onChange={e => setCreateHhForm(f => ({ ...f, land_area: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">地址</label>
            <input value={createHhForm.address} onChange={e => setCreateHhForm(f => ({ ...f, address: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">备注</label>
            <textarea rows={2} value={createHhForm.remark} onChange={e => setCreateHhForm(f => ({ ...f, remark: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
          </div>
        </div>
      </Modal>

      <ExcelImportWithMapping open={importOpen} onClose={() => setImportOpen(false)} title="农户信息导入"
        templateHeaders={FARMER_TEMPLATE_HEADERS} templateExample={FARMER_TEMPLATE_EXAMPLE}
        systemFields={FARMER_SYSTEM_FIELDS}
        templates={templates.map(t => ({
          id: t.id,
          template_name: t.template_name,
          column_mapping: t.column_mapping.map(m => ({
            excel_column: m.excel_column,
            system_field: m.system_field,
            required: m.required,
          })),
        }))}
        onDetectColumns={detectExcelColumns} onSaveTemplate={saveColumnMappingTemplate}
        onImport={handleImport} onSuccess={() => leftTab === 'farmers' ? loadFarmers() : loadHouseholds()} />

      {/* 新建农户 */}
      <Modal open={createFarmerOpen} title="新建农户" onClose={() => setCreateFarmerOpen(false)} onConfirm={submitCreateFarmer}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">姓名 *</label>
            <input value={createFarmerForm.real_name} onChange={e => setCreateFarmerForm(f => ({ ...f, real_name: e.target.value }))}
              placeholder="请输入姓名"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">身份证号 *</label>
            <input value={createFarmerForm.id_card} onChange={e => setCreateFarmerForm(f => ({ ...f, id_card: e.target.value }))}
              placeholder="18位身份证号"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">性别</label>
            <select value={createFarmerForm.gender} onChange={e => setCreateFarmerForm(f => ({ ...f, gender: Number(e.target.value) as 1|2 }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value={1}>男</option>
              <option value={2}>女</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">手机号</label>
            <input value={createFarmerForm.phone} onChange={e => setCreateFarmerForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="可选"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">所在村 *</label>
            <select value={createFarmerForm.village_name} onChange={e => setCreateFarmerForm(f => ({ ...f, village_name: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">请选择</option>
              {villages.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">所在组 *</label>
            <select value={createFarmerForm.group_no} onChange={e => setCreateFarmerForm(f => ({ ...f, group_no: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">请选择</option>
              {['一组','二组','三组','四组','五组','六组','七组','八组','九组','十组'].map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">承包土地面积（亩）</label>
            <input type="number" step="0.01" value={createFarmerForm.land_area} onChange={e => setCreateFarmerForm(f => ({ ...f, land_area: e.target.value }))}
              placeholder="可选"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">备注</label>
            <textarea rows={2} value={createFarmerForm.remark} onChange={e => setCreateFarmerForm(f => ({ ...f, remark: e.target.value }))}
              placeholder="可选"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
          </div>
        </div>
      </Modal>

      {/* 合并家庭户确认 */}
      <Modal open={mergeConfirmOpen} title="合并家庭户" onClose={() => { setMergeConfirmOpen(false); setMergeMode(false); setMergeSelected([]) }}
        onConfirm={confirmMerge} confirmText="确认合并">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-700 mb-2">确认将以下 <strong>{mergeSelected.length}</strong> 个家庭户合并：</p>
            <div className="space-y-1">
              {mergeSelected.map((hid, i) => {
                const h = hhList.find(hh => hh.id === hid)
                return h ? (
                  <div key={hid} className={`flex items-center gap-2 text-sm ${i === 0 ? 'text-emerald-700 font-medium' : 'text-stone-600'}`}>
                    {i === 0 && <span className="text-xs bg-emerald-600 text-white px-1.5 py-0.5 rounded">目标户</span>}
                    <span>{h.household_name}</span>
                    <span className="text-xs text-stone-400">({h.head_name || '无户主'} · {h.member_count}人 · {h.contracted_area > 0 ? `${h.contracted_area}亩` : '—'})</span>
                  </div>
                ) : null
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">备注</label>
            <textarea rows={2} value={mergeConfirmForm.remark} onChange={e => setMergeConfirmForm(f => ({ ...f, remark: e.target.value }))}
              placeholder="可选"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
          </div>
        </div>
      </Modal>
    </>
  )

  // ── 农户详情卡片（上半部分）──
  const renderFarmerDetail = () => {
    if (!selectedFarmer) return null
    const fd = selectedFarmer
    const apps = fd.applications || []
    const totalAmt = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
    const age = calcAge(fd.birth_date)

    return (
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md mb-4">
        <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 px-6 py-5 flex items-center gap-5">
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white shrink-0">
            {fd.real_name.slice(-1)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <span className="text-xl font-bold text-white">{fd.real_name}</span>
              <span className="text-emerald-200 text-sm">{GENDER(fd.gender)}</span>
              {age && <span className="text-emerald-200 text-sm">{age} 岁</span>}
              <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded">{FARMER_STATUS[fd.farmer_status]?.label ?? '未知'}</span>
              {fd.is_head ? <span className="text-xs bg-purple-500/80 text-white px-2 py-0.5 rounded">户主</span> : <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded">{fd.relation || '成员'}</span>}
            </div>
            <div className="text-emerald-200 text-sm">📍 {fd.village_full_name}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold font-mono text-white">¥{totalAmt.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</div>
            <div className="text-emerald-200 text-xs mt-0.5">累计获得补贴</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-0 divide-x divide-stone-100">
          <div className="p-5">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">个人信息</h3>
            <div className="space-y-3">
              {[
                ['姓名', fd.real_name],
                ['性别', GENDER(fd.gender)],
                ['年龄', age ? `${age} 岁` : '—'],
                ['身份证号', <span key="id" className="font-mono text-amber-600 text-xs select-all">{fd.id_card || fd.id_card_masked}</span>],
                ['手机号', <span key="ph" className="font-mono text-xs">{fd.phone || fd.phone_masked || '—'}</span>],
                ['所在村组', fd.village_full_name],
              ].map(([k, v], i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-stone-400 w-20 shrink-0">{k}</span>
                  <span className="text-sm text-stone-700">{v as React.ReactNode}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-5">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">银行 & 其他</h3>
            <div className="space-y-3">
              {[
                ['银行卡号', <span key="bc" className="font-mono text-xs text-amber-600 select-all">{fd.bank_card || fd.bank_card_masked || '—'}</span>],
                ['开户行', fd.bank_name || '—'],
                ['农户状态', <Tag key="st" label={FARMER_STATUS[fd.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[fd.farmer_status]?.color as 'green'} />],
                ['备注', fd.remark || '—'],
                ['录入时间', fd.created_at ? fd.created_at.slice(0, 10) : '—'],
              ].map(([k, v], i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-stone-400 w-20 shrink-0">{k}</span>
                  <span className="text-sm text-stone-700">{v as React.ReactNode}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* 补贴记录 */}
        {apps.length > 0 && (
          <div className="border-t border-stone-200">
            <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
              <span className="text-sm font-medium text-stone-700">补贴记录 ({apps.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr className="bg-stone-50 border-b border-stone-200">
                  {['年度', '补贴项目', '面积', '申请金额', '实发金额', '状态'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {apps.map(a => (
                    <tr key={a.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                      <td className="px-4 py-2 text-sm font-bold text-emerald-600">{a.apply_year}</td>
                      <td className="px-4 py-2 text-sm">{a.subsidy_name}</td>
                      <td className="px-4 py-2 text-sm font-mono">{a.apply_area ? `${a.apply_area}亩` : '—'}</td>
                      <td className="px-4 py-2 text-sm font-mono text-stone-500">{fmt(a.apply_amount)}</td>
                      <td className="px-4 py-2 text-sm font-mono font-bold" style={{ color: a.actual_amount ? '#059669' : '#d97706' }}>
                        {a.actual_amount ? fmt(a.actual_amount) : '待发放'}
                      </td>
                      <td className="px-4 py-2"><Tag label={PAY_STATUS[a.pay_status]?.label} color={PAY_STATUS[a.pay_status]?.color as 'green'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-100 flex justify-end gap-6 text-sm">
              <span className="text-stone-500">合计 {apps.length} 笔</span>
              <span className="font-bold font-mono text-emerald-700">¥{totalAmt.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── 家庭户详情卡片（下半部分，从属于农户）──
  const renderFarmerHouseholdDetail = () => {
    if (!selectedFarmerHousehold) return null

    const hh = selectedFarmerHousehold
    const appsByYear: Record<number, typeof hh.app_summary> = {}
    hh.app_summary.forEach(a => {
      if (!appsByYear[a.apply_year]) appsByYear[a.apply_year] = []
      appsByYear[a.apply_year].push(a)
    })
    const displayMembers = historyEventId !== null && snapshotData?.snapshot ? snapshotData.snapshot.members : hh.members
    const areaUsage = historyEventId !== null && snapshotData?.snapshot
      ? { contracted_area: snapshotData.snapshot.land_area, trust_out_area: 0, trust_in_area: 0, cultivable_area: snapshotData.snapshot.land_area, used_area: 0, remaining_area: snapshotData.snapshot.land_area, is_overdrawn: false, overdraw_amount: 0, has_trust_data: false, subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[] }
      : hh.area_usage

    return (
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md">
        {/* 历史模式提示 */}
        {historyEventId !== null && (
          <div className="bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center gap-3 shrink-0">
            <span className="text-amber-600 text-sm">⏳</span>
            <span className="text-sm text-amber-700 font-medium">正在查看 <b>{getHistoryDateByEventId(historyEventId)}</b> 历史快照</span>
            {historyLoading && <span className="text-xs text-amber-500">加载中…</span>}
            <button onClick={exitHistory} className="ml-auto text-xs text-amber-600 hover:text-amber-800 underline">返回当前</button>
          </div>
        )}

        {/* 顶部卡片 */}
        <div className="bg-gradient-to-r from-emerald-800 to-emerald-700 px-5 py-3.5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-lg font-bold text-white shrink-0">🏠</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-base font-bold text-white">{hh.household_name}</span>
              <span className="text-emerald-300 text-xs font-mono">{hh.household_code}</span>
              {areaUsage?.is_overdrawn && <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">⚠️ 超领</span>}
              {historyEventId !== null && <span className="text-xs bg-amber-500/80 text-white px-1.5 py-0.5 rounded">⏳ 快照</span>}
            </div>
            <div className="text-emerald-200 text-xs">📍 {hh.village_full_name}
              {hh.address && <span className="ml-1 text-emerald-300">{hh.address}</span>}
            </div>
          </div>
          <div className="text-right shrink-0 mr-2">
            <div className="text-lg font-bold font-mono text-white">
              {historyEventId !== null && snapshotData?.snapshot
                ? (snapshotData.snapshot.land_area > 0 ? `${snapshotData.snapshot.land_area}亩` : '未设置')
                : (hh.contracted_area > 0 ? `${hh.contracted_area}亩` : '未设置')}
            </div>
            <div className="text-emerald-300 text-xs">承包面积</div>
          </div>
        </div>

        {/* 快照备注信息 */}
        {historyEventId !== null && (() => {
          const currentEvent = historyDates.find(e => e.event_id === historyEventId)
          if (currentEvent?.description) {
            const cfg = EVENT_TYPE_CFG[currentEvent.event_type] || EVENT_TYPE_CFG.REMARK
            return (
              <div className="bg-stone-50 border-b border-stone-200 px-5 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-lg shrink-0">{cfg.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-stone-500">{currentEvent.date || `${currentEvent.event_year}年`}</span>
                    </div>
                    <p className="text-sm text-stone-700">{currentEvent.description}</p>
                  </div>
                </div>
              </div>
            )
          }
          return null
        })()}

        {/* Tab 栏 */}
        <div className="flex border-b border-stone-200 bg-stone-50 items-center">
          {([
            { id: 'members', label: `👥 成员 (${displayMembers.length})` },
            { id: 'area', label: '📐 面积' },
            { id: 'subsidy', label: `💰 补贴 (${hh.app_summary.length})` },
          ] as { id: typeof detailTab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${detailTab === t.id ? 'border-emerald-600 text-emerald-700 bg-white' : 'border-transparent text-stone-500 hover:text-stone-700'}`}>
              {t.label}
            </button>
          ))}
          {historyEventId === null && (
            <div className="ml-auto px-2 flex gap-1.5">
              {detailTab === 'members' && (
                <>
                  <button onClick={() => setMemberImportOpen(true)} className="text-xs border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-lg hover:bg-emerald-50 transition-colors">↑ 批量导入</button>
                  <button onClick={() => { setMemberEditTarget(null); setMemberForm({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1', event_date: '', village_id: detail?.village_id ?? 0, group_no: detail?.group_no ?? 1 }); setMemberAddOpen(true) }}
                    className="text-xs bg-emerald-700 text-white px-2.5 py-1 rounded-lg hover:bg-emerald-600 transition-colors">＋ 成员</button>
                  <button onClick={() => setEventOpen(true)} className="text-xs border border-stone-200 text-stone-600 px-2.5 py-1 rounded-lg hover:bg-stone-50 transition-colors">＋ 补录</button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Tab 内容 */}
        <div className="max-h-80 overflow-y-auto">
          {/* 成员 */}
          {detailTab === 'members' && (
            <div className="p-4 grid gap-2">
              {displayMembers.length === 0 && <div className="text-center py-8 text-stone-300 text-sm">暂无成员记录</div>}
              {displayMembers.map(m => (
                <div key={m.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors
                  ${m.is_head ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50'}
                  ${m.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                    ${m.is_head ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
                    {m.real_name.slice(-1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-stone-800">{m.real_name}</span>
                      {m.is_head === 1 && <Tag label="户主" color="green" />}
                      {m.relation && <Tag label={m.relation} color="gray" />}
                      {m.farmer_status !== 1 && <Tag label={FARMER_STATUS[m.farmer_status]?.label ?? '异常'} color="red" />}
                    </div>
                    <div className="text-xs text-stone-400 mt-0.5">
                      {m.gender === 1 ? '男' : '女'}
                      {m.phone_masked && <span className="ml-2">{m.phone_masked}</span>}
                      <span className="ml-2 font-mono">{m.id_card_masked}</span>
                    </div>
                  </div>
                  {historyEventId === null && (
                    <div className="flex gap-1.5 shrink-0">
                      {selectedFarmer?.id !== m.id && (
                        <button onClick={() => openFarmer(m.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors">查看</button>
                      )}
                      <button onClick={() => openMemberEdit(m)} className="text-xs border border-stone-200 text-stone-500 px-2 py-1 rounded-lg hover:border-stone-300 transition-colors">编辑</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 面积 */}
          {detailTab === 'area' && areaUsage && (
            <div className="p-4">
              {/* 流转信息提示 */}
              {(Number(areaUsage.trust_out_area ?? 0) > 0 || Number(areaUsage.trust_in_area ?? 0) > 0) && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-xs text-blue-700">
                  流出 <span className="font-mono font-bold">{areaUsage.trust_out_area?.toFixed(2) ?? 0}</span> 亩
                  · 流入 <span className="font-mono font-bold">{areaUsage.trust_in_area?.toFixed(2) ?? 0}</span> 亩
                  · 可耕种 = 承包 - 流出 + 流入
                  = <span className="font-mono font-bold">{areaUsage.cultivable_area?.toFixed(2) ?? areaUsage.contracted_area}</span> 亩
                </div>
              )}

              {/* 承包面积总览 */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 text-center shadow-sm">
                  <div className="text-lg font-bold font-mono text-stone-700">{areaUsage.contracted_area} 亩</div>
                  <div className="text-xs text-stone-400 mt-1">承包面积</div>
                </div>
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 text-center shadow-sm">
                  <div className={`text-lg font-bold font-mono ${areaUsage.is_overdrawn ? 'text-red-500' : 'text-emerald-600'}`}>
                    {areaUsage.cultivable_area !== undefined ? `${areaUsage.cultivable_area.toFixed(2)}` : areaUsage.contracted_area} 亩
                  </div>
                  <div className="text-xs text-stone-400 mt-1">可耕种面积</div>
                </div>
              </div>

              {/* 按季节分组展示 */}
              {areaUsage.season_breakdown ? (
                <div className="space-y-4">
                  {Object.entries(areaUsage.season_breakdown).map(([season, usage]) => {
                    const pct = areaUsage.contracted_area > 0
                      ? Math.round(usage.used_area / areaUsage.contracted_area * 100)
                      : 0
                    return (
                      <div key={season} className="border border-stone-200 rounded-xl overflow-hidden shadow-sm">
                        {/* 季节标题栏 */}
                        <div className={`flex items-center justify-between px-3 py-2 ${usage.is_overdrawn ? 'bg-red-50' : 'bg-stone-50'}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${usage.is_overdrawn ? 'text-red-600' : 'text-stone-700'}`}>
                              {season}
                            </span>
                            {usage.is_overdrawn && (
                              <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">超领 {usage.overdraw_amount.toFixed(2)} 亩</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className={`text-sm font-mono font-bold ${usage.is_overdrawn ? 'text-red-500' : 'text-emerald-600'}`}>
                              {usage.used_area.toFixed(2)} 亩
                            </span>
                            <span className="text-xs text-stone-400"> / {areaUsage.contracted_area} 亩</span>
                          </div>
                        </div>

                        {/* 季节进度条 */}
                        <div className="px-3 pt-1.5 pb-2">
                          <div className="bg-stone-100 rounded-full h-2.5 overflow-hidden mb-1.5">
                            <div
                              className={`h-full rounded-full transition-all ${usage.is_overdrawn ? 'bg-red-400' : 'bg-emerald-400'}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-stone-400">
                            <span>剩余 {Math.max(0, usage.remaining_area).toFixed(2)} 亩</span>
                            <span>{pct}%</span>
                          </div>
                        </div>

                        {/* 季节内补贴明细 */}
                        {usage.subsidies?.length > 0 && (
                          <div className="border-t border-stone-100">
                            {usage.subsidies.map((s, i) => (
                              <div key={i} className="flex justify-between items-center px-3 py-1.5 border-b border-stone-50 last:border-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-stone-400">{s.apply_year}</span>
                                  <span className="text-sm text-stone-600">{s.subsidy_name}</span>
                                </div>
                                <span className="text-sm font-mono text-amber-600">{s.used_area.toFixed(2)} 亩</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* 降级：旧接口无 season_breakdown 时显示原有结构 */
                <>
                  {areaUsage.contracted_area > 0 && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-stone-400 mb-1.5">
                        <span>面积使用率</span>
                        <span>{Math.round(areaUsage.used_area / (areaUsage.cultivable_area ?? areaUsage.contracted_area) * 100)}%</span>
                      </div>
                      <div className="bg-stone-100 rounded-full h-3 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${areaUsage.is_overdrawn ? 'bg-red-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, Math.round(areaUsage.used_area / (areaUsage.cultivable_area ?? areaUsage.contracted_area) * 100))}%` }} />
                      </div>
                    </div>
                  )}
                  {areaUsage.subsidy_breakdown?.length > 0 && (
                    <div>
                      <p className="text-xs text-stone-400 mb-2">各项补贴占用明细：</p>
                      <div className="space-y-2">
                        {areaUsage.subsidy_breakdown.map((b, i) => (
                          <div key={i} className="flex justify-between items-center bg-white border border-stone-200 rounded-lg px-3 py-2 shadow-sm">
                            <span className="text-sm">{b.subsidy_name}</span>
                            <span className="text-sm font-mono font-bold text-amber-600">{b.apply_area.toFixed(2)}亩</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 补贴 */}
          {detailTab === 'subsidy' && (
            <div>
              {Object.keys(appsByYear).length === 0 && <div className="py-10 text-center text-stone-300 text-sm">暂无补贴记录</div>}
              {Object.entries(appsByYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yr, apps]) => (
                <div key={yr}>
                  <div className="px-5 py-2 bg-stone-50 border-b border-stone-100 text-xs font-bold text-stone-500">
                    {yr}年度 · {apps.length}条 · 合计 ¥{apps.reduce((s, a) => s + (a.actual_amount || 0), 0).toFixed(2)}
                  </div>
                  {apps.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-stone-50 hover:bg-stone-50 transition-colors">
                      <span className="text-sm text-stone-500 w-16 shrink-0">{a.farmer_name}</span>
                      <span className="text-sm flex-1">{a.subsidy_name}</span>
                      {a.apply_area && <span className="text-xs text-stone-400 font-mono">{a.apply_area}亩</span>}
                      <span className="text-sm font-mono font-bold text-emerald-700">{a.actual_amount ? fmt(a.actual_amount) : '—'}</span>
                      <Tag label={PAY_STATUS[a.pay_status]?.label || '—'} color={PAY_STATUS[a.pay_status]?.color as 'green'} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    )
  }

  // ── 历史记录侧边栏 ──
  const renderHistorySidebar = (householdId?: number) => {
    const hhId = householdId ?? detail?.id ?? selectedFarmerHousehold?.id
    return (
      <div className="w-48 shrink-0">
        <div className="bg-white border border-stone-200 rounded-xl shadow-md">
          <div className="px-3 py-2 border-b border-stone-100 bg-stone-50">
            <div className="text-xs font-semibold text-stone-600">历史记录</div>
          </div>
          <div className="py-2 px-2 space-y-1 max-h-[50vh] overflow-y-auto">
            <button onClick={exitHistory}
              className={`w-full py-2.5 rounded-lg text-xs font-medium transition-all text-left px-3
                ${historyEventId === null ? 'bg-emerald-600 text-white shadow-sm' : 'text-stone-500 hover:bg-stone-100'}`}>
              当前
            </button>
            {(() => {
              const regularEvents = historyDates.filter(ev => ev.event_type !== 'ORIGINAL')
              const originalEntry = historyDates.find(ev => ev.event_type === 'ORIGINAL')
              const byYear: Record<number, HistoryDateEvent[]> = {}
              regularEvents.forEach(ev => {
                if (!byYear[ev.event_year]) byYear[ev.event_year] = []
                byYear[ev.event_year].push(ev)
              })
              return (
                <>
                  {Object.entries(byYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yrStr, evts]) => {
                    const yr = Number(yrStr)
                    const expanded = expandedYears.has(yr)
                    return (
                      <div key={yr}>
                        <button onClick={() => toggleYear(yr)}
                          className="w-full py-2 px-3 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 flex items-center gap-1.5 transition-colors">
                          <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
                          {yr}年
                          <span className="ml-auto text-[11px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">{evts.length}</span>
                        </button>
                        {expanded && (
                          <div className="ml-4 space-y-1 border-l-2 border-stone-100 pl-2 mt-1">
                            {evts.map(ev => {
                              const cfg = EVENT_TYPE_CFG[ev.event_type] || EVENT_TYPE_CFG.REMARK
                              return (
                                <button key={ev.event_id} onClick={() => loadSnapshotAt(ev.date, hhId, ev.event_id)}
                                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all
                                    ${historyEventId === ev.event_id ? 'bg-amber-100 text-amber-800 font-medium shadow-sm' : 'text-stone-500 hover:bg-amber-50 hover:text-amber-800'}`}>
                                  <div className="flex items-center gap-1.5">
                                    <span>{cfg.icon}</span>
                                    <span>{ev.date?.slice(5) || ev.event_year}</span>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {originalEntry && (
                    <>
                      <div className="my-2 mx-2 border-t border-dashed border-stone-200" />
                      <button onClick={() => loadSnapshotAt(originalEntry.date, hhId, originalEntry.event_id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-all
                          ${historyEventId === originalEntry.event_id ? 'bg-blue-100 text-blue-800 font-medium shadow-sm' : 'text-stone-500 hover:bg-blue-50 hover:text-blue-800'}`}>
                        <span className="mr-1.5">{EVENT_TYPE_CFG.ORIGINAL.icon}</span>
                        初始状态
                      </button>
                    </>
                  )}
                </>
              )
            })()}
            {historyDates.length === 0 && (
              <div className="text-center py-5 text-xs text-stone-300">暂无变更记录</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  //  主渲染：两栏布局
  // ═══════════════════════════════════════════════
  return (
    <div className="flex gap-5 h-[calc(100vh-140px)]">
      {/* ── 左侧：Tab + 列表 ── */}
      <div className="w-[32%] shrink-0 flex flex-col">
        {/* Tab 切换 */}
        <div className="flex mb-4 bg-stone-100 rounded-xl p-1.5 shadow-sm">
          <button onClick={() => handleTabChange('households')}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all
              ${leftTab === 'households' ? 'bg-white text-emerald-700 shadow-md' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50/50'}`}>
            <span className="mr-1.5">🏠</span>家庭户
          </button>
          <button onClick={() => handleTabChange('farmers')}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all
              ${leftTab === 'farmers' ? 'bg-white text-emerald-700 shadow-md' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50/50'}`}>
            <span className="mr-1.5">👤</span>农户
          </button>
        </div>

        {/* 工具栏 - 搜索和筛选 */}
        <div className="flex gap-2 mb-3">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={leftTab === 'farmers' ? '搜索农户姓名或身份证…' : '搜索户名或户主…'}
            className="flex-1 min-w-32 border border-stone-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 bg-white shadow-sm transition-all" />
          <select value={villageFilter} onChange={e => { setVillageFilter(e.target.value); leftTab === 'farmers' ? setFarmerPage(1) : setHhPage(1) }}
            className="border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-white outline-none shadow-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all">
            <option value="">全部村庄</option>
            {villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        {/* 工具栏 - 操作按钮 */}
        <div className="flex gap-2 mb-4 flex-wrap">
                    {leftTab === 'households' && !mergeMode && (
            <>
              <button onClick={() => setCreateHhOpen(true)} className="px-4 py-2.5 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600 shadow-sm hover:shadow transition-all font-medium">
                <span className="mr-1">＋</span>创建新家庭户
              </button>
              <button onClick={() => { setMergeMode(true); setMergeSelected([]) }}
                className="px-4 py-2.5 text-sm border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 shadow-sm transition-all font-medium bg-amber-50">
                <span className="mr-1">⊞</span>合并家庭户
              </button>
              <button onClick={exportCurrentList} className="px-4 py-2.5 text-sm border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-50 shadow-sm hover:shadow transition-all font-medium">
                <span className="mr-1">⬇</span>导出
              </button>
              <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer bg-stone-50 px-3 py-2 rounded-lg border border-stone-200 shadow-sm hover:bg-stone-100 transition-all">
                <input type="checkbox" checked={overdrawnOnly} onChange={e => setOverdrawnOnly(e.target.checked)} className="w-4 h-4 text-emerald-600 rounded" />
                <span className="font-medium">仅看超领</span>
              </label>
            </>
          )}
          {leftTab === 'households' && mergeMode && (
            <div className="flex items-center gap-2 w-full">
              <button onClick={() => { setMergeMode(false); setMergeSelected([]) }}
                className="px-3 py-2 text-sm border border-stone-300 text-stone-500 rounded-lg hover:bg-stone-50 transition-all">
                取消合并
              </button>
              <span className="text-sm text-amber-700 font-medium">
                已选 {mergeSelected.length} 户
                {mergeSelected.length >= 2 && <span className="text-xs text-stone-400 ml-1">（第1个为目标户）</span>}
              </span>
              <button onClick={handleMergeConfirm}
                disabled={mergeSelected.length < 2}
                className="ml-auto px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium">
                确认合并
              </button>
            </div>
          )}          {leftTab === 'farmers' && (
            <>
              <button onClick={() => setCreateFarmerOpen(true)} className="px-4 py-2.5 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600 shadow-sm hover:shadow transition-all font-medium">
                <span className="mr-1">＋</span>新建农户
              </button>
              <button onClick={() => setImportOpen(true)} className="px-4 py-2.5 text-sm border border-stone-200 text-stone-700 rounded-lg hover:bg-stone-50 shadow-sm hover:shadow transition-all font-medium">
                <span className="mr-1">↑</span>导入农户
              </button>
              <button onClick={exportCurrentList} className="px-4 py-2.5 text-sm border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-50 shadow-sm hover:shadow transition-all font-medium">
                <span className="mr-1">⬇</span>导出
              </button>
            </>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto">
            {/* 农户列表 */}
            {leftTab === 'farmers' && (
              <>
                {farmerLoading && <div className="text-center py-12 text-stone-300">加载中…</div>}
                {!farmerLoading && farmerList.length === 0 && <div className="text-center py-12 text-stone-300 text-sm">暂无数据</div>}
                {farmerList.map(f => (
                  <div key={f.id}
                    onClick={() => openFarmer(f.id)}
                    className={`px-5 py-4 border-b border-stone-100 cursor-pointer transition-all hover:bg-stone-50
                      ${selectedFarmer?.id === f.id ? 'bg-emerald-50 border-l-4 border-l-emerald-600 shadow-inner' : ''}`}>
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="font-semibold text-base text-stone-800">{f.real_name}</span>
                      {f.is_head === 1 && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">户主</span>}
                      <Tag label={FARMER_STATUS[f.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[f.farmer_status]?.color as 'green'} />
                    </div>
                    <div className="flex items-center gap-4 text-xs text-stone-400">
                      <span className="font-mono">{f.id_card_masked}</span>
                      <span className="bg-stone-100 px-2 py-0.5 rounded">{GENDER(f.gender)}</span>
                      <span className="ml-auto truncate max-w-[180px]">{f.village_full_name}</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* 家庭户列表 */}
            {leftTab === 'households' && (
              <>
                {hhLoading && <div className="text-center py-12 text-stone-300">加载中…</div>}
                {!hhLoading && hhList.length === 0 && <div className="text-center py-12 text-stone-300 text-sm">暂无数据</div>}
                {hhList.map(h => {
                  const isSelected = mergeSelected.includes(h.id)
                  if (mergeMode) {
                    return (
                      <div key={h.id}
                        onClick={() => setMergeSelected(isSelected ? mergeSelected.filter(id => id !== h.id) : [...mergeSelected, h.id])}
                        className={`px-5 py-4 border-b border-stone-100 cursor-pointer transition-all
                          ${isSelected ? 'border-l-4 border-l-amber-500 bg-amber-50' : 'hover:bg-stone-50'}
                          ${h.is_overdrawn && !isSelected ? 'bg-red-50/40' : ''}`}>
                        <div className="flex items-center gap-3">
                          <input type="checkbox" checked={isSelected} onChange={() => setMergeSelected(isSelected ? mergeSelected.filter(id => id !== h.id) : [...mergeSelected, h.id])}
                            className="w-4 h-4 text-amber-600 rounded" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 mb-1.5">
                              <span className="font-semibold text-base text-stone-800">{h.household_name}</span>
                              <span className="text-xs font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">{h.household_code}</span>
                              {h.is_overdrawn && <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded-full">⚠️超领</span>}
                            </div>
                            <div className="flex items-center gap-4 text-xs text-stone-400">
                              <span>{h.head_name ? `户主:${h.head_name}` : '无户主'}</span>
                              <span className="bg-stone-100 px-2 py-0.5 rounded">{h.member_count}人</span>
                              <span>{h.contracted_area > 0 ? `${h.contracted_area}亩` : '—'}</span>
                              <span className="ml-auto truncate max-w-[180px]">{h.village_full_name}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={h.id}
                      onClick={() => openDetail(h.id)}
                      className={`px-5 py-4 border-b border-stone-100 cursor-pointer transition-all hover:bg-stone-50
                        ${detail?.id === h.id ? 'bg-emerald-50 border-l-4 border-l-emerald-600 shadow-inner' : ''}
                        ${h.is_overdrawn ? 'bg-red-50/40' : ''}`}>
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <span className="font-semibold text-base text-stone-800">{h.household_name}</span>
                        <span className="text-xs font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">{h.household_code}</span>
                        {h.is_overdrawn && <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded-full">⚠️超领</span>}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-stone-400">
                        <span>{h.head_name ? `户主:${h.head_name}` : '无户主'}</span>
                        <span className="bg-stone-100 px-2 py-0.5 rounded">{h.member_count}人</span>
                        <span>{h.contracted_area > 0 ? `${h.contracted_area}亩` : '—'}</span>
                        <span className="ml-auto truncate max-w-[180px]">{h.village_full_name}</span>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>

          {/* 分页 */}
          <div className="px-5 py-3 border-t border-stone-100 bg-stone-50 flex justify-between items-center text-xs text-stone-500 shrink-0">
            <span className="font-medium">共{leftTab === 'farmers' ? farmerTotal : hhTotal}{leftTab === 'farmers' ? '人' : '户'}</span>
            <div className="flex gap-1 items-center">
              {leftTab === 'farmers' ? (
                <>
                  <button disabled={farmerPage <= 1} onClick={() => setFarmerPage(p => p - 1)} className="px-3 py-1.5 border border-stone-200 rounded-lg disabled:opacity-40 hover:bg-stone-100 transition-colors disabled:hover:bg-white">‹</button>
                  <span className="px-2 font-mono text-sm">{farmerPage}/{Math.max(1, Math.ceil(farmerTotal / 20))}</span>
                  <button disabled={farmerPage * 20 >= farmerTotal} onClick={() => setFarmerPage(p => p + 1)} className="px-3 py-1.5 border border-stone-200 rounded-lg disabled:opacity-40 hover:bg-stone-100 transition-colors disabled:hover:bg-white">›</button>
                </>
              ) : (
                <>
                  <button disabled={hhPage <= 1} onClick={() => setHhPage(p => p - 1)} className="px-3 py-1.5 border border-stone-200 rounded-lg disabled:opacity-40 hover:bg-stone-100 transition-colors disabled:hover:bg-white">‹</button>
                  <span className="px-2 font-mono text-sm">{hhPage}/{Math.max(1, Math.ceil(hhTotal / 20))}</span>
                  <button disabled={hhPage * 20 >= hhTotal} onClick={() => setHhPage(p => p + 1)} className="px-3 py-1.5 border border-stone-200 rounded-lg disabled:opacity-40 hover:bg-stone-100 transition-colors disabled:hover:bg-white">›</button>
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
            {renderFarmerDetail()}
            {selectedFarmerHousehold && (
              <div className="flex gap-4 flex-1 min-h-0">
                {renderHistorySidebar(selectedFarmerHousehold.id)}
                <div className="flex-1 min-h-0">
                  {renderFarmerHouseholdDetail()}
                </div>
              </div>
            )}
            {!selectedFarmerHousehold && (
              <div className="flex-1 bg-white border border-stone-200 rounded-xl flex items-center justify-center text-stone-300 shadow-md">
                <div className="text-center">
                  <div className="text-4xl mb-3">🏠</div>
                  <div className="text-sm">该农户暂未关联家庭户</div>
                </div>
              </div>
            )}
          </div>
        ) : detail ? (
          /* 选中家庭户：显示家庭户详情 */
          <div className="flex gap-4 flex-1 min-h-0">
            {renderHistorySidebar(detail.id)}
            <div className="flex-1 min-h-0">
              <HouseholdDetailContent
                detail={detail}
                detailTab={detailTab}
                setDetailTab={setDetailTab}
                historyDate={getHistoryDateByEventId(historyEventId)}
                historyEventId={historyEventId}
                historyDates={historyDates}
                snapshotData={snapshotData}
                events={events}
                historyDateIsNull={historyEventId === null}
                onOpenMemberImport={() => setMemberImportOpen(true)}
                onOpenMemberAdd={() => { setMemberEditTarget(null); setMemberForm({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1', event_date: '', village_id: detail?.village_id ?? 0, group_no: detail?.group_no ?? 1 }); setMemberAddOpen(true) }}
                onOpenEvent={() => setEventOpen(true)}
                onOpenFarmer={openFarmer}
                onOpenMemberEdit={openMemberEdit}
                onRemoveMember={removeMember}
                onOpenEdit={() => { setEditForm({ household_name: detail.household_name, land_area: String(detail.contracted_area || ''), village_id: detail.village_id || 0, group_no: detail.group_no || 1, address: detail.address || '', remark: detail.remark || '' }); setEditOpen(true) }}
                onOpenSplit={() => { setSplitOpen(true); setSplitStep(1); setSplitSelected([]); setSplitNewHead(null); setSplitForm({ household_name: '', split_year: String(new Date().getFullYear()), split_date: '', new_land_area: '', origin_land_area: String(detail.contracted_area || ''), description: '', evidence_type: '', evidence_note: '' }) }}
                canSplit={detail.members.filter(m => m.farmer_status === 1).length >= 2}
              />
            </div>
          </div>
        ) : (
          /* 未选中任何内容 */
          <div className="flex-1 bg-white border border-stone-200 rounded-xl flex items-center justify-center text-stone-300 shadow-md">
            <div className="text-center">
              <div className="text-5xl mb-4 opacity-50">📋</div>
              <div className="text-base font-medium text-stone-400">请从左侧选择{leftTab === 'farmers' ? '农户' : '家庭户'}查看详情</div>
              <div className="text-sm text-stone-300 mt-2">支持搜索、筛选和批量操作</div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════ 弹窗 ═══════ */}

      {/* 编辑家庭户 */}
      <Modal open={editOpen} title="编辑家庭户信息" onClose={() => setEditOpen(false)} onConfirm={submitEdit}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">户名</label>
            <input value={editForm.household_name} onChange={e => setEditForm(f => ({ ...f, household_name: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div><label className="block text-xs text-stone-400 mb-1">所在村 *</label>
            <select value={editForm.village_id || ''} onChange={e => setEditForm(f => ({ ...f, village_id: Number(e.target.value) }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">请选择</option>
              {[...new Map(groups.map(g => [g.village_id, g])).values()].map(g => (
                <option key={g.village_id} value={g.village_id}>{g.village_name}</option>
              ))}
            </select>
          </div>
          <div><label className="block text-xs text-stone-400 mb-1">所在组</label>
            <select value={editForm.group_no || 1} onChange={e => setEditForm(f => ({ ...f, group_no: Number(e.target.value) }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value={1}>第1组</option>
              <option value={2}>第2组</option>
              <option value={3}>第3组</option>
              <option value={4}>第4组</option>
              <option value={5}>第5组</option>
            </select>
          </div>
          <div><label className="block text-xs text-stone-400 mb-1">承包土地面积（亩）</label>
            <input type="number" step="0.01" value={editForm.land_area} onChange={e => setEditForm(f => ({ ...f, land_area: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div><label className="block text-xs text-stone-400 mb-1">地址</label>
            <input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">备注</label>
            <textarea rows={2} value={editForm.remark} onChange={e => setEditForm(f => ({ ...f, remark: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" /></div>
        </div>
      </Modal>

      {/* 成员增改 */}
      <Modal open={memberAddOpen} title={memberEditTarget ? `编辑成员 · ${memberEditTarget.real_name}` : '新增成员'}
        onClose={() => { setMemberAddOpen(false); setMemberEditTarget(null) }} onConfirm={submitMember}>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-stone-400 mb-1">姓名 *</label>
            <input value={memberForm.real_name} onChange={e => setMemberForm(f => ({ ...f, real_name: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          {!memberEditTarget && (
            <div><label className="block text-xs text-stone-400 mb-1">身份证号 *</label>
              <input value={memberForm.id_card} onChange={e => setMemberForm(f => ({ ...f, id_card: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 font-mono" /></div>
          )}
          <div><label className="block text-xs text-stone-400 mb-1">与户主关系</label>
            <input value={memberForm.relation} onChange={e => setMemberForm(f => ({ ...f, relation: e.target.value }))} placeholder="如：本人、妻子、父亲"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div><label className="block text-xs text-stone-400 mb-1">状态</label>
            <select value={memberForm.farmer_status} onChange={e => setMemberForm(f => ({ ...f, farmer_status: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
              <option value="1">在册</option><option value="2">注销</option><option value="3">迁出</option><option value="4">死亡</option>
            </select></div>
          <div><label className="block text-xs text-stone-400 mb-1">所在村</label>
            <div className="relative">
              <input
                list="member-village-list"
                value={(() => {
                  const v = groups.find(g => g.village_id === memberForm.village_id)
                  return v ? v.village_name : ''
                })()}
                onChange={e => {
                  const found = groups.find(g => g.village_name === e.target.value)
                  if (found) {
                    setMemberForm(f => ({ ...f, village_id: found.village_id, group_no: 1 }))
                  }
                }}
                placeholder="输入或选择村名"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
              <datalist id="member-village-list">
                {[...new Map(groups.map(g => [g.village_id, g])).values()].map(g => (
                  <option key={g.village_id} value={g.village_name} />
                ))}
              </datalist>
            </div></div>
          <div><label className="block text-xs text-stone-400 mb-1">所在组</label>
            <div className="relative">
              <input
                list="member-group-list"
                value={(() => {
                  const g = groups.find(g => g.village_id === memberForm.village_id && g.group_no === memberForm.group_no)
                  return g ? g.full_name.replace(g.village_name, '').replace('村', '') : `第${memberForm.group_no}组`
                })()}
                onChange={e => {
                  // Try to match against available groups for this village
                  const villageGroups = groups.filter(g => g.village_id === memberForm.village_id)
                  const found = villageGroups.find(g => g.full_name.includes(e.target.value) || e.target.value === `第${g.group_no}组`)
                  if (found) {
                    setMemberForm(f => ({ ...f, group_no: found.group_no }))
                  } else {
                    // Try parsing as number
                    const num = parseInt(e.target.value.replace(/[^0-9]/g, ''))
                    if (num > 0) setMemberForm(f => ({ ...f, group_no: num }))
                  }
                }}
                placeholder="输入或选择组名"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
              <datalist id="member-group-list">
                {groups.filter(g => g.village_id === memberForm.village_id).map(g => (
                  <option key={g.id} value={g.full_name.replace(g.village_name, '').replace('村', '')} />
                ))}
              </datalist>
            </div></div>
          <div><label className="block text-xs text-stone-400 mb-1">变动时间（选填）</label>
            <input type="date" value={memberForm.event_date} onChange={e => setMemberForm(f => ({ ...f, event_date: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div><label className="block text-xs text-stone-400 mb-1">手机号</label>
            <input value={memberForm.phone} onChange={e => setMemberForm(f => ({ ...f, phone: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
          <div><label className="block text-xs text-stone-400 mb-1">银行卡号</label>
            <input value={memberForm.bank_card} onChange={e => setMemberForm(f => ({ ...f, bank_card: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 font-mono" /></div>
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <input type="checkbox" id="is_head_chk" checked={memberForm.is_head} onChange={e => setMemberForm(f => ({ ...f, is_head: e.target.checked }))} />
            <label htmlFor="is_head_chk" className="text-sm text-stone-600 cursor-pointer">设为本户户主</label>
            {memberForm.is_head && <span className="text-xs text-amber-600">（原户主将降为普通成员）</span>}
          </div>
        </div>
      </Modal>

      {/* 成员批量导入 */}
      {(detail || selectedFarmerHousehold) && (
        <ExcelImport open={memberImportOpen} onClose={() => setMemberImportOpen(false)}
          title={`成员导入 · ${(detail || selectedFarmerHousehold)?.household_name}`}
          templateHeaders={['身份证号*', '姓名*', '是否户主', '与户主关系', '手机号', '银行卡号', '开户行', '状态']}
          templateExample={[{ '身份证号*': '510123196503154231', '姓名*': '张国强', '是否户主': '1', '与户主关系': '本人', '手机号': '138xxxx0001', '银行卡号': '', '开户行': '', '状态': '在册' }]}
          onImport={handleMemberImport} onSuccess={refreshDetail} />
      )}

      {/* 分户向导 */}
      {(detail || selectedFarmerHousehold) && (
        <Modal open={splitOpen} title="分户向导" onClose={() => setSplitOpen(false)}
          onConfirm={splitStep === 3 ? submitSplit : () => {
            if (splitStep === 1 && splitNewHead) {
              const headName = (detail || selectedFarmerHousehold)?.members.find(m => m.id === splitNewHead)?.real_name || ''
              setSplitForm(f => ({ ...f, household_name: headName + '户' }))
            }
            setSplitStep(s => (s + 1) as 1 | 2 | 3)
          }}
          confirmText={splitStep === 3 ? '确认分户' : `下一步 (${splitStep}/3)`} width={560}>
          <div>
            <div className="flex items-center gap-2 mb-5">
              {['选择分出成员', '填写新户信息', '确认分户'].map((label, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {i > 0 && <div className={`w-8 h-px ${i < splitStep ? 'bg-emerald-400' : 'bg-stone-200'}`} />}
                  <div className={`flex items-center gap-1.5 text-xs font-medium ${splitStep === i + 1 ? 'text-emerald-700' : i + 1 < splitStep ? 'text-stone-400' : 'text-stone-300'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${splitStep === i + 1 ? 'bg-emerald-700 text-white' : i + 1 < splitStep ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-100 text-stone-300'}`}>
                      {i + 1 < splitStep ? '✓' : i + 1}
                    </div>
                    {label}
                  </div>
                </div>
              ))}
            </div>
            {splitStep === 1 && (
              <div>
                <p className="text-xs text-stone-400 mb-3">勾选要从本户分出的成员（至少1人，户主不能被分出）</p>
                <div className="space-y-2">
                  {(detail || selectedFarmerHousehold)?.members.filter(m => m.is_head !== 1).map(m => (
                    <label key={m.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
                      ${splitSelected.includes(m.id) ? 'bg-orange-50 border-orange-300' : 'bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50'}`}>
                      <input type="checkbox" checked={splitSelected.includes(m.id)}
                        onChange={e => setSplitSelected(prev => e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id))} className="w-4 h-4" />
                      <div className="flex-1">
                        <span className="font-semibold text-sm">{m.real_name}</span>
                        <span className="text-xs text-stone-400 ml-2">{m.relation}</span>
                        {splitSelected.includes(m.id) && (
                          <label className="ml-3 flex items-center gap-1 inline-flex cursor-pointer" onClick={e => e.stopPropagation()}>
                            <input type="radio" name="new_head" value={m.id} checked={splitNewHead === m.id} onChange={() => setSplitNewHead(m.id)} className="w-4 h-4" />
                            <span className="text-xs text-orange-700">设为新户户主</span>
                          </label>
                        )}
                      </div>
                    </label>
                  ))}
                  {(detail || selectedFarmerHousehold)?.members.filter(m => m.is_head === 1).map(m => (
                    <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl border border-stone-100 bg-stone-50 opacity-50">
                      <input type="checkbox" disabled className="w-4 h-4" />
                      <span className="text-sm">{m.real_name}</span>
                      <Tag label="户主（不可分出）" color="gray" />
                    </div>
                  ))}
                </div>
                {splitSelected.length > 0 && !splitNewHead && <p className="text-xs text-amber-600 mt-2">请选择新户的户主</p>}
              </div>
            )}
            {splitStep === 2 && (
              <div className="space-y-3">
                <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-xs text-orange-700">
                  将分出 {splitSelected.length} 名成员，户主为「{(detail || selectedFarmerHousehold)?.members.find(m => m.id === splitNewHead)?.real_name}」
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-stone-400 mb-1">新家庭户名称 *</label>
                    <input value={splitForm.household_name} onChange={e => setSplitForm(f => ({ ...f, household_name: e.target.value }))}
                      placeholder={`{(detail || selectedFarmerHousehold)?.members.find(m => m.id === splitNewHead)?.real_name || ''}户`}
                      className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">分户年度 *</label>
                    <select value={splitForm.split_year} onChange={e => setSplitForm(f => ({ ...f, split_year: e.target.value }))}
                      className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                      {years.map(y => <option key={y} value={y}>{y}年</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">分户日期</label>
                    <input type="date" value={splitForm.split_date} onChange={e => setSplitForm(f => ({ ...f, split_date: e.target.value }))}
                      className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">新户土地面积（亩）</label>
                    <input type="number" step="0.01" value={splitForm.new_land_area} onChange={e => setSplitForm(f => ({ ...f, new_land_area: e.target.value }))}
                      placeholder="可不填" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">原户调整后面积（亩）</label>
                    <input type="number" step="0.01" value={splitForm.origin_land_area} onChange={e => setSplitForm(f => ({ ...f, origin_land_area: e.target.value }))}
                      placeholder="不变则不填" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-stone-400 mb-1">分户原因/说明</label>
                    <textarea rows={2} value={splitForm.description} onChange={e => setSplitForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="如：子女独立成家" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
                  </div>
                </div>
              </div>
            )}
            {splitStep === 3 && (
              <div className="space-y-3">
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-orange-800">请确认分户信息</p>
                  <div className="text-xs text-orange-700 space-y-1">
                    <p>原户：{(detail || selectedFarmerHousehold)?.household_name} → 将保留 {((detail || selectedFarmerHousehold)?.members.length || 0) - splitSelected.length} 名成员</p>
                    <p>新户：{splitForm.household_name || '（未填写）'} → {splitSelected.length} 名成员</p>
                    <p>新户户主：{(detail || selectedFarmerHousehold)?.members.find(m => m.id === splitNewHead)?.real_name}</p>
                    <p>年度：{splitForm.split_year}年{splitForm.split_date ? ` · ${splitForm.split_date}` : ''}</p>
                    {splitForm.new_land_area && <p>新户面积：{splitForm.new_land_area}亩</p>}
                    {splitForm.origin_land_area && <p>原户调整后面积：{splitForm.origin_land_area}亩</p>}
                  </div>
                </div>
                <p className="text-xs text-stone-400">分户后系统将自动：为新户创建户籍档案 · 将成员移入新户 · 在两户的变更历史中各记录一条分户事件</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 补录事件 */}
      {(detail || selectedFarmerHousehold) && (
        <Modal open={eventOpen} title="补录历史事件" onClose={() => setEventOpen(false)} onConfirm={submitEvent}>
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              用于补录系统上线前的历史变动，或记录口头协议等无法自动捕获的事项。
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-stone-400 mb-1">事件类型</label>
                <select value={eventForm.event_type} onChange={e => setEventForm(f => ({ ...f, event_type: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                  {Object.entries(EVENT_TYPE_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select></div>
              <div><label className="block text-xs text-stone-400 mb-1">发生年度 *</label>
                <select value={eventForm.event_year} onChange={e => setEventForm(f => ({ ...f, event_year: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                  {years.map(y => <option key={y} value={y}>{y}年</option>)}
                </select></div>
              <div><label className="block text-xs text-stone-400 mb-1">精确日期（可选）</label>
                <input type="date" value={eventForm.event_date} onChange={e => setEventForm(f => ({ ...f, event_date: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
              <div><label className="block text-xs text-stone-400 mb-1">证明材料类型</label>
                <select value={eventForm.evidence_type} onChange={e => setEventForm(f => ({ ...f, evidence_type: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                  <option value="NONE">无</option><option value="ID_CARD">身份证</option>
                  <option value="HOUSEHOLD_REG">户籍证明</option><option value="VILLAGE_PROOF">村委证明</option>
                  <option value="COURT">法院文书</option><option value="OTHER">其他</option>
                </select></div>
              <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">事件描述 *</label>
                <textarea rows={3} value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="请描述发生了什么" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" /></div>
              <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">证明材料说明</label>
                <input value={eventForm.evidence_note} onChange={e => setEventForm(f => ({ ...f, evidence_note: e.target.value }))}
                  placeholder="如：村委证明第2024-08号" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" /></div>
            </div>
          </div>
        </Modal>
      )}

      {renderHouseholdModals()}
      <Toast {...toast} />
    </div>
  )
}

// ── 家庭户详情内容子组件 ──
function HouseholdDetailContent({
  detail,
  detailTab,
  setDetailTab,
  historyDate,
  historyEventId,
  historyDates,
  snapshotData,
  events,
  historyDateIsNull,
  onOpenMemberImport,
  onOpenMemberAdd,
  onOpenEvent,
  onOpenFarmer,
  onOpenMemberEdit,
  onRemoveMember,
  onOpenEdit,
  onOpenSplit,
  canSplit,
}: {
  detail: HHDetail
  detailTab: 'members' | 'area' | 'subsidy'
  setDetailTab: (t: 'members' | 'area' | 'subsidy') => void
  historyDate: string | null
  historyEventId: number | null
  historyDates: HistoryDateEvent[]
  snapshotData: SnapshotAtResponse | null
  events: HHEvent[]
  historyDateIsNull: boolean
  onOpenMemberImport: () => void
  onOpenMemberAdd: () => void
  onOpenEvent: () => void
  onOpenFarmer: (id: number) => void
  onOpenMemberEdit: (m: HHMember | SnapshotMember) => void
  onRemoveMember: (m: HHMember | SnapshotMember) => void
  onOpenEdit: () => void
  onOpenSplit: () => void
  canSplit: boolean
}) {
  const appsByYear: Record<number, typeof detail.app_summary> = {}
  detail.app_summary.forEach(a => {
    if (!appsByYear[a.apply_year]) appsByYear[a.apply_year] = []
    appsByYear[a.apply_year].push(a)
  })
  const displayMembers = historyDate !== null && snapshotData?.snapshot ? snapshotData.snapshot.members : detail.members
  const areaUsage = historyDate !== null && snapshotData?.snapshot
    ? { contracted_area: snapshotData.snapshot.land_area, trust_out_area: 0, trust_in_area: 0, cultivable_area: snapshotData.snapshot.land_area, used_area: 0, remaining_area: snapshotData.snapshot.land_area, is_overdrawn: false, overdraw_amount: 0, has_trust_data: false, subsidy_breakdown: [] as { subsidy_name: string; apply_area: number; calc_mode: string }[] }
    : detail.area_usage

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* 顶部卡片 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md mb-3 shrink-0">
        <div className="bg-gradient-to-r from-emerald-800 to-emerald-700 px-5 py-3.5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-lg font-bold text-white shrink-0">🏠</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-base font-bold text-white">{detail.household_name}</span>
              <span className="text-emerald-300 text-xs font-mono">{detail.household_code}</span>
              {areaUsage?.is_overdrawn && <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">⚠️ 超领</span>}
              {historyDate !== null && <span className="text-xs bg-amber-500/80 text-white px-1.5 py-0.5 rounded">⏳ 快照</span>}
            </div>
            <div className="text-emerald-200 text-xs">📍 {detail.village_full_name}
              {detail.address && <span className="ml-1 text-emerald-300">{detail.address}</span>}
            </div>
          </div>
          <div className="text-right shrink-0 mr-2">
            <div className="text-lg font-bold font-mono text-white">
              {historyDate !== null && snapshotData?.snapshot
                ? (snapshotData.snapshot.land_area > 0 ? `${snapshotData.snapshot.land_area}亩` : '未设置')
                : (detail.contracted_area > 0 ? `${detail.contracted_area}亩` : '未设置')}
            </div>
            <div className="text-emerald-300 text-xs">承包面积</div>
          </div>
          {historyDateIsNull && (
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={onOpenEdit}
                className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">✏️ 编辑</button>
              {canSplit && (
                <button onClick={onOpenSplit}
                  className="text-xs bg-orange-500/80 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">🔀 分户</button>
              )}
            </div>
          )}
        </div>

        {/* 快照备注信息 */}
        {historyEventId !== null && (() => {
          const currentEvent = historyDates.find(e => e.event_id === historyEventId)
          if (currentEvent?.description) {
            const cfg = EVENT_TYPE_CFG[currentEvent.event_type] || EVENT_TYPE_CFG.REMARK
            return (
              <div className="bg-stone-50 border-b border-stone-200 px-5 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-lg shrink-0">{cfg.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-stone-500">{currentEvent.date || `${currentEvent.event_year}年`}</span>
                    </div>
                    <p className="text-sm text-stone-700">{currentEvent.description}</p>
                  </div>
                </div>
              </div>
            )
          }
          return null
        })()}

        {/* Tab 栏 */}
        <div className="flex border-b border-stone-200 bg-stone-50 items-center">
          {([
            { id: 'members', label: `👥 成员 (${displayMembers.length})` },
            { id: 'area', label: '📐 面积' },
            { id: 'subsidy', label: `💰 补贴 (${detail.app_summary.length})` },
          ] as { id: typeof detailTab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${detailTab === t.id ? 'border-emerald-600 text-emerald-700 bg-white' : 'border-transparent text-stone-500 hover:text-stone-700'}`}>
              {t.label}
            </button>
          ))}
          {historyDateIsNull && (
            <div className="ml-auto px-2 flex gap-1.5">
              {detailTab === 'members' && (
                <>
                  <button onClick={onOpenMemberImport} className="text-xs border border-emerald-200 text-emerald-700 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors">↑ 批量导入</button>
                  <button onClick={onOpenMemberAdd} className="text-xs bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg hover:bg-emerald-600 transition-colors">＋ 成员</button>
                  <button onClick={onOpenEvent} className="text-xs border border-stone-200 text-stone-600 px-2.5 py-1.5 rounded-lg hover:bg-stone-50 transition-colors">＋ 补录</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 bg-white border border-stone-200 rounded-xl overflow-hidden shadow-md overflow-y-auto">
        {/* 成员 */}
        {detailTab === 'members' && (
          <div className="p-4 grid gap-2">
            {displayMembers.length === 0 && <div className="text-center py-8 text-stone-300 text-sm">暂无成员记录</div>}
            {displayMembers.map(m => (
              <div key={m.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all
                ${m.is_head ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50'}
                ${m.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                  ${m.is_head ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
                  {m.real_name.slice(-1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-stone-800">{m.real_name}</span>
                    {m.is_head === 1 && <Tag label="户主" color="green" />}
                    {m.relation && <Tag label={m.relation} color="gray" />}
                    {m.farmer_status !== 1 && <Tag label={FARMER_STATUS[m.farmer_status]?.label ?? '异常'} color="red" />}
                  </div>
                  <div className="text-xs text-stone-400 mt-0.5">
                    {m.gender === 1 ? '男' : '女'}
                    {m.phone_masked && <span className="ml-2">{m.phone_masked}</span>}
                    <span className="ml-2 font-mono">{m.id_card_masked}</span>
                  </div>
                </div>
                {historyDateIsNull && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => onOpenFarmer(m.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors">查看农户</button>
                    <button onClick={() => onOpenMemberEdit(m)} className="text-xs border border-stone-200 text-stone-500 px-2 py-1 rounded-lg hover:border-stone-300 transition-colors">编辑</button>
                    {m.is_head !== 1 && (
                      <button onClick={() => onRemoveMember(m)} className="text-xs border border-amber-200 text-amber-600 px-2 py-1 rounded-lg hover:bg-amber-50 transition-colors">移出</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 面积 */}
        {detailTab === 'area' && areaUsage && (
          <div className="p-4">
            {/* 流转信息提示 */}
            {(Number(areaUsage.trust_out_area ?? 0) > 0 || Number(areaUsage.trust_in_area ?? 0) > 0) && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-xs text-blue-700">
                流出 <span className="font-mono font-bold">{areaUsage.trust_out_area?.toFixed(2) ?? 0}</span> 亩
                · 流入 <span className="font-mono font-bold">{areaUsage.trust_in_area?.toFixed(2) ?? 0}</span> 亩
                · 可耕种 = 承包 - 流出 + 流入
                = <span className="font-mono font-bold">{areaUsage.cultivable_area?.toFixed(2) ?? areaUsage.contracted_area}</span> 亩
              </div>
            )}

            {/* 承包面积总览 */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 text-center shadow-sm">
                <div className="text-lg font-bold font-mono text-stone-700">{areaUsage.contracted_area} 亩</div>
                <div className="text-xs text-stone-400 mt-1">承包面积</div>
              </div>
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 text-center shadow-sm">
                <div className={`text-lg font-bold font-mono ${areaUsage.is_overdrawn ? 'text-red-500' : 'text-emerald-600'}`}>
                  {areaUsage.cultivable_area !== undefined ? `${areaUsage.cultivable_area.toFixed(2)}` : areaUsage.contracted_area} 亩
                </div>
                <div className="text-xs text-stone-400 mt-1">可耕种面积</div>
              </div>
            </div>

            {/* 按季节分组展示 */}
            {areaUsage.season_breakdown ? (
              <div className="space-y-4">
                {Object.entries(areaUsage.season_breakdown).map(([season, usage]) => {
                  const pct = areaUsage.contracted_area > 0
                    ? Math.round(usage.used_area / areaUsage.contracted_area * 100)
                    : 0
                  return (
                    <div key={season} className="border border-stone-200 rounded-xl overflow-hidden shadow-sm">
                      {/* 季节标题栏 */}
                      <div className={`flex items-center justify-between px-3 py-2 ${usage.is_overdrawn ? 'bg-red-50' : 'bg-stone-50'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${usage.is_overdrawn ? 'text-red-600' : 'text-stone-700'}`}>
                            {season}
                          </span>
                          {usage.is_overdrawn && (
                            <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">超领 {usage.overdraw_amount.toFixed(2)} 亩</span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-mono font-bold ${usage.is_overdrawn ? 'text-red-500' : 'text-emerald-600'}`}>
                            {usage.used_area.toFixed(2)} 亩
                          </span>
                          <span className="text-xs text-stone-400"> / {areaUsage.contracted_area} 亩</span>
                        </div>
                      </div>

                      {/* 季节进度条 */}
                      <div className="px-3 pt-1.5 pb-2">
                        <div className="bg-stone-100 rounded-full h-2.5 overflow-hidden mb-1.5">
                          <div
                            className={`h-full rounded-full transition-all ${usage.is_overdrawn ? 'bg-red-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-stone-400">
                          <span>剩余 {Math.max(0, usage.remaining_area).toFixed(2)} 亩</span>
                          <span>{pct}%</span>
                        </div>
                      </div>

                      {/* 季节内补贴明细 */}
                      {usage.subsidies?.length > 0 && (
                        <div className="border-t border-stone-100">
                          {usage.subsidies.map((s, i) => (
                            <div key={i} className="flex justify-between items-center px-3 py-1.5 border-b border-stone-50 last:border-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-stone-400">{s.apply_year}</span>
                                <span className="text-sm text-stone-600">{s.subsidy_name}</span>
                              </div>
                              <span className="text-sm font-mono text-amber-600">{s.used_area.toFixed(2)} 亩</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              /* 降级：旧接口无 season_breakdown 时显示原有结构 */
              <>
                {areaUsage.contracted_area > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-stone-400 mb-1.5">
                      <span>面积使用率</span>
                      <span>{Math.round(areaUsage.used_area / (areaUsage.cultivable_area ?? areaUsage.contracted_area) * 100)}%</span>
                    </div>
                    <div className="bg-stone-100 rounded-full h-3 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${areaUsage.is_overdrawn ? 'bg-red-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, Math.round(areaUsage.used_area / (areaUsage.cultivable_area ?? areaUsage.contracted_area) * 100))}%` }} />
                    </div>
                  </div>
                )}
                {areaUsage.subsidy_breakdown?.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 mb-2">各项补贴占用明细：</p>
                    <div className="space-y-2">
                      {areaUsage.subsidy_breakdown.map((b, i) => (
                        <div key={i} className="flex justify-between items-center bg-white border border-stone-200 rounded-lg px-3 py-2 shadow-sm">
                          <span className="text-sm">{b.subsidy_name}</span>
                          <span className="text-sm font-mono font-bold text-amber-600">{b.apply_area.toFixed(2)}亩</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 补贴 */}
        {detailTab === 'subsidy' && (
          <div>
            {Object.keys(appsByYear).length === 0 && <div className="py-10 text-center text-stone-300 text-sm">暂无补贴记录</div>}
            {Object.entries(appsByYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([yr, apps]) => (
              <div key={yr}>
                <div className="px-5 py-2 bg-stone-50 border-b border-stone-100 text-xs font-bold text-stone-500">
                  {yr}年度 · {apps.length}条 · 合计 ¥{apps.reduce((s, a) => s + (a.actual_amount || 0), 0).toFixed(2)}
                </div>
                {apps.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-stone-50 hover:bg-stone-50 transition-colors">
                    <span className="text-sm text-stone-500 w-16 shrink-0">{a.farmer_name}</span>
                    <span className="text-sm flex-1">{a.subsidy_name}</span>
                    {a.apply_area && <span className="text-xs text-stone-400 font-mono">{a.apply_area}亩</span>}
                    <span className="text-sm font-mono font-bold text-emerald-700">{a.actual_amount ? fmt(a.actual_amount) : '—'}</span>
                    <Tag label={PAY_STATUS[a.pay_status]?.label || '—'} color={PAY_STATUS[a.pay_status]?.color as 'green'} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
