/**
 * 主体管理 - 家庭户操作按钮组
 *
 * 独立组件，自带弹窗状态；主页面只需渲染 <HouseholdActions detail={detail} onChanged={...} />。
 */
import { useEffect, useState } from 'react'
import * as api from '../../api'
import { useToast } from '../../hooks/useToast'
import { ConfirmForm, DeleteConfirmForm, EditHouseholdForm, MemberForm, SplitWizardForm } from '../FarmerForms'
import type { HH, HHDetail, HHMember, VillageGroup } from '../../types'
import MergeHouseholdsButton from './MergeHouseholds'
import {
  buildEditForm, emptyMemberForm, emptySplitForm,
  submitConfirm, submitDeleteHousehold, submitEditHousehold, submitMember, submitSplit,
} from './actions'

export default function HouseholdActions({ detail, onChanged }: { detail: HHDetail; onChanged: () => void }) {
  const currentHh = {
    id: detail.id,
    household_name: detail.household_name,
    household_code: detail.household_code,
    head_name: detail.members?.find(m => m.is_head === 1)?.real_name || '',
    member_count: detail.members?.length ?? 0,
    contracted_area: detail.contracted_area,
  } as unknown as HH
  const { show } = useToast()
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getVillageGroups().then(setGroups).catch(() => {})
  }, [])

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState(buildEditForm(detail))
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberEditTarget, setMemberEditTarget] = useState<HHMember | null>(null)
  const [memberForm, setMemberForm] = useState(emptyMemberForm)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitStep, setSplitStep] = useState<1 | 2 | 3>(1)
  const [splitSelected, setSplitSelected] = useState<number[]>([])
  const [splitNewHead, setSplitNewHead] = useState<number | null>(null)
  const [splitForm, setSplitForm] = useState(emptySplitForm)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmType, setConfirmType] = useState<'manual_confirm' | 'cancel_confirm'>('manual_confirm')
  const [confirmForm, setConfirmForm] = useState({ operator: '', remark: '' })
  const [deleteOpen, setDeleteOpen] = useState(false)

  const run = async (fn: () => Promise<unknown>, okMsg: string, close: () => void) => {
    setBusy(true)
    try {
      await fn()
      show(okMsg)
      close()
      onChanged()
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button onClick={() => { setEditForm(buildEditForm(detail)); setEditOpen(true) }} disabled={busy}
        className="h-7 px-2.5 rounded-btn bg-[#FDFAF3] border border-[#E8D8B8] text-[11px] text-[#8A6620] font-medium hover:bg-[#F6EEDC] transition-colors disabled:opacity-40">编辑档案</button>

      {detail.is_manually_confirmed === 1 ? (
        <button onClick={() => { setConfirmType('cancel_confirm'); setConfirmForm({ operator: '', remark: '' }); setConfirmOpen(true) }} disabled={busy}
          className="h-7 px-2.5 rounded-btn bg-[#F6EEDC] border border-[#E8D8B8] text-[11px] text-[#8A6620] font-medium hover:bg-[#EFE3C9] transition-colors disabled:opacity-40">取消确认</button>
      ) : (
        <button onClick={() => { setConfirmType('manual_confirm'); setConfirmForm({ operator: '', remark: '' }); setConfirmOpen(true) }} disabled={busy}
          className="h-7 px-2.5 rounded-btn bg-[#2C6B52] text-[11px] text-white font-medium hover:bg-[#245944] transition-colors disabled:opacity-40">人工确认</button>
      )}

      <button onClick={() => {
        setSplitStep(1); setSplitSelected([]); setSplitNewHead(null)
        setSplitForm({ ...emptySplitForm, origin_land_area: String(detail.contracted_area || '') })
        setSplitOpen(true)
      }} disabled={busy || (detail.members?.length ?? 0) < 2}
        className="h-7 px-2.5 rounded-btn bg-[#EDF3EF] border border-[#C9DCC9] text-[11px] text-[#2C6B52] font-medium hover:bg-[#DCE9E1] transition-colors disabled:opacity-40">分户</button>

      <MergeHouseholdsButton current={currentHh} onMerged={onChanged} />

      <button onClick={() => setDeleteOpen(true)} disabled={busy}
        className="h-7 px-2.5 rounded-btn bg-[#FDECEA] border border-[#E8C9C2] text-[11px] text-danger font-medium hover:bg-[#F9D9D4] transition-colors disabled:opacity-40">删除</button>

      <EditHouseholdForm open={editOpen} editForm={editForm} groups={groups} setEditForm={setEditForm}
        onClose={() => setEditOpen(false)}
        onSubmit={() => run(() => submitEditHousehold(detail.id, editForm), '已保存', () => setEditOpen(false))} />

      <MemberForm open={memberOpen} memberEditTarget={memberEditTarget} memberForm={memberForm}
        setMemberForm={setMemberForm} groups={groups} showToast={show} setGroups={setGroups}
        onClose={() => { setMemberOpen(false); setMemberEditTarget(null); setMemberForm(emptyMemberForm) }}
        onSubmit={() => run(() => submitMember(detail.id, memberEditTarget, memberForm),
          memberEditTarget ? '已更新' : '已新增',
          () => { setMemberOpen(false); setMemberEditTarget(null); setMemberForm(emptyMemberForm) })} />

      <SplitWizardForm open={splitOpen} splitStep={splitStep} splitSelected={splitSelected} splitNewHead={splitNewHead}
        splitForm={splitForm} members={detail.members || []} householdName={detail.household_name}
        setSplitStep={setSplitStep} setSplitSelected={setSplitSelected} setSplitNewHead={setSplitNewHead} setSplitForm={setSplitForm}
        onClose={() => setSplitOpen(false)}
        onSubmit={() => run(() => submitSplit(detail.id, splitSelected, splitNewHead, splitForm), '分户完成', () => setSplitOpen(false))} />

      <ConfirmForm open={confirmOpen} type={confirmType}
        title={confirmType === 'manual_confirm' ? '人工确认家庭户' : '取消人工确认'}
        description={confirmType === 'manual_confirm' ? '确认后该户信息将标记为已人工核对。' : '取消后该户将回到未确认状态。'}
        confirmForm={confirmForm} setConfirmForm={setConfirmForm}
        submitText={confirmType === 'manual_confirm' ? '确认' : '取消确认'}
        detail={{
          household_name: detail.household_name,
          household_code: detail.household_code,
          manually_confirmed_at: detail.manually_confirmed_at,
          manually_confirmed_by: detail.manually_confirmed_by,
        }}
        onClose={() => setConfirmOpen(false)}
        onSubmit={() => run(() => submitConfirm(detail.id, confirmType, confirmForm), '已更新确认状态', () => setConfirmOpen(false))} />

      <DeleteConfirmForm open={deleteOpen} loading={busy}
        deleteTarget={{
          household_name: detail.household_name,
          household_code: detail.household_code,
          village_full_name: detail.village_full_name,
          member_count: detail.members?.length ?? 0,
          members: detail.members || [],
        }}
        onClose={() => setDeleteOpen(false)}
        onSubmit={() => run(() => submitDeleteHousehold(detail.id), '已删除', () => setDeleteOpen(false))} />
    </div>
  )
}

