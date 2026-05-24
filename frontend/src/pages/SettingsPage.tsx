import { useState, useEffect, useCallback, useRef } from 'react'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

// ── 类型 ──────────────────────────────────
interface VillageGroup {
  id: number
  village_id: number
  village_name: string
  group_no: string
  full_name: string
  leader_name?: string
  leader_phone?: string
  household_count: number
  retained_land?: number
  population?: number
  farmer_land_total?: number
  trust_out_total?: number
  trust_in_total?: number
  total_land?: number
}

interface VillageLandInfo {
  village_id: number
  village_name: string
  id: number | null
  survey_year: number | null
  contract_area_total: number | null
  paddy_area: number | null
  dry_land_area: number | null
  arable_area: number | null
  irrigation_level: string | null
  terrain_type: string | null
  soil_quality: string | null
  remark: string | null
}

// ── 工具 ──────────────────────────────────
async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

const loadGroups = () => req<VillageGroup[]>('/api/settings/village-groups')

function groupByVillage(list: VillageGroup[]) {
  const map = new Map<string, VillageGroup[]>()
  list.forEach(g => {
    if (!map.has(g.village_name)) map.set(g.village_name, [])
    map.get(g.village_name)!.push(g)
  })
  return map
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null ? '-' : Number(v).toFixed(digits)

const IRRIGATION_OPTS = ['完善', '一般', '无']
const TERRAIN_OPTS    = ['平坝', '丘陵', '山地']
const SOIL_OPTS       = ['优', '良', '一般', '差']

// ══════════════════════════════════════════
export default function SettingsPage() {
  const [tab, setTab] = useState<'groups' | 'land'>('groups')
  const { toast, show } = useToast()
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [loading, setLoading] = useState(false)

  // 新增弹窗
  const [addOpen, setAddOpen] = useState(false)
  const [addVillageName, setAddVillageName] = useState('')
  const [addGroupNo, setAddGroupNo] = useState('')
  const [addMode, setAddMode] = useState<'single' | 'batch'>('single')
  const [batchVillage, setBatchVillage] = useState('')
  const [batchGroups, setBatchGroups] = useState('')

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<VillageGroup | null>(null)
  const [editVillage, setEditVillage] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const [editLeaderName, setEditLeaderName] = useState('')
  const [editLeaderPhone, setEditLeaderPhone] = useState('')
  const [editRetainedLand, setEditRetainedLand] = useState<number>(0)
  const [editPopulation, setEditPopulation] = useState<number>(0)

  // 快速新增组
  const [quickAddVillage, setQuickAddVillage] = useState<string | null>(null)
  const [quickGroupNo, setQuickGroupNo] = useState('')
  // 村负责人编辑
  const [editLeaderVillage, setEditLeaderVillage] = useState<string | null>(null)
  const [villageLeaders, setVillageLeaders] = useState<Record<string, { name: string; phone: string; vid: number }>>({})

  // 耕地信息
  const [landInfoMap, setLandInfoMap] = useState<Record<number, VillageLandInfo>>({})
  const [editingLandId, setEditingLandId] = useState<number | null>(null)
  const [landEditForm, setLandEditForm] = useState<Partial<VillageLandInfo>>({})
  const [savingLand, setSavingLand] = useState<number | null>(null)
  // 批量导入负责人
  const [batchLeaderOpen, setBatchLeaderOpen] = useState(false)
  const [batchLeaderText, setBatchLeaderText] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try { setGroups(await loadGroups()) } finally { setLoading(false) }
  }, [])

  const reloadLand = useCallback(async () => {
    try {
      const res = await req<VillageLandInfo[]>('/api/agri-tasks/village-land-info')
      const map: Record<number, VillageLandInfo> = {}
      res.forEach(r => { map[r.village_id] = r })
      setLandInfoMap(map)
    } catch { /* ignore */ }
  }, [])

  const loadLeaders = useCallback(async () => {
    try {
      const list = await req<any[]>('/api/settings/villages')
      const map: Record<string, { name: string; phone: string; vid: number }> = {}
      list.forEach(v => { map[v.village_name] = { name: v.leader_name || '', phone: v.leader_phone || '', vid: v.id } })
      setVillageLeaders(map)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { reload(); reloadLand(); loadLeaders() }, [reload, reloadLand, loadLeaders])

  const saveLeader = async (vname: string) => {
    const info = villageLeaders[vname]
    if (!info) return
    try {
      await req(`/api/settings/villages/${info.vid}`, {
        method: 'PUT', body: JSON.stringify({ leader_name: editLeaderName, leader_phone: editLeaderPhone }),
      })
      show('✓ 负责人已更新')
      setEditLeaderVillage(null)
      loadLeaders()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openLandEdit = (vid: number) => {
    const info = landInfoMap[vid] || { village_id: vid }
    setLandEditForm({ ...info })
    setEditingLandId(vid)
  }

  const saveLand = async (vid: number) => {
    setSavingLand(vid)
    try {
      await req(`/api/agri-tasks/village-land-info/${vid}`, {
        method: 'PUT', body: JSON.stringify(landEditForm),
      })
      show('✓ 耕地信息已保存')
      setEditingLandId(null)
      reloadLand()
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setSavingLand(null) }
  }

  const villageMap = groupByVillage(groups)
  const villages = [...villageMap.keys()].sort()

  const submitSingle = async () => {
    const vname = addVillageName.trim(); const gno = addGroupNo.trim()
    if (!vname || !gno) return show('村名和组号不能为空', 'err')
    try {
      await req('/api/settings/village-groups', { method: 'POST', body: JSON.stringify({ village_name: vname, group_no: gno }) })
      show('✓ 创建成功'); setAddOpen(false); setAddVillageName(''); setAddGroupNo(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const submitBatch = async () => {
    const vname = batchVillage.trim()
    if (!vname) return show('请填写村名', 'err')
    const gnos = batchGroups.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (!gnos.length) return show('请填写至少一个组号', 'err')
    try {
      const res = await req<{ created: number; skipped: number }>(
        '/api/settings/village-groups/batch', { method: 'POST', body: JSON.stringify({ rows: gnos.map(g => ({ village_name: vname, group_no: g })) }) }
      )
      show(`✓ 新增 ${res.created} 个组，跳过 ${res.skipped} 个（重复）`)
      setAddOpen(false); setBatchVillage(''); setBatchGroups(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const submitQuickAdd = async (villageName: string) => {
    const gno = quickGroupNo.trim(); if (!gno) return
    try {
      await req('/api/settings/village-groups', { method: 'POST', body: JSON.stringify({ village_name: villageName, group_no: gno }) })
      show(`✓ ${villageName}${gno} 创建成功`)
      setQuickAddVillage(null); setQuickGroupNo(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openEdit = (g: VillageGroup) => {
    setEditTarget(g); setEditVillage(g.village_name); setEditGroup(g.group_no)
    setEditLeaderName(g.leader_name || ''); setEditLeaderPhone(g.leader_phone || '')
    setEditRetainedLand(g.retained_land ?? 0)
    setEditPopulation(g.population ?? 0)
  }
  const submitEdit = async () => {
    if (!editTarget) return
    try {
      await req(`/api/settings/village-groups/${editTarget.id}`, {
        method: 'PUT', body: JSON.stringify({
          village_name: editVillage,
          group_no: editGroup,
          leader_name: editLeaderName,
          leader_phone: editLeaderPhone,
          retained_land: editRetainedLand,
          population: editPopulation,
        })
      })
      show('✓ 更新成功'); setEditTarget(null); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // 批量导入负责人（粘贴 村名\t组名\t姓名\t电话）
  const submitBatchLeaders = async () => {
    const lines = batchLeaderText.split('\n').filter(l => l.trim())
    const rows: { village_name: string; group_no: string; leader_name: string; leader_phone: string }[] = []
    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length >= 3) {
        rows.push({ village_name: parts[0].trim(), group_no: parts[1].trim(), leader_name: parts[2].trim(), leader_phone: (parts[3] || '').trim() })
      }
    }
    if (!rows.length) return show('请按格式粘贴：村名\t组名\t姓名\t电话', 'err')
    try {
      await req('/api/settings/village-groups/batch-leaders', { method: 'POST', body: JSON.stringify({ rows }) })
      show(`✓ 已更新 ${rows.length} 个组的负责人`)
      setBatchLeaderOpen(false); setBatchLeaderText(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleDelete = async (g: VillageGroup) => {
    if (g.household_count > 0) return show(`该组下有 ${g.household_count} 户农户，无法删除`, 'err')
    if (!confirm(`确认删除「${g.full_name}」？`)) return
    try {
      await req(`/api/settings/village-groups/${g.id}`, { method: 'DELETE' })
      show('✓ 已删除'); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  return (
    <div>
      {/* Tab 切换 */}
      <div className="flex items-center gap-4 mb-5">
        <h1 className="text-xl font-bold text-text-primary">村组管理</h1>
        <div className="flex gap-1 bg-warm/30 p-1 rounded-btn text-sm">
          {([['groups', '村组结构'], ['land', '土地基础信息']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md transition-colors ${tab === t
                ? 'bg-white shadow text-primary font-medium'
                : 'text-text-muted hover:text-text-primary'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'groups' ? (
        <>
          {/* 统计栏 */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            <div className="bg-white border border-border rounded-card p-4 shadow-card">
              <div className="text-2xl font-bold font-mono text-primary">{villages.length}</div>
              <div className="text-xs text-text-muted mt-1">村庄总数</div>
            </div>
            <div className="bg-white border border-border rounded-card p-4 shadow-card">
              <div className="text-2xl font-bold font-mono text-blue-600">{groups.length}</div>
              <div className="text-xs text-text-muted mt-1">村组总数</div>
            </div>
            <div className="bg-white border border-border rounded-card p-4 shadow-card">
              <div className="text-2xl font-bold font-mono text-amber-600">
                {groups.reduce((s, g) => s + g.household_count, 0)}
              </div>
              <div className="text-xs text-text-muted mt-1">关联农户数</div>
            </div>
            <div className="bg-white border border-border rounded-card p-4 shadow-card">
              <div className="text-2xl font-bold font-mono text-emerald-600">
                {groups.reduce((s, g) => s + (g.total_land ?? 0), 0).toFixed(1)}
              </div>
              <div className="text-xs text-text-muted mt-1">土地总面积（亩）</div>
            </div>
          </div>

          {/* 工具栏 */}
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-text-muted">点击村名右侧「＋组」可快速添加该村新组</p>
            <div className="flex gap-2">
              <button onClick={() => setBatchLeaderOpen(true)}
                className="px-3 py-2 text-sm border border-blue-200 text-blue-700 rounded-btn hover:bg-blue-50">
                📥 批量导入负责人
              </button>
              <button onClick={() => { setAddMode('single'); setAddOpen(true) }}
                className="px-3 py-2 text-sm bg-primary  rounded-btn hover:bg-primary/90">
                ＋ 新增村 / 组
              </button>
            </div>
          </div>

          {/* 村组卡片列表 */}
          {loading && <div className="text-center py-16 text-text-muted/50">加载中…</div>}
          <div className="space-y-3">
            {villages.map(vname => {
              const glist = villageMap.get(vname) ?? []
              return (
                <div key={vname} className="bg-white border border-border rounded-card overflow-hidden shadow-card">
                  <div className="flex items-center justify-between px-5 py-3 bg-warm/30 border-b border-border/50">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-text-primary">{vname}</span>
                      <span className="text-xs text-text-muted font-mono">{glist.length} 个组</span>
                      <span className="text-xs text-text-muted/50">·</span>
                      <span className="text-xs text-text-muted">{glist.reduce((s, g) => s + g.household_count, 0)} 户</span>
                      {/* 负责人 */}
                      {editLeaderVillage === vname ? (
                        <div className="flex items-center gap-1.5">
                          <input autoFocus value={editLeaderName} onChange={e => setEditLeaderName(e.target.value)}
                            placeholder="姓名" className="border border-border rounded px-2 py-0.5 text-xs outline-none w-20" />
                          <input value={editLeaderPhone} onChange={e => setEditLeaderPhone(e.target.value)}
                            placeholder="电话" className="border border-border rounded px-2 py-0.5 text-xs outline-none w-28" />
                          <button onClick={() => saveLeader(vname)} className="text-xs text-primary font-medium">保存</button>
                          <button onClick={() => setEditLeaderVillage(null)} className="text-xs text-text-muted">取消</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {villageLeaders[vname]?.name ? (
                            <span className="text-xs text-text-muted">👤 {villageLeaders[vname].name}{villageLeaders[vname].phone ? ` · ${villageLeaders[vname].phone}` : ''}</span>
                          ) : (
                            <span className="text-xs text-text-muted/40">未设置负责人</span>
                          )}
                          <button onClick={() => {
                            setEditLeaderVillage(vname)
                            setEditLeaderName(villageLeaders[vname]?.name || '')
                            setEditLeaderPhone(villageLeaders[vname]?.phone || '')
                          }} className="text-xs text-blue-500 hover:text-blue-700">✏️</button>
                        </div>
                      )}
                    </div>
                    {quickAddVillage === vname ? (
                      <div className="flex items-center gap-2">
                        <input autoFocus value={quickGroupNo} onChange={e => setQuickGroupNo(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitQuickAdd(vname); if (e.key === 'Escape') setQuickAddVillage(null) }}
                          placeholder="组号，如：一组" className="border border-primary/30 rounded-btn px-3 py-1 text-sm w-32 outline-none" />
                        <button onClick={() => submitQuickAdd(vname)} className="px-3 py-1 text-xs bg-primary  rounded-btn">确认</button>
                        <button onClick={() => setQuickAddVillage(null)} className="px-3 py-1 text-xs border border-border rounded-btn text-text-muted">取消</button>
                      </div>
                    ) : (
                      <button onClick={() => { setQuickAddVillage(vname); setQuickGroupNo('') }}
                        className="text-xs text-primary border border-primary/20 px-3 py-1 rounded-btn hover:bg-primary/5">
                        ＋ 加组
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 px-5 py-3">
                    {glist.sort((a, b) => a.group_no.localeCompare(b.group_no, 'zh')).map(g => (
                      <div key={g.id}
                        className="flex items-center gap-1.5 bg-warm/30 border border-border rounded-btn px-3 py-1.5 group hover:border-border transition-colors">
                        <span className="text-sm text-text-primary font-medium">{g.group_no}</span>
                        {g.household_count > 0 && <span className="text-xs text-text-muted font-mono">{g.household_count}户</span>}
                        {(g.farmer_land_total ?? 0) > 0 && (
                          <span className="text-xs text-emerald-600 font-mono">📐{(g.farmer_land_total ?? 0).toFixed(1)}</span>
                        )}
                        {(g.retained_land ?? 0) > 0 && (
                          <span className="text-xs text-amber-600 font-mono">集体{(g.retained_land ?? 0).toFixed(1)}</span>
                        )}
                        {(g.trust_out_total ?? 0) > 0 && (
                          <span className="text-xs text-blue-500 font-mono">+流出{(g.trust_out_total ?? 0).toFixed(1)}</span>
                        )}
                        {(g.trust_in_total ?? 0) > 0 && (
                          <span className="text-xs text-purple-500 font-mono">+流转进{(g.trust_in_total ?? 0).toFixed(1)}</span>
                        )}
                        {(g.total_land ?? 0) > 0 && (
                          <span className="text-xs text-text-muted font-mono">={(g.total_land ?? 0).toFixed(1)}亩</span>
                        )}
                        {(g.leader_name || g.leader_phone) && (
                          <span className="text-xs text-blue-600">👤 {[g.leader_name, g.leader_phone].filter(Boolean).join(' · ')}</span>
                        )}
                        <div className="hidden group-hover:flex items-center gap-1 ml-0.5">
                          <button onClick={() => openEdit(g)} className="text-xs text-blue-500 hover:text-blue-700 px-1">改</button>
                          <button onClick={() => handleDelete(g)}
                            className={`text-xs px-1 ${g.household_count > 0 ? 'text-text-muted/50 cursor-not-allowed' : 'text-red-400 hover:text-red-600'}`}>
                            删
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 耕地信息 */}
                  {(() => {
                    const vid = glist[0]?.village_id
                    if (!vid) return null
                    const li = landInfoMap[vid]
                    const isEditing = editingLandId === vid
                    return (
                      <div className="border-t border-border/50 px-5 py-2.5 bg-warm/10">
                        {isEditing ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {([
                              ['paddy_area',    '水田面积(亩)'],
                              ['dry_land_area', '旱地面积(亩)'],
                              ['arable_area',   '可耕种面积(亩)'],
                            ] as const).map(([field, label]) => (
                              <div key={field}>
                                <div className="text-xs text-text-muted mb-0.5">{label}</div>
                                <input type="number" min="0" step="0.01"
                                  value={(landEditForm[field] as number | undefined) ?? ''}
                                  onChange={e => setLandEditForm(f => ({ ...f, [field]: e.target.value === '' ? null : Number(e.target.value) }))}
                                  className="w-full border border-border rounded px-2 py-1 text-xs font-mono" />
                              </div>
                            ))}
                            {([
                              ['irrigation_level', '灌溉条件', IRRIGATION_OPTS],
                              ['terrain_type',     '地形',     TERRAIN_OPTS],
                              ['soil_quality',     '土壤质量', SOIL_OPTS],
                            ] as const).map(([field, label, opts]) => (
                              <div key={field}>
                                <div className="text-xs text-text-muted mb-0.5">{label}</div>
                                <select value={(landEditForm[field] as string | undefined) ?? ''}
                                  onChange={e => setLandEditForm(f => ({ ...f, [field]: e.target.value || null }))}
                                  className="w-full border border-border rounded px-2 py-1 text-xs bg-white">
                                  <option value="">-</option>
                                  {opts.map((o: string) => <option key={o}>{o}</option>)}
                                </select>
                              </div>
                            ))}
                            <div className="col-span-2 sm:col-span-4 flex gap-2 mt-1">
                              <button onClick={() => saveLand(vid)} disabled={savingLand === vid}
                                className="text-xs bg-primary/90  px-3 py-1 rounded hover:bg-primary disabled:opacity-50">
                                {savingLand === vid ? '保存中...' : '保存'}
                              </button>
                              <button onClick={() => setEditingLandId(null)}
                                className="text-xs text-text-muted border border-border px-2 py-1 rounded hover:bg-warm/30">
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-4 flex-wrap">
                            <span className="text-xs text-text-muted">耕地：</span>
                            {li?.paddy_area != null
                              ? <span className="text-xs text-text-primary">水田 <b className="font-mono">{fmt(li.paddy_area)}</b> 亩</span>
                              : <span className="text-xs text-text-muted/50">水田 -</span>}
                            {li?.dry_land_area != null
                              ? <span className="text-xs text-text-primary">旱地 <b className="font-mono">{fmt(li.dry_land_area)}</b> 亩</span>
                              : <span className="text-xs text-text-muted/50">旱地 -</span>}
                            {li?.arable_area != null
                              ? <span className="text-xs text-text-primary">可耕 <b className="font-mono">{fmt(li.arable_area)}</b> 亩</span>
                              : <span className="text-xs text-text-muted/50">可耕 -</span>}
                            {li?.irrigation_level && <span className="text-xs text-text-muted">灌溉:{li.irrigation_level}</span>}
                            {li?.terrain_type && <span className="text-xs text-text-muted">{li.terrain_type}</span>}
                            <button onClick={() => openLandEdit(vid)}
                              className="ml-auto text-xs text-blue-500 hover:underline">
                              {li?.paddy_area != null || li?.arable_area != null ? '编辑耕地信息' : '录入耕地信息'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
            {!loading && villages.length === 0 && (
              <div className="text-center py-16 text-text-muted/50 bg-white border border-border rounded-card">
                <div className="text-4xl mb-3">🏘️</div>
                <p className="text-sm">暂无村组信息，点击右上角新增</p>
              </div>
            )}
          </div>

          {/* 新增弹窗 */}
          <Modal open={addOpen} title="新增村组" onClose={() => setAddOpen(false)}
            onConfirm={addMode === 'single' ? submitSingle : submitBatch}
            confirmText={addMode === 'single' ? '创建' : '批量创建'}>
            <div className="flex gap-2 mb-5">
              {[{ id: 'single', label: '新增单个组' }, { id: 'batch', label: '批量新增（一村多组）' }].map(m => (
                <button key={m.id} onClick={() => setAddMode(m.id as 'single' | 'batch')}
                  className={`flex-1 py-2 text-sm rounded-btn border transition-colors
                    ${addMode === m.id ? 'bg-primary  border-emerald-700' : 'bg-white border-border text-text-muted hover:border-border'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            {addMode === 'single' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">村名 *</label>
                  <input value={addVillageName} onChange={e => setAddVillageName(e.target.value)}
                    list="existing-villages" placeholder="如：红星村"
                    className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
                  <datalist id="existing-villages">{villages.map(v => <option key={v} value={v} />)}</datalist>
                  <p className="text-xs text-text-muted/50 mt-1">可输入已有村名，也可新建</p>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">组号 *</label>
                  <input value={addGroupNo} onChange={e => setAddGroupNo(e.target.value)}
                    placeholder="如：一组、2组、第三组"
                    onKeyDown={e => e.key === 'Enter' && submitSingle()}
                    className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
                {addVillageName && addGroupNo && (
                  <div className="col-span-2 bg-primary/5 border border-primary/10 rounded-btn px-4 py-2.5 text-sm text-primary">
                    将创建：<strong>{addVillageName}{addGroupNo}</strong>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">村名 *</label>
                  <input value={batchVillage} onChange={e => setBatchVillage(e.target.value)}
                    list="existing-villages2" placeholder="如：红星村"
                    className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
                  <datalist id="existing-villages2">{villages.map(v => <option key={v} value={v} />)}</datalist>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">组号列表 *（逗号或换行分隔）</label>
                  <textarea rows={5} value={batchGroups} onChange={e => setBatchGroups(e.target.value)}
                    placeholder={'一组\n二组\n三组\n四组\n五组'}
                    className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none font-mono" />
                </div>
                {batchVillage && batchGroups && (
                  <div className="bg-primary/5 border border-primary/10 rounded-btn px-4 py-2.5 text-sm text-primary">
                    将为「{batchVillage}」创建{' '}
                    <strong>{batchGroups.split(/[,，\n]/).map(s => s.trim()).filter(Boolean).length}</strong> 个组
                  </div>
                )}
              </div>
            )}
          </Modal>

          {/* 编辑弹窗 */}
          <Modal open={!!editTarget} title={`编辑村组 · ${editTarget?.full_name}`}
            onClose={() => setEditTarget(null)} onConfirm={submitEdit}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">村名</label>
                <input value={editVillage} onChange={e => setEditVillage(e.target.value)}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">组号</label>
                <input value={editGroup} onChange={e => setEditGroup(e.target.value)}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">👤 负责人</label>
                <input value={editLeaderName} onChange={e => setEditLeaderName(e.target.value)}
                  placeholder="姓名" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">📞 电话</label>
                <input value={editLeaderPhone} onChange={e => setEditLeaderPhone(e.target.value)}
                  placeholder="手机号" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">村留存土地（亩）</label>
                <input type="number" min="0" step="0.01"
                  value={editRetainedLand} onChange={e => setEditRetainedLand(Number(e.target.value) || 0)}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary font-mono" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">人口数</label>
                <input type="number" min="0" step="1"
                  value={editPopulation} onChange={e => setEditPopulation(Number(e.target.value) || 0)}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary font-mono" />
              </div>
              {editTarget && (editVillage !== editTarget.village_name || editGroup !== editTarget.group_no) && (
                <div className="col-span-2 bg-amber-50 border border-amber-100 rounded-btn px-4 py-2.5 text-sm text-amber-700">
                  ⚠️ 修改后：<strong>{editVillage}{editGroup}</strong>
                  {editTarget.household_count > 0 && `，关联的 ${editTarget.household_count} 户农户会自动更新显示`}
                </div>
              )}
            </div>
          </Modal>

          {/* 批量导入负责人 */}
          <Modal open={batchLeaderOpen} title="批量导入村组负责人"
            onClose={() => setBatchLeaderOpen(false)}
            onConfirm={submitBatchLeaders}>
            <p className="text-xs text-text-muted mb-2">
              每行一个组，用 <strong>Tab</strong> 分隔：村名 → 组名 → 负责人姓名 → 电话
            </p>
            <textarea rows={12} value={batchLeaderText} onChange={e => setBatchLeaderText(e.target.value)}
              placeholder={`XX村\t一组\t张三\t138xxxx\nXX村\t二组\t李四\t139xxxx`}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none font-mono" />
            <p className="text-xs text-text-muted mt-1">
              共 <strong>{batchLeaderText.split('\n').filter(l => l.trim()).length}</strong> 行
            </p>
          </Modal>
        </>
      ) : (
        <LandInfoTab show={show} />
      )}

      <Toast {...toast} />
    </div>
  )
}


// ══════════════════════════════════════════
//  土地基础信息 Tab
// ══════════════════════════════════════════
function LandInfoTab({ show }: { show: (msg: string, type?: 'ok' | 'err') => void }) {
  const [infos, setInfos] = useState<VillageLandInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [editForms, setEditForms] = useState<{ [vid: number]: Partial<VillageLandInfo> }>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await req<VillageLandInfo[]>('/api/agri-tasks/village-land-info')
      setInfos(res)
      const forms: { [vid: number]: Partial<VillageLandInfo> } = {}
      res.forEach(r => { forms[r.village_id] = { ...r } })
      setEditForms(forms)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setLoading(false) }
  }, [show])

  useEffect(() => { load() }, [load])

  const handleSave = async (villageId: number) => {
    setSaving(villageId)
    try {
      await req(`/api/agri-tasks/village-land-info/${villageId}`, {
        method: 'PUT', body: JSON.stringify(editForms[villageId] || {}),
      })
      show('✓ 保存成功')
      setEditing(null)
      load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setSaving(null) }
  }

  const setField = (vid: number, field: string, value: unknown) => {
    setEditForms(prev => ({ ...prev, [vid]: { ...prev[vid], [field]: value } }))
  }

  // 下载导入模板
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const headers = ['村名', '水田面积', '旱地面积', '可耕种面积', '灌溉条件', '地形', '土壤质量']
    const examples = infos.length > 0
      ? infos.map(i => [i.village_name, i.paddy_area ?? '', i.dry_land_area ?? '', i.arable_area ?? '', i.irrigation_level ?? '', i.terrain_type ?? '', i.soil_quality ?? ''])
      : [['示例村', 1200, 300, 1500, '完善', '平坝', '良']]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...examples])
    ws['!cols'] = headers.map(() => ({ wch: 14 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '耕地信息')
    XLSX.writeFile(wb, '耕地信息导入模板.xlsx')
  }

  // Excel 导入处理
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const COL_MAP: Record<string, string> = {
      '村名': 'village_name', '水田面积': 'paddy_area', '旱地面积': 'dry_land_area',
      '可耕种面积': 'arable_area', '灌溉条件': 'irrigation_level', '地形': 'terrain_type', '土壤质量': 'soil_quality',
    }
    const IRRIGATION_VALID = new Set(IRRIGATION_OPTS)
    const TERRAIN_VALID    = new Set(TERRAIN_OPTS)
    const SOIL_VALID       = new Set(SOIL_OPTS)

    setImporting(true)
    try {
      const XLSX = await import('xlsx')
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

      // 建立村名→village_id 映射
      const nameToId = new Map<string, number>(infos.map(i => [i.village_name, i.village_id]))

      let ok = 0, skipped = 0
      const errors: string[] = []

      for (const row of rows) {
        // 列名标准化
        const r: Record<string, unknown> = {}
        Object.entries(row).forEach(([k, v]) => {
          const mapped = COL_MAP[k.trim()]
          if (mapped) r[mapped] = v
        })

        const vname = String(r['village_name'] || '').trim()
        if (!vname) { skipped++; continue }

        const vid = nameToId.get(vname)
        if (!vid) { errors.push(`「${vname}」未找到`); skipped++; continue }

        const payload: Record<string, unknown> = {}
        for (const numF of ['paddy_area', 'dry_land_area', 'arable_area']) {
          const v = r[numF]
          payload[numF] = (v === '' || v == null) ? null : Number(v)
        }
        if (r['irrigation_level'] !== '') payload['irrigation_level'] = IRRIGATION_VALID.has(String(r['irrigation_level'])) ? r['irrigation_level'] : null
        if (r['terrain_type']     !== '') payload['terrain_type']     = TERRAIN_VALID.has(String(r['terrain_type']))     ? r['terrain_type']     : null
        if (r['soil_quality']     !== '') payload['soil_quality']     = SOIL_VALID.has(String(r['soil_quality']))       ? r['soil_quality']     : null

        try {
          await req(`/api/agri-tasks/village-land-info/${vid}`, { method: 'PUT', body: JSON.stringify(payload) })
          ok++
        } catch (e: unknown) { errors.push(`「${vname}」: ${(e as Error).message}`); skipped++ }
      }

      await load()
      const msg = `✓ 导入完成：更新 ${ok} 个村${skipped > 0 ? `，跳过 ${skipped} 个` : ''}${errors.length > 0 ? `\n${errors.slice(0, 3).join('；')}` : ''}`
      show(msg, ok > 0 ? 'ok' : 'err')
    } catch (e: unknown) { show('解析失败：' + (e as Error).message, 'err') }
    finally { setImporting(false) }
  }

  if (loading) return <div className="text-center py-12 text-text-muted">加载中...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">
          维护各村土地基础数据，用于农业任务分解时按水田/旱地/可耕种面积分配。
          <span className="text-text-muted ml-1">承包地汇总从在册家庭户自动计算。</span>
        </p>
        <div className="flex gap-2 shrink-0 ml-4">
          <button onClick={downloadTemplate}
            className="text-xs px-3 py-1.5 border border-border rounded-btn text-text-primary hover:bg-warm/30">
            下载模板
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="text-xs px-3 py-1.5 bg-primary  rounded-btn hover:bg-primary/90 disabled:opacity-50">
            {importing ? '导入中...' : '批量导入 Excel'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
        </div>
      </div>
      <div className="bg-white rounded-card border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-warm/30 border-b border-border">
            <tr>
              {['村名', '承包地汇总(亩)', '水田面积(亩)', '旱地面积(亩)', '可耕种面积(亩)', '灌溉条件', '地形', '土壤质量', '操作'].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-medium text-text-muted whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {infos.map(info => {
              const isEdit = editing === info.village_id
              const f = editForms[info.village_id] || {}
              return (
                <tr key={info.village_id} className="border-b border-border/50 hover:bg-warm/30">
                  <td className="px-3 py-3 font-medium text-text-primary whitespace-nowrap">{info.village_name}</td>
                  <td className="px-3 py-3 font-mono text-text-muted text-xs">{fmt(info.contract_area_total)}</td>

                  {(['paddy_area', 'dry_land_area', 'arable_area'] as const).map(field => (
                    <td key={field} className="px-3 py-2">
                      {isEdit ? (
                        <input type="number" min="0" step="0.01"
                          value={f[field] ?? ''}
                          onChange={e => setField(info.village_id, field, e.target.value === '' ? null : Number(e.target.value))}
                          className="w-24 border border-border rounded px-2 py-1 text-xs font-mono" />
                      ) : (
                        <span className={`font-mono ${info[field] != null ? 'text-text-primary' : 'text-text-muted/50'}`}>
                          {fmt(info[field])}
                        </span>
                      )}
                    </td>
                  ))}

                  {([
                    ['irrigation_level', IRRIGATION_OPTS],
                    ['terrain_type',     TERRAIN_OPTS],
                    ['soil_quality',     SOIL_OPTS],
                  ] as const).map(([field, opts]) => (
                    <td key={field} className="px-3 py-2">
                      {isEdit ? (
                        <select value={(f[field] as string) ?? ''}
                          onChange={e => setField(info.village_id, field, e.target.value || null)}
                          className="border border-border rounded px-2 py-1 text-xs bg-white">
                          <option value="">-</option>
                          {opts.map((o: string) => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <span className={`text-xs ${info[field] ? 'text-text-primary' : 'text-text-muted/50'}`}>
                          {info[field] || '-'}
                        </span>
                      )}
                    </td>
                  ))}

                  <td className="px-3 py-2 whitespace-nowrap">
                    {isEdit ? (
                      <div className="flex gap-1">
                        <button onClick={() => handleSave(info.village_id)} disabled={saving === info.village_id}
                          className="text-xs bg-primary/90  px-3 py-1 rounded hover:bg-primary disabled:opacity-50">
                          {saving === info.village_id ? '...' : '保存'}
                        </button>
                        <button onClick={() => {
                          setEditing(null)
                          setEditForms(prev => ({ ...prev, [info.village_id]: { ...info } }))
                        }} className="text-xs text-text-muted border border-border px-2 py-1 rounded hover:bg-warm/30">
                          取消
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setEditing(info.village_id)}
                        className="text-xs text-blue-600 hover:underline">编辑</button>
                    )}
                  </td>
                </tr>
              )
            })}
            {infos.length === 0 && (
              <tr><td colSpan={9} className="text-center py-10 text-text-muted/50">暂无村庄数据，请先在「村组结构」Tab 创建村</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
