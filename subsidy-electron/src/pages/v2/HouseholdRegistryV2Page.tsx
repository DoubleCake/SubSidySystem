/**
 * 新版界面 - 户籍管理 · 农户（完全复刻画布 Farmers）
 *
 * 左侧 338px：农户 / 家庭户切换、搜索、村组与状态筛选、人员列表、分页
 * 右侧：人员档案头、家庭户面积条、四列基础信息、
 *       补贴记录 / 家庭成员 / 异常 / 变更历史 分类、家庭户信息、本户异常、最近变更
 *
 * 这一版以复刻版式为主，数据只读；编辑/新增等操作后续再接。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../../api'
import type { FarmerOut, FarmerDetail, HHDetail, VillageGroup } from '../../types'

const PAGE_SIZE = 20

const FARMER_STATUS_LABEL: Record<number, string> = { 1: '在册', 2: '注销', 3: '迁出', 4: '死亡' }
const PAY_STATUS_LABEL: Record<number, string> = { 0: '待发放', 1: '发放中', 2: '已发放' }

const AVATAR_TONES = [
  'bg-[#1A4D3A] text-[#E6C288]',
  'bg-[#F6EEDC] text-[#8A6620]',
  'bg-[#EDF3EF] text-[#1A4D3A]',
  'bg-[#E3EEF2] text-[#2E6478]',
  'bg-[#F1EDE4] text-[#5A5A4F]',
]
const tone = (name: string) => AVATAR_TONES[(name.charCodeAt(0) || 0) % AVATAR_TONES.length]

const money = (v: unknown) =>
  `¥${Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Tab = 'subsidy' | 'members' | 'anomaly' | 'history'

export default function HouseholdRegistryV2Page() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // ── 列表 ──
  const [list, setList] = useState<FarmerOut[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingList, setLoadingList] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [village, setVillage] = useState('')
  const [status, setStatus] = useState('')
  const [villages, setVillages] = useState<string[]>([])
  const [householdTotal, setHouseholdTotal] = useState<number | null>(null)

  // ── 详情 ──
  const [selectedId, setSelectedId] = useState<number | null>(
    searchParams.get('farmerId') ? Number(searchParams.get('farmerId')) : null
  )
  const [farmer, setFarmer] = useState<FarmerDetail | null>(null)
  const [household, setHousehold] = useState<HHDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [tab, setTab] = useState<Tab>('subsidy')

  useEffect(() => {
    api.getVillageGroups().then((gs: VillageGroup[]) => setVillages([...new Set(gs.map(g => g.village_name))])).catch(() => {})
    api.getHouseholds({ page: 1, pageSize: 1 }).then(r => setHouseholdTotal(r.total)).catch(() => {})
  }, [])

  const loadList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await api.getFarmers({
        page, pageSize: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(village ? { village_name: village } : {}),
        ...(status ? { status: Number(status) } : {}),
      })
      setList(res.items || [])
      setTotal(res.total || 0)
      setSelectedId(prev => {
        if (prev && (res.items || []).some(f => f.id === prev)) return prev
        return res.items?.[0]?.id ?? null
      })
    } catch {
      setList([]); setTotal(0)
    } finally {
      setLoadingList(false)
    }
  }, [page, search, village, status])

  useEffect(() => { loadList() }, [loadList])

  // 选中人员 → 详情 + 所属家庭户
  useEffect(() => {
    if (selectedId == null) { setFarmer(null); setHousehold(null); return }
    let cancelled = false
    setLoadingDetail(true)
    api.getFarmer(selectedId)
      .then(async f => {
        if (cancelled) return
        setFarmer(f)
        if (f.household_id) {
          try {
            const hh = await api.getHouseholdDetail(f.household_id)
            if (!cancelled) setHousehold(hh)
          } catch { if (!cancelled) setHousehold(null) }
        } else setHousehold(null)
      })
      .catch(() => { if (!cancelled) setFarmer(null) })
      .finally(() => { if (!cancelled) setLoadingDetail(false) })
    return () => { cancelled = true }
  }, [selectedId])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ── 派生 ──
  const apps = farmer?.applications || []
  const appTotal = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
  const usage = household?.area_usage
  const refArea = (usage?.cultivable_area ?? usage?.contracted_area ?? 0) || 0
  const usedArea = usage?.used_area ?? 0
  const overAmount = Math.max(0, usedArea - refArea)
  const isOver = overAmount > 0.001
  const members = household?.members || []
  const overYears = useMemo(() => {
    const yt = usage?.year_totals
    if (!yt || !refArea) return [] as string[]
    return Object.entries(yt)
      .filter(([, seasons]) => Object.values(seasons).some(v => v > refArea + 0.001))
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([y]) => y)
  }, [usage, refArea])

  const age = (() => {
    const b = farmer?.birth_date
    if (!b) return null
    const y = Number(b.slice(0, 4))
    if (!y) return null
    return new Date().getFullYear() - y
  })()

  const tabs: { id: Tab; label: string; count?: number; danger?: boolean }[] = [
    { id: 'subsidy', label: '补贴记录', count: apps.length },
    { id: 'members', label: '家庭成员', count: members.length },
    { id: 'anomaly', label: '异常', count: overYears.length, danger: overYears.length > 0 },
    { id: 'history', label: '变更历史' },
  ]

  return (
    <div className="space-y-3">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-primary leading-tight">户籍管理</h1>
          <div className="text-[11px] text-[#8C877A] mt-1">左侧选择人员或家庭户，右侧查看档案与关联信息</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate('/settings/farmer-attribute-import')}
            className="h-[30px] px-3 border border-border rounded-btn bg-white text-[12px] text-[#5A5A4F] hover:bg-warm/30 transition-colors">
            导入户籍
          </button>
          <button disabled
            className="h-[30px] px-3 rounded-btn bg-primary text-[#F7F3E7] text-[12px] opacity-70 cursor-default">新增农户</button>
        </div>
      </div>

      <div className="grid grid-cols-[338px_minmax(0,1fr)] gap-3 items-start">
        {/* ── 左列：数据列表 ── */}
        <div className="bg-white border border-border rounded-card flex flex-col overflow-hidden shadow-card sticky top-[88px]"
          style={{ maxHeight: 'calc(100vh - 104px)' }}>
          {/* 农户 / 家庭户 */}
          <div className="flex items-center gap-3.5 px-3 h-[34px] border-b border-border">
            <button className="h-[34px] flex items-center gap-1 border-b-2 border-primary text-primary text-[12px] font-bold">
              农户 <span className="text-[10px] text-[#8C877A] font-normal">{total}</span>
            </button>
            <button onClick={() => navigate('/v2/households')}
              className="h-[34px] flex items-center gap-1 border-b-2 border-transparent text-[#6B6B60] text-[12px] hover:text-text-primary">
              家庭户 <span className="text-[10px] text-[#9A9588]">{householdTotal ?? '—'}</span>
            </button>
          </div>

          {/* 搜索与筛选 */}
          <div className="px-2.5 py-2 border-b border-[#F2EDE3] flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 border border-border rounded-btn px-2 h-[30px]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9A9588" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput.trim()); setPage(1) } }}
                placeholder="姓名 / 身份证 / 手机号"
                className="flex-1 text-[12px] outline-none bg-transparent" />
            </div>
            <div className="flex gap-1.5">
              <select value={village} onChange={e => { setVillage(e.target.value); setPage(1) }}
                className="flex-1 h-7 border border-border rounded-btn px-1.5 text-[11px] text-[#5A5A4F] bg-white outline-none">
                <option value="">全部村</option>
                {villages.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
                className="flex-1 h-7 border border-border rounded-btn px-1.5 text-[11px] text-[#5A5A4F] bg-white outline-none">
                <option value="">全部状态</option>
                <option value="1">在册</option>
                <option value="2">注销</option>
                <option value="3">迁出</option>
                <option value="4">死亡</option>
              </select>
            </div>
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto">
            {loadingList && <div className="py-10 text-center text-[11px] text-text-muted/60">加载中…</div>}
            {!loadingList && list.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无数据</div>}
            {!loadingList && list.map(f => {
              const active = selectedId === f.id
              return (
                <div key={f.id} onClick={() => setSelectedId(f.id)}
                  className={`cursor-pointer border-b border-[#F2EDE3] transition-colors py-[9px] ${
                    active ? 'bg-[#F3F7F4] border-l-[3px] border-l-primary pl-3 pr-2.5' : 'pl-[15px] pr-2.5 hover:bg-[#F7FAF8]'
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${tone(f.real_name)}`}>
                        {f.real_name?.slice(-1) || '—'}
                      </span>
                      <b className="text-[12px] text-text-primary truncate">{f.real_name}</b>
                      <span className={`text-[9px] rounded-[2px] px-1 shrink-0 ${f.is_head === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                        {f.is_head === 1 ? '户主' : (f.relation || '成员')}
                      </span>
                    </div>
                    <span className={`text-[9px] rounded-[2px] px-1 shrink-0 ${
                      f.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]'
                        : f.farmer_status === 3 ? 'bg-[#F6EEDC] text-[#8A6620]'
                          : 'bg-[#F1EDE4] text-[#6B6B60]'
                    }`}>
                      {FARMER_STATUS_LABEL[f.farmer_status] || '未知'}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#8C877A] mt-[3px] pl-[31px] truncate">
                    {f.village_full_name || '—'}
                    {f.contract_area && <><span className="mx-1">·</span>{f.contract_area} 亩</>}
                    <span className="mx-1">·</span>
                    <span className="font-mono">{f.id_card_masked}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-border text-[10px] text-[#8C877A]">
            <span>共 {total} 人</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="h-[22px] px-1.5 border border-border rounded-[3px] bg-white disabled:opacity-40">上一页</button>
              <span className="bg-primary text-[#F7F3E7] rounded-[3px] px-1.5">{page}</span>
              <span>/ {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="h-[22px] px-1.5 border border-border rounded-[3px] bg-white disabled:opacity-40">下一页</button>
            </div>
          </div>
        </div>

        {/* ── 右列：详情 ── */}
        <div className="bg-white border border-border rounded-card flex flex-col overflow-hidden shadow-card min-w-0">
          {!farmer ? (
            <div className="py-24 text-center text-[11.5px] text-text-muted/60">
              {loadingDetail ? '加载中…' : '请从左侧选择一名农户'}
            </div>
          ) : (
            <>
              {/* 档案头 */}
              <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#F2EDE3]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
                    {farmer.real_name?.slice(-1)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{farmer.real_name}</h2>
                      <span className={`text-[10px] rounded-full px-1.5 py-[1px] ${farmer.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                        {FARMER_STATUS_LABEL[farmer.farmer_status] || '未知'}
                      </span>
                      <span className={`text-[10px] rounded-[3px] px-1.5 py-[1px] ${farmer.is_head === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                        {farmer.is_head === 1 ? '户主' : (farmer.relation || '成员')}
                      </span>
                      {overYears.length > 0 && (
                        <span className="text-[10px] bg-[#FDECEA] text-danger rounded-full px-1.5 py-[1px]">超领 {overYears.length} 项</span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
                      {farmer.village_full_name}
                      <span className="mx-1.5">·</span>
                      {farmer.gender === 1 ? '男' : '女'}{age ? ` · ${age} 岁` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button disabled className="h-7 px-2.5 border border-border rounded-btn bg-white text-[11px] text-[#5A5A4F] opacity-70 cursor-default">编辑</button>
                  <button onClick={() => navigate('/settings/farmer-attribute-import')}
                    className="h-7 px-2.5 border border-[#E6C288] rounded-btn bg-[#E6C288] text-[11px] text-[#5A4215]">属性导入</button>
                </div>
              </div>

              {/* 家庭户面积条 */}
              <div className="flex items-center px-4 py-2.5 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7]">
                <div className="flex items-center gap-2 min-w-0 w-[210px]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D8B567" strokeWidth="1.6" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 11v9h14v-9" /><path d="M9 20v-5h6v5" /></svg>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold truncate">{household?.household_name || '未关联家庭户'}</div>
                    <div className="text-[9.5px] text-white/55 truncate">
                      {household ? `${household.household_code} · ${members.length} 名成员` : '—'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center ml-auto">
                  <div className="px-4 border-l border-white/15">
                    <div className="text-[9.5px] text-white/55">参考面积</div>
                    <div className="text-[16px] font-bold text-[#E6C288] font-mono">{refArea.toFixed(2)} 亩</div>
                  </div>
                  <div className="px-4 border-l border-white/15">
                    <div className="text-[9.5px] text-white/55">已使用</div>
                    <div className="text-[16px] font-bold font-mono">{usedArea.toFixed(2)} 亩</div>
                  </div>
                  <div className="px-4 border-l border-white/15">
                    <div className="text-[9.5px] text-white/55">超出</div>
                    <div className={`text-[16px] font-bold font-mono ${isOver ? 'text-[#F2B8A8]' : ''}`}>
                      {isOver ? `+${overAmount.toFixed(2)} 亩` : '—'}
                    </div>
                  </div>
                  <button onClick={() => navigate(`/v2/households?householdId=${household?.id ?? ''}`)}
                    className="ml-3.5 h-7 px-2.5 border border-white/25 rounded-btn text-[10.5px] text-[#F7F3E7] hover:bg-white/10 transition-colors">
                    查看家庭户
                  </button>
                </div>
              </div>

              {/* 四列基础信息 */}
              <div className="grid grid-cols-4 border-b border-[#F2EDE3]">
                {[
                  ['身份证号', farmer.id_card || farmer.id_card_masked || '—'],
                  ['手机号', farmer.phone || farmer.phone_masked || '—'],
                  ['出生日期 / 年龄', farmer.birth_date ? `${farmer.birth_date.slice(0, 10)}${age ? ` · ${age} 岁` : ''}` : '—'],
                  ['银行卡', farmer.bank_card || farmer.bank_card_masked || '—'],
                ].map(([k, v], i) => (
                  <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
                    <div className="text-[9.5px] text-[#9A9588]">{k}</div>
                    <div className="text-[11.5px] text-[#5A5A4F] mt-px font-mono truncate">{v}</div>
                  </div>
                ))}
              </div>

              {/* 分类 */}
              <div className="flex items-end gap-4 px-4 h-8 border-b border-border">
                {tabs.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`h-8 flex items-center gap-1 border-b-2 text-[12px] transition-colors ${
                      tab === t.id ? 'border-primary text-primary font-bold' : 'border-transparent text-[#6B6B60] hover:text-text-primary'
                    }`}>
                    {t.label}
                    {t.count != null && (
                      <span className={`text-[10px] font-normal ${t.danger ? 'text-danger' : 'text-[#8C877A]'}`}>{t.count}</span>
                    )}
                  </button>
                ))}
                <span className="ml-auto h-8 flex items-center text-[10.5px] text-[#8C877A]">累计发放 {money(appTotal)}</span>
              </div>

              {/* 主体两栏 */}
              <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 p-3">
                {/* 左：分类内容 */}
                <div className="flex flex-col gap-2.5 min-w-0">
                  {tab === 'subsidy' && (
                    <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                            <th className="font-medium px-2.5">年度</th>
                            <th className="font-medium px-1.5">补贴项目</th>
                            <th className="font-medium px-1.5 text-right">面积</th>
                            <th className="font-medium px-1.5 text-right">金额</th>
                            <th className="font-medium px-1.5">状态</th>
                            <th className="font-medium px-2.5">发放日期</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apps.map((a, i) => (
                            <tr key={a.id ?? i} className="border-t border-[#F2EDE3] h-[34px] hover:bg-[#F7FAF8] transition-colors">
                              <td className="px-2.5 font-semibold text-[#1A4D3A]">{a.apply_year}</td>
                              <td className="px-1.5 truncate">{a.subsidy_name}</td>
                              <td className="px-1.5 text-right font-mono">{a.apply_area != null ? Number(a.apply_area).toFixed(2) : '—'}</td>
                              <td className="px-1.5 text-right font-mono">{a.actual_amount ? money(a.actual_amount) : (a.apply_amount ? money(a.apply_amount) : '—')}</td>
                              <td className="px-1.5">
                                <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${a.pay_status === 2 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F6EEDC] text-[#8A6620]'}`}>
                                  {PAY_STATUS_LABEL[a.pay_status] || '—'}
                                </span>
                              </td>
                              <td className="px-2.5 text-[#8C877A]">{a.pay_date || '—'}</td>
                            </tr>
                          ))}
                          {apps.length === 0 && (
                            <tr><td colSpan={6} className="py-8 text-center text-[11px] text-text-muted/60">暂无补贴记录</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {tab === 'members' && (
                    <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
                      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
                        <span className="text-[11.5px] font-semibold">家庭成员</span>
                        <button onClick={() => navigate(`/v2/households?householdId=${household?.id ?? ''}`)}
                          className="text-[10px] text-[#8C877A] hover:text-primary">家庭户详情 →</button>
                      </div>
                      <table className="w-full border-collapse text-[11px]">
                        <tbody>
                          {members.map(m => (
                            <tr key={m.id} className="border-t border-[#F2EDE3] h-[30px]">
                              <td className="px-2.5 font-semibold">{m.real_name}{m.is_head === 1 && <span className="ml-1 text-[9px] bg-[#EDF3EF] text-[#2C6B52] rounded-[2px] px-1">户主</span>}</td>
                              <td className="px-1.5 text-[#6B6B60]">{m.relation || (m.is_head === 1 ? '本人' : '成员')}</td>
                              <td className="px-1.5">
                                <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${m.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                                  {FARMER_STATUS_LABEL[m.farmer_status] || '—'}
                                </span>
                              </td>
                              <td className="px-1.5 font-mono text-[#8C877A]">{m.id_card_masked || '—'}</td>
                            </tr>
                          ))}
                          {members.length === 0 && (
                            <tr><td colSpan={4} className="py-8 text-center text-[11px] text-text-muted/60">暂无成员</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {tab === 'anomaly' && (
                    <div className="border border-[#F0EBE1] rounded-card p-3">
                      {overYears.length === 0 ? (
                        <div className="py-6 text-center text-[11px] text-text-muted/60">本户没有超领记录</div>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {overYears.map(y => {
                            const yearMax = usage?.year_totals?.[y] ? Math.max(...Object.values(usage.year_totals[y])) : 0
                            return (
                              <div key={y} className="flex items-center gap-2">
                                <span className="text-[9px] bg-[#FDECEA] text-danger rounded-[2px] px-1">超领</span>
                                <span className="text-[11.5px] font-semibold">{y} 年度</span>
                                <span className="text-[10px] text-[#9A9588]">{yearMax.toFixed(2)} / {refArea.toFixed(2)} 亩</span>
                                <span className="ml-auto text-[11px] font-bold text-danger">+{Math.max(0, yearMax - refArea).toFixed(2)}</span>
                              </div>
                            )
                          })}
                          <button onClick={() => navigate('/anomalies')} className="mt-1 h-7 border border-border rounded-btn text-[11px] text-[#5A5A4F]">进入异常中心</button>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === 'history' && (
                    <div className="border border-[#F0EBE1] rounded-card p-3">
                      <div className="text-[11px] text-text-muted">变更历史暂未接入，后续在此展示户与人员的状态变更记录。</div>
                    </div>
                  )}
                </div>

                {/* 右：家庭户信息 / 异常 / 变更 */}
                <div className="flex flex-col gap-2.5 min-w-0">
                  <div className="border border-[#F0EBE1] rounded-card px-3 py-2">
                    <div className="text-[11.5px] font-semibold mb-1.5">家庭户信息</div>
                    <div className="flex flex-col gap-1 text-[10.5px]">
                      {[
                        ['户名', household?.household_name || '—'],
                        ['户编码', household?.household_code || '—'],
                        ['村组', household?.village_full_name || farmer.village_full_name || '—'],
                        ['成员', household ? `${members.length} 人 · 在册 ${members.filter(m => m.farmer_status === 1).length}` : '—'],
                        ['参考面积', household ? `${refArea.toFixed(2)} 亩` : '—'],
                        ['人工确认', household?.manually_confirmed_at ? household.manually_confirmed_at.slice(0, 10) : '未确认'],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <span className="text-[#8C877A] shrink-0">{k}</span>
                          <span className="truncate">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {overYears.length > 0 && (
                    <div className="border border-[#E8C9C2] bg-[#FDF7F5] rounded-card px-3 py-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11.5px] font-bold text-[#A6402E]">本户异常</span>
                        <button onClick={() => setTab('anomaly')} className="text-[10px] text-[#A6402E]">核对 →</button>
                      </div>
                      <div className="text-[10.5px] text-[#6B4236] leading-relaxed">
                        {overYears.slice(0, 3).map(y => {
                          const yearMax = usage?.year_totals?.[y] ? Math.max(...Object.values(usage.year_totals[y])) : 0
                          return <div key={y}>{y} 年度 超领 <b>{Math.max(0, yearMax - refArea).toFixed(2)} 亩</b></div>
                        })}
                      </div>
                    </div>
                  )}

                  <div className="border border-[#F0EBE1] rounded-card px-3 py-2 flex-1">
                    <div className="text-[11.5px] font-semibold mb-1">人员档案</div>
                    <div className="flex flex-col gap-1 text-[10.5px]">
                      <div className="flex justify-between"><span className="text-[#8C877A]">性别</span><span>{farmer.gender === 1 ? '男' : '女'}</span></div>
                      <div className="flex justify-between"><span className="text-[#8C877A]">开户行</span><span className="truncate">{farmer.bank_name || '—'}</span></div>
                      <div className="flex justify-between"><span className="text-[#8C877A]">地址</span><span className="truncate">{farmer.address || '—'}</span></div>
                      <div className="flex justify-between"><span className="text-[#8C877A]">录入时间</span><span>{farmer.created_at?.slice(0, 10) || '—'}</span></div>
                      {farmer.remark && <div className="text-[10px] text-text-muted pt-1 border-t border-[#F2EDE3]">{farmer.remark}</div>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
