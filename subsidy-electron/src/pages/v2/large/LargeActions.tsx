/**
 * 大户操作：新建弹窗
 *
 * 表单结构与旧版「大户管理」页面保持一致。
 */
import { useEffect, useState } from 'react'
import { useToast } from '../../../hooks/useToast'
import { Ico } from '../Icons'

const OPERATOR_TYPE_OPTS = [
  { val: 'FAMILY_FARM', label: '家庭农场', icon: '🏠' },
  { val: 'COOPERATIVE', label: '合作社', icon: '🏘️' },
  { val: 'LARGE_PLANTER', label: '种植大户', icon: '🌾' },
  { val: 'OTHER', label: '其他', icon: '📋' },
] as const

const emptyFarmerForm = () => ({
  operator_name: '',
  operator_type: 'FAMILY_FARM' as string,
  id_card: '',
  phone: '',
  bank_card: '',
  bank_name: '',
  village_id: null as number | null,
  group_no: '',
  address: '',
  total_managed_area: '',
  own_contract_area: '',
  main_crops: '',
  registration_no: '',
  registration_date: '',
  status: 1,
  is_verified: 0,
  remark: '',
})

type Form = ReturnType<typeof emptyFarmerForm>

/** 页头「新增大户」按钮 */
export function CreateLargeButton({ onCreated }: { onCreated: () => void }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>(emptyFarmerForm())
  const [villages, setVillages] = useState<{ id: number; village_name: string }[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    window.electronAPI.invoke('settings:listVillages')
      .then((r: any) => setVillages(r?.data ?? r ?? []))
      .catch(() => {})
  }, [open])

  const sff = (k: keyof Form, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.operator_name) { show('请填写经营者名称', 'err'); return }
    if (!form.village_id) { show('请选择所属村', 'err'); return }

    const payload = {
      ...form,
      group_no: form.group_no ? Number(form.group_no) : null,
      total_managed_area: form.total_managed_area ? Number(form.total_managed_area) : null,
      own_contract_area: form.own_contract_area ? Number(form.own_contract_area) : null,
      registration_date: form.registration_date || null,
    }
    setBusy(true)
    try {
      await window.electronAPI.invoke('land:createLargeFarmer', payload)
      show('✓ 创建成功')
      setOpen(false)
      setForm(emptyFarmerForm())
      onCreated()
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={() => { setForm(emptyFarmerForm()); setOpen(true) }}
        className="h-[30px] px-3 rounded-btn bg-[#2F5C46] text-white text-[12px] font-medium hover:bg-[#234A38] transition-colors inline-flex items-center gap-1">
        <Ico name="create" size={13} />
        新增大户
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-card shadow-xl w-[560px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#E6E0D4] text-[14px] font-semibold">新增大户</div>

            <div className="p-5 space-y-4">
              {/* 主体类型 */}
              <div>
                <label className="block text-xs text-[#7A7466] mb-2">主体类型</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {OPERATOR_TYPE_OPTS.map(o => (
                    <button key={o.val} onClick={() => sff('operator_type', o.val)}
                      className={`border-2 rounded-card p-2 cursor-pointer transition-colors text-center
                        ${form.operator_type === o.val ? 'border-[#2F5C46] bg-[#E2EDE6]' : 'border-[#D2CBBC] hover:border-[#A8A091]'}`}>
                      <div className="text-lg mb-0.5">{o.icon}</div>
                      <div className="text-xs font-semibold text-[#5C5749]">{o.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-[#7A7466] mb-1">经营者/主体名称 *</label>
                  <input value={form.operator_name} onChange={e => sff('operator_name', e.target.value)}
                    placeholder="请填写" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-[#7A7466] mb-1">身份证号</label>
                  <input value={form.id_card} onChange={e => sff('id_card', e.target.value)}
                    placeholder="负责人身份证" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-[#7A7466] mb-1">联系电话</label>
                  <input value={form.phone} onChange={e => sff('phone', e.target.value)}
                    placeholder="联系电话" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#7A7466] mb-1">所属村 *</label>
                  <select value={form.village_id || ''} onChange={e => sff('village_id', e.target.value ? Number(e.target.value) : null)}
                    className={`${inputCls} bg-white`}>
                    <option value="">请选择</option>
                    {villages.map(v => <option key={v.id} value={v.id}>{v.village_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#7A7466] mb-1">组号</label>
                  <input value={form.group_no} onChange={e => sff('group_no', e.target.value)}
                    placeholder="如：1" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#7A7466] mb-1">自有承包面积（亩）</label>
                  <input type="number" step="0.01" value={form.own_contract_area} onChange={e => sff('own_contract_area', e.target.value)}
                    placeholder="如：10.5" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-[#7A7466] mb-1">总经营面积（亩）</label>
                  <input type="number" step="0.01" value={form.total_managed_area} onChange={e => sff('total_managed_area', e.target.value)}
                    placeholder="可通过代耕代种自动计算" className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#7A7466] mb-1">主要种植作物</label>
                <input value={form.main_crops} onChange={e => sff('main_crops', e.target.value)}
                  placeholder="如：水稻、小麦、玉米" className={inputCls} />
              </div>

              <div>
                <label className="block text-xs text-[#7A7466] mb-1">备注</label>
                <textarea rows={2} value={form.remark} onChange={e => sff('remark', e.target.value)}
                  className={`${inputCls} resize-none`} />
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#E6E0D4] bg-[#FAF8F4]">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="h-8 px-4 border border-[#D2CBBC] rounded-btn bg-white text-xs text-[#5C5749] disabled:opacity-40">取消</button>
              <button onClick={submit} disabled={busy}
                className="h-8 px-4 rounded-btn bg-[#2F5C46] text-xs text-white font-medium disabled:opacity-40">确定</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const inputCls = 'w-full border border-[#D2CBBC] rounded-btn px-3 py-2 text-sm outline-none focus:border-[#2F5C46]'
