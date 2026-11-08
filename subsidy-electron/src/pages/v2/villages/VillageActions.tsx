/**
 * 村组负责人维护：村负责人 + 村民组组长的新增/编辑/删除
 */
import { useEffect, useState } from 'react'
import { useToast } from '../../../hooks/useToast'
import { Ico } from '../Icons'
import type { VillageDetail } from '../types'

const CURRENT_YEAR = new Date().getFullYear()

interface VillageContact {
  id: number
  leader_name: string
  leader_phone: string
  leader_title?: string
  contact_name?: string
  contact_phone?: string
  start_year: number
  end_year: number | null
  remark?: string
}

interface GroupContact {
  id: number
  village_group_id: number
  group_no: number
  leader_name: string
  leader_phone: string
  start_year: number
  end_year: number | null
  remark?: string
}

const emptyV = () => ({
  leader_name: '', leader_phone: '', leader_title: '村主任',
  contact_name: '', contact_phone: '',
  start_year: String(CURRENT_YEAR), end_year: '', remark: '',
})

const emptyG = () => ({
  village_group_id: 0, group_no: 1,
  leader_name: '', leader_phone: '',
  start_year: String(CURRENT_YEAR), end_year: '', remark: '',
})

/** 详情头部操作按钮 */
export function VillageActions({ villageId, onChanged }: { villageId: number; onChanged: () => void }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<VillageContact | null>(null)
  const [form, setForm] = useState(emptyV())
  const [busy, setBusy] = useState(false)

  const openAdd = () => { setEditing(null); setForm(emptyV()); setOpen(true) }
  const openEdit = (c: VillageContact) => {
    setEditing(c)
    setForm({
      leader_name: c.leader_name, leader_phone: c.leader_phone,
      leader_title: c.leader_title || '', contact_name: c.contact_name || '',
      contact_phone: c.contact_phone || '',
      start_year: String(c.start_year), end_year: c.end_year != null ? String(c.end_year) : '',
      remark: c.remark || '',
    })
    setOpen(true)
  }

  const submit = async () => {
    if (!form.leader_name.trim()) { show('请填写负责人姓名', 'err'); return }
    setBusy(true)
    try {
      const body = {
        village_id: villageId,
        leader_name: form.leader_name.trim(),
        leader_phone: form.leader_phone.trim(),
        leader_title: form.leader_title,
        contact_name: form.contact_name.trim(),
        contact_phone: form.contact_phone.trim(),
        start_year: Number(form.start_year) || CURRENT_YEAR,
        end_year: form.end_year !== '' ? Number(form.end_year) : null,
        remark: form.remark,
      }
      if (editing) await window.electronAPI.invoke('village-contacts:update', { id: editing.id, ...body })
      else await window.electronAPI.invoke('village-contacts:create', body)
      show(editing ? '已更新' : '已添加')
      setOpen(false)
      onChanged()
    } catch (e) { show((e as Error).message, 'err') }
    finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={openAdd}
        className="h-7 px-2.5 rounded-btn bg-[#2F5C46] text-[11px] text-white font-medium hover:bg-[#234A38] transition-colors inline-flex items-center gap-1">
        <Ico name="create" size={12} />变更负责人
      </button>

      {open && (
        <Modal title={editing ? '编辑负责人' : '新增负责人'} busy={busy} onClose={() => setOpen(false)} onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="负责人姓名 *">
              <input value={form.leader_name} onChange={e => setForm(f => ({ ...f, leader_name: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="联系电话">
              <input value={form.leader_phone} onChange={e => setForm(f => ({ ...f, leader_phone: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="职务">
              <input value={form.leader_title} onChange={e => setForm(f => ({ ...f, leader_title: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="联系人">
              <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="联系人电话">
              <input value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} className={inputCls} />
            </Field>
            <div />
            <Field label="起始年">
              <input value={form.start_year} onChange={e => setForm(f => ({ ...f, start_year: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="结束年（留空=至今）">
              <input value={form.end_year} onChange={e => setForm(f => ({ ...f, end_year: e.target.value }))} className={inputCls} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}

/** 村负责人记录表（带编辑） */
export function VillageContactTable({ villageId, contacts, onChanged }: {
  villageId: number; contacts: VillageContact[]; onChanged: () => void
}) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<VillageContact | null>(null)
  const [form, setForm] = useState(emptyV())
  const [busy, setBusy] = useState(false)

  const openEdit = (c: VillageContact) => {
    setEditing(c)
    setForm({
      leader_name: c.leader_name, leader_phone: c.leader_phone,
      leader_title: c.leader_title || '', contact_name: c.contact_name || '',
      contact_phone: c.contact_phone || '',
      start_year: String(c.start_year), end_year: c.end_year != null ? String(c.end_year) : '',
      remark: c.remark || '',
    })
    setOpen(true)
  }

  const submit = async () => {
    if (!form.leader_name.trim()) { show('请填写负责人姓名', 'err'); return }
    setBusy(true)
    try {
      await window.electronAPI.invoke('village-contacts:update', {
        id: editing!.id, village_id: villageId,
        leader_name: form.leader_name.trim(), leader_phone: form.leader_phone.trim(),
        leader_title: form.leader_title, contact_name: form.contact_name.trim(),
        contact_phone: form.contact_phone.trim(),
        start_year: Number(form.start_year) || CURRENT_YEAR,
        end_year: form.end_year !== '' ? Number(form.end_year) : null,
        remark: form.remark,
      })
      show('已更新'); setOpen(false); onChanged()
    } catch (e) { show((e as Error).message, 'err') }
    finally { setBusy(false) }
  }

  const remove = async (c: VillageContact) => {
    if (!window.confirm(`删除负责人记录「${c.leader_name}」？`)) return
    try {
      await window.electronAPI.invoke('village-contacts:delete', c.id)
      show('已删除'); onChanged()
    } catch (e) { show((e as Error).message, 'err') }
  }

  return (
    <>
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#EFE7D8] text-[#5C5749] text-[10px] text-left h-[26px] border-b border-[#D2CBBC]">
            <th className="font-semibold px-2.5">姓名</th>
            <th className="font-semibold px-1.5">电话</th>
            <th className="font-semibold px-2.5">任期</th>
            <th className="font-semibold px-2.5 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map(c => (
            <tr key={c.id} className="border-t border-[#E6E0D4] h-[30px] hover:bg-[#F2F7F4] transition-colors">
              <td className="px-2.5 font-semibold">{c.leader_name}</td>
              <td className="px-1.5 font-mono text-[#7A7466]">{c.leader_phone || '—'}</td>
              <td className="px-2.5 text-[10px] text-[#7A7466]">{c.start_year} — {c.end_year ?? '至今'}</td>
              <td className="px-2.5 text-right whitespace-nowrap">
                <button onClick={() => openEdit(c)}
                  className="text-[10px] px-1.5 py-[1px] rounded-[3px] bg-[#E2EDE6] text-[#2F5C46] hover:bg-[#DCE9E1] inline-flex items-center gap-0.5">
                  <Ico name="edit" size={9} />编辑
                </button>
                <button onClick={() => remove(c)}
                  className="ml-1.5 text-[10px] px-1.5 py-[1px] rounded-[3px] bg-[#FCEAE8] text-[#A81D1D] hover:bg-[#F9D9D4] inline-flex items-center gap-0.5">
                  <Ico name="delete" size={9} />删除
                </button>
              </td>
            </tr>
          ))}
          {contacts.length === 0 && (
            <tr><td colSpan={4} className="py-8 text-center text-[11px] text-[#A8A091]">暂无负责人记录</td></tr>
          )}
        </tbody>
      </table>

      {open && (
        <Modal title="编辑负责人" busy={busy} onClose={() => setOpen(false)} onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="负责人姓名 *">
              <input value={form.leader_name} onChange={e => setForm(f => ({ ...f, leader_name: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="联系电话">
              <input value={form.leader_phone} onChange={e => setForm(f => ({ ...f, leader_phone: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="起始年">
              <input value={form.start_year} onChange={e => setForm(f => ({ ...f, start_year: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="结束年（留空=至今）">
              <input value={form.end_year} onChange={e => setForm(f => ({ ...f, end_year: e.target.value }))} className={inputCls} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}

/** 组长维护：在村民组表格的行内提供编辑 */
export function GroupLeaderEditor({ villageId, group, onChanged }: {
  villageId: number; group: { id: number; group_no: number; leader_name?: string | null }; onChanged: () => void
}) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [contacts, setContacts] = useState<GroupContact[]>([])
  const [editing, setEditing] = useState<GroupContact | null>(null)
  const [form, setForm] = useState(emptyG())
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const r = await window.electronAPI.invoke<any>('village-contacts:getGroups', villageId)
      const all: GroupContact[] = r?.data ?? r ?? []
      setContacts(all.filter(c => c.village_group_id === group.id))
    } catch { setContacts([]) }
  }

  useEffect(() => { if (open) load() }, [open, villageId, group.id])

  const openAdd = () => {
    setEditing(null)
    setForm({ ...emptyG(), village_group_id: group.id, group_no: group.group_no })
    setOpen(true)
  }

  const openEdit = (c: GroupContact) => {
    setEditing(c)
    setForm({
      village_group_id: c.village_group_id, group_no: c.group_no,
      leader_name: c.leader_name, leader_phone: c.leader_phone,
      start_year: String(c.start_year), end_year: c.end_year != null ? String(c.end_year) : '',
      remark: c.remark || '',
    })
    setOpen(true)
  }

  const submit = async () => {
    if (!form.leader_name.trim()) { show('请填写组长姓名', 'err'); return }
    setBusy(true)
    try {
      const body = {
        village_id: villageId, village_group_id: form.village_group_id, group_no: form.group_no,
        leader_name: form.leader_name.trim(), leader_phone: form.leader_phone.trim(),
        start_year: Number(form.start_year) || CURRENT_YEAR,
        end_year: form.end_year !== '' ? Number(form.end_year) : null,
        remark: form.remark,
      }
      if (editing) await window.electronAPI.invoke('village-contacts:updateGroup', { id: editing.id, ...body })
      else await window.electronAPI.invoke('village-contacts:createGroup', body)
      show(editing ? '已更新' : '已添加')
      setEditing(null); setForm({ ...emptyG(), village_group_id: group.id, group_no: group.group_no })
      load(); onChanged()
    } catch (e) { show((e as Error).message, 'err') }
    finally { setBusy(false) }
  }

  const remove = async (c: GroupContact) => {
    if (!window.confirm(`删除组长记录「${c.leader_name}」？`)) return
    try {
      await window.electronAPI.invoke('village-contacts:deleteGroup', c.id)
      show('已删除'); load(); onChanged()
    } catch (e) { show((e as Error).message, 'err') }
  }

  return (
    <>
      <button onClick={openAdd} className="text-[10px] text-[#2F5C46] hover:underline">变更</button>

      {open && (
        <Modal title={`${group.group_no} 组 · 组长记录`} busy={busy} onClose={() => setOpen(false)} onSubmit={submit}
          submitText={editing ? '保存修改' : '添加'}>
          <div className="flex flex-col gap-2 mb-3 max-h-[160px] overflow-y-auto">
            {contacts.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-[11px] border-b border-[#E6E0D4] pb-1.5">
                <b>{c.leader_name}</b>
                <span className="font-mono text-[#7A7466]">{c.leader_phone || '—'}</span>
                <span className="text-[10px] text-[#7A7466]">{c.start_year} — {c.end_year ?? '至今'}</span>
                <span className="ml-auto flex gap-1">
                  <button onClick={() => openEdit(c)} className="text-[10px] px-1.5 rounded-[3px] bg-[#E2EDE6] text-[#2F5C46]">编辑</button>
                  <button onClick={() => remove(c)} className="text-[10px] px-1.5 rounded-[3px] bg-[#FCEAE8] text-[#A81D1D]">删除</button>
                </span>
              </div>
            ))}
            {contacts.length === 0 && <div className="text-[11px] text-[#A8A091] text-center py-2">暂无记录</div>}
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-[#E6E0D4] pt-3">
            <Field label="组长姓名 *">
              <input value={form.leader_name} onChange={e => setForm(f => ({ ...f, leader_name: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="联系电话">
              <input value={form.leader_phone} onChange={e => setForm(f => ({ ...f, leader_phone: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="起始年">
              <input value={form.start_year} onChange={e => setForm(f => ({ ...f, start_year: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="结束年（留空=至今）">
              <input value={form.end_year} onChange={e => setForm(f => ({ ...f, end_year: e.target.value }))} className={inputCls} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}

// ── 通用 ──
const inputCls = 'w-full h-8 border border-[#D2CBBC] rounded-btn px-2.5 text-[12px] outline-none focus:border-[#2F5C46]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-[#7A7466] mb-1">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, children, busy, onClose, onSubmit, submitText = '保存' }: {
  title: string; children: React.ReactNode; busy: boolean
  onClose: () => void; onSubmit: () => void; submitText?: string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-card shadow-xl w-[520px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-[#E6E0D4] text-[13px] font-semibold">{title}</div>
        <div className="p-4">{children}</div>
        <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-[#E6E0D4] bg-[#FAF8F4]">
          <button onClick={onClose} disabled={busy}
            className="h-7 px-3 border border-[#D2CBBC] rounded-btn bg-white text-[11px] text-[#5C5749] disabled:opacity-40">取消</button>
          <button onClick={onSubmit} disabled={busy}
            className="h-7 px-3 rounded-btn bg-[#2F5C46] text-[11px] text-white font-medium disabled:opacity-40">{submitText}</button>
        </div>
      </div>
    </div>
  )
}

export type { VillageContact, GroupContact }
