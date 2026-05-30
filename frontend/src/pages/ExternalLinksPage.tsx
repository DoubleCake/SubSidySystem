/**
 * 外联查询页
 * Tab 1: 外部网站 —— 卡片展示，点击 iframe 内嵌打开 / 新标签页
 * Tab 2: 系统内查询 —— 按姓名/身份证/年度/补贴类型搜索本系统补贴记录
 * 批量查询记录：记录本次查了哪些人，留备注标签，供后期统计
 */
import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import type { SubsidyType } from '../types'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { fmt, PAY_STATUS, years } from '../utils'

// ─── 类型 ───
interface Site { id:number; name:string; url:string; site_type:'link'|'query'; image:string|null; description:string|null; sort_order:number; is_active:number }
interface QRecord { id:number; site_name:string; query_type:string; query_inputs:string[]; query_count:number; result_note:string|null; purpose:string|null; operator:string; tags:string|null; created_at:string|null }
interface Stats { total_records:number; total_items:number; by_type:{type:string;times:number;total_items:number}[]; by_site:{site:string;times:number}[] }

async function req<T>(path:string, opts:RequestInit={}):Promise<T> {
  const r = await fetch(path,{headers:{'Content-Type':'application/json'},...opts})
  if(!r.ok){const e=await r.json().catch(()=>({})) as{detail?:string}; throw new Error(e.detail||'请求失败')}
  return r.json() as Promise<T>
}

type AppRow = { id:number; farmer_id:number; farmer_name:string; id_card_masked?:string; village?:string; subsidy_name:string; calc_mode:string; apply_year:number; apply_area:string|null; apply_amount:string|null; actual_amount:string|null; pay_status:number; pay_date:string|null; remark:string|null }

const QUERY_TYPES = ['身份证查询','姓名查询','综合查询','其他']
const TAGS_PRESET = ['年度核查','补贴核验','重复申领排查','死亡核查','迁出核查','待处理','已完成','存疑']

