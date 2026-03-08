/**
 * 家庭户管理页面（完整版）
 * - 列表：筛选/搜索/面积进度条/超领预警
 * - 详情：成员增删改查、设户主、面积按年份分组、补贴记录筛选分页
 */
import { useState, useEffect, useCallback } from 'react'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { fmt, FARMER_STATUS, PAY_STATUS } from '../utils'

const thisYear = new Date().getFullYear()
const yearOpts = Array.from({ length: 8 }, (_, i) => thisYear - i + 1)

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(()=>({})) as {detail?:string}; throw new Error(e.detail||'请求失败') }
  return r.json() as Promise<T>
}

interface HouseholdItem {
  id:number; household_code:string; household_name:string
  village_full_name:string; village_name:string
  head_name:string; member_count:number; status:number
  address:string|null; contracted_area:number; used_area:number
  remaining_area:number; is_overdrawn:boolean; overdraw_amount:number
}
interface Member {
  id:number; household_id:number; real_name:string; gender:number
  id_card_masked:string; id_card:string; phone_masked:string|null
  bank_card_masked:string|null; bank_name:string|null
  is_head:number; relation:string|null; farmer_status:number; remark:string|null
}
interface HouseholdDetail {
  id:number; household_code:string; household_name:string
  village_full_name:string; address:string|null
  contracted_area:number; status:number; remark:string|null
  members:Member[]
  area_usage:{ contracted_area:number; used_area:number; remaining_area:number; is_overdrawn:boolean; overdraw_amount:number; subsidy_breakdown:{subsidy_name:string;apply_year:number;used_area:number;total_amount:number;app_count:number}[] }
  app_summary:{ apply_year:number; farmer_name:string; subsidy_name:string; calc_mode:string; apply_area:number|null; apply_amount:number|null; actual_amount:number|null; pay_status:number }[]
}
interface YearArea {
  contracted_area:number
  years:{ year:number; total_used:number; remaining_area:number; is_overdrawn:boolean; overdraw_amount:number; contracted_area:number; details:{subsidy_name:string;used_area:number;total_amount:number;app_count:number}[] }[]
}
interface Overdrawn { household_id:number; household_code:string; household_name:string; head_name:string; village:string; contracted_area:number; used_area:number; overdraw_amount:number; year:number; subsidy_breakdown:{subsidy_name:string;apply_year:number;used_area:number}[] }

const SC:{[k:number]:{label:string;color:'green'|'red'|'amber'}} = {1:{label:'在册',color:'green'},2:{label:'注销',color:'red'},3:{label:'迁出',color:'amber'}}

