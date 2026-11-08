/**
 * 主体管理 - 农户操作
 *
 * - FarmerActions：详情头部的「编辑农户 / 属性导入」
 * - CreateFarmerButton：页头「新增农户」
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api'
import { useToast } from '../../hooks/useToast'

import { CreateFarmerForm } from '../FarmerForms'
import { Ico } from './Icons'
import type { FarmerDetail, VillageGroup } from '../../types'
import { submitCreateFarmer, submitUpdateFarmer } from './actions'

const emptyCreate = {
  real_name: '', id_card: '', gender: 1 as 1 | 2, phone: '',
  village_name: '', group_no: '', address: '', contract_area: '', remark: '',
}

/** 详情头部按钮 */
export function FarmerActions({ farmer, onChanged }: { farmer: FarmerDetail; onChanged: () => void }) {
  const navigate = useNavigate()
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [villages, setVillages] = useState<VillageGroup[]>([])
  const [form, setForm] = useState({ real_name: '', phone: '', address: '', remark: '', farmer_status: 1, village_name: '', group_no: '' })

  useEffect(() => {
    if (!open) return
    api.getVillageGroups().then(setVillages).catch(() => {})
    setForm({
      real_name: farmer.real_name,
      phone: farmer.phone || '',
      address: farmer.address || '',
      remark: farmer.remark || '',
      farmer_status: farmer.farmer_status,
      village_name: farmer.village_full_name?.split('村')[0] ? `${farmer.village_full_name.split('村')[0]}村` : '',
      group_no: '',
    })
  }, [open, farmer])

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button onClick={() => setOpen(true)} disabled={busy}
        className="h-7 px-2.5 border border-border rounded-btn bg-white text-[11px] text-[#5A5A4F] hover:bg-warm/30 transition-colors disabled:opacity-40 inline-flex items-center gap-1"><Ico name="edit" size={12} />编辑农户</button>
      <button onClick={() => navigate('/settings/farmer-attribute-import')}
        className="h-7 px-2.5 border border-[#E6C288] rounded-btn bg-[#E6C288] text-[11px] text-[#5A4215] inline-flex items-center gap-1"><Ico name="upload" size={12} />属性导入</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-card shadow-xl w-[520px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2.5 border-b border-border text-[13px] font-semibold">编辑农户 · {farmer.real_name}</div>
            <div className="grid grid-cols-2 gap-3 p-4">
              <div className="col-span-2">
                <label className="block text-[11px] text-text-muted mb-1">姓名 *</label>
                <input value={form.real_name} onChange={e => setForm(f => ({ ...f, real_name: e.target.value }))}
                  className="w-full h-8 border border-border rounded-btn px-2.5 text-[12px] outline-none focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">手机号</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full h-8 border border-border rounded-btn px-2.5 text-[12px] outline-none focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">农户状态</label>
                <select value={form.farmer_status} onChange={e => setForm(f => ({ ...f, farmer_status: Number(e.target.value) }))}
                  className="w-full h-8 border border-border rounded-btn px-2.5 text-[12px] bg-white outline-none">
                  <option value={1}>在册</option>
                  <option value={2}>注销</option>
                  <option value={3}>迁出</option>
                  <option value={4}>死亡</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">所在村</label>
                <select value={form.village_name} onChange={e => setForm(f => ({ ...f, village_name: e.target.value }))}
                  className="w-full h-8 border border-border rounded-btn px-2.5 text-[12px] bg-white outline-none">
                  <option value="">不修改</option>
                  {[...new Set(villages.map(v => v.village_name))].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">组号</label>
                <input value={form.group_no} onChange={e => setForm(f => ({ ...f, group_no: e.target.value }))} placeholder="如 2"
                  className="w-full h-8 border border-border rounded-btn px-2.5 text-[12px] outline-none focus:border-primary-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-text-muted mb-1">地址</label>
                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full h-8 border border-border rounded-btn px-2.5 text-[12px] outline-none focus:border-primary-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-text-muted mb-1">备注</label>
                <input value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
                  className="w-full h-8 border border-border rounded-btn px-2.5 text-[12px] outline-none focus:border-primary-500" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-border bg-warm/20">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="h-7 px-3 border border-border rounded-btn bg-white text-[11px] text-[#5A5A4F] disabled:opacity-40">取消</button>
              <button disabled={busy} onClick={async () => {
                setBusy(true)
                try {
                  await submitUpdateFarmer(farmer.id, form, villages, form.village_name, form.group_no)
                  show('已保存')
                  setOpen(false)
                  onChanged()
                } catch (e) {
                  show((e as Error).message, 'err')
                } finally {
                  setBusy(false)
                }
              }} className="h-7 px-3 rounded-btn bg-primary text-[11px] text-[#F7F3E7] disabled:opacity-40">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 页头「新增农户」 */
export function CreateFarmerButton({ villages, onCreated }: { villages: string[]; onCreated: () => void }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyCreate)
  const [groups, setGroups] = useState<VillageGroup[]>([])

  useEffect(() => {
    if (open) api.getVillageGroups().then(setGroups).catch(() => {})
  }, [open])

  return (
    <>
      <button onClick={() => { setForm({ ...emptyCreate, village_name: villages[0] || '' }); setOpen(true) }}
        className="h-[30px] px-3 rounded-btn bg-primary text-[#F7F3E7] text-[12px] inline-flex items-center gap-1"><Ico name="create" size={13} />新增农户</button>
      <CreateFarmerForm open={open} villages={villages} createFarmerForm={form} setCreateFarmerForm={setForm}
        onClose={() => setOpen(false)}
        onSubmit={async () => {
          try {
            await submitCreateFarmer(form, groups)
            show('农户已创建')
            setOpen(false)
            setForm(emptyCreate)
            onCreated()
          } catch (e) {
            show((e as Error).message, 'err')
          }
        }} />
    </>
  )
}
