/**
 * 大户操作：新建弹窗 + 详情页头部按钮
 */
import { useEffect, useState } from 'react'
import { useToast } from '../../../hooks/useToast'
import { Ico } from '../Icons'
import type { LargeFarmer } from '../types'

const OPERATOR_TYPES = [
  { val: 'FAMILY_FARM', label: '家庭农场' },
  { val: 'COOPERATIVE', label: '合作社' },
  { val: 'LARGE_PLANTER', label: '种植大户' },
  { val: 'OTHER', label: '其他' },
] as const

const emptyForm = () => ({
  operator_name: '',
  operator_type: 'FAMILY_FARM' as string,
  id_card: '',
  phone: '',
  village_id: null as number | null,
  group_no: '',
  address: '',
  own_contract_area: '',
  main_crops: '',
  legal_person: '',
  contact_person: '',
  public_account: '',
  public_bank: '',
  remark: '',
})

type Form = ReturnType<typeof emptyForm>

/** 页头「新增大户」按钮 */
export function CreateLargeButton({ onCreated }: { onCreated: () => void }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>(emptyForm())
  const [villages, setVillages] = useState<{ id: number; village_name: string }[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    window.electronAPI.invoke('settings:listVillages')
      .then((r: any) => setVillages(r?.data ?? r ?? []))
      .catch(() => {})
  }, [open])

  const set = (k: keyof Form, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.operator_name.trim()) { show('请填写经营者名称', 'err'); return }
    if (!form.village_id) { show('请选择所属村', 'err'); return }
    setBusy(true)
    try {
      await window.electronAPI.invoke('land:createLargeFarmer', {
        ...form,
        operator_name: form.operator_name.trim(),
        group_no: form.group_no ? Number(form.group_no) : null,
        own_contract_area: form.own_contract_area ? Number(form.own_contract_area) : null,
        total_managed_area: form.own_contract_area ? Number(form.own_contract_area) : null,
        status: 1,
      })
      show('✓ 大户已创建')
      setOpen(false)
      setForm(emptyForm())
      onCreated()
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={() => { setForm(emptyForm()); setOpen(true) }}
        className="h-[30px] px-3 rounded-btn bg-[#2F5C46] text-white text-[12px] font-medium hover:bg-[#234A38] transition-colors inline-flex items-center gap-1">
        <Ico name="create" size={13} />
        新增大户
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-card shadow-xl w-[560px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2.5 border-b border-[#E6E0D4] text-[13px] font-semibold">新增大户</div>

            <div className="p-4 flex flex-col gap-3">
              {/* 主体类型 */}
              <div>
                <label className="block text-[11px] text-[#7A7466] mb-1.5">主体类型</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {OPERATOR_TYPES.map(o => (
                    <button key={o.val} onClick={() => set('operator_type', o.val)}
                      className={`h-8 rounded-btn text-[11.5px] border transition-colors
                        ${form.operator_type === o.val
                          ? 'border-[#2F5C46] bg-[#E2EDE6] text-[#234A38] font-semibold'
                          : 'border-[#D2CBBC] text-[#5C5749] hover:border-[#2F5C46]'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="经营者/主体名称 *">
                <input value={form.operator_name} onChange={e => set('operator_name', e.target.value)}
                  placeholder="请填写" className={inputCls} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="身份证号">
                  <input value={form.id_card} onChange={e => set('id_card', e.target.value)} className={inputCls} />
                </Field>
                <Field label="联系电话">
                  <input value={form.phone} onChange={e => set('phone', e.target.value)} className={inputCls} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="所属村 *">
                  <select value={form.village_id ?? ''} onChange={e => set('village_id', e.target.value ? Number(e.target.value) : null)}
                    className={`${inputCls} bg-white`}>
                    <option value="">请选择</option>
                    {villages.map(v => <option key={v.id} value={v.id}>{v.village_name}</option>)}
                  </select>
                </Field>
                <Field label="组号">
                  <input value={form.group_no} onChange={e => set('group_no', e.target.value)} placeholder="如 3" className={inputCls} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="自有承包面积（亩）">
                  <input value={form.own_contract_area} onChange={e => set('own_contract_area', e.target.value)}
                    placeholder="0.00" className={inputCls} />
                </Field>
                <Field label="主要作物">
                  <input value={form.main_crops} onChange={e => set('main_crops', e.target.value)} className={inputCls} />
                </Field>
              </div>

              {/* 主体信息扩展 */}
              <div className="border-t border-[#E6E0D4] pt-3">
                <div className="text-[11px] text-[#7A7466] mb-2">主体信息（选填）</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="法人">
                    <input value={form.legal_person} onChange={e => set('legal_person', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="联系方式">
                    <input value={form.contact_person} onChange={e => set('contact_person', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="公户账号">
                    <input value={form.public_account} onChange={e => set('public_account', e.target.value)}
                      className={`${inputCls} font-mono`} />
                  </Field>
                  <Field label="开户行">
                    <input value={form.public_bank} onChange={e => set('public_bank', e.target.value)} className={inputCls} />
                  </Field>
                </div>
              </div>

              <Field label="地址">
                <input value={form.address} onChange={e => set('address', e.target.value)} className={inputCls} />
              </Field>
            </div>

            <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-[#E6E0D4] bg-[#FAF8F4]">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="h-7 px-3 border border-[#D2CBBC] rounded-btn bg-white text-[11px] text-[#5C5749] disabled:opacity-40">取消</button>
              <button onClick={submit} disabled={busy}
                className="h-7 px-3 rounded-btn bg-[#2F5C46] text-[11px] text-white font-medium disabled:opacity-40">创建</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** 详情页头部操作区 */
export function LargeActions({ farmer, onChanged }: { farmer: LargeFarmer; onChanged: () => void }) {
  const { show } = useToast()
  const [confirmType, setConfirmType] = useState<null | 'verify' | 'delete'>(null)
  const [busy, setBusy] = useState(false)

  const doVerify = async () => {
    setBusy(true)
    try {
      await window.electronAPI.invoke('land:updateLargeFarmer', { id: farmer.id, is_verified: 1 })
      show('已标记为已核实')
      setConfirmType(null)
      onChanged()
    } catch (e) { show((e as Error).message, 'err') }
    finally { setBusy(false) }
  }

  const doDelete = async () => {
    setBusy(true)
    try {
      await window.electronAPI.invoke('land:deleteLargeFarmer', farmer.id)
      show('已删除')
      setConfirmType(null)
      onChanged()
    } catch (e) { show((e as Error).message, 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button onClick={() => setConfirmType('verify')} disabled={busy}
        className="h-7 px-2.5 rounded-btn bg-[#E2EDE6] border border-[#C4DACC] text-[11px] text-[#2F5C46] font-medium hover:bg-[#DCE9E1] transition-colors disabled:opacity-40 inline-flex items-center gap-1">
        <Ico name="confirm" size={12} />标记核实
      </button>
      <button onClick={() => setConfirmType('delete')} disabled={busy}
        className="h-7 px-2.5 rounded-btn bg-[#FCEAE8] border border-[#F5D3CF] text-[11px] text-[#A81D1D] font-medium hover:bg-[#F9D9D4] transition-colors disabled:opacity-40 inline-flex items-center gap-1">
        <Ico name="delete" size={12} />删除
      </button>

      {confirmType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !busy && setConfirmType(null)}>
          <div className="bg-white rounded-card shadow-xl w-[380px]" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2.5 border-b border-[#E6E0D4] text-[13px] font-semibold">
              {confirmType === 'verify' ? '标记为已核实' : '删除大户'}
            </div>
            <div className="px-4 py-3 text-[12px] text-[#5C5749]">
              {confirmType === 'verify'
                ? `确认将「${farmer.operator_name}」标记为已核实？`
                : `确认删除「${farmer.operator_name}」？其流转明细也会一并删除，此操作不可撤销。`}
            </div>
            <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-[#E6E0D4] bg-[#FAF8F4]">
              <button onClick={() => setConfirmType(null)} disabled={busy}
                className="h-7 px-3 border border-[#D2CBBC] rounded-btn bg-white text-[11px] text-[#5C5749] disabled:opacity-40">取消</button>
              <button onClick={confirmType === 'verify' ? doVerify : doDelete} disabled={busy}
                className={`h-7 px-3 rounded-btn text-[11px] text-white font-medium disabled:opacity-40
                  ${confirmType === 'verify' ? 'bg-[#2F5C46]' : 'bg-[#B91C1C]'}`}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full h-8 border border-[#D2CBBC] rounded-btn px-2.5 text-[12px] outline-none focus:border-[#2F5C46]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-[#7A7466] mb-1">{label}</label>
      {children}
    </div>
  )
}
