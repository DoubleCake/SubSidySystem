import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import type { FarmerOut, FarmerCreate, VillageGroup } from '../types'
import { FARMER_STATUS, PAY_STATUS, fmt, parseIdCardInfo, years } from '../utils'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import type { ExcelColumnTemplate } from '../types'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import * as XLSX from 'xlsx'
import HouseholdsPage from './HouseholdsPage'

const FARMER_TEMPLATE_HEADERS = ['姓名*', '身份证号*', '所在村*', '所在组*', '手机号', '银行卡号', '开户行', '地址', '土地面积', '状态']
const FARMER_TEMPLATE_EXAMPLE = [
  { '姓名*': '张国强', '身份证号*': '510123196503154231', '所在村*': '红星村', '所在组*': '一组', '手机号': '13812340001', '银行卡号': '6222021234560001', '开户行': '农业银行红星支行', '地址': '红星村一组12号', '土地面积': 3.5, '状态': '在册' },
]

const FARMER_SYSTEM_FIELDS = [
  { field: "real_name",     label: "姓名",     required: true,  type: "string" },
  { field: "id_card",       label: "身份证号", required: true,  type: "id_card" },
  { field: "village_name",  label: "所在村",   required: true,  type: "string" },
  { field: "group_no",      label: "所在组",   required: true,  type: "string" },
  { field: "phone",         label: "手机号",   required: false, type: "phone" },
  { field: "bank_card",     label: "银行卡号", required: false, type: "string" },
  { field: "bank_name",     label: "开户行",   required: false, type: "string" },
  { field: "address",       label: "地址",     required: false, type: "string" },
  { field: "land_area",     label: "土地面积", required: false, type: "decimal" },
  { field: "farmer_status", label: "状态",     required: false, type: "status" },
]

type DetailFarmer = FarmerOut & {
  id_card?: string; phone?: string; bank_card?: string
  birth_date?: string; household_code?: string
  applications?: AppRecord[]
  household_members?: MemberRow[]
}
type AppRecord = {
  id: number; apply_year: number; subsidy_name: string
  apply_amount: string | null; actual_amount: string | null
  apply_area: string | null; pay_status: number; pay_date: string | null
  remark: string | null; calc_mode: string
}
type MemberRow = {
  id: number; real_name: string; gender: number; is_head: number
  relation: string | null; farmer_status: number
  birth_date: string | null; id_card_masked: string
}

const GENDER = (g: number) => g === 1 ? '男' : '女'
const calcAge = (birth?: string | null) => {
  if (!birth) return null
  const b = new Date(birth)
  const now = new Date()
  return now.getFullYear() - b.getFullYear() - (now < new Date(now.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
}

export default function FarmersPage() {
  const { toast, show } = useToast()
  const [mainTab, setMainTab] = useState<'farmers' | 'households'>('farmers')
  const [farmers, setFarmers] = useState<FarmerOut[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [villageFilter, setVillageFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [incompleteOnly, setIncompleteOnly] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeFile, setCompleteFile] = useState<File|null>(null)
  const [completeResult, setCompleteResult] = useState<{updated:number;errors:string[]}|null>(null)
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [villages, setVillages] = useState<string[]>([])
  const [detail, setDetail] = useState<DetailFarmer | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<Partial<FarmerCreate & { village_group_id: number }>>({})
  const [detailTab, setDetailTab] = useState<'info' | 'subsidy' | 'family'>('info')
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [templates, setTemplates] = useState<ExcelColumnTemplate[]>([])
  const [form, setForm] = useState<Partial<FarmerCreate>>({ farmer_status: 1, gender: 1 })
  const [idHint, setIdHint] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p: Record<string, string | number> = { page, page_size: 20 }
      if (search)        p.search       = search
      if (villageFilter) p.village_name = villageFilter
      if (statusFilter)  p.status       = statusFilter
      if (incompleteOnly) p.incomplete  = '1'
      const res = await api.getFarmers(p)
      setFarmers(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }, [page, search, villageFilter, statusFilter, incompleteOnly])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.getVillageGroups().then(g => {
      setGroups(g); setVillages([...new Set(g.map(v => v.village_name))])
    })
    api.getExcelTemplates('FARMER').then(setTemplates).catch(() => {})
  }, [])
  useEffect(() => {
    const t = setTimeout(() => { setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const openDetail = async (id: number) => {
    const f = await api.getFarmer(id) as DetailFarmer
    setDetail(f); setDetailTab('info')
  }

  const openEditFarmer = () => {
    if (!detail) return
    setEditForm({
      real_name: detail.real_name,
      phone: (detail as DetailFarmer & { phone?: string }).phone || '',
      bank_card: (detail as DetailFarmer & { bank_card?: string }).bank_card || '',
      bank_name: detail.bank_name || '',
      address: detail.address || '',
      land_area: detail.land_area ? Number(detail.land_area) : undefined,
      farmer_status: detail.farmer_status,
      village_group_id: 0,
    })
    setEditOpen(true)
  }

  const submitEditFarmer = async () => {
    if (!detail) return
    try {
      await api.updateFarmer(detail.id, editForm)
      show('✓ 信息已更新')
      setEditOpen(false)
      const f = await api.getFarmer(detail.id) as DetailFarmer
      setDetail(f)
      load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleIdCardInput = (val: string) => {
    setForm(f => ({ ...f, id_card: val }))
    const info = parseIdCardInfo(val)
    if (info) {
      setIdHint(`✓ 生日：${info.birth}  性别：${info.gender === 1 ? '男' : '女'}`)
      setForm(f => ({ ...f, gender: info.gender }))
    } else setIdHint('')
  }

  const submitFarmer = async () => {
    if (!form.real_name || !form.id_card || !form.village_group_id)
      return show('请填写姓名、身份证号和所在村组', 'err')
    if (form.id_card.length !== 18) return show('身份证号应为18位', 'err')
    try {
      await api.createFarmer(form as FarmerCreate)
      show('✓ 农户创建成功'); setAddOpen(false); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleImport = async (rows: Record<string, unknown>[], mapping?: Record<string, string>) => {
    const toCreate: Record<string, unknown>[] = []
    const formatErrors: string[] = []
    rows.forEach((row, i) => {
      // 优先从映射后的系统字段取值，回退到中文列名
      const name   = String(row['real_name'] || row['姓名*']   || row['姓名']   || '').trim()
      const idCard = String(row['id_card']   || row['身份证号*'] || row['身份证号'] || '').trim()
      if (!name || !idCard) { formatErrors.push(`第${i+2}行：姓名或身份证号为空`); return }
      const vn = String(row['village_name'] || row['所在村*'] || row['所在村'] || '').trim()
      const gn = String(row['group_no']     || row['所在组*'] || row['所在组'] || '').trim()
      if (!vn || !gn) { formatErrors.push(`第${i+2}行 ${name}：请填写所在村和所在组`); return }
      const info = parseIdCardInfo(idCard)
      const statusMap: Record<string, number> = { '在册':1, '注销':2, '迁出':3, '死亡':4 }
      const rawStatus = String(row['farmer_status'] || row['状态'] || '').trim()
      toCreate.push({
        real_name: name, id_card: idCard,
        gender: info?.gender ?? (String(row['gender']||row['性别']||'').includes('女') ? 2 : 1),
        village_name: vn, group_no: gn,
        phone:     String(row['phone']     || row['手机号']  || '').trim() || undefined,
        bank_card: String(row['bank_card'] || row['银行卡号']|| '').trim() || undefined,
        bank_name: String(row['bank_name'] || row['开户行']  || '').trim() || undefined,
        address:   String(row['address']   || row['地址']    || '').trim() || undefined,
        land_area: Number(row['land_area'] || row['土地面积']) || undefined,
        farmer_status: statusMap[rawStatus] ?? 1,
      })
    })
    if (formatErrors.length > 0 && toCreate.length === 0) return { created: 0, skipped: 0, errors: formatErrors }
    const res = await fetch('/api/farmers/batch-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: toCreate }),
    }).then(r => r.json()) as { created: number; skipped: number; errors: string[] }
    api.getVillageGroups().then(g => {
      setGroups(g); setVillages([...new Set(g.map(v => v.village_name))])
    })
    const allErrors = [...formatErrors, ...(res.errors || [])]
    if (res.skipped > 0) allErrors.push(`已跳过 ${res.skipped} 条重复身份证记录（该身份证号已存在）`)
    return { ...res, errors: allErrors }
  }

  const detectExcelColumns = async (columns: string[], sampleRows: Record<string, unknown>[]): Promise<{
    detected_mappings: Array<{ excel_column: string; suggested_field: string | null; confidence: number; alternatives: Array<{ field: string; confidence: number }> }>
    recommended_templates?: Array<{ id: number; template_name: string; match_rate: number }>
  }> => {
    try {
      const response = await fetch('/api/excel-templates/detect-columns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, business_type: 'FARMER', sample_rows: sampleRows }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch {
      // 回退：空映射
      return { detected_mappings: columns.map(c => ({ excel_column: c, suggested_field: null, confidence: 0, alternatives: [] })) }
    }
  }

  const saveColumnMappingTemplate = async (data: {
    template_name: string; template_year?: number; region_name?: string; business_type: string
    column_mapping: Array<{ excel_column: string; system_field: string; aliases: string[]; required: boolean; transform?: string }>
  }): Promise<{ id: number }> => {
    const response = await fetch('/api/excel-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const result = await response.json() as { id: number }
    api.getExcelTemplates('FARMER').then(setTemplates).catch(() => {})
    return result
  }
  // 导出当前筛选结果
  const exportCurrentList = async () => {
    // 取全量（不分页），最多 5000 条
    const params: Record<string, string | number> = { page: 1, page_size: 5000 }
    if (search)        params.search       = search
    if (villageFilter) params.village_name = villageFilter
    if (statusFilter)  params.status       = statusFilter
    const res = await api.getFarmers(params)
    const rows = res.items.map(f => ({
      '姓名':     f.real_name,
      '性别':     f.gender === 1 ? '男' : '女',
      '身份证号': (f as { id_card?: string }).id_card || f.id_card_masked,
      '手机号':   (f as { phone?: string }).phone || f.phone_masked || '',
      '所在村组': f.village_full_name,
      '土地面积': f.land_area || '',
      '角色':     f.is_head ? '户主' : '成员',
      '状态':     { 1:'在册', 2:'注销', 3:'迁出', 4:'死亡' }[f.farmer_status] || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [10,6,20,14,14,10,8,8].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '农户列表')
    const date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '')
    const tag  = villageFilter || statusFilter ? `_筛选` : ''
    XLSX.writeFile(wb, `农户列表${tag}_${date}.xlsx`)
    show(`✓ 已导出 ${rows.length} 条记录`)
  }



  // ── 详情页 ──
  if (detail) {
    const age    = calcAge(detail.birth_date)
    const apps   = detail.applications || []
    const mems   = detail.household_members || []
    const totalAmt = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
    const byYear: Record<number, number> = {}
    apps.forEach(a => { byYear[a.apply_year] = (byYear[a.apply_year] || 0) + Number(a.actual_amount || 0) })

    return (
      <div>
        <button onClick={() => setDetail(null)} className="mb-4 text-sm text-emerald-700 hover:underline flex items-center gap-1.5">
          ← 返回列表
        </button>

        {/* 顶部个人卡片 */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm mb-4">
          <div className="bg-gradient-to-r from-emerald-800 to-emerald-700 px-6 py-5 flex items-center gap-5">
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white shrink-0">
              {detail.real_name.slice(-1)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-xl font-bold text-white">{detail.real_name}</span>
                <span className="text-emerald-300 text-sm">{GENDER(detail.gender)}</span>
                {age && <span className="text-emerald-300 text-sm">{age} 岁</span>}
                <Tag label={FARMER_STATUS[detail.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[detail.farmer_status]?.color as 'green'} />
                {detail.is_head ? <Tag label="户主" color="purple" /> : <Tag label={detail.relation || '成员'} color="gray" />}
              </div>
              <div className="text-emerald-200 text-sm">📍 {detail.village_full_name}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-bold font-mono text-white">¥{totalAmt.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</div>
              <div className="text-emerald-300 text-xs mt-0.5">累计获得补贴</div>
              <div className="text-emerald-300 text-xs">{apps.length} 条记录</div>
            </div>
          </div>

          {/* Tab 切换 */}
          <div className="flex border-b border-stone-200 bg-stone-50 items-center">
            {[
              { id: 'info',   label: '📋 基本信息' },
              { id: 'subsidy',label: `💰 补贴记录 (${apps.length})` },
              { id: 'family', label: `🏠 家庭成员 (${mems.length + 1})` },
            ].map(t => (
              <button key={t.id} onClick={() => setDetailTab(t.id as typeof detailTab)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === t.id
                    ? 'border-emerald-600 text-emerald-700 bg-white'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}>{t.label}</button>
            ))}
            <div className="ml-auto px-3">
              <button onClick={openEditFarmer}
                className="text-xs text-stone-500 border border-stone-200 px-3 py-1.5 rounded-lg hover:text-emerald-700 hover:border-emerald-200">
                ✏️ 编辑信息
              </button>
            </div>
          </div>

          {/* Tab: 基本信息 */}
          {detailTab === 'info' && (
            <div className="grid grid-cols-2 gap-0 divide-x divide-stone-100">
              <div className="p-5">
                <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">个人信息</h3>
                <div className="space-y-3">
                  {[
                    ['姓名',    detail.real_name],
                    ['性别',    GENDER(detail.gender)],
                    ['出生日期', detail.birth_date ?? '—'],
                    ['年龄',    age ? `${age} 岁` : '—'],
                    ['身份证号',<span className="font-mono text-amber-600 text-xs select-all">{detail.id_card || detail.id_card_masked}</span>],
                    ['手机号',  <span className="font-mono text-xs">{detail.phone || detail.phone_masked || '—'}</span>],
                    ['详细地址', detail.address || '—'],
                    ['土地面积', detail.land_area ? `${detail.land_area} 亩` : '—'],
                  ].map(([k, v], i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-stone-400 w-20 shrink-0">{k}</span>
                      <span className="text-sm text-stone-700">{v as React.ReactNode}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-5">
                <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">户籍 & 银行</h3>
                <div className="space-y-3">
                  {[
                    ['所在位置', detail.village_full_name],
                    ['家庭户编码', <span className="font-mono text-xs text-blue-600">{detail.household_code || `HH${String(detail.household_id).padStart(4,'0')}`}</span>],
                    ['银行卡号', <span className="font-mono text-xs text-amber-600 select-all">{detail.bank_card || detail.bank_card_masked || '—'}</span>],
                    ['开户行',   detail.bank_name || '—'],
                    ['农户状态', <Tag label={FARMER_STATUS[detail.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[detail.farmer_status]?.color as 'green'} />],
                    ['备注',    detail.remark || '—'],
                    ['录入时间', detail.created_at ? detail.created_at.slice(0, 10) : '—'],
                  ].map(([k, v], i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-stone-400 w-20 shrink-0">{k}</span>
                      <span className="text-sm text-stone-700">{v as React.ReactNode}</span>
                    </div>
                  ))}
                </div>
                {/* 年度补贴小图 */}
                {Object.keys(byYear).length > 0 && (
                  <div className="mt-5 pt-4 border-t border-stone-100">
                    <h3 className="text-xs font-semibold text-stone-400 mb-3">历年补贴合计</h3>
                    <div className="space-y-2">
                      {Object.entries(byYear).sort((a,b)=>Number(b[0])-Number(a[0])).map(([yr, amt]) => {
                        const max = Math.max(...Object.values(byYear))
                        return (
                          <div key={yr} className="flex items-center gap-2">
                            <span className="text-xs font-bold text-blue-600 w-10">{yr}</span>
                            <div className="flex-1 bg-stone-100 rounded-full h-2 overflow-hidden">
                              <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${(amt/max)*100}%` }} />
                            </div>
                            <span className="text-xs font-mono text-emerald-700 w-20 text-right">¥{amt.toLocaleString('zh-CN',{maximumFractionDigits:0})}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab: 补贴记录 */}
          {detailTab === 'subsidy' && (
            <div>
              {apps.length === 0
                ? <div className="py-14 text-center text-stone-300 text-sm">暂无补贴记录</div>
                : (
                  <>
                    <table className="w-full border-collapse">
                      <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
                        {['年度','补贴项目','计算方式','面积','申请金额','实发金额','打款日期','状态'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {apps.map(a => (
                          <tr key={a.id} className="border-b border-stone-50 hover:bg-stone-50">
                            <td className="px-4 py-2.5 text-sm font-bold text-blue-600">{a.apply_year}</td>
                            <td className="px-4 py-2.5 text-sm font-medium">{a.subsidy_name}</td>
                            <td className="px-4 py-2.5 text-xs text-stone-400">{a.calc_mode === 'per_mu' ? '按亩' : '固定'}</td>
                            <td className="px-4 py-2.5 text-sm font-mono">{a.apply_area ? `${a.apply_area}亩` : '—'}</td>
                            <td className="px-4 py-2.5 text-sm font-mono text-stone-500">{fmt(a.apply_amount)}</td>
                            <td className="px-4 py-2.5 text-sm font-mono font-bold" style={{ color: a.actual_amount ? '#15803d' : '#d97706' }}>
                              {a.actual_amount ? fmt(a.actual_amount) : '待发放'}
                            </td>
                            <td className="px-4 py-2.5 text-xs font-mono text-stone-400">{a.pay_date ?? '—'}</td>
                            <td className="px-4 py-2.5"><Tag label={PAY_STATUS[a.pay_status]?.label} color={PAY_STATUS[a.pay_status]?.color as 'green'} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="px-4 py-2.5 bg-emerald-50 border-t border-emerald-100 flex justify-end gap-6 text-sm">
                      <span className="text-stone-500">合计 {apps.length} 笔</span>
                      <span className="font-bold font-mono text-emerald-700">¥{totalAmt.toFixed(2)}</span>
                    </div>
                  </>
                )
              }
            </div>
          )}

          {/* Tab: 家庭成员 */}
          {detailTab === 'family' && (
            <div className="p-5">
              <div className="grid gap-3">
                {/* 本人 */}
                <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                    {detail.real_name.slice(-1)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-stone-800">{detail.real_name}</span>
                      <Tag label="本人" color="green" />
                      {detail.is_head ? <Tag label="户主" color="purple" /> : null}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {GENDER(detail.gender)} · {detail.birth_date ?? '—'}
                      {age ? ` · ${age}岁` : ''}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-stone-400">{detail.id_card_masked}</span>
                </div>

                {mems.length === 0
                  ? <div className="text-center py-6 text-stone-300 text-sm border border-dashed border-stone-200 rounded-xl">该户暂无其他成员记录</div>
                  : mems.map(m => (
                    <div key={m.id} className="flex items-center gap-4 bg-white border border-stone-200 rounded-xl px-4 py-3 hover:border-stone-300">
                      <div className="w-9 h-9 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center font-bold text-sm shrink-0">
                        {m.real_name.slice(-1)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-stone-800">{m.real_name}</span>
                          {m.relation && <Tag label={m.relation} color="gray" />}
                          {m.is_head ? <Tag label="户主" color="purple" /> : null}
                          {m.farmer_status !== 1 && <Tag label={FARMER_STATUS[m.farmer_status]?.label} color="red" />}
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5">
                          {GENDER(m.gender)} · {m.birth_date ?? '—'}
                          {calcAge(m.birth_date) ? ` · ${calcAge(m.birth_date)}岁` : ''}
                        </div>
                      </div>
                      <span className="text-xs font-mono text-stone-400">{m.id_card_masked}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
        <Toast {...toast} />
      </div>
    )
  }

  // ── 列表页 ──
  if (detail) {
    // detail view is handled above
  }

  return (
    <div>
      {/* 主 Tab 切换 */}
      <div className="flex items-center gap-1 mb-5 border-b border-stone-200">
        <button onClick={() => setMainTab('farmers')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            mainTab === 'farmers' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}>👤 农户档案</button>
        <button onClick={() => setMainTab('households')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            mainTab === 'households' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}>🏠 家庭户管理</button>
      </div>

      {mainTab === 'households' && <HouseholdsPage />}
      {mainTab === 'farmers' && !detail && <>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: '农户总数',    val: total,                                                                        color: 'text-emerald-700' },
          { label: '在册',       val: farmers.filter(f => f.farmer_status === 1).length + (page > 1 ? '+' : ''), color: 'text-emerald-700' },
          { label: '注销/迁出',  val: farmers.filter(f => f.farmer_status !== 1).length + (page > 1 ? '+' : ''), color: 'text-red-500'     },
          { label: '覆盖村庄数', val: villages.length,                                                               color: 'text-blue-600'   },
        ].map(s => (
          <div key={s.label} className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
            <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
            <div className="text-xs text-stone-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索姓名 / 身份证号…"
          className="flex-1 min-w-48 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 bg-white" />
        <select value={villageFilter} onChange={e => { setVillageFilter(e.target.value); setPage(1) }}
          className="border border-stone-200 rounded-lg px-2 py-2 text-sm bg-white outline-none">
          <option value="">全部村庄</option>
          {villages.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="border border-stone-200 rounded-lg px-2 py-2 text-sm bg-white outline-none">
          <option value="">全部状态</option>
          <option value="1">在册</option><option value="2">注销</option><option value="3">迁出</option>
        </select>
        <button onClick={exportCurrentList} className="px-3 py-2 text-sm border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-50">⬇ 导出列表</button>
        <button onClick={() => { setIncompleteOnly(v => !v); setPage(1) }}
          className={`px-3 py-2 text-sm border rounded-lg transition-colors ${incompleteOnly ? 'bg-amber-100 border-amber-300 text-amber-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
          {incompleteOnly ? '⚠️ 信息不完善' : '筛选：信息不完善'}
        </button>
        {incompleteOnly && (
          <button onClick={() => setCompleteOpen(true)}
            className="px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">
            ↑ 批量补全信息
          </button>
        )}
        <button onClick={() => setImportOpen(true)} className="px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">↑ Excel 导入</button>
        <button onClick={() => setAddOpen(true)}    className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">＋ 新增农户</button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
            {['姓名','性别','年龄','身份证号','手机','所在位置','面积','角色','状态','操作'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="text-center py-12 text-stone-300">加载中…</td></tr>}
            {!loading && farmers.length === 0 && <tr><td colSpan={10} className="text-center py-12 text-stone-300 text-sm">暂无数据，请确认后端服务已启动</td></tr>}
            {!loading && farmers.map(f => {
              const fd = f as FarmerOut & { birth_date?: string }
              const age = calcAge(fd.birth_date)
              return (
                <tr key={f.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors ${f.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2.5 text-sm font-semibold text-stone-800">{f.real_name}</td>
                  <td className="px-3 py-2.5 text-sm text-stone-500">{GENDER(f.gender)}</td>
                  <td className="px-3 py-2.5 text-sm text-stone-400">{age ? `${age}岁` : '—'}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-stone-400">{f.id_card_masked}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-stone-400">{f.phone_masked || '—'}</td>
                  <td className="px-3 py-2.5 text-sm text-stone-500">{f.village_full_name}</td>
                  <td className="px-3 py-2.5 text-sm">{f.land_area ? `${f.land_area}亩` : '—'}</td>
                  <td className="px-3 py-2.5"><Tag label={f.is_head ? '户主' : '成员'} color={f.is_head ? 'purple' : 'gray'} /></td>
                  <td className="px-3 py-2.5"><Tag label={FARMER_STATUS[f.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[f.farmer_status]?.color as 'green'} /></td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => openDetail(f.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-50">详情</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100 bg-stone-50/50 flex items-center justify-between">
          <span>共 {total} 条记录</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p-1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40 hover:bg-stone-50">‹</button>
            <span className="px-2.5 py-1">第 {page} / {Math.max(1, Math.ceil(total/20))} 页</span>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p+1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40 hover:bg-stone-50">›</button>
          </div>
        </div>
      </div>

      <Modal open={addOpen} title="新增农户" onClose={() => setAddOpen(false)} onConfirm={submitFarmer}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label:'姓名 *',       key:'real_name',  type:'text',   placeholder:'真实姓名' },
            { label:'身份证号 *',   key:'id_card',    type:'text',   placeholder:'18位身份证号', hint:idHint, onInput:handleIdCardInput },
            { label:'手机号',       key:'phone',      type:'text',   placeholder:'联系电话' },
            { label:'土地面积(亩)', key:'land_area',  type:'number', placeholder:'0.0' },
            { label:'银行卡号',     key:'bank_card',  type:'text',   placeholder:'补贴打款账号' },
            { label:'开户行',       key:'bank_name',  type:'text',   placeholder:'农业银行XX支行' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs text-stone-400 mb-1">{f.label}</label>
              <input type={f.type} placeholder={f.placeholder}
                value={String((form as Record<string,unknown>)[f.key] ?? '')}
                onChange={e => { f.onInput ? f.onInput(e.target.value) : setForm(p => ({...p,[f.key]:e.target.value})) }}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              {f.hint && <p className="text-xs mt-1" style={{color:'#15803d'}}>{f.hint}</p>}
            </div>
          ))}
          <div>
            <label className="block text-xs text-stone-400 mb-1">所在村组 *</label>
            <select value={form.village_group_id ?? ''} onChange={e => setForm(p => ({...p,village_group_id:Number(e.target.value)}))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">请选择</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">状态</label>
            <select value={form.farmer_status ?? 1} onChange={e => setForm(p => ({...p,farmer_status:Number(e.target.value)}))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value={1}>在册</option><option value={2}>注销</option><option value={3}>迁出</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">详细地址</label>
            <input value={form.address ?? ''} onChange={e => setForm(p => ({...p,address:e.target.value}))} placeholder="如：红星村一组12号"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
        </div>
      </Modal>

      <ExcelImportWithMapping open={importOpen} onClose={() => setImportOpen(false)} title="农户信息导入"
        templateHeaders={FARMER_TEMPLATE_HEADERS} templateExample={FARMER_TEMPLATE_EXAMPLE}
        systemFields={FARMER_SYSTEM_FIELDS} templates={templates}
        onDetectColumns={detectExcelColumns} onSaveTemplate={saveColumnMappingTemplate}
        onImport={handleImport} onSuccess={load} />

      {/* 批量补全弹窗 */}
      <Modal open={completeOpen} title="批量补全农户信息" onClose={() => { setCompleteOpen(false); setCompleteFile(null); setCompleteResult(null) }}
        onConfirm={completeFile && !completeResult ? async () => {
          const reader = new FileReader()
          reader.onload = async e => {
            const wb = (await import('xlsx')).default.read(e.target?.result, { type: 'array' })
            const rows = (await import('xlsx')).default.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, unknown>[]
            const toComplete = rows.map(r => ({
              id_card:   String(r['身份证号*'] || r['身份证号'] || '').trim(),
              real_name: String(r['姓名'] || '').trim(),
              phone:     String(r['手机号'] || '').trim() || undefined,
              bank_card: String(r['银行卡号'] || '').trim() || undefined,
              bank_name: String(r['开户行'] || '').trim() || undefined,
              land_area: Number(r['土地面积'] || 0) || undefined,
              address:   String(r['地址'] || '').trim() || undefined,
            })).filter(r => r.id_card)
            const res = await fetch('/api/farmers/bulk-complete', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rows: toComplete })
            }).then(r => r.json()) as { updated: number; errors: string[] }
            setCompleteResult(res)
            if (res.updated > 0) { show(`✓ 已补全 ${res.updated} 条`); load() }
          }
          reader.readAsArrayBuffer(completeFile)
        } : undefined}
        confirmText="开始补全">
        <div className="space-y-3">
          {!completeResult ? (
            <>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
                上传包含「身份证号*」列的 Excel，其他列（手机号、银行卡号、开户行、土地面积、地址）将补全到对应农户。已有的字段不会覆盖，仅补全空白字段。
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">上传 Excel（必须含「身份证号*」列）</label>
                <input type="file" accept=".xlsx,.xls" onChange={e => setCompleteFile(e.target.files?.[0] || null)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          ) : (
            <div className="text-center space-y-3">
              <div className="text-4xl">{completeResult.errors.length === 0 ? '✅' : '⚠️'}</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-emerald-50 rounded-xl p-3">
                  <div className="text-2xl font-bold text-emerald-700">{completeResult.updated}</div>
                  <div className="text-xs text-stone-400">成功补全</div>
                </div>
                <div className="bg-red-50 rounded-xl p-3">
                  <div className="text-2xl font-bold text-red-500">{completeResult.errors.length}</div>
                  <div className="text-xs text-stone-400">失败</div>
                </div>
              </div>
              {completeResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-left max-h-32 overflow-auto">
                  {completeResult.errors.map((e, i) => <p key={i} className="text-xs text-red-600">• {e}</p>)}
                </div>
              )}
              <button onClick={() => { setCompleteResult(null); setCompleteFile(null) }} className="text-xs text-stone-400 hover:underline">重新上传</button>
            </div>
          )}
        </div>
      </Modal>

      <Toast {...toast} />
      </>}
    </div>
  )
}
