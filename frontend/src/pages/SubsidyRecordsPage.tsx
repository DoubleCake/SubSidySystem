/**
 * 补贴记录子页 - Tab容器
 * 包含预申请/发放/代领三个Tab
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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
import PreApplyList from './PreApplyList'
import DisbursementList from './DisbursementList'
import ProxyList from './ProxyList'

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
}

export default function SubsidyRecordsPage({ subsidyType, onBack }: SubsidyRecordsPageProps) {
  const { toast, show } = useToast()
  const navigate = useNavigate()

  // Tab状态管理
  const [activeTab, setActiveTab] = useState<'preApply' | 'disbursement' | 'proxy'>('preApply')
  const switchTab = (tab: 'preApply' | 'disbursement' | 'proxy') => {
    setActiveTab(tab)
    setPage(1)
    setSelectedIds([])
  }

  // 两个列表分别维护独立的搜索和筛选状态
  const [searchPreApply, setSearchPreApply] = useState('')
  const [searchDisbursement, setSearchDisbursement] = useState('')
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

  // 预检相关
  const [preCheckLoading, setPreCheckLoading] = useState(false)
  const [preCheckResults, setPreCheckResults] = useState<CheckResult | null>(null)

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
      const response = await fetch('/api/subsidies/applications/batch-delete', {
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
        await api.createProxy({
          beneficiary_farmer_id: beneficiaryId,
          proxy_farmer_id: proxyId,
          proxy_type: p.proxy_type,
          remark: p.remark || undefined,
        })
        successCount++
      } catch (e) {
        errors.push(`创建失败: ${p.beneficiary_id_card}`)
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
      if (filters.payStatus) {
        params.pay_status = filters.payStatus
      } else {
        params.pay_status = 0
      }
      if (filters.village) params.village = filters.village
      if (filters.minAmount) params.min_amount = filters.minAmount
      if (filters.maxAmount) params.max_amount = filters.maxAmount
      if (filters.dateFrom) params.date_from = filters.dateFrom
      if (filters.dateTo) params.date_to = filters.dateTo

      const res = await api.searchApplications(params)
      setApps(res.items)
      setTotal(res.total)
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }, [page, search, filters, subsidyType.id, subsidyType.subsidy_year, activeTab])

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

  useEffect(() => {
    loadStats()
    loadComparableTypes()
  }, [loadStats, loadComparableTypes])

  // 数据概览展开/收起状态
  const [statsExpanded, setStatsExpanded] = useState(false)

  return (
    <div>
      {/* 面包屑 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={onBack} className="text-sm text-emerald-700 hover:underline">← 返回项目列表</button>
        <span className="text-stone-300">|</span>
        <span className="font-bold text-stone-800">{subsidyType.subsidy_name}</span>
        <Tag label={`${subsidyType.subsidy_year}年`} color="gray" />
        <Tag label={subsidyType.calc_mode === 'per_mu' ? '按亩计算' : '固定金额'} color={subsidyType.calc_mode === 'per_mu' ? 'blue' : 'purple'} />
        {subsidyType.standard_amount && (
          <span className="text-xs text-stone-400">标准：¥{Number(subsidyType.standard_amount).toFixed(2)}{subsidyType.standard_unit}</span>
        )}
      </div>

      {/* 数据概览 - 可折叠下拉框 */}
      <div className="mb-4 bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => setStatsExpanded(!statsExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-700">📊 数据概览</span>
            {statsExpanded && (
              <span className="text-xs text-stone-400">发放总额 ¥{stats.totalAmount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} · {stats.totalFarmers}人 · 总面积 {stats.totalArea}亩 · {stats.villageDistribution.length}个村</span>
            )}
          </div>
          <span className="text-stone-400 text-sm">{statsExpanded ? '▲ 收起' : '▼ 展开'}</span>
        </button>

        {statsExpanded && (
          <div className="px-4 pb-4 border-t border-stone-100">
            <div className="flex items-center justify-end gap-2 pt-3 mb-4">
              {subsidyType.category && (
                <select
                  value={selectedCompareType ?? ''}
                  onChange={e => setSelectedCompareType(e.target.value ? Number(e.target.value) : null)}
                  className="px-2 py-1 text-xs border border-stone-200 rounded bg-white"
                >
                  <option value="">不对比</option>
                  {comparableTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.subsidy_name} ({t.subsidy_year}年)</option>
                  ))}
                </select>
              )}
              <span className="text-xs text-stone-400">全镇数据统计</span>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                <div className="text-sm text-emerald-600 mb-2">发放总额</div>
                <div className="text-2xl font-bold font-mono text-emerald-700">¥{stats.totalAmount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</div>
                <div className="text-sm text-emerald-600 mt-2">{stats.totalFarmers}人</div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="text-sm text-blue-600 mb-2">涉及村庄</div>
                <div className="text-2xl font-bold text-blue-700">{stats.villageDistribution.length}</div>
                <div className="text-sm text-blue-600 mt-2">个村</div>
              </div>
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                <div className="text-sm text-purple-600 mb-2">总面积</div>
                <div className="text-2xl font-bold font-mono text-purple-700">{stats.totalArea.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}亩</div>
                <div className="text-sm text-purple-600 mt-2">补贴面积合计</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tab切换 */}
      <div className="flex items-center gap-2 mb-4 border-b border-stone-200">
        <button
          onClick={() => switchTab('preApply')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'preApply' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          📋 预申请列表
        </button>
        <button
          onClick={() => switchTab('disbursement')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'disbursement' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          💰 发放信息列表
        </button>
        <button
          onClick={() => switchTab('proxy')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'proxy' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          👥 代领关系
        </button>
        <div className="ml-auto flex items-center gap-2">
          {activeTab === 'preApply' && (
            <button
              onClick={runPreCheck}
              disabled={preCheckLoading || apps.length === 0}
              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 ${
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
                className="px-3 py-1.5 text-sm border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50 flex items-center gap-1.5">
                ↑ Excel导入
              </button>
              <button onClick={() => setProxyAddOpen(true)}
                className="px-3 py-1.5 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
                ＋ 新增代领
              </button>
            </>
          )}
          {activeTab !== 'proxy' && (
            <>
              <span className="text-xs text-stone-400">共 {total} 条</span>
              <div className="flex gap-2 items-center">
                {selectedIds.length > 0 && (
                  <button onClick={batchDelete}
                    className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-1.5">
                    🗑️ 删除选中 ({selectedIds.length})
                  </button>
                )}
                <button onClick={() => setAddOpen(true)}
                  className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
                  ＋ 新增一条
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
          handleFilterChange={handleFilterChange}
          handleSearchChange={handleSearchChange}
          clearFilters={clearFilters}
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
          handleFilterChange={handleFilterChange}
          handleSearchChange={handleSearchChange}
          clearFilters={clearFilters}
        />
      )}

      {activeTab === 'proxy' && (
        <ProxyList key={proxyRefreshKey} subsidyType={subsidyType} show={show} />
      )}

      {/* 预检结果展示 */}
      {preCheckResults && activeTab === 'preApply' && (
        <div className="mb-4 bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
            <span className="font-semibold text-stone-700 text-sm">🔍 数据预检结果</span>
            <div className="flex gap-2 items-center">
              <button onClick={() => { setSelectedSheets(getDefaultSelectedSheets(preCheckResults)); setExportModalOpen(true) }}
                className="px-3 py-1.5 text-xs bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">↓ 导出报告 Excel</button>
              <button onClick={() => setPreCheckResults(null)} className="text-xs text-stone-400 hover:text-stone-600">✕ 关闭</button>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-5 gap-3">
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.summary?.ok_rows || 0) > 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-emerald-700">{preCheckResults.summary?.ok_rows || 0}</div>
                <div className="text-xs text-stone-500">通过</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.summary?.error_rows || 0) > 0 ? 'bg-red-50 border border-red-100' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-red-600">{preCheckResults.summary?.error_rows || 0}</div>
                <div className="text-xs text-stone-500">错误</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.summary?.area_anomalies || 0) > 0 ? 'bg-orange-50 border border-orange-100' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-orange-600">{preCheckResults.summary?.area_anomalies || 0}</div>
                <div className="text-xs text-stone-500">面积异常</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.summary?.error_library_hits || 0) > 0 ? 'bg-red-100 border border-red-200' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-red-700">{preCheckResults.summary?.error_library_hits || 0}</div>
                <div className="text-xs text-stone-500">错误库命中</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${(preCheckResults.changed_farmers?.length || 0) > 0 ? 'bg-blue-50 border border-blue-100' : 'bg-stone-50 border border-stone-100'}`}>
                <div className="text-lg font-bold text-blue-600">{preCheckResults.changed_farmers?.length || 0}</div>
                <div className="text-xs text-stone-500">字段变更</div>
              </div>
            </div>

            {getPrecheckTableConfigs().map(config => {
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
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-stone-800">导出选项</h3>
                <p className="text-xs text-stone-400 mt-1">选择导出方式和包含的sheet</p>
              </div>
              <button onClick={() => setExportModalOpen(false)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-stone-700">分村导出</h4>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={splitByVillage} onChange={(e) => setSplitByVillage(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-stone-300 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                {splitByVillage && getVillagesFromResult(preCheckResults).length > 0 && (
                  <div className="bg-stone-50 border border-stone-200 rounded-lg p-3">
                    <p className="text-xs text-stone-500 mb-2">涉及的村：</p>
                    <div className="flex flex-wrap gap-1.5">
                      {getVillagesFromResult(preCheckResults).map(village => (
                        <span key={village} className="px-2 py-1 bg-white border border-stone-200 rounded text-xs">{village}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-stone-700">选择包含的sheet</h4>
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
                      <label key={opt.key} className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-blue-300' : 'bg-white border-stone-200 hover:bg-stone-50'} ${!hasData ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <input type="checkbox" checked={isSelected} onChange={() => hasData && toggleSheet(opt.key)} disabled={!hasData} className="mr-3 h-4 w-4 text-blue-600 rounded" />
                        <div className="flex-1">
                          <div className="font-medium text-sm text-stone-700">{opt.label}</div>
                          {opt.hasCount && <div className="text-xs text-stone-400 mt-1">{count > 0 ? `${count}条数据` : '无数据'}</div>}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-200 flex justify-end gap-3">
              <button onClick={() => setExportModalOpen(false)} className="px-4 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-600 hover:bg-stone-50">取消</button>
              <button onClick={handleExportWithOptions} disabled={isExporting || selectedSheets.length === 0}
                className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
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
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
            请输入被代领人和代领人的身份证信息，系统将自动匹配农户信息。
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">被代领人身份证 *</label>
            <input value={proxyForm.beneficiary_id_card} onChange={e => setProxyForm(f => ({ ...f, beneficiary_id_card: e.target.value }))}
              placeholder="请输入被代领人身份证号"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 font-mono" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">代领人身份证 *</label>
            <input value={proxyForm.proxy_id_card} onChange={e => setProxyForm(f => ({ ...f, proxy_id_card: e.target.value }))}
              placeholder="请输入代领人身份证号"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 font-mono" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">代领类型</label>
            <select value={proxyForm.proxy_type} onChange={e => setProxyForm(f => ({ ...f, proxy_type: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="代领">代领</option>
              <option value="监护人">监护人</option>
              <option value="委托">委托</option>
              <option value="其他">其他</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">备注</label>
            <textarea rows={2} value={proxyForm.remark} onChange={e => setProxyForm(f => ({ ...f, remark: e.target.value }))}
              placeholder="可选"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none" />
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
    </div>
  )
}