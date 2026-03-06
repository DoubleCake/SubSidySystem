import { useState, useEffect } from 'react'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface VillageGroup {
  id: number
  village_name: string
  group_no: string
  full_name: string
  household_count: number
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || '请求失败') }
  return r.json() as Promise<T>
}

const loadGroups = () => req<VillageGroup[]>('/api/settings/village-groups')

// 按村名分组
function groupByVillage(list: VillageGroup[]) {
  const map = new Map<string, VillageGroup[]>()
  list.forEach(g => {
    if (!map.has(g.village_name)) map.set(g.village_name, [])
    map.get(g.village_name)!.push(g)
  })
  return map
}

export default function SettingsPage() {
  const { toast, show } = useToast()
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [loading, setLoading] = useState(false)

  // 新增弹窗
  const [addOpen, setAddOpen] = useState(false)
  const [addVillageName, setAddVillageName] = useState('')
  const [addGroupNo, setAddGroupNo] = useState('')
  const [addMode, setAddMode] = useState<'single' | 'batch'>('single')
  // 批量：选一个村，输入多个组号
  const [batchVillage, setBatchVillage] = useState('')
  const [batchGroups, setBatchGroups] = useState('')  // 逗号/换行分隔

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<VillageGroup | null>(null)
  const [editVillage, setEditVillage] = useState('')
  const [editGroup, setEditGroup] = useState('')

  // 快速新增组（在某个村下）
  const [quickAddVillage, setQuickAddVillage] = useState<string | null>(null)
  const [quickGroupNo, setQuickGroupNo] = useState('')

  const reload = async () => {
    setLoading(true)
    try { setGroups(await loadGroups()) } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const villageMap = groupByVillage(groups)
  const villages = [...villageMap.keys()].sort()

  // ── 新增单个 ──
  const submitSingle = async () => {
    const vname = addVillageName.trim()
    const gno   = addGroupNo.trim()
    if (!vname || !gno) return show('村名和组号不能为空', 'err')
    try {
      await req('/api/settings/village-groups', { method: 'POST', body: JSON.stringify({ village_name: vname, group_no: gno }) })
      show('✓ 创建成功'); setAddOpen(false); setAddVillageName(''); setAddGroupNo(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 批量新增（一个村多个组） ──
  const submitBatch = async () => {
    const vname = batchVillage.trim()
    if (!vname) return show('请填写村名', 'err')
    const gnos = batchGroups.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (!gnos.length) return show('请填写至少一个组号', 'err')
    const rows = gnos.map(g => ({ village_name: vname, group_no: g }))
    try {
      const res = await req<{ created: number; skipped: number }>(
        '/api/settings/village-groups/batch', { method: 'POST', body: JSON.stringify({ rows }) }
      )
      show(`✓ 新增 ${res.created} 个组，跳过 ${res.skipped} 个（重复）`)
      setAddOpen(false); setBatchVillage(''); setBatchGroups(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 快速在某村下加组 ──
  const submitQuickAdd = async (villageName: string) => {
    const gno = quickGroupNo.trim()
    if (!gno) return
    try {
      await req('/api/settings/village-groups', { method: 'POST', body: JSON.stringify({ village_name: villageName, group_no: gno }) })
      show(`✓ ${villageName}${gno} 创建成功`)
      setQuickAddVillage(null); setQuickGroupNo(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // ── 编辑 ──
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

  // ── 删除 ──
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
              {/* 村名标题栏 */}
              <div className="flex items-center justify-between px-5 py-3 bg-stone-50 border-b border-stone-100">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-stone-800">{vname}</span>
                  <span className="text-xs text-stone-400 font-mono">{glist.length} 个组</span>
                  <span className="text-xs text-stone-300">·</span>
                  <span className="text-xs text-stone-400">{glist.reduce((s, g) => s + g.household_count, 0)} 户</span>
                </div>
                {/* 快速加组 */}
                {quickAddVillage === vname ? (
                  <div className="flex items-center gap-2">
                    <input autoFocus value={quickGroupNo} onChange={e => setQuickGroupNo(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitQuickAdd(vname); if (e.key === 'Escape') setQuickAddVillage(null) }}
                      placeholder="组号，如：一组" className="border border-emerald-300 rounded-lg px-3 py-1 text-sm w-32 outline-none" />
                    <button onClick={() => submitQuickAdd(vname)}
                      className="px-3 py-1 text-xs bg-emerald-700 text-white rounded-lg">确认</button>
                    <button onClick={() => setQuickAddVillage(null)}
                      className="px-3 py-1 text-xs border border-stone-200 rounded-lg text-stone-400">取消</button>
                  </div>
                ) : (
                  <button onClick={() => { setQuickAddVillage(vname); setQuickGroupNo('') }}
                    className="text-xs text-emerald-700 border border-emerald-200 px-3 py-1 rounded-lg hover:bg-emerald-50">
                    ＋ 加组
                  </button>
                )}
              </div>

              {/* 组列表 */}
              <div className="flex flex-wrap gap-2 px-5 py-3">
                {glist.sort((a, b) => a.group_no.localeCompare(b.group_no, 'zh')).map(g => (
                  <div key={g.id}
                    className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5 group hover:border-stone-300 transition-colors">
                    <span className="text-sm text-stone-700">{g.group_no}</span>
                    {g.household_count > 0 && (
                      <span className="text-xs text-stone-400 font-mono">{g.household_count}户</span>
                    )}
                    <div className="hidden group-hover:flex items-center gap-1 ml-1">
                      <button onClick={() => openEdit(g)}
                        className="text-xs text-blue-500 hover:text-blue-700 px-1">改</button>
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
        {/* 模式切换 */}
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
              <datalist id="existing-villages">
                {villages.map(v => <option key={v} value={v} />)}
              </datalist>
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
              <datalist id="existing-villages2">
                {villages.map(v => <option key={v} value={v} />)}
              </datalist>
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
                <strong>{batchGroups.split(/[,，\n]/).map(s => s.trim()).filter(Boolean).length}</strong>
                {' '}个组
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

      <Toast {...toast} />
    </div>
  )
}
