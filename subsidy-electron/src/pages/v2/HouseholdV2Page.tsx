/**
 * 新版界面 - 家庭户（画布 Household 页）
 *
 * 结构完全对齐设计稿：左侧固定 338px 家庭户列表（搜索/村组/状态 + 分页），
 * 右侧是选中家庭户详情：户档案头、深绿面积与发放条、四列面积构成、
 * 家庭成员/补贴记录分类切换、各季面积进度、流转记录、最近变更。
 *
 * 这一版只接只读数据，编辑/分户/合户等操作后续再补。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api'
import type { HH, HHDetail } from '../../types'

const CURRENT_YEAR = new Date().getFullYear()
const PAGE_SIZE = 20

const STATUS_LABEL: Record<number, string> = { 1: '在册', 2: '注销', 3: '迁出' }
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

const money = (v: number | null | undefined) =>
  `¥${Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function HouseholdV2Page() {
  const navigate = useNavigate()

  // ── 列表 ──
  const [list, setList] = useState<HH[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingList, setLoadingList] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [village, setVillage] = useState('')
  const [status, setStatus] = useState('')
  const [villages, setVillages] = useState<string[]>([])

  // ── 详情 ──
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<HHDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailTab, setDetailTab] = useState<'members' | 'subsidy'>('members')
  const [areaYear, setAreaYear] = useState(0)

  useEffect(() => {
    api.getVillageGroups().then(gs => setVillages([...new Set(gs.map(g => g.village_name))])).catch(() => {})
  }, [])

  const loadList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await api.getHouseholds({
        page, pageSize: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(village ? { village_name: village } : {}),
        ...(status ? { status: Number(status) } : {}),
      })
      setList(res.items || [])
      setTotal(res.total || 0)
      setSelectedId(prev => {
        if (prev && (res.items || []).some(h => h.id === prev)) return prev
        return res.items?.[0]?.id ?? null
      })
    } catch {
      setList([])
      setTotal(0)
    } finally {
      setLoadingList(false)
    }
  }, [page, search, village, status])

  useEffect(() => { loadList() }, [loadList])

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return }
    let cancelled = false
    setLoadingDetail(true)
    api.getHouseholdDetail(selectedId)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(() => { if (!cancelled) setDetail(null) })
      .finally(() => { if (!cancelled) setLoadingDetail(false) })
    return () => { cancelled = true }
  }, [selectedId])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ── 派生数据 ──
  const usage = detail?.area_usage
  const refArea = (usage?.cultivable_area ?? usage?.contracted_area ?? 0) || 0
  const usedArea = areaYear > 0 && usage?.year_totals?.[String(areaYear)]
    ? Math.max(...Object.values(usage.year_totals[String(areaYear)]).filter(v => v > 0), 0)
    : (usage?.used_area ?? 0)
  const remaining = Math.max(0, refArea - usedArea)
  const overAmount = Math.max(0, usedArea - refArea)
  const isOver = overAmount > 0.001

  const members = detail?.members || []
  const activeMembers = members.filter(m => m.farmer_status === 1).length
  const apps = detail?.app_summary || []
  const areaYears = useMemo(
    () => [...new Set(apps.map(a => a.apply_year))].sort((a, b) => b - a),
    [apps]
  )
  const appTotal = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)

  const overYears = useMemo(() => {
    const yt = usage?.year_totals
    if (!yt || !refArea) return [] as string[]
    return Object.entries(yt)
      .filter(([, seasons]) => Object.values(seasons).some(v => v > refArea + 0.001))
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([y]) => y)
  }, [usage, refArea])

  return (
    <div className="space-y-3">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-primary leading-tight">家庭户</h1>
          <div className="text-meta text-text-muted mt-1">左侧选择家庭户，右侧查看成员、补贴与面积使用情况</div>
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-text-muted">
          <span>共 <b className="text-text-primary font-mono">{total}</b> 户</span>
          <span className="w-px h-3 bg-border" />
          <span>{CURRENT_YEAR} 年度口径</span>
        </div>
      </div>

      <div className="grid grid-cols-[338px_minmax(0,1fr)] gap-3 items-start">
        {/* ── 左列：家庭户列表 ── */}
        <div className="bg-white border border-border rounded-card overflow-hidden shadow-card sticky top-[88px]" style={{ maxHeight: 'calc(100vh - 104px)' }}>
          <div className="flex flex-col">
            <div className="px-2.5 py-2 border-b border-[#F2EDE3] flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 border border-border rounded-btn px-2 h-7 bg-white">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9A9588" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput.trim()); setPage(1) } }}
                  placeholder="户名 / 户编码 / 户主"
                  className="flex-1 text-[11px] outline-none bg-transparent" />
              </div>
              <div className="flex gap-1.5">
                <select value={village} onChange={e => { setVillage(e.target.value); setPage(1) }}
                  className="flex-1 h-6 border border-border rounded-btn px-1.5 text-[10.5px] bg-white outline-none">
                  <option value="">全部村</option>
                  {villages.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
                  className="flex-1 h-6 border border-border rounded-btn px-1.5 text-[10.5px] bg-white outline-none">
                  <option value="">全部状态</option>
                  <option value="1">在册</option>
                  <option value="2">注销</option>
                  <option value="3">迁出</option>
                </select>
              </div>
            </div>

            <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
              {loadingList && <div className="py-10 text-center text-[11px] text-text-muted/60">加载中…</div>}
              {!loadingList && list.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无数据</div>}
              {!loadingList && list.map(h => {
                const active = selectedId === h.id
                return (
                  <div key={h.id} onClick={() => setSelectedId(h.id)}
                    className={`cursor-pointer border-b border-[#F2EDE3] transition-colors py-[9px] ${
                      active ? 'bg-[#F3F7F4] border-l-[3px] border-l-primary pl-[13px] pr-2.5' : 'pl-4 pr-2.5 hover:bg-[#F7FAF8]'
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-6 h-6 rounded-card flex items-center justify-center text-[10px] font-bold shrink-0 ${tone(h.household_name)}`}>
                          {h.household_name?.slice(0, 1) || '户'}
                        </span>
                        <b className="text-[12.5px] text-text-primary truncate">{h.household_name}</b>
                        <span className={`text-[9px] rounded-[2px] px-1 shrink-0 ${h.status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F6EEDC] text-[#8A6620]'}`}>
                          {STATUS_LABEL[h.status] || '未知'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {(h.overdrawn_years?.length ?? 0) > 0
                          ? h.overdrawn_years!.slice(0, 2).map(y => (
                              <span key={y} className="text-[9px] bg-[#FDECEA] text-danger rounded-[2px] px-1">{y}超领</span>
                            ))
                          : h.is_overdrawn && <span className="text-[9px] bg-[#FDECEA] text-danger rounded-[2px] px-1">超领</span>}
                      </div>
                    </div>
                    <div className="text-[10px] text-[#8C877A] mt-[3px] pl-[32px] truncate">
                      {h.village_full_name || '—'}
                      <span className="mx-1">·</span>
                      <span className="font-mono">{h.household_code}</span>
                      <span className="mx-1">·</span>
                      {h.member_count ?? '?'} 人
                      {h.contracted_area > 0 && <><span className="mx-1">·</span>{h.contracted_area} 亩</>}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-border text-[10px] text-[#8C877A]">
              <span>共 {total} 户</span>
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
        </div>

        {/* ── 右列：家庭户详情 ── */}
        <div className="bg-white border border-border rounded-card overflow-hidden shadow-card min-w-0">
          {!detail ? (
            <div className="py-24 text-center text-[11.5px] text-text-muted/60">
              {loadingDetail ? '加载中…' : '请从左侧选择一个家庭户'}
            </div>
          ) : (
            <>
              {/* 户档案头 */}
              <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#F2EDE3]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
                    {detail.household_name?.slice(0, 1) || '户'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{detail.household_name}</h2>
                      <span className="text-[10px] border border-border rounded-[3px] px-1.5 py-[1px] text-[#8C877A] font-mono">{detail.household_code}</span>
                      <span className="text-[10px] bg-[#EDF3EF] text-[#2C6B52] rounded-full px-1.5 py-[1px]">{STATUS_LABEL[detail.status] || '在册'}</span>
                      {overYears.length > 0 && (
                        <span className="text-[10px] bg-[#FDECEA] text-danger rounded-full px-1.5 py-[1px]">超领 {overYears.length} 项</span>
                      )}
                      {detail.is_manually_confirmed === 1 && (
                        <span className="text-[10px] bg-[#EDF3EF] text-[#2C6B52] rounded-[3px] px-1.5 py-[1px]">已确认</span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
                      {detail.village_full_name}
                      {detail.address ? ` · ${detail.address}` : ''}
                      <span className="mx-1.5">·</span>
                      {members.length} 名成员 · 在册 {activeMembers}
                      {detail.manually_confirmed_at && <><span className="mx-1.5">·</span>人工确认 {detail.manually_confirmed_at.slice(0, 10)}</>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => navigate('/v2/households')} disabled
                    className="h-7 px-2.5 border border-border rounded-btn bg-white text-[11px] text-text-muted opacity-70 cursor-default">分户</button>
                  <button onClick={() => navigate('/v2/households')} disabled
                    className="h-7 px-2.5 border border-border rounded-btn bg-white text-[11px] text-text-muted opacity-70 cursor-default">合户</button>
                  <span className="h-7 px-2.5 border border-[#E8D8B8] rounded-btn bg-[#FDFAF3] text-[11px] text-[#8A6620] flex items-center">只读预览</span>
                </div>
              </div>

              {/* 面积与发放条 */}
              <div className="flex items-center px-4 py-2.5 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7]">
                <div className="flex items-center gap-2 min-w-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D8B567" strokeWidth="1.6" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 11v9h14v-9" /><path d="M9 20v-5h6v5" /></svg>
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-semibold truncate">面积与发放</div>
                    <div className="text-[9.5px] text-white/55">{areaYear > 0 ? `${areaYear} 年度` : '全部年度'} · 按季节取最大</div>
                  </div>
                </div>
                <div className="flex items-center ml-auto">
                  <div className="px-4 border-l border-white/15">
                    <div className="text-[9.5px] text-white/55">参考面积</div>
                    <div className="text-[15px] font-bold text-[#E6C288] font-mono">{refArea.toFixed(2)} 亩</div>
                  </div>
                  <div className="px-4 border-l border-white/15">
                    <div className="text-[9.5px] text-white/55">已使用</div>
                    <div className="text-[15px] font-bold font-mono">{usedArea.toFixed(2)} 亩</div>
                  </div>
                  <div className="px-4 border-l border-white/15">
                    <div className="text-[9.5px] text-white/55">剩余</div>
                    <div className="text-[15px] font-bold font-mono">{remaining.toFixed(2)} 亩</div>
                  </div>
                  <div className="px-4 border-l border-white/15">
                    <div className="text-[9.5px] text-white/55">超出</div>
                    <div className={`text-[15px] font-bold font-mono ${isOver ? 'text-[#F2B8A8]' : ''}`}>
                      {isOver ? `+${overAmount.toFixed(2)} 亩` : '—'}
                    </div>
                  </div>
                  <div className="px-4 border-l border-white/15">
                    <div className="text-[9.5px] text-white/55">累计发放</div>
                    <div className="text-[15px] font-bold font-mono">{money(appTotal)}</div>
                  </div>
                </div>
              </div>

              {/* 四列面积构成 */}
              <div className="grid grid-cols-4 border-b border-[#F2EDE3]">
                {[
                  ['承包面积', `${Number(usage?.contracted_area ?? 0).toFixed(2)} 亩`],
                  ['确权面积', detail.confirmed_area != null ? `${detail.confirmed_area} 亩` : '—'],
                  ['转入 / 转出', `${Number(usage?.trust_in_area ?? 0).toFixed(2)} / ${Number(usage?.trust_out_area ?? 0).toFixed(2)}`],
                  ['可耕种', usage?.cultivable_area != null ? `${Number(usage.cultivable_area).toFixed(2)} 亩` : '—'],
                ].map(([k, v], i) => (
                  <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
                    <div className="text-[9.5px] text-[#9A9588]">{k}</div>
                    <div className="text-[11.5px] text-[#5A5A4F] mt-px font-mono">{v}</div>
                  </div>
                ))}
              </div>

              {/* 主体两栏 */}
              <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 p-3">
                {/* 左：分类 + 内容 */}
                <div className="border border-[#F0EBE1] rounded-card overflow-hidden flex flex-col min-w-0">
                  <div className="flex items-center gap-0 px-3 border-b border-[#F2EDE3]">
                    {([
                      { id: 'members' as const, label: '家庭成员', count: members.length },
                      { id: 'subsidy' as const, label: '补贴记录', count: apps.length },
                    ]).map(t => (
                      <button key={t.id} onClick={() => setDetailTab(t.id)}
                        className={`h-8 px-2.5 text-[11.5px] border-b-2 transition-colors ${
                          detailTab === t.id ? 'border-primary text-primary font-semibold' : 'border-transparent text-text-muted hover:text-text-primary'
                        }`}>
                        {t.label} <span className="text-[9.5px] text-text-muted font-normal">{t.count}</span>
                      </button>
                    ))}
                  </div>

                  {detailTab === 'members' && (
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left">
                          <th className="font-medium px-3 py-1.5">姓名</th>
                          <th className="font-medium px-1.5 py-1.5">关系</th>
                          <th className="font-medium px-1.5 py-1.5">身份证号</th>
                          <th className="font-medium px-1.5 py-1.5">状态</th>
                          <th className="font-medium px-3 py-1.5 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map(m => (
                          <tr key={m.id} className={`border-t border-[#F2EDE3] hover:bg-[#F7FAF8] transition-colors ${m.farmer_status !== 1 ? 'opacity-65' : ''}`}>
                            <td className="px-3 py-1.5">
                              <b>{m.real_name}</b>
                              {m.is_head === 1 && <span className="ml-1 text-[9px] bg-[#EDF3EF] text-[#2C6B52] rounded-[2px] px-1">户主</span>}
                            </td>
                            <td className="px-1.5 py-1.5 text-[#6B6B60]">{m.relation || (m.is_head === 1 ? '本人' : '成员')}</td>
                            <td className="px-1.5 py-1.5 font-mono text-[#8C877A]">{m.id_card_masked || '—'}</td>
                            <td className="px-1.5 py-1.5">
                              <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${m.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                                {FARMER_STATUS_LABEL[m.farmer_status] || '—'}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right text-[10px] text-[#8C877A]">—</td>
                          </tr>
                        ))}
                        {members.length === 0 && (
                          <tr><td colSpan={5} className="py-8 text-center text-[11px] text-text-muted/60">暂无成员</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}

                  {detailTab === 'subsidy' && (
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left">
                          <th className="font-medium px-3 py-1.5">年度</th>
                          <th className="font-medium px-1.5 py-1.5">补贴项目</th>
                          <th className="font-medium px-1.5 py-1.5">成员</th>
                          <th className="font-medium px-1.5 py-1.5 text-right">面积</th>
                          <th className="font-medium px-1.5 py-1.5 text-right">金额</th>
                          <th className="font-medium px-3 py-1.5">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apps.map((a, i) => (
                          <tr key={`${a.farmer_id}-${a.subsidy_name}-${i}`} className="border-t border-[#F2EDE3] hover:bg-[#F7FAF8] transition-colors">
                            <td className="px-3 py-1.5 font-semibold text-primary">{a.apply_year}</td>
                            <td className="px-1.5 py-1.5">{a.subsidy_name}</td>
                            <td className="px-1.5 py-1.5 text-[#6B6B60]">{a.farmer_name}</td>
                            <td className="px-1.5 py-1.5 font-mono text-right">{a.apply_area != null ? Number(a.apply_area).toFixed(2) : '—'}</td>
                            <td className="px-1.5 py-1.5 font-mono text-right font-semibold">{a.actual_amount ? money(a.actual_amount) : '待发放'}</td>
                            <td className="px-3 py-1.5">
                              <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${a.pay_status === 2 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F6EEDC] text-[#8A6620]'}`}>
                                {PAY_STATUS_LABEL[a.pay_status] || '—'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {apps.length === 0 && (
                          <tr><td colSpan={6} className="py-8 text-center text-[11px] text-text-muted/60">暂无补贴记录</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 右：面积使用 / 流转 / 异常提示 */}
                <div className="flex flex-col gap-2.5 min-w-0">
                  <div className="border border-[#F0EBE1] rounded-card px-3 py-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11.5px] font-semibold">各季面积使用</span>
                      {areaYears.length > 0 && (
                        <select value={areaYear || areaYears[0]} onChange={e => setAreaYear(Number(e.target.value))}
                          className="h-6 border border-border rounded-btn px-1.5 text-[10px] bg-white outline-none">
                          {areaYears.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {Object.entries(usage?.season_breakdown || {}).map(([season, s]) => {
                        const used = areaYear > 0
                          ? (usage?.year_totals?.[String(areaYear)]?.[season] || 0)
                          : (s.used_area || 0)
                        const seasonRef = s.reference_area ?? refArea
                        const pct = seasonRef > 0 ? Math.min(100, Math.round(used / seasonRef * 100)) : 0
                        const over = used > seasonRef + 0.001
                        return (
                          <div key={season}>
                            <div className="flex items-baseline justify-between text-[10.5px]">
                              <span className={over ? 'text-danger font-semibold' : 'text-primary font-semibold'}>{season}</span>
                              <span className="text-text-muted font-mono">{used.toFixed(2)} / {seasonRef.toFixed(2)}</span>
                            </div>
                            <div className="h-[4px] bg-[#F2EDE3] rounded-full mt-1 overflow-hidden">
                              <div className={`h-[4px] rounded-full ${over ? 'bg-danger' : 'bg-[#1A4D3A]'}`} style={{ width: `${Math.max(2, pct)}%` }} />
                            </div>
                          </div>
                        )
                      })}
                      {Object.keys(usage?.season_breakdown || {}).length === 0 && (
                        <div className="text-[10.5px] text-text-muted/60 py-2 text-center">暂无面积使用记录</div>
                      )}
                    </div>
                  </div>

                  {overYears.length > 0 && (
                    <div className="border border-[#E8C9C2] bg-[#FDF7F5] rounded-card px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11.5px] font-bold text-[#A6402E]">本户异常</span>
                        <button onClick={() => navigate('/anomalies')} className="text-[10px] text-[#A6402E]">核对 →</button>
                      </div>
                      <div className="text-[10.5px] text-[#6B4236] leading-relaxed">
                        {overYears.map(y => (
                          <div key={y}>{y} 年度 超领 <b>{Math.max(0, (usage?.year_totals?.[y] ? Math.max(...Object.values(usage.year_totals[y])) : 0) - refArea).toFixed(2)} 亩</b></div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border border-[#F0EBE1] rounded-card px-3 py-2">
                    <div className="text-[11.5px] font-semibold mb-1">流转情况</div>
                    <div className="flex flex-col gap-1 text-[10.5px]">
                      <div className="flex justify-between"><span className="text-[#8C877A]">转入面积</span><span className="font-mono">{Number(usage?.trust_in_area ?? 0).toFixed(2)} 亩</span></div>
                      <div className="flex justify-between"><span className="text-[#8C877A]">转出面积</span><span className="font-mono">{Number(usage?.trust_out_area ?? 0).toFixed(2)} 亩</span></div>
                      <div className="flex justify-between border-t border-[#F2EDE3] pt-1"><b>可耕种</b><b className="font-mono text-primary">{Number(usage?.cultivable_area ?? 0).toFixed(2)} 亩</b></div>
                    </div>
                  </div>

                  <div className="border border-[#F0EBE1] rounded-card px-3 py-2 flex-1">
                    <div className="text-[11.5px] font-semibold mb-1">户档案</div>
                    <div className="flex flex-col gap-1 text-[10.5px]">
                      <div className="flex justify-between"><span className="text-[#8C877A]">户编码</span><span className="font-mono">{detail.household_code}</span></div>
                      <div className="flex justify-between"><span className="text-[#8C877A]">村组</span><span>{detail.village_full_name}</span></div>
                      <div className="flex justify-between"><span className="text-[#8C877A]">成员</span><span>{members.length} 人 · 在册 {activeMembers}</span></div>
                      <div className="flex justify-between"><span className="text-[#8C877A]">人工确认</span><span className={detail.is_manually_confirmed === 1 ? 'text-[#2C6B52]' : 'text-text-muted'}>{detail.manually_confirmed_at?.slice(0, 10) || '未确认'}</span></div>
                      {detail.remark && <div className="text-[10px] text-text-muted pt-1 border-t border-[#F2EDE3]">{detail.remark}</div>}
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
