/**
 * 户籍管理页 - 表单组件
 */
import { useState } from 'react'
import * as XLSX from 'xlsx'
import Modal from '../components/Modal'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import ExcelImport from '../components/ExcelImport'
import type { ExcelColumnTemplate } from '../types'
import { FARMER_TEMPLATE_HEADERS, FARMER_TEMPLATE_EXAMPLE, FARMER_SYSTEM_FIELDS, MEMBER_IMPORT_ALIAS, EVENT_TYPE_CFG } from './FarmerConstants'
import { FARMER_STATUS, PAY_STATUS, fmt, years } from '../utils'
import type { VillageGroup, HH, HHMember, HHEvent, FarmerOut } from '../types'
import * as api from '../api'
import Tag from '../components/Tag'

// ── Props 类型定义 ──

export interface CreateHhFormProps {
  open: boolean
  groups: VillageGroup[]
  createHhForm: { household_name: string; village_group_id: number; contract_area: string; address: string; remark: string }
  setCreateHhForm: React.Dispatch<React.SetStateAction<{ household_name: string; village_group_id: number; contract_area: string; address: string; remark: string }>>
  onSubmit: () => void
  onClose: () => void
}

export interface CreateFarmerFormProps {
  open: boolean
  villages: string[]
  createFarmerForm: { real_name: string; id_card: string; gender: 1 | 2; phone: string; village_name: string; group_no: string; address: string; contract_area: string; remark: string }
  setCreateFarmerForm: React.Dispatch<React.SetStateAction<{ real_name: string; id_card: string; gender: 1 | 2; phone: string; village_name: string; group_no: string; address: string; contract_area: string; remark: string }>>
  onSubmit: () => void
  onClose: () => void
}

export interface MergeConfirmFormProps {
  open: boolean
  mergeSelectedHouseholds: HH[]
  mergeConfirmForm: { contract_area: string; remark: string }
  setMergeConfirmForm: React.Dispatch<React.SetStateAction<{ contract_area: string; remark: string }>>
  onSubmit: () => void
  onClose: () => void
  loading?: boolean
}

export interface MemberFormProps {
  open: boolean
  memberEditTarget: HHMember | null
  memberForm: {
    real_name: string
    id_card: string
    gender: string
    relation: string
    is_head: boolean
    phone: string
    bank_card: string
    bank_name: string
    farmer_status: string
    restricted_identity: string
    event_date: string
    village_id: number
    group_no: number
    village_name: string
    group_name: string
  }
  setMemberForm: React.Dispatch<React.SetStateAction<{
    real_name: string
    id_card: string
    gender: string
    relation: string
    is_head: boolean
    phone: string
    bank_card: string
    bank_name: string
    farmer_status: string
    restricted_identity: string
    event_date: string
    village_id: number
    group_no: number
    village_name: string
    group_name: string
  }>>
  groups: VillageGroup[]
  onSubmit: () => void
  onClose: () => void
  showToast: (msg: string, type?: 'ok' | 'err') => void
  setGroups: React.Dispatch<React.SetStateAction<VillageGroup[]>>
}

export interface SplitWizardFormProps {
  open: boolean
  splitStep: 1 | 2 | 3
  splitSelected: number[]
  splitNewHead: number | null
  splitForm: {
    household_name: string
    split_year: string
    split_date: string
    new_land_area: string
    origin_land_area: string
    description: string
    evidence_type: string
    evidence_note: string
  }
  members: HHMember[]
  householdName?: string
  setSplitStep: React.Dispatch<React.SetStateAction<1 | 2 | 3>>
  setSplitSelected: React.Dispatch<React.SetStateAction<number[]>>
  setSplitNewHead: React.Dispatch<React.SetStateAction<number | null>>
  setSplitForm: React.Dispatch<React.SetStateAction<{
    household_name: string
    split_year: string
    split_date: string
    new_land_area: string
    origin_land_area: string
    description: string
    evidence_type: string
    evidence_note: string
  }>>
  onSubmit: () => void
  onClose: () => void
}

export interface EventFormProps {
  open: boolean
  eventForm: {
    event_type: string
    event_year: string
    event_date: string
    description: string
    evidence_type: string
    evidence_note: string
  }
  setEventForm: React.Dispatch<React.SetStateAction<{
    event_type: string
    event_year: string
    event_date: string
    description: string
    evidence_type: string
    evidence_note: string
  }>>
  onSubmit: () => void
  onClose: () => void
}

export interface ConfirmFormProps {
  open: boolean
  title: string
  description?: string
  confirmForm: { operator: string; remark: string }
  setConfirmForm: React.Dispatch<React.SetStateAction<{ operator: string; remark: string }>>
  onSubmit: () => void
  onClose: () => void
  submitText?: string
  type?: 'manual_confirm' | 'cancel_confirm'
  detail?: { household_name: string; household_code: string; manually_confirmed_at?: string | null; manually_confirmed_by?: string | null } | null
}

export interface DeleteConfirmFormProps {
  open: boolean
  deleteTarget: HH | { household_name: string; household_code: string; village_full_name: string; member_count?: number; members?: HHMember[] } | null
  loading?: boolean
  onSubmit: () => void
  onClose: () => void
}

