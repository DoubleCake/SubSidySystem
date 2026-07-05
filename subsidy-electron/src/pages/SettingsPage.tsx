import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import VillageContactsPage from './VillageContactsPage'
import * as api from '../api'

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

interface VillageDetail {
  village_id: number
  village_name: string
  leader_name: string
  leader_phone: string
  household_count: number
  contacts: Array<{
    id: number
    name: string
    phone: string
    position: string
    is_agri_lead: boolean
    sort_order: number
    remark: string
    farmer_id: number | null
  }>
  groups: Array<{
    id: number
    group_no: string
    leader_name: string
    leader_phone: string
    leader_farmer_id: number | null
    household_count: number
    retained_land: number
    population: number
    contract_area: number
    subsidy_hh_count: number
    total_apply_area: number
    total_amount: number
    latest_year: number | null
  }>
  land_info: {
    id: number
    survey_year: number | null
    paddy_area: number | null
    dry_land_area: number | null
    arable_area: number | null
    irrigation_level: string | null
    terrain_type: string | null
    soil_quality: string | null
    remark: string | null
  } | null
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
  const [tab, setTab] = useState<'groups' | 'land' | 'contacts'>('groups')
  const { toast, show } = useToast()
  const navigate = useNavigate()
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [loading, setLoading] = useState(false)

  // 新增弹窗
  const [addOpen, setAddOpen] = useState(false)
  const [addVillageName, setAddVillageName] = useState('')
  const [addGroupNo, setAddGroupNo] = useState('')
  const [addMode, setAddMode] = useState<'single' | 'batch'>('single')
  const [batchVillage, setBatchVillage] = useState('')
  const [batchGroups, setBatchGroups] = useState('')

