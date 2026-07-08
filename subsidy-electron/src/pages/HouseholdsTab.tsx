/**
 * HouseholdsTab — 家庭户列表 + 完整详情
 *
 * 由 FarmersPage 容器管理，通过 props 接收共享数据
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import * as api from '../api'
import type { VillageGroup, HH, HHDetail, HHMember, HHEvent, HistoryDateEvent, SnapshotAtResponse, SnapshotMember } from '../types'
import Icon from '../components/Icon'

// Components
import HouseholdList from './HouseholdList'
import { HistorySidebar } from './FarmerDetail'
import { HouseholdDetailContent } from './HouseholdDetail'
import {
  CreateHhForm,
  MemberForm,
  MergeConfirmForm,
  SplitWizardForm,
  EventForm,
  ConfirmForm,
  DeleteConfirmForm,
  ConfirmedAreaImport,
  MemberImport,
  EditHouseholdForm,
} from './FarmerForms'

type LeftTab = 'farmers' | 'households'

interface HouseholdsTabProps {
  show: (msg: string, type?: 'ok' | 'err') => void
  groups: VillageGroup[]
  villages: string[]
  setGroups: React.Dispatch<React.SetStateAction<VillageGroup[]>>
  yearFilter: number
  setYearFilter: (year: number) => void
  activeTab: LeftTab
  onSwitchTab: (tab: LeftTab) => void
  onNavigateToFarmer: (farmerId: number) => void
  updateUrl: (params: { tab?: LeftTab; farmerId?: number | null; householdId?: number | null; year?: number }) => void
  initialHouseholdId: number | null
}

export default function HouseholdsTab(props: HouseholdsTabProps) {
  const { show, groups, villages, setGroups, yearFilter, setYearFilter, activeTab, onSwitchTab, onNavigateToFarmer, updateUrl, initialHouseholdId } = props
  const navigate = useNavigate()

  // ── 家庭户列表 ──
  const [hhList, setHhList] = useState<HH[]>([])
  const [hhTotal, setHhTotal] = useState(0)
  const [hhPage, setHhPage] = useState(1)
  const [hhLoading, setHhLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [villageFilter, setVillageFilter] = useState('')
  const [overdrawnOnly, setOverdrawnOnly] = useState(false)
  const [confirmedFilter, setConfirmedFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('1')
  const [subsidyOnly, setSubsidyOnly] = useState(false)

  // ── 工具栏收缩 ──
  const [showToolbar, setShowToolbar] = useState(true)

  // ── 户详情 ──
  const [detail, setDetail] = useState<HHDetail | null>(null)
  const [detailTab, setDetailTab] = useState<'members' | 'subsidy'>('members')
  const [areaYear, setAreaYear] = useState(yearFilter)

  // ── 历史快照 ──
  const [historyEventId, setHistoryEventId] = useState<number | null>(null)
  const [historyDates, setHistoryDates] = useState<HistoryDateEvent[]>([])
  const [snapshotData, setSnapshotData] = useState<SnapshotAtResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())
  const [events, setEvents] = useState<HHEvent[]>([])

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

  // ── 批量确认 ──
  const [batchConfirmMode, setBatchConfirmMode] = useState(false)
  const [batchSelected, setBatchSelected] = useState<number[]>([])
  const [batchSelectedHouseholds, setBatchSelectedHouseholds] = useState<HH[]>([])
  const [batchConfirmLoading, setBatchConfirmLoading] = useState(false)

  // ── 删除确认 ──
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<HH | HHDetail | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

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

  // ── 人工确认 ──
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [confirmForm, setConfirmForm] = useState({ operator: '', remark: '' })

  // ── 确权面积批量导入 ──
  const [confirmedAreaImportOpen, setConfirmedAreaImportOpen] = useState(false)
  const [confirmedAreaRows, setConfirmedAreaRows] = useState<{ real_name: string; id_card: string; confirmed_area: number }[]>([])
  const [confirmedAreaImportResult, setConfirmedAreaImportResult] = useState<{ success: number; not_found: { id_card: string; real_name: string }[]; mismatch_name: { id_card: string; input_name: string; db_name: string }[]; errors: { id_card: string; reason: string }[] } | null>(null)
  const [confirmedAreaImporting, setConfirmedAreaImporting] = useState(false)

  const [recalculatingArea, setRecalculatingArea] = useState(false)

  // ── 搜索防抖：延迟 300ms 再更新实际搜索词 ──
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setHhPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  // ── 加载家庭户列表 ──
  const loadHouseholds = useCallback(async () => {
    setHhLoading(true)
    try {
      const p: Record<string, string | number> = { page: hhPage, page_size: 20, year: yearFilter }
      if (debouncedSearch) p.search = debouncedSearch
      if (villageFilter) p.village_name = villageFilter
      if (overdrawnOnly) p.overdrawn_only = '1'
      if (confirmedFilter) p.confirmed_only = confirmedFilter
      if (statusFilter) p.status = statusFilter
      if (subsidyOnly) p.has_subsidy = '1'
      const r = await api.getHouseholds(p)
      setHhList(r.items); setHhTotal(r.total)
    } finally { setHhLoading(false) }
  }, [hhPage, debouncedSearch, yearFilter, villageFilter, overdrawnOnly, confirmedFilter, statusFilter, subsidyOnly])

  useEffect(() => { loadHouseholds() }, [loadHouseholds])

  // ── 从 URL 恢复选中状态 ──
  useEffect(() => {
    if (initialHouseholdId) {
      openDetail(initialHouseholdId, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 筛选年份变化时，同步 areaYear ──
  useEffect(() => {
    setAreaYear(yearFilter)
  }, [yearFilter])

  // ── 年份切换时，重新获取该年度的流转数据和面积信息 ──
  useEffect(() => {
    if (!detail || historyEventId !== null) return
    const currentId = detail.id
    api.getHouseholdDetail(currentId, areaYear > 0 ? areaYear : undefined).then(d => {
      if (d.id === currentId) setDetail(d)
    })
  }, [areaYear]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 打开户详情 ──
  const openDetail = async (id: number, skipUrlUpdate = false) => {
    setAreaYear(yearFilter)
    const d = await api.getHouseholdDetail(id, yearFilter)
    setDetail(d); setDetailTab('members'); setEvents([])
    setHistoryEventId(null); setSnapshotData(null)
    setMergeMode(false); setMergeSelected([]); setMergeSelectedHouseholds([])
    setBatchConfirmMode(false); setBatchSelected([]); setBatchSelectedHouseholds([])
    await loadHouseholdHistoryDates(id)
    if (!skipUrlUpdate) {
      updateUrl({ tab: 'households', farmerId: null, householdId: id })
    }
  }

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

  // ── 刷新户详情 ──
  const refreshDetail = async () => {
    if (detail) {
      const d = await api.getHouseholdDetail(detail.id, yearFilter)
      setDetail(d)
    }
  }

  // ── 重新计算未确认家庭户承包地面积 ──
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

  // ── 加载事件 ──
  const loadEvents = useCallback(async () => {
    if (!detail?.id) return
    const r = await api.getHouseholdEvents(detail.id)
    setEvents(r)
  }, [detail?.id])

  useEffect(() => {
    if (detail) loadEvents()
  }, [detail?.id, loadEvents])

  // ── 历史快照 ──
  const loadSnapshotAt = async (date: string, householdId?: number, eventId?: number) => {
    const hhId = householdId ?? detail?.id
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

  // ── 年份折叠 ──
  const toggleYear = (yr: number) => {
    setExpandedYears(prev => {
      const next = new Set(prev)
      if (next.has(yr)) next.delete(yr); else next.add(yr)
      return next
    })
  }

  // ── 合并家庭户 ──
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

  const handleMergeConfirm = () => {
    if (mergeSelectedHouseholds.length < 2) return show('请至少选择 2 个家庭户', 'err')
    const target = mergeSelectedHouseholds[0]
    setMergeConfirmForm({ contract_area: target?.contracted_area?.toString() || '', remark: '' })
    setMergeConfirmOpen(true)
  }

  const confirmMerge = async () => {
    if (mergeSelectedHouseholds.length < 2) return show('请至少选择 2 个家庭户', 'err')
    const targetId = mergeSelectedHouseholds[0].id
    const sourceIds = mergeSelectedHouseholds.slice(1).map(h => h.id).filter(id => id !== targetId)
    if (sourceIds.length === 0) return show('目标户不能与被合并户相同', 'err')
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

  // ── 批量确认 ──
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
      }
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally {
      setDeleteLoading(false)
    }
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
      loadHouseholds()
      openDetail(r.id)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 编辑家庭户 ──
  const submitEdit = async () => {
    if (!detail?.id) return
    await api.updateHousehold(detail.id, {
      household_name: editForm.household_name,
      contract_area: Number(editForm.contract_area) || undefined,
      village_id: editForm.village_id || undefined,
      group_no: editForm.group_no || undefined,
      address: editForm.address || undefined,
      remark: editForm.remark || undefined,
    })
    show('✓ 已更新'); setEditOpen(false); refreshDetail(); loadHouseholds()
  }

  // ── 成员增改 ──
  const submitMember = async () => {
    if (!detail?.id) return
    if (!memberForm.real_name.trim()) return show('请填写姓名', 'err')
    if (!memberEditTarget && !memberForm.id_card.trim()) return show('请填写身份证号', 'err')
    try {
      if (memberEditTarget) {
        await api.updateHouseholdMember(detail.id, memberEditTarget.id, {
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
        await api.addHouseholdMember(detail.id, {
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
      setMemberAddOpen(false); setMemberEditTarget(null); refreshDetail(); loadHouseholds()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const removeMember = async (m: HHMember | SnapshotMember) => {
    if (!detail?.id) return
    if (!confirm(`确认移出「${m.real_name}」？移出后将标记为迁出，历史补贴记录保留。`)) return
    try {
      await api.removeHouseholdMember(detail.id, m.id)
      show(`✓ 已移出「${m.real_name}」`); refreshDetail(); loadHouseholds()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openMemberEdit = (m: HHMember | SnapshotMember) => {
    setMemberEditTarget(m as HHMember)
    const hm = m as HHMember
    const effVid = hm.own_village_id ?? detail?.village_id
    const effGno = hm.own_group_no ?? detail?.group_no
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
    if (!detail?.id) return { created: 0, skipped: 0, errors: [] }
    const mappedRows = rows.map(row => {
      const mapped: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(row)) {
        const apiField = MEMBER_IMPORT_ALIAS[key] || key
        mapped[apiField] = val
      }
      return mapped
    })
    const res = await api.batchImportHouseholdMembers(detail.id, mappedRows)
    show(`✓ 新增 ${res.created} 条${res.skipped > 0 ? `，跳过 ${res.skipped} 条` : ''}`)
    refreshDetail(); loadHouseholds()
    return res
  }

  // ── 分户向导 ──
  const submitSplit = async () => {
    if (!detail?.id || splitSelected.length === 0) return

    const members = detail?.members || []

    let actualHeadId = splitNewHead
    let actualHouseholdName = splitForm.household_name

    if (!actualHeadId) {
      actualHeadId = splitSelected[0]
      const defaultHeadName = members.find((m: any) => m.id === actualHeadId)?.real_name || ''
      if (!actualHouseholdName.trim()) {
        actualHouseholdName = defaultHeadName + '户'
      }
      const confirmed = window.confirm(
        `未选择新户户主，将默认选择「${defaultHeadName}」作为新户户主，户名为「${actualHouseholdName}」。\n\n确认继续吗？`
      )
      if (!confirmed) return
    }

    if (!actualHouseholdName.trim()) return show('请填写新家庭户名称', 'err')

    try {
      const r = await api.splitHousehold(detail.id, {
        split_year: Number(splitForm.split_year),
        split_date: splitForm.split_date || null,
        new_household_name: actualHouseholdName,
        member_ids: splitSelected,
        new_head_id: actualHeadId,
        village_id: detail.village_id,
        group_no: detail.group_no,
        new_land_area: splitForm.new_land_area ? Number(splitForm.new_land_area) : null,
        origin_land_area: splitForm.origin_land_area ? Number(splitForm.origin_land_area) : null,
        description: splitForm.description || `分户：${splitSelected.length}名成员独立组建「${actualHouseholdName}」`,
        evidence_type: splitForm.evidence_type || null,
        evidence_note: splitForm.evidence_note || null,
      })
      show(`✓ 分户成功，新户ID: ${r.new_household_id}`)
      setSplitOpen(false); setSplitStep(1); setSplitSelected([]); setSplitNewHead(null)
      refreshDetail(); loadHouseholds()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 手动补录事件 ──
  const submitEvent = async () => {
    if (!detail?.id) return
    if (!eventForm.description.trim()) return show('请填写事件描述', 'err')
    await api.addHouseholdEvent(detail.id, { ...eventForm, event_year: Number(eventForm.event_year) })
    show('✓ 事件已记录'); setEventOpen(false); loadEvents()
  }

  const undoEvent = async (ev: HHEvent) => {
    if (!detail?.id) return
    if (!confirm('确认撤销此操作？系统将恢复到操作前的状态。')) return
    try {
      await api.undoHouseholdEvent(detail.id, ev.id)
      show('✓ 已撤销')
      loadEvents(); refreshDetail()
      const hd = await api.getHouseholdHistoryDates(detail.id)
      setHistoryDates(hd.events)
    } catch (e: unknown) { show((e as Error).message, 'err') }
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

  // ── 导出当前列表 ──
  const exportCurrentList = async () => {
    const params: Record<string, string | number> = { page: 1, page_size: 5000, year: yearFilter }
    if (debouncedSearch) params.search = debouncedSearch
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

  // ── 导出超限明细 ──
  const exportOverdrawnDetail = async () => {
    try {
      const res = await api.getOverdrawnDetail(yearFilter)
      if (res.total === 0) { show('当前年度无超限家庭户', 'err'); return }
      const rows = res.items.map(h => {
        const row: Record<string, unknown> = {
          '户名': h.household_name,
          '户主': h.head_name,
          '所在村组': h.village,
          '承包面积(亩)': h.contracted_area,
          '可耕种面积(亩)': h.cultivable_area,
          '已使用面积(亩)': h.used_area,
          '超限面积(亩)': h.overdraw_amount,
        }
        for (const [season, breakdown] of Object.entries(h.season_breakdown)) {
          row[`${season}使用面积`] = breakdown.used_area
          row[`${season}超限面积`] = breakdown.overdraw_amount
        }
        return row
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 14 }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '超限明细')
      XLSX.writeFile(wb, `超限明细_${yearFilter}年_${new Date().toISOString().slice(0, 10)}.xlsx`)
      show(`✓ 已导出 ${res.total} 户超限明细`)
    } catch (e) {
      show('导出超限明细失败：' + (e as Error).message, 'err')
    }
  }

  // ═══════════════════════════════════════════════
  //  渲染
  // ═══════════════════════════════════════════════
  return (
    <>
      {/* ── 左侧：Tab + 列表 ── */}
      <div className="w-[32%] shrink-0 flex flex-col sticky top-[88px] self-start" style={{ maxHeight: 'calc(100vh - 104px)' }}>
        {/* Tab 切换 */}
        <div className="flex mb-4 bg-warm/50 rounded-card p-1.5 shadow-card">
          <button onClick={() => onSwitchTab('households')}
            className={`flex-1 py-2.5 text-sm font-medium rounded-btn transition-all
              ${activeTab === 'households' ? 'bg-white text-primary shadow-card' : 'text-text-muted hover:text-text-primary hover:bg-warm/30'}`}>
            <Icon name="household" size={16} className="inline mr-1.5" />家庭户
          </button>
          <button onClick={() => onSwitchTab('farmers')}
            className={`flex-1 py-2.5 text-sm font-medium rounded-btn transition-all
              ${activeTab === 'farmers' ? 'bg-white text-primary shadow-card' : 'text-text-muted hover:text-text-primary hover:bg-warm/30'}`}>
            <Icon name="person" size={16} className="inline mr-1.5" />农户
          </button>
        </div>

        {/* 工具栏 - 搜索和筛选 */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value.trimStart())}
            onPaste={e => { e.preventDefault(); setSearch(e.clipboardData.getData('text').trim()) }} placeholder="搜索户名/户编码/户主姓名…"
            className="flex-1 min-w-32 border border-border rounded-btn px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 bg-white shadow-card transition-all" />
          <select value={villageFilter} onChange={e => { setVillageFilter(e.target.value); setHhPage(1) }}
            className="border border-border rounded-btn px-3 py-2.5 text-sm bg-white outline-none shadow-card focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all">
            <option value="">全部村庄</option>
            {villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={yearFilter} onChange={e => { setYearFilter(Number(e.target.value)); setHhPage(1); updateUrl({ year: Number(e.target.value) }) }}
            className="border border-border rounded-btn px-3 py-2.5 text-sm bg-white outline-none shadow-card focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all">
            {Array.from({ length: 21 }, (_, i) => new Date().getFullYear() - 10 + i).map(y => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
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
          <label className="flex items-center gap-2 cursor-pointer text-sm text-text-primary bg-white border border-border rounded-btn px-3 py-2.5 shadow-card hover:border-primary/30 transition-all">
            <input type="checkbox" checked={subsidyOnly} onChange={e => { setSubsidyOnly(e.target.checked); setHhPage(1) }}
              className="w-4 h-4 text-primary rounded" />
            <span>仅有补贴记录</span>
          </label>
        </div>

        {/* 工具栏 - 操作按钮 */}
        <div className="mb-3">
          {!mergeMode && !batchConfirmMode && (
            <button
              onClick={() => setShowToolbar(v => !v)}
              className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2 w-full"
            >
              <span className={`inline-block transition-transform text-xs ${showToolbar ? 'rotate-90' : ''}`}>▸</span>
              <span className="font-medium">操作工具</span>
              <span className="text-xs text-text-muted/60 ml-2">{showToolbar ? '点击收起' : '点击展开'}</span>
            </button>
          )}
          {showToolbar && (
            <div className="flex gap-2 flex-wrap">
              {!mergeMode && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setCreateHhOpen(true)} className="px-3 py-2 text-sm bg-primary-500 text-white rounded-btn hover:bg-primary/90 shadow-card hover:shadow-card-hover transition-all font-medium">
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
                  <button onClick={exportOverdrawnDetail}
                    className="px-3 py-2 text-sm border border-orange-tag/30 text-[#B8860B] bg-orange-tag/5 rounded-btn hover:bg-orange-tag/10 shadow-card hover:shadow-card-hover transition-all font-medium whitespace-nowrap">
                    <Icon name="export" size={14} className="inline mr-1" />导出超限明细
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* 家庭户列表 - 标签说明 */}
        {!mergeMode && (
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
        {mergeMode && (
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
        {batchConfirmMode && (
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

        {/* 列表 */}
        <div className="flex-1 bg-warm-100 border border-border rounded-card overflow-hidden shadow-card flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto">
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
          </div>

          {/* 分页 */}
          <div className="px-5 py-3 border-t border-border bg-warm/30 flex justify-between items-center text-meta text-text-muted shrink-0">
            <span className="font-medium">共{hhTotal}户</span>
            <div className="flex gap-1 items-center">
              <button disabled={hhPage <= 1} onClick={() => setHhPage(p => p - 1)} className="px-3 py-1.5 border border-border rounded-btn disabled:opacity-40 hover:bg-warm/30 transition-colors disabled:hover:bg-white">‹</button>
              <span className="px-2 font-mono text-sm">{hhPage}/{Math.max(1, Math.ceil(hhTotal / 20))}</span>
              <button disabled={hhPage * 20 >= hhTotal} onClick={() => setHhPage(p => p + 1)} className="px-3 py-1.5 border border-border rounded-btn disabled:opacity-40 hover:bg-warm/30 transition-colors disabled:hover:bg-white">›</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 右侧：详情面板 ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {detail ? (
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
                onOpenFarmer={(farmerId) => {
                  onNavigateToFarmer(farmerId)
                }}
                onOpenMemberEdit={openMemberEdit}
                onRemoveMember={removeMember}
                onOpenEdit={() => { setEditForm({ household_name: detail.household_name, contract_area: String(detail.contracted_area || ''), village_id: detail.village_id || 0, group_no: detail.group_no || 1, address: detail.address || '', remark: detail.remark || '' }); setEditOpen(true) }}
                onOpenSplit={() => { setSplitOpen(true); setSplitStep(1); setSplitSelected([]); setSplitNewHead(null); setSplitForm({ household_name: '', split_year: String(new Date().getFullYear()), split_date: '', new_land_area: '', origin_land_area: String(detail.contracted_area || ''), description: '', evidence_type: '', evidence_note: '' }) }}
                canSplit={detail.members.filter(m => m.farmer_status === 1).length >= 2}
                onOpenManualConfirm={() => { setConfirmForm({ operator: '', remark: '' }); setManualConfirmOpen(true) }}
                onOpenCancelConfirm={() => { setConfirmForm({ operator: '', remark: '' }); setCancelConfirmOpen(true) }}
                onDelete={() => { setDeleteTarget(detail); setDeleteConfirmOpen(true) }}
                onNavigateToProject={(typeId, farmerName) => navigate(`/projects?subsidy_type_id=${typeId}&farmer_name=${encodeURIComponent(farmerName)}`)}
              />
            </div>
          </div>
        ) : (
          /* 未选中任何内容 */
          <div className="flex-1 bg-white border border-border rounded-card flex items-center justify-center shadow-card">
            <div className="text-center">
              <Icon name="household" size={48} className="mx-auto mb-4 text-border" />
              <div className="text-base font-medium text-text-muted">请从左侧选择家庭户查看详情</div>
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
      {detail && (
        <MemberImport
          open={memberImportOpen}
          householdName={detail.household_name || ''}
          onImport={handleMemberImport}
          onSuccess={refreshDetail}
          onClose={() => setMemberImportOpen(false)}
        />
      )}

      {/* 分户向导 */}
      {detail && (
        <SplitWizardForm
          open={splitOpen}
          splitStep={splitStep}
          splitSelected={splitSelected}
          splitNewHead={splitNewHead}
          splitForm={splitForm}
          members={detail.members || []}
          householdName={detail.household_name}
          setSplitStep={setSplitStep}
          setSplitSelected={setSplitSelected}
          setSplitNewHead={setSplitNewHead}
          setSplitForm={setSplitForm}
          onSubmit={submitSplit}
          onClose={() => setSplitOpen(false)}
        />
      )}

      {/* 补录事件 */}
      {detail && (
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
    </>
  )
}
