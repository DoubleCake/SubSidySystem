import { useState, useEffect } from 'react'
import * as api from '../api'
import type { SubsidyType, SubsidyTypeCreate } from '../types'
import { SUBSIDY_PAY_STATUS, years } from '../utils'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

const FUND_SOURCES = ['中央', '省级', '市级', '县级', '镇级']
const UNITS = ['元/亩', '元/人', '元/户']

export default function SubsidyTypesPage() {
  const { toast, show } = useToast()
  const [types, setTypes] = useState<SubsidyType[]>([])
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SubsidyType | null>(null)
  const [form, setForm] = useState<Partial<SubsidyTypeCreate>>({
    subsidy_year: 2024,
    calc_mode: 'fixed',
  })

  const load = () => api.getSubsidyTypes(yearFilter).then(setTypes)
  useEffect(() => { load() }, [yearFilter])

  const openAdd = () => {
    setEditing(null)
    setForm({ subsidy_year: yearFilter, calc_mode: 'fixed' })
    setOpen(true)
  }

  const openEdit = (t: SubsidyType) => {
    setEditing(t)
    setForm({
      subsidy_name: t.subsidy_name,
      subsidy_year: t.subsidy_year,
      calc_mode: t.calc_mode,
      standard_amount: t.standard_amount ? Number(t.standard_amount) : undefined,
      standard_unit: t.standard_unit ?? undefined,
      fund_source: t.fund_source ?? undefined,
      apply_deadline: t.apply_deadline ?? undefined,
      description: t.description ?? undefined,
    })
    setOpen(true)
  }

  const submit = async () => {
    if (!form.subsidy_name) return show('请填写补贴名称', 'err')
    if (!form.subsidy_year) return show('请填写年度', 'err')
    // 自动设置 standard_unit
    const autoUnit = form.calc_mode === 'per_mu' ? '元/亩' : (form.standard_unit || '元/户')
    const payload = { ...form, standard_unit: autoUnit }
    try {
      if (editing) {
        await api.updateSubsidyType(editing.id, payload)
        show('✓ 更新成功')
      } else {
        await api.createSubsidyType(payload as SubsidyTypeCreate)
        show('✓ 补贴类型创建成功')
      }
      setOpen(false); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const calcModeLabel = (m: string) => m === 'per_mu' ? '按亩计算' : '固定金额'
  const calcModeColor = (m: string): 'blue' | 'purple' => m === 'per_mu' ? 'blue' : 'purple'

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <div className="flex gap-1">
          {years.slice(0, 4).map(y => (
            <button key={y} onClick={() => setYearFilter(y)}
              className={`px-3 py-1.5 text-sm rounded-btn border transition-colors
                ${yearFilter === y ? 'bg-primary text-white border-emerald-700' : 'bg-white border-border text-text-primary hover:border-border'}`}>
              {y}年
            </button>
          ))}
        </div>
        <button onClick={openAdd} className="ml-auto px-3 py-2 text-sm bg-primary text-white rounded-btn hover:bg-primary/90">＋ 新增补贴类型</button>
      </div>

      {/* 说明卡片 */}
      <div className="bg-blue-50 border border-blue-100 rounded-card p-4 mb-4 text-sm text-blue-700">
        <strong>补贴计算模式说明：</strong>
        <span className="ml-2">「固定金额」— 每户/每人发固定金额，录入申请时直接填写金额；</span>
        <span className="ml-2">「按亩计算」— 系统根据「每亩金额 × 土地面积」自动计算应发金额。</span>
      </div>

      <div className="grid gap-3">
        {types.length === 0 && <div className="text-center py-10 text-text-muted/50 text-sm bg-white border border-border rounded-card">暂无补贴类型，点击右上角新增</div>}
        {types.map(t => (
          <div key={t.id} className="bg-white border border-border rounded-card p-5 shadow-card hover:border-border transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="font-bold text-text-primary text-base">{t.subsidy_name}</span>
                  <Tag label={t.subsidy_year + '年'} color="gray" />
                  <Tag label={calcModeLabel(t.calc_mode)} color={calcModeColor(t.calc_mode)} />
                  <Tag label={SUBSIDY_PAY_STATUS[t.pay_status]?.label ?? '—'} color={SUBSIDY_PAY_STATUS[t.pay_status]?.color as 'green'} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-sm">
                  <div className="flex gap-2">
                    <span className="text-text-muted">标准金额</span>
                    <span className="font-mono font-bold text-primary">
                      {t.standard_amount ? `¥${Number(t.standard_amount).toFixed(2)}` : '—'}
                      {t.standard_unit && <span className="text-xs text-text-muted ml-1">{t.standard_unit}</span>}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-text-muted">资金来源</span>
                    <span>{t.fund_source || '—'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-text-muted">截止日期</span>
                    <span className="font-mono text-xs">{t.apply_deadline || '—'}</span>
                  </div>
                </div>
                {t.description && <p className="text-xs text-text-muted mt-2">{t.description}</p>}
              </div>
              <button onClick={() => openEdit(t)} className="text-xs text-text-muted border border-border px-3 py-1.5 rounded-btn hover:text-primary hover:border-primary/20 shrink-0">编辑</button>
            </div>
          </div>
        ))}
      </div>

      {/* 弹窗 */}
      <Modal open={open} title={editing ? '编辑补贴类型' : '新增补贴类型'} onClose={() => setOpen(false)} onConfirm={submit}>
        <div className="space-y-4">
          {/* 计算模式选择 */}
          <div>
            <label className="block text-xs text-text-muted mb-2">计算模式 *</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: 'fixed', title: '固定金额', desc: '每户 / 每人发放固定金额', icon: '💰' },
                { val: 'per_mu', title: '按亩计算', desc: '系统自动计算：每亩金额 × 面积', icon: '🌾' },
              ].map(opt => (
                <div key={opt.val} onClick={() => setForm(f => ({ ...f, calc_mode: opt.val as 'fixed' | 'per_mu' }))}
                  className={`border-2 rounded-card p-3 cursor-pointer transition-colors
                    ${form.calc_mode === opt.val ? 'border-primary bg-primary/5' : 'border-border hover:border-border'}`}>
                  <div className="text-xl mb-1">{opt.icon}</div>
                  <div className="font-semibold text-sm text-text-primary">{opt.title}</div>
                  <div className="text-xs text-text-muted mt-0.5">{opt.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">补贴名称 *</label>
              <input value={form.subsidy_name ?? ''} onChange={e => setForm(f => ({ ...f, subsidy_name: e.target.value }))}
                placeholder="如：粮食直补、农机购置补贴"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">补贴年度 *</label>
              <select value={form.subsidy_year ?? 2024} onChange={e => setForm(f => ({ ...f, subsidy_year: Number(e.target.value) }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                {form.calc_mode === 'per_mu' ? '每亩金额 (元)' : '标准金额 (元)'}
              </label>
              <input type="number" step="0.01" value={form.standard_amount ?? ''} onChange={e => setForm(f => ({ ...f, standard_amount: Number(e.target.value) || undefined }))}
                placeholder={form.calc_mode === 'per_mu' ? '每亩多少元' : '每户/人多少元'}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            {form.calc_mode === 'fixed' && (
              <div>
                <label className="block text-xs text-text-muted mb-1">发放单位</label>
                <select value={form.standard_unit ?? '元/户'} onChange={e => setForm(f => ({ ...f, standard_unit: e.target.value }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-text-muted mb-1">资金来源</label>
              <select value={form.fund_source ?? ''} onChange={e => setForm(f => ({ ...f, fund_source: e.target.value || undefined }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                <option value="">不限</option>
                {FUND_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">申请截止日期</label>
              <input type="date" value={form.apply_deadline ?? ''} onChange={e => setForm(f => ({ ...f, apply_deadline: e.target.value || undefined }))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-text-muted mb-1">补贴说明 / 政策依据</label>
              <textarea rows={2} value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value || undefined }))}
                placeholder="可填写政策文件编号或补贴说明"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
            </div>
          </div>
        </div>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}