  // 编辑弹窗（仅组长）
  const [editTarget, setEditTarget] = useState<VillageGroup | null>(null)
  const [editLeaderName, setEditLeaderName] = useState('')
  const [editLeaderPhone, setEditLeaderPhone] = useState('')
  // 负责人搜索
  const [leaderSearchResults, setLeaderSearchResults] = useState<{ id: number; real_name: string; id_card: string; phone: string; village_name: string }[]>([])
  const [leaderSearchTimer, setLeaderSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [leaderDropdownOpen, setLeaderDropdownOpen] = useState(false)

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

  // 两侧布局：选中村详情
  const [selectedVillage, setSelectedVillage] = useState<string | null>(null)
  const [villageDetail, setVillageDetail] = useState<VillageDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try { setGroups(await api.getVillageGroups()) } finally { setLoading(false) }
  }, [])

  const reloadLand = useCallback(async () => {
    try {
      const res = await window.electronAPI.invoke('agri-tasks:listVillageLandInfo')
      const map: Record<number, VillageLandInfo> = {}
      res.forEach((r: VillageLandInfo) => { map[r.village_id] = r })
      setLandInfoMap(map)
    } catch { /* ignore */ }
  }, [])

  const loadLeaders = useCallback(async () => {
    try {
      const list = await window.electronAPI.invoke('settings:listVillages')
      const map: Record<string, { name: string; phone: string; vid: number }> = {}
      list.forEach((v: any) => { map[v.village_name] = { name: v.leader_name || '', phone: v.leader_phone || '', vid: v.id } })
      setVillageLeaders(map)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { reload(); reloadLand(); loadLeaders() }, [reload, reloadLand, loadLeaders])

  const loadVillageDetail = async (villageName: string) => {
    const g = groups.find(gr => gr.village_name === villageName)
    if (!g) return
    setSelectedVillage(villageName)
    setLoadingDetail(true)
    try {
      const res = await window.electronAPI.invoke('settings:villageDetail', g.village_id)
      setVillageDetail(res)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setLoadingDetail(false) }
  }

  const saveLeader = async (vname: string) => {
    const info = villageLeaders[vname]
    if (!info) return
    try {
      await window.electronAPI.invoke('settings:updateVillage', {
        id: info.vid, leader_name: editLeaderName, leader_phone: editLeaderPhone,
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
      await window.electronAPI.invoke('agri-tasks:updateVillageLandInfo', {
        village_id: vid, ...landEditForm,
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
      await api.createVillageGroup({ village_name: vname, group_no: gno })
      show('✓ 创建成功'); setAddOpen(false); setAddVillageName(''); setAddGroupNo(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const submitBatch = async () => {
    const vname = batchVillage.trim()
    if (!vname) return show('请填写村名', 'err')
    const gnos = batchGroups.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (!gnos.length) return show('请填写至少一个组号', 'err')
    try {
      const res = await window.electronAPI.invoke(
        'settings:batchCreateVillageGroups',
        { rows: gnos.map(g => ({ village_name: vname, group_no: g })) }
      )
      show(`✓ 新增 ${res.created} 个组，跳过 ${res.skipped} 个（重复）`)
      setAddOpen(false); setBatchVillage(''); setBatchGroups(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const submitQuickAdd = async (villageName: string) => {
    const gno = quickGroupNo.trim(); if (!gno) return
    try {
      await api.createVillageGroup({ village_name: villageName, group_no: gno })
      show(`✓ ${villageName}${gno} 创建成功`)
      setQuickAddVillage(null); setQuickGroupNo(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const openEdit = (g: VillageGroup) => {
    setEditTarget(g)
    setEditLeaderName(g.leader_name || ''); setEditLeaderPhone(g.leader_phone || '')
    setLeaderSearchResults([])
    setLeaderDropdownOpen(false)
  }
  const submitEdit = async () => {
    if (!editTarget) return
    try {
      await window.electronAPI.invoke('settings:updateVillageGroup', {
        id: editTarget.id,
        leader_name: editLeaderName,
        leader_phone: editLeaderPhone,
      })
      show('✓ 组长已更新'); setEditTarget(null); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  // 搜索农户匹配村组长
  const searchFarmers = (query: string) => {
    if (leaderSearchTimer) clearTimeout(leaderSearchTimer)
    if (!query.trim()) { setLeaderSearchResults([]); setLeaderDropdownOpen(false); return }
    const timer = setTimeout(async () => {
      try {
        const res = await window.electronAPI.invoke('farmers:search', { search: query.trim(), page_size: 5 })
        setLeaderSearchResults((res.items || []).map((f: any) => ({
          id: f.id, real_name: f.real_name, id_card: f.id_card || '', phone: f.phone || '', village_name: f.village_name || ''
        })))
        setLeaderDropdownOpen(true)
      } catch { setLeaderSearchResults([]) }
    }, 300)
    setLeaderSearchTimer(timer)
  }

  const selectLeader = (f: { id: number; real_name: string; id_card: string; phone: string }) => {
    setEditLeaderName(f.real_name)
    if (f.phone) setEditLeaderPhone(f.phone)
    setLeaderSearchResults([])
    setLeaderDropdownOpen(false)
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
      await window.electronAPI.invoke('settings:batchUpdateLeaders', { rows })
      show(`✓ 已更新 ${rows.length} 个组的负责人`)
      setBatchLeaderOpen(false); setBatchLeaderText(''); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const handleDelete = async (g: VillageGroup) => {
    if (g.household_count > 0) return show(`该组下有 ${g.household_count} 户农户，无法删除`, 'err')
    if (!confirm(`确认删除「${g.full_name}」？`)) return
    try {
      await window.electronAPI.invoke('settings:deleteVillageGroup', g.id)
      show('✓ 已删除'); reload()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  return (
    <div>
      {/* Tab 切换 */}
      <div className="flex items-center gap-4 mb-5">
        <h1 className="text-xl font-bold text-text-primary">村组管理</h1>
        <div className="flex gap-1 bg-warm/30 p-1 rounded-btn text-sm">
          {([['groups', '村组结构'], ['land', '土地基础信息'], ['contacts', '村组联系人']] as const).map(([t, label]) => (
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
        <VillageGroupsLayout
          villages={villages}
          villageMap={villageMap}
          groups={groups}
          landInfoMap={landInfoMap}
          villageLeaders={villageLeaders}
          selectedVillage={selectedVillage}
          villageDetail={villageDetail}
          loadingDetail={loadingDetail}
          loading={loading}
          show={show}
          navigate={navigate}
          onSelectVillage={loadVillageDetail}
          onSaveLeader={saveLeader}
          editLeaderVillage={editLeaderVillage} setEditLeaderVillage={setEditLeaderVillage}
          editLeaderName={editLeaderName} setEditLeaderName={setEditLeaderName}
          editLeaderPhone={editLeaderPhone} setEditLeaderPhone={setEditLeaderPhone}
          quickAddVillage={quickAddVillage} setQuickAddVillage={setQuickAddVillage}
          quickGroupNo={quickGroupNo} setQuickGroupNo={setQuickGroupNo}
          submitQuickAdd={submitQuickAdd}
          setAddMode={setAddMode} setAddOpen={setAddOpen}
          setBatchLeaderOpen={setBatchLeaderOpen}
          openEdit={openEdit} handleDelete={handleDelete}
          editLandForm={landEditForm} setEditLandForm={setLandEditForm}
          editingLandId={editingLandId} setEditingLandId={setEditingLandId}
          saveLand={saveLand} savingLand={savingLand} openLandEdit={openLandEdit}
        />

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

          {/* 编辑弹窗 — 仅设置组长 */}
          <Modal open={!!editTarget} title={`设置组长 · ${editTarget?.village_name || ''}${editTarget?.group_no || ''}`}
            onClose={() => setEditTarget(null)} onConfirm={submitEdit} confirmText="保存">
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-100 rounded-btn px-3 py-2 text-xs text-blue-700">
                为「<strong>{editTarget?.village_name}{editTarget?.group_no}</strong>」设置组长，输入姓名或身份证号从农户表匹配。
              </div>
              <div className="relative">
                <label className="block text-xs text-text-muted mb-1">👤 组长姓名（输入姓名/身份证号搜索）</label>
                <input value={editLeaderName} onChange={e => { setEditLeaderName(e.target.value); searchFarmers(e.target.value) }}
                  onFocus={() => { if (leaderSearchResults.length > 0) setLeaderDropdownOpen(true) }}
                  onBlur={() => setTimeout(() => setLeaderDropdownOpen(false), 200)}
                  placeholder="输入姓名或身份证号自动匹配农户…" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
                {leaderDropdownOpen && leaderSearchResults.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 bg-white border border-border rounded-card shadow-xl mt-1 max-h-48 overflow-y-auto">
                    {leaderSearchResults.map(f => (
                      <button key={f.id}
                        onMouseDown={() => selectLeader(f)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-warm/30 border-b border-border/30 last:border-0 flex items-center gap-2">
                        <span className="font-semibold text-text-primary">{f.real_name}</span>
                        <span className="text-xs text-text-muted font-mono">{f.id_card.slice(-6)}</span>
                        <span className="text-xs text-blue-500 ml-auto">{f.village_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">📞 电话（匹配后自动填入，可手动修改）</label>
                <input value={editLeaderPhone} onChange={e => setEditLeaderPhone(e.target.value)}
                  placeholder="手机号" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
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
      ) : tab === 'contacts' ? (
        <VillageContactsPage embedded />
      ) : (
        <LandInfoTab show={show} />
      )}

      <Toast {...toast} />
    </div>
  )
}


// ══════════════════════════════════════════
//  村组管理两侧布局
// ══════════════════════════════════════════
function VillageGroupsLayout(props: {
  villages: string[]
  villageMap: Map<string, any[]>
  groups: any[]
  landInfoMap: Record<number, any>
  villageLeaders: Record<string, { name: string; phone: string; vid: number }>
  selectedVillage: string | null
  villageDetail: VillageDetail | null
  loadingDetail: boolean
  loading: boolean
  show: (msg: string, type?: 'ok' | 'err') => void
  navigate: ReturnType<typeof useNavigate>
  onSelectVillage: (vname: string) => void
  onSaveLeader: (vname: string) => void
  editLeaderVillage: string | null; setEditLeaderVillage: (v: string | null) => void
  editLeaderName: string; setEditLeaderName: (v: string) => void
  editLeaderPhone: string; setEditLeaderPhone: (v: string) => void
  quickAddVillage: string | null; setQuickAddVillage: (v: string | null) => void
  quickGroupNo: string; setQuickGroupNo: (v: string) => void
  submitQuickAdd: (vname: string) => void
  setAddMode: (m: 'single' | 'batch') => void; setAddOpen: (b: boolean) => void
  setBatchLeaderOpen: (b: boolean) => void
  openEdit: (g: any) => void; handleDelete: (g: any) => void
  editLandForm: Partial<any>; setEditLandForm: (f: any) => void
  editingLandId: number | null; setEditingLandId: (id: number | null) => void
  saveLand: (vid: number) => void; savingLand: number | null
  openLandEdit: (vid: number) => void
}) {
  const {
    villages, villageDetail, loadingDetail, loading,
    selectedVillage, show, navigate, onSelectVillage,
  } = props

  const [searchVillage, setSearchVillage] = useState('')

  const filteredVillages = villages.filter(v =>
    !searchVillage || v.includes(searchVillage)
  )

  // 计算总体统计
  const totalGroups = props.groups.length
  const totalHouseholds = props.groups.reduce((s: number, g: any) => s + g.household_count, 0)
  const totalLand = props.groups.reduce((s: number, g: any) => s + (g.total_land ?? 0), 0)

  return (
    <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
      {/* ═══ 左侧：村列表 ═══ */}
      <div className="w-56 shrink-0 bg-white border border-border rounded-card shadow-card flex flex-col">
        {/* 搜索 */}
        <div className="p-3 border-b border-border">
          <input
            value={searchVillage}
            onChange={e => setSearchVillage(e.target.value)}
            placeholder="🔍 搜索村名…"
            className="w-full border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-primary/40"
          />
        </div>
        {/* 统计 */}
        <div className="px-3 py-2 border-b border-border/30 bg-warm/20">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>{filteredVillages.length}村</span>
            <span>{totalGroups}组</span>
            <span>{totalHouseholds}户</span>
            <span className="font-mono">{totalLand.toFixed(0)}亩</span>
          </div>
        </div>
        {/* 村名列表 */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="py-8 text-center text-text-muted/50 text-xs">加载中…</div>
          )}
          {filteredVillages.map(vname => {
            const glist = props.villageMap.get(vname) ?? []
            const isSelected = selectedVillage === vname
            return (
              <button
                key={vname}
                onClick={() => onSelectVillage(vname)}
                className={`w-full text-left px-3 py-2.5 text-sm flex items-center justify-between border-b border-border/20 transition-colors
                  ${isSelected ? 'bg-primary/10 text-primary font-semibold border-l-[3px] border-l-primary' : 'hover:bg-warm/20 border-l-[3px] border-l-transparent'}`}
              >
                <span className="truncate">{vname}</span>
                <span className="text-xs text-text-muted/50 ml-1 shrink-0">{glist.length}组</span>
              </button>
            )
          })}
        </div>
        {/* 底部操作 */}
        <div className="p-2 border-t border-border flex gap-1.5">
          <button onClick={() => { props.setAddMode('single'); props.setAddOpen(true) }}
            className="flex-1 text-xs bg-primary text-white rounded px-2 py-1.5 hover:bg-primary/90">
            ＋ 新增
          </button>
          <button onClick={() => props.setBatchLeaderOpen(true)}
            className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1.5 hover:bg-blue-50">
            📥
          </button>
        </div>
      </div>

      {/* ═══ 右侧：村详情 ═══ */}
      <div className="flex-1 min-w-0">
        {!selectedVillage ? (
          <div className="bg-white border border-border rounded-card shadow-card flex items-center justify-center py-20">
            <div className="text-center text-text-muted/50">
              <div className="text-5xl mb-4">🏘️</div>
              <p className="text-sm">请从左侧选择一个村庄查看详情</p>
              <p className="text-xs mt-1">包含村干部、各组信息、土地数据</p>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="bg-white border border-border rounded-card shadow-card flex items-center justify-center py-20">
            <div className="inline-flex items-center gap-2 text-text-muted/60">
              <span className="w-5 h-5 border-2 border-stone-300 border-t-primary rounded-full animate-spin" />
              <span className="text-sm">加载中…</span>
            </div>
          </div>
        ) : villageDetail ? (
          <div className="space-y-4">
            {/* 村名标题 */}
            <div className="bg-white border border-border rounded-card shadow-card p-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-text-primary">{villageDetail.village_name}</h2>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{villageDetail.groups.length}个组</span>
                <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{villageDetail.household_count}户</span>
              </div>
            </div>

            {/* 村干部 */}
            <div className="bg-white border border-border rounded-card shadow-card p-4">
              <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                <span>📋</span> 村干部
              </h3>
              {villageDetail.contacts.length === 0 ? (
                <p className="text-xs text-text-muted/50">暂未设置村干部，请在「村组联系人」tab中添加</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {villageDetail.contacts.map(c => (
                    <div key={c.id}
                      className="flex items-center gap-2 bg-warm/20 border border-border/50 rounded-btn px-3 py-2">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        c.position === '书记' ? 'bg-red-100 text-red-700' :
                        c.position === '副书记' ? 'bg-orange-100 text-orange-700' :
                        c.position === '副主任' ? 'bg-blue-100 text-blue-700' :
                        c.position === '文书' ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{c.position || '干部'}</span>
                      <span className="text-sm font-semibold text-text-primary">{c.name}</span>
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="text-xs text-blue-500 font-mono hover:underline">
                          📞{c.phone}
                        </a>
                      )}
                      {c.farmer_id ? (
                        <button
                          onClick={() => navigate(`/farmers?id=${c.farmer_id}`)}
                          className="ml-auto text-xs text-primary border border-primary/20 px-2 py-0.5 rounded hover:bg-primary/5"
                          title="查看农户详情"
                        >
                          👤 农户
                        </button>
                      ) : (
                        <span className="ml-auto text-xs text-text-muted/40">未关联</span>
                      )}
                      {c.is_agri_lead && (
                        <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">⭐ 农业负责人</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 村组信息 */}
            <div className="bg-white border border-border rounded-card shadow-card p-4">
              <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                <span>📐</span> 村组信息
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {villageDetail.groups.map(g => (
                  <div key={g.id}
                    className="bg-warm/20 border border-border/50 rounded-card p-3 hover:border-primary/20 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-bold text-text-primary">{g.group_no}</span>
                      <span className="text-xs bg-white border border-border/50 rounded-full px-2 py-0.5 font-medium">
                        {g.household_count}户
                      </span>
                      {g.population > 0 && <span className="text-xs text-text-muted">{g.population}人</span>}
                    </div>
                    {/* 土地数据 */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-xs">
                      {g.contract_area > 0 && (
                        <span className="text-text-muted">📐 承包地<span className="text-emerald-600 font-semibold ml-0.5">{g.contract_area.toFixed(1)}亩</span></span>
                      )}
                      {g.retained_land > 0 && (
                        <span className="text-text-muted">🏛 集体地<span className="text-amber-600 font-semibold ml-0.5">{g.retained_land.toFixed(1)}亩</span></span>
                      )}
                      {g.total_apply_area > 0 && (
                        <span className="text-text-muted">📋 申报面积<span className="text-blue-600 font-semibold ml-0.5">{g.total_apply_area.toFixed(1)}亩</span></span>
                      )}
                    </div>
                    {/* 补贴数据（最新年度） */}
                    {g.latest_year && (
                      <div className="bg-white/60 border border-border/30 rounded px-2 py-1 mb-2 text-xs">
                        <span className="text-text-muted">{g.latest_year}年度：</span>
                        <span className="text-text-primary font-medium">{g.subsidy_hh_count}户受益</span>
                        {g.total_amount > 0 && (
                          <span className="text-primary font-semibold ml-2">¥{g.total_amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>
                        )}
                      </div>
                    )}
                    {/* 组长信息 */}
                    <div className="border-t border-border/30 pt-2 flex items-center gap-2">
                      {g.leader_name ? (
                        <>
                          {g.leader_farmer_id ? (
                            <button
                              onClick={() => navigate(`/farmers?id=${g.leader_farmer_id}`)}
                              className="text-xs text-primary font-medium hover:underline"
                              title="点击查看农户详情"
                            >
                              👤 {g.leader_name}
                            </button>
                          ) : (
                            <span className="text-xs text-text-primary font-medium">👤 {g.leader_name}</span>
                          )}
                          {g.leader_phone && (
                            <a href={`tel:${g.leader_phone}`} className="text-xs text-blue-500 font-mono">{g.leader_phone}</a>
                          )}
                          {g.leader_farmer_id ? (
                            <span className="ml-auto text-[10px] text-emerald-500">✓ 已关联</span>
                          ) : (
                            <span className="ml-auto text-[10px] text-text-muted/40">未关联</span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-text-muted/40">暂未设置组长</span>
                      )}
                      <button onClick={() => props.openEdit(g)}
                        className="text-[10px] text-blue-500 hover:text-blue-700 px-1">✏️</button>
                    </div>
                  </div>
                ))}
              </div>
              {villageDetail.groups.length === 0 && (
                <p className="text-xs text-text-muted/50">暂未创建村组</p>
              )}
            </div>

            {/* 土地基础信息 */}
            <div className="bg-white border border-border rounded-card shadow-card p-4">
              <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                <span>🌾</span> 土地基础信息
              </h3>
              {villageDetail.land_info ? (
                <div>
                  <div className="flex items-center gap-4 flex-wrap text-sm">
                    {villageDetail.land_info.paddy_area != null && (
                      <span>水田 <b className="font-mono text-emerald-600">{villageDetail.land_info.paddy_area.toFixed(2)}</b> 亩</span>
                    )}
                    {villageDetail.land_info.dry_land_area != null && (
                      <span>旱地 <b className="font-mono text-amber-600">{villageDetail.land_info.dry_land_area.toFixed(2)}</b> 亩</span>
                    )}
                    {villageDetail.land_info.arable_area != null && (
                      <span>可耕种 <b className="font-mono text-blue-600">{villageDetail.land_info.arable_area.toFixed(2)}</b> 亩</span>
                    )}
                    {villageDetail.land_info.irrigation_level && (
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">灌溉: {villageDetail.land_info.irrigation_level}</span>
                    )}
                    {villageDetail.land_info.terrain_type && (
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{villageDetail.land_info.terrain_type}</span>
                    )}
                    {villageDetail.land_info.soil_quality && (
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">土壤: {villageDetail.land_info.soil_quality}</span>
                    )}
                  </div>
                  {villageDetail.land_info.remark && (
                    <p className="text-xs text-text-muted mt-2">📝 {villageDetail.land_info.remark}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-text-muted/50">暂未录入土地基础信息</p>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white border border-border rounded-card shadow-card flex items-center justify-center py-20">
            <div className="text-center text-text-muted/50 text-sm">加载失败，请重试</div>
          </div>
        )}
      </div>
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
  const [refModal, setRefModal] = useState<{ name: string; refs: Record<string, number>; total: number } | null>(null)

  const checkVillageRefs = async (vid: number, vname: string) => {
    try {
      const res = await window.electronAPI.invoke('settings:villageReferences', vid)
      setRefModal({ name: vname, refs: res.references, total: res.total })
    } catch (e) { show('查询失败: ' + (e as Error).message, 'err') }
  }
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.invoke('agri-tasks:listVillageLandInfo')
      setInfos(res)
      const forms: { [vid: number]: Partial<VillageLandInfo> } = {}
      res.forEach((r: VillageLandInfo) => { forms[r.village_id] = { ...r } })
      setEditForms(forms)
    } catch (e: unknown) { show((e as Error).message, 'err') }
    finally { setLoading(false) }
  }, [show])

  useEffect(() => { load() }, [load])

  const handleSave = async (villageId: number) => {
    setSaving(villageId)
    try {
      await window.electronAPI.invoke('agri-tasks:updateVillageLandInfo', {
        village_id: villageId, ...(editForms[villageId] || {}),
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
          await window.electronAPI.invoke('agri-tasks:updateVillageLandInfo', {
            village_id: vid, ...payload,
          })
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
                      <div className="flex gap-1.5">
                        <button onClick={() => checkVillageRefs(info.village_id, info.village_name)}
                          className="text-xs text-amber-600 hover:underline">引用</button>
                        <button onClick={() => setEditing(info.village_id)}
                          className="text-xs text-blue-600 hover:underline">编辑</button>
                      </div>
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

      {/* 引用详情弹窗 */}
      {refModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setRefModal(null)}>
          <div className="bg-white rounded-card shadow-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-text-primary mb-1">「{refModal.name}」引用详情</h3>
            <p className="text-xs text-text-muted mb-4">{refModal.total > 0 ? `共 ${refModal.total} 条引用，无法删除` : '无引用，可以安全删除'}</p>
            <div className="space-y-1.5 text-sm max-h-60 overflow-y-auto">
              {Object.entries(refModal.refs).map(([k, v]) => (
                <div key={k} className={`flex justify-between px-3 py-1.5 rounded-btn ${v > 0 ? 'bg-red-50 text-red-700 font-medium' : 'bg-warm/20 text-text-muted'}`}>
                  <span>{k}</span>
                  <span className="font-mono">{v} 条</span>
                </div>
              ))}
            </div>
            <button onClick={() => setRefModal(null)} className="mt-4 w-full text-sm bg-primary text-white py-2 rounded-btn">关闭</button>
          </div>
        </div>
      )}
    </div>
  )
}
