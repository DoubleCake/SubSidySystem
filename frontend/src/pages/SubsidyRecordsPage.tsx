/**
 * 补贴记录子页 - Tab容器
 * 包含预申请/发放/代领三个Tab
 */
import { useState, useEffect, useCallback } from 'react'

import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ResultTable from '../components/ResultTable'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import * as api from '../api'
import type { ApplicationSearchResult, ApplicationCreate, ApplicationOut, ExcelColumnTemplate, CheckResult } from '../types'
import { PAY_STATUS } from '../utils'
import { getPrecheckTableConfigs, PRECHECK_TABLE_CONFIGS } from '../utils/precheckConfig'
import { exportPrecheckReportWithOptions, PRECHECK_SHEET_OPTIONS, SheetKey, getVillagesFromResult, getDefaultSelectedSheets } from '../utils/exportPrecheckReport'
import { exportAreaStatsToExcel } from '../utils/exportAreaStats'
import PreApplyList from './PreApplyList'
import DisbursementList from './DisbursementList'
import ProxyList from './ProxyList'
import PrecheckHistoryTab from '../components/PrecheckHistoryTab'
import ProjectProgressTab from '../components/ProjectProgressTab'

// 代领导入字段配置
const PROXY_IMPORT_FIELDS = [
  { field: 'beneficiary_id_card', label: '被代领人身份证', required: true, type: 'id_card' },
  { field: 'proxy_id_card', label: '代领人身份证', required: true, type: 'id_card' },
  { field: 'proxy_type', label: '代领类型', required: false, type: 'string' },
  { field: 'remark', label: '备注', required: false, type: 'string' },
]

type StatsType = {
  id: number
  subsidy_name: string
  subsidy_year: number
  season: string | null
  calc_mode: 'fixed' | 'per_mu' | undefined
  standard_amount: string | null
  standard_unit: string | null
  fund_source: string | null
  category: string | null
  app_count: number
  beneficiary_count: number
  total_apply: number
  total_actual: number
}

interface SubsidyRecordsPageProps {
  subsidyType: StatsType
  onBack: () => void
  farmerName?: string
}

