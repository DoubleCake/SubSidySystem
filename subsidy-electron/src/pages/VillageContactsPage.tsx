/**
 * 村组联系人管理页 — 历史时间线模式
 *
 * 左：村庄列表    右：时间线（村负责人）+ 组组长
 * 支持 Excel 模板导入（村负责人 / 组组长两张表）
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import Modal from '../components/Modal'
import * as XLSX from 'xlsx'

// ── 类型 ──
interface VillageContact {
  id: number; village_id: number; village_name: string
  leader_name: string; leader_phone: string; leader_title: string
  contact_name: string; contact_phone: string
  start_year: number; end_year: number | null
  remark: string
}

interface GroupContact {
  id: number; village_id: number; village_group_id: number; group_no: number
  leader_name: string; leader_phone: string
  start_year: number; end_year: number | null
  remark: string
}

interface Village {
  id: number; village_name: string
}

interface VillageGroup {
  village_group_id: number; group_no: number
}

const POSITIONS = ['村支书', '村委会主任', '副书记', '副主任', '文书', '其他']
const CURRENT_YEAR = new Date().getFullYear()

export default function VillageContactsPage({ embedded }: { embedded?: boolean }) {
  const { toast, show } = useToast()

  // ── 状态 ──
  const [villages, setVillages] = useState<Village[]>([])
  const [selectedVillageId, setSelectedVillageId] = useState<number | null>(null)
  const [timeline, setTimeline] = useState<VillageContact[]>([])
  const [groupContacts, setGroupContacts] = useState<GroupContact[]>([])
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [loading, setLoading] = useState(false)

  // 村负责人表单
  const [vFormOpen, setVFormOpen] = useState(false)
  const [vEditing, setVEditing] = useState<VillageContact | null>(null)
  const [vForm, setVForm] = useState({ leader_name: '', leader_phone: '', leader_title: '', contact_name: '', contact_phone: '', start_year: CURRENT_YEAR, end_year: '' as string | number, remark: '' })

  // 组负责人表单
  const [gFormOpen, setGFormOpen] = useState(false)
  const [gEditing, setGEditing] = useState<GroupContact | null>(null)
  const [gForm, setGForm] = useState({ village_group_id: 0, group_no: 1, leader_name: '', leader_phone: '', start_year: CURRENT_YEAR, end_year: '' as string | number, remark: '' })

  // 删除
  const [delTarget, setDelTarget] = useState<{ type: 'village' | 'group'; id: number; label: string } | null>(null)

  // 导入
  const fileVRef = useRef<HTMLInputElement>(null)
  const fileGRef = useRef<HTMLInputElement>(null)

  // ── 下载模板 ──
  const downloadVillageTemplate = () => {
    const headers = ['村名', '负责人姓名', '电话', '职务', '次要联系人', '次要联系人电话', '开始年份', '结束年份', '备注']
    const example = [
      { '村名': '红星村', '负责人姓名': '张三', '电话': '13800001111', '职务': '村支书', '次要联系人': '李四', '次要联系人电话': '13900002222', '开始年份': 2021, '结束年份': 2025, '备注': '' },
      { '村名': '红星村', '负责人姓名': '王五', '电话': '13600003333', '职务': '村委会主任', '次要联系人': '', '次要联系人电话': '', '开始年份': 2026, '结束年份': '', '备注': '留空=至今' },
    ]
    const ws = XLSX.utils.json_to_sheet(example, { header: headers })
    ws['!cols'] = headers.map(() => ({ wch: 16 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '村负责人')
    XLSX.writeFile(wb, '村负责人导入模板.xlsx')
  }

  const downloadGroupTemplate = () => {
    const headers = ['村名', '组号', '组长姓名', '电话', '开始年份', '结束年份', '备注']
    const example = [
      { '村名': '红星村', '组号': 1, '组长姓名': '赵六', '电话': '13700004444', '开始年份': 2023, '结束年份': '', '备注': '留空=至今' },
      { '村名': '红星村', '组号': 2, '组长姓名': '钱七', '电话': '13500005555', '开始年份': 2020, '结束年份': 2025, '备注': '' },
    ]
    const ws = XLSX.utils.json_to_sheet(example, { header: headers })
    ws['!cols'] = headers.map(() => ({ wch: 16 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '组组长')
    XLSX.writeFile(wb, '组组长导入模板.xlsx')
  }

  // ── 处理导入 ──
  const handleImportV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as Record<string, unknown>[]
      if (!rows.length) { show('未读取到数据', 'err'); return }
      const res = await window.electronAPI.invoke('village-contacts:importVillage', rows)
      const r = (res as any)?.data ?? res
      show(`✓ 导入完成：新增 ${r.created || 0} 条，跳过 ${r.skipped || 0} 条`)
      if (selectedVillageId) loadTimeline(selectedVillageId)
    } catch (err) { show('导入失败: ' + (err as Error).message, 'err') }
    if (fileVRef.current) fileVRef.current.value = ''
  }

  const handleImportG = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as Record<string, unknown>[]
      if (!rows.length) { show('未读取到数据', 'err'); return }
      const res = await window.electronAPI.invoke('village-contacts:importGroups', rows)
      const r = (res as any)?.data ?? res
      show(`✓ 导入完成：新增 ${r.created || 0} 条，跳过 ${r.skipped || 0} 条`)
      if (selectedVillageId) loadTimeline(selectedVillageId)
    } catch (err) { show('导入失败: ' + (err as Error).message, 'err') }
    if (fileGRef.current) fileGRef.current.value = ''
  }

  // ── 加载 ──
  const loadVillages = useCallback(async () => {
    const raw = await window.electronAPI.invoke('village-contacts:list')
    const data = (raw as any)?.data ?? raw
    if (data?.villages) setVillages(data.villages)
    if (data?.villages?.length && !selectedVillageId) {
      setSelectedVillageId(data.villages[0].id)
    }
  }, [])

  const loadTimeline = useCallback(async (villageId: number) => {
    setLoading(true)
    try {
      const raw = await window.electronAPI.invoke('village-contacts:timeline', villageId)
      const data = (raw as any)?.data ?? raw
      setTimeline(data?.contacts || [])
      setGroupContacts(data?.groups || [])
    } catch { show('加载失败', 'err') }
    finally { setLoading(false) }
  }, [show])

  const loadGroups = useCallback(async (villageId: number) => {
    const raw = await window.electronAPI.invoke('village-contacts:getGroups', villageId)
    const data = (raw as any)?.data ?? raw
    setGroups(Array.isArray(data) ? data : [])
  }, [])

  useEffect(() => { loadVillages() }, [loadVillages])
  useEffect(() => {
    if (selectedVillageId) { loadTimeline(selectedVillageId); loadGroups(selectedVillageId) }
  }, [selectedVillageId, loadTimeline, loadGroups])

  // ── 村负责人 CRUD ──
  const openVAdd = () => {
    if (!selectedVillageId) return
    setVEditing(null)
    setVForm({ leader_name: '', leader_phone: '', leader_title: '', contact_name: '', contact_phone: '', start_year: CURRENT_YEAR, end_year: '', remark: '' })
    setVFormOpen(true)
  }

  const openVEdit = (c: VillageContact) => {
    setVEditing(c)
    setVForm({
      leader_name: c.leader_name, leader_phone: c.leader_phone, leader_title: c.leader_title,
      contact_name: c.contact_name, contact_phone: c.contact_phone,
      start_year: c.start_year, end_year: c.end_year != null ? c.end_year : '', remark: c.remark || '',
    })
    setVFormOpen(true)
  }

  const submitV = async () => {
    if (!selectedVillageId || !vForm.leader_name.trim()) { show('请填写负责人姓名', 'err'); return }
    const body: Record<string, unknown> = {
      village_id: selectedVillageId,
      leader_name: vForm.leader_name.trim(),
      leader_phone: vForm.leader_phone.trim(),
      leader_title: vForm.leader_title,
      contact_name: vForm.contact_name.trim(),
      contact_phone: vForm.contact_phone.trim(),
      start_year: Number(vForm.start_year) || CURRENT_YEAR,
      end_year: vForm.end_year !== '' ? Number(vForm.end_year) : null,
      remark: vForm.remark,
    }
    try {
      if (vEditing) {
        await window.electronAPI.invoke('village-contacts:update', { id: vEditing.id, ...body })
      } else {
        await window.electronAPI.invoke('village-contacts:create', body)
      }
      show(vEditing ? '已更新' : '已添加')
      setVFormOpen(false)
      if (selectedVillageId) loadTimeline(selectedVillageId)
    } catch (e) { show('保存失败: ' + (e as Error).message, 'err') }
  }

  // ── 组负责人 CRUD ──
  const openGAdd = () => {
    if (!selectedVillageId) return
    setGEditing(null)
    setGForm({ village_group_id: 0, group_no: 1, leader_name: '', leader_phone: '', start_year: CURRENT_YEAR, end_year: '', remark: '' })
    setGFormOpen(true)
  }

  const openGEdit = (g: GroupContact) => {
    setGEditing(g)
    setGForm({
      village_group_id: g.village_group_id, group_no: g.group_no,
      leader_name: g.leader_name, leader_phone: g.leader_phone,
      start_year: g.start_year, end_year: g.end_year != null ? g.end_year : '', remark: g.remark || '',
    })
    setGFormOpen(true)
  }

  const submitG = async () => {
    if (!selectedVillageId || !gForm.leader_name.trim()) { show('请填写组长姓名', 'err'); return }
    if (!gForm.village_group_id) { show('请选择组别', 'err'); return }
    const body: Record<string, unknown> = {
      village_id: selectedVillageId,
      village_group_id: gForm.village_group_id,
      group_no: gForm.group_no,
      leader_name: gForm.leader_name.trim(),
      leader_phone: gForm.leader_phone.trim(),
      start_year: Number(gForm.start_year) || CURRENT_YEAR,
      end_year: gForm.end_year !== '' ? Number(gForm.end_year) : null,
      remark: gForm.remark,
    }
    try {
      if (gEditing) {
        await window.electronAPI.invoke('village-contacts:updateGroup', { id: gEditing.id, ...body })
      } else {
        await window.electronAPI.invoke('village-contacts:createGroup', body)
      }
      show(gEditing ? '已更新' : '已添加')
      setGFormOpen(false)
      if (selectedVillageId) loadTimeline(selectedVillageId)
    } catch (e) { show('保存失败: ' + (e as Error).message, 'err') }
  }

  // ── 删除 ──
  const doDelete = async () => {
    if (!delTarget) return
    const channel = delTarget.type === 'village' ? 'village-contacts:delete' : 'village-contacts:deleteGroup'
    await window.electronAPI.invoke(channel, delTarget.id)
    show('已删除')
    setDelTarget(null)
    if (selectedVillageId) loadTimeline(selectedVillageId)
  }

  // ── 视图 ──
  const selectedVillageName = villages.find(v => v.id === selectedVillageId)?.village_name || ''

  const inner = (
    <div className="flex gap-4" style={{ minHeight: 520 }}>
      {/* ═══ 左侧：村庄列表 ═══ */}
      <div className="w-44 shrink-0 bg-white border border-border rounded-card overflow-hidden shadow-sm flex flex-col">
        <div className="px-3 py-2.5 border-b border-border bg-warm/30 text-xs font-semibold text-text-muted">
          🏘 村庄列表
        </div>
        <div className="flex-1 overflow-y-auto">
          {villages.length === 0 ? (
            <p className="text-xs text-text-muted/50 px-3 py-4">暂无村庄</p>
          ) : (
            villages.map(v => (
              <button
                key={v.id}
                onClick={() => setSelectedVillageId(v.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors border-b border-border/30
                  ${selectedVillageId === v.id
                    ? 'bg-primary-500/5 text-primary font-medium border-l-2 border-l-primary-500'
                    : 'text-text-primary hover:bg-warm/20'}`}
              >
                {v.village_name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* ═══ 右侧：时间线 + 组组长 ═══ */}
      <div className="flex-1 min-w-0 space-y-4">
        {!selectedVillageId ? (
          <div className="text-center text-text-muted/50 pt-20 text-sm">← 选择左侧村庄查看联系人</div>
        ) : loading ? (
          <div className="text-center text-text-muted pt-20 text-sm">加载中…</div>
        ) : (
          <>
            {/* 村负责人时间线 */}
            <div className="bg-white border border-border rounded-card shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-warm/30 flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary">
                  🏘 {selectedVillageName} · 负责人时间线
                </h3>
                <div className="flex items-center gap-2">
                  <button onClick={downloadVillageTemplate}
                    className="px-2 py-1 text-xs border border-blue-200 text-blue-600 rounded-btn hover:bg-blue-50">↓ 模板</button>
                  <button onClick={() => fileVRef.current?.click()}
                    className="px-2 py-1 text-xs border border-border rounded-btn hover:bg-warm/20 text-text-muted">📥 导入</button>
                  <input ref={fileVRef} type="file" accept=".xlsx,.xls" onChange={handleImportV} className="hidden" />
                  <button onClick={openVAdd}
                    className="px-3 py-1.5 text-xs bg-primary-500 text-white rounded-btn hover:bg-primary-600">
                    + 新增负责人
                  </button>
                </div>
              </div>

              <div className="p-4">
                {timeline.length === 0 ? (
                  <p className="text-xs text-text-muted/50 text-center py-8">暂未设置负责人</p>
                ) : (
                  <div className="space-y-3">
                    {timeline.map((c, idx) => {
                      const isCurrent = c.end_year === null
                      return (
                        <div key={c.id}
                          className={`relative border rounded-card pl-4 pr-3 py-3 transition-colors
                            ${isCurrent
                              ? 'border-emerald-300 bg-emerald-50/30'
                              : 'border-border/50 bg-warm/10'}`}
                        >
                          {/* 左侧时间标记 */}
                          <div className="flex items-start gap-3">
                            <div className={`shrink-0 w-20 text-center pt-0.5
                              ${isCurrent ? 'text-emerald-700' : 'text-text-muted'}`}>
                              <div className="text-xs font-mono font-bold">
                                {c.start_year}
                              </div>
                              <div className="text-[10px] leading-tight">
                                {isCurrent ? '至今' : (c.end_year ?? '—')}
                              </div>
                              {isCurrent && (
                                <div className="mt-1 mx-auto w-4 h-1 rounded-full bg-emerald-400" />
                              )}
                            </div>

                            {/* 连线指示 */}
                            {idx < timeline.length - 1 && (
                              <div className="absolute left-[52px] top-[56px] w-px h-5 bg-border/50" />
                            )}

                            {/* 内容 */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-text-primary">{c.leader_name || '—'}</span>
                                {c.leader_title && (
                                  <span className="text-xs bg-primary-100 text-primary px-1.5 py-0.5 rounded">{c.leader_title}</span>
                                )}
                                {isCurrent && (
                                  <span className="text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-medium">现任</span>
                                )}
                              </div>

                              <div className="mt-1 flex items-center gap-3 text-xs text-text-muted flex-wrap">
                                {c.leader_phone && (
                                  <span className="font-mono">📞 {c.leader_phone}</span>
                                )}
                                {c.contact_name && (
                                  <span>📋 联系人：{c.contact_name}{c.contact_phone ? ` · ${c.contact_phone}` : ''}</span>
                                )}
                              </div>
                              {c.remark && (
                                <p className="mt-1 text-xs text-text-muted/60">{c.remark}</p>
                              )}
                            </div>

                            {/* 操作 */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => openVEdit(c)}
                                className="px-2 py-1 text-xs border border-border rounded hover:bg-warm/20 text-text-muted">编辑</button>
                              <button onClick={() => setDelTarget({ type: 'village', id: c.id, label: `${c.leader_name} (${c.start_year}–${c.end_year ?? '至今'})` })}
                                className="px-2 py-1 text-xs border border-red-100 text-red-400 rounded hover:bg-red-50">删</button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 组组长 */}
            <div className="bg-white border border-border rounded-card shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-warm/30 flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary">
                  📌 {selectedVillageName} · 各组组长
                </h3>
                <div className="flex items-center gap-2">
                  <button onClick={downloadGroupTemplate}
                    className="px-2 py-1 text-xs border border-blue-200 text-blue-600 rounded-btn hover:bg-blue-50">↓ 模板</button>
                  <button onClick={() => fileGRef.current?.click()}
                    className="px-2 py-1 text-xs border border-border rounded-btn hover:bg-warm/20 text-text-muted">📥 导入</button>
                  <input ref={fileGRef} type="file" accept=".xlsx,.xls" onChange={handleImportG} className="hidden" />
                  <button onClick={openGAdd}
                    className="px-3 py-1.5 text-xs bg-primary-500 text-white rounded-btn hover:bg-primary-600">
                    + 新增组长
                  </button>
                </div>
              </div>

              <div className="p-4">
                {groupContacts.length === 0 ? (
                  <p className="text-xs text-text-muted/50 text-center py-8">暂未设置组长</p>
                ) : (
                  <div className="space-y-2">
                    {groupContacts.map(g => {
                      const isCurrent = g.end_year === null
                      return (
                        <div key={g.id}
                          className={`flex items-center gap-3 border rounded-btn px-3 py-2.5 text-sm
                            ${isCurrent ? 'border-emerald-300 bg-emerald-50/30' : 'border-border/50 bg-warm/10'}`}
                        >
                          <span className="shrink-0 font-bold text-text-primary w-12">
                            第{g.group_no}组
                          </span>
                          <span className="font-mono text-xs text-text-muted min-w-[60px]">
                            {g.start_year}–{g.end_year ?? '至今'}
                          </span>
                          <span className="font-bold">{g.leader_name || '—'}</span>
                          {g.leader_phone && <span className="font-mono text-xs text-text-muted">📞 {g.leader_phone}</span>}
                          {isCurrent && (
                            <span className="text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">现任</span>
                          )}
                          <div className="ml-auto flex items-center gap-1">
                            <button onClick={() => openGEdit(g)}
                              className="px-2 py-1 text-xs border border-border rounded hover:bg-warm/20 text-text-muted">编辑</button>
                            <button onClick={() => setDelTarget({ type: 'group', id: g.id, label: `第${g.group_no}组 · ${g.leader_name}` })}
                              className="px-2 py-1 text-xs border border-red-100 text-red-400 rounded hover:bg-red-50">删</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ═══ 村负责人弹窗 ═══ */}
      <Modal open={vFormOpen} title={vEditing ? '编辑负责人' : '新增负责人'} onClose={() => setVFormOpen(false)}
        onConfirm={submitV} confirmText={vEditing ? '保存' : '新增'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">负责人姓名 *</label>
              <input value={vForm.leader_name} onChange={e => setVForm(f => ({ ...f, leader_name: e.target.value }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">负责人电话</label>
              <input value={vForm.leader_phone} onChange={e => setVForm(f => ({ ...f, leader_phone: e.target.value }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">职务</label>
            <select value={vForm.leader_title} onChange={e => setVForm(f => ({ ...f, leader_title: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              <option value="">请选择</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">次要联系人</label>
              <input value={vForm.contact_name} onChange={e => setVForm(f => ({ ...f, contact_name: e.target.value }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" placeholder="姓名" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">联系人电话</label>
              <input value={vForm.contact_phone} onChange={e => setVForm(f => ({ ...f, contact_phone: e.target.value }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" placeholder="手机号" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">开始年份 *</label>
              <input type="number" min={2000} max={2099} value={vForm.start_year}
                onChange={e => setVForm(f => ({ ...f, start_year: Number(e.target.value) || CURRENT_YEAR }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">结束年份 <span className="text-text-muted/50">（留空=至今）</span></label>
              <input type="number" min={2000} max={2099} value={vForm.end_year}
                onChange={e => setVForm(f => ({ ...f, end_year: e.target.value ? Number(e.target.value) : '' }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">备注</label>
            <input value={vForm.remark} onChange={e => setVForm(f => ({ ...f, remark: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
          </div>
        </div>
      </Modal>

      {/* ═══ 组负责人弹窗 ═══ */}
      <Modal open={gFormOpen} title={gEditing ? '编辑组长' : '新增组长'} onClose={() => setGFormOpen(false)}
        onConfirm={submitG} confirmText={gEditing ? '保存' : '新增'}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">所属组 *</label>
            <select value={gForm.village_group_id || ''}
              onChange={e => {
                const vgId = Number(e.target.value)
                const g = groups.find(x => x.village_group_id === vgId)
                setGForm(f => ({ ...f, village_group_id: vgId, group_no: g?.group_no || 1 }))
              }}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              <option value="">请选择组</option>
              {groups.map(g => (
                <option key={g.village_group_id} value={g.village_group_id}>第{g.group_no}组</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">组长姓名 *</label>
              <input value={gForm.leader_name} onChange={e => setGForm(f => ({ ...f, leader_name: e.target.value }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">组长电话</label>
              <input value={gForm.leader_phone} onChange={e => setGForm(f => ({ ...f, leader_phone: e.target.value }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">开始年份 *</label>
              <input type="number" min={2000} max={2099} value={gForm.start_year}
                onChange={e => setGForm(f => ({ ...f, start_year: Number(e.target.value) || CURRENT_YEAR }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">结束年份 <span className="text-text-muted/50">（留空=至今）</span></label>
              <input type="number" min={2000} max={2099} value={gForm.end_year}
                onChange={e => setGForm(f => ({ ...f, end_year: e.target.value ? Number(e.target.value) : '' }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">备注</label>
            <input value={gForm.remark} onChange={e => setGForm(f => ({ ...f, remark: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
          </div>
        </div>
      </Modal>

      {/* ═══ 删除确认 ═══ */}
      <Modal open={!!delTarget} title="确认删除" onClose={() => setDelTarget(null)}
        onConfirm={doDelete} confirmText="确认删除">
        <p className="text-sm text-text-primary">
          删除后将无法恢复。确认删除 <strong>{delTarget?.label}</strong> 吗？
        </p>
      </Modal>

      <Toast {...toast} />
    </div>
  )

  return embedded ? inner : <div className="p-5 max-w-6xl mx-auto">{inner}</div>
}
