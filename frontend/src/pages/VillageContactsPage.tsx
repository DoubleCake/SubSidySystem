/**
 * 村联系人管理页 — 全量表格 + 村名列
 */
import { useState, useEffect, useRef } from 'react'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface Contact {
  id: number; village_id: number; village_name?: string; name: string; phone: string
  position: string; is_agri_lead: boolean; sort_order: number; remark: string
}

interface Village { id: number; village_name: string }

const POSITIONS = ["书记", "副书记", "副主任", "文书", "其他"]
const POS_ORDER: Record<string, number> = { 书记: 1, 副书记: 2, 副主任: 3, 文书: 4, 其他: 5 }

export default function VillageContactsPage({ embedded }: { embedded?: boolean }) {
  const { toast, show } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [contacts, setContacts] = useState<Contact[]>([])
  const [villages, setVillages] = useState<Village[]>([])
  const [loading, setLoading] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [filterPos, setFilterPos] = useState('')
  const [sortMode, setSortMode] = useState<'name' | 'position' | 'village'>('village')
  const [searchText, setSearchText] = useState('')

  // 表单
  const [editing, setEditing] = useState<Contact | null>(null)
  const [form, setForm] = useState({ village_id: 0, name: '', phone: '', position: '', is_agri_lead: false, remark: '' })
  const [showForm, setShowForm] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/village-contacts').then(r => r.json())
      const vmap: Record<number, string> = {};
      (res.villages || []).forEach((v: Village) => { vmap[v.id] = v.village_name })
      setContacts((res.items || []).map((c: Contact) => ({ ...c, village_name: vmap[c.village_id] || '' })))
      if (!villages.length) setVillages(res.villages || [])
    } catch { show('加载失败', 'err') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => { setForm({ village_id: villages[0]?.id || 0, name: '', phone: '', position: '', is_agri_lead: false, remark: '' }); setEditing(null) }
  const openAdd = () => { resetForm(); setShowForm(true) }
  const openEdit = (c: Contact) => {
    setForm({ village_id: c.village_id, name: c.name, phone: c.phone, position: c.position, is_agri_lead: c.is_agri_lead, remark: c.remark })
    setEditing(c); setShowForm(true)
  }

  const submit = async () => {
    if (!form.name.trim()) { show('请输入姓名', 'err'); return }
    if (!form.village_id) { show('请选择村', 'err'); return }
    const body: Record<string, unknown> = {
      village_id: form.village_id, name: form.name.trim(), phone: form.phone.trim(),
      position: form.position, is_agri_lead: form.is_agri_lead, remark: form.remark,
    }
    try {
      const method = editing ? 'PUT' : 'POST'
      const url = editing ? `/api/village-contacts/${editing.id}` : '/api/village-contacts'
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      show(editing ? '已更新' : '已添加')
      setShowForm(false); resetForm(); load()
    } catch { show('保存失败', 'err') }
  }

  const del = async (c: Contact) => {
    if (!confirm(`删除联系人「${c.village_name} - ${c.name}」？`)) return
    await fetch(`/api/village-contacts/${c.id}`, { method: 'DELETE' })
    show('已删除'); load()
  }

  const toggleLead = async (c: Contact) => {
    if (c.is_agri_lead) {
      await fetch(`/api/village-contacts/${c.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_agri_lead: false }),
      })
      show(`已取消「${c.name}」的负责人身份`)
    } else {
      await fetch(`/api/village-contacts/set-lead/${c.id}`, { method: 'POST' })
      show(`已将「${c.name}」设为 ${c.village_name} 农业负责人`)
    }
    load()
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) { show('请选择文件', 'err'); return }
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`/api/village-contacts/import?overwrite=${overwrite}`, { method: 'POST', body: formData }).then(r => r.json())
      const parts = [`新增 ${res.created} 条`]
      if (res.updated) parts.push(`更新 ${res.updated} 条`)
      if (res.errors?.length) parts.push(`错误 ${res.errors.length} 条`)
      show(parts.join('，'))
      load()
    } catch { show('导入失败', 'err') }
    if (fileRef.current) fileRef.current.value = ''
  }

  // 筛选 & 排序
  let display = contacts
  if (filterPos) display = display.filter(c => c.position === filterPos)
  if (searchText) {
    const s = searchText.toLowerCase()
    display = display.filter(c => c.name.includes(s) || (c.village_name || '').includes(s) || c.phone.includes(s))
  }
  const sortFn: Record<string, (a: Contact, b: Contact) => number> = {
    village: (a, b) => (a.village_name || '').localeCompare(b.village_name || '', 'zh') || (POS_ORDER[a.position || '其他'] || 99) - (POS_ORDER[b.position || '其他'] || 99),
    position: (a, b) => (POS_ORDER[a.position || '其他'] || 99) - (POS_ORDER[b.position || '其他'] || 99),
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
  }
  display = [...display].sort(sortFn[sortMode])

  const inner = (
    <>
      {!embedded && <h1 className="text-xl font-bold mb-4">📋 村联系人管理</h1>}

      {/* 操作栏 */}
      <div className="bg-white border border-border rounded-card p-3 mb-4 flex items-center gap-3 flex-wrap">
        <button onClick={openAdd} className="px-3 py-2 text-sm bg-primary  rounded-btn hover:bg-primary/90">＋ 新增</button>
        <button onClick={() => fileRef.current?.click()} className="px-3 py-2 text-sm border border-border rounded-btn hover:bg-warm/20">📥 导入</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
        <label className="flex items-center gap-1 text-sm text-text-muted cursor-pointer select-none">
          <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
          覆盖同名
        </label>
        <a href="/api/village-contacts/template" download
          className="px-3 py-2 text-sm border border-blue-200 text-blue-600 rounded-btn hover:bg-blue-50">📥 下载模板</a>
        <a href="/api/village-contacts/export" target="_blank"
          className="px-3 py-2 text-sm border border-green-200 text-green-700 rounded-btn hover:bg-green-50">📤 导出</a>

        <div className="w-px h-6 bg-border" />
        <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="🔍 搜索姓名/村名/电话"
          className="border border-border rounded-btn px-2 py-2 text-sm outline-none w-44" />
        <select value={filterPos} onChange={e => setFilterPos(e.target.value)}
          className="border border-border rounded-btn px-2 py-2 text-sm outline-none bg-white">
          <option value="">全部职务</option>
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex gap-0 bg-warm/20 rounded-btn text-sm">
          {(['village', 'position', 'name'] as const).map(m => (
            <button key={m} onClick={() => setSortMode(m)}
              className={`px-3 py-1.5 rounded-btn transition-colors ${sortMode === m ? 'bg-white shadow-sm font-medium' : 'text-text-muted hover:text-text-primary'}`}>
              按{m === 'village' ? '村' : m === 'position' ? '职务' : '姓名'}
            </button>
          ))}
        </div>
        <span className="text-sm text-text-muted ml-auto">{display.length} 人</span>
      </div>

      {/* 联系人表格 */}
      {loading ? (
        <div className="text-center text-text-muted py-10">加载中…</div>
      ) : display.length === 0 ? (
        <div className="text-center text-text-muted py-12 text-sm">{contacts.length === 0 ? '暂无联系人，请新增或导入' : '无匹配结果'}</div>
      ) : (
        <div className="bg-white border border-border rounded-card overflow-hidden shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-warm/30 border-b-2 border-border">
                <th className="text-left px-3 py-2.5 whitespace-nowrap">村名</th>
                <th className="text-left px-3 py-2.5 whitespace-nowrap">姓名</th>
                <th className="text-left px-3 py-2.5 whitespace-nowrap">电话</th>
                <th className="text-left px-3 py-2.5 whitespace-nowrap">职务</th>
                <th className="text-center px-3 py-2.5 whitespace-nowrap">农业负责人</th>
                <th className="text-left px-3 py-2.5 whitespace-nowrap">备注</th>
                <th className="text-right px-3 py-2.5 whitespace-nowrap w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {display.map(c => (
                <tr key={c.id} className={`border-b border-border/30 hover:bg-warm/10 ${c.is_agri_lead ? 'bg-emerald-50/30' : ''}`}>
                  <td className="px-3 py-2 font-medium">{c.village_name}</td>
                  <td className="px-3 py-2 font-bold">{c.name}</td>
                  <td className="px-3 py-2 font-mono">
                    {c.phone ? <a href={`tel:${c.phone}`} className="text-blue-600 hover:underline">{c.phone}</a> : <span className="text-text-muted/50">—</span>}
                  </td>
                  <td className="px-3 py-2">{c.position || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => toggleLead(c)}
                      className={`px-2 py-1 text-xs rounded-btn border transition-colors ${
                        c.is_agri_lead
                          ? 'bg-amber-50 border-amber-300 text-amber-600 hover:bg-red-50 hover:border-red-200 hover:text-red-400'
                          : 'border-transparent text-text-muted/30 hover:border-amber-200 hover:text-amber-500'
                      }`}
                      title={c.is_agri_lead ? `取消「${c.name}」的负责人` : `设为${c.village_name}负责人`}>
                      ⭐ 负责人
                    </button>
                  </td>
                  <td className="px-3 py-2 text-text-muted max-w-[120px] truncate" title={c.remark}>{c.remark || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEdit(c)} className="px-2 py-1 text-xs border border-border rounded hover:bg-warm/20">编辑</button>
                      <button onClick={() => del(c)} className="px-2 py-1 text-xs border border-red-100 text-red-400 rounded hover:bg-red-50">删</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-card shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editing ? '编辑联系人' : '新增联系人'}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-text-muted mb-1">所属村 *</label>
                <select value={form.village_id || ''} onChange={e => setForm(f => ({ ...f, village_id: Number(e.target.value) }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                  <option value="">请选择</option>
                  {villages.map(v => <option key={v.id} value={v.id}>{v.village_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-text-muted mb-1">姓名 *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" placeholder="姓名" />
              </div>
              <div>
                <label className="block text-sm text-text-muted mb-1">电话</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" placeholder="手机号" />
              </div>
              <div>
                <label className="block text-sm text-text-muted mb-1">职务</label>
                <select value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                  <option value="">请选择</option>
                  {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is_lead_cb2" checked={form.is_agri_lead}
                  onChange={e => setForm(f => ({ ...f, is_agri_lead: e.target.checked }))} />
                <label htmlFor="is_lead_cb2" className="text-sm text-text-muted">设为农业负责人（同村只允许一个）</label>
              </div>
              <div>
                <label className="block text-sm text-text-muted mb-1">备注</label>
                <input value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" placeholder="备注信息" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-border rounded-btn hover:bg-warm/20">取消</button>
              <button onClick={submit} className="px-4 py-2 text-sm bg-primary  rounded-btn hover:bg-primary/90">保存</button>
            </div>
          </div>
        </div>
      )}
      <Toast {...toast} />
    </>
  )

  return embedded ? inner : <div className="p-5 max-w-5xl mx-auto">{inner}</div>
}
