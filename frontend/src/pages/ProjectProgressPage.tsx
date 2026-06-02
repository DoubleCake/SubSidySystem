/**
 * 补贴项目进度跟踪页 — 卡片化视图，每村一行可展开/收起
 * 收起：每阶段颜色标志
 * 展开：阶段卡片，可切换状态、编辑备注
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface StageItem {
  name: string
  status: 'none' | 'in_progress' | 'done' | 'reminded' | 'urged'
  date: string
  note: string
}

interface ProgressRecord {
  id?: number
  subsidy_type_id: number
  village_id: number
  village_name: string
  person_name: string
  phone: string
  stages: StageItem[]
  note: string
  updated_at: string
}

const STATUS_CFG: Record<string, { label: string; square: string; pillBg: string; pillText: string; border: string; dot: string }> = {
  none:        { label: '未开始', square: '#c2c3c5', pillBg: '#e8e8e8', pillText: '#6b6b6b', border: 'border-gray-200', dot: '○' },
  in_progress: { label: '进行中', square: '#f4c076', pillBg: '#f9f0d6', pillText: '#6a5f44', border: 'border-amber-200', dot: '◐' },
  done:        { label: '已完成', square: '#5EBd9A', pillBg: '#def1e6', pillText: '#457557', border: 'border-emerald-300', dot: '●' },
  reminded:    { label: '已提醒', square: '#f09c78', pillBg: '#fbe3df', pillText: '#d56652', border: 'border-orange-200', dot: '△' },
  urged:       { label: '已催缴', square: '#e07060', pillBg: '#fbe3df', pillText: '#b83a2a', border: 'border-red-300', dot: '▲' },
}

const STATUS_ORDER: StageItem['status'][] = ['none', 'in_progress', 'done', 'reminded', 'urged']

function fmtDate(iso: string) { return iso ? iso.slice(0, 10) : '' }

export default function ProjectProgressPage() {
  const { toast, show } = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlProjectId = Number(searchParams.get('subsidy_type_id')) || null

  const [projectId, setProjectId] = useState<number | null>(urlProjectId)
  const [projectList, setProjectList] = useState<{ id: number; subsidy_name: string; subsidy_year: number }[]>([])
  const [projectName, setProjectName] = useState('')
  const [records, setRecords] = useState<ProgressRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [searchVillage, setSearchVillage] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'undone' | 'done'>('all')

  // 展开收起
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set())

  // 阶段备注编辑弹窗
  const [editNoteModal, setEditNoteModal] = useState<{
    villageId: number
    stageIdx: number
    note: string
  } | null>(null)

  // 阶段卡片状态切换下拉
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 拖拽排序
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  // 批量设置下拉
  const [batchCol, setBatchCol] = useState<string | null>(null)
  const batchRef = useRef<HTMLDivElement>(null)


  useEffect(() => {
    fetch('/api/subsidies/types')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : []
        setProjectList(list)
        if (projectId) {
          const p = list.find((t: any) => t.id === projectId)
          setProjectName(p ? `${p.subsidy_name}（${p.subsidy_year}年）` : `项目 #${projectId}`)
        } else if (list.length > 0) {
          setProjectId(list[0].id)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (projectId && projectList.length > 0) {
      const p = projectList.find(t => t.id === projectId)
      setProjectName(p ? `${p.subsidy_name}（${p.subsidy_year}年）` : `项目 #${projectId}`)
    }
  }, [projectId, projectList])

  const loadRecords = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const r = await fetch(`/api/project-progress/${projectId}`).then(r => r.json())
      setRecords(Array.isArray(r) ? r : [])
    } catch { show('加载失败', 'err') }
    finally { setLoading(false) }
  }, [projectId, show])

  useEffect(() => { loadRecords() }, [loadRecords])

  // 点击外部关闭下拉
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpenDropdown(null)
      if (batchRef.current && !batchRef.current.contains(e.target as Node)) setBatchCol(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggleExpand = (villageId: number) => {
    setExpandedSet(prev => {
      const next = new Set(prev)
      if (next.has(villageId)) next.delete(villageId)
      else next.add(villageId)
      return next
    })
  }

  const saveRec = async (rec: ProgressRecord) => {
    await fetch(`/api/project-progress/${projectId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec),
    })
  }

  const initAllVillages = async () => {
    if (!projectId) return
    await fetch(`/api/project-progress/${projectId}/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'init' }),
    })
    show('已初始化所有村'); loadRecords()
  }

  const syncLeaders = async () => {
    if (!projectId) return
    const res = await fetch(`/api/project-progress/${projectId}/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync_leaders' }),
    }).then(r => r.json())
    if (res.updated > 0) show(`✓ 已同步 ${res.updated} 个村的负责人信息`)
    else show('所有村负责人已是最新，无需同步')
    loadRecords()
  }

  const setStageStatus = async (rec: ProgressRecord, stageIdx: number, status: StageItem['status']) => {
    const stages = [...rec.stages]
    stages[stageIdx] = { ...stages[stageIdx], status, date: new Date().toISOString().slice(0, 10) }
    const updated = { ...rec, stages }
    setRecords(prev => prev.map(p => p.village_id === rec.village_id ? updated : p))
    await saveRec(updated)
    setOpenDropdown(null)
  }

  const updateNote = async (rec: ProgressRecord, stageIdx: number, note: string) => {
    const stages = [...rec.stages]
    stages[stageIdx] = { ...stages[stageIdx], note }
    const updated = { ...rec, stages }
    setRecords(prev => prev.map(p => p.village_id === rec.village_id ? updated : p))
    await saveRec(updated)
  }

  const addStageToAll = async () => {
    if (!newStageName.trim() || !projectId) return
    await fetch(`/api/project-progress/${projectId}/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_stage_to_all', stage: { name: newStageName.trim(), status: 'none', date: '', note: '' } }),
    })
    show('已为所有村添加阶段'); setNewStageName(''); loadRecords()
  }

  const batchSetStageStatus = async (stageName: string, status: StageItem['status']) => {
    if (!projectId) return
    const now = new Date().toISOString().slice(0, 10)
    await fetch(`/api/project-progress/${projectId}/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch_stage', stage_name: stageName, status, date: now }),
    })
    show(`已将所有村「${stageName}」设为${STATUS_CFG[status].label}`)
    setBatchCol(null)
    loadRecords()
  }

  // ─── 拖拽排序 ───
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropIdx(idx)
  }
  const handleDragLeave = () => { setDropIdx(null) }
  const handleDrop = async (e: React.DragEvent, toIdx: number) => {
    e.preventDefault()
    const fromIdx = dragIdx
    if (fromIdx === null || fromIdx === toIdx) { setDragIdx(null); setDropIdx(null); return }
    // 交换 allStages 中 fromIdx 和 toIdx 的名字
    const nameA = allStages[fromIdx]
    const nameB = allStages[toIdx]
    if (!nameA || !nameB) { setDragIdx(null); setDropIdx(null); return }
    await fetch(`/api/project-progress/${projectId}/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'swap_stages', stage_a: nameA, stage_b: nameB }),
    })
    setDragIdx(null)
    setDropIdx(null)
    loadRecords()
  }
  const handleDragEnd = () => { setDragIdx(null); setDropIdx(null) }

  const exportExcel = () => {
    const headers = ['村名', '负责人', '电话', ...allStages]
    const data = filtered.map(rec => {
      const row: Record<string, string> = { '村名': rec.village_name, '负责人': rec.person_name, '电话': rec.phone }
      allStages.forEach(sn => {
        const s = rec.stages.find(st => st.name === sn)
        row[sn] = s ? `${STATUS_CFG[s.status].label}${s.date ? ' ' + s.date : ''}${s.note ? ' ' + s.note : ''}` : '-'
      })
      return row
    })
    const ws = XLSX.utils.json_to_sheet(data, { header: headers })
    ws['!cols'] = headers.map(h => ({ wch: h === '村名' ? 14 : h === '备注' ? 30 : 12 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '项目进度')
    XLSX.writeFile(wb, `${projectName || '进度表'}.xlsx`)
  }

  // ─── 一键复制阶段完成情况 ───
  const copyStageSummary = async (stageName: string) => {
    // 按状态分组：{ '已完成': ['村1', '村2'], '进行中': ['村3'], ... }
    const groups: Record<string, string[]> = {}
    for (const rec of filtered) {
      const s = rec.stages.find(st => st.name === stageName)
      const label = s ? STATUS_CFG[s.status].label : '无此阶段'
      if (!groups[label]) groups[label] = []
      groups[label].push(rec.village_name)
    }
    const order = ['已完成', '已提醒', '已催缴', '进行中', '未开始']
    const lines: string[] = [`${projectName || ''} · ${stageName}`.trim()]
    for (const label of order) {
      if (groups[label]?.length) {
        lines.push(`${label}：${groups[label].join('、')}`)
      }
    }
    // 处理不在 order 中的其他状态
    for (const [label, villages] of Object.entries(groups)) {
      if (!order.includes(label)) lines.push(`${label}：${villages.join('、')}`)
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      show(`✓ 已复制「${stageName}」进度到剪贴板`)
    } catch {
      show('复制失败', 'err')
    }
  }

  const allStages: string[] = []
  for (const r of records) for (const s of r.stages) { if (!allStages.includes(s.name)) allStages.push(s.name) }

  const stageStats: Record<string, { done: number; total: number }> = {}
  for (const sn of allStages) {
    let done = 0, total = 0
    for (const r of records) { const s = r.stages.find(st => st.name === sn); if (s) { total++; if (s.status === 'done') done++ } }
    stageStats[sn] = { done, total }
  }

  const totalDone = Object.values(stageStats).reduce((s, v) => s + v.done, 0)
  const totalCells = Object.values(stageStats).reduce((s, v) => s + v.total, 0)

  const filtered = records.filter(r => {
    if (searchVillage && !r.village_name.includes(searchVillage)) return false
    if (statusFilter === 'done' && r.stages.some(s => s.status !== 'done')) return false
    if (statusFilter === 'undone' && r.stages.every(s => s.status === 'done')) return false
    return true
  })

  return (
    <div className="p-4 max-w-full mx-auto">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-text-muted hover:text-text-primary">← 返回</button>
        <h1 className="text-lg font-bold">📋 {projectName || '项目进度'}</h1>
      </div>

      {/* 操作栏 */}
      <div className="bg-white border border-border rounded-card p-3 mb-3 flex items-center gap-3 flex-wrap shadow-sm">
        <select value={projectId ?? ''} onChange={e => setProjectId(Number(e.target.value))}
          className="border border-border rounded-btn px-2 py-1.5 text-[11px] outline-none bg-white">
          {projectList.map(p => (
            <option key={p.id} value={p.id}>{p.subsidy_name}（{p.subsidy_year}年）</option>
          ))}
        </select>
        <button onClick={initAllVillages} className="px-3 py-1.5 text-xs border border-border rounded-btn hover:bg-warm/30">🔄 初始化全部村</button>
        <button onClick={syncLeaders} className="px-3 py-1.5 text-xs border border-amber-200 text-amber-700 rounded-btn hover:bg-amber-50">👤 同步负责人</button>
        <div className="w-px h-6 bg-border" />
        <input value={searchVillage} onChange={e => setSearchVillage(e.target.value)} placeholder="🔍 搜索村名…"
          className="border border-border rounded-btn px-2 py-1 text-[11px] outline-none w-32" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
          className="border border-border rounded-btn px-2 py-1 text-[11px] outline-none">
          <option value="all">全部状态</option><option value="undone">有未完成</option><option value="done">全部完成</option>
        </select>
        <div className="w-px h-6 bg-border" />
        <button onClick={exportExcel} className="px-3 py-1.5 text-xs border border-green-200 text-green-700 rounded-btn hover:bg-green-50">📥 导出 Excel</button>
        <span className="text-xs text-text-muted">{filtered.length !== records.length ? `${filtered.length}/${records.length}` : records.length} 村</span>
        {(searchVillage || statusFilter !== 'all') && (
          <button onClick={() => { setSearchVillage(''); setStatusFilter('all') }} className="text-xs text-blue-500">清除筛选</button>
        )}
        {allStages.length > 0 && (
          <>
            <span className="relative">
              <button onClick={() => setBatchCol(batchCol ? null : '___all___')}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-all duration-200
                  ${batchCol === '___all___'
                    ? 'bg-orange-600 text-white border-orange-600 shadow ring-2 ring-orange-300 ring-offset-1'
                    : 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600 hover:border-orange-600 hover:shadow active:scale-95'}`}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-md bg-white/20 text-[10px] mr-1">⊞</span>
                阶段状态管理
              </button>
              {batchCol === '___all___' && (
                <div ref={batchRef}
                  className="absolute top-full left-0 mt-1.5 z-50 bg-white border border-border rounded-card shadow-xl py-2 min-w-[520px] overflow-hidden"
                  onClick={e => e.stopPropagation()}>
                  <div className="px-4 py-2 text-xs text-text-muted border-b border-border/30 flex items-center justify-between">
                    <span>⠿ 拖动排序 · 点击按钮批量设置状态 · 📋 复制进度</span>
                    <button onClick={() => setBatchCol(null)} className="text-text-muted/40 hover:text-text-primary">✕</button>
                  </div>
                  {allStages.map((sn, i) => {
                    const st = stageStats[sn]
                    const allDone = st.done === st.total && st.total > 0
                    return (
                      <div key={sn}
                        draggable
                        onDragStart={e => handleDragStart(e, i)}
                        onDragOver={e => handleDragOver(e, i)}
                        onDragLeave={handleDragLeave}
                        onDrop={e => handleDrop(e, i)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-0
                          ${dragIdx === i ? 'opacity-40' : ''}
                          ${dropIdx === i && dragIdx !== null && dropIdx !== dragIdx ? 'bg-primary/5 ring-1 ring-primary/30' : ''}
                          hover:bg-warm/20 transition-all`}>
                        <span className="text-text-muted/20 cursor-grab select-none text-xs" title="拖拽排序">⠿</span>
                        <div className="min-w-[80px]">
                          <span className="text-xs font-semibold text-text-primary">{sn}</span>
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 h-2 bg-warm/30 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${allDone ? 'bg-emerald-400' : 'bg-primary/50'}`}
                              style={{ width: st.total > 0 ? Math.round(st.done / st.total * 100) + '%' : '0%' }} />
                          </div>
                          <span className={`font-mono font-bold text-[11px] min-w-[36px] text-right ${allDone ? 'text-emerald-600' : 'text-text-muted'}`}>
                            {st.done}/{st.total}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {STATUS_ORDER.map(stt => {
                            const cfg = STATUS_CFG[stt]
                            const lightBg = stt === 'none' || stt === 'in_progress' || stt === 'reminded'
                            return (
                              <button key={stt}
                                onClick={() => batchSetStageStatus(sn, stt)}
                                className="px-2 py-0.5 text-[9px] font-bold rounded border transition-all duration-150 hover:shadow-md hover:scale-110 active:scale-90"
                                style={{
                                  backgroundColor: cfg.square,
                                  borderColor: cfg.square,
                                  color: lightBg ? '#374151' : '#ffffff',
                                }}
                                title={`全部设为${cfg.label}`}>
                                {cfg.label}
                              </button>
                            )
                          })}
                        </div>
                        <button onClick={() => copyStageSummary(sn)}
                          className="shrink-0 px-2 py-1 text-[10px] border border-border rounded-btn text-text-muted hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
                          title="复制完成情况到剪贴板">
                          📋 复制
                        </button>
                      </div>
                    )
                  })}
                  {/* 添加新阶段 */}
                  <div className="flex items-center gap-2 px-4 py-3 border-t border-border/30 bg-warm/10">
                    <span className="text-xs text-text-muted">＋ 添加阶段：</span>
                    <input value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder="新阶段名称"
                      className="flex-1 border border-border rounded-btn px-2 py-1 text-[11px] outline-none" />
                    <button onClick={addStageToAll} className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary/90 font-medium">添加</button>
                  </div>
                </div>
              )}
            </span>
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <span className="font-medium">总进度</span>
              <div className="w-20 h-2 bg-warm/30 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: Math.round(totalDone / Math.max(1, totalCells) * 100) + '%' }} />
              </div>
              <span className="font-mono font-bold text-emerald-600">{totalDone}/{totalCells}</span>
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-center text-text-muted py-8">加载中…</div>
      ) : !projectId ? (
        <div className="text-center text-text-muted py-16 text-sm">请在补贴项目页面点击"管理进度"进入</div>
      ) : records.length === 0 ? (
        <div className="text-center text-text-muted py-16 text-sm">暂无该项目的进度记录，<button onClick={initAllVillages} className="text-primary underline ml-1">点击初始化全部村</button></div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-text-muted py-16 text-sm">没有匹配的村，<button onClick={() => { setSearchVillage(''); setStatusFilter('all') }} className="text-primary underline ml-1">清除筛选</button></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(rec => {
            const isExpanded = expandedSet.has(rec.village_id)
            const allDone = rec.stages.every(s => s.status === 'done')
            const hasUrged = rec.stages.some(s => s.status === 'urged')

            return (
              <div key={rec.village_id}
                className={`bg-white border rounded-card shadow-sm transition-all ${
                  isExpanded ? 'border-primary/30' : 'border-border hover:border-primary/20'
                } ${allDone ? 'bg-emerald-50/20' : ''} ${hasUrged ? 'ring-1 ring-amber-400' : ''}`}>
                {/* ── 收起行 ── */}
                <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
                  onClick={() => toggleExpand(rec.village_id)}>
                  {/* 展开箭头 */}
                  <span className={`text-text-muted/50 text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                  {/* 村名 */}
                  <div className="min-w-[100px]">
                    <span className={`font-semibold text-sm ${allDone ? 'text-emerald-700' : 'text-text-primary'}`}>
                      {rec.village_name}
                    </span>
                    {allDone && <span className="ml-1.5 text-emerald-500 text-xs">✓</span>}
                  </div>
                  {/* 负责人 */}
                  <div className="text-xs text-text-muted/60 min-w-[120px]">
                    <EditablePerson rec={rec} villageId={rec.village_id} setRecords={setRecords} saveRec={saveRec} />
                  </div>
                  {/* 阶段状态指示器 - 颜色点 */}
                  <div className="flex items-center gap-1.5 flex-1">
                    {allStages.map(sn => {
                      const s = rec.stages.find(st => st.name === sn)
                      const cfg = s ? STATUS_CFG[s.status] : STATUS_CFG.none
                      return (
                        <div key={sn} className="flex items-center gap-1 group/tip relative"
                          title={`${sn}: ${cfg.label}${s?.note ? ' — ' + s.note : ''}`}>
                          <span className="w-3 h-3 rounded-sm inline-block"
                            style={{ backgroundColor: cfg.square }} />
                          <span className="text-text-muted/40 text-[10px] hidden sm:inline">{sn}</span>
                          {/* tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/tip:block z-10
                            bg-gray-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap shadow-lg pointer-events-none">
                            {sn}: {cfg.label}{s?.date ? ` (${fmtDate(s.date)})` : ''}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {/* 全部完成标记 */}
                  <div className="text-right text-xs font-mono text-text-muted/40 whitespace-nowrap">
                    {rec.stages.filter(s => s.status === 'done').length}/{rec.stages.length}
                  </div>
                </div>

                {/* ── 展开：阶段卡片 ── */}
                {isExpanded && (
                  <div className="border-t border-border/50 px-3 py-2.5">

                    {/* 阶段卡片网格 */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                      {allStages.map(sn => {
                        const si = rec.stages.findIndex(s => s.name === sn)
                        if (si === -1) return null
                        const s = rec.stages[si]
                        const cfg = STATUS_CFG[s.status]
                        const ddKey = `${rec.village_id}-${si}`

                        return (
                          <div key={sn}
                            className="rounded-lg p-2.5 transition-all hover:shadow-sm group/card"
                            style={{ backgroundImage: 'url(/images/progress_change.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                            {/* 阶段名 + 日期 */}
                            <div className="flex items-center gap-1.5 mb-2">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.square }} />
                              <span className="text-xs font-semibold text-text-primary truncate">{sn}</span>
                            </div>

                            {/* 状态切换 */}
                            <div className="relative">
                              <button
                                onClick={() => setOpenDropdown(openDropdown === ddKey ? null : ddKey)}
                                className="w-[85%]  px-2 py-1 rounded-md text-[11px] font-semibold border flex items-center justify-center gap-1.5 hover:brightness-95 transition-all"
                                style={{ backgroundImage: 'url(/images/stateChange.png)', backgroundSize: 'cover', backgroundPosition: 'center', color: cfg.pillText, borderColor: cfg.square + '40' }}>
                                <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: cfg.square }} />
                                <span>{cfg.label}</span>
                                <span className="ml-auto text-text-muted/40 text-[10px]  ml-[15%]">▾</span>
                              </button>
                              {openDropdown === ddKey && (
                                <div ref={dropdownRef}
                                  className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-border rounded-lg shadow-lg py-0.5 overflow-hidden"
                                  >
                                  {STATUS_ORDER.map(st => {
                                    const c = STATUS_CFG[st]
                                    return (
                                      <button key={st}
                                        onClick={() => setStageStatus(rec, si, st)}
                                        className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-warm/30 ${st === s.status ? 'font-bold' : ''}`}>
                                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: c.square }} />
                                        {c.label}
                                        {st === s.status && <span className="ml-auto text-primary text-[10px]">✓</span>}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>

                            {/* 时间戳 */}
                            <div className="mt-1.5 text-[10px] text-text-muted/40 text-right">
                              {s.date ? fmtDate(s.date) : '—'}
                            </div>

                            {/* 备注 */}
                            <div className="mt-0.5">
                              {editNoteModal?.villageId === rec.village_id && editNoteModal?.stageIdx === si ? (
                                <input autoFocus
                                  value={editNoteModal.note}
                                  onChange={e => setEditNoteModal(p => p ? { ...p, note: e.target.value } : null)}
                                  onBlur={() => {
                                    if (editNoteModal) {
                                      updateNote(rec, si, editNoteModal.note)
                                      setEditNoteModal(null)
                                    }
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      updateNote(rec, si, (e.target as HTMLInputElement).value)
                                      setEditNoteModal(null)
                                    }
                                  }}
                                  placeholder="备注…"
                                  className="w-full border border-border rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-primary bg-white" />
                              ) : (
                                <div
                                  onClick={() => setEditNoteModal({ villageId: rec.village_id, stageIdx: si, note: s.note || '' })}
                                  className="px-1.5 py-0.5 rounded cursor-text border border-transparent hover:border-border/50 text-text-muted/50 text-[10px] min-h-[20px]">
                                  {s.note || <span className="italic opacity-30">备注…</span>}
                                </div>
                              )}
                            </div>
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

      <Toast {...toast} />
    </div>
  )
}

