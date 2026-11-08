/**
 * 年度同类补贴数据分析页
 *
 * 入口展示所有已形成年度关系链的补贴项目；选中某条链后，
 * 从「农户 / 家庭户」两种模式观察补贴用户数据在多年间的变化：
 *   - 总览：逐年受益人数 / 面积 / 金额柱状 + 折线趋势 + 新增/退出
 *   - 明细矩阵：每个农户/家庭户在链上各年的补贴数据
 *   - 个体下钻：点击某行查看该个体逐年变化图
 *
 * 家庭户跨年归属一律以"当前家庭户"为准（主进程聚合时已处理）。
 * 注：身份证按用户要求明文显示（与 CLAUDE.md 脱敏约定冲突，已确认）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line,
} from 'recharts'
import Modal from '../components/Modal'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import * as XLSX from 'xlsx'
import * as api from '../api'
import type { ChainInfo, ChainDetail, ChainDetailItem } from '../api'

// 图表配色（沿用画布：深绿主系列、鎏金辅助、浅色细网格）
const SERIES_BLUE = '#1A5C46'
const DELTA_UP = '#2F5C46'
const DELTA_DOWN = '#d03b3b'
const AXIS_MUTED = '#898781'
const GRID_LINE = '#e1e0d9'

type DataSource = 'application' | 'payment'
type Mode = 'farmer' | 'household'
type Metric = 'count' | 'area' | 'amount'

const fmtMoney = (v: number) => '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const fmtArea = (v: number) => v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const fmtNum = (v: number) => v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })

export default function AnnualAnalysisPage() {
  const { toast, show } = useToast()

  const [chains, setChains] = useState<ChainInfo[]>([])
  const [loadingChains, setLoadingChains] = useState(false)
  const [selectedChain, setSelectedChain] = useState<ChainInfo | null>(null)

  const [dataSource, setDataSource] = useState<DataSource>('application')
  const [mode, setMode] = useState<Mode>('farmer')
  const [metric, setMetric] = useState<Metric>('count')
  const [detail, setDetail] = useState<ChainDetail | null>(null)
  const [loading, setLoading] = useState(false)

  // 明细矩阵
  const [search, setSearch] = useState('')
  const [cellMetric, setCellMetric] = useState<'area' | 'amount'>('area')
  const [villageFilter, setVillageFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [volMin, setVolMin] = useState('')
  const [volMax, setVolMax] = useState('')
  const [sortYear, setSortYear] = useState<number | null>(null)
  const [sortTotal, setSortTotal] = useState(false)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [drill, setDrill] = useState<ChainDetailItem | null>(null)
  // 参与分析的年份子集（链上年份可自由勾选，默认全选）
  const [selectedYears, setSelectedYears] = useState<number[]>([])

  const loadChains = useCallback(async () => {
    setLoadingChains(true)
    try {
      const data = await api.listChains()
      setChains(data)
    } catch (e) {
      show('加载补贴链失败：' + (e as Error).message, 'err')
    } finally {
      setLoadingChains(false)
    }
  }, [show])

  useEffect(() => { loadChains() }, [loadChains])

  // 选中链或数据源变化 → 拉取链数据
  useEffect(() => {
    if (!selectedChain) { setDetail(null); return }
    const anchor = selectedChain.years[selectedChain.years.length - 1].type_id
    setLoading(true)
    setDetail(null)
    api.chainDetail(anchor, dataSource)
      .then(setDetail)
      .catch(e => show('加载链数据失败：' + (e as Error).message, 'err'))
      .finally(() => setLoading(false))
  }, [selectedChain, dataSource, show])

  // 链数据加载完成 → 默认全选链上年份
  useEffect(() => {
    setSelectedYears(detail ? detail.years.map(y => y.subsidy_year) : [])
  }, [detail])

  // 当前参与分析的年份列（用户可自由勾选子集）
  const yearCols = useMemo(
    () => (detail?.years || []).filter(y => selectedYears.includes(y.subsidy_year)),
    [detail, selectedYears],
  )

  // 切换某年是否参与分析（至少保留一年）
  const toggleYear = (y: number) => {
    setSelectedYears(prev => {
      if (prev.includes(y)) {
        if (prev.length <= 1) return prev
        return prev.filter(x => x !== y)
      }
      return [...prev, y].sort()
    })
  }

  // 总览图表数据（仅统计选中年份）
  const chartData = useMemo(() => {
    if (!detail) return []
    return detail.summary
      .filter(s => selectedYears.includes(s.year))
      .map(s => ({
        year: `${s.year}年`,
        count: mode === 'farmer' ? s.total_farmers : s.total_households,
        area: s.total_area,
        amount: s.total_amount,
        newCount: mode === 'farmer' ? s.new_farmers : s.new_households,
        removedCount: mode === 'farmer' ? s.removed_farmers : s.removed_households,
      }))
  }, [detail, mode, selectedYears])

  const metricLabel = metric === 'count'
    ? (mode === 'farmer' ? '受益农户数' : '受益家庭户数')
    : metric === 'area' ? '总面积(亩)' : '总金额(元)'
  const metricKey = metric === 'count' ? 'count' : metric === 'area' ? 'area' : 'amount'

  // 村 / 组筛选下拉选项（来自当前模式明细）
  const villages = useMemo(() => {
    if (!detail) return []
    const list = mode === 'farmer' ? detail.farmers : detail.households
    return [...new Set(list.map(r => r.village).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  }, [detail, mode])

  const groups = useMemo(() => {
    if (!detail) return []
    const list = mode === 'farmer' ? detail.farmers : detail.households
    return [...new Set(list.filter(r => !villageFilter || r.village === villageFilter).map(r => r.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  }, [detail, mode, villageFilter])

  // 波动 = 多年有值数据中"最大值 − 最小值"的数值差值（跟随面积/金额切换）
  //   - 无数据 / 仅一年有值（无多年对比）→ 0（无波动）
  const calcVolatility = (r: ChainDetailItem, cols: Array<{ subsidy_year: number }>): number => {
    const vals = cols.map(y => r.per_year[y.subsidy_year]?.[cellMetric] ?? 0)
    const positive = vals.filter(v => v > 0)
    if (positive.length <= 1) return 0
    const min = Math.min(...positive)
    const max = Math.max(...positive)
    return max - min
  }

  // 明细矩阵（村/组/波动筛选 + 搜索 + 排序）
  const rows = useMemo<ChainDetailItem[]>(() => {
    if (!detail) return []
    const list = mode === 'farmer' ? detail.farmers : detail.households
    const cols = yearCols
    let out = [...list]
    const q = search.trim()
    const wMin = volMin.trim() === '' ? null : Number(volMin)
    const wMax = volMax.trim() === '' ? null : Number(volMax)
    if (q || villageFilter || groupFilter || wMin !== null || wMax !== null) {
      out = out.filter(r => {
        if (q && !(r.real_name || '').includes(q) && !r.household_name.includes(q) && !r.village.includes(q)) return false
        if (villageFilter && r.village !== villageFilter) return false
        if (groupFilter && r.group !== groupFilter) return false
        if (wMin !== null || wMax !== null) {
          const vol = calcVolatility(r, cols)
          if (wMin !== null && vol < wMin) return false
          if (wMax !== null && vol > wMax) return false
        }
        return true
      })
    }
    if (sortTotal) {
      // 多年合计列排序
      out.sort((a, b) => {
        const at = cols.reduce((acc, y) => acc + (a.per_year[y.subsidy_year]?.[cellMetric] ?? 0), 0)
        const bt = cols.reduce((acc, y) => acc + (b.per_year[y.subsidy_year]?.[cellMetric] ?? 0), 0)
        return sortDir === 'desc' ? bt - at : at - bt
      })
    } else if (sortYear !== null) {
      out.sort((a, b) => {
        const av = a.per_year[sortYear]?.[cellMetric] ?? -1
        const bv = b.per_year[sortYear]?.[cellMetric] ?? -1
        return sortDir === 'desc' ? bv - av : av - bv
      })
    } else {
      out.sort((a, b) =>
        a.household_name.localeCompare(b.household_name) ||
        (a.real_name || '').localeCompare(b.real_name || '')
      )
    }
    return out
  }, [detail, mode, search, sortYear, sortTotal, sortDir, cellMetric, villageFilter, groupFilter, volMin, volMax, yearCols])

  // 分页（基于过滤+排序后的结果）
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const curPage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(curPage * pageSize, (curPage + 1) * pageSize)

  // 搜索/筛选/换链/换模式/切换指标/排序变化时回到第一页
  useEffect(() => { setPage(0) }, [detail, mode, search, cellMetric, sortYear, sortTotal, villageFilter, groupFilter, volMin, volMax, selectedYears])

  const handleSortYear = (year: number) => {
    setSortTotal(false)
    if (sortYear === year) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortYear(year)
      setSortDir('desc')
    }
  }

  const handleSortTotal = () => {
    setSortYear(null)
    if (sortTotal) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortTotal(true)
      setSortDir('desc')
    }
  }

  // 导出明细为 Excel（当前筛选/搜索后的全部数据，各年面积+金额双列）
  const exportExcel = () => {
    if (!detail || rows.length === 0) { show('没有可导出的数据', 'err'); return }
    const chainName = selectedChain
      ? `${selectedChain.chain_name}(${selectedChain.year_from}-${selectedChain.year_to})`
      : '数据分析'
    const cols = yearCols
    const isFarmer = mode === 'farmer'
    const header = [
      '序号',
      ...(isFarmer ? ['姓名', '身份证号', '户名', '村', '组'] : ['户名', '村', '组', '家人']),
      ...cols.flatMap(y => [`${y.subsidy_year}年面积`, `${y.subsidy_year}年金额`]),
      '面积合计', '金额合计',
    ]
    const data = rows.map((r, i) => {
      const row: Record<string, string | number> = { 序号: i + 1 }
      if (isFarmer) {
        row['姓名'] = r.real_name || ''
        row['身份证号'] = r.id_card || ''
        row['户名'] = r.household_name || ''
        row['村'] = r.village || ''
        row['组'] = r.group || ''
      } else {
        row['户名'] = r.household_name || ''
        row['村'] = r.village || ''
        row['组'] = r.group || ''
        row['家人'] = (r.members || []).map(m => m.real_name).join('、')
      }
      let sumArea = 0, sumAmount = 0
      for (const y of cols) {
        const v = r.per_year[y.subsidy_year]
        row[`${y.subsidy_year}年面积`] = v ? Number((v.area || 0).toFixed(2)) : ''
        row[`${y.subsidy_year}年金额`] = v ? Number((v.amount || 0).toFixed(2)) : ''
        sumArea += v?.area || 0
        sumAmount += v?.amount || 0
      }
      row['面积合计'] = Number(sumArea.toFixed(2))
      row['金额合计'] = Number(sumAmount.toFixed(2))
      return row
    })
    const ws = XLSX.utils.json_to_sheet(data, { header })
    ws['!cols'] = header.map(h => ({ wch: h.includes('身份证') ? 20 : Math.max(h.length * 2, 10) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, isFarmer ? '农户明细' : '家庭户明细')
    XLSX.writeFile(wb, `${chainName}_${isFarmer ? '农户' : '家庭户'}明细_${new Date().toISOString().slice(0, 10)}.xlsx`)
    show(`✓ 已导出 ${data.length} 条记录`)
  }

  // 个体下钻数据
  const drillData = useMemo(() => {
    if (!drill || !detail) return []
    return yearCols.map(y => ({
      year: `${y.subsidy_year}年`,
      面积: drill.per_year[y.subsidy_year]?.area ?? 0,
      金额: drill.per_year[y.subsidy_year]?.amount ?? 0,
    }))
  }, [drill, detail, yearCols])

  const drillTitle = drill
    ? mode === 'farmer'
      ? `${drill.real_name || ''} · ${drill.household_name || drill.village || ''}`
      : `${drill.household_name} · ${drill.village}`
    : ''

  const emptyState = (
    <div className="py-16 text-center">
      <div className="text-4xl mb-3">🔗</div>
      <p className="text-sm font-medium text-text-primary mb-1">暂无可分析的补贴链</p>
      <p className="text-xs text-text-muted max-w-md mx-auto leading-relaxed">
        在「补贴总览」页面为补贴项目设置「上一年同类补贴」后，
        系统会自动把多年度的同类项目连成链，这里即可查看整条链的补贴用户数据变化。
      </p>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* ═══ 顶部横幅 ═══ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#1A3A2C] via-[#1A5C46] to-[#234A38] p-5 shadow-lg">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
        <div className="relative z-10 flex items-center gap-4 flex-wrap">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-lg">📊</span>
          <div>
            <h1 className="text-lg font-bold text-white drop-shadow-sm">年度补贴数据分析</h1>
            <p className="text-[11px] text-white/70 mt-0.5">
              观察同类补贴项目在多年间的用户（农户/家庭户）数据变化
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {(['application', 'payment'] as const).map(ds => (
              <button key={ds} onClick={() => setDataSource(ds)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                  dataSource === ds ? 'bg-white/20 text-white font-semibold backdrop-blur-sm' : 'bg-white/10 text-white/70 hover:bg-white/15'
                }`}>
                {ds === 'application' ? '📋 预申请' : '💰 正式分发'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-4 items-start">
        {/* ═══ 左侧：链列表 ═══ */}
        <div className="w-72 shrink-0 space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-text-primary">补贴链 ({chains.length})</span>
            <button onClick={loadChains} disabled={loadingChains}
              className="text-[11px] text-primary hover:underline disabled:opacity-50">
              {loadingChains ? '加载中…' : '🔄 刷新'}
            </button>
          </div>
          {chains.length === 0 && !loadingChains && (
            <div className="bg-white border border-border/60 rounded-xl p-4 text-xs text-text-muted leading-relaxed">
              还没有形成补贴链。请先在「补贴总览」为项目设置「上一年同类补贴」。
            </div>
          )}
          <div className="space-y-1.5 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
            {chains.map(c => {
              const active = selectedChain?.chain_id === c.chain_id
              return (
                <button key={c.chain_id} onClick={() => setSelectedChain(c)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    active
                      ? 'bg-[#F2F7F4] border-primary/40 shadow-sm'
                      : 'bg-white border-border/60 hover:border-primary/30 hover:bg-[#F2F7F4]'
                  }`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold truncate ${active ? 'text-primary' : 'text-text-primary'}`}>
                      {c.chain_name}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-primary text-[10px] font-mono">
                      {c.year_from}–{c.year_to}
                    </span>
                    <span className="text-[10px] text-text-muted">{c.years.length} 个年度项目</span>
                  </div>
                  <div className="mt-1 text-[10px] text-text-muted/70 truncate">
                    {c.years.map(y => y.subsidy_year).join(' → ')}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ═══ 右侧：选中链的分析 ═══ */}
        <div className="flex-1 min-w-0 space-y-4">
          {!selectedChain ? (
            <div className="bg-white rounded-card border border-border shadow-card">
              {chains.length === 0 ? emptyState : (
                <div className="py-20 text-center text-text-muted text-sm">
                  ← 请从左侧选择一条补贴链进行观察
                </div>
              )}
            </div>
          ) : loading && !detail ? (
            <div className="bg-white rounded-card border border-border shadow-card flex items-center justify-center py-16 gap-2 text-text-muted/50 text-xs">
              <span className="w-5 h-5 border-2 border-text-muted/20 border-t-primary rounded-full animate-spin" />
              数据计算中…
            </div>
          ) : detail ? (
            <>
              {/* ── 模式切换 + 链信息 ── */}
              <div className="bg-white rounded-card border border-border shadow-card p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-0.5 bg-[#F1EDE4] rounded-btn p-0.5">
                    <button onClick={() => setMode('farmer')}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-all ${mode === 'farmer' ? 'bg-white shadow-card text-primary font-semibold' : 'text-text-muted hover:text-primary'}`}>
                      👤 农户模式
                    </button>
                    <button onClick={() => setMode('household')}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-all ${mode === 'household' ? 'bg-white shadow-card text-primary font-semibold' : 'text-text-muted hover:text-primary'}`}>
                      🏠 家庭户模式
                    </button>
                  </div>
                  <div className="h-4 w-px bg-border/60" />
                  <div className="flex items-center gap-1.5 text-xs flex-wrap">
                    <span className="text-text-muted text-[11px] shrink-0">分析年份</span>
                    {detail.years.map(y => {
                      const on = selectedYears.includes(y.subsidy_year)
                      return (
                        <button key={y.type_id} onClick={() => toggleYear(y.subsidy_year)}
                          className={`px-2 py-0.5 rounded-md font-mono text-[11px] border transition-all ${
                            on
                              ? 'bg-primary text-white border-primary'
                              : 'bg-gray-50 text-text-muted border-border/60 hover:border-primary/40 hover:text-primary'
                          }`}>
                          {y.subsidy_year}年
                        </button>
                      )
                    })}
                    <button onClick={() => setSelectedYears(detail.years.map(y => y.subsidy_year))}
                      className={`px-2 py-0.5 rounded-md text-[11px] border transition-all ${
                        selectedYears.length === detail.years.length
                          ? 'bg-[#E2EDE6] text-primary border-primary/30'
                          : 'bg-white text-text-muted border-border/60 hover:text-primary'
                      }`}>
                      全选
                    </button>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    {(['count', 'area', 'amount'] as Metric[]).map(m => (
                      <button key={m} onClick={() => setMetric(m)}
                        className={`px-2.5 py-1 text-[11px] rounded-lg transition-all ${
                          metric === m ? 'bg-primary text-white' : 'bg-[#F1EDE4] text-text-muted hover:bg-[#E6E0D4]'
                        }`}>
                        {m === 'count' ? (mode === 'farmer' ? '人数' : '户数') : m === 'area' ? '面积' : '金额'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── 总览图表 ── */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white rounded-card border border-border shadow-card p-4">
                  <div className="text-sm font-semibold text-text-primary mb-3">📊 {metricLabel} 逐年对比</div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} barCategoryGap="28%">
                        <CartesianGrid stroke={GRID_LINE} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="year" tick={{ fill: AXIS_MUTED, fontSize: 11 }} axisLine={{ stroke: GRID_LINE }} tickLine={false} />
                        <YAxis tick={{ fill: AXIS_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
                        <Tooltip
                          cursor={{ fill: 'rgba(42,120,214,0.06)' }}
                          contentStyle={{ borderRadius: 10, border: '1px solid #e5e5e0', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}
                          formatter={(v: number | string) => {
                            const n = Number(v)
                            return metric === 'amount' ? fmtMoney(n) : metric === 'area' ? fmtArea(n) + ' 亩' : fmtNum(n)
                          }}
                        />
                        <Bar dataKey={metricKey} name={metricLabel} fill={SERIES_BLUE} radius={[4, 4, 0, 0]} maxBarSize={56} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-card border border-border shadow-card p-4">
                  <div className="text-sm font-semibold text-text-primary mb-3">
                    📈 受益{mode === 'farmer' ? '农户' : '家庭户'}数 趋势
                  </div>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid stroke={GRID_LINE} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="year" tick={{ fill: AXIS_MUTED, fontSize: 11 }} axisLine={{ stroke: GRID_LINE }} tickLine={false} />
                        <YAxis tick={{ fill: AXIS_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={42} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ borderRadius: 10, border: '1px solid #e5e5e0', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}
                        />
                        <Line type="monotone" dataKey="count" name={mode === 'farmer' ? '受益农户数' : '受益家庭户数'}
                          stroke={SERIES_BLUE} strokeWidth={2} dot={{ r: 4, fill: SERIES_BLUE, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {chartData.map(d => (
                      <span key={d.year} className="px-2 py-1 rounded-md bg-gray-50 border border-border/50 text-[11px] flex items-center gap-1.5">
                        <span className="text-text-muted">{d.year}</span>
                        <span className="text-emerald-700 font-medium">+{d.newCount}</span>
                        <span className="text-red-500 font-medium">-{d.removedCount}</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-text-muted/60 flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: DELTA_UP }} /> 新增</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: DELTA_DOWN }} /> 退出</span>
                    <span>（与上一年相比）</span>
                  </div>
                </div>
              </div>

              {/* ── 明细矩阵 ── */}
              <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {mode === 'farmer' ? '👤 农户' : '🏠 家庭户'}明细（{rows.length}）
                    </span>
                    <span className="text-[10px] text-text-muted">点击行查看个体逐年变化</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="搜索姓名/户名/村名"
                      className="px-2.5 py-1 text-xs border border-border/60 rounded-lg outline-none focus:ring-1 focus:ring-indigo-300 w-44" />
                    <div className="flex items-center gap-0.5 bg-[#F1EDE4] rounded-btn p-0.5">
                      <button onClick={() => setCellMetric('area')}
                        className={`px-2 py-0.5 text-[10px] rounded transition-all ${cellMetric === 'area' ? 'bg-white shadow-card text-primary font-semibold' : 'text-text-muted hover:text-primary'}`}>面积</button>
                      <button onClick={() => setCellMetric('amount')}
                        className={`px-2 py-0.5 text-[10px] rounded transition-all ${cellMetric === 'amount' ? 'bg-white shadow-card text-primary font-semibold' : 'text-text-muted hover:text-primary'}`}>金额</button>
                    </div>
                    <button onClick={exportExcel} disabled={rows.length === 0}
                      className="px-2.5 py-1 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                      ⬇ 导出Excel
                    </button>
                  </div>
                </div>
                {/* 筛选栏：村 / 组 / 波动范围 */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 border-b border-border/30 bg-gray-50/40">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-text-muted shrink-0">村</span>
                    <select value={villageFilter} onChange={e => { setVillageFilter(e.target.value); setGroupFilter('') }}
                      className="px-1.5 py-1 text-xs border border-border/60 rounded outline-none bg-white max-w-[110px]">
                      <option value="">全部</option>
                      {villages.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-text-muted shrink-0">组</span>
                    <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
                      className="px-1.5 py-1 text-xs border border-border/60 rounded outline-none bg-white max-w-[110px]">
                      <option value="">全部</option>
                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-text-muted shrink-0">波动差值</span>
                    <input type="number" min={0} value={volMin} placeholder="最小" onChange={e => setVolMin(e.target.value)}
                      className="w-14 px-1.5 py-1 text-xs border border-border/60 rounded outline-none bg-white" />
                    <span className="text-text-muted/50">~</span>
                    <input type="number" min={0} value={volMax} placeholder="最大" onChange={e => setVolMax(e.target.value)}
                      className="w-14 px-1.5 py-1 text-xs border border-border/60 rounded outline-none bg-white" />
                    <span className="text-text-muted/50 shrink-0">{cellMetric === 'area' ? '亩' : '元'}</span>
                  </div>
                  <span className="text-[11px] text-text-muted">预设</span>
                  {([
                    { label: '全部', mn: '', mx: '' },
                    { label: '无波动', mn: '0', mx: '0' },
                    { label: '0~30', mn: '0', mx: '30' },
                    { label: '>30', mn: '30', mx: '' },
                  ] as const).map(p => (
                    <button key={p.label} onClick={() => { setVolMin(p.mn); setVolMax(p.mx) }}
                      className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${volMin === p.mn && volMax === p.mx ? 'bg-[#E2EDE6] text-primary border-primary/30' : 'bg-white text-text-muted border-border/60 hover:text-text-primary'}`}>
                      {p.label}
                    </button>
                  ))}
                  {(villageFilter || groupFilter || volMin !== '' || volMax !== '') && (
                    <button onClick={() => { setVillageFilter(''); setGroupFilter(''); setVolMin(''); setVolMax('') }}
                      className="text-[11px] text-red-400 hover:text-red-600">✕ 清除筛选</button>
                  )}
                </div>
                {rows.length === 0 ? (
                  <div className="py-10 text-center text-text-muted text-xs">无匹配数据</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50/70 border-b border-border/60">
                          <th className="px-3 py-2 text-left font-medium text-text-primary w-56">
                            {mode === 'farmer' ? '农户' : '家庭户'}
                          </th>
                          {yearCols.map(y => (
                            <th key={y.type_id} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                              <button onClick={() => handleSortYear(y.subsidy_year)}
                                className={`hover:text-primary ${sortYear === y.subsidy_year ? 'text-indigo-600' : 'text-text-primary'}`}>
                                {y.subsidy_year}年
                                {sortYear === y.subsidy_year && (sortDir === 'desc' ? ' ↓' : ' ↑')}
                              </button>
                            </th>
                          ))}
                          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                            <button onClick={handleSortTotal}
                              className={`hover:text-primary ${sortTotal ? 'text-indigo-600' : 'text-text-muted'}`}>
                              多年合计{sortTotal && (sortDir === 'desc' ? ' ↓' : ' ↑')}
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((r, idx) => {
                          const total = yearCols.reduce((acc, y) => acc + (r.per_year[y.subsidy_year]?.[cellMetric] ?? 0), 0)
                          const hasAny = yearCols.some(y => (r.per_year[y.subsidy_year]?.[cellMetric] ?? 0) > 0)
                          return (
                            <tr key={mode === 'farmer' ? r.id_card : r.household_id}
                              onClick={() => setDrill(r)}
                              className={`border-b border-border/30 cursor-pointer transition-colors ${hasAny ? 'hover:bg-indigo-50/40' : 'opacity-50 hover:bg-gray-50'}`}>
                              <td className="px-3 py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-text-primary truncate max-w-[150px]">
                                    {mode === 'farmer' ? (r.real_name || '—') : r.household_name}
                                  </span>
                                  {mode === 'farmer' && r.id_card && (
                                    <span className="font-mono text-[10px] text-text-muted/70">{r.id_card}</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-text-muted truncate">
                                  {mode === 'farmer'
                                    ? ([r.household_name, r.village, r.group].filter(Boolean).join(' · ') || '—')
                                    : ([r.village, r.group].filter(Boolean).join(' · ') || '—')}
                                </div>
                                {mode === 'household' && r.members && r.members.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-0.5 max-w-[240px]">
                                    {r.members.slice(0, 6).map((m, i) => (
                                      <span key={i} className="px-1 py-px text-[10px] bg-gray-100 text-text-muted rounded">
                                        {m.real_name}
                                      </span>
                                    ))}
                                    {r.members.length > 6 && (
                                      <span className="px-1 py-px text-[10px] bg-gray-100 text-text-muted rounded">
                                        +{r.members.length - 6}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              {yearCols.map(y => {
                                const v = r.per_year[y.subsidy_year]?.[cellMetric] ?? 0
                                return (
                                  <td key={y.type_id}
                                    className={`px-2 py-1.5 text-right font-mono whitespace-nowrap ${v > 0 ? 'text-text-primary' : 'text-text-muted/40'}`}>
                                    {v > 0 ? (cellMetric === 'amount' ? fmtMoney(v) : fmtArea(v)) : '—'}
                                  </td>
                                )
                              })}
                              <td className="px-3 py-1.5 text-right font-mono whitespace-nowrap text-indigo-600 font-semibold">
                                {cellMetric === 'amount' ? fmtMoney(total) : fmtArea(total)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/30">
                      <div className="text-[11px] text-text-muted">
                        共 {rows.length} 条 · 第 {curPage + 1}/{pageCount} 页
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-[11px] text-text-muted">每页</span>
                        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
                          className="px-1.5 py-0.5 text-xs border border-border/60 rounded outline-none bg-white">
                          {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span className="text-[11px] text-text-muted">条</span>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={curPage === 0}
                          className="px-2 py-0.5 rounded border border-border/60 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">‹ 上一页</button>
                        <span className="text-text-muted text-[11px]">第 {curPage + 1} / {pageCount} 页</span>
                        <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={curPage >= pageCount - 1}
                          className="px-2 py-0.5 rounded border border-border/60 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">下一页 ›</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* ═══ 个体下钻 Modal ═══ */}
      <Modal open={drill !== null} title={`📊 ${drillTitle}`} onClose={() => setDrill(null)} width={640}
        confirmText="关闭" onConfirm={() => setDrill(null)}>
        {drill && detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
              <span className="px-2 py-1 rounded-md bg-indigo-50 text-primary">
                {mode === 'farmer' ? '👤 农户' : '🏠 家庭户'}
              </span>
              <span>{[drill.household_name, drill.village, drill.group].filter(Boolean).join(' · ') || '—'}</span>
              {mode === 'farmer' && drill.id_card && <span className="font-mono text-text-muted/70">{drill.id_card}</span>}
            </div>

            <div>
              <div className="text-xs font-semibold text-text-primary mb-2">📐 逐年面积（亩）</div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={drillData} barCategoryGap="30%">
                    <CartesianGrid stroke={GRID_LINE} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="year" tick={{ fill: AXIS_MUTED, fontSize: 11 }} axisLine={{ stroke: GRID_LINE }} tickLine={false} />
                    <YAxis tick={{ fill: AXIS_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip formatter={(v: number | string) => fmtArea(Number(v)) + ' 亩'}
                      contentStyle={{ borderRadius: 10, border: '1px solid #e5e5e0', fontSize: 12 }} />
                    <Bar dataKey="面积" fill={SERIES_BLUE} radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-text-primary mb-2">💰 逐年金额（元）</div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={drillData} barCategoryGap="30%">
                    <CartesianGrid stroke={GRID_LINE} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="year" tick={{ fill: AXIS_MUTED, fontSize: 11 }} axisLine={{ stroke: GRID_LINE }} tickLine={false} />
                    <YAxis tick={{ fill: AXIS_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip formatter={(v: number | string) => fmtMoney(Number(v))}
                      contentStyle={{ borderRadius: 10, border: '1px solid #e5e5e0', fontSize: 12 }} />
                    <Bar dataKey="金额" fill={SERIES_BLUE} radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-border/60">
                    <th className="px-3 py-2 text-left font-medium text-text-primary">年份</th>
                    <th className="px-3 py-2 text-right font-medium text-text-primary">面积(亩)</th>
                    <th className="px-3 py-2 text-right font-medium text-text-primary">金额(元)</th>
                  </tr>
                </thead>
                <tbody>
                  {drillData.map((d, i) => (
                    <tr key={i} className={`border-b border-border/30 ${d.面积 > 0 || d.金额 > 0 ? '' : 'opacity-50'}`}>
                      <td className="px-3 py-1.5 text-text-primary font-mono">{d.year}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{d.面积 > 0 ? fmtArea(d.面积) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{d.金额 > 0 ? fmtMoney(d.金额) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