/** 家庭成员行内操作（编辑 / 移出） */
export function MemberRowActions({ detail, member, onChanged }: { detail: HHDetail; member: HHMember; onChanged: () => void }) {
  const { show } = useToast()
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(emptyMemberForm)

  useEffect(() => {
    if (open) api.getVillageGroups().then(setGroups).catch(() => {})
  }, [open])

  const openEdit = () => {
    setForm({
      ...emptyMemberForm,
      real_name: member.real_name,
      relation: member.relation || '成员',
      is_head: member.is_head === 1,
      farmer_status: String(member.farmer_status),
      phone: '', bank_card: '', bank_name: '',
    })
    setOpen(true)
  }

  const remove = async () => {
    if (!window.confirm(`将「${member.real_name}」移出本户？`)) return
    setBusy(true)
    try {
      await api.removeHouseholdMember(detail.id, member.id)
      show('已移出')
      onChanged()
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={openEdit} disabled={busy} className="text-[10px] px-1.5 py-[1px] rounded-[3px] bg-[#EDF3EF] text-[#2C6B52] hover:bg-[#DCE9E1] transition-colors disabled:opacity-40">编辑</button>
      {member.is_head !== 1 && (
        <button onClick={remove} disabled={busy} className="ml-1.5 text-[10px] px-1.5 py-[1px] rounded-[3px] bg-[#FDECEA] text-danger hover:bg-[#F9D9D4] transition-colors disabled:opacity-40">移出</button>
      )}
      <MemberForm open={open} memberEditTarget={member} memberForm={form}
        setMemberForm={setForm} groups={groups} showToast={show} setGroups={setGroups}
        onClose={() => setOpen(false)}
        onSubmit={async () => {
          setBusy(true)
          try {
            await submitMember(detail.id, member, form)
            show('已更新')
            setOpen(false)
            onChanged()
          } catch (e) {
            show((e as Error).message, 'err')
          } finally {
            setBusy(false)
          }
        }} />
    </>
  )
}

/** 家庭成员卡片右上角：新增成员 */
export function AddMemberButton({ detail, onChanged }: { detail: HHDetail; onChanged: () => void }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [form, setForm] = useState(emptyMemberForm)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) api.getVillageGroups().then(setGroups).catch(() => {})
  }, [open])

  return (
    <>
      <button onClick={() => { setForm(emptyMemberForm); setOpen(true) }} className="text-[10px] px-2 py-[2px] rounded-[3px] bg-primary text-[#F7F3E7] font-medium hover:bg-[#154031] transition-colors">+ 新增成员</button>
      <MemberForm open={open} memberEditTarget={null} memberForm={form}
        setMemberForm={setForm} groups={groups} showToast={show} setGroups={setGroups}
        onClose={() => setOpen(false)}
        onSubmit={async () => {
          setBusy(true)
          try {
            await submitMember(detail.id, null, form)
            show('已新增')
            setOpen(false)
            onChanged()
          } catch (e) {
            show((e as Error).message, 'err')
          } finally {
            setBusy(false)
          }
        }} />
    </>
  )
}