// ════════════════ 列表页 ════════════════
export default function HouseholdsPage() {
  const { toast, show } = useToast()
  const [tab, setTab] = useState<'list'|'overdrawn'>('list')
  const [items, setItems] = useState<HouseholdItem[]>([])
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [year, setYear] = useState(thisYear)
  const [vf, setVf] = useState(''); const [search, setSearch] = useState('')
  const [villages, setVillages] = useState<string[]>([])
  const [detail, setDetail] = useState<HouseholdDetail|null>(null)
  const [overdrawn, setOverdrawn] = useState<Overdrawn[]>([])
  const [odLoading, setOdLoading] = useState(false)

  useEffect(() => { req<{village_name:string}[]>('/api/village-groups').then(g=>setVillages([...new Set(g.map(v=>v.village_name))])) }, [])

  const loadList = useCallback(async()=>{
    setLoading(true)
    try {
      const p = new URLSearchParams({page:String(page),page_size:'20',year:String(year)})
      if(vf) p.set('village_name',vf); if(search) p.set('search',search)
      const res = await req<{total:number;items:HouseholdItem[]}>(`/api/households?${p}`)
      setItems(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }, [page,year,vf,search])

  useEffect(()=>{ if(tab==='list') loadList() },[loadList,tab])

  const loadOD = useCallback(async()=>{
    setOdLoading(true)
    try {
      const p = new URLSearchParams({year:String(year)}); if(vf) p.set('village_name',vf)
      const res = await req<{items:Overdrawn[]}>(`/api/households/alert/overdrawn?${p}`)
      setOverdrawn(res.items)
    } finally { setOdLoading(false) }
  }, [year,vf])

  useEffect(()=>{ if(tab==='overdrawn') loadOD() },[tab,loadOD])

  const openDetail = async(id:number)=>{ const d=await req<HouseholdDetail>(`/api/households/${id}`); setDetail(d) }

  if(detail) return <DetailPage detail={detail} onBack={()=>{setDetail(null);loadList()}} show={show}/>

  const FilterBar = ()=>(
    <div className="flex items-center gap-2 flex-wrap mb-4">
      {[{id:'list',label:'家庭户列表',icon:'🏠'},{id:'overdrawn',label:'超领预警',icon:'⚠️'}].map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id as 'list'|'overdrawn')}
          className={`px-4 py-2 text-sm rounded-lg border transition-colors flex items-center gap-1.5
            ${tab===t.id?(t.id==='overdrawn'?'bg-red-600 text-white border-red-600':'bg-emerald-700 text-white border-emerald-700'):'bg-white border-stone-200 text-stone-600'}`}>
          {t.icon}{t.label}
          {t.id==='overdrawn'&&overdrawn.length>0&&tab!=='overdrawn'&&<span className="bg-red-100 text-red-600 text-xs px-1.5 rounded-full font-mono">{overdrawn.length}</span>}
        </button>
      ))}
      <div className="ml-auto flex gap-2">
        <select value={year} onChange={e=>setYear(Number(e.target.value))} className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm bg-white outline-none">
          {yearOpts.map(y=><option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={vf} onChange={e=>setVf(e.target.value)} className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm bg-white outline-none">
          <option value="">全部村庄</option>{villages.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
      </div>
    </div>
  )

  return (
    <div>
      <FilterBar/>
      {tab==='list'&&(
        <>
          <div className="mb-3"><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="搜索户名或户主姓名…" className="w-80 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 bg-white"/></div>
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full border-collapse">
              <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
                {['户编码','家庭名称','所在位置','户主','成员','承包面积',`${year}年占用`,'剩余','状态','操作'].map(h=>(
                  <th key={h} className="px-3.5 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {loading&&<tr><td colSpan={10} className="text-center py-12 text-stone-300">加载中…</td></tr>}
                {!loading&&items.length===0&&<tr><td colSpan={10} className="text-center py-12 text-stone-300">暂无数据</td></tr>}
                {!loading&&items.map(hh=>(
                  <tr key={hh.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors ${hh.is_overdrawn?'bg-red-50/40':''}`}>
                    <td className="px-3.5 py-2.5 text-xs font-mono text-stone-400">{hh.household_code}</td>
                    <td className="px-3.5 py-2.5 text-sm font-semibold">{hh.household_name}{hh.is_overdrawn&&<span className="text-red-500 ml-1">⚠️</span>}</td>
                    <td className="px-3.5 py-2.5 text-xs text-stone-400">{hh.village_full_name}</td>
                    <td className="px-3.5 py-2.5 text-sm">{hh.head_name}</td>
                    <td className="px-3.5 py-2.5 text-sm text-center">{hh.member_count}</td>
                    <td className="px-3.5 py-2.5 text-sm font-mono">{hh.contracted_area>0?`${hh.contracted_area}亩`:<span className="text-stone-300">未设</span>}</td>
                    <td className="px-3.5 py-2.5 min-w-32"><MiniBar c={hh.contracted_area} u={hh.used_area} od={hh.is_overdrawn}/></td>
                    <td className="px-3.5 py-2.5 text-sm font-mono">{hh.contracted_area>0?<span className={hh.remaining_area<0?'text-red-600 font-bold':'text-emerald-700'}>{hh.remaining_area}亩</span>:'—'}</td>
                    <td className="px-3.5 py-2.5"><Tag label={SC[hh.status as 1]?.label||'—'} color={SC[hh.status as 1]?.color||'gray'}/></td>
                    <td className="px-3.5 py-2.5"><button onClick={()=>openDetail(hh.id)} className="text-xs text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-50">详情</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-stone-100 bg-stone-50/50 flex justify-between text-xs text-stone-400">
              <span>共{total}户</span>
              <div className="flex gap-1">
                <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">‹</button>
                <span className="px-2 py-1">第{page}/{Math.max(1,Math.ceil(total/20))}页</span>
                <button disabled={page*20>=total} onClick={()=>setPage(p=>p+1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">›</button>
              </div>
            </div>
          </div>
        </>
      )}
      {tab==='overdrawn'&&(
        <div>
          {odLoading&&<div className="text-center py-16 text-stone-300">计算中…</div>}
          {!odLoading&&overdrawn.length===0&&<div className="text-center py-16 bg-white border border-stone-200 rounded-xl text-stone-300"><div className="text-5xl mb-3">✅</div><p className="text-sm">{year}年无超领家庭</p></div>}
          {!odLoading&&overdrawn.length>0&&(
            <>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700"><strong>⚠️ {year}年发现{overdrawn.length}户超领</strong> — 正式申请前请核实处理</div>
              <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full border-collapse">
                  <thead><tr className="bg-red-50 border-b-2 border-red-200">
                    {['家庭名称','户主','所在位置','承包面积','已补贴','超领量','涉及补贴项','操作'].map(h=>(
                      <th key={h} className="px-3.5 py-2.5 text-left text-xs text-stone-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {overdrawn.map(hh=>(
                      <tr key={hh.household_id} className="border-b border-red-50 hover:bg-red-50/50">
                        <td className="px-3.5 py-2.5 text-sm font-semibold">{hh.household_name}</td>
                        <td className="px-3.5 py-2.5 text-sm">{hh.head_name}</td>
                        <td className="px-3.5 py-2.5 text-xs text-stone-400">{hh.village}</td>
                        <td className="px-3.5 py-2.5 font-mono text-sm">{hh.contracted_area}亩</td>
                        <td className="px-3.5 py-2.5 font-mono text-sm text-amber-600">{hh.used_area}亩</td>
                        <td className="px-3.5 py-2.5"><Tag label={`超${hh.overdraw_amount}亩`} color="red"/></td>
                        <td className="px-3.5 py-2.5 text-xs text-stone-500">{[...new Set(hh.subsidy_breakdown.map(b=>b.subsidy_name))].join('、')}</td>
                        <td className="px-3.5 py-2.5"><button onClick={()=>openDetail(hh.household_id)} className="text-xs text-red-600 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-50">查看</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      <Toast {...toast}/>
    </div>
  )
}

// ════════════════ 详情页 ════════════════
function DetailPage({ detail:init, onBack, show }:{detail:HouseholdDetail;onBack:()=>void;show:(m:string,t?:'ok'|'err')=>void}) {
  const [detail, setDetail] = useState(init)
  const [members, setMembers] = useState<Member[]>(init.members)
  const [areaByYear, setAreaByYear] = useState<YearArea|null>(null)
  const [dtab, setDtab] = useState<'members'|'area'|'apps'>('members')
  const [appYear, setAppYear] = useState<number|''>('')
  const [appSearch, setAppSearch] = useState('')
  const [appPage, setAppPage] = useState(1)
  const PS = 10

  const [editOpen, setEditOpen] = useState(false)
  const [ef, setEf] = useState({land_area:init.contracted_area,address:init.address??'',remark:init.remark??''})
  const [addOpen, setAddOpen] = useState(false)
  const [mf, setMf] = useState({real_name:'',id_card:'',phone:'',bank_card:'',bank_name:'',relation:'成员',is_head:0,farmer_status:1,remark:''})
  const [editMember, setEditMember] = useState<Member|null>(null)
  const [emf, setEmf] = useState<Partial<Member&{farmer_status:number}>>({})

  const reload = async()=>{ const d=await req<HouseholdDetail>(`/api/households/${detail.id}`); setDetail(d); setMembers(d.members) }
  const loadArea = async()=>{ const d=await req<YearArea>(`/api/households/${detail.id}/area-by-year`); setAreaByYear(d) }

  useEffect(()=>{ if(dtab==='area') loadArea() },[dtab])

  const filtered = detail.app_summary.filter(a=>{
    if(appYear && a.apply_year!==appYear) return false
    if(appSearch && !a.farmer_name.includes(appSearch) && !a.subsidy_name.includes(appSearch)) return false
    return true
  })
  const paged = filtered.slice((appPage-1)*PS, appPage*PS)

  const submitEdit = async()=>{ await req(`/api/households/${detail.id}`,{method:'PUT',body:JSON.stringify(ef)}); show('✓ 更新成功'); setEditOpen(false); reload() }

  const submitAdd = async()=>{
    if(!mf.real_name||!mf.id_card) return show('姓名和身份证号必填','err')
    try { await req(`/api/households/${detail.id}/members`,{method:'POST',body:JSON.stringify(mf)}); show('✓ 已添加'); setAddOpen(false); setMf({real_name:'',id_card:'',phone:'',bank_card:'',bank_name:'',relation:'成员',is_head:0,farmer_status:1,remark:''}); reload() }
    catch(e:unknown){ show((e as Error).message,'err') }
  }

  const submitEditMember = async()=>{
    if(!editMember) return
    try { await req(`/api/households/${detail.id}/members/${editMember.id}`,{method:'PUT',body:JSON.stringify(emf)}); show('✓ 更新成功'); setEditMember(null); reload() }
    catch(e:unknown){ show((e as Error).message,'err') }
  }

  const removeMember = async(m:Member,action:'detach'|'delete')=>{
    if(!confirm(`确认将「${m.real_name}」${action==='delete'?'彻底删除':'迁出'}？`)) return
    try { await req(`/api/households/${detail.id}/members/${m.id}?action=${action}`,{method:'DELETE'}); show('✓ 完成'); reload() }
    catch(e:unknown){ show((e as Error).message,'err') }
  }

  const setHead = async(m:Member)=>{
    if(!confirm(`确认将「${m.real_name}」设为户主？`)) return
    try { await req(`/api/households/${detail.id}/members/${m.id}`,{method:'PUT',body:JSON.stringify({is_head:1})}); show('✓ 已设为户主'); reload() }
    catch(e:unknown){ show((e as Error).message,'err') }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-sm text-emerald-700 hover:underline">← 返回列表</button>
        <span className="text-stone-300">|</span>
        <span className="font-bold text-stone-800">{detail.household_name}</span>
        <span className="text-xs font-mono text-stone-400">{detail.household_code}</span>
        <Tag label={detail.village_full_name} color="blue"/>
        <button onClick={()=>{setEf({land_area:detail.contracted_area,address:detail.address??'',remark:detail.remark??''});setEditOpen(true)}} className="ml-auto text-xs text-stone-400 border border-stone-200 px-3 py-1 rounded-lg hover:text-emerald-700 hover:border-emerald-200">✏️ 编辑基础信息</button>
      </div>

      {/* 概览 */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          {label:'承包面积',val:detail.contracted_area>0?`${detail.contracted_area}亩`:'未设置',color:'text-emerald-700'},
          {label:'家庭成员',val:`${members.length}人`,color:'text-blue-600'},
          {label:'详细地址',val:detail.address||'—',color:'text-stone-600'},
          {label:'户籍状态',val:({1:'在册',2:'注销',3:'迁出'} as Record<number,string>)[detail.status]||'—',color:'text-stone-600'},
        ].map(s=>(
          <div key={s.label} className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
            <div className={`text-lg font-bold ${s.color} truncate`}>{s.val}</div>
            <div className="text-xs text-stone-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tab */}
      <div className="flex gap-1 mb-4">
        {[{id:'members',label:`成员管理（${members.length}人）`},{id:'area',label:'面积占用（按年）'},{id:'apps',label:`补贴记录（${detail.app_summary.length}条）`}].map(t=>(
          <button key={t.id} onClick={()=>setDtab(t.id as typeof dtab)}
            className={`px-4 py-2 text-sm rounded-lg border transition-colors ${dtab===t.id?'bg-stone-800 text-white border-stone-800':'bg-white border-stone-200 text-stone-600 hover:border-stone-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 成员管理 ── */}
      {dtab==='members'&&(
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
            <span className="text-sm font-semibold text-stone-700">家庭成员</span>
            <button onClick={()=>setAddOpen(true)} className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600">＋ 新增成员</button>
          </div>
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-stone-100">
              {['姓名','性别','身份证','手机','银行卡','开户行','关系','状态','操作'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs text-stone-400 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {members.map(m=>(
                <tr key={m.id} className={`border-b border-stone-50 hover:bg-stone-50 ${m.farmer_status!==1?'opacity-60':''}`}>
                  <td className="px-4 py-2.5"><span className="text-sm font-semibold">{m.real_name}</span>{m.is_head===1&&<Tag label="户主" color="purple"/>}</td>
                  <td className="px-4 py-2.5"><Tag label={m.gender===1?'男':'女'} color={m.gender===1?'blue':'purple'}/></td>
                  <td className="px-4 py-2.5 text-xs font-mono text-stone-400">{m.id_card_masked}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-stone-400">{m.phone_masked||'—'}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-stone-400">{m.bank_card_masked||'—'}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-400">{m.bank_name||'—'}</td>
                  <td className="px-4 py-2.5 text-xs">{m.relation||'—'}</td>
                  <td className="px-4 py-2.5"><Tag label={FARMER_STATUS[m.farmer_status]?.label||'—'} color={FARMER_STATUS[m.farmer_status]?.color as 'green'}/></td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={()=>{setEditMember(m);setEmf({real_name:m.real_name,bank_name:m.bank_name||'',relation:m.relation||'',farmer_status:m.farmer_status,remark:m.remark||''})}} className="text-xs text-stone-400 border border-stone-200 px-2 py-0.5 rounded hover:text-emerald-700 hover:border-emerald-200">编辑</button>
                      {m.is_head!==1&&<>
                        <button onClick={()=>setHead(m)} className="text-xs text-purple-500 border border-purple-200 px-2 py-0.5 rounded hover:bg-purple-50">设户主</button>
                        <button onClick={()=>removeMember(m,'detach')} className="text-xs text-amber-500 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-50">迁出</button>
                        <button onClick={()=>removeMember(m,'delete')} className="text-xs text-red-400 border border-red-200 px-2 py-0.5 rounded hover:bg-red-50">删</button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 面积按年 ── */}
      {dtab==='area'&&(
        <div className="space-y-3">
          {!areaByYear&&<div className="text-center py-12 text-stone-300">加载中…</div>}
          {areaByYear&&areaByYear.years.length===0&&<div className="text-center py-12 bg-white border border-stone-200 rounded-xl text-stone-300"><div className="text-4xl mb-2">📋</div><p className="text-sm">暂无按亩补贴记录</p></div>}
          {areaByYear?.years.map(y=>(
            <div key={y.year} className={`bg-white border rounded-xl overflow-hidden shadow-sm ${y.is_overdrawn?'border-red-300':'border-stone-200'}`}>
              <div className={`px-5 py-3 flex items-center justify-between border-b ${y.is_overdrawn?'bg-red-50 border-red-200':'bg-stone-50 border-stone-100'}`}>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-stone-800">{y.year}年</span>
                  <span className="text-sm text-stone-500">承包{y.contracted_area}亩 · 已用<strong className={y.is_overdrawn?'text-red-600':'text-amber-600'}>{y.total_used}亩</strong></span>
                </div>
                <div className="flex items-center gap-3">
                  {y.is_overdrawn?<Tag label={`⚠️超领${y.overdraw_amount}亩`} color="red"/>:<Tag label={`剩余${y.remaining_area}亩`} color="green"/>}
                  <div className="w-28 bg-stone-200 rounded-full h-2 overflow-hidden">
                    <div className={`h-full rounded-full ${y.is_overdrawn?'bg-red-500':'bg-emerald-500'}`} style={{width:`${y.contracted_area>0?Math.min(100,y.total_used/y.contracted_area*100):0}%`}}/>
                  </div>
                </div>
              </div>
              <table className="w-full border-collapse text-sm">
                <thead><tr className="border-b border-stone-100">
                  {['补贴项目','占用面积','实发金额','申请笔数'].map(h=><th key={h} className="px-5 py-2 text-left text-xs text-stone-400 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {y.details.map((d,i)=>(
                    <tr key={i} className="border-b border-stone-50">
                      <td className="px-5 py-2">{d.subsidy_name}</td>
                      <td className="px-5 py-2 font-mono font-bold text-amber-600">{d.used_area}亩</td>
                      <td className="px-5 py-2 font-mono text-emerald-700">{fmt(d.total_amount)}</td>
                      <td className="px-5 py-2 text-stone-400">{d.app_count}笔</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── 补贴记录（筛选+分页）── */}
      {dtab==='apps'&&(
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 flex gap-3 flex-wrap items-center">
            <select value={appYear} onChange={e=>{setAppYear(e.target.value?Number(e.target.value):'');setAppPage(1)}} className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm bg-white outline-none">
              <option value="">全部年度</option>{yearOpts.map(y=><option key={y} value={y}>{y}年</option>)}
            </select>
            <input value={appSearch} onChange={e=>{setAppSearch(e.target.value);setAppPage(1)}} placeholder="搜索姓名/补贴名称…" className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-400 w-48"/>
            <span className="text-xs text-stone-400">共{filtered.length}条</span>
          </div>
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-stone-100">
              {['年度','成员','补贴项目','方式','面积','申请金额','实发金额','状态'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs text-stone-400 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {paged.length===0&&<tr><td colSpan={8} className="text-center py-10 text-stone-300">暂无记录</td></tr>}
              {paged.map((a,i)=>(
                <tr key={i} className="border-b border-stone-50 hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-bold text-blue-600 text-sm">{a.apply_year}</td>
                  <td className="px-4 py-2.5 text-sm">{a.farmer_name}</td>
                  <td className="px-4 py-2.5 text-sm">{a.subsidy_name}</td>
                  <td className="px-4 py-2.5"><Tag label={a.calc_mode==='per_mu'?'按亩':'固定'} color={a.calc_mode==='per_mu'?'blue':'purple'}/></td>
                  <td className="px-4 py-2.5 text-sm font-mono">{a.apply_area!=null?`${a.apply_area}亩`:'—'}</td>
                  <td className="px-4 py-2.5 text-sm font-mono text-stone-500">{fmt(a.apply_amount)}</td>
                  <td className="px-4 py-2.5 text-sm font-mono font-bold text-emerald-700">{fmt(a.actual_amount)}</td>
                  <td className="px-4 py-2.5"><Tag label={PAY_STATUS[a.pay_status]?.label||'—'} color={PAY_STATUS[a.pay_status]?.color as 'green'}/></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length>PS&&(
            <div className="px-4 py-2 border-t border-stone-100 bg-stone-50/50 flex justify-between text-xs text-stone-400">
              <span>第{appPage}/{Math.ceil(filtered.length/PS)}页</span>
              <div className="flex gap-1">
                <button disabled={appPage<=1} onClick={()=>setAppPage(p=>p-1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">‹</button>
                <button disabled={appPage*PS>=filtered.length} onClick={()=>setAppPage(p=>p+1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">›</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 编辑家庭户 */}
      <Modal open={editOpen} title={`编辑家庭户·${detail.household_name}`} onClose={()=>setEditOpen(false)} onConfirm={submitEdit}>
        <div className="space-y-3">
          <div><label className="block text-xs text-stone-400 mb-1">承包土地面积（亩）</label><input type="number" step="0.01" min="0" value={ef.land_area||''} onChange={e=>setEf(f=>({...f,land_area:Number(e.target.value)}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"/></div>
          <div><label className="block text-xs text-stone-400 mb-1">详细地址</label><input value={ef.address} onChange={e=>setEf(f=>({...f,address:e.target.value}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"/></div>
          <div><label className="block text-xs text-stone-400 mb-1">备注</label><textarea rows={2} value={ef.remark} onChange={e=>setEf(f=>({...f,remark:e.target.value}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none"/></div>
        </div>
      </Modal>

      {/* 新增成员 */}
      <Modal open={addOpen} title="新增家庭成员" onClose={()=>setAddOpen(false)} onConfirm={submitAdd} confirmText="添加">
        <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-3">若身份证已存在于其他家庭户，将自动迁入本户</p>
        <div className="grid grid-cols-2 gap-3">
          {[{l:'姓名 *',k:'real_name',t:'text'},{l:'身份证号 *',k:'id_card',t:'text'},{l:'手机号',k:'phone',t:'text'},{l:'银行卡号',k:'bank_card',t:'text'},{l:'开户行',k:'bank_name',t:'text'}].map(f=>(
            <div key={f.k}><label className="block text-xs text-stone-400 mb-1">{f.l}</label><input type={f.t} value={(mf as Record<string,string|number>)[f.k] as string} onChange={e=>setMf(p=>({...p,[f.k]:e.target.value}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"/></div>
          ))}
          <div><label className="block text-xs text-stone-400 mb-1">与户主关系</label><input value={mf.relation} onChange={e=>setMf(p=>({...p,relation:e.target.value}))} list="rl" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"/><datalist id="rl">{['妻子','丈夫','儿子','女儿','父亲','母亲','兄弟','姐妹','孙子','孙女'].map(r=><option key={r} value={r}/>)}</datalist></div>
          <div><label className="block text-xs text-stone-400 mb-1">设为户主</label><select value={mf.is_head} onChange={e=>setMf(p=>({...p,is_head:Number(e.target.value)}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none"><option value={0}>否</option><option value={1}>是（原户主降级）</option></select></div>
          <div><label className="block text-xs text-stone-400 mb-1">在册状态</label><select value={mf.farmer_status} onChange={e=>setMf(p=>({...p,farmer_status:Number(e.target.value)}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none"><option value={1}>在册</option><option value={2}>注销</option><option value={3}>迁出</option><option value={4}>死亡</option></select></div>
        </div>
      </Modal>

      {/* 编辑成员 */}
      <Modal open={!!editMember} title={`编辑成员·${editMember?.real_name}`} onClose={()=>setEditMember(null)} onConfirm={submitEditMember}>
        <div className="grid grid-cols-2 gap-3">
          {[{l:'姓名',k:'real_name'},{l:'开户行',k:'bank_name'}].map(f=>(
            <div key={f.k}><label className="block text-xs text-stone-400 mb-1">{f.l}</label><input value={(emf as Record<string,string>)[f.k]??''} onChange={e=>setEmf(p=>({...p,[f.k]:e.target.value}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"/></div>
          ))}
          <div><label className="block text-xs text-stone-400 mb-1">在册状态</label><select value={emf.farmer_status??1} onChange={e=>setEmf(p=>({...p,farmer_status:Number(e.target.value)}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none"><option value={1}>在册</option><option value={2}>注销</option><option value={3}>迁出</option><option value={4}>死亡</option></select></div>
          <div><label className="block text-xs text-stone-400 mb-1">与户主关系</label><input value={emf.relation??''} onChange={e=>setEmf(p=>({...p,relation:e.target.value}))} list="rl2" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"/><datalist id="rl2">{['妻子','丈夫','儿子','女儿','父亲','母亲','兄弟','姐妹'].map(r=><option key={r} value={r}/>)}</datalist></div>
          <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1">备注</label><input value={emf.remark??''} onChange={e=>setEmf(p=>({...p,remark:e.target.value}))} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"/></div>
        </div>
      </Modal>
    </div>
  )
}

function MiniBar({c,u,od}:{c:number;u:number;od:boolean}) {
  if(c<=0) return <span className="text-xs text-stone-300">—</span>
  const pct = Math.min(100,Math.round(u/c*100))
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-12 bg-stone-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${od?'bg-red-500':pct>80?'bg-amber-400':'bg-emerald-400'}`} style={{width:`${pct}%`}}/>
      </div>
      <span className={`text-xs font-mono whitespace-nowrap ${od?'text-red-600 font-bold':'text-stone-400'}`}>{u}亩</span>
    </div>
  )
}
