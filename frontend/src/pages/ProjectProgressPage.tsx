/**
 * 补贴项目进度跟踪页 — 矩阵视图，行=村，列=阶段
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

const STATUS_CFG: Record<string, { label: string; cellBg: string; text: string; rowBg: string }> = {
  none:        { label: '未开始', cellBg: 'bg-gray-50',   text: 'text-gray-400',  rowBg: '' },
  in_progress: { label: '进行中', cellBg: 'bg-blue-50',   text: 'text-blue-600',  rowBg: '' },
  done:        { label: '已完成', cellBg: 'bg-emerald-50', text: 'text-emerald-700', rowBg: '' },
  reminded:    { label: '已提醒', cellBg: 'bg-amber-50',  text: 'text-amber-600',  rowBg: '' },
  urged:       { label: '已催缴', cellBg: 'bg-red-50',    text: 'text-red-600',    rowBg: 'bg-red-50/20' },
}

const STATUS_DOT: Record<string, string> = {
  none: '○', in_progress: '◐', done: '●', reminded: '△', urged: '▲',
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
  const [editVid, setEditVid] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<{ vid: number; sidx: number } | null>(null)
  const [searchVillage, setSearchVillage] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'undone' | 'done'>('all')
  // 右键菜单
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; vid: number; sidx: number } | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)
  // 全列批量菜单
  const [batchCol, setBatchCol] = useState<string | null>(null)
  const batchRef = useRef<HTMLDivElement>(null)

  // 加载项目列表，设置当前项目名
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
  }, []) // 注意：只在首次加载运行

  // projectId 变化时更新项目名
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
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
      if (batchRef.current && !batchRef.current.contains(e.target as Node)) setBatchCol(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

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

  const setStageStatus = async (rec: ProgressRecord, stageIdx: number, status: StageItem['status']) => {
    const stages = [...rec.stages]
    stages[stageIdx] = { ...stages[stageIdx], status, date: new Date().toISOString().slice(0, 10) }
    const updated = { ...rec, stages }
    setRecords(prev => prev.map(p => p.village_id === rec.village_id ? updated : p))
    await saveRec(updated)
  }

  const cycleStage = async (rec: ProgressRecord, stageIdx: number) => {
    const cur = STATUS_ORDER.indexOf(rec.stages[stageIdx].status)
    setStageStatus(rec, stageIdx, STATUS_ORDER[(cur + 1) % STATUS_ORDER.length])
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

  const savePerson = async (rec: ProgressRecord) => { await saveRec(rec); setEditVid(null); show('已保存') }

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

  const swapStages = async (idxA: number, idxB: number) => {
    if (idxA < 0 || idxB < 0 || idxA >= allStages.length || idxB >= allStages.length) return
    await fetch(`/api/project-progress/${projectId}/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'swap_stages', stage_a: allStages[idxA], stage_b: allStages[idxB] }),
    })
    loadRecords()
  }

  // 删除所有筛选出的记录
  const deleteFiltered = async () => {
    if (!projectId || filtered.length === 0) return
    const names = filtered.map(r => r.village_name).join('、')
    if (!confirm(`确认删除筛选出的 ${filtered.length} 个村的进度记录？\n\n${names}`)) return
    const ids = filtered.map(r => r.village_id)
    await fetch(`/api/project-progress/${projectId}/batch-delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ village_ids: ids }),
    })
    show(`已删除 ${filtered.length} 个村的进度记录`)
    loadRecords()
  }

  // 导出 Excel
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

  // 右键打开菜单
  const onCtxMenu = (e: React.MouseEvent, vid: number, sidx: number) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, vid, sidx })
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

  // 行背景色：全部完成为绿，有催缴为红
  const rowBg = (rec: ProgressRecord) => {
    if (rec.stages.every(s => s.status === 'done')) return 'bg-emerald-50/30'
    if (rec.stages.some(s => s.status === 'urged')) return 'bg-red-50/20'
    return ''
  }

  return (
    <div className="p-4 max-w-full mx-auto" onClick={() => setCtxMenu(null)}>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-text-muted hover:text-text-primary">← 返回</button>
        <h1 className="text-lg font-bold">📋 {projectName || '项目进度'}</h1>
      </div>

      {/* 操作栏 */}
      <div className="bg-white border border-border rounded-card p-3 mb-3 flex items-center gap-3 flex-wrap">
        <select value={projectId ?? ''} onChange={e => setProjectId(Number(e.target.value))}
          className="border border-border rounded-btn px-2 py-1.5 text-xs outline-none bg-white">
          {projectList.map(p => (
            <option key={p.id} value={p.id}>{p.subsidy_name}（{p.subsidy_year}年）</option>
          ))}
        </select>
        <button onClick={initAllVillages} className="px-3 py-1.5 text-xs border border-border rounded-btn hover:bg-warm/30">🔄 初始化全部村</button>
        <div className="flex items-center gap-1">
          <input value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder="新阶段名称"
            className="border border-border rounded-btn px-2 py-1 text-xs outline-none w-28" />
          <button onClick={addStageToAll} className="px-2 py-1 text-xs bg-primary  rounded-btn hover:bg-primary/90">＋ 全部添加</button>
        </div>
        <div className="w-px h-6 bg-border" />
        <input value={searchVillage} onChange={e => setSearchVillage(e.target.value)} placeholder="🔍 搜索村名…"
          className="border border-border rounded-btn px-2 py-1 text-xs outline-none w-32" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
          className="border border-border rounded-btn px-2 py-1 text-xs outline-none">
          <option value="all">全部状态</option><option value="undone">有未完成</option><option value="done">全部完成</option>
        </select>
        <div className="w-px h-6 bg-border" />
        <button onClick={exportExcel} className="px-3 py-1.5 text-xs border border-green-200 text-green-700 rounded-btn hover:bg-green-50">📥 导出 Excel</button>
        <span className="text-xs text-text-muted">{filtered.length !== records.length ? `${filtered.length}/${records.length}` : records.length} 村</span>
        <span className="text-xs text-emerald-600">完成 {totalDone}/{totalCells}</span>
        {(searchVillage || statusFilter !== 'all') && (
          <button onClick={() => { setSearchVillage(''); setStatusFilter('all') }} className="text-xs text-blue-500">清除筛选</button>
        )}
        {totalCells > 0 && (
          <div className="w-32 h-1.5 bg-warm/30 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full" style={{ width: Math.round(totalDone / Math.max(1, totalCells) * 100) + '%' }} />
          </div>
        )}
        {filtered.length > 0 && (
          <button onClick={deleteFiltered}
            className="ml-auto px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-btn hover:bg-red-50">🗑 删除筛选结果</button>
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
        <div className="bg-white border border-border rounded-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-warm/30 border-b-2 border-border">
                  <th className="sticky left-0 bg-warm/30 z-10 text-left px-3 py-2.5 whitespace-nowrap min-w-[120px]">村名</th>
                  <th className="sticky left-[120px] bg-warm/30 z-10 text-left px-3 py-2.5 whitespace-nowrap w-[140px]">负责人 / 联系电话</th>
                  {allStages.map((sn, i) => (
                    <th key={sn} className="text-center px-1 py-2.5 whitespace-nowrap min-w-[110px] font-medium">
                      <div className="flex items-center justify-center gap-0.5">
                        <button onClick={() => swapStages(i, i - 1)} disabled={i === 0}
                          className="text-text-muted/30 hover:text-text-muted disabled:opacity-20 text-xs leading-none" title="左移">◀</button>
                        <span>{sn}</span>
                        <button onClick={() => swapStages(i, i + 1)} disabled={i === allStages.length - 1}
                          className="text-text-muted/30 hover:text-text-muted disabled:opacity-20 text-xs leading-none" title="右移">▶</button>
                        <span className="relative">
                          <button onClick={e => { e.stopPropagation(); setBatchCol(batchCol === sn ? null : sn) }}
                            className="text-text-muted/30 hover:text-primary ml-0.5 text-xs leading-none cursor-pointer" title="批量设置该列状态">▼</button>
                          {batchCol === sn && (
                            <div ref={batchRef}
                              className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-white border border-border rounded-card shadow-lg py-1 min-w-[110px]"
                              onClick={e => e.stopPropagation()}>
                              {STATUS_ORDER.map(st => {
                                const cfg = STATUS_CFG[st]
                                return (
                                  <button key={st}
                                    onClick={() => batchSetStageStatus(sn, st)}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-warm/30 flex items-center gap-2 whitespace-nowrap ${cfg.text}`}>
                                    <span className="text-base leading-none">{STATUS_DOT[st]}</span>
                                    <span>全部设为{cfg.label}</span>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </span>
                      </div>
                    </th>
                  ))}
                  <th className="text-center px-2 py-2.5 text-text-muted/50 w-8">＋</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(rec => (
                  <tr key={rec.village_id} className={`border-b border-border/30 hover:bg-warm/10 ${rowBg(rec)}`}>
                    <td className="sticky left-0 bg-inherit px-3 py-2 font-medium whitespace-nowrap">{rec.village_name}</td>
                    <td className="sticky left-[120px] bg-inherit px-3 py-2">
                      {editVid === rec.village_id ? (
                        <div className="flex flex-col gap-0.5">
                          <input value={rec.person_name} onChange={e => setRecords(prev => prev.map(p => p.village_id === rec.village_id ? { ...p, person_name: e.target.value } : p))}
                            placeholder="姓名" className="border border-border rounded px-1.5 py-0.5 text-xs outline-none w-16" />
                          <input value={rec.phone} onChange={e => setRecords(prev => prev.map(p => p.village_id === rec.village_id ? { ...p, phone: e.target.value } : p))}
                            placeholder="电话" className="border border-border rounded px-1.5 py-0.5 text-xs outline-none w-24" />
                          <div className="flex gap-1"><button onClick={() => savePerson(rec)} className="text-primary text-xs">保存</button>
                            <button onClick={() => { setEditVid(null); loadRecords() }} className="text-text-muted text-xs">取消</button></div>
                        </div>
                      ) : (
                        <div className="cursor-pointer" onClick={() => setEditVid(rec.village_id)}>
                          <div className="text-text-primary">{rec.person_name || '—'}</div>
                          <div className="text-text-muted/50">{rec.phone || ''}</div>
                        </div>
                      )}
                    </td>
                    {allStages.map(sn => {
                      const si = rec.stages.findIndex(s => s.name === sn)
                      if (si === -1) return <td key={sn} className="text-center px-2 py-2 text-text-muted/30">—</td>
                      const s = rec.stages[si]
                      const cfg = STATUS_CFG[s.status]
                      const isEditing = editCell?.vid === rec.village_id && editCell?.sidx === si
                      return (
                        <td key={sn} className={`text-center px-1 py-1 ${cfg.cellBg}`}
                          onContextMenu={e => onCtxMenu(e, rec.village_id, si)}>
                          <div className="flex flex-col items-center gap-0.5">
                            <button onClick={() => cycleStage(rec, si)}
                              className={`text-lg leading-none cursor-pointer hover:scale-110 transition-transform ${cfg.text}`} title="左键切换状态 · 右键选择状态">
                              {STATUS_DOT[s.status]}
                            </button>
                            <span className={`font-bold ${cfg.text}`}>{cfg.label}</span>
                            {s.date && <span className="text-text-muted/50" style={{ fontSize: '10px' }}>{fmtDate(s.date)}</span>}
                            {isEditing ? (
                              <input autoFocus value={s.note}
                                onChange={e => updateNote(rec, si, e.target.value)}
                                onBlur={() => setEditCell(null)}
                                onKeyDown={e => { if (e.key === 'Enter') setEditCell(null) }}
                                placeholder="备注…" className="border border-border rounded px-1 py-0.5 text-xs outline-none w-20 mt-0.5" />
                            ) : (
                              <span onClick={() => setEditCell({ vid: rec.village_id, sidx: si })}
                                className="text-text-muted/40 cursor-pointer hover:text-text-muted truncate max-w-[80px]" style={{ fontSize: '10px' }} title="点击添加备注">
                                {s.note || '＋备注'}
                              </span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                    <td className="text-center px-1 py-2 text-text-muted/30">—</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-warm/20 border-t-2 border-border">
                  <td className="sticky left-0 bg-warm/20 px-3 py-2 text-xs font-bold text-text-muted" colSpan={2}>完成率</td>
                  {allStages.map(sn => {
                    const st = stageStats[sn]
                    return (
                      <td key={sn} className="text-center px-2 py-2">
                        <span className={`text-xs font-bold ${st.done === st.total && st.total > 0 ? 'text-emerald-600' : 'text-text-muted'}`}>{st.done}/{st.total}</span>
                      </td>
                    )
                  })}
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {ctxMenu && (
        <div ref={ctxRef}
          className="fixed z-50 bg-white border border-border rounded-card shadow-lg py-1 min-w-[120px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          {STATUS_ORDER.map(st => {
            const cfg = STATUS_CFG[st]
            return (
              <button key={st}
                onClick={() => {
                  const rec = records.find(r => r.village_id === ctxMenu.vid)
                  if (rec) setStageStatus(rec, ctxMenu.sidx, st)
                  setCtxMenu(null)
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-warm/30 flex items-center gap-2 ${cfg.text}`}>
                <span className="text-base">{STATUS_DOT[st]}</span> {cfg.label}
              </button>
            )
          })}
        </div>
      )}

      <Toast {...toast} />
    </div>
  )
}
