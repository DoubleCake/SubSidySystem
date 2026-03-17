import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import type { FarmerOut, FarmerCreate, VillageGroup } from '../types'
import { FARMER_STATUS, PAY_STATUS, fmt, parseIdCardInfo, guessVillageGroupId, years } from '../utils'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import ExcelImport from '../components/ExcelImport'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import * as XLSX from 'xlsx'

const FARMER_TEMPLATE_HEADERS = ['姓名*', '身份证号*', '所在村*', '所在组*', '手机号', '银行卡号', '开户行', '地址', '土地面积', '状态']
const FARMER_TEMPLATE_EXAMPLE = [
  { '姓名*': '张国强', '身份证号*': '510123196503154231', '所在村*': '红星村', '所在组*': '一组', '手机号': '13812340001', '银行卡号': '6222021234560001', '开户行': '农业银行红星支行', '地址': '红星村一组12号', '土地面积': 3.5, '状态': '在册' },
]

export default function FarmersPage() {
  const { toast, show } = useToast()
  const [farmers, setFarmers] = useState<FarmerOut[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [villageFilter, setVillageFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [villages, setVillages] = useState<string[]>([])

  const [detail, setDetail] = useState<FarmerOut | null>(null)
  const [detailApps, setDetailApps] = useState<ReturnType<typeof Array<unknown>>>([])

  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [form, setForm] = useState<Partial<FarmerCreate>>({ farmer_status: 1, gender: 1 })
  const [idHint, setIdHint] = useState('')

const load = useCallback(async () => {
  setLoading(true)
  try {
    const params: Record<string, string | number> = { 
      page, 
      page_size: 20 
    }
    if (search) params.search = search
    if (villageFilter) params.village_name = villageFilter
    // 只有当 statusFilter 有值时才传给后端
    if (statusFilter !== '') params.status = statusFilter
    
    const res = await api.getFarmers(params)
    setFarmers(res.items)
    setTotal(res.total)
  } catch (e) {
    console.error("加载失败:", e)
    show("无法获取农户数据，请检查网络或后端服务", "err")
  } finally { 
    setLoading(false) 
  }
}, [page, search, villageFilter, statusFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.getVillageGroups().then(g => {
      setGroups(g)
      setVillages([...new Set(g.map(v => v.village_name))])
    })
  }, [])

  useEffect(() => {
    const d = setTimeout(() => { setPage(1); load() }, 350)
    return () => clearTimeout(d)
  }, [search])

  const openDetail = async (id: number) => {
    const f = await api.getFarmer(id)
    setDetail(f)
    const apps = await api.getApplications({ farmer_id: id, page_size: 50 })
    setDetailApps(apps.items)
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
      show('✓ 农户创建成功')
      setAddOpen(false); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }



  // Excel 导入处理
  const handleImport = async (rows: Record<string, unknown>[]) => {
    const toCreate: any[] = [] // 这里改为 any 或者你去 types.ts 扩展 FarmerCreate 类型
    const errors: string[] = []
    
    rows.forEach((row, i) => {
      const name = String(row['姓名*'] || row['姓名'] || '').trim()
      const idCard = String(row['身份证号*'] || row['身份证号'] || '').trim()
      if (!name || !idCard) { errors.push(`第${i + 2}行：姓名或身份证号为空`); return }
      
      const villageName = String(row['所在村*'] || row['所在村'] || '').trim()
      const groupName = String(row['所在组*'] || row['所在组'] || '').trim()
      
      // 依然尝试匹配现有的 ID，匹配不到就是 undefined
      const vgId = guessVillageGroupId(groups, villageName, groupName)
      
      const info = parseIdCardInfo(idCard)
      const statusMap: Record<string, number> = { '在册': 1, '注销': 2, '迁出': 3, '死亡': 4 }
      
      toCreate.push({
        real_name: name,
        id_card: idCard,
        gender: info?.gender ?? (String(row['性别'] || '').includes('女') ? 2 : 1),
        village_group_id: vgId || undefined, // 如果没有匹配到，传 undefined
        village_name: villageName,           // ✅ 新增：把原生村名传给后端
        group_name: groupName,               // ✅ 新增：把原生组名传给后端
        phone: String(row['手机号'] || '').trim() || undefined,
        bank_card: String(row['银行卡号'] || '').trim() || undefined,
        bank_name: String(row['开户行'] || '').trim() || undefined,
        address: String(row['地址'] || '').trim() || undefined,
        land_area: Number(row['土地面积']) || undefined,
        farmer_status: statusMap[String(row['状态'] || '')] ?? 1,
      })
    })
    
    if (errors.length > 0 && toCreate.length === 0) return { created: 0, skipped: 0, errors }
    
    // 此时 toCreate 里包含了没有 village_group_id 但是有 village_name 的数据
    // 后端接口 (api.batchImportFarmers) 接收到之后去执行自动建组逻辑
    const res = await api.batchImportFarmers(toCreate)
    
    // 导入成功后，重新加载一次村组列表，确保下拉菜单能看到新创建的村组
    api.getVillageGroups().then(g => {
      setGroups(g)
      setVillages([...new Set(g.map(v => v.village_name))])
    })
    
    return { ...res, errors: [...errors, ...res.errors] }
  }

  // 修正/调整农户所属村组（一键归籍）
  const handleAssignGroup = async (farmerId: number, groupId: number) => {
    if (!groupId) return
    try {
      // 假设你在 api.ts 中已经定义了 assignFarmerGroup
      // 或者直接临时用 api.post(`/farmers/${farmerId}/assign-group?village_group_id=${groupId}`)
      await api.assignFarmerGroup(farmerId, groupId) 
      show('✓ 村组关系调整成功')
      // 重新刷新详情和列表，确保数据同步
      openDetail(farmerId)
      load()
    } catch (e: any) {
      show(e.message || '调整失败', 'err')
    }
  }
  // 年度对比（详情用）
  const y24 = detailApps.filter((a: unknown) => (a as { apply_year: number }).apply_year === 2024).reduce((s: number, a: unknown) => s + Number((a as { actual_amount: string | null }).actual_amount || 0), 0)
  const y23 = detailApps.filter((a: unknown) => (a as { apply_year: number }).apply_year === 2023).reduce((s: number, a: unknown) => s + Number((a as { actual_amount: string | null }).actual_amount || 0), 0)
  const diff = y24 - y23

  if (detail) return (
    <div>
      <button onClick={() => setDetail(null)}
        className="mb-4 text-sm text-emerald-700 hover:underline flex items-center gap-1">
        ← 返回列表
      </button>
      <div className="grid grid-cols-[300px_1fr] gap-5">
        {/* 基础信息 */}
        <div className="space-y-4">
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <div className="font-bold text-lg text-stone-800">{detail.real_name}</div>
                <div className="text-xs text-stone-400 mt-0.5">{detail.gender === 1 ? '男' : '女'} · {detail.village_full_name}</div>
              </div>
              <Tag label={FARMER_STATUS[detail.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[detail.farmer_status]?.color as 'green'} />
            </div>
            <div className="divide-y divide-stone-50 px-5">
              {/* 1. 顶部基础信息 */}
              {[
                ['身份证', <span className="font-mono text-amber-600 text-xs">{detail.id_card}</span>],
                ['手机号', <span className="font-mono text-xs">{detail.phone || '—'}</span>],
              ].map(([k, v], i) => (
                <div key={i} className="flex justify-between items-center py-2.5 text-sm">
                  <span className="text-stone-400">{k}</span>
                  <span className="text-stone-700">{v as React.ReactNode}</span>
                </div>
              ))}

              {/* 2. 核心调整项：所在位置（单独编写，不参与循环） */}
              <div className="flex justify-between items-center py-2.5 text-sm">
                <span className="text-stone-400">所在位置</span>
                <div className="flex items-center gap-2">
                  <span className="text-stone-700 font-medium">{detail.village_full_name}</span>
                  <select 
                    className="text-[11px] border border-stone-200 rounded px-1.5 py-0.5 bg-stone-50 text-emerald-700 outline-none focus:border-emerald-500 cursor-pointer"
                    value={groups.find(g => g.full_name === detail.village_full_name)?.id || ''}
                    onChange={(e) => handleAssignGroup(detail.id, Number(e.target.value))}
                  >
                    <option value="">点击调整...</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 3. 底部次要信息 */}
              {[
                ['详细地址', detail.address || '—'],
                ['家庭编号', <span className="font-mono text-xs">HH{String(detail.id).padStart(4, '0')}</span>],
                ['土地面积', detail.land_area ? `${detail.land_area} 亩` : '—'],
              ].map(([k, v], i) => (
                <div key={i} className="flex justify-between items-center py-2.5 text-sm">
                  <span className="text-stone-400">{k}</span>
                  <span className="text-stone-700">{v as React.ReactNode}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 text-sm font-semibold text-stone-600">银行信息</div>
            <div className="divide-y divide-stone-50 px-5">
              {[
                ['银行卡号', <span className="font-mono text-amber-600 text-xs">{detail.bank_card_masked || '—'}</span>],
                ['开户行', detail.bank_name || '—'],
              ].map(([k, v], i) => (
                <div key={i} className="flex justify-between items-center py-2.5 text-sm">
                  <span className="text-stone-400">{k}</span>
                  <span className="text-stone-700">{v as React.ReactNode}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 补贴记录 */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
            <span className="font-semibold text-stone-700">补贴申请记录</span>
            <Tag label={`共 ${detailApps.length} 笔`} color="blue" />
          </div>
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-stone-100">
              {['年度', '补贴类型', '申请金额', '实发金额', '面积', '状态', '打款日期'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs text-stone-400 font-semibold">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(detailApps as ReturnType<typeof Array<unknown>>).map((a: unknown, i: number) => {
                const app = a as { apply_year: number; subsidy_name: string; apply_amount: string | null; actual_amount: string | null; apply_area: string | null; pay_status: number; pay_date: string | null }
                return (
                  <tr key={i} className="border-b border-stone-50 hover:bg-stone-50">
                    <td className="px-4 py-2.5 text-sm font-bold text-blue-600">{app.apply_year}</td>
                    <td className="px-4 py-2.5 text-sm">{app.subsidy_name}</td>
                    <td className="px-4 py-2.5 text-sm font-mono text-stone-500">{fmt(app.apply_amount)}</td>
                    <td className="px-4 py-2.5 text-sm font-mono font-bold" style={{ color: app.actual_amount ? '#15803d' : '#d97706' }}>{app.actual_amount ? fmt(app.actual_amount) : '待发放'}</td>
                    <td className="px-4 py-2.5 text-sm">{app.apply_area ?? '—'}</td>
                    <td className="px-4 py-2.5"><Tag label={PAY_STATUS[app.pay_status]?.label} color={PAY_STATUS[app.pay_status]?.color as 'green'} /></td>
                    <td className="px-4 py-2.5 text-xs font-mono text-stone-400">{app.pay_date ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(y24 > 0 || y23 > 0) && (
            <div className="m-4 bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center gap-6">
              <div className="text-center"><div className="text-lg font-bold font-mono text-stone-500">¥{y23.toFixed(2)}</div><div className="text-xs text-stone-400">2023年实发</div></div>
              <div className="text-stone-300 text-xl">→</div>
              <div className="text-center"><div className="text-lg font-bold font-mono text-emerald-700">¥{y24.toFixed(2)}</div><div className="text-xs text-stone-400">2024年实发</div></div>
              <div className="ml-auto"><Tag label={`${diff >= 0 ? '↑ +' : '↓ '}¥${Math.abs(diff).toFixed(2)}`} color={diff >= 0 ? 'green' : 'red'} /></div>
            </div>
          )}
        </div>
      </div>
      <Toast {...toast} />
    </div>
  )

  return (
    <div>
      {/* 统计 */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: '农户总数', val: total, color: 'text-emerald-700' },
          { label: '在册', val: farmers.filter(f => f.farmer_status === 1).length + (page > 1 ? '…' : ''), color: 'text-emerald-700' },
          { label: '注销/迁出', val: farmers.filter(f => f.farmer_status !== 1).length + (page > 1 ? '…' : ''), color: 'text-red-500' },
          { label: '村庄数', val: villages.length, color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
            <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
            <div className="text-xs text-stone-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索姓名 / 身份证号…"
          className="flex-1 min-w-48 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 bg-white" />
        <select value={villageFilter} onChange={e => { setVillageFilter(e.target.value); setPage(1); load() }}
          className="border border-stone-200 rounded-lg px-2 py-2 text-sm bg-white outline-none">
          <option value="">全部村庄</option>
          {villages.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); load() }}
          className="border border-stone-200 rounded-lg px-2 py-2 text-sm bg-white outline-none">
          <option value="">全部状态 (含死亡/注销)</option>
          <option value="1">在册</option><option value="2">注销</option><option value="3">迁出</option>
        </select>
        <button onClick={() => setImportOpen(true)} className="px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">↑ Excel导入</button>
        <button onClick={() => setAddOpen(true)} className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">＋ 新增农户</button>
      </div>

      {/* 表格 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
            {['姓名', '性别', '身份证号', '手机号', '所在位置', '面积(亩)', '角色', '状态', '操作'].map(h => (
              <th key={h} className="px-3.5 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="text-center py-10 text-stone-400 text-sm">加载中…</td></tr>}
            {!loading && farmers.map(f => (
              <tr key={f.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors ${f.farmer_status !== 1 ? 'opacity-60' : ''}`}>
                <td className="px-3.5 py-2.5 text-sm font-semibold text-stone-800">{f.real_name}</td>
                <td className="px-3.5 py-2.5 text-sm">{f.gender === 1 ? '男' : '女'}</td>
                <td className="px-3.5 py-2.5 text-xs font-mono text-stone-400">{f.id_card_masked}</td>
                <td className="px-3.5 py-2.5 text-xs font-mono text-stone-400">{f.phone_masked || '—'}</td>
                <td className="px-3.5 py-2.5 text-sm text-stone-500">{f.village_full_name}</td>
                <td className="px-3.5 py-2.5 text-sm">{f.land_area || '—'}</td>
                <td className="px-3.5 py-2.5"><Tag label={f.is_head ? '户主' : '成员'} color={f.is_head ? 'purple' : 'gray'} /></td>
                <td className="px-3.5 py-2.5"><Tag label={FARMER_STATUS[f.farmer_status]?.label ?? '未知'} color={FARMER_STATUS[f.farmer_status]?.color as 'green'} /></td>
                <td className="px-3.5 py-2.5">
                  <button onClick={() => openDetail(f.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-50">详情</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100 bg-stone-50/50 flex items-center justify-between">
          <span>共 {total} 条记录</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 text-xs border border-stone-200 rounded disabled:opacity-40 hover:bg-stone-50">‹</button>
            <span className="px-2.5 py-1 text-xs">第 {page} / {Math.ceil(total / 20)} 页</span>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 text-xs border border-stone-200 rounded disabled:opacity-40 hover:bg-stone-50">›</button>
          </div>
        </div>
      </div>

      {/* 新增弹窗 */}
      <Modal open={addOpen} title="新增农户" onClose={() => setAddOpen(false)} onConfirm={submitFarmer}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '姓名 *', key: 'real_name', type: 'text', placeholder: '真实姓名' },
            { label: '身份证号 *', key: 'id_card', type: 'text', placeholder: '18位身份证号', hint: idHint, onInput: handleIdCardInput },
            { label: '手机号', key: 'phone', type: 'text', placeholder: '联系电话' },
            { label: '土地面积(亩)', key: 'land_area', type: 'number', placeholder: '0.0' },
            { label: '银行卡号', key: 'bank_card', type: 'text', placeholder: '补贴打款账号' },
            { label: '开户行', key: 'bank_name', type: 'text', placeholder: '农业银行XX支行' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs text-stone-400 mb-1">{f.label}</label>
              <input type={f.type} placeholder={f.placeholder}
                value={String((form as Record<string, unknown>)[f.key] ?? '')}
                onChange={e => { f.onInput ? f.onInput(e.target.value) : setForm(p => ({ ...p, [f.key]: e.target.value })) }}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              {f.hint && <p className="text-xs mt-1" style={{ color: '#15803d' }}>{f.hint}</p>}
            </div>
          ))}
          <div>
            <label className="block text-xs text-stone-400 mb-1">所在村组 *</label>
            <select value={form.village_group_id ?? ''} onChange={e => setForm(p => ({ ...p, village_group_id: Number(e.target.value) }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">请选择</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">状态</label>
            <select value={form.farmer_status ?? 1} onChange={e => setForm(p => ({ ...p, farmer_status: Number(e.target.value) }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value={1}>在册</option><option value={2}>注销</option><option value={3}>迁出</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">详细地址</label>
            <input value={form.address ?? ''} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="如：红星村一组12号"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
          </div>
        </div>
      </Modal>

      {/* Excel 导入 */}
      <ExcelImport open={importOpen} onClose={() => setImportOpen(false)} title="农户信息"
        templateHeaders={FARMER_TEMPLATE_HEADERS} templateExample={FARMER_TEMPLATE_EXAMPLE}
        onImport={handleImport} onSuccess={load} />

      <Toast {...toast} />
    </div>
  )
}