/** 行内可编辑的负责人信息 */
function EditablePerson({
  rec, villageId, setRecords, saveRec
}: {
  rec: ProgressRecord
  villageId: number
  setRecords: (fn: (prev: ProgressRecord[]) => ProgressRecord[]) => void
  saveRec: (rec: ProgressRecord) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(rec.person_name)
  const [phone, setPhone] = useState(rec.phone)

  if (!editing) {
    return (
      <span onClick={() => { setName(rec.person_name); setPhone(rec.phone); setEditing(true) }}
        className="cursor-pointer hover:text-text-primary">
        {rec.person_name || '—'}
        {rec.phone && <> · {rec.phone}</>}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input value={name} onChange={e => setName(e.target.value)}
        className="w-16 border border-border rounded px-1 py-0.5 text-[11px] outline-none" placeholder="姓名" />
      <input value={phone} onChange={e => setPhone(e.target.value)}
        className="w-20 border border-border rounded px-1 py-0.5 text-[11px] outline-none" placeholder="电话" />
      <button onClick={async() => {
        const updated = { ...rec, person_name: name, phone }
        setRecords(prev => prev.map(p => p.village_id === villageId ? updated : p))
        setEditing(false)
        await saveRec(updated)
      }} className="text-primary text-xs">✓</button>
      <button onClick={() => setEditing(false)} className="text-text-muted text-xs">✕</button>
    </div>
  )
}