// ── 新建家庭户表单 ──
export function CreateHhForm({ open, groups, createHhForm, setCreateHhForm, onSubmit, onClose }: CreateHhFormProps) {
  return (
    <Modal open={open} title="新建家庭户" onClose={onClose} onConfirm={onSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-text-muted mb-1">户名 *</label>
          <input value={createHhForm.household_name} onChange={e => setCreateHhForm(f => ({ ...f, household_name: e.target.value }))} placeholder="如：张三户"
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">所在村组 *</label>
          <select value={createHhForm.village_group_id || ''} onChange={e => setCreateHhForm(f => ({ ...f, village_group_id: Number(e.target.value) }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
            <option value="">请选择</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">承包土地面积（亩）</label>
          <input type="number" step="0.01" value={createHhForm.contract_area} onChange={e => setCreateHhForm(f => ({ ...f, contract_area: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-text-muted mb-1">地址</label>
          <input value={createHhForm.address} onChange={e => setCreateHhForm(f => ({ ...f, address: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-text-muted mb-1">备注</label>
          <textarea rows={2} value={createHhForm.remark} onChange={e => setCreateHhForm(f => ({ ...f, remark: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
        </div>
      </div>
    </Modal>
  )
}

// ── 新建农户表单 ──
export function CreateFarmerForm({ open, villages, createFarmerForm, setCreateFarmerForm, onSubmit, onClose }: CreateFarmerFormProps) {
  return (
    <Modal open={open} title="新建农户" onClose={onClose} onConfirm={onSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-text-muted mb-1">姓名 *</label>
          <input value={createFarmerForm.real_name} onChange={e => setCreateFarmerForm(f => ({ ...f, real_name: e.target.value }))}
            placeholder="请输入姓名"
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-text-muted mb-1">身份证号 *</label>
          <input value={createFarmerForm.id_card} onChange={e => setCreateFarmerForm(f => ({ ...f, id_card: e.target.value }))}
            placeholder="18位身份证号"
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">性别</label>
          <select value={createFarmerForm.gender} onChange={e => setCreateFarmerForm(f => ({ ...f, gender: Number(e.target.value) as 1|2 }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
            <option value={1}>男</option>
            <option value={2}>女</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">手机号</label>
          <input value={createFarmerForm.phone} onChange={e => setCreateFarmerForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="可选"
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">所在村 *</label>
          <select value={createFarmerForm.village_name} onChange={e => setCreateFarmerForm(f => ({ ...f, village_name: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
            <option value="">请选择</option>
            {villages.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">所在组 *</label>
          <select value={createFarmerForm.group_no} onChange={e => setCreateFarmerForm(f => ({ ...f, group_no: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
            <option value="">请选择</option>
            {['一组','二组','三组','四组','五组','六组','七组','八组','九组','十组'].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-text-muted mb-1">承包土地面积（亩）</label>
          <input type="number" step="0.01" value={createFarmerForm.contract_area} onChange={e => setCreateFarmerForm(f => ({ ...f, contract_area: e.target.value }))}
            placeholder="可选"
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-text-muted mb-1">备注</label>
          <textarea rows={2} value={createFarmerForm.remark} onChange={e => setCreateFarmerForm(f => ({ ...f, remark: e.target.value }))}
            placeholder="可选"
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
        </div>
      </div>
    </Modal>
  )
}

// ── 合并家庭户确认表单 ──
export function MergeConfirmForm({ open, mergeSelectedHouseholds, mergeConfirmForm, setMergeConfirmForm, onSubmit, onClose, loading }: MergeConfirmFormProps) {
  return (
    <Modal open={open} title="合并家庭户" onClose={onClose} onConfirm={onSubmit} confirmText="确认合并">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-btn p-4">
          <p className="text-sm text-amber-700 mb-2">确认将以下 <strong>{mergeSelectedHouseholds.length}</strong> 个家庭户合并：</p>
          <div className="space-y-1">
            {mergeSelectedHouseholds.map((h, i) => (
              <div key={h.id} className={`flex items-center gap-2 text-sm ${i === 0 ? 'text-primary font-medium' : 'text-text-primary'}`}>
                {i === 0
                  ? <span className="text-xs bg-primary/90  px-1.5 py-0.5 rounded">目标户</span>
                  : <span className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">被合并</span>}
                <span>{h.household_name}</span>
                <span className="text-xs text-text-muted">({h.head_name || '无户主'} · {h.member_count ?? '?'}人 · {h.contracted_area > 0 ? `${h.contracted_area}亩` : '—'})</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">备注</label>
          <textarea rows={2} value={mergeConfirmForm.remark} onChange={e => setMergeConfirmForm(f => ({ ...f, remark: e.target.value }))}
            placeholder="可选"
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
        </div>
      </div>
    </Modal>
  )
}

// ── 成员表单 ──
export function MemberForm({ open, memberEditTarget, memberForm, setMemberForm, groups, onSubmit, onClose, showToast, setGroups }: MemberFormProps) {
  return (
    <Modal open={open} title={memberEditTarget ? `编辑成员 · ${memberEditTarget.real_name}` : '新增成员'}
      onClose={onClose} onConfirm={onSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-xs text-text-muted mb-1">姓名 *</label>
          <input value={memberForm.real_name} onChange={e => setMemberForm(f => ({ ...f, real_name: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
        {!memberEditTarget && (
          <div><label className="block text-xs text-text-muted mb-1">身份证号 *</label>
            <input value={memberForm.id_card} onChange={e => setMemberForm(f => ({ ...f, id_card: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary font-mono" /></div>
        )}
        <div><label className="block text-xs text-text-muted mb-1">与户主关系</label>
          <input value={memberForm.relation} onChange={e => setMemberForm(f => ({ ...f, relation: e.target.value }))} placeholder="如：本人、妻子、父亲"
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
        <div><label className="block text-xs text-text-muted mb-1">状态</label>
          <select value={memberForm.farmer_status} onChange={e => setMemberForm(f => ({ ...f, farmer_status: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
            <option value="1">在册</option><option value="2">注销</option><option value="3">迁出</option><option value="4">死亡</option>
          </select></div>
        <div><label className="block text-xs text-text-muted mb-1">受限身份</label>
          <select value={memberForm.restricted_identity ?? '0'} onChange={e => setMemberForm(f => ({ ...f, restricted_identity: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
            <option value="0">无限制</option><option value="1">受限制（公务员/事业人员）</option>
          </select></div>
        <div><label className="block text-xs text-text-muted mb-1">个人所在村
            <span className="ml-1 text-text-muted/50 font-normal">（出嫁/迁居等，与户不同时填）</span>
          </label>
          <div className="relative">
            <input
              list="member-village-list"
              value={memberForm.village_name}
              onChange={async e => {
                const vname = e.target.value.trim()
                const found = groups.find(g => g.village_name === vname)
                if (found) {
                  setMemberForm(f => ({ ...f, village_name: vname, village_id: found.village_id, group_no: 1, group_name: '' }))
                } else if (vname) {
                  setMemberForm(f => ({ ...f, village_name: vname, village_id: 0, group_no: 1, group_name: '' }))
                } else {
                  setMemberForm(f => ({ ...f, village_name: '', village_id: 0 }))
                }
              }}
              placeholder="输入或选择村名"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <datalist id="member-village-list">
              {[...new Map(groups.map(g => [g.village_id, g])).values()].map(g => (
                <option key={g.village_id} value={g.village_name} />
              ))}
            </datalist>
          </div>
          {memberForm.village_id === 0 && memberForm.village_name && (
            <button type="button" onClick={async () => {
              const vname = memberForm.village_name.trim()
              if (!vname) return
              try {
                const res = await api.createVillageGroup({ village_name: vname, group_no: 1 })
                const newGroup = { id: res.id, village_id: res.village_id, village_name: vname, group_no: 1, full_name: `${vname}村1组` }
                setGroups(g => [...g, newGroup])
                setMemberForm(f => ({ ...f, village_id: res.village_id, group_no: 1 }))
                showToast(`✓ 村庄「${vname}」已创建（默认第1组）`, 'ok')
              } catch (e: any) { showToast(`创建失败：${e.message}`, 'err') }
            }} className="mt-1 text-xs text-primary hover:text-primary flex items-center gap-1">
              <span>+ 创建新村庄「{memberForm.village_name}」</span>
            </button>
          )}</div>
        <div><label className="block text-xs text-text-muted mb-1">个人所在组</label>
          <div className="relative">
            <input
              list="member-group-list"
              value={memberForm.group_name}
              onChange={e => {
                const villageGroups = groups.filter(g => g.village_id === memberForm.village_id)
                const found = villageGroups.find(g => g.full_name.replace(g.village_name, '').replace('村', '') === e.target.value)
                if (found) {
                  setMemberForm(f => ({ ...f, group_name: e.target.value, group_no: found.group_no }))
                } else {
                  const num = parseInt(e.target.value.replace(/[^0-9]/g, ''))
                  if (num > 0) setMemberForm(f => ({ ...f, group_name: e.target.value, group_no: num }))
                  else setMemberForm(f => ({ ...f, group_name: e.target.value }))
                }
              }}
              placeholder="输入或选择组名"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <datalist id="member-group-list">
              {groups.filter(g => g.village_id === memberForm.village_id).map(g => (
                <option key={g.id} value={g.full_name.replace(g.village_name, '').replace('村', '')} />
              ))}
            </datalist>
          </div>
          {memberForm.village_id !== 0 && !groups.some(g => g.village_id === memberForm.village_id && g.full_name.replace(g.village_name, '').replace('村', '') === memberForm.group_name) && memberForm.group_name && (
            <button type="button" onClick={async () => {
              if (!memberForm.village_id || !memberForm.group_name) return
              const v = groups.find(g => g.village_id === memberForm.village_id)
              const gname = memberForm.group_name
              const gno = parseInt(gname.replace(/[^0-9]/g, '')) || 1
              try {
                const res = await api.createVillageGroup({ village_name: v?.village_name || memberForm.village_name, group_no: gno })
                const newGroup = { id: res.id, village_id: res.village_id, village_name: v?.village_name || memberForm.village_name, group_no: gno, full_name: `${v?.village_name || memberForm.village_name}村${gno}组` }
                setGroups(g => [...g, newGroup])
                setMemberForm(f => ({ ...f, group_no: gno }))
                showToast(`✓ 组「${gname}」已创建`, 'ok')
              } catch (e: any) { showToast(`创建失败：${e.message}`, 'err') }
            }} className="mt-1 text-xs text-primary hover:text-primary flex items-center gap-1">
              <span>+ 创建新组「{memberForm.group_name}」</span>
            </button>
          )}</div>
        <div><label className="block text-xs text-text-muted mb-1">变动时间（选填）</label>
          <input type="date" value={memberForm.event_date} onChange={e => setMemberForm(f => ({ ...f, event_date: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
        <div><label className="block text-xs text-text-muted mb-1">手机号</label>
          <input value={memberForm.phone} onChange={e => setMemberForm(f => ({ ...f, phone: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
        <div><label className="block text-xs text-text-muted mb-1">银行卡号</label>
          <input value={memberForm.bank_card} onChange={e => setMemberForm(f => ({ ...f, bank_card: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary font-mono" /></div>
        <div className="col-span-2 flex items-center gap-2 pt-1">
          <input type="checkbox" id="is_head_chk" checked={memberForm.is_head} onChange={e => setMemberForm(f => ({ ...f, is_head: e.target.checked }))} />
          <label htmlFor="is_head_chk" className="text-sm text-text-primary cursor-pointer">设为本户户主</label>
          {memberForm.is_head && <span className="text-xs text-amber-600">（原户主将降为普通成员）</span>}
        </div>
      </div>
    </Modal>
  )
}

// ── 分户向导表单 ──
export function SplitWizardForm({ open, splitStep, splitSelected, splitNewHead, splitForm, members, householdName, setSplitStep, setSplitSelected, setSplitNewHead, setSplitForm, onSubmit, onClose }: SplitWizardFormProps) {
  return (
    <Modal open={open} title="分户向导" onClose={onClose}
      onConfirm={splitStep === 3 ? onSubmit : () => {
        if (splitStep === 1) {
          // 如果没有选择户主，也可以进入下一步，但在最后确认时会提示
          const headName = splitNewHead ? members.find(m => m.id === splitNewHead)?.real_name || '' : ''
          if (headName) {
            setSplitForm(f => ({ ...f, household_name: headName + '户' }))
          }
        }
        setSplitStep(s => (s + 1) as 1 | 2 | 3)
      }}
      confirmText={splitStep === 3 ? '确认分户' : `下一步 (${splitStep}/3)`} width={560}>
      <div>
        <div className="flex items-center gap-2 mb-5">
          {['选择分出成员', '填写新户信息', '确认分户'].map((label, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && <div className={`w-8 h-px ${i < splitStep ? 'bg-emerald-400' : 'bg-stone-200'}`} />}
              <div className={`flex items-center gap-1.5 text-xs font-medium ${splitStep === i + 1 ? 'text-primary' : i + 1 < splitStep ? 'text-text-muted' : 'text-text-muted/50'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${splitStep === i + 1 ? 'bg-primary ' : i + 1 < splitStep ? 'bg-emerald-100 text-primary' : 'bg-warm/30 text-text-muted/50'}`}>
                  {i + 1 < splitStep ? '✓' : i + 1}
                </div>
                {label}
              </div>
            </div>
          ))}
        </div>
        {splitStep === 1 && (
          <div>
            <p className="text-xs text-text-muted mb-3">勾选要从本户分出的成员（至少1人，户主不能被分出）</p>
            <div className="space-y-2">
              {members.filter(m => m.is_head !== 1).map(m => (
                <label key={m.id} className={`flex items-center gap-3 p-3 rounded-card border cursor-pointer transition-all
                  ${splitSelected.includes(m.id) ? 'bg-orange-50 border-orange-300' : 'bg-white border-border hover:border-border hover:bg-warm/30'}`}>
                  <input type="checkbox" checked={splitSelected.includes(m.id)}
                    onChange={e => setSplitSelected(prev => e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id))} className="w-4 h-4" />
                  <div className="flex-1">
                    <span className="font-semibold text-sm">{m.real_name}</span>
                    <span className="text-xs text-text-muted ml-2">{m.relation}</span>
                    {splitSelected.includes(m.id) && (
                      <label className="ml-3 flex items-center gap-1 inline-flex cursor-pointer" onClick={e => e.stopPropagation()}>
                        <input type="radio" name="new_head" value={m.id} checked={splitNewHead === m.id} onChange={() => setSplitNewHead(m.id)} className="w-4 h-4" />
                        <span className="text-xs text-orange-700">设为新户户主</span>
                      </label>
                    )}
                  </div>
                </label>
              ))}
              {members.filter(m => m.is_head === 1).map(m => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-card border border-border/50 bg-warm/30 opacity-50">
                  <input type="checkbox" disabled className="w-4 h-4" />
                  <span className="text-sm">{m.real_name}</span>
                  <Tag label="户主（不可分出）" color="gray" />
                </div>
              ))}
            </div>
            {splitSelected.length > 0 && !splitNewHead && <p className="text-xs text-amber-600 mt-2">提示：未选择户主，将默认选择列表中第一位作为新户户主</p>}
          </div>
        )}
        {splitStep === 2 && (
          <div className="space-y-3">
            <div className="bg-orange-50 border border-orange-100 rounded-card p-3 text-xs text-orange-700">
              将分出 {splitSelected.length} 名成员，户主为「{members.find(m => m.id === splitNewHead)?.real_name}」
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">新家庭户名称 *</label>
                <input value={splitForm.household_name} onChange={e => setSplitForm(f => ({ ...f, household_name: e.target.value }))}
                  placeholder={`${members.find(m => m.id === splitNewHead)?.real_name || ''}户`}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">分户年度 *</label>
                <select value={splitForm.split_year} onChange={e => setSplitForm(f => ({ ...f, split_year: e.target.value }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                  {years.map(y => <option key={y} value={y}>{y}年</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">分户日期</label>
                <input type="date" value={splitForm.split_date} onChange={e => setSplitForm(f => ({ ...f, split_date: e.target.value }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">新户土地面积（亩）</label>
                <input type="number" step="0.01" value={splitForm.new_land_area} onChange={e => setSplitForm(f => ({ ...f, new_land_area: e.target.value }))}
                  placeholder="可不填" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">原户调整后面积（亩）</label>
                <input type="number" step="0.01" value={splitForm.origin_land_area} onChange={e => setSplitForm(f => ({ ...f, origin_land_area: e.target.value }))}
                  placeholder="不变则不填" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">分户原因/说明</label>
                <textarea rows={2} value={splitForm.description} onChange={e => setSplitForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="如：子女独立成家" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
              </div>
            </div>
          </div>
        )}
        {splitStep === 3 && (
          <div className="space-y-3">
            <div className={`border rounded-card p-4 space-y-2 ${!splitNewHead ? 'bg-amber-50 border-amber-200' : 'bg-orange-50 border-orange-200'}`}>
              <p className={`text-sm font-semibold ${!splitNewHead ? 'text-amber-800' : 'text-orange-800'}`}>
                {!splitNewHead ? '⚠️ 请确认分户信息（未选择户主）' : '请确认分户信息'}
              </p>
              <div className={`text-xs space-y-1 ${!splitNewHead ? 'text-amber-700' : 'text-orange-700'}`}>
                <p>原户：{householdName || ''} → 将保留 {members.length - splitSelected.length} 名成员</p>
                <p>新户：{splitForm.household_name || '（未填写）'} → {splitSelected.length} 名成员</p>
                <p>新户户主：{splitNewHead
                  ? members.find(m => m.id === splitNewHead)?.real_name
                  : <span className="font-bold">{members.find(m => m.id === splitSelected[0])?.real_name}（默认第一位）</span>
                }</p>
                <p>年度：{splitForm.split_year}年{splitForm.split_date ? ` · ${splitForm.split_date}` : ''}</p>
                {splitForm.new_land_area && <p>新户面积：{splitForm.new_land_area}亩</p>}
                {splitForm.origin_land_area && <p>原户调整后面积：{splitForm.origin_land_area}亩</p>}
              </div>
            </div>
            <p className="text-xs text-text-muted">分户后系统将自动：为新户创建户籍档案 · 将成员移入新户 · 在两户的变更历史中各记录一条分户事件</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── 补录事件表单 ──
export function EventForm({ open, eventForm, setEventForm, onSubmit, onClose }: EventFormProps) {
  return (
    <Modal open={open} title="补录历史事件" onClose={onClose} onConfirm={onSubmit}>
      <div className="space-y-3">
        <div className="bg-blue-50 border border-blue-100 rounded-card p-3 text-xs text-blue-700">
          用于补录系统上线前的历史变动，或记录口头协议等无法自动捕获的事项。
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-text-muted mb-1">事件类型</label>
            <select value={eventForm.event_type} onChange={e => setEventForm(f => ({ ...f, event_type: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
              {Object.entries(EVENT_TYPE_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select></div>
          <div><label className="block text-xs text-text-muted mb-1">发生年度 *</label>
            <select value={eventForm.event_year} onChange={e => setEventForm(f => ({ ...f, event_year: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
              {years.map(y => <option key={y} value={y}>{y}年</option>)}
            </select></div>
          <div><label className="block text-xs text-text-muted mb-1">精确日期（可选）</label>
            <input type="date" value={eventForm.event_date} onChange={e => setEventForm(f => ({ ...f, event_date: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          <div><label className="block text-xs text-text-muted mb-1">证明材料类型</label>
            <select value={eventForm.evidence_type} onChange={e => setEventForm(f => ({ ...f, evidence_type: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
              <option value="NONE">无</option><option value="ID_CARD">身份证</option>
              <option value="HOUSEHOLD_REG">户籍证明</option><option value="VILLAGE_PROOF">村委证明</option>
              <option value="COURT">法院文书</option><option value="OTHER">其他</option>
            </select></div>
          <div className="col-span-2"><label className="block text-xs text-text-muted mb-1">事件描述 *</label>
            <textarea rows={3} value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
              placeholder="请描述发生了什么" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" /></div>
          <div className="col-span-2"><label className="block text-xs text-text-muted mb-1">证明材料说明</label>
            <input value={eventForm.evidence_note} onChange={e => setEventForm(f => ({ ...f, evidence_note: e.target.value }))}
              placeholder="如：村委证明第2024-08号" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
        </div>
      </div>
    </Modal>
  )
}

// ── 人工确认/取消确认表单 ──
export function ConfirmForm({ open, title, description, confirmForm, setConfirmForm, onSubmit, onClose, submitText, type, detail }: ConfirmFormProps) {
  return (
    <Modal open={open} title={title} onClose={onClose} onConfirm={onSubmit} confirmText={submitText}>
      <div className="space-y-4">
        {description && (
          <div className={`${type === 'cancel_confirm' ? 'bg-amber-50 border border-amber-100' : 'bg-blue-50 border border-blue-100'} rounded-card p-3 text-sm`}>
            <div className="font-medium mb-1">{type === 'cancel_confirm' ? '取消确认操作说明' : '确认操作说明'}</div>
            <p className="text-xs">{description}</p>
          </div>
        )}
        {detail && (
          <div>
            <label className="block text-xs text-text-muted mb-1">家庭户</label>
            <div className="text-sm font-medium text-text-primary">{detail.household_name} ({detail.household_code})</div>
          </div>
        )}
        {type === 'cancel_confirm' && detail?.manually_confirmed_at && (
          <div>
            <label className="block text-xs text-text-muted mb-1">原确认时间</label>
            <div className="text-sm text-text-primary">{new Date(detail.manually_confirmed_at).toLocaleString('zh-CN')}</div>
          </div>
        )}
        {type === 'cancel_confirm' && detail?.manually_confirmed_by && (
          <div>
            <label className="block text-xs text-text-muted mb-1">原操作人</label>
            <div className="text-sm text-text-primary">{detail.manually_confirmed_by}</div>
          </div>
        )}
        <div>
          <label className="block text-xs text-text-muted mb-1">操作人（可选）</label>
          <input value={confirmForm.operator} onChange={e => setConfirmForm(f => ({ ...f, operator: e.target.value }))}
            placeholder="请输入操作人姓名" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">{type === 'cancel_confirm' ? '取消原因（可选）' : '备注说明（可选）'}</label>
          <textarea rows={3} value={confirmForm.remark} onChange={e => setConfirmForm(f => ({ ...f, remark: e.target.value }))}
            placeholder="请输入备注说明" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none" />
        </div>
      </div>
    </Modal>
  )
}

// ── 删除家庭户确认弹窗 ──
export function DeleteConfirmForm({ open, deleteTarget, loading, onSubmit, onClose }: DeleteConfirmFormProps) {
  if (!deleteTarget) return null
  const memberCount = 'member_count' in deleteTarget ? deleteTarget.member_count : (deleteTarget as any).members?.length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-card shadow-2xl w-[480px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-red-600">⚠️ 删除家庭户</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="bg-red-50 border border-red-200 rounded-btn p-4 mb-4">
            <p className="text-sm text-red-700 font-medium mb-2">确定要删除以下家庭户吗？此操作不可撤销。</p>
            <div className="text-sm text-text-primary">
              <p><span className="font-semibold">户名：</span>{deleteTarget.household_name}</p>
              <p><span className="font-semibold">户号：</span>{deleteTarget.household_code}</p>
              <p><span className="font-semibold">村组：</span>{deleteTarget.village_full_name}</p>
              <p><span className="font-semibold">成员数：</span>{memberCount}人</p>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-btn p-4">
            <p className="text-sm text-amber-700">
              <span className="font-semibold">删除条件：</span>该家庭户必须满足以下条件才能删除：
            </p>
            <ul className="text-sm text-amber-600 mt-2 space-y-1 list-disc list-inside">
              <li>没有在册成员</li>
              <li>没有补贴申请记录</li>
              <li>没有土地流转记录</li>
              <li>没有家庭户变更事件记录</li>
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose}
            className="px-4 py-2 text-sm border border-border text-text-primary rounded-btn hover:bg-warm/30">
            取消
          </button>
          <button onClick={onSubmit} disabled={loading}
            className="px-4 py-2 text-sm bg-red-600  rounded-btn hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
            {loading ? <><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>删除中...</> : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 确权面积批量导入弹窗 ──
export interface ConfirmedAreaImportProps {
  open: boolean
  confirmedAreaRows: { real_name: string; id_card: string; confirmed_area: number }[]
  setConfirmedAreaRows: React.Dispatch<React.SetStateAction<{ real_name: string; id_card: string; confirmed_area: number }[]>>
  confirmedAreaImportResult: { success: number; not_found: { id_card: string; real_name: string }[]; mismatch_name: { id_card: string; input_name: string; db_name: string }[]; errors: { id_card: string; reason: string }[] } | null
  confirmedAreaImporting: boolean
  onSubmit: () => void
  onClose: () => void
}

export function ConfirmedAreaImport({ open, confirmedAreaRows, setConfirmedAreaRows, confirmedAreaImportResult, confirmedAreaImporting, onSubmit, onClose }: ConfirmedAreaImportProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-card shadow-2xl w-[560px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-text-primary">批量导入确权面积</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p className="text-sm text-text-muted">
            请上传包含 <span className="font-semibold text-text-primary">姓名、身份证号、确权面积</span> 三列的 Excel 文件（.xlsx/.xls）。
            系统将按身份证号匹配农户并更新其所在家庭户的确权面积。
          </p>
          <div>
            <label className="block text-xs text-text-muted mb-1">选择 Excel 文件</label>
            <input type="file" accept=".xlsx,.xls"
              onChange={async e => {
                const file = e.target.files?.[0]
                if (!file) return
                const data = await file.arrayBuffer()
                const wb = XLSX.read(data)
                const ws = wb.Sheets[wb.SheetNames[0]]
                const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
                const rows = raw.map(r => {
                  const name = String(r['姓名'] ?? r['real_name'] ?? r['名字'] ?? '').trim()
                  const idCard = String(r['身份证号'] ?? r['id_card'] ?? r['身份证'] ?? '').trim()
                  const area = parseFloat(String(r['确权面积'] ?? r['confirmed_area'] ?? r['确权面积(亩)'] ?? '0'))
                  return { real_name: name, id_card: idCard, confirmed_area: isNaN(area) ? 0 : area }
                }).filter(r => r.real_name && r.id_card)
                setConfirmedAreaRows(rows)
              }}
              className="block w-full text-sm text-text-primary file:mr-3 file:py-1.5 file:px-3 file:rounded-btn file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          </div>
          {confirmedAreaRows.length > 0 && !confirmedAreaImportResult && (
            <div className="bg-warm/30 rounded-btn p-3 text-sm text-text-primary">
              已解析 <span className="font-semibold text-text-primary">{confirmedAreaRows.length}</span> 条记录
              <div className="mt-2 max-h-40 overflow-y-auto text-xs space-y-1">
                {confirmedAreaRows.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex gap-3 text-text-muted">
                    <span className="truncate max-w-[80px]">{r.real_name}</span>
                    <span className="font-mono">{r.id_card.substring(0, 6)}***{r.id_card.slice(-4)}</span>
                    <span className="text-blue-600">{r.confirmed_area} 亩</span>
                  </div>
                ))}
                {confirmedAreaRows.length > 5 && <div className="text-text-muted">…还有 {confirmedAreaRows.length - 5} 条</div>}
              </div>
            </div>
          )}
          {confirmedAreaImportResult && (
            <div className="space-y-2 text-sm">
              <div className="flex gap-3">
                <span className="bg-primary/5 text-primary px-3 py-1 rounded-btn font-medium">成功 {confirmedAreaImportResult.success} 条</span>
                {confirmedAreaImportResult.not_found.length > 0 && <span className="bg-red-50 text-red-600 px-3 py-1 rounded-btn font-medium">未找到 {confirmedAreaImportResult.not_found.length} 条</span>}
                {confirmedAreaImportResult.mismatch_name.length > 0 && <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-btn font-medium">姓名不符 {confirmedAreaImportResult.mismatch_name.length} 条（已跳过）</span>}
                {confirmedAreaImportResult.errors.length > 0 && <span className="bg-red-50 text-red-600 px-3 py-1 rounded-btn font-medium">错误 {confirmedAreaImportResult.errors.length} 条</span>}
              </div>
              {confirmedAreaImportResult.not_found.length > 0 && (
                <div className="bg-red-50 rounded-btn p-2 max-h-28 overflow-y-auto">
                  <div className="text-xs font-medium text-red-600 mb-1">未找到的记录：</div>
                  {confirmedAreaImportResult.not_found.map((r, i) => (
                    <div key={i} className="text-xs text-red-500">{r.real_name} · {r.id_card}</div>
                  ))}
                </div>
              )}
              {confirmedAreaImportResult.mismatch_name.length > 0 && (
                <div className="bg-amber-50 rounded-btn p-2 max-h-28 overflow-y-auto">
                  <div className="text-xs font-medium text-amber-600 mb-1">姓名不符（已按身份证更新）：</div>
                  {confirmedAreaImportResult.mismatch_name.map((r, i) => (
                    <div key={i} className="text-xs text-amber-600">{r.id_card} · 输入"{r.input_name}" vs 库中"{r.db_name}"</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose}
            className="px-4 py-2 text-sm border border-border text-text-primary rounded-btn hover:bg-warm/30">
            关闭
          </button>
          {!confirmedAreaImportResult && (
            <button onClick={onSubmit} disabled={confirmedAreaRows.length === 0 || confirmedAreaImporting}
              className="px-4 py-2 text-sm bg-blue-600  rounded-btn hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
              {confirmedAreaImporting ? '导入中…' : `确认导入 ${confirmedAreaRows.length} 条`}
            </button>
          )}
          {confirmedAreaImportResult && (
            <button onClick={async () => {
              const resp = await api.exportConfirmedAreaDiff()
              const blob = await resp.blob()
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href = url; a.download = '确权面积对比.xlsx'; a.click()
              URL.revokeObjectURL(url)
            }} className="px-4 py-2 text-sm bg-primary/90  rounded-btn hover:bg-primary/50">
              导出对比报告
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 农户导入组件 ──
export interface FarmerImportProps {
  open: boolean
  templates: ExcelColumnTemplate[]
  importOverwrite: boolean
  onClose: () => void
  onDetectColumns: (columns: string[], sampleRows: Record<string, unknown>[]) => Promise<{ columns: Array<{ excel_column: string; suggested_field: string | null; confidence: number; alternatives: Array<{ field: string; confidence: number }> }>; recommended_templates: any[] }>
  onSaveTemplate: (data: Record<string, unknown>) => Promise<any>
  onImport: (rows: Record<string, unknown>[]) => Promise<{ created: number; skipped: number; errors: string[] }>
  onSuccess: () => void
}

export function FarmerImport({ open, templates, importOverwrite, onClose, onDetectColumns, onSaveTemplate, onImport, onSuccess }: FarmerImportProps) {
  return (
    <ExcelImportWithMapping open={open} onClose={onClose} title="农户信息导入"
      templateHeaders={FARMER_TEMPLATE_HEADERS} templateExample={FARMER_TEMPLATE_EXAMPLE}
      systemFields={FARMER_SYSTEM_FIELDS}
      templates={templates.map(t => ({
        id: t.id,
        template_name: t.template_name,
        column_mapping: t.column_mapping.map(m => ({
          excel_column: m.excel_column,
          system_field: m.system_field,
          required: m.required,
        })),
      }))}
      onDetectColumns={onDetectColumns} onSaveTemplate={onSaveTemplate}
      onImport={onImport} onSuccess={onSuccess} />
  )
}

// ── 成员导入组件 ──
export interface MemberImportProps {
  open: boolean
  householdName: string
  onImport: (rows: Record<string, unknown>[]) => Promise<{ created: number; skipped: number; errors: string[] }>
  onSuccess: () => void
  onClose: () => void
}

export function MemberImport({ open, householdName, onImport, onSuccess, onClose }: MemberImportProps) {
  return (
    <ExcelImport open={open} onClose={onClose}
      title={`成员导入 · ${householdName}`}
      templateHeaders={['身份证号*', '姓名*', '是否户主', '与户主关系', '手机号', '银行卡号', '开户行', '状态']}
      templateExample={[{ '身份证号*': '510123196503154231', '姓名*': '张国强', '是否户主': '1', '与户主关系': '本人', '手机号': '138xxxx0001', '银行卡号': '', '开户行': '', '状态': '在册' }]}
      onImport={onImport} onSuccess={onSuccess} />
  )
}

// ── 编辑家庭户表单 ──
export interface EditHouseholdFormProps {
  open: boolean
  editForm: {
    household_name: string
    contract_area: string
    village_id: number
    group_no: number
    address: string
    remark: string
  }
  groups: VillageGroup[]
  onSubmit: () => void
  onClose: () => void
  setEditForm: React.Dispatch<React.SetStateAction<{
    household_name: string
    contract_area: string
    village_id: number
    group_no: number
    address: string
    remark: string
  }>>
}

export function EditHouseholdForm({ open, editForm, groups, onSubmit, onClose, setEditForm }: EditHouseholdFormProps) {
  return (
    <Modal open={open} title="编辑家庭户信息" onClose={onClose} onConfirm={onSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="block text-xs text-text-muted mb-1">户名</label>
          <input value={editForm.household_name} onChange={e => setEditForm(f => ({ ...f, household_name: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
        <div><label className="block text-xs text-text-muted mb-1">所在村 *</label>
          <select value={editForm.village_id || ''} onChange={e => setEditForm(f => ({ ...f, village_id: Number(e.target.value) }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
            <option value="">请选择</option>
            {[...new Map(groups.map(g => [g.village_id, g])).values()].map(g => (
              <option key={g.village_id} value={g.village_id}>{g.village_name}</option>
            ))}
          </select>
        </div>
        <div><label className="block text-xs text-text-muted mb-1">所在组</label>
          <select value={editForm.group_no || 1} onChange={e => setEditForm(f => ({ ...f, group_no: Number(e.target.value) }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
            <option value={1}>一组</option>
            <option value={2}>二组</option>
            <option value={3}>三组</option>
            <option value={4}>四组</option>
            <option value={5}>五组</option>
            <option value={6}>六组</option>
            <option value={7}>七组</option>
            <option value={8}>八组</option>
            <option value={9}>九组</option>
          </select>
        </div>
        <div><label className="block text-xs text-text-muted mb-1">承包土地面积（亩）</label>
          <input type="number" step="0.01" value={editForm.contract_area} onChange={e => setEditForm(f => ({ ...f, contract_area: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
        <div><label className="block text-xs text-text-muted mb-1">地址</label>
          <input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
        <div className="col-span-2"><label className="block text-xs text-text-muted mb-1">备注</label>
          <textarea rows={2} value={editForm.remark} onChange={e => setEditForm(f => ({ ...f, remark: e.target.value }))}
            className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" /></div>
      </div>
    </Modal>
  )
}