export default function SubsidyRecordsPage({ subsidyType, onBack, farmerName }: SubsidyRecordsPageProps) {
  const { toast, show } = useToast()

  // Tab状态管理
  const [activeTab, setActiveTab] = useState<'preApply' | 'disbursement' | 'proxy' | 'precheckHistory' | 'projectProgress'>('preApply')
  const switchTab = (tab: 'preApply' | 'disbursement' | 'proxy' | 'precheckHistory' | 'projectProgress') => {
    setActiveTab(tab)
    if (tab !== 'precheckHistory' && tab !== 'projectProgress') {
      setPage(1)
      setSelectedIds([])
    }
  }

  // 两个列表分别维护独立的搜索和筛选状态
  const [searchPreApply, setSearchPreApply] = useState(farmerName || '')
  const [searchDisbursement, setSearchDisbursement] = useState('')

  // 搜索触发计数器 — 搜索按钮点击时递增，强制 load 重新触发
  const [searchTrigger, setSearchTrigger] = useState(0)

  // 外部传入 farmerName 时，初始化搜索框内容
  useEffect(() => {
    if (farmerName) {
      setSearchPreApply(farmerName)
      setActiveTab('preApply')
      setPage(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmerName])
  const [filtersPreApply, setFiltersPreApply] = useState({
    village: '',
    payStatus: '',
    minAmount: '',
    maxAmount: '',
    dateFrom: '',
    dateTo: ''
  })
  const [filtersDisbursement, setFiltersDisbursement] = useState({
    village: '',
    payStatus: '',
    minAmount: '',
    maxAmount: '',
    dateFrom: '',
    dateTo: ''
  })

  // 当前激活的搜索和筛选
  const search = activeTab === 'preApply' ? searchPreApply : searchDisbursement
  const filters = activeTab === 'preApply' ? filtersPreApply : filtersDisbursement

  // 列表状态
  const [apps, setApps] = useState<ApplicationSearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  // 村庄列表
  const [villages, setVillages] = useState<string[]>([])
  const [loadingVillages, setLoadingVillages] = useState(false)

  // 表单相关状态
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ApplicationOut | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [templates, setTemplates] = useState<ExcelColumnTemplate[]>([])
  const [form, setForm] = useState<Partial<ApplicationCreate> & { proxy_remark?: string }>({
    pay_status: 2, subsidy_type_id: subsidyType.id, apply_year: subsidyType.subsidy_year,
  })
  const [idInput, setIdInput] = useState('')
  const [farmerHint, setFarmerHint] = useState('')
  const [farmerId, setFarmerId] = useState<number | null>(null)

  // 代领表单相关状态
  const [proxyAddOpen, setProxyAddOpen] = useState(false)
  const [proxyImportOpen, setProxyImportOpen] = useState(false)
  const [proxyRefreshKey, setProxyRefreshKey] = useState(0)
  const [proxyForm, setProxyForm] = useState<{
    beneficiary_id_card: string
    proxy_id_card: string
    proxy_type: string
    remark: string
  }>({ beneficiary_id_card: '', proxy_id_card: '', proxy_type: '代领', remark: '' })

  // 排序
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const handleSortChange = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field); setSortDir('desc')
    }
    setPage(1)
  }

  // 预检相关
  const [preCheckLoading, setPreCheckLoading] = useState(false)
  const [preCheckResults, setPreCheckResults] = useState<CheckResult | null>(null)

  // 发放 vs 预申请比对
  const [checkingDisbursement, setCheckingDisbursement] = useState(false)
  const [disbCompareResult, setDisbCompareResult] = useState<{
    missing: { id_card: string; real_name: string; village?: string; apply_area?: number }[]
    extra: { id_card: string; real_name: string; village?: string; apply_area?: number }[]
    areaDiff: { id_card: string; real_name: string; app_area: number; pay_area: number; diff: number }[]
  } | null>(null)
  const [disbCompareOpen, setDisbCompareOpen] = useState(false)

  const runDisbursementCheck = async () => {
    if (!subsidyType) return
    setCheckingDisbursement(true)
    try {
      const [appRes, payRes] = await Promise.all([
        fetch(`/api/subsidies/applications/export?subsidy_type_id=${subsidyType.id}&year=${subsidyType.subsidy_year}`).then(r => r.json()),
        fetch(`/api/subsidies/payments/export?subsidy_type_id=${subsidyType.id}&year=${subsidyType.subsidy_year}`).then(r => r.json()),
      ])
      const apps = appRes.items || []
      const pays = payRes.items || []

      const appMap: Record<string, any> = {}
      for (const a of apps) { const ic = a.id_card || ''; if (ic) appMap[ic] = { real_name: a.farmer_name, village: a.village, apply_area: Number(a.apply_area || 0) } }
      const payMap: Record<string, any> = {}
      for (const p of pays) { const ic = p.id_card || ''; if (ic) payMap[ic] = { real_name: p.farmer_name, village: p.village, apply_area: Number(p.apply_area || 0) } }

      const appIds = new Set(Object.keys(appMap)), payIds = new Set(Object.keys(payMap))
      setDisbCompareResult({
        missing: [...appIds].filter(ic => !payIds.has(ic)).map(ic => ({ id_card: ic, ...appMap[ic] })),
        extra: [...payIds].filter(ic => !appIds.has(ic)).map(ic => ({ id_card: ic, ...payMap[ic] })),
        areaDiff: [...appIds].filter(ic => payIds.has(ic)).map(ic => ({ id_card: ic, real_name: appMap[ic].real_name, app_area: appMap[ic].apply_area, pay_area: payMap[ic].apply_area, diff: payMap[ic].apply_area - appMap[ic].apply_area })).filter((a: any) => Math.abs(a.diff) > 0.001),
      })
      setDisbCompareOpen(true)
    } catch (e) {
      show('比对失败: ' + (e as Error).message, 'err')
    } finally {
      setCheckingDisbursement(false)
    }
  }

  // 导出选项状态
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [splitByVillage, setSplitByVillage] = useState(false)
  const [selectedSheets, setSelectedSheets] = useState<SheetKey[]>(['summary'])
  const [isExporting, setIsExporting] = useState(false)

  // 批量选择状态
  const [selectedTmplId, setSelectedTmplId] = useState<number | null>(null)

  // 统计状态
  const [stats, setStats] = useState<{
    totalAmount: number
    totalFarmers: number
    totalArea: number
    villageDistribution: Array<{ village: string; amount: number; count: number; area: number }>
    yearComparison: {
      current_year: number
      compare_year: number
      compare_type_id: number
      compare_type_name: string
      new_farmers_count: number
      removed_farmers_count: number
      total_apply_area: number
      total_farmers: number
      new_farmers: number[]
      removed_farmers: number[]
    } | null
  }>({
    totalAmount: 0,
    totalFarmers: 0,
    totalArea: 0,
    villageDistribution: [],
    yearComparison: null
  })

  const [comparableTypes, setComparableTypes] = useState<Array<{ id: number; subsidy_name: string; subsidy_year: number }>>([])
  const [selectedCompareType, setSelectedCompareType] = useState<number | null>(null)

  // 面积统计状态
  const [areaStats, setAreaStats] = useState<api.AreaStatsResponse | null>(null)
  const [loadingAreaStats, setLoadingAreaStats] = useState(false)
  const [areaStatsExpanded, setAreaStatsExpanded] = useState(false)

  // 当 subsidyType 改变时重置状态
  useEffect(() => {
    setApps([])
    setTotal(0)
    setPage(1)
    setSearchPreApply('')
    setSearchDisbursement('')
    setFiltersPreApply({ village: '', payStatus: '', minAmount: '', maxAmount: '', dateFrom: '', dateTo: '' })
    setFiltersDisbursement({ village: '', payStatus: '', minAmount: '', maxAmount: '', dateFrom: '', dateTo: '' })
  }, [subsidyType.id])

  // 处理筛选变化
  const handleFilterChange = (field: string, value: string) => {
    if (activeTab === 'preApply') {
      setFiltersPreApply(prev => ({ ...prev, [field]: value }))
    } else {
      setFiltersDisbursement(prev => ({ ...prev, [field]: value }))
    }
    setPage(1)
  }

  // 处理搜索变化
  const handleSearchChange = (value: string) => {
    if (activeTab === 'preApply') {
      setSearchPreApply(value)
    } else {
      setSearchDisbursement(value)
    }
  }

  // 清除所有筛选
  const clearFilters = () => {
    if (activeTab === 'preApply') {
      setFiltersPreApply({ village: '', payStatus: '', minAmount: '', maxAmount: '', dateFrom: '', dateTo: '' })
      setSearchPreApply('')
    } else {
      setFiltersDisbursement({ village: '', payStatus: '', minAmount: '', maxAmount: '', dateFrom: '', dateTo: '' })
      setSearchDisbursement('')
    }
    setPage(1)
  }

  // 批量选择相关函数
  const toggleSelectAll = () => {
    if (selectedIds.length === apps.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(apps.map(a => a.id))
    }
  }

  const toggleSelect = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(selectedId => selectedId !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  // 批量删除选中的记录
  const batchDelete = async () => {
    if (selectedIds.length === 0) {
      show('请先选择要删除的记录', 'err')
      return
    }
    if (!confirm(`确定要删除选中的 ${selectedIds.length} 条记录吗？此操作不可恢复。`)) {
      return
    }
    try {
      const endpoint = activeTab === 'disbursement'
        ? '/api/subsidies/payments/batch-delete'
        : '/api/subsidies/applications/batch-delete'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      })
      if (!response.ok) throw new Error('批量删除失败')
      show(`✓ 已删除 ${selectedIds.length} 条记录`)
      setSelectedIds([])
      load()
    } catch (error) {
      console.error('批量删除失败:', error)
      show('批量删除失败: ' + (error as Error).message, 'err')
    }
  }

  // 删除全部记录
  const [deletingAll, setDeletingAll] = useState(false)
  const deleteAll = async () => {
    if (!apps || apps.length === 0) {
      show('没有可删除的记录', 'err')
      return
    }
    if (!confirm(`⚠️ 确定要删除全部 ${total} 条记录吗？此操作不可恢复。`)) {
      return
    }
    setDeletingAll(true)
    try {
      const endpoint = activeTab === 'disbursement'
        ? '/api/subsidies/payments/batch-delete'
        : '/api/subsidies/applications/batch-delete'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete_all: true, subsidy_type_id: subsidyType.id })
      })
      if (!response.ok) throw new Error('删除全部失败')
      const result = await response.json()
      show(`✓ 已删除全部 ${result.deleted} 条记录`)
      setSelectedIds([])
      load()
    } catch (error) {
      console.error('删除全部失败:', error)
      show('删除全部失败: ' + (error as Error).message, 'err')
    } finally {
      setDeletingAll(false)
    }
  }

  // 代领新增
  const handleProxyAdd = async () => {
    if (!proxyForm.beneficiary_id_card.trim()) {
      show('请输入被代领人身份证', 'err')
      return
    }
    if (!proxyForm.proxy_id_card.trim()) {
      show('请输入代领人身份证', 'err')
      return
    }
    try {
      // 先通过身份证查找农户ID
      const beneficiaryResp = await fetch('/api/farmers/batch-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_cards: [proxyForm.beneficiary_id_card.trim()] })
      }).then(r => r.json())

      const proxyResp = await fetch('/api/farmers/batch-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_cards: [proxyForm.proxy_id_card.trim()] })
      }).then(r => r.json())

      const beneficiaryId = beneficiaryResp.results?.[proxyForm.beneficiary_id_card.trim()]
      const proxyId = proxyResp.results?.[proxyForm.proxy_id_card.trim()]

      if (!beneficiaryId) {
        show('未找到被代领人信息，请检查身份证号', 'err')
        return
      }
      if (!proxyId) {
        show('未找到代领人信息，请检查身份证号', 'err')
        return
      }

      await api.createProxy({
        beneficiary_farmer_id: beneficiaryId,
        proxy_farmer_id: proxyId,
        proxy_type: proxyForm.proxy_type,
        subsidy_type_id: subsidyType.id,
        remark: proxyForm.remark || undefined,
      })
      show('✓ 代领关系创建成功')
      setProxyAddOpen(false)
      setProxyRefreshKey(prev => prev + 1)
      setProxyForm({ beneficiary_id_card: '', proxy_id_card: '', proxy_type: '代领', remark: '' })
    } catch (error) {
      show('创建失败: ' + (error as Error).message, 'err')
    }
  }

  // 代领Excel导入
  const handleProxyImport = async (rows: Record<string, unknown>[]) => {
    const proxies: { beneficiary_id_card: string; proxy_id_card: string; proxy_type: string; remark: string }[] = []
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      // ExcelImportWithMapping passes mapped field names (system_field)
      const beneficiaryIdCard = String(row['beneficiary_id_card'] || row['被代领人身份证'] || '').trim()
      const proxyIdCard = String(row['proxy_id_card'] || row['代领人身份证'] || '').trim()

      if (!beneficiaryIdCard || !proxyIdCard) {
        errors.push(`第${i + 2}行：被代领人或代领人身份证为空`)
        continue
      }

      proxies.push({
        beneficiary_id_card: beneficiaryIdCard,
        proxy_id_card: proxyIdCard,
        proxy_type: String(row['proxy_type'] || row['代领类型'] || '代领').trim(),
        remark: String(row['remark'] || row['备注'] || '').trim(),
      })
    }

    if (proxies.length === 0) {
      show('没有有效的代领数据', 'err')
      return { created: 0, skipped: 0, errors }
    }

    // 批量查找农户ID
    const allIdCards = [...new Set(proxies.flatMap(p => [p.beneficiary_id_card, p.proxy_id_card]))]
    const lookupResp = await fetch('/api/farmers/batch-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_cards: allIdCards })
    }).then(r => r.json())

    const results = lookupResp.results || {}
    let successCount = 0

    for (const p of proxies) {
      const beneficiaryId = results[p.beneficiary_id_card]
      const proxyId = results[p.proxy_id_card]

      if (!beneficiaryId || !proxyId) {
        errors.push(`身份证匹配失败: ${p.beneficiary_id_card} -> ${beneficiaryId ? '✓' : '✗'}, ${p.proxy_id_card} -> ${proxyId ? '✓' : '✗'}`)
        continue
      }

      try {
        // 后台自动处理：代领人 + 项目 + 年份 → 发放记录 → 复制给受益人
        await api.createProxy({
          beneficiary_farmer_id: beneficiaryId,
          proxy_farmer_id: proxyId,
          proxy_type: p.proxy_type,
          subsidy_type_id: subsidyType.id,
          remark: p.remark || undefined,
        })
        successCount++
      } catch (e: any) {
        const msg = e?.message || ''
        if (msg.includes('重复') || msg.includes('已存在')) {
          errors.push(`重复: ${p.beneficiary_id_card} (已存在代领关系)`)
        } else {
          errors.push(`创建失败: ${p.beneficiary_id_card} - ${msg}`)
        }
      }
    }

    show(`✓ 成功导入 ${successCount} 条代领关系${errors.length > 0 ? `，失败 ${errors.length} 条` : ''}`, errors.length > 0 ? 'err' : 'ok')
    return { created: successCount, skipped: proxies.length - successCount, errors }
  }

  // 获取村庄列表
  const loadVillages = useCallback(async () => {
    setLoadingVillages(true)
    try {
      const params = new URLSearchParams({
        subsidy_type_id: String(subsidyType.id),
        year: String(subsidyType.subsidy_year)
      })
      const response = await fetch(`/api/subsidies/applications/villages?${params}`)
      if (!response.ok) throw new Error('获取村庄列表失败')
      const data = await response.json()
      setVillages(data.villages || [])
    } catch (error) {
      console.error('加载村庄列表失败:', error)
    } finally {
      setLoadingVillages(false)
    }
  }, [subsidyType.id, subsidyType.subsidy_year])

  // 加载数据
  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (activeTab === 'disbursement') {
        const params: Record<string, string | number> = {
          page, page_size: 20,
          subsidy_type_id: subsidyType.id,
          payment_year: subsidyType.subsidy_year,
        }
        if (search) params.search = search
        if (filters.payStatus) params.pay_status = filters.payStatus
        if (filters.village) params.village_name = filters.village
        if (filters.dateFrom) params.date_from = filters.dateFrom
        if (filters.dateTo) params.date_to = filters.dateTo
        if (sortField) { params.sort_field = sortField; params.sort_dir = sortDir }

        const res = await fetch(`/api/subsidies/payments?${new URLSearchParams(params as Record<string, string>)}`).then(r => r.json())
        setApps(res.items.map((p: any) => ({
          id: p.id,
          farmer_id: p.farmer_id,
          farmer_name: p.farmer_name,
          village: p.village_name,
          group_no: p.group_no,
          subsidy_type_id: p.subsidy_type_id,
          subsidy_name: p.subsidy_name,
          apply_year: p.payment_year,
          apply_area: p.apply_area,
          contract_area: p.contract_area,
          trust_area: p.trust_area,
          no_subsidy_area: p.no_subsidy_area,
          actual_amount: p.amount,
          pay_status: p.pay_status,
          pay_date: p.payment_date,
          bank_card_masked: p.bank_card_masked,
          bank_name: p.bank_name,
          remark: p.remark,
          proxy_remark: p.proxy_remark,
          is_proxy: p.is_proxy,
        })))
        setTotal(res.total)
        setLoading(false)
        return
      }

      // 预申请列表
      const params: Record<string, string | number> = {
        page, page_size: 20,
        subsidy_type_id: subsidyType.id,
        year: subsidyType.subsidy_year,
      }
      if (search) params.search = search
      if (filters.payStatus) params.pay_status = filters.payStatus
      if (filters.village) params.village_name = filters.village
      if (filters.minAmount) params.min_amount = filters.minAmount
      if (filters.maxAmount) params.max_amount = filters.maxAmount
      if (filters.dateFrom) params.date_from = filters.dateFrom
      if (filters.dateTo) params.date_to = filters.dateTo
      if (sortField) { params.sort_field = sortField; params.sort_dir = sortDir }

      const res = await api.searchApplications(params)
      setApps(res.items)
      setTotal(res.total)
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }, [page, search, filters, subsidyType.id, subsidyType.subsidy_year, activeTab, searchTrigger, sortField, sortDir])

  useEffect(() => {
    load()
    loadVillages()
  }, [load, loadVillages])

  // 执行数据预检
  const runPreCheck = async () => {
    if (apps.length === 0) {
      show('暂无数据可预检', 'err')
      return
    }
    setPreCheckLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('subsidy_typeId', String(subsidyType.id))
      if (filters.payStatus) {
        params.append('payStatus', String(filters.payStatus))
      } else {
        params.append('payStatus', activeTab === 'preApply' ? '0' : '1,2')
      }
      if (filters.village) params.append('villageName', filters.village)

      const response = await fetch(`/api/subsidies/applications/precheck?${params}`, { method: 'POST' })
      if (!response.ok) throw new Error('预检请求失败')

      const result = await response.json()
      const summary = result.summary || {}
      const okCount = summary.ok_rows || 0
      const errorCount = summary.error_rows || 0
      const totalCount = summary.total_rows || 0

      setPreCheckResults(result as CheckResult)
      show(`预检完成：共${totalCount}条，${okCount}条通过，${errorCount}条错误，${summary.gender_mismatch || 0}条警告`)
    } catch (error) {
      show('数据预检失败：' + (error as Error).message, 'err')
    } finally {
      setPreCheckLoading(false)
    }
  }

  // 切换sheet选择
  const toggleSheet = (sheetKey: SheetKey) => {
    if (selectedSheets.includes(sheetKey)) {
      setSelectedSheets(selectedSheets.filter(s => s !== sheetKey))
    } else {
      setSelectedSheets([...selectedSheets, sheetKey])
    }
  }

  // 选择/取消选择所有sheet
  const toggleAllSheets = () => {
    if (selectedSheets.length === PRECHECK_SHEET_OPTIONS.length) {
      setSelectedSheets(['summary'])
    } else {
      setSelectedSheets(PRECHECK_SHEET_OPTIONS.map(opt => opt.key as SheetKey))
    }
  }

  // 导出带选项的报告
  const handleExportWithOptions = async () => {
    if (!preCheckResults || isExporting) return

    setIsExporting(true)
    try {
      await exportPrecheckReportWithOptions(
        preCheckResults,
        {
          splitByVillage,
          selectedSheets: selectedSheets.length > 0 ? selectedSheets : ['summary']
        },
        '补贴项目预检报告'
      )
      setExportModalOpen(false)
    } catch (error) {
      console.error('导出失败:', error)
      show('导出失败，请重试', 'err')
    } finally {
      setIsExporting(false)
    }
  }

  // 获取可对比项目列表
  const loadComparableTypes = useCallback(async () => {
    if (!subsidyType.category) return
    try {
      const response = await fetch(`/api/subsidies/types/comparable?category=${encodeURIComponent(subsidyType.category)}&current_type_id=${subsidyType.id}`)
      if (!response.ok) throw new Error('获取可对比项目失败')
      const data = await response.json()
      setComparableTypes(data)
    } catch (error) {
      console.error('加载可对比项目失败:', error)
    }
  }, [subsidyType.category, subsidyType.id])

  // 获取全部统计数据
  const loadStats = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        subsidy_type_id: String(subsidyType.id),
        year: String(subsidyType.subsidy_year)
      })
      if (selectedCompareType) {
        params.append('compare_type_id', String(selectedCompareType))
      }
      const response = await fetch(`/api/subsidies/applications/stats?${params}`)
      if (!response.ok) throw new Error('获取统计数据失败')
      const data = await response.json()
      setStats(data)
    } catch (error) {
      console.error('加载统计数据失败:', error)
      show('加载统计数据失败', 'err')
    }
  }, [subsidyType.id, subsidyType.subsidy_year, selectedCompareType])

  // 加载面积统计数据
  const loadAreaStats = useCallback(async () => {
    setLoadingAreaStats(true)
    try {
      const dataSource = activeTab === 'disbursement' ? 'payment' : 'application'
      const data = await api.getAreaStatsByVillage(subsidyType.id, subsidyType.subsidy_year, dataSource)
      setAreaStats(data)
    } catch (error) {
      console.error('加载面积统计失败:', error)
      show('加载面积统计失败', 'err')
    } finally {
      setLoadingAreaStats(false)
    }
  }, [subsidyType.id, subsidyType.subsidy_year, activeTab, show])

  // 导出面积统计Excel
  const handleExportAreaStats = () => {
    if (!areaStats) return
    exportAreaStatsToExcel(areaStats, subsidyType.subsidy_name, subsidyType.subsidy_year)
  }

  useEffect(() => {
    loadStats()
    loadComparableTypes()
  }, [loadStats, loadComparableTypes])

  useEffect(() => {
    if (areaStatsExpanded) {
      setAreaStats(null)
      loadAreaStats()
    }
  }, [areaStatsExpanded, activeTab, loadAreaStats])

  // 数据概览展开/收起状态
  const [statsExpanded, setStatsExpanded] = useState(false)

  return (
    <div>
      {/* 面包屑 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={onBack} className="text-sm text-primary hover:underline">← 返回项目列表</button>
        <span className="text-text-muted/50">|</span>
        <span className="font-bold text-text-primary">{subsidyType.subsidy_name}</span>
        <Tag label={`${subsidyType.subsidy_year}年`} color="gray" />
        <Tag label={subsidyType.calc_mode === 'per_mu' ? '按亩计算' : '固定金额'} color={subsidyType.calc_mode === 'per_mu' ? 'blue' : 'purple'} />
        {subsidyType.standard_amount && (
          <span className="text-xs text-text-muted">标准：¥{Number(subsidyType.standard_amount).toFixed(2)}{subsidyType.standard_unit}</span>
        )}
      </div>

      {/* 数据概览 - 可折叠下拉框 */}
      <div className="mb-4 bg-white border border-border rounded-card shadow-card overflow-hidden">
        <button
          onClick={() => setStatsExpanded(prev => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-warm/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">📊 数据概览</span>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">预申请</span>
            {statsExpanded && (
              <span className="text-xs text-text-muted">发放总额 ¥{stats.totalAmount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} · {stats.totalFarmers}人 · 总面积 {stats.totalArea}亩 · {stats.villageDistribution.length}个村</span>
            )}
          </div>
          <span className="text-text-muted text-sm">{statsExpanded ? '▲ 收起' : '▼ 展开'}</span>
        </button>

        {statsExpanded && (
          <div className="px-4 pb-4 border-t border-border/50">
            <div className="flex items-center justify-end gap-2 pt-3 mb-4">
              {subsidyType.category && (
                <select
                  value={selectedCompareType ?? ''}
                  onChange={e => setSelectedCompareType(e.target.value ? Number(e.target.value) : null)}
                  className="px-2 py-1 text-xs border border-border rounded bg-white"
                >
                  <option value="">不对比</option>
                  {comparableTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.subsidy_name} ({t.subsidy_year}年)</option>
                  ))}
                </select>
              )}
              <span className="text-xs text-text-muted">全镇数据统计</span>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-primary/5 border border-primary/10 rounded-card p-4">
                <div className="text-sm text-primary mb-2">发放总额</div>
                <div className="text-2xl font-bold font-mono text-primary">¥{stats.totalAmount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</div>
                <div className="text-sm text-primary mt-2">{stats.totalFarmers}人</div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-card p-4">
                <div className="text-sm text-blue-600 mb-2">涉及村庄</div>
                <div className="text-2xl font-bold text-blue-700">{stats.villageDistribution.length}</div>
                <div className="text-sm text-blue-600 mt-2">个村</div>
              </div>
              <div className="bg-purple-50 border border-purple-100 rounded-card p-4">
                <div className="text-sm text-purple-600 mb-2">总面积</div>
                <div className="text-2xl font-bold font-mono text-purple-700">{stats.totalArea.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}亩</div>
                <div className="text-sm text-purple-600 mt-2">补贴面积合计</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 面积统计 - 可折叠下拉框 */}
      <div className="mb-4 bg-white border border-border rounded-card shadow-card overflow-hidden">
        <button
          onClick={() => setAreaStatsExpanded(prev => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-warm/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">📐 面积统计</span>
            {activeTab === 'disbursement' ? (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">发放</span>
            ) : activeTab === 'preApply' ? (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">预申请</span>
            ) : (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">预申请</span>
            )}
            {areaStatsExpanded && areaStats && (
              <span className="text-xs text-text-muted">
                合计：{areaStats.total.total_apply_area}亩 / {areaStats.by_village.length}个村
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {areaStats && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleExportAreaStats()
                }}
                className="px-3 py-1 text-xs bg-primary  rounded-btn hover:bg-primary/90"
              >
                ↓ 导出Excel
              </button>
            )}
            <span className="text-text-muted text-sm">{areaStatsExpanded ? '▲ 收起' : '▼ 展开'}</span>
          </div>
        </button>

        {areaStatsExpanded && (
          <div className="px-4 pb-4 border-t border-border/50">
            {loadingAreaStats ? (
              <div className="py-8 text-center text-text-muted">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-stone-300 border-t-emerald-500 rounded-full mr-2" />
                加载中...
              </div>
            ) : areaStats ? (
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-warm/30 border-b border-border">
                      <th className="px-3 py-2 text-left font-medium text-text-primary text-sm">村名</th>
                      <th className="px-1.5 py-2 text-right font-medium text-text-primary text-sm">农户数</th>
                      <th className="px-1.5 py-2 text-right font-medium text-text-primary text-sm">记录数</th>
                      <th className="px-1.5 py-2 text-center font-medium text-text-primary text-[11px] leading-tight max-w-[60px]">计入超限<br/>面积(亩)</th>
                      <th className="px-1.5 py-2 text-center font-medium text-text-primary text-[11px] leading-tight max-w-[60px]">不计超限<br/>面积(亩)</th>
                      <th className="px-1.5 py-2 text-center font-medium text-text-primary text-[11px] leading-tight max-w-[60px]">承包地<br/>面积(亩)</th>
                      <th className="px-1.5 py-2 text-center font-medium text-text-primary text-[11px] leading-tight max-w-[60px]">代耕代种<br/>面积(亩)</th>
                      <th className="px-1.5 py-2 text-center font-medium text-text-primary text-[11px] leading-tight max-w-[60px]">不予补贴<br/>面积(亩)</th>
                      <th className="px-1.5 py-2 text-right font-medium text-text-primary text-sm">金额(元)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {areaStats.by_village.map((row, idx) => (
                      <tr key={idx} className="hover:bg-warm/30">
                        <td className="px-3 py-2 text-text-primary">{row.village}</td>
                        <td className="px-1.5 py-2 text-right text-text-primary">{row.farmer_count}</td>
                        <td className="px-1.5 py-2 text-right text-text-primary">{row.record_count}</td>
                        <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{row.total_apply_area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                        <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{row.total_apply_area_no_calc.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                        <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{row.total_contract_area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                        <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{row.total_trust_area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                        <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{row.total_no_subsidy_area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                        <td className="px-1.5 py-2 text-right font-mono text-primary text-xs">¥{row.total_amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    <tr className="bg-warm/30 font-semibold">
                      <td className="px-3 py-2 text-text-primary">{areaStats.total.village}</td>
                      <td className="px-1.5 py-2 text-right text-text-primary">{areaStats.total.farmer_count}</td>
                      <td className="px-1.5 py-2 text-right text-text-primary">{areaStats.total.record_count}</td>
                      <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{areaStats.total.total_apply_area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                      <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{areaStats.total.total_apply_area_no_calc.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                      <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{areaStats.total.total_contract_area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                      <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{areaStats.total.total_trust_area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                      <td className="px-1.5 py-2 text-right font-mono text-text-primary text-xs">{areaStats.total.total_no_subsidy_area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                      <td className="px-1.5 py-2 text-right font-mono text-primary text-xs">¥{areaStats.total.total_amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 text-xs text-text-muted flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full font-medium text-xs ${areaStats.data_source === 'payment' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {areaStats.data_source === 'payment' ? '发放数据' : '预申请数据'}
                  </span>
                  {areaStats.by_village.length > 0 && '· 代领记录已去重，仅统计受益人'}
                </div>
                {areaStats.villages_without_data && areaStats.villages_without_data.length > 0 && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-card">
                    <div className="text-xs font-medium text-amber-700 mb-1.5">
                      ⚠️ 以下村无 {areaStats.data_source === 'payment' ? '发放' : '预申请'}数据
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {areaStats.villages_without_data.map(v => (
                        <span key={v} className="px-2 py-0.5 bg-white border border-amber-200 rounded text-xs text-amber-700">
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-text-muted">暂无数据</div>
            )}
          </div>
        )}
      </div>

      {/* Tab切换 */}
      <div className="flex items-center gap-2 mb-4 border-b border-border">
        <button
          onClick={() => switchTab('preApply')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'preApply' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          📋 预申请列表
        </button>
        <button
          onClick={() => switchTab('disbursement')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'disbursement' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          💰 发放信息列表
        </button>
        <button
          onClick={() => switchTab('proxy')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'proxy' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          👥 代领关系
        </button>
        <button
          onClick={() => switchTab('projectProgress')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'projectProgress' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          📊 项目管理
        </button>
        <button
          onClick={() => switchTab('precheckHistory')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'precheckHistory' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          📋 预检历史
        </button>
        <div className="ml-auto flex items-center gap-2">
          {activeTab === 'preApply' && (
            <button
              onClick={runPreCheck}
              disabled={preCheckLoading || apps.length === 0}
              className={`px-3 py-1.5 text-sm rounded-btn flex items-center gap-1.5 ${
                preCheckLoading ? 'bg-blue-100 border border-blue-200 text-blue-600' : 'bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100'
              }`}
            >
              {preCheckLoading ? (
                <><span className="w-3 h-3 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />预检中…</>
              ) : '🔍 全部数据预检'}
            </button>
          )}
          {activeTab === 'proxy' && (
            <>
              <button onClick={() => setProxyImportOpen(true)}
                className="px-3 py-1.5 text-sm border border-blue-200 text-blue-700 rounded-btn hover:bg-blue-50 flex items-center gap-1.5">
                ↑ Excel导入
              </button>
              <button onClick={() => setProxyAddOpen(true)}
                className="px-3 py-1.5 text-sm bg-primary  rounded-btn hover:bg-primary/90">
                ＋ 新增代领
              </button>
            </>
          )}
          {activeTab !== 'proxy' && activeTab !== 'precheckHistory' && (<>
              <span className="text-xs text-text-muted">共 {total} 条</span>
              <div className="flex gap-2 items-center">
                {selectedIds.length > 0 && (
                  <button onClick={batchDelete}
                    className="px-3 py-2 text-sm bg-red-600  rounded-btn hover:bg-red-700 flex items-center gap-1.5">
                    🗑️ 删除选中 ({selectedIds.length})
                  </button>
                )}
                {activeTab === 'disbursement' && (
                  <button onClick={runDisbursementCheck} disabled={checkingDisbursement}
                    className="px-3 py-2 text-sm border-2 border-amber-300 bg-amber-50 text-amber-700 rounded-btn hover:bg-amber-100 hover:border-amber-400 transition-all font-medium whitespace-nowrap disabled:opacity-50 flex items-center gap-1.5">
                    {checkingDisbursement ? '⏳' : '🔍'} 检查
                  </button>
                )}
                <button onClick={deleteAll} disabled={deletingAll}
                  className={`px-3 py-2 text-sm rounded-btn flex items-center gap-1.5 ${deletingAll ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-600/80 hover:bg-red-700'}`}>
                  {deletingAll ? '⏳ 删除中...' : '🗑️ 删除全部'}
                </button>
                <button onClick={() => setAddOpen(true)}
                  className="px-3 py-2 text-sm border-2 border-green-500 bg-green-500 text-white rounded-btn hover:bg-green-600 hover:border-green-600 shadow-sm transition-all font-medium">
                  ＋ 批量导入
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tab内容 */}
      {activeTab === 'preApply' && (
        <PreApplyList
          subsidyType={subsidyType}
          apps={apps}
          total={total}
          page={page}
          loading={loading}
          selectedIds={selectedIds}
          search={searchPreApply}
          filters={filtersPreApply}
          villages={villages}
          loadingVillages={loadingVillages}
          templates={templates}
          addOpen={addOpen}
          editTarget={editTarget}
          deleteId={deleteId}
          form={form}
          idInput={idInput}
          farmerHint={farmerHint}
          farmerId={farmerId}
          setApps={setApps}
          setTotal={setTotal}
          setPage={setPage}
          setLoading={setLoading}
          setSelectedIds={setSelectedIds}
          setSearch={setSearchPreApply}
          setFilters={setFiltersPreApply}
          setAddOpen={setAddOpen}
          setEditTarget={setEditTarget}
          setDeleteId={setDeleteId}
          setForm={setForm}
          setIdInput={setIdInput}
          setFarmerHint={setFarmerHint}
          setFarmerId={setFarmerId}
          setTemplates={setTemplates}
          setLoadingVillages={setLoadingVillages}
          setVillages={setVillages}
          show={show}
          load={load}
          onSearch={() => { setPage(1); setSearchTrigger(n => n + 1) }}
          handleFilterChange={handleFilterChange}
          handleSearchChange={handleSearchChange}
          clearFilters={clearFilters}
          sortField={sortField} sortDir={sortDir} onSortChange={handleSortChange}
        />
      )}

      {activeTab === 'disbursement' && (
        <DisbursementList
          subsidyType={subsidyType}
          apps={apps}
          total={total}
          page={page}
          loading={loading}
          selectedIds={selectedIds}
          search={searchDisbursement}
          filters={filtersDisbursement}
          villages={villages}
          loadingVillages={loadingVillages}
          templates={templates}
          addOpen={addOpen}
          editTarget={editTarget}
          deleteId={deleteId}
          form={form}
          idInput={idInput}
          farmerHint={farmerHint}
          farmerId={farmerId}
          setApps={setApps}
          setTotal={setTotal}
          setPage={setPage}
          setLoading={setLoading}
          setSelectedIds={setSelectedIds}
          setSearch={setSearchDisbursement}
          setFilters={setFiltersDisbursement}
          setAddOpen={setAddOpen}
          setEditTarget={setEditTarget}
          setDeleteId={setDeleteId}
          setForm={setForm}
          setIdInput={setIdInput}
          setFarmerHint={setFarmerHint}
          setFarmerId={setFarmerId}
          setTemplates={setTemplates}
          setLoadingVillages={setLoadingVillages}
          setVillages={setVillages}
          show={show}
          load={load}
          onSearch={() => { setPage(1); setSearchTrigger(n => n + 1) }}
          handleFilterChange={handleFilterChange}
          handleSearchChange={handleSearchChange}
          clearFilters={clearFilters}
          sortField={sortField} sortDir={sortDir} onSortChange={handleSortChange}
        />
      )}

      {activeTab === 'proxy' && (
        <ProxyList key={proxyRefreshKey} subsidyType={subsidyType} show={show} />
      )}

      {activeTab === 'precheckHistory' && (
        <PrecheckHistoryTab
          subsidyType={subsidyType}
          preCheckResults={preCheckResults}
        />
      )}

      {activeTab === 'projectProgress' && (
        <ProjectProgressTab subsidyType={subsidyType} />
      )}

      {/* 预检结果展示 */}
      {preCheckResults && activeTab === 'preApply' && (
        <div className="mb-4 bg-white border border-border rounded-card overflow-hidden shadow-card">
          <div className="px-4 py-3 border-b border-border/50 bg-warm/30 flex justify-between items-center">
            <span className="font-semibold text-text-primary text-sm">🔍 数据预检结果</span>
            <div className="flex gap-2 items-center">
              <button onClick={() => { setSelectedSheets(getDefaultSelectedSheets(preCheckResults)); setExportModalOpen(true) }}
                className="px-3 py-1.5 text-xs bg-primary  rounded-btn hover:bg-primary/90">↓ 导出报告 Excel</button>
              <button onClick={() => setPreCheckResults(null)} className="text-xs text-text-muted hover:text-text-primary">✕ 关闭</button>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-5 gap-3">
              <div className={`rounded-card p-3 text-center ${(preCheckResults.summary?.ok_rows || 0) > 0 ? 'bg-primary/5 border border-primary/10' : 'bg-warm/30 border border-border/50'}`}>
                <div className="text-lg font-bold text-primary">{preCheckResults.summary?.ok_rows || 0}</div>
                <div className="text-xs text-text-muted">通过</div>
              </div>
              <div className={`rounded-card p-3 text-center ${(preCheckResults.summary?.error_rows || 0) > 0 ? 'bg-red-50 border border-red-100' : 'bg-warm/30 border border-border/50'}`}>
                <div className="text-lg font-bold text-red-600">{preCheckResults.summary?.error_rows || 0}</div>
                <div className="text-xs text-text-muted">错误</div>
              </div>
              <div className={`rounded-card p-3 text-center ${(preCheckResults.summary?.area_anomalies || 0) > 0 ? 'bg-orange-50 border border-orange-100' : 'bg-warm/30 border border-border/50'}`}>
                <div className="text-lg font-bold text-orange-600">{preCheckResults.summary?.area_anomalies || 0}</div>
                <div className="text-xs text-text-muted">面积异常</div>
              </div>
              <div className={`rounded-card p-3 text-center ${(preCheckResults.summary?.error_library_hits || 0) > 0 ? 'bg-red-100 border border-red-200' : 'bg-warm/30 border border-border/50'}`}>
                <div className="text-lg font-bold text-red-700">{preCheckResults.summary?.error_library_hits || 0}</div>
                <div className="text-xs text-text-muted">错误库命中</div>
              </div>
              <div className={`rounded-card p-3 text-center ${(preCheckResults.changed_farmers?.length || 0) > 0 ? 'bg-blue-50 border border-blue-100' : 'bg-warm/30 border border-border/50'}`}>
                <div className="text-lg font-bold text-blue-600">{preCheckResults.changed_farmers?.length || 0}</div>
                <div className="text-xs text-text-muted">字段变更</div>
              </div>
            </div>

            {getPrecheckTableConfigs(subsidyType.season).map(config => {
              const data = preCheckResults[config.field] as any[]
              if (!data || data.length === 0) return null
              return (
                <ResultTable
                  key={config.field}
                  title={typeof config.title === 'function' ? config.title(data.length) : config.title}
                  headers={config.headers}
                  rows={data.map((row, index) => config.rowMapper(row, index))}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* 导出选项对话框 */}
      {exportModalOpen && preCheckResults && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-card shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-text-primary">导出选项</h3>
                <p className="text-xs text-text-muted mt-1">选择导出方式和包含的sheet</p>
              </div>
              <button onClick={() => setExportModalOpen(false)} className="text-text-muted hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-text-primary">分村导出</h4>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={splitByVillage} onChange={(e) => setSplitByVillage(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-stone-300 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                {splitByVillage && getVillagesFromResult(preCheckResults).length > 0 && (
                  <div className="bg-warm/30 border border-border rounded-btn p-3">
                    <p className="text-xs text-text-muted mb-2">涉及的村：</p>
                    <div className="flex flex-wrap gap-1.5">
                      {getVillagesFromResult(preCheckResults).map(village => (
                        <span key={village} className="px-2 py-1 bg-white border border-border rounded text-xs">{village}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-text-primary">选择包含的sheet</h4>
                  <button onClick={toggleAllSheets} className="text-xs text-blue-600 hover:text-blue-800">
                    {selectedSheets.length === PRECHECK_SHEET_OPTIONS.length ? '取消全选' : '全选'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {PRECHECK_SHEET_OPTIONS.map(opt => {
                    const data = preCheckResults?.[opt.key as keyof CheckResult] as any[] | undefined
                    const count = data?.length || 0
                    const isSelected = selectedSheets.includes(opt.key)
                    const hasData = count > 0 || opt.key === 'summary'
                    return (
                      <label key={opt.key} className={`flex items-center p-3 border rounded-btn cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-blue-300' : 'bg-white border-border hover:bg-warm/30'} ${!hasData ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <input type="checkbox" checked={isSelected} onChange={() => hasData && toggleSheet(opt.key)} disabled={!hasData} className="mr-3 h-4 w-4 text-blue-600 rounded" />
                        <div className="flex-1">
                          <div className="font-medium text-sm text-text-primary">{opt.label}</div>
                          {opt.hasCount && <div className="text-xs text-text-muted mt-1">{count > 0 ? `${count}条数据` : '无数据'}</div>}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <button onClick={() => setExportModalOpen(false)} className="px-4 py-2 text-sm border border-border rounded-btn bg-white text-text-primary hover:bg-warm/30">取消</button>
              <button onClick={handleExportWithOptions} disabled={isExporting || selectedSheets.length === 0}
                className="px-4 py-2 text-sm bg-blue-700  rounded-btn hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                {isExporting ? (<><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>导出中...</>) : '导出'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 代领新增表单 */}
      <Modal open={proxyAddOpen} title="新增代领关系" onClose={() => setProxyAddOpen(false)}
        onConfirm={handleProxyAdd} width={480}>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-btn p-3 text-xs text-amber-700">
            请输入被代领人和代领人的身份证信息，系统将自动匹配农户信息。
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">被代领人身份证 *</label>
            <input value={proxyForm.beneficiary_id_card} onChange={e => setProxyForm(f => ({ ...f, beneficiary_id_card: e.target.value }))}
              placeholder="请输入被代领人身份证号"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary font-mono" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">代领人身份证 *</label>
            <input value={proxyForm.proxy_id_card} onChange={e => setProxyForm(f => ({ ...f, proxy_id_card: e.target.value }))}
              placeholder="请输入代领人身份证号"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary font-mono" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">代领类型</label>
            <select value={proxyForm.proxy_type} onChange={e => setProxyForm(f => ({ ...f, proxy_type: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              <option value="代领">代领</option>
              <option value="监护人">监护人</option>
              <option value="委托">委托</option>
              <option value="其他">其他</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">备注</label>
            <textarea rows={2} value={proxyForm.remark} onChange={e => setProxyForm(f => ({ ...f, remark: e.target.value }))}
              placeholder="可选"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
          </div>
        </div>
      </Modal>

      {/* 代领Excel导入 */}
      <ExcelImportWithMapping open={proxyImportOpen} onClose={() => setProxyImportOpen(false)}
        title="代领关系Excel导入"
        templateHeaders={['被代领人身份证*', '代领人身份证*', '代领类型', '备注']}
        templateExample={[{ '被代领人身份证*': '510123196503154231', '代领人身份证*': '510123196503154232', '代领类型': '代领', '备注': '' }]}
        systemFields={PROXY_IMPORT_FIELDS}
        templates={[]}
        onDetectColumns={async (columns) => {
          return {
            columns: columns.map(col => ({
              excel_column: col,
              suggested_field: col.includes('被代领') ? 'beneficiary_id_card' :
                             col.includes('代领') && col.includes('人') ? 'proxy_id_card' :
                             col.includes('类型') ? 'proxy_type' :
                             col.includes('备注') ? 'remark' : null,
              confidence: 0.9,
              alternatives: [],
            })),
            recommended_templates: [],
          }
        }}
        onSaveTemplate={async () => ({ id: 0 })}
        onImport={handleProxyImport}
        onSuccess={() => setProxyRefreshKey(prev => prev + 1)}
      />

      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* 发放 vs 预申请比对弹窗 */}
      <Modal open={disbCompareOpen} title={`🔍 发放 vs 预申请比对 · ${subsidyType?.subsidy_name || ''}`}
        onClose={() => setDisbCompareOpen(false)} confirmText="关闭" onConfirm={() => setDisbCompareOpen(false)}>
        {disbCompareResult && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <div className={`rounded-card p-3 text-center ${disbCompareResult.missing.length > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                <div className={`text-xl font-bold ${disbCompareResult.missing.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{disbCompareResult.missing.length}</div>
                <div className="text-xs text-text-muted">预申请有·发放无</div>
              </div>
              <div className={`rounded-card p-3 text-center ${disbCompareResult.extra.length > 0 ? 'bg-blue-50 border border-blue-200' : 'bg-green-50 border border-green-200'}`}>
                <div className={`text-xl font-bold ${disbCompareResult.extra.length > 0 ? 'text-blue-600' : 'text-green-600'}`}>{disbCompareResult.extra.length}</div>
                <div className="text-xs text-text-muted">发放有·预申请无</div>
              </div>
              <div className={`rounded-card p-3 text-center ${disbCompareResult.areaDiff.length > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                <div className={`text-xl font-bold ${disbCompareResult.areaDiff.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>{disbCompareResult.areaDiff.length}</div>
                <div className="text-xs text-text-muted">面积变化</div>
              </div>
            </div>
            {disbCompareResult.missing.length > 0 && (
              <div>
                <div className="font-semibold text-red-700 mb-1 text-xs">⚠ 预申请有但发放无 ({disbCompareResult.missing.length}人)</div>
                <div className="bg-red-50 border border-red-200 rounded-btn p-2 max-h-40 overflow-y-auto text-xs space-y-0.5">
                  {disbCompareResult.missing.map((m, i) => (
                    <div key={i} className="text-red-700">{m.real_name} <span className="text-red-400 font-mono">({m.id_card.slice(-4)})</span> {m.village && <span className="text-red-400">{m.village}</span>} {m.apply_area ? `${m.apply_area}亩` : ''}</div>
                  ))}
                </div>
              </div>
            )}
            {disbCompareResult.extra.length > 0 && (
              <div>
                <div className="font-semibold text-blue-700 mb-1 text-xs">＋ 发放有但预申请无 ({disbCompareResult.extra.length}人)</div>
                <div className="bg-blue-50 border border-blue-200 rounded-btn p-2 max-h-40 overflow-y-auto text-xs space-y-0.5">
                  {disbCompareResult.extra.map((m, i) => (
                    <div key={i} className="text-blue-700">{m.real_name} <span className="text-blue-400 font-mono">({m.id_card.slice(-4)})</span> {m.village && <span className="text-blue-400">{m.village}</span>} {m.apply_area ? `${m.apply_area}亩` : ''}</div>
                  ))}
                </div>
              </div>
            )}
            {disbCompareResult.areaDiff.length > 0 && (
              <div>
                <div className="font-semibold text-amber-700 mb-1 text-xs">📐 面积变化 ({disbCompareResult.areaDiff.length}人)</div>
                <div className="bg-amber-50 border border-amber-200 rounded-btn p-2 max-h-40 overflow-y-auto text-xs">
                  <table className="w-full">
                    <thead><tr className="text-amber-600"><th className="text-left py-1">姓名</th><th className="text-right py-1">预申请</th><th className="text-right py-1">发放</th><th className="text-right py-1">差额</th></tr></thead>
                    <tbody>
                      {disbCompareResult.areaDiff.map((m, i) => (
                        <tr key={i} className="border-t border-amber-200">
                          <td className="py-1 text-amber-800">{m.real_name} <span className="text-amber-500 font-mono text-xs">({m.id_card.slice(-4)})</span></td>
                          <td className="text-right font-mono">{m.app_area.toFixed(2)}</td>
                          <td className="text-right font-mono">{m.pay_area.toFixed(2)}</td>
                          <td className={`text-right font-mono font-semibold ${m.diff > 0 ? 'text-red-500' : m.diff < 0 ? 'text-green-500' : 'text-text-muted'}`}>{m.diff > 0 ? '+' : ''}{m.diff.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {disbCompareResult.missing.length === 0 && disbCompareResult.extra.length === 0 && disbCompareResult.areaDiff.length === 0 && (
              <div className="text-center py-6 text-green-600 font-medium">✅ 发放与预申请完全一致，无差异</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}