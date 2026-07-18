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
  const [activeTab, setActiveTab] = useState<'preApply' | 'disbursement' | 'proxy' | 'precheckHistory'>('preApply')
  const switchTab = (tab: 'preApply' | 'disbursement' | 'proxy' | 'precheckHistory') => {
    setActiveTab(tab)
    if (tab !== 'precheckHistory') {
      setPage(1)
      setSelectedIds([])
    }
  }

  // 两个列表分别维护独立的搜索和筛选状态
  const [searchPreApply, setSearchPreApply] = useState(farmerName || '')
  const [searchDisbursement, setSearchDisbursement] = useState('')

  // 搜索触发计数器 — 搜索按钮/排序/筛选变化时递增，强制 load 重新触发
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

  // 当前激活的搜索和筛选（数据分析 tab 使用预申请数据源）
  const search = activeTab === 'disbursement' ? searchDisbursement : searchPreApply
  const filters = activeTab === 'disbursement' ? filtersDisbursement : filtersPreApply

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
    setSearchTrigger(n => n + 1)
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
        api.exportApplications(subsidyType.id),
        api.exportPayments(subsidyType.id),
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
  } | null>({
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
  const [areaStatsGroupBy, setAreaStatsGroupBy] = useState<'excel' | 'database'>('excel')

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
    setSearchTrigger(n => n + 1)
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
    setSearchTrigger(n => n + 1)
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
        ? 'subsidies:batchDeletePayments'
        : 'subsidies:batchDeleteApplications'
      const response = await window.electronAPI.invoke(endpoint, { ids: selectedIds })
      const data = response?.data ?? response
      if (data?.code !== undefined && data.code !== 0) throw new Error('批量删除失败')
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
        ? 'subsidies:batchDeletePayments'
        : 'subsidies:batchDeleteApplications'
      const response = await window.electronAPI.invoke(endpoint, { delete_all: true, subsidy_type_id: subsidyType.id })
      const result = response?.data ?? response
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
      const beneficiaryResp = await api.batchLookupFarmers([proxyForm.beneficiary_id_card.trim()])

      const proxyResp = await api.batchLookupFarmers([proxyForm.proxy_id_card.trim()])

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
    const lookupResp = await api.batchLookupFarmers(allIdCards)

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
      const response = await window.electronAPI.invoke('subsidies:applicationVillages', {
        subsidy_type_id: subsidyType.id,
        year: subsidyType.subsidy_year
      })
      const data = response?.data ?? response
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
        if (filters.minAmount) params.min_amount = Number(filters.minAmount)
        if (filters.maxAmount) params.max_amount = Number(filters.maxAmount)
        if (filters.dateFrom) params.date_from = filters.dateFrom
        if (filters.dateTo) params.date_to = filters.dateTo
        if (sortField) { params.sort_field = sortField; params.sort_dir = sortDir }

        const res = await window.electronAPI.invoke('subsidies:listPayments', params)
        const data = res?.data ?? res
        setApps(data.items.map((p: any) => ({
          id: p.id,
          farmer_id: p.farmer_id,
          farmer_name: p.farmer_name,
          id_card: p.id_card,
          id_card_masked: p.id_card_masked || p.id_card,
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
        setTotal(data.total)
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
      const precheckParams: Record<string, string | number> = {
        subsidy_type_id: subsidyType.id,
      }
      if (filters.payStatus) {
        precheckParams.pay_status = filters.payStatus
      } else {
        precheckParams.pay_status = activeTab === 'preApply' ? '0' : '1,2'
      }
      if (filters.village) precheckParams.village_name = filters.village

      const response = await window.electronAPI.invoke('subsidies:precheck', precheckParams)
      const result = response?.data ?? response
      if (response?.code !== undefined && response.code !== 0) throw new Error('预检请求失败')
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
      const response = await window.electronAPI.invoke('subsidies:comparableTypes', {
        category: subsidyType.category,
        current_type_id: subsidyType.id
      })
      const data = response?.data ?? response
      setComparableTypes(data)
    } catch (error) {
      console.error('加载可对比项目失败:', error)
    }
  }, [subsidyType.category, subsidyType.id])

  // 获取全部统计数据
  const loadStats = useCallback(async () => {
    setLoadingStats(true)
    setStats(null)
    try {
      const dataSource = activeTab === 'disbursement' ? 'payment' : 'application'
      const statsParams: Record<string, string | number> = {
        subsidy_type_id: subsidyType.id,
        year: subsidyType.subsidy_year,
        data_source: dataSource,
      }
      if (selectedCompareType) {
        statsParams.compare_type_id = selectedCompareType
      }
      const response = await window.electronAPI.invoke('subsidies:applicationStats', statsParams)
      const data = response?.data ?? response
      setStats(data)
    } catch (error) {
      console.error('加载统计数据失败:', error)
      show('加载统计数据失败', 'err')
    } finally {
      setLoadingStats(false)
    }
  }, [subsidyType.id, subsidyType.subsidy_year, selectedCompareType, activeTab])

  // 加载面积统计数据
  const loadAreaStats = useCallback(async () => {
    setLoadingAreaStats(true)
    try {
      const dataSource = activeTab === 'disbursement' ? 'payment' : 'application'
      const data = await api.getAreaStatsByVillage(subsidyType.id, subsidyType.subsidy_year, dataSource, areaStatsGroupBy)
      setAreaStats(data)
    } catch (error) {
      console.error('加载面积统计失败:', error)
      show('加载面积统计失败', 'err')
    } finally {
      setLoadingAreaStats(false)
    }
  }, [subsidyType.id, subsidyType.subsidy_year, activeTab, areaStatsGroupBy, show])

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
  }, [areaStatsExpanded, activeTab, areaStatsGroupBy, loadAreaStats])

  // 数据概览展开/收起状态
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)

  // 计算季节配色
  const seasonStyle = subsidyType.season ?
    (subsidyType.season === '耕地地力保护' ? { gradient: 'from-emerald-500 to-teal-500', icon: '🌱', badge: 'bg-emerald-500' } :
     subsidyType.season === '大春' ? { gradient: 'from-amber-500 to-orange-500', icon: '🌻', badge: 'bg-orange-500' } :
     subsidyType.season === '小春' ? { gradient: 'from-sky-500 to-blue-500', icon: '🌾', badge: 'bg-blue-500' } :
     subsidyType.season === '全年单补' ? { gradient: 'from-violet-500 to-purple-500', icon: '📋', badge: 'bg-purple-500' } :
     subsidyType.season === '临时' ? { gradient: 'from-rose-500 to-pink-500', icon: '⚡', badge: 'bg-pink-500' } :
     { gradient: 'from-gray-500 to-slate-500', icon: '📦', badge: 'bg-slate-500' }) :
    { gradient: 'from-emerald-500 to-teal-500', icon: '📋', badge: 'bg-emerald-500' }

  return (
    <div className="space-y-4">
      {/* ═══ 顶部渐变横幅 ═══ */}
      <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-r ${seasonStyle.gradient} p-5 shadow-lg`}>
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5" />
        <div className="relative z-10 flex items-center gap-4 flex-wrap">
          <button onClick={onBack}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-sm text-white/90 text-xs hover:bg-white/25 transition-all">
            ← 返回项目
          </button>
          <span className="text-white/40">|</span>
          <span className={`flex-shrink-0 w-9 h-9 rounded-xl ${seasonStyle.badge} bg-white/20 backdrop-blur-sm flex items-center justify-center text-lg`}>
            {seasonStyle.icon}
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white drop-shadow-sm truncate">{subsidyType.subsidy_name}</h1>
            <div className="flex items-center gap-2 text-[11px] text-white/70 mt-0.5 flex-wrap">
              <span>📅 {subsidyType.subsidy_year}年</span>
              <span>·</span>
              <span>{subsidyType.calc_mode === 'per_mu' ? '📐 按亩计算' : '💰 固定金额'}</span>
              {subsidyType.standard_amount && (
                <><span>·</span><span>标准 ¥{Number(subsidyType.standard_amount).toFixed(2)}{subsidyType.standard_unit}</span></>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="px-2.5 py-1 rounded-lg bg-white/15 backdrop-blur-sm text-white text-center">
              <div className="text-sm font-bold">{stats?.totalFarmers ?? 0}</div>
              <div className="text-[9px] text-white/60">受益</div>
            </div>
            <div className="px-2.5 py-1 rounded-lg bg-white/15 backdrop-blur-sm text-white text-center">
              <div className="text-sm font-bold">¥{(stats?.totalAmount ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</div>
              <div className="text-[9px] text-white/60">金额</div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Tab切换 ═══ */}
      <div className="flex items-center gap-1 border-b border-border/60">
        {[
          { key: 'preApply' as const, label: '📋 预申请数据' },
          { key: 'disbursement' as const, label: '💰 正式分发' },
          { key: 'proxy' as const, label: '👥 代领关系' },
          { key: 'precheckHistory' as const, label: '📋 预检历史' },
        ].map(tab => (
          <button key={tab.key} onClick={() => switchTab(tab.key)}
            className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-all ${
              activeTab === tab.key
                ? `border-emerald-500 text-emerald-700 bg-emerald-50/30`
                : 'border-transparent text-text-muted hover:text-text-primary hover:border-gray-200'
            }`}>
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 pb-1.5">
          {activeTab === 'proxy' && (
            <>
              <button onClick={() => setProxyImportOpen(true)}
                className="px-2.5 py-1.5 text-[11px] border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50">
                ↑ Excel导入
              </button>
              <button onClick={() => setProxyAddOpen(true)}
                className="px-2.5 py-1.5 text-[11px] bg-primary text-white rounded-lg hover:bg-primary/90">
                ＋ 新增
              </button>
            </>
          )}
          {(activeTab === 'preApply' || activeTab === 'disbursement') && (<>
              <button onClick={runPreCheck} disabled={preCheckLoading || apps.length === 0}
                className={`px-2.5 py-1.5 text-[11px] rounded-lg flex items-center gap-1 ${
                  preCheckLoading ? 'bg-blue-50 border border-blue-200 text-blue-500' : 'bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100'
                }`}>
                {preCheckLoading ? <><span className="w-3 h-3 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />预检中</> : '🔍 预检'}
              </button>
              <span className="text-[11px] text-text-muted">共 {total} 条</span>
              <div className="flex gap-1.5 items-center">
                {selectedIds.length > 0 && (
                  <button onClick={batchDelete}
                    className="px-2.5 py-1.5 text-[11px] bg-red-500 text-white rounded-lg hover:bg-red-600">
                    🗑️ 删除({selectedIds.length})
                  </button>
                )}
                {activeTab === 'disbursement' && (
                  <button onClick={runDisbursementCheck} disabled={checkingDisbursement}
                    className="px-2.5 py-1.5 text-[11px] border border-amber-300 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 disabled:opacity-50">
                    {checkingDisbursement ? '⏳' : '🔍'} 比对
                  </button>
                )}
                <button onClick={deleteAll} disabled={deletingAll}
                  className={`px-2.5 py-1.5 text-[11px] rounded-lg ${deletingAll ? 'bg-gray-300 cursor-not-allowed text-gray-500' : 'bg-red-500/80 hover:bg-red-600 text-white'}`}>
                  {deletingAll ? '⏳ 删除中...' : '🗑️ 全部'}
                </button>
                <button onClick={() => setAddOpen(true)}
                  className="px-2.5 py-1.5 text-[11px] bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg shadow-sm hover:shadow-md transition-all">
                  ＋ 导入
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tab内容 */}
      {activeTab === 'preApply' && (
        <div className="space-y-4">
          {/* ═══ 数据概览&面积统计 ═══ */}
          <div className="bg-white rounded-xl border border-border/60 shadow-sm overflow-hidden">
            <button onClick={() => { setStatsExpanded(prev => !prev); setAreaStatsExpanded(true) } }
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-blue-50/40 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary">📊 数据概览 & 面积统计</span>
                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">预申请</span>
              </div>
              <span className="text-[11px] text-text-muted">{statsExpanded && areaStatsExpanded ? '▲ 收起' : '▼ 展开'}</span>
            </button>
            {statsExpanded && areaStatsExpanded && (
              <div className="px-4 pb-4 border-t border-border/30">
                {loadingStats && loadingAreaStats ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-text-muted/50 text-xs">
                    <span className="w-4 h-4 border-2 border-text-muted/20 border-t-blue-500 rounded-full animate-spin" />
                    加载中…
                  </div>
                ) : (
                  <div className="pt-3">
                    {/* 数据概览卡片 */}
                    <div className="flex items-center justify-end gap-2 mb-3">
                      {subsidyType.category && (
                        <select value={selectedCompareType ?? ''} onChange={e => setSelectedCompareType(e.target.value ? Number(e.target.value) : null)}
                          className="px-2 py-1 text-[11px] border border-border/60 rounded-lg bg-white outline-none focus:ring-1 focus:ring-blue-300">
                          <option value="">不对比</option>
                          {(comparableTypes || []).map(t => (
                            <option key={t.id} value={t.id}>{t.subsidy_name} ({t.subsidy_year}年)</option>
                          ))}
                        </select>
                      )}
                      <span className="text-[10px] text-text-muted">全镇数据统计</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100/60 rounded-xl p-3.5">
                        <div className="text-[11px] text-emerald-600 mb-1">申报总额</div>
                        <div className="text-xl font-bold font-mono text-emerald-700">
                          ¥{((stats?.totalAmount) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                        </div>
                        <div className="text-[11px] text-emerald-500 mt-1">{(stats?.totalFarmers) || 0}人</div>
                      </div>
                      <div className="bg-gradient-to-br from-blue-50 to-sky-50 border border-blue-100/60 rounded-xl p-3.5">
                        <div className="text-[11px] text-blue-600 mb-1">涉及村庄</div>
                        <div className="text-xl font-bold text-blue-700">{stats?.villageDistribution?.length ?? 0}</div>
                        <div className="text-[11px] text-blue-500 mt-1">个村</div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 border border-purple-100/60 rounded-xl p-3.5">
                        <div className="text-[11px] text-purple-600 mb-1">总面积</div>
                        <div className="text-xl font-bold font-mono text-purple-700">
                          {((stats?.totalArea) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-[11px] text-purple-500 mt-1">亩</div>
                      </div>
                    </div>
                    {stats?.yearComparison && (
                      <div className="mt-1 mb-4 p-3 bg-amber-50/60 border border-amber-100/60 rounded-xl">
                        <div className="text-[11px] font-semibold text-amber-700 mb-2">📊 年度对比</div>
                        <div className="flex gap-4 text-xs">
                          <span className="text-amber-600"><span className="text-green-600 font-bold">+{stats.yearComparison.new_farmers_count || 0}</span> 新增</span>
                          <span className="text-amber-600"><span className="text-red-600 font-bold">{stats.yearComparison.removed_farmers_count || 0}</span> 退出</span>
                          <span className="text-amber-600">面积 <span className="font-mono">{((stats.yearComparison.total_apply_area) || 0).toFixed(1)}亩</span></span>
                        </div>
                      </div>
                    )}

                    {/* 面积统计 */}
                    <div className="border-t border-border/40 pt-3 mt-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-text-primary">📐 面积统计</span>
                          <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
                            <button onClick={() => setAreaStatsGroupBy('excel')}
                              className={`px-2 py-0.5 text-[10px] rounded transition-all ${areaStatsGroupBy === 'excel' ? 'bg-white shadow-sm text-text-primary font-medium' : 'text-gray-400 hover:text-text-primary'}`}>📄 Excel</button>
                            <button onClick={() => setAreaStatsGroupBy('database')}
                              className={`px-2 py-0.5 text-[10px] rounded transition-all ${areaStatsGroupBy === 'database' ? 'bg-white shadow-sm text-text-primary font-medium' : 'text-gray-400 hover:text-text-primary'}`}>🗄️ 数据库</button>
                          </div>
                        </div>
                        {areaStats && (
                          <button onClick={handleExportAreaStats}
                            className="px-2.5 py-1 text-[10px] bg-indigo-50 text-indigo-600 rounded-md hover:bg-indigo-100 transition-all">↓ 导出</button>
                        )}
                      </div>
                      {loadingAreaStats ? (
                        <div className="flex items-center justify-center py-6 gap-2 text-text-muted/50 text-xs">
                          <span className="w-4 h-4 border-2 border-text-muted/20 border-t-indigo-500 rounded-full animate-spin" />
                          计算中…
                        </div>
                      ) : areaStats ? (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-border">
                                  <th className="px-3 py-2 text-left font-medium text-text-primary">村名</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">农户</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">记录</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">计入超限(亩)</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">承包地(亩)</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">代耕代种(亩)</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">不予补贴(亩)</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">金额(元)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(areaStats.by_village || []).map((row, idx) => (
                                  <tr key={idx} className="hover:bg-blue-50/30 border-b border-border/30">
                                    <td className="px-3 py-2 text-text-primary">{row.village || '—'}</td>
                                    <td className="px-2 py-2 text-right text-text-primary">{row.farmer_count ?? 0}</td>
                                    <td className="px-2 py-2 text-right text-text-primary">{row.record_count ?? 0}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(row.total_apply_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(row.total_contract_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(row.total_trust_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(row.total_no_subsidy_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-indigo-600 font-medium">¥{(row.total_amount || 0).toFixed(2)}</td>
                                  </tr>
                                ))}
                                {areaStats.total && (
                                  <tr className="bg-indigo-50/40 font-semibold border-t-2 border-indigo-200">
                                    <td className="px-3 py-2 text-text-primary">{areaStats.total.village || '全镇合计'}</td>
                                    <td className="px-2 py-2 text-right text-text-primary">{areaStats.total.farmer_count ?? 0}</td>
                                    <td className="px-2 py-2 text-right text-text-primary">{areaStats.total.record_count ?? 0}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(areaStats.total.total_apply_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(areaStats.total.total_contract_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(areaStats.total.total_trust_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(areaStats.total.total_no_subsidy_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-indigo-700">¥{(areaStats.total.total_amount || 0).toFixed(2)}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-text-muted">
                            <span className="px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">预申请数据</span>
                            <span className={`px-2 py-0.5 rounded-full font-medium ${areaStats.group_by === 'database' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
                              {areaStats.group_by === 'database' ? '按数据库分村' : '按Excel分村'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="py-6 text-center text-text-muted text-xs">暂无面积统计</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ═══ 预检结果 ═══ */}
          {preCheckResults && (() => {
            const sum = preCheckResults.summary || {}
            const items = [
              { label: '通过', val: sum.ok_rows || 0, bg: 'bg-emerald-50 border-emerald-100/60', txt: 'text-emerald-600' },
              { label: '错误', val: sum.error_rows || 0, bg: 'bg-red-50 border-red-100/60', txt: 'text-red-500' },
              { label: '面积异常', val: sum.area_anomalies || 0, bg: 'bg-orange-50 border-orange-100/60', txt: 'text-orange-500' },
              { label: '错误库命中', val: sum.error_library_hits || 0, bg: 'bg-rose-50 border-rose-100/60', txt: 'text-rose-500' },
              { label: '字段变更', val: (preCheckResults as any).changed_farmers?.length || 0, bg: 'bg-blue-50 border-blue-100/60', txt: 'text-blue-500' },
            ]
            return (
              <div className="bg-white rounded-xl border border-border/60 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/30 bg-gradient-to-r from-blue-50/50 to-sky-50/50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-text-primary">🔍 数据预检结果</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setSelectedSheets(getDefaultSelectedSheets(preCheckResults)); setExportModalOpen(true) }} className="px-2.5 py-1 text-[11px] bg-primary text-white rounded-lg hover:bg-primary/90 transition-all">↓ 导出 Excel</button>
                    <button onClick={() => setPreCheckResults(null)} className="text-xs text-text-muted hover:text-text-primary">✕ 关闭</button>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-5 gap-2 mb-4">{items.map(c => (<div key={c.label} className={`rounded-xl p-3 text-center border ${c.val > 0 ? c.bg : 'bg-warm/30 border-border/50'}`}><div className={`text-lg font-bold ${c.txt}`}>{c.val}</div><div className="text-[10px] text-text-muted">{c.label}</div></div>))}</div>
                  {getPrecheckTableConfigs(subsidyType.season).map(config => {
                    const data = (preCheckResults as any)[config.field] as any[]
                    if (!data || data.length === 0) return null
                    return (<ResultTable key={config.field} title={typeof config.title === 'function' ? config.title(data.length) : config.title} headers={config.headers} rows={data.map((row, index) => config.rowMapper(row, index))} />)
                  })}
                </div>
              </div>
            )
          })()}

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
        </div>
      )}

      {activeTab === 'disbursement' && (
        <div className="space-y-4">
          {/* ═══ 数据概览&面积统计 ═══ */}
          <div className="bg-white rounded-xl border border-border/60 shadow-sm overflow-hidden">
            <button onClick={() => { setStatsExpanded(prev => !prev); setAreaStatsExpanded(true) } }
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-green-50/40 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary">📊 数据概览 & 面积统计</span>
                <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">正式分发</span>
              </div>
              <span className="text-[11px] text-text-muted">{statsExpanded && areaStatsExpanded ? '▲ 收起' : '▼ 展开'}</span>
            </button>
            {statsExpanded && areaStatsExpanded && (
              <div className="px-4 pb-4 border-t border-border/30">
                {loadingStats && loadingAreaStats ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-text-muted/50 text-xs">
                    <span className="w-4 h-4 border-2 border-text-muted/20 border-t-green-500 rounded-full animate-spin" />
                    加载中…
                  </div>
                ) : (
                  <div className="pt-3">
                    {/* 数据概览卡片 */}
                    <div className="flex items-center justify-end gap-2 mb-3">
                      <span className="text-[10px] text-text-muted">全镇数据统计</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100/60 rounded-xl p-3.5">
                        <div className="text-[11px] text-emerald-600 mb-1">发放总额</div>
                        <div className="text-xl font-bold font-mono text-emerald-700">
                          ¥{((stats?.totalAmount) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                        </div>
                        <div className="text-[11px] text-emerald-500 mt-1">{(stats?.totalFarmers) || 0}人</div>
                      </div>
                      <div className="bg-gradient-to-br from-blue-50 to-sky-50 border border-blue-100/60 rounded-xl p-3.5">
                        <div className="text-[11px] text-blue-600 mb-1">涉及村庄</div>
                        <div className="text-xl font-bold text-blue-700">{stats?.villageDistribution?.length ?? 0}</div>
                        <div className="text-[11px] text-blue-500 mt-1">个村</div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 border border-purple-100/60 rounded-xl p-3.5">
                        <div className="text-[11px] text-purple-600 mb-1">总面积</div>
                        <div className="text-xl font-bold font-mono text-purple-700">
                          {((stats?.totalArea) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-[11px] text-purple-500 mt-1">亩</div>
                      </div>
                    </div>
                    {stats?.yearComparison && (
                      <div className="mt-1 mb-4 p-3 bg-amber-50/60 border border-amber-100/60 rounded-xl">
                        <div className="text-[11px] font-semibold text-amber-700 mb-2">📊 年度对比</div>
                        <div className="flex gap-4 text-xs">
                          <span className="text-amber-600"><span className="text-green-600 font-bold">+{stats.yearComparison.new_farmers_count || 0}</span> 新增</span>
                          <span className="text-amber-600"><span className="text-red-600 font-bold">{stats.yearComparison.removed_farmers_count || 0}</span> 退出</span>
                          <span className="text-amber-600">面积 <span className="font-mono">{((stats.yearComparison.total_apply_area) || 0).toFixed(1)}亩</span></span>
                        </div>
                      </div>
                    )}

                    {/* 面积统计 */}
                    <div className="border-t border-border/40 pt-3 mt-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-text-primary">📐 面积统计</span>
                          <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
                            <button onClick={() => setAreaStatsGroupBy('excel')}
                              className={`px-2 py-0.5 text-[10px] rounded transition-all ${areaStatsGroupBy === 'excel' ? 'bg-white shadow-sm text-text-primary font-medium' : 'text-gray-400 hover:text-text-primary'}`}>📄 Excel</button>
                            <button onClick={() => setAreaStatsGroupBy('database')}
                              className={`px-2 py-0.5 text-[10px] rounded transition-all ${areaStatsGroupBy === 'database' ? 'bg-white shadow-sm text-text-primary font-medium' : 'text-gray-400 hover:text-text-primary'}`}>🗄️ 数据库</button>
                          </div>
                        </div>
                        {areaStats && (
                          <button onClick={handleExportAreaStats}
                            className="px-2.5 py-1 text-[10px] bg-green-50 text-green-600 rounded-md hover:bg-green-100 transition-all">↓ 导出</button>
                        )}
                      </div>
                      {loadingAreaStats ? (
                        <div className="flex items-center justify-center py-6 gap-2 text-text-muted/50 text-xs">
                          <span className="w-4 h-4 border-2 border-text-muted/20 border-t-green-500 rounded-full animate-spin" />
                          计算中…
                        </div>
                      ) : areaStats ? (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-border">
                                  <th className="px-3 py-2 text-left font-medium text-text-primary">村名</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">农户</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">记录</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">计入超限(亩)</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">承包地(亩)</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">代耕代种(亩)</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">不予补贴(亩)</th>
                                  <th className="px-2 py-2 text-right font-medium text-text-primary">金额(元)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(areaStats.by_village || []).map((row, idx) => (
                                  <tr key={idx} className="hover:bg-green-50/30 border-b border-border/30">
                                    <td className="px-3 py-2 text-text-primary">{row.village || '—'}</td>
                                    <td className="px-2 py-2 text-right text-text-primary">{row.farmer_count ?? 0}</td>
                                    <td className="px-2 py-2 text-right text-text-primary">{row.record_count ?? 0}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(row.total_apply_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(row.total_contract_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(row.total_trust_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(row.total_no_subsidy_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-green-600 font-medium">¥{(row.total_amount || 0).toFixed(2)}</td>
                                  </tr>
                                ))}
                                {areaStats.total && (
                                  <tr className="bg-green-50/40 font-semibold border-t-2 border-green-200">
                                    <td className="px-3 py-2 text-text-primary">{areaStats.total.village || '全镇合计'}</td>
                                    <td className="px-2 py-2 text-right text-text-primary">{areaStats.total.farmer_count ?? 0}</td>
                                    <td className="px-2 py-2 text-right text-text-primary">{areaStats.total.record_count ?? 0}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(areaStats.total.total_apply_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(areaStats.total.total_contract_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(areaStats.total.total_trust_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-text-primary">{(areaStats.total.total_no_subsidy_area || 0).toFixed(2)}</td>
                                    <td className="px-2 py-2 text-right font-mono text-green-700">¥{(areaStats.total.total_amount || 0).toFixed(2)}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-text-muted">
                            <span className="px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">发放数据</span>
                            <span className={`px-2 py-0.5 rounded-full font-medium ${areaStats.group_by === 'database' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
                              {areaStats.group_by === 'database' ? '按数据库分村' : '按Excel分村'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="py-6 text-center text-text-muted text-xs">暂无面积统计</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ═══ 预检结果 ═══ */}
          {preCheckResults && (() => {
            const sum = preCheckResults.summary || {}
            const items = [
              { label: '通过', val: sum.ok_rows || 0, bg: 'bg-emerald-50 border-emerald-100/60', txt: 'text-emerald-600' },
              { label: '错误', val: sum.error_rows || 0, bg: 'bg-red-50 border-red-100/60', txt: 'text-red-500' },
              { label: '面积异常', val: sum.area_anomalies || 0, bg: 'bg-orange-50 border-orange-100/60', txt: 'text-orange-500' },
              { label: '错误库命中', val: sum.error_library_hits || 0, bg: 'bg-rose-50 border-rose-100/60', txt: 'text-rose-500' },
              { label: '字段变更', val: (preCheckResults as any).changed_farmers?.length || 0, bg: 'bg-blue-50 border-blue-100/60', txt: 'text-blue-500' },
            ]
            return (
              <div className="bg-white rounded-xl border border-border/60 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/30 bg-gradient-to-r from-blue-50/50 to-sky-50/50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-text-primary">🔍 数据预检结果</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setSelectedSheets(getDefaultSelectedSheets(preCheckResults)); setExportModalOpen(true) }} className="px-2.5 py-1 text-[11px] bg-primary text-white rounded-lg hover:bg-primary/90 transition-all">↓ 导出 Excel</button>
                    <button onClick={() => setPreCheckResults(null)} className="text-xs text-text-muted hover:text-text-primary">✕ 关闭</button>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-5 gap-2 mb-4">{items.map(c => (<div key={c.label} className={`rounded-xl p-3 text-center border ${c.val > 0 ? c.bg : 'bg-warm/30 border-border/50'}`}><div className={`text-lg font-bold ${c.txt}`}>{c.val}</div><div className="text-[10px] text-text-muted">{c.label}</div></div>))}</div>
                  {getPrecheckTableConfigs(subsidyType.season).map(config => {
                    const data = (preCheckResults as any)[config.field] as any[]
                    if (!data || data.length === 0) return null
                    return (<ResultTable key={config.field} title={typeof config.title === 'function' ? config.title(data.length) : config.title} headers={config.headers} rows={data.map((row, index) => config.rowMapper(row, index))} />)
                  })}
                </div>
              </div>
            )
          })()}

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
        </div>
      )}

      {activeTab === 'proxy' && (
        <div className="space-y-4">
          <ProxyList subsidyType={subsidyType} show={show} />
        </div>
      )}

      {activeTab === 'precheckHistory' && (
        <div className="space-y-4">
          <PrecheckHistoryTab subsidyType={subsidyType} preCheckResults={preCheckResults} />
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