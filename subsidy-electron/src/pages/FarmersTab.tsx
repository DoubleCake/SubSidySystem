/**
 * FarmersTab — 农户列表 + 农户详情 + 所属家庭户迷你详情
 *
 * 由 FarmersPage 容器管理，通过 props 接收共享数据
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import * as api from '../api'
import type { VillageGroup, FarmerOut, FarmerDetail, HHDetail, HHMember, HHEvent, HistoryDateEvent, SnapshotAtResponse, SnapshotMember, ExcelColumnTemplate } from '../types'
import { FARMER_STATUS, parseIdCardInfo } from '../utils'
import Icon from '../components/Icon'

// Components
import FarmerList from './FarmerList'
import { FarmerDetail as FarmerDetailCard, FarmerHouseholdDetail, HistorySidebar } from './FarmerDetail'
import {
  CreateFarmerForm,
  MemberForm,
  SplitWizardForm,
  EventForm,
  ConfirmForm,
  DeleteConfirmForm,
  FarmerImport,
  MemberImport,
  EditHouseholdForm,
} from './FarmerForms'

type LeftTab = 'farmers' | 'households'

interface FarmersTabProps {
  show: (msg: string, type?: 'ok' | 'err') => void
  groups: VillageGroup[]
  villages: string[]
  setGroups: React.Dispatch<React.SetStateAction<VillageGroup[]>>
  yearFilter: number
  activeTab: LeftTab
  onSwitchTab: (tab: LeftTab) => void
  updateUrl: (params: { tab?: LeftTab; farmerId?: number | null; householdId?: number | null; year?: number }) => void
  initialFarmerId: number | null
}

export default function FarmersTab(props: FarmersTabProps) {
  const { show, groups, villages, setGroups, yearFilter, activeTab, onSwitchTab, updateUrl, initialFarmerId } = props
  const navigate = useNavigate()

  // ── 农户列表 ──
  const [farmerList, setFarmerList] = useState<FarmerOut[]>([])
  const [farmerTotal, setFarmerTotal] = useState(0)
  const [farmerPage, setFarmerPage] = useState(1)
  const [farmerLoading, setFarmerLoading] = useState(false)
  const [selectedFarmer, setSelectedFarmer] = useState<FarmerDetail | null>(null)
  const [selectedFarmerHousehold, setSelectedFarmerHousehold] = useState<HHDetail | null>(null)
  const [search, setSearch] = useState('')
  const [villageFilter, setVillageFilter] = useState('')

  // ── 历史快照 ──
  const [historyEventId, setHistoryEventId] = useState<number | null>(null)
  const [historyDates, setHistoryDates] = useState<HistoryDateEvent[]>([])
  const [snapshotData, setSnapshotData] = useState<SnapshotAtResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())
  const [events, setEvents] = useState<HHEvent[]>([])

  // ── 详情子 tab ──
  const [detailTab, setDetailTab] = useState<'members' | 'subsidy'>('members')

  // ── 新建农户 ──
  const [createFarmerOpen, setCreateFarmerOpen] = useState(false)
  const [createFarmerForm, setCreateFarmerForm] = useState({ real_name: '', id_card: '', gender: 1 as 1 | 2, phone: '', village_name: '', group_no: '', address: '', contract_area: '', remark: '' })

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

  // ── 编辑家庭户 ──
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ household_name: '', contract_area: '', village_id: 0, group_no: 1, address: '', remark: '' })

  // ── 批量导入农户 ──
  const [importOpen, setImportOpen] = useState(false)
  const [templates, setTemplates] = useState<ExcelColumnTemplate[]>([])

  // ── 删除确认 ──
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<HHDetail | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── 人工确认 ──
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [confirmForm, setConfirmForm] = useState({ operator: '', remark: '' })

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

  // ── 搜索防抖：延迟 300ms 再更新实际搜索词 ──
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setFarmerPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  // ── 加载农户列表 ──
  const loadFarmers = useCallback(async () => {
    setFarmerLoading(true)
    try {
      const p: Record<string, string | number> = { page: farmerPage, page_size: 20 }
      if (debouncedSearch) p.search = debouncedSearch
      if (villageFilter) p.village_name = villageFilter
      const r = await api.getFarmers(p)
      setFarmerList(r.items); setFarmerTotal(r.total)
    } finally { setFarmerLoading(false) }
  }, [farmerPage, debouncedSearch, villageFilter])

  useEffect(() => { loadFarmers() }, [loadFarmers])

  // ── 加载 Excel 模板 ──
  useEffect(() => {
    api.getExcelTemplates('FARMER').then(setTemplates).catch(() => {})
  }, [])

  // ── 从 URL 恢复选中状态 ──
  useEffect(() => {
    if (initialFarmerId) {
      openFarmer(initialFarmerId, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 打开农户详情 ──
  const openFarmer = async (farmerId: number, skipUrlUpdate = false) => {
    try {
      const f = await api.getFarmer(farmerId) as FarmerDetail
      setSelectedFarmer(f)
      setHistoryEventId(null)
      setSnapshotData(null)
      setEvents([])
      if (f.household_id) {
        try {
          const hh = await api.getHouseholdDetail(f.household_id, yearFilter)
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

  // ── 刷新家庭户详情 ──
  const refreshDetail = async () => {
    if (selectedFarmer?.household_id) {
      try {
        const hh = await api.getHouseholdDetail(selectedFarmer.household_id, yearFilter)
        setSelectedFarmerHousehold(hh)
      } catch {
        setSelectedFarmerHousehold(null)
      }
    }
  }

  // ── 加载事件 ──
  const loadEvents = useCallback(async () => {
    const hhId = selectedFarmerHousehold?.id
    if (!hhId) return
    const r = await api.getHouseholdEvents(hhId)
    setEvents(r)
  }, [selectedFarmerHousehold?.id])

  useEffect(() => {
    if (selectedFarmerHousehold) loadEvents()
  }, [selectedFarmerHousehold?.id, loadEvents])

  // ── 历史快照 ──
  const loadSnapshotAt = async (date: string, householdId?: number, eventId?: number) => {
    const hhId = householdId ?? selectedFarmerHousehold?.id
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
      loadFarmers()
      openFarmer(r.id, true)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 编辑家庭户 ──
  const submitEdit = async () => {
    const hhId = selectedFarmerHousehold?.id
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
  }

  // ── 成员增改 ──
  const submitMember = async () => {
    const hhId = selectedFarmerHousehold?.id
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
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const removeMember = async (m: HHMember | SnapshotMember) => {
    const hhId = selectedFarmerHousehold?.id
    if (!hhId) return
    if (!confirm(`确认移出「${m.real_name}」？移出后将标记为迁出，历史补贴记录保留。`)) return
    try {
      await api.removeHouseholdMember(hhId, m.id)
      show(`✓ 已移出「${m.real_name}」`); refreshDetail()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openMemberEdit = (m: HHMember | SnapshotMember) => {
    setMemberEditTarget(m as HHMember)
    const hh = selectedFarmerHousehold
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
    const hhId = selectedFarmerHousehold?.id
    if (!hhId) return { created: 0, skipped: 0, errors: [] }
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
    return res
  }

  // ── 分户向导 ──
  const submitSplit = async () => {
    const hhId = selectedFarmerHousehold?.id
    if (!hhId || splitSelected.length === 0) return

    const members = selectedFarmerHousehold?.members || []

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
      refreshDetail()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 手动补录事件 ──
  const submitEvent = async () => {
    const hhId = selectedFarmerHousehold?.id
    if (!hhId) return
    if (!eventForm.description.trim()) return show('请填写事件描述', 'err')
    await api.addHouseholdEvent(hhId, { ...eventForm, event_year: Number(eventForm.event_year) })
    show('✓ 事件已记录'); setEventOpen(false); loadEvents()
  }

  const undoEvent = async (ev: HHEvent) => {
    const hhId = selectedFarmerHousehold?.id
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

  // ── 人工确认家庭户 ──
  const handleManualConfirm = async () => {
    const hhId = selectedFarmerHousehold?.id
    if (!hhId) return
    try {
      await api.manualConfirmHousehold(hhId, {
        operator: confirmForm.operator || undefined,
        remark: confirmForm.remark || undefined,
      })
      show('✓ 家庭户信息已确认')
      setManualConfirmOpen(false)
      setConfirmForm({ operator: '', remark: '' })
      await refreshDetail()
      await loadHouseholdHistoryDates(hhId)
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 取消人工确认 ──
  const handleCancelConfirm = async () => {
    const hhId = selectedFarmerHousehold?.id
    if (!hhId) return
    try {
      await api.cancelManualConfirm(hhId, {
        operator: confirmForm.operator || undefined,
        remark: confirmForm.remark || undefined,
      })
      show('✓ 已取消人工确认')
      setCancelConfirmOpen(false)
      setConfirmForm({ operator: '', remark: '' })
      await refreshDetail()
      await loadHouseholdHistoryDates(hhId)
    } catch (e: unknown) { show((e as Error).message, 'err') }
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
      if (selectedFarmerHousehold?.id === deleteTarget.id) {
        setSelectedFarmerHousehold(null)
      }
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally {
      setDeleteLoading(false)
    }
  }

  // ── 批量导入农户 ──
  const handleImport = async (rows: Record<string, unknown>[], _mapping?: Record<string, string>, overwrite?: boolean) => {
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
    const res = await api.batchImportFarmers(toCreate as unknown as Parameters<typeof api.batchImportFarmers>[0], overwrite ?? false)
    api.getVillageGroups().then(setGroups)
    const allErrors = [...formatErrors, ...(res.errors || [])]
    if (res.skipped > 0) allErrors.push(`已跳过 ${res.skipped} 条重复身份证（未开启覆盖）`)
    loadFarmers()
    return { ...res, errors: allErrors }
  }

  const detectExcelColumns = async (columns: string[], sampleRows: Record<string, unknown>[]) => {
    try {
      const raw = await api.detectExcelColumns(columns, 'FARMER', sampleRows)
      const cols = (raw.columns || []).map((d: any) => ({
        excel_column: d.excel_column,
        suggested_field: d.suggested_field,
        confidence: (d as any).confidence ?? (d as any).suggested_confidence ?? 0,
        alternatives: d.alternatives || [],
      }))
      return { columns: cols, recommended_templates: raw.recommended_templates || [] }
    } catch {
      return { columns: columns.map(c => ({ excel_column: c, suggested_field: null, confidence: 0, alternatives: [] as Array<{ field: string; confidence: number }> })), recommended_templates: [] as Array<{ field: string; confidence: number }> }
    }
  }

  const saveColumnMappingTemplate = async (data: Record<string, unknown>) => {
    const result = await api.saveExcelTemplate({ ...data, business_type: 'FARMER' })
    api.getExcelTemplates('FARMER').then(setTemplates).catch(() => {})
    return result
  }

  // ── 导出 ──
  const exportCurrentList = async () => {
    const params: Record<string, string | number> = { page: 1, page_size: 5000 }
    if (debouncedSearch) params.search = debouncedSearch
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

        {/* 搜索和筛选 */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索姓名/身份证/手机号…"
            className="flex-1 min-w-32 border border-border rounded-btn px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 bg-white shadow-card transition-all" />
          <select value={villageFilter} onChange={e => { setVillageFilter(e.target.value); setFarmerPage(1) }}
            className="border border-border rounded-btn px-3 py-2.5 text-sm bg-white outline-none shadow-card focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all">
            <option value="">全部村庄</option>
            {villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        {/* 工具栏 - 操作按钮 */}
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setCreateFarmerOpen(true)} className="px-4 py-2.5 text-sm bg-primary text-white rounded-btn hover:bg-primary/90 shadow-card hover:shadow-card-hover transition-all font-medium">
            <Icon name="create" size={14} className="inline mr-1" />新建农户
          </button>
          <button onClick={() => setImportOpen(true)} className="px-4 py-2.5 text-sm border border-primary/30 text-primary bg-primary/[0.03] rounded-btn hover:bg-primary/10 shadow-card hover:shadow-card-hover transition-all font-medium">
            <Icon name="import" size={14} className="inline mr-1" />导入农户
          </button>
          <button onClick={exportCurrentList} className="px-4 py-2.5 text-sm border border-border text-text-muted rounded-btn hover:bg-warm/30 shadow-card hover:shadow-card-hover transition-all font-medium">
            <Icon name="export" size={14} className="inline mr-1" />导出
          </button>
        </div>

        {/* 列表 */}
        <div className="flex-1 bg-warm-100 border border-border rounded-card overflow-hidden shadow-card flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto">
            <FarmerList
              farmers={farmerList}
              loading={farmerLoading}
              selectedId={selectedFarmer?.id ?? null}
              onSelect={openFarmer}
            />
          </div>

          {/* 分页 */}
          <div className="px-5 py-3 border-t border-border bg-warm/30 flex justify-between items-center text-meta text-text-muted shrink-0">
            <span className="font-medium">共{farmerTotal}人</span>
            <div className="flex gap-1 items-center">
              <button disabled={farmerPage <= 1} onClick={() => setFarmerPage(p => p - 1)} className="px-3 py-1.5 border border-border rounded-btn disabled:opacity-40 hover:bg-warm/30 transition-colors disabled:hover:bg-white">‹</button>
              <span className="px-2 font-mono text-sm">{farmerPage}/{Math.max(1, Math.ceil(farmerTotal / 20))}</span>
              <button disabled={farmerPage * 20 >= farmerTotal} onClick={() => setFarmerPage(p => p + 1)} className="px-3 py-1.5 border border-border rounded-btn disabled:opacity-40 hover:bg-warm/30 transition-colors disabled:hover:bg-white">›</button>
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
              appSummary={selectedFarmerHousehold?.app_summary?.filter(a => a.farmer_id === selectedFarmer.id)}
              groups={groups}
              onUpdate={() => openFarmer(selectedFarmer!.id)}
              onNavigateToProject={(typeId, farmerName) => navigate(`/projects?subsidy_type_id=${typeId}&farmer_name=${encodeURIComponent(farmerName)}`)}
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
                      const v = groups.find(g => g.village_id === selectedFarmerHousehold?.village_id)
                      const g = groups.find(g => g.village_id === selectedFarmerHousehold?.village_id && g.group_no === selectedFarmerHousehold?.group_no)
                      setMemberForm({ real_name: '', id_card: '', gender: '1', relation: '成员', is_head: false, phone: '', bank_card: '', bank_name: '', farmer_status: '1', restricted_identity: '0', event_date: '', village_id: selectedFarmerHousehold?.village_id ?? 0, group_no: selectedFarmerHousehold?.group_no ?? 1, village_name: v?.village_name ?? '', group_name: g ? g.full_name.replace(g.village_name, '').replace('村', '') : `第${selectedFarmerHousehold?.group_no ?? 1}组` })
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
        ) : (
          /* 未选中任何内容 */
          <div className="flex-1 bg-white border border-border rounded-card flex items-center justify-center shadow-card">
            <div className="text-center">
              <Icon name="person" size={48} className="mx-auto mb-4 text-border" />
              <div className="text-base font-medium text-text-muted">请从左侧选择农户查看详情</div>
              <div className="text-sm text-text-muted/50 mt-2">支持搜索、筛选和批量操作</div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════ 弹窗 ═══════ */}

      {/* 新建农户 */}
      <CreateFarmerForm
        open={createFarmerOpen}
        villages={villages}
        createFarmerForm={createFarmerForm}
        setCreateFarmerForm={setCreateFarmerForm}
        onSubmit={submitCreateFarmer}
        onClose={() => setCreateFarmerOpen(false)}
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

      {/* 编辑家庭户 */}
      <EditHouseholdForm
        open={editOpen}
        editForm={editForm}
        groups={groups}
        onSubmit={submitEdit}
        onClose={() => setEditOpen(false)}
        setEditForm={setEditForm}
      />

      {/* 成员批量导入 */}
      {selectedFarmerHousehold && (
        <MemberImport
          open={memberImportOpen}
          householdName={selectedFarmerHousehold.household_name || ''}
          onImport={handleMemberImport}
          onSuccess={refreshDetail}
          onClose={() => setMemberImportOpen(false)}
        />
      )}

      {/* 分户向导 */}
      {selectedFarmerHousehold && (
        <SplitWizardForm
          open={splitOpen}
          splitStep={splitStep}
          splitSelected={splitSelected}
          splitNewHead={splitNewHead}
          splitForm={splitForm}
          members={selectedFarmerHousehold.members || []}
          householdName={selectedFarmerHousehold.household_name}
          setSplitStep={setSplitStep}
          setSplitSelected={setSplitSelected}
          setSplitNewHead={setSplitNewHead}
          setSplitForm={setSplitForm}
          onSubmit={submitSplit}
          onClose={() => setSplitOpen(false)}
        />
      )}

      {/* 补录事件 */}
      {selectedFarmerHousehold && (
        <EventForm
          open={eventOpen}
          eventForm={eventForm}
          setEventForm={setEventForm}
          onSubmit={submitEvent}
          onClose={() => setEventOpen(false)}
        />
      )}

      {/* 人工确认弹窗 */}
      {manualConfirmOpen && selectedFarmerHousehold && (
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
          detail={selectedFarmerHousehold}
        />
      )}

      {/* 取消确认弹窗 */}
      {cancelConfirmOpen && selectedFarmerHousehold && (
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
          detail={selectedFarmerHousehold}
        />
      )}

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
        onClose={() => setImportOpen(false)}
        onDetectColumns={detectExcelColumns}
        onSaveTemplate={saveColumnMappingTemplate}
        onImport={handleImport}
        onSuccess={() => loadFarmers()}
      />
    </>
  )
}