export default function ExternalLinksPage() {
  const { toast, show } = useToast()
  const [tab, setTab] = useState<'sites'|'search'|'records'>('search')

  // ── 网站 ──
  const [sites, setSites] = useState<Site[]>([])
  const [openSite, setOpenSite] = useState<Site|null>(null)
  const [siteModal, setSiteModal] = useState(false)
  const [editSite, setEditSite] = useState<Site|null>(null)
  const [siteForm, setSiteForm] = useState<Partial<Site>>({site_type:'link',sort_order:0,is_active:1})
  const [siteFormMode, setSiteFormMode] = useState(false)  // true=表单 false=列表

  // ── 系统内查询 ──
  const [srch, setSrch] = useState('')
  const [srchYear, setSrchYear] = useState<number|''>('')
  const [srchTypeId, setSrchTypeId] = useState<number|''>('')
  const [srchVillage, setSrchVillage] = useState('')
  const [srchPage, setSrchPage] = useState(1)
  const [srchResults, setSrchResults] = useState<AppRow[]>([])
  const [srchTotal, setSrchTotal] = useState(0)
  const [srchLoading, setSrchLoading] = useState(false)
  const [subsidyTypes, setSubsidyTypes] = useState<SubsidyType[]>([])
  const [villages, setVillages] = useState<string[]>([])

  // ── 查询记录 ──
  const [records, setRecords] = useState<QRecord[]>([])
  const [recTotal, setRecTotal] = useState(0)
  const [recPage, setRecPage] = useState(1)
  const [recSearch, setRecSearch] = useState('')
  const [recLoading, setRecLoading] = useState(false)
  const [stats, setStats] = useState<Stats|null>(null)
  const [editRecord, setEditRecord] = useState<QRecord|null>(null)
  const [recForm, setRecForm] = useState({result_note:'',purpose:'',tags:''})

  // ── 批量记录面板 ──
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchType, setBatchType] = useState('身份证查询')
  const [batchSiteId, setBatchSiteId] = useState<number|''>('')
  const [batchPurpose, setBatchPurpose] = useState('')
  const [batchOperator, setBatchOperator] = useState('操作员')
  const [batchTags, setBatchTags] = useState('')

  // ── 查询结果收藏 ──
  const [favorOpen, setFavorOpen] = useState(false)
  const [favorContext, setFavorContext] = useState<{
    inputs: string[]; type: string; source: string
  } | null>(null)
  const [favorPurpose, setFavorPurpose] = useState('')
  const [favorTags, setFavorTags] = useState('')

  useEffect(()=>{ loadSites() },[])
  useEffect(()=>{
    api.getVillageGroups().then(g=>setVillages([...new Set(g.map(v=>v.village_name))]))
    api.getSubsidyTypes().then(setSubsidyTypes)
  },[])
  useEffect(()=>{ if(tab==='records'){ loadRecords(); loadStats() } },[tab, recPage, recSearch])

  const loadSites = async()=>{ try{ const d=await req<Site[]>('/api/external/sites'); setSites(d) }catch{} }
  const loadRecords = async()=>{
    setRecLoading(true)
    try{
      const p=new URLSearchParams({page:String(recPage),page_size:'20'})
      if(recSearch) p.set('search',recSearch)
      const r=await req<{total:number;items:QRecord[]}>(`/api/external/records?${p}`)
      setRecords(r.items); setRecTotal(r.total)
    }finally{setRecLoading(false)}
  }
  const loadStats = async()=>{ try{ const s=await req<Stats>('/api/external/records/stats'); setStats(s) }catch{} }

  // 系统内搜索
  const doSearch = useCallback(async()=>{
    if(!srch && !srchYear && !srchTypeId && !srchVillage) return
    setSrchLoading(true)
    try{
      const p: Record<string,string|number> = {page:srchPage,page_size:20}
      if(srch) p.search=srch
      if(srchYear) p.year=srchYear
      if(srchTypeId) p.subsidy_type_id=srchTypeId
      if(srchVillage) p.village_name=srchVillage
      const r=await api.searchApplications(p)
      setSrchResults(r.items as AppRow[]); setSrchTotal(r.total)
    }finally{setSrchLoading(false)}
  },[srch,srchYear,srchTypeId,srchVillage,srchPage])

  useEffect(()=>{ if(tab==='search') doSearch() },[tab,doSearch])

  // 提交批量记录
  const submitBatch = async()=>{
    const inputs=batchText.split(/[\n,，;；]/).map(s=>s.trim()).filter(Boolean)
    if(!inputs.length) return show('请输入查询内容','err')
    const siteName=sites.find(s=>s.id===batchSiteId)?.name||'手动记录'
    try{
      await req('/api/external/records',{method:'POST',body:JSON.stringify({
        site_id:batchSiteId||null,site_name:siteName,query_type:batchType,
        query_inputs:inputs,purpose:batchPurpose||null,operator:batchOperator,tags:batchTags||null
      })})
      show(`✓ 已保存 ${inputs.length} 条查询记录`)
      setBatchOpen(false); setBatchText('')
      if(tab==='records'){loadRecords();loadStats()}
    }catch(e:unknown){show((e as Error).message,'err')}
  }

  const submitEditRecord = async()=>{
    if(!editRecord) return
    await req(`/api/external/records/${editRecord.id}`,{method:'PUT',body:JSON.stringify(recForm)})
    show('✓ 已更新'); setEditRecord(null); loadRecords()
  }

  const deleteRecord = async(id:number)=>{
    if(!confirm('确认删除？')) return
    await req(`/api/external/records/${id}`,{method:'DELETE'})
    show('✓ 已删除'); loadRecords(); loadStats()
  }

  const submitSite = async()=>{
    if(!siteForm.name||!siteForm.url) return show('名称和地址必填','err')
    try{
      if(editSite?.id) await req(`/api/external/sites/${editSite.id}`,{method:'PUT',body:JSON.stringify(siteForm)})
      else await req('/api/external/sites',{method:'POST',body:JSON.stringify(siteForm)})
      show('✓ 保存成功'); setSiteModal(false); setEditSite(null); setSiteFormMode(false); loadSites()
    }catch(e:unknown){show((e as Error).message,'err')}
  }

  const deleteSite = async(id:number)=>{
    if(!confirm('确认删除？')) return
    await req(`/api/external/sites/${id}`,{method:'DELETE'}); show('✓ 已删除'); loadSites()
  }

  // 收藏查询结果
  const saveFavor = async () => {
    if (!favorContext) return
    const siteName = favorContext.source || '系统内查询'
    try {
      await req('/api/external/records', { method: 'POST', body: JSON.stringify({
        site_id: null, site_name: siteName,
        query_type: favorContext.type,
        query_inputs: favorContext.inputs,
        purpose: favorPurpose || null,
        operator: '操作员',
        tags: favorTags || null,
      })})
      show('✓ 已收藏到查询记录')
      setFavorOpen(false); setFavorPurpose(''); setFavorTags('')
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // Toggle tag
  const toggleTag = (t:string, cur:string, set:(v:string)=>void)=>{
    const ts=cur.split(',').map(s=>s.trim()).filter(Boolean)
    set(ts.includes(t)?ts.filter(x=>x!==t).join(', '):[...ts,t].join(', '))
  }

  return (
    <div>
      {/* Tab */}
      <div className="flex items-center gap-2 mb-4">
        {[{id:'search',label:'🔍 系统内查询'},{id:'records',label:'📝 查询记录'},{id:'sites',label:'🌐 外部网站'}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id as typeof tab)}
            className={`px-4 py-2 text-sm rounded-btn border transition-colors ${tab===t.id?'bg-primary  border-emerald-700':'bg-white border-border text-text-primary hover:border-border'}`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button onClick={()=>{ setEditSite(null); setSiteForm({site_type:'link',sort_order:0,is_active:1}); setSiteModal(true) }}
            className="text-xs border border-border text-text-muted px-3 py-1.5 rounded-btn hover:border-primary/30 hover:text-primary">⚙️ 管理网站</button>
          <button onClick={()=>setBatchOpen(true)}
            className="text-sm bg-primary  px-4 py-2 rounded-btn hover:bg-primary/90">＋ 批量查询</button>
        </div>
      </div>

      {/* ── 外部网站 ── */}
      {tab==='sites'&&(
        <>
          {openSite&&(
            <div className="mb-4 bg-white border border-border rounded-card overflow-hidden shadow-card">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-warm/50 border-b border-border text-text-primary text-sm">
                <span className="font-semibold">{openSite.name}</span>
                <span className="text-text-muted text-xs font-mono truncate flex-1">{openSite.url}</span>
                <a href={openSite.url} target="_blank" rel="noopener noreferrer" className="text-xs bg-primary/10 hover:bg-primary/20 text-primary px-2.5 py-1 rounded">↗ 新标签页</a>
                <button onClick={()=>setOpenSite(null)} className="text-text-muted hover:text-text-primary ml-2">✕</button>
              </div>
              <iframe src={openSite.url} className="w-full" style={{height:480}} title={openSite.name}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
            </div>
          )}
          {sites.filter(s=>s.is_active).length===0
            ?<div className="text-center py-20 bg-white border border-border rounded-card text-text-muted/50">
               <div className="text-5xl mb-3">🌐</div>
               <p className="text-sm mb-3">暂无外部网站，点击右上角「管理网站」添加</p>
             </div>
            :<div className="grid grid-cols-3 gap-4">
               {sites.filter(s=>s.is_active).map(s=>(
                 <div key={s.id} className="bg-white border border-border rounded-card p-5 shadow-card hover:border-primary/30 hover:shadow-card transition-all cursor-pointer group"
                   onClick={()=>setOpenSite(s)}>
                   <div className="flex items-start justify-between mb-3">
                     <div className="w-12 h-12 bg-primary/5 border border-primary/10 rounded-card flex items-center justify-center overflow-hidden">
                       {s.image
                         ? <img src={s.image} alt={s.name} className="w-full h-full object-cover" />
                         : <span className="text-xl">🌐</span>}
                     </div>
                   </div>
                   <h3 className="font-bold text-text-primary text-sm mb-1 group-hover:text-primary">{s.name}</h3>
                   {s.description&&<p className="text-xs text-text-muted mb-2">{s.description}</p>}
                   <p className="text-xs text-text-muted/50 font-mono truncate">{s.url}</p>
                   <div className="mt-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                     <span className="text-xs text-primary">点击内嵌打开 →</span>
                     <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} className="text-xs text-text-muted hover:text-text-primary">↗ 新标签</a>
                   </div>
                 </div>
               ))}
             </div>
          }
        </>
      )}

      {/* ── 系统内查询 ── */}
      {tab==='search'&&(
        <div>
          {/* 搜索栏 */}
          <div className="bg-white border border-border rounded-card p-4 shadow-card mb-4">
            <div className="flex gap-3 flex-wrap items-end">
              <div className="flex-1 min-w-48">
                <label className="block text-xs text-text-muted mb-1">姓名 / 身份证号</label>
                <input value={srch} onChange={e=>setSrch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doSearch()}
                  placeholder="输入姓名或身份证…" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">年度</label>
                <select value={srchYear} onChange={e=>setSrchYear(e.target.value?Number(e.target.value):'')}
                  className="border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                  <option value="">全部年度</option>
                  {years.map(y=><option key={y} value={y}>{y}年</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">补贴类型</label>
                <select value={srchTypeId} onChange={e=>setSrchTypeId(e.target.value?Number(e.target.value):'')}
                  className="border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                  <option value="">全部类型</option>
                  {subsidyTypes.map(t=><option key={t.id} value={t.id}>{t.subsidy_name}（{t.subsidy_year}）</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">村庄</label>
                <select value={srchVillage} onChange={e=>setSrchVillage(e.target.value)}
                  className="border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                  <option value="">全部村庄</option>
                  {villages.map(v=><option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <button onClick={()=>{setSrchPage(1);doSearch()}}
                className="px-4 py-2 bg-primary  text-sm rounded-btn hover:bg-primary/90">搜索</button>
              <button onClick={()=>{setSrch('');setSrchYear('');setSrchTypeId('');setSrchVillage('');setSrchResults([]);setSrchTotal(0)}}
                className="px-3 py-2 text-sm border border-border text-text-muted rounded-btn hover:bg-warm/30">清除</button>
            </div>
          </div>

          {/* 结果 */}
          {srchResults.length>0&&(
            <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
              <div className="px-4 py-2.5 bg-warm/30 border-b border-border/50 flex justify-between items-center">
                <span className="text-sm font-semibold text-text-primary">查询结果</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted">共 {srchTotal} 条</span>
                  <button onClick={()=>{
                    setFavorContext({ inputs: srch ? [srch] : ['综合查询'], type: srch.length===18?'身份证查询':'姓名查询', source:'系统内查询' })
                    setFavorOpen(true)
                  }} className="text-xs text-amber-600 border border-amber-200 px-2.5 py-1 rounded-btn hover:bg-amber-50">
                    ★ 收藏本次查询
                  </button>
                </div>
              </div>
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-border/50">
                  {['姓名','身份证','所在村','补贴项目','年度','面积','申请金额','实发金额','状态',''].map(h=>(
                    <th key={h} className="px-3.5 py-2.5 text-left text-xs text-text-muted font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {srchLoading&&<tr><td colSpan={9} className="text-center py-8 text-text-muted/50">查询中…</td></tr>}
                  {!srchLoading&&srchResults.map(a=>(
                    <tr key={a.id} className="border-b border-border/50 hover:bg-warm/30">
                      <td className="px-3.5 py-2.5 text-sm font-semibold">{a.farmer_name}</td>
                      <td className="px-3.5 py-2.5 text-xs font-mono text-text-muted">{a.id_card_masked||'—'}</td>
                      <td className="px-3.5 py-2.5 text-xs text-text-muted">{a.village||'—'}</td>
                      <td className="px-3.5 py-2.5 text-sm">{a.subsidy_name}</td>
                      <td className="px-3.5 py-2.5 text-sm font-bold text-blue-600">{a.apply_year}</td>
                      <td className="px-3.5 py-2.5 text-sm font-mono">{a.apply_area?`${a.apply_area}亩`:'—'}</td>
                      <td className="px-3.5 py-2.5 text-sm font-mono text-text-muted">{fmt(a.apply_amount)}</td>
                      <td className="px-3.5 py-2.5 text-sm font-mono font-bold text-primary">{fmt(a.actual_amount)}</td>
                      <td className="px-3.5 py-2.5"><Tag label={PAY_STATUS[a.pay_status]?.label||'—'} color={PAY_STATUS[a.pay_status]?.color as 'green'}/></td>
                      <td className="px-3.5 py-2.5">
                        <button onClick={()=>{
                          setFavorContext({ inputs:[a.farmer_name + (a.id_card_masked?' '+a.id_card_masked:'')], type:'综合查询', source:'系统内查询' })
                          setFavorOpen(true)
                        }} className="text-xs text-amber-600 border border-amber-200 px-2.5 py-1 rounded-btn hover:bg-amber-50 whitespace-nowrap">
                          ★ 收藏
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {srchTotal>20&&(
                <div className="px-4 py-2 border-t border-border/50 bg-warm/10 flex justify-between text-xs text-text-muted">
                  <span>第{srchPage}/{Math.ceil(srchTotal/20)}页</span>
                  <div className="flex gap-1">
                    <button disabled={srchPage<=1} onClick={()=>setSrchPage(p=>p-1)} className="px-2.5 py-1 border border-border rounded disabled:opacity-40">‹</button>
                    <button disabled={srchPage*20>=srchTotal} onClick={()=>setSrchPage(p=>p+1)} className="px-2.5 py-1 border border-border rounded disabled:opacity-40">›</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {!srchLoading&&srchResults.length===0&&srch&&(
            <div className="text-center py-12 bg-white border border-border rounded-card text-text-muted/50 text-sm">无匹配结果</div>
          )}
        </div>
      )}

      {/* ── 查询记录 ── */}
      {tab==='records'&&(
        <div className="grid grid-cols-[1fr_240px] gap-5">
          <div>
            <div className="flex gap-2 mb-3">
              <input value={recSearch} onChange={e=>{setRecSearch(e.target.value);setRecPage(1)}} placeholder="搜索记录内容/备注…"
                className="border border-border rounded-btn px-3 py-1.5 text-sm outline-none focus:border-primary bg-white w-56"/>
            </div>
            <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
              {recLoading&&<div className="text-center py-10 text-text-muted/50">加载中…</div>}
              {!recLoading&&records.length===0&&<div className="text-center py-14 text-text-muted/50"><div className="text-4xl mb-2">📝</div><p className="text-sm">暂无记录，点击右上角「保存查询记录」</p></div>}
              {records.map(r=>(
                <div key={r.id} className="border-b border-border/50 px-5 py-4 hover:bg-warm/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Tag label={r.query_type} color="blue"/>
                        <Tag label={r.site_name} color="gray"/>
                        {r.tags&&r.tags.split(',').map(t=><Tag key={t} label={t.trim()} color="amber"/>)}
                        <span className="text-xs text-text-muted/50 font-mono">{r.created_at?.slice(0,16)}</span>
                        <span className="text-xs text-text-muted">· {r.operator}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {r.query_inputs.slice(0,8).map((inp,i)=>(
                          <span key={i} className="bg-warm/30 text-text-primary text-xs font-mono px-2 py-0.5 rounded">{inp}</span>
                        ))}
                        {r.query_inputs.length>8&&<span className="text-xs text-text-muted">…共{r.query_inputs.length}条</span>}
                      </div>
                      {r.purpose&&<p className="text-xs text-text-muted mb-1">目的：{r.purpose}</p>}
                      {r.result_note
                        ?<p className="text-xs text-text-primary bg-amber-50 border border-amber-100 rounded px-2 py-1">备注：{r.result_note}</p>
                        :<p className="text-xs text-text-muted/50 italic">无备注，点击编辑补充</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={()=>{setEditRecord(r);setRecForm({result_note:r.result_note||'',purpose:r.purpose||'',tags:r.tags||''})}}
                        className="text-xs text-text-muted border border-border px-2.5 py-1 rounded-btn hover:text-primary hover:border-primary/20">编辑</button>
                      <button onClick={()=>deleteRecord(r.id)} className="text-xs text-text-muted/50 border border-border px-2 py-1 rounded-btn hover:text-red-500 hover:border-red-200">删</button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="px-5 py-2 border-t border-border/50 bg-warm/10 flex justify-between text-xs text-text-muted">
                <span>共{recTotal}条</span>
                <div className="flex gap-1">
                  <button disabled={recPage<=1} onClick={()=>setRecPage(p=>p-1)} className="px-2.5 py-1 border border-border rounded disabled:opacity-40">‹</button>
                  <span className="px-1">{recPage}/{Math.max(1,Math.ceil(recTotal/20))}</span>
                  <button disabled={recPage*20>=recTotal} onClick={()=>setRecPage(p=>p+1)} className="px-2.5 py-1 border border-border rounded disabled:opacity-40">›</button>
                </div>
              </div>
            </div>
          </div>
          {/* 右侧统计 */}
          <div className="space-y-3">
            {stats&&<>
              <div className="bg-white border border-border rounded-card p-4 shadow-card">
                <div className="text-2xl font-bold font-mono text-primary">{stats.total_records}</div>
                <div className="text-xs text-text-muted mt-1">查询记录总数</div>
                <div className="text-xs text-text-muted/50 mt-0.5">累计查询{stats.total_items}条信息</div>
              </div>
              <div className="bg-white border border-border rounded-card p-4 shadow-card">
                <p className="text-xs font-semibold text-text-muted mb-2">按查询类型</p>
                {stats.by_type.map(t=>(
                  <div key={t.type} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
                    <span className="text-xs text-text-primary">{t.type}</span>
                    <span className="text-xs font-mono text-text-primary">{t.times}次/{t.total_items}条</span>
                  </div>
                ))}
                {stats.by_type.length===0&&<p className="text-xs text-text-muted/50">暂无数据</p>}
              </div>
            </>}
          </div>
        </div>
      )}

      {/* 网站管理弹窗 — 列表模式 / 编辑模式 */}
      <Modal open={siteModal} title={editSite?.id ? '编辑网站' : siteFormMode ? '新增网站' : '管理外部网站'}
        onClose={()=>{ setSiteModal(false); setEditSite(null); setSiteForm({site_type:'link',sort_order:0,is_active:1}); setSiteFormMode(false) }}
        onConfirm={ siteFormMode ? submitSite : undefined }
        confirmText="保存">
        {/* ── 表单模式（新增或编辑） ── */}
        {siteFormMode ? (
          <div className="space-y-3">
            {editSite?.id && <div className="text-xs text-text-muted bg-warm/30 border border-border rounded px-3 py-1.5">正在编辑：{editSite.name}</div>}
            <div><label className="block text-xs text-text-muted mb-1">网站名称 *</label>
              <input value={siteForm.name??''} onChange={e=>setSiteForm(f=>({...f,name:e.target.value}))} placeholder="如：农经网、社保系统"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/></div>
            <div><label className="block text-xs text-text-muted mb-1">网址 *</label>
              <input value={siteForm.url??''} onChange={e=>setSiteForm(f=>({...f,url:e.target.value}))} placeholder="https://"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm font-mono outline-none focus:border-primary"/></div>
            <div><label className="block text-xs text-text-muted mb-1">图标（可选）</label>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 border border-border rounded-card overflow-hidden bg-warm/20 flex items-center justify-center flex-shrink-0">
                  {siteForm.image
                    ? <img src={siteForm.image as string} alt="" className="w-full h-full object-cover" />
                    : <span className="text-text-muted/40 text-lg">🖼</span>}
                </div>
                <label className="px-3 py-1.5 text-xs border border-border rounded-btn cursor-pointer hover:bg-warm/20">
                  {siteForm.image ? '更换图片' : '选择图片'}
                  <input type="file" accept="image/*" className="hidden" onChange={e=>{
                    const f=e.target.files?.[0]; if(!f) return
                    const r=new FileReader(); r.onload=()=>setSiteForm(p=>({...p,image:r.result as string})); r.readAsDataURL(f)
                  }}/>
                </label>
                {siteForm.image&&<button onClick={()=>setSiteForm(f=>({...f,image:null}))}
                  className="text-xs text-red-400 hover:underline">移除</button>}
              </div></div>
            <div><label className="block text-xs text-text-muted mb-1">描述（可选）</label>
              <input value={siteForm.description??''} onChange={e=>setSiteForm(f=>({...f,description:e.target.value}))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-text-muted mb-1">排序</label>
                <input type="number" value={siteForm.sort_order??0} onChange={e=>setSiteForm(f=>({...f,sort_order:Number(e.target.value)}))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none"/></div>
              <div><label className="block text-xs text-text-muted mb-1">状态</label>
                <select value={siteForm.is_active??1} onChange={e=>setSiteForm(f=>({...f,is_active:Number(e.target.value)}))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                  <option value={1}>启用</option><option value={0}>禁用</option>
                </select></div>
            </div>
            <button onClick={()=>{ setSiteForm({site_type:'link',sort_order:0,is_active:1}); setSiteFormMode(false); setEditSite(null) }}
              className="text-xs text-text-muted hover:underline">← 返回列表</button>
          </div>
        ) : (
          /* ── 列表模式 ── */
          <div>
            <div className="flex justify-between items-center mb-3">
              <p className="text-sm text-text-muted">已配置 {sites.length} 个网站</p>
              <button onClick={()=>{ setSiteForm({name:'',url:'',site_type:'link',sort_order:sites.length+1,is_active:1}); setSiteFormMode(true) }}
                className="text-sm bg-primary  px-3 py-1.5 rounded-btn hover:bg-primary/90">＋ 新增网站</button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {sites.length===0&&<p className="text-center py-8 text-text-muted/50 text-sm">暂无网站，点击「＋新增网站」添加</p>}
              {sites.map(s=>(
                <div key={s.id} className="flex items-center gap-3 bg-warm/30 border border-border rounded-card px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary">{s.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${s.is_active?'bg-emerald-100 text-primary':'bg-stone-200 text-text-muted'}`}>
                        {s.is_active?'启用':'禁用'}
                      </span>
                    </div>
                    {s.description&&<p className="text-xs text-text-muted mt-0.5">{s.description}</p>}
                    <p className="text-xs text-text-muted/50 font-mono truncate mt-0.5">{s.url}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={()=>{
                      setEditSite(s)
                      setSiteForm({name:s.name,url:s.url,site_type:s.site_type,image:s.image,description:s.description||'',sort_order:s.sort_order,is_active:s.is_active})
                      setSiteFormMode(true)
                    }} className="text-xs text-text-muted border border-border px-2 py-1 rounded hover:text-primary hover:border-primary/20">编辑</button>
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-text-muted border border-border px-2 py-1 rounded hover:text-blue-600 hover:border-blue-200">↗</a>
                    <button onClick={()=>deleteSite(s.id)} className="text-xs text-red-400 border border-red-100 px-2 py-1 rounded hover:bg-red-50">删</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>


      {/* 批量查询记录 */}
      <Modal open={batchOpen} title="保存查询记录" onClose={()=>setBatchOpen(false)} onConfirm={submitBatch} confirmText="保存记录">
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-100 rounded-btn px-3 py-2 text-xs text-blue-700">
            记录本次查询的内容（可批量），便于后期统计和审计追溯。
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">查询内容 *（每行一条）</label>
            <textarea rows={5} value={batchText} onChange={e=>setBatchText(e.target.value)}
              placeholder={"510123196503154231\n张三\n李四"}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none"/>
            <p className="text-xs text-text-muted/50 mt-1">已输入 {batchText.split(/[\n,，;；]/).map(s=>s.trim()).filter(Boolean).length} 条 · 保存后将记录到查询记录，可随时查阅</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-text-muted mb-1">查询类型</label>
              <select value={batchType} onChange={e=>setBatchType(e.target.value)}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                {QUERY_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select></div>
            <div><label className="block text-xs text-text-muted mb-1">关联网站</label>
              <select value={batchSiteId} onChange={e=>setBatchSiteId(e.target.value?Number(e.target.value):'')}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                <option value="">手动记录</option>
                {sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className="block text-xs text-text-muted mb-1">操作员</label>
              <input value={batchOperator} onChange={e=>setBatchOperator(e.target.value)}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/></div>
            <div><label className="block text-xs text-text-muted mb-1">查询目的</label>
              <input value={batchPurpose} onChange={e=>setBatchPurpose(e.target.value)} placeholder="如：年度补贴核查"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/></div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">标签</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {TAGS_PRESET.map(t=>(
                <button key={t} onClick={()=>toggleTag(t,batchTags,setBatchTags)}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors
                    ${batchTags.includes(t)?'bg-amber-100 border-amber-300 text-amber-700':'bg-warm/30 border-border text-text-muted hover:border-border'}`}>{t}</button>
              ))}
            </div>
            <input value={batchTags} onChange={e=>setBatchTags(e.target.value)} placeholder="自由输入，逗号分隔"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/>
          </div>
        </div>
      </Modal>

      {/* 编辑记录 */}
      <Modal open={!!editRecord} title="编辑查询记录" onClose={()=>setEditRecord(null)} onConfirm={submitEditRecord}>
        <div className="space-y-3">
          {editRecord&&<div className="bg-warm/30 border border-border rounded-btn px-3 py-2 text-xs text-text-muted">
            {editRecord.query_type} · {editRecord.site_name} · {editRecord.query_count}条 · {editRecord.created_at?.slice(0,16)}
          </div>}
          <div><label className="block text-xs text-text-muted mb-1">查询目的</label>
            <input value={recForm.purpose} onChange={e=>setRecForm(f=>({...f,purpose:e.target.value}))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/></div>
          <div><label className="block text-xs text-text-muted mb-1">结果备注</label>
            <textarea rows={3} value={recForm.result_note} onChange={e=>setRecForm(f=>({...f,result_note:e.target.value}))}
              placeholder="记录查询结论…"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none"/></div>
          <div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {TAGS_PRESET.map(t=>(
                <button key={t} onClick={()=>toggleTag(t,recForm.tags,v=>setRecForm(f=>({...f,tags:v})))}
                  className={`text-xs px-2 py-0.5 rounded border ${recForm.tags.includes(t)?'bg-amber-100 border-amber-300 text-amber-700':'bg-warm/30 border-border text-text-muted'}`}>{t}</button>
              ))}
            </div>
            <input value={recForm.tags} onChange={e=>setRecForm(f=>({...f,tags:e.target.value}))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/>
          </div>
        </div>
      </Modal>

      {/* 收藏查询结果弹窗 */}
      <Modal open={favorOpen} title="收藏查询记录" onClose={()=>setFavorOpen(false)} onConfirm={saveFavor} confirmText="确认收藏" bg-primary-200>
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-100 rounded-btn px-3 py-2 text-xs text-amber-700">
            <strong>本次查询内容：</strong>
            <div className="mt-1 flex flex-wrap gap-1">
              {favorContext?.inputs.map((inp,i)=>(
                <span key={i} className="bg-white border border-amber-200 text-amber-800 font-mono px-2 py-0.5 rounded text-xs">{inp}</span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">查询事项 / 原因 *</label>
            <textarea rows={3} value={favorPurpose} onChange={e=>setFavorPurpose(e.target.value)}
              placeholder="如：核查张三2024年粮食直补是否重复申领&#10;如：年度数据比对，核实身份证与姓名匹配情况"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-amber-400 resize-none" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">标签</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {TAGS_PRESET.map(t=>(
                <button key={t} onClick={()=>toggleTag(t,favorTags,setFavorTags)}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors
                    ${favorTags.includes(t)?'bg-amber-100 border-amber-300 text-amber-700':'bg-warm/30 border-border text-text-muted hover:border-border'}`}>{t}</button>
              ))}
            </div>
            <input value={favorTags} onChange={e=>setFavorTags(e.target.value)} placeholder="自由输入，逗号分隔"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"/>
          </div>
        </div>
      </Modal>

      <Toast {...toast}/>
    </div>
  )
}
