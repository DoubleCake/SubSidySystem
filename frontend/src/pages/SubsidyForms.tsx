/**
 * 补贴项目表单组件
 * 包含新增/编辑补贴项目的Modal表单
 */
import { useState } from 'react'
import Modal from '../components/Modal'
import type { SubsidyType, SubsidyTypeCreate } from '../types'
import { years } from '../utils'

const FUND_SOURCES = ['中央', '省级', '市级', '县级', '镇级']
const UNITS = ['元/亩', '元/人', '元/户']

interface SubsidyFormProps {
  open: boolean
  editing: SubsidyType | null
  form: Partial<SubsidyTypeCreate>
  onFormChange: (form: Partial<SubsidyTypeCreate>) => void
  onSubmit: () => void
  onClose: () => void
  thisYear: number
}

export default function SubsidyForms({
  open,
  editing,
  form,
  onFormChange,
  onSubmit,
  onClose,
  thisYear
}: SubsidyFormProps) {
  const submitType = async () => {
    onSubmit()
  }

  return (
    <Modal open={open} title={editing ? '编辑补贴项目' : '新增补贴项目'} onClose={onClose} onConfirm={submitType}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[{ val: 'fixed', title: '固定金额', desc: '每户/每人发固定金额', icon: '💰' },
            { val: 'per_mu', title: '按亩计算', desc: '每亩金额 × 土地面积', icon: '🌾' }].map(opt => (
            <div key={opt.val} onClick={() => onFormChange({ ...form, calc_mode: opt.val as 'fixed' | 'per_mu' })}
              className={`border-2 rounded-card p-3 cursor-pointer transition-colors
                ${form.calc_mode === opt.val ? 'border-primary bg-primary/5' : 'border-border hover:border-border'}`}>
              <div className="text-xl mb-1">{opt.icon}</div>
              <div className="font-semibold text-sm">{opt.title}</div>
              <div className="text-xs text-text-muted">{opt.desc}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-text-muted mb-1">补贴名称 *</label>
            <input value={form.subsidy_name ?? ''} onChange={e => onFormChange({ ...form, subsidy_name: e.target.value })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          <div><label className="block text-xs text-text-muted mb-1">补贴年度 *</label>
            <select value={form.subsidy_year ?? thisYear} onChange={e => onFormChange({ ...form, subsidy_year: Number(e.target.value) })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select></div>
          <div><label className="block text-xs text-text-muted mb-1">项目分类</label>
            <select value={form.category ?? ''} onChange={e => onFormChange({ ...form, category: e.target.value || undefined })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              <option value="">不分类</option>
              <option value="耕地保护">耕地保护补贴</option>
              <option value="大豆">大豆补贴</option>
              <option value="玉米">玉米补贴</option>
              <option value="稻谷">稻谷补贴</option>
              <option value="油菜">油菜补贴</option>
              <option value="其他">其他补贴</option>
            </select></div>
          <div><label className="block text-xs text-text-muted mb-1">{form.calc_mode === 'per_mu' ? '每亩金额(元)' : '标准金额(元)'}</label>
            <input type="number" step="0.01" value={form.standard_amount ?? ''} onChange={e => onFormChange({ ...form, standard_amount: Number(e.target.value) || undefined })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          {form.calc_mode === 'fixed' && (
            <div><label className="block text-xs text-text-muted mb-1">发放单位</label>
              <select value={form.standard_unit ?? '元/户'} onChange={e => onFormChange({ ...form, standard_unit: e.target.value })}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select></div>
          )}
          <div><label className="block text-xs text-text-muted mb-1">资金来源</label>
            <select value={form.fund_source ?? ''} onChange={e => onFormChange({ ...form, fund_source: e.target.value || undefined })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              <option value="">不限</option>{FUND_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div><label className="block text-xs text-text-muted mb-1">申请截止日期</label>
            <input type="date" value={form.apply_deadline ?? ''} onChange={e => onFormChange({ ...form, apply_deadline: e.target.value || undefined })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          <div><label className="block text-xs text-text-muted mb-1">计入承包面积</label>
            <select value={form.count_toward_area ?? 1} onChange={e => onFormChange({ ...form, count_toward_area: Number(e.target.value) })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              <option value={1}>是（按亩补贴累计入承包面积）</option>
              <option value={0}>否（固定金额类不占用面积）</option>
            </select>
            <p className="text-xs text-text-muted/50 mt-1">影响家庭户超领预警的计算</p>
          </div>
          <div className="col-span-2"><label className="block text-xs text-text-muted mb-1">补贴说明</label>
            <textarea rows={2} value={form.description ?? ''} onChange={e => onFormChange({ ...form, description: e.target.value || undefined })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" /></div>
        </div>
      </div>
    </Modal>
  )
}