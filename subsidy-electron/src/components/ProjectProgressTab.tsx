/**
 * 项目进度管理 V2 — 垂直卡片布局 + 顶部总览 + 侧边抽屉
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

type StatusKey = 'none' | 'in_progress' | 'done' | 'reminded' | 'urged'
interface StageItem { name: string; status: StatusKey; date: string; note: string }
interface ProgressRecord {
  id?: number; subsidy_type_id: number
  village_id: number; village_name: string
  person_name: string; phone: string
  stages: StageItem[]; note: string; updated_at: string
}

const STATUS_CFG: Record<StatusKey, { label: string; color: string; bg: string; text: string; dot: string }> = {
  none:        { label: '未开始', color: '#c2c3c5', bg: '#f5f5f5', text: '#6b6b6b', dot: '○' },
  in_progress: { label: '进行中', color: '#f4c076', bg: '#fef9ef', text: '#8a6d3b', dot: '◐' },
  done:        { label: '已完成', color: '#5ebd9a', bg: '#eaf7f1', text: '#2d6a4f', dot: '●' },
  reminded:    { label: '已提醒', color: '#f09c78', bg: '#fef3ee', text: '#c05a3e', dot: '△' },
  urged:       { label: '已催缴', color: '#e07060', bg: '#fef0ef', text: '#a03020', dot: '▲' },
}
const STATUS_CYCLE: StatusKey[] = ['none', 'in_progress', 'done', 'reminded', 'urged']
const STATUS_ORDER: StatusKey[] = ['none', 'in_progress', 'done', 'reminded', 'urged']

function fmtDate(iso: string) { return iso ? iso.slice(0, 10) : '' }

interface Props { subsidyType: { id: number; subsidy_name: string; subsidy_year: number } }

export default function ProjectProgressTab({ subsidyType }: Props) {
  const { toast, show } = useToast()
  const projectId = subsidyType.id
  const projectName = `${subsidyType.subsidy_name}（${subsidyType.subsidy_year}年）`

  const [records, setRecords] = useState<ProgressRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'undone' | 'done'>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stageName: string } | null>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const [quickNote, setQuickNote] = useState<string | null>(null)

  const loadRecords = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res: any = await window.electronAPI.invoke('project-progress:get', projectId)
      const all = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
      setRecords(all)
    } catch { show('加载失败', 'err') } finally { setLoading(false) }
  }, [projectId, show])

  useEffect(() => { loadRecords() }, [loadRecords])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (contextRef.current && !contextRef.current.contains(e.target as Node)) setContextMenu(null) }
    document.addEventListener('click', h); return () => document.removeEventListener('click', h)
  }, [])

  // ── 过滤待分配村（无负责人姓名） ──
  const allStages = useMemo(() => {
    const names: string[] = []
    for (const r of records) for (const s of r.stages) { if (!names.includes(s.name)) names.push(s.name) }
    return names
  }, [records])

  const stats = useMemo(() => {
    const valid = records.filter(r => r.person_name && r.person_name.trim())
    let doneCells = 0, totalCells = 0, doneVillages = 0, urgedVillages = 0
    for (const r of valid) {
      const allDone = r.stages.length > 0 && r.stages.every(s => s.status === 'done')
      doneCells += r.stages.filter(s => s.status === 'done').length
      totalCells += r.stages.length
      if (allDone) doneVillages++
      if (r.stages.some(s => s.status === 'urged')) urgedVillages++
    }
    return { doneCells, totalCells, doneVillages, urgedVillages, totalVillages: valid.length }
  }, [records])

  // 过滤：去掉待分配 + 搜索/筛选
  const displayRecords = useMemo(() => records.filter(r => {
    if (!r.person_name || !r.person_name.trim()) return false // 待分配
    if (search && !r.village_name.includes(search) && !r.person_name.includes(search)) return false
    if (statusFilter === 'done' && r.stages.some(s => s.status !== 'done')) return false
    if (statusFilter === 'undone' && r.stages.every(s => s.status === 'done')) return false
    return true
  }), [records, search, statusFilter])

  const unassignedCount = records.length - records.filter(r => r.person_name && r.person_name.trim()).length

  // ── Actions ──
  const saveRec = async (rec: ProgressRecord) => {
    await window.electronAPI.invoke('project-progress:save', { projectId, ...rec })
  }

  const cycleStatus = async (rec: ProgressRecord, stageIdx: number) => {
    const stages = [...rec.stages]
    const cur = stages[stageIdx].status
    const nextIdx = (STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length
    stages[stageIdx] = { ...stages[stageIdx], status: STATUS_CYCLE[nextIdx], date: new Date().toISOString() }
    const updated = { ...rec, stages }
    setRecords(prev => prev.map(p => p.village_id === rec.village_id ? updated : p))
    await saveRec(updated)
  }

  const updatePerson = async (rec: ProgressRecord, field: 'person_name' | 'phone', value: string) => {
    const updated = { ...rec, [field]: value }
    setRecords(prev => prev.map(p => p.village_id === rec.village_id ? updated : p))
    await saveRec(updated)
  }

  const batchSet = async (stageName: string, status: StatusKey) => {
    await window.electronAPI.invoke('project-progress:batch', {
      projectId, action: 'batch_stage', stage_name: stageName, status, date: new Date().toISOString(),
    })
    show(`已将所有「${stageName}」设为${STATUS_CFG[status].label}`); loadRecords()
  }

  const addStage = async () => {
    if (!newStageName.trim()) return
    await window.electronAPI.invoke('project-progress:batch', {
      projectId, action: 'add_stage_to_all',
      stage: { name: newStageName.trim(), status: 'none', date: '', note: '' },
    })
    show('已添加'); setNewStageName(''); loadRecords()
  }

  const deleteStage = async (stageName: string) => {
    if (!confirm(`删除阶段「${stageName}」？`)) return
    await window.electronAPI.invoke('project-progress:deleteStage', { projectId, stage_name: stageName })
    show('已删除'); loadRecords()
  }

  const swapStages = async (a: number, b: number) => {
    if (a === b) return
    await window.electronAPI.invoke('project-progress:batch', {
      projectId, action: 'swap_stages', stage_a: allStages[a], stage_b: allStages[b],
    })
    loadRecords()
  }

  const initAll = async () => {
    await window.electronAPI.invoke('project-progress:batch', { projectId, action: 'init' })
    show('已初始化'); loadRecords()
  }
  const syncLeaders = async () => {
    const res: any = await window.electronAPI.invoke('project-progress:batch', { projectId, action: 'sync_leaders' })
    const data = res?.data ?? res
    show(data.updated > 0 ? `✓ 已同步 ${data.updated} 个` : '已是最新')
    loadRecords()
  }

  const copySummary = async (stageName: string) => {
    const groups: Record<string, string[]> = {}
    for (const r of displayRecords) {
      const s = r.stages.find(st => st.name === stageName)
      const k = s ? STATUS_CFG[s.status].label : '无此阶段'; (groups[k] ??= []).push(r.village_name)
    }
    const text = [`${projectName} · ${stageName}`, ...Object.entries(groups).map(([k, v]) => `${k}：${v.join('、')}`)].join('\n')
    try { await navigator.clipboard.writeText(text); show('✓ 已复制') } catch { show('复制失败', 'err') }
  }

  const exportExcel = () => {
    const headers = ['村名', '负责人', '电话', ...allStages]
    const aoa: any[][] = []
    const hdrStyle = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: 'F5F0EB' } }, border: { bottom: { style: 'medium', color: { rgb: 'D1C7BD' } } }, alignment: { horizontal: 'center', vertical: 'center' } }
    aoa.push(headers.map(h => ({ v: h, s: hdrStyle })))
    for (const rec of displayRecords) {
      const row: any[] = [
        { v: rec.village_name, s: { font: { bold: true, sz: 10.5 }, alignment: { vertical: 'center' } } },
        { v: rec.person_name || '', s: { font: { sz: 10 }, alignment: { vertical: 'center' } } },
        { v: rec.phone || '', s: { font: { sz: 10 }, alignment: { vertical: 'center' } } },
      ]
      for (const sn of allStages) {
        const s = rec.stages.find(st => st.name === sn); const sk = s?.status || 'none'; const cfg = STATUS_CFG[sk]
        const text = s ? `${cfg.label}${s.date ? ' ' + fmtDate(s.date) : ''}` : '-'
        const cs: any = { font: { sz: 9.5 }, alignment: { horizontal: 'center', vertical: 'center' } }
        if (sk === 'done') { cs.fill = { fgColor: { rgb: 'C6EFCE' } }; cs.font.color = { rgb: '2D5A3D' } }
        else if (sk === 'urged') { cs.fill = { fgColor: { rgb: 'FFC7CE' } }; cs.font.color = { rgb: '9C0006' } }
        else if (sk === 'reminded') { cs.fill = { fgColor: { rgb: 'FFEBC8' } } }
        row.push({ v: text, s: cs })
      }
      aoa.push(row)
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = headers.map((_, i) => i === 0 ? { wch: 14 } : i === 1 ? { wch: 8 } : i === 2 ? { wch: 14 } : { wch: 16 })
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '项目进度')
    XLSX.writeFile(wb, `${projectName}.xlsx`); show('✓ 已导出')
  }

  // ── 展开/收起 ──
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggle = (id: number) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading) return <div className="text-center py-12 text-text-muted"><span className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin inline-block mr-2" />加载中…</div>

  return (
    <div className="max-w-full relative">
      {/* ═══════ 顶部总览 ═══════ */}
      <div className="bg-white border border-border rounded-card p-4 mb-4 shadow-sm">
        <div className="flex items-center gap-5 flex-wrap">
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="22" fill="none" stroke="#f0ebe1" strokeWidth="5" />
            <circle cx="26" cy="26" r="22" fill="none" stroke={stats.totalCells > 0 && stats.doneCells === stats.totalCells ? '#5ebd9a' : '#1A4D3A'}
              strokeWidth="5" strokeLinecap="round" strokeDasharray={`${2*Math.PI*22}`}
              strokeDashoffset={`${2*Math.PI*22*(1-(stats.totalCells>0?stats.doneCells/stats.totalCells:0))}`}
              transform="rotate(-90 26 26)" style={{transition:'stroke-dashoffset .6s ease'}} />
            <text x="26" y="30" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#1A4D3A">
              {stats.totalCells>0?Math.round(stats.doneCells/stats.totalCells*100):0}%
            </text>
          </svg>
          <div className="flex gap-3">
            {[
              {l:'完成村',v:`${stats.doneVillages}/${stats.totalVillages}`,c:'text-emerald-600',bg:'bg-emerald-50'},
              {l:'进行中',v:stats.totalVillages-stats.doneVillages,c:'text-amber-600',bg:'bg-amber-50'},
              {l:'已催缴',v:stats.urgedVillages,c:'text-red-600',bg:'bg-red-50'},
            ].map(c=>(
              <div key={c.l} className={`${c.bg} rounded-card px-3 py-2 text-center min-w-[64px]`}>
                <div className={`text-lg font-bold ${c.c}`}>{c.v}</div>
                <div className="text-[11px] text-text-muted">{c.l}</div>
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-[160px]">
            <div className="flex justify-between mb-1"><span className="text-xs text-text-muted">总体进度</span>
              <span className="text-xs font-mono font-bold text-primary">{stats.totalCells>0?Math.round(stats.doneCells/stats.totalCells*100):0}%</span></div>
            <div className="h-2.5 bg-warm/30 rounded-full overflow-hidden flex">
              {Object.entries(STATUS_CFG).map(([k,cfg],i)=>{
                const cnt = records.filter(r=>r.person_name?.trim()).reduce((s,r)=>s+r.stages.filter(st=>st.status===(Object.keys(STATUS_CFG) as StatusKey[])[i]).length,0)
                return cnt>0?<div key={i} className="h-full transition-all duration-500" style={{width:`${cnt/Math.max(1,stats.totalCells)*100}%`,backgroundColor:cfg.color}}/>:null
              })}
            </div>
          </div>
          {unassignedCount > 0 && (
            <span className="text-xs text-text-muted/50">{unassignedCount} 村待分配（已隐藏）</span>
          )}
        </div>
      </div>

      {/* ═══════ 工具栏 ═══════ */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 搜索村名/负责人…"
          className="border border-border rounded-btn px-3 py-1.5 text-xs outline-none focus:border-primary-500 bg-white w-44" />
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as any)}
          className="border border-border rounded-btn px-2 py-1.5 text-xs outline-none bg-white">
          <option value="all">全部</option><option value="undone">有未完成</option><option value="done">全部完成</option>
        </select>
        <button onClick={()=>setDrawerOpen(true)} className="px-3 py-1.5 text-xs border border-primary-500/30 text-primary rounded-btn hover:bg-primary-500/5 font-medium">⚙ 阶段管理</button>
        <button onClick={initAll} className="px-3 py-1.5 text-xs border border-border rounded-btn hover:bg-warm/30">🔄 初始化</button>
        <button onClick={syncLeaders} className="px-3 py-1.5 text-xs border border-amber-200 text-amber-700 rounded-btn hover:bg-amber-50">👤 同步</button>
        <button onClick={exportExcel} className="px-3 py-1.5 text-xs border border-green-200 text-green-700 rounded-btn hover:bg-green-50">📥 导出</button>
        <span className="ml-auto text-xs text-text-muted">{displayRecords.length} 村</span>
      </div>

      {/* ═══════ 村卡片列表 ═══════ */}
      {records.length===0 ? (
        <div className="text-center py-16 text-text-muted text-sm">暂无进度记录，<button onClick={initAll} className="text-primary underline">点击初始化</button></div>
      ) : displayRecords.length===0 ? (
        <div className="text-center py-16 text-text-muted text-sm">无匹配村庄</div>
      ) : (
        <div className="space-y-2">
          {displayRecords.map(rec => {
            const doneCount = rec.stages.filter(s=>s.status==='done').length
            const totalStages = rec.stages.length
            const pct = totalStages>0?Math.round(doneCount/totalStages*100):0
            const allDone = totalStages>0 && doneCount===totalStages
            const isOpen = expanded.has(rec.village_id)

            return (
              <div key={rec.village_id} className={`bg-white border rounded-card shadow-sm transition-all ${allDone?'bg-emerald-50/20 border-emerald-200/50':''} ${isOpen?'border-primary-500/30':''}`}>
                {/* ── 折叠行（标题栏）── */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" onClick={()=>toggle(rec.village_id)}>
                  <span className={`text-text-muted/50 text-xs transition-transform ${isOpen?'rotate-90':''}`}>▶</span>
                  <span className={`font-semibold text-sm flex-1 ${allDone?'text-emerald-700':''}`}>{rec.village_name}{allDone&&<span className="ml-1.5 text-emerald-500 text-xs">✓</span>}</span>
                  <EditableBadge value={rec.person_name||'—'} onChange={v=>updatePerson(rec,'person_name',v)} placeholder="负责人" />
                  <EditableBadge value={rec.phone||'—'} onChange={v=>updatePerson(rec,'phone',v)} placeholder="电话" className="font-mono text-2xs" />
                  {/* 进度条 */}
                  <div className="flex items-center gap-2 min-w-[100px]">
                    <div className="flex-1 h-1.5 bg-warm/30 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${allDone?'bg-emerald-400':'bg-primary-500/60'}`} style={{width:`${pct}%`}}/>
                    </div>
                    <span className={`text-[11px] font-mono font-bold ${allDone?'text-emerald-600':'text-text-muted'}`}>{pct}%</span>
                  </div>
                </div>

                {/* ── 展开：阶段纵向排列 ── */}
                {isOpen && (
                  <div className="border-t border-border/30 px-4 py-3">
                    <div className="space-y-2 ml-6">
                      {allStages.map(sn => {
                        const si = rec.stages.findIndex(s=>s.name===sn)
                        if (si===-1) return null
                        const s = rec.stages[si]; const cfg = STATUS_CFG[s.status]
                        return (
                          <div key={sn} className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all hover:shadow-sm group"
                            style={{backgroundColor:cfg.bg,border:`1px solid ${cfg.color}20`}}
                            onClick={()=>cycleStatus(rec,si)}
                            onContextMenu={e=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,stageName:sn})}}>
                            {/* 状态指示 */}
                            <span className="text-base" title={cfg.label}>{cfg.dot}</span>
                            {/* 阶段名 */}
                            <span className="text-sm font-medium text-text-primary min-w-[80px]">{sn}</span>
                            {/* 状态标签 */}
                            <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{color:cfg.text,backgroundColor:cfg.color+'25'}}>{cfg.label}</span>
                            {/* 日期 */}
                            <span className="text-xs text-text-muted/60 ml-auto">{s.date?fmtDate(s.date):'—'}</span>
                            {/* 备注 */}
                            {quickNote===`${rec.village_id}-${si}` ? (
                              <input autoFocus value="" onChange={e=>{
                                const st=[...rec.stages];st[si]={...st[si],note:e.target.value}
                                setRecords(p=>p.map(x=>x.village_id===rec.village_id?{...rec,stages:st}:x))
                                saveRec({...rec,stages:st});setQuickNote(null)
                              }} onBlur={()=>setQuickNote(null)}
                              className="w-24 border border-border rounded px-1.5 py-0.5 text-[10px] outline-none" placeholder="备注…"/>
                            ):(
                              <span onClick={e=>{e.stopPropagation();setQuickNote(`${rec.village_id}-${si}`)}}
                                className="text-[10px] text-text-muted/30 hover:text-text-muted/60 cursor-pointer ml-2">{s.note||'+备注'}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ═══════ 右键菜单 ═══════ */}
      {contextMenu && (
        <div ref={contextRef} className="fixed z-50 bg-white border border-border rounded-card shadow-xl py-1 min-w-[180px]" style={{left:contextMenu.x,top:contextMenu.y}}>
          <div className="px-3 py-1.5 text-[11px] text-text-muted border-b border-border/30 font-semibold">「{contextMenu.stageName}」批量操作</div>
          {STATUS_ORDER.map(st=>(
            <button key={st} onClick={()=>{batchSet(contextMenu.stageName,st);setContextMenu(null)}}
              className="w-full text-left px-3 py-2 text-xs hover:bg-warm/30 flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm" style={{backgroundColor:STATUS_CFG[st].color}}/>全部设为 {STATUS_CFG[st].label}
            </button>
          ))}
          <hr className="border-border/30"/>
          <button onClick={()=>{copySummary(contextMenu.stageName);setContextMenu(null)}} className="w-full text-left px-3 py-2 text-xs hover:bg-warm/30">📋 复制进度</button>
          <button onClick={()=>{deleteStage(contextMenu.stageName);setContextMenu(null)}} className="w-full text-left px-3 py-2 text-xs hover:bg-warm/30 text-red-500">🗑 删除此阶段</button>
        </div>
      )}

      {/* ═══════ 侧边抽屉：阶段管理 ═══════ */}
      {drawerOpen && (<>
        <div className="fixed inset-0 bg-black/20 z-40" onClick={()=>setDrawerOpen(false)}/>
        <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="font-bold text-text-primary">⚙ 阶段管理</h3>
            <button onClick={()=>setDrawerOpen(false)} className="text-text-muted hover:text-text-primary text-lg">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {allStages.map((sn,i)=>{
              const done=displayRecords.filter(r=>r.stages.find(s=>s.name===sn&&s.status==='done')).length
              const total=displayRecords.filter(r=>r.stages.some(s=>s.name===sn)).length
              const allDone=total>0&&done===total
              return (
                <div key={sn}
                  draggable
                  onDragStart={e=>{e.dataTransfer.setData('text/plain',String(i));e.currentTarget.classList.add('opacity-40')}}
                  onDragEnd={e=>{e.currentTarget.classList.remove('opacity-40')}}
                  onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('ring-2','ring-primary/30')}}
                  onDragLeave={e=>{e.currentTarget.classList.remove('ring-2','ring-primary/30')}}
                  onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove('ring-2','ring-primary/30');const from=Number(e.dataTransfer.getData('text/plain'));swapStages(from,i)}}
                  className="border-2 border-border hover:border-primary-500/30 rounded-card p-3 bg-white cursor-move transition-all shadow-sm hover:shadow-md">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-text-muted/30 text-xs cursor-grab select-none" title="拖动排序">⠿</span>
                    <span className="text-xs font-semibold flex-1">{sn}</span>
                    <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${allDone?'bg-emerald-100 text-emerald-700':'bg-warm/30 text-text-muted'}`}>{done}/{total}</span>
                  </div>
                  <div className="h-2 bg-warm/30 rounded-full overflow-hidden mb-2">
                    <div className={`h-full rounded-full ${allDone?'bg-emerald-400':'bg-primary-500/60'}`} style={{width:`${total>0?Math.round(done/total*100):0}%`}}/>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {STATUS_ORDER.map(st=>(
                      <button key={st} onClick={(e)=>{e.stopPropagation();batchSet(sn,st)}} className="px-2 py-0.5 text-[10px] font-bold rounded border"
                        style={{backgroundColor:STATUS_CFG[st].bg,borderColor:STATUS_CFG[st].color+'40',color:STATUS_CFG[st].text}}>{STATUS_CFG[st].label}</button>
                    ))}
                    <button onClick={(e)=>{e.stopPropagation();copySummary(sn)}} className="px-2 py-0.5 text-[10px] border border-border rounded text-text-muted">📋</button>
                    <button onClick={(e)=>{e.stopPropagation();deleteStage(sn)}} className="px-2 py-0.5 text-[10px] border border-red-200 rounded text-red-500">🗑</button>
                  </div>
                </div>
              )
            })}
            <div className="border-2 border-dashed border-border rounded-card p-3">
              <div className="flex gap-2">
                <input value={newStageName} onChange={e=>setNewStageName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addStage()}
                  placeholder="新阶段名称" className="flex-1 border border-border rounded-btn px-2 py-1.5 text-xs outline-none"/>
                <button onClick={addStage} className="px-3 py-1.5 text-xs bg-primary-500 text-white rounded-btn font-medium">+添加</button>
              </div>
            </div>
          </div>
        </div>
      </>)}

      <Toast {...toast} />
    </div>
  )
}

/** 行内可编辑文字 */
function EditableBadge({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => Promise<void>; placeholder: string; className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  if (!editing) {
    return <span onClick={e => { e.stopPropagation(); setVal(value); setEditing(true) }}
      className={`cursor-pointer hover:text-primary-500 text-xs ${className||''}`}>{value||placeholder}</span>
  }
  return (
    <input value={val} onChange={e => setVal(e.target.value)} autoFocus
      onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Enter') { onChange(val); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
      onBlur={() => { onChange(val); setEditing(false) }}
      className={`border border-border rounded px-1.5 py-0.5 text-xs outline-none focus:border-primary-500 w-24 ${className||''}`}
      placeholder={placeholder} />
  )
}
