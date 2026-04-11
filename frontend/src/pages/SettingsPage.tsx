import { useState, useEffect, useCallback } from 'react'
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
  household_count: number
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

  // 快速新增组
  const [quickAddVillage, setQuickAddVillage] = useState<string | null>(null)
  const [quickGroupNo, setQuickGroupNo] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try { setGroups(await loadGroups()) } finally { setLoading(false) }
  }, [])

  useEffect(() => { reload() }, [reload])

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
  }
  const submitEdit = async () => {
    if (!editTarget) return
    try {
      await req(`/api/settings/village-groups/${editTarget.id}`, {
        method: 'PUT', body: JSON.stringify({ village_name: editVillage, group_no: editGroup })
      })
      show('✓ 更新成功'); setEditTarget(null); reload()
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
        <h1 className="text-xl font-bold text-stone-800">村组管理</h1>
        <div className="flex gap-1 bg-stone-100 p-1 rounded-lg text-sm">
          {([['groups', '村组结构'], ['land', '土地基础信息']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md transition-colors ${tab === t
                ? 'bg-white shadow text-emerald-700 font-medium'
                : 'text-stone-500 hover:text-stone-700'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'groups' ? (
        <>
          {/* 统计栏 */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
              <div className="text-2xl font-bold font-mono text-emerald-700">{villages.length}</div>
              <div className="text-xs text-stone-400 mt-1">村庄总数</div>
            </div>
            <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
              <div className="text-2xl font-bold font-mono text-blue-600">{groups.length}</div>
              <div className="text-xs text-stone-400 mt-1">村组总数</div>
            </div>
            <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
              <div className="text-2xl font-bold font-mono text-amber-600">
                {groups.reduce((s, g) => s + g.household_count, 0)}
              </div>
              <div className="text-xs text-stone-400 mt-1">关联农户数</div>
            </div>
          </div>

          {/* 工具栏 */}
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-stone-400">点击村名右侧「＋组」可快速添加该村新组</p>
            <button onClick={() => { setAddMode('single'); setAddOpen(true) }}
              className="px-3 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">
              ＋ 新增村 / 组
            </button>
          </div>

          {/* 村组卡片列表 */}
          {loading && <div className="text-center py-16 text-stone-300">加载中…</div>}
          <div className="space-y-3">
            {villages.map(vname => {
              const glist = villageMap.get(vname) ?? []
              return (
                <div key={vname} className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between px-5 py-3 bg-stone-50 border-b border-stone-100">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-stone-800">{vname}</span>
                      <span className="text-xs text-stone-400 font-mono">{glist.length} 个组</span>
                      <span className="text-xs text-stone-300">·</span>
                      <span className="text-xs text-stone-400">{glist.reduce((s, g) => s + g.household_count, 0)} 户</span>
                    </div>
                    {quickAddVillage === vname ? (
                      <div className="flex items-center gap-2">
                        <input autoFocus value={quickGroupNo} onChange={e => setQuickGroupNo(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitQuickAdd(vname); if (e.key === 'Escape') setQuickAddVillage(null) }}
                          placeholder="组号，如：一组" className="border border-emerald-300 rounded-lg px-3 py-1 text-sm w-32 outline-none" />
                        <button onClick={() => submitQuickAdd(vname)} className="px-3 py-1 text-xs bg-emerald-700 text-white rounded-lg">确认</button>
                        <button onClick={() => setQuickAddVillage(null)} className="px-3 py-1 text-xs border border-stone-200 rounded-lg text-stone-400">取消</button>
                      </div>
                    ) : (
                      <button onClick={() => { setQuickAddVillage(vname); setQuickGroupNo('') }}
                        className="text-xs text-emerald-700 border border-emerald-200 px-3 py-1 rounded-lg hover:bg-emerald-50">
                        ＋ 加组
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 px-5 py-3">
                    {glist.sort((a, b) => a.group_no.localeCompare(b.group_no, 'zh')).map(g => (
                      <div key={g.id}
                        className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5 group hover:border-stone-300 transition-colors">
                        <span className="text-sm text-stone-700">{g.group_no}</span>
                        {g.household_count > 0 && <span className="text-xs text-stone-400 font-mono">{g.household_count}户</span>}
                        <div className="hidden group-hover:flex items-center gap-1 ml-1">
                          <button onClick={() => openEdit(g)} className="text-xs text-blue-500 hover:text-blue-700 px-1">改</button>
                          <button onClick={() => handleDelete(g)}
                            className={`text-xs px-1 ${g.household_count > 0 ? 'text-stone-300 cursor-not-allowed' : 'text-red-400 hover:text-red-600'}`}>
                            删
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {!loading && villages.length === 0 && (
              <div className="text-center py-16 text-stone-300 bg-white border border-stone-200 rounded-xl">
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
                  className={`flex-1 py-2 text-sm rounded-lg border transition-colors
                    ${addMode === m.id ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            {addMode === 'single' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-stone-400 mb-1">村名 *</label>
                  <input value={addVillageName} onChange={e => setAddVillageName(e.target.value)}
                    list="existing-villages" placeholder="如：红星村"
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  <datalist id="existing-villages">{villages.map(v => <option key={v} value={v} />)}</datalist>
                  <p className="text-xs text-stone-300 mt-1">可输入已有村名，也可新建</p>
                </div>
                <div>
                  <label className="block text-xs text-stone-400 mb-1">组号 *</label>
                  <input value={addGroupNo} onChange={e => setAddGroupNo(e.target.value)}
                    placeholder="如：一组、2组、第三组"
                    onKeyDown={e => e.key === 'Enter' && submitSingle()}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                </div>
                {addVillageName && addGroupNo && (
                  <div className="col-span-2 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2.5 text-sm text-emerald-700">
                    将创建：<strong>{addVillageName}{addGroupNo}</strong>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-stone-400 mb-1">村名 *</label>
                  <input value={batchVillage} onChange={e => setBatchVillage(e.target.value)}
                    list="existing-villages2" placeholder="如：红星村"
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  <datalist id="existing-villages2">{villages.map(v => <option key={v} value={v} />)}</datalist>
                </div>
                <div>
                  <label className="block text-xs text-stone-400 mb-1">组号列表 *（逗号或换行分隔）</label>
                  <textarea rows={5} value={batchGroups} onChange={e => setBatchGroups(e.target.value)}
                    placeholder={'一组\n二组\n三组\n四组\n五组'}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none font-mono" />
                </div>
                {batchVillage && batchGroups && (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2.5 text-sm text-emerald-700">
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
                <label className="block text-xs text-stone-400 mb-1">村名</label>
                <input value={editVillage} onChange={e => setEditVillage(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">组号</label>
                <input value={editGroup} onChange={e => setEditGroup(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
              {editTarget && (editVillage !== editTarget.village_name || editGroup !== editTarget.group_no) && (
                <div className="col-span-2 bg-amber-50 border border-amber-100 rounded-lg px-4 py-2.5 text-sm text-amber-700">
                  ⚠️ 修改后：<strong>{editVillage}{editGroup}</strong>
                  {editTarget.household_count > 0 && `，关联的 ${editTarget.household_count} 户农户会自动更新显示`}
                </div>
              )}
            </div>
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

  if (loading) return <div className="text-center py-12 text-stone-400">加载中...</div>

  return (
    <div>
      <p className="text-sm text-stone-500 mb-4">
        维护各村土地基础数据，用于农业任务分解时按水田/旱地/可耕种面积分配。
        <span className="text-stone-400">承包地汇总从在册家庭户自动计算，无需手动录入。</span>
      </p>
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              {['村名', '承包地汇总(亩)', '水田面积(亩)', '旱地面积(亩)', '可耕种面积(亩)', '灌溉条件', '地形', '土壤质量', '操作'].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-medium text-stone-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {infos.map(info => {
              const isEdit = editing === info.village_id
              const f = editForms[info.village_id] || {}
              return (
                <tr key={info.village_id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-3 py-3 font-medium text-stone-800 whitespace-nowrap">{info.village_name}</td>
                  <td className="px-3 py-3 font-mono text-stone-400 text-xs">{fmt(info.contract_area_total)}</td>

                  {(['paddy_area', 'dry_land_area', 'arable_area'] as const).map(field => (
                    <td key={field} className="px-3 py-2">
                      {isEdit ? (
                        <input type="number" min="0" step="0.01"
                          value={f[field] ?? ''}
                          onChange={e => setField(info.village_id, field, e.target.value === '' ? null : Number(e.target.value))}
                          className="w-24 border border-stone-200 rounded px-2 py-1 text-xs font-mono" />
                      ) : (
                        <span className={`font-mono ${info[field] != null ? 'text-stone-700' : 'text-stone-300'}`}>
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
                          className="border border-stone-200 rounded px-2 py-1 text-xs bg-white">
                          <option value="">-</option>
                          {opts.map((o: string) => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <span className={`text-xs ${info[field] ? 'text-stone-600' : 'text-stone-300'}`}>
                          {info[field] || '-'}
                        </span>
                      )}
                    </td>
                  ))}

                  <td className="px-3 py-2 whitespace-nowrap">
                    {isEdit ? (
                      <div className="flex gap-1">
                        <button onClick={() => handleSave(info.village_id)} disabled={saving === info.village_id}
                          className="text-xs bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700 disabled:opacity-50">
                          {saving === info.village_id ? '...' : '保存'}
                        </button>
                        <button onClick={() => {
                          setEditing(null)
                          setEditForms(prev => ({ ...prev, [info.village_id]: { ...info } }))
                        }} className="text-xs text-stone-400 border border-stone-200 px-2 py-1 rounded hover:bg-stone-50">
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
              <tr><td colSpan={9} className="text-center py-10 text-stone-300">暂无村庄数据，请先在「村组结构」Tab 创建村</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
