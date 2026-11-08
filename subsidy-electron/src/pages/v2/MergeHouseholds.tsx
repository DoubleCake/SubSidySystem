/**
 * 主体管理 - 合户
 *
 * 选择「目标户」与一个或多个「被合并户」，合并到目标户名下。
 */
import { useEffect, useState } from 'react'
import * as api from '../../api'
import { useToast } from '../../hooks/useToast'
import { MergeConfirmForm } from '../FarmerForms'
import type { HH } from '../../types'
import { submitMerge } from './actions'

export default function MergeHouseholdsButton({ current, onMerged }: { current: HH | null; onMerged: () => void }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [list, setList] = useState<HH[]>([])
  const [selected, setSelected] = useState<HH[]>([])
  const [confirmForm, setConfirmForm] = useState({ contract_area: '', remark: '' })

  useEffect(() => {
    if (!open) return
    api.getHouseholds({ page: 1, pageSize: 30, ...(keyword ? { search: keyword } : {}) })
      .then(r => setList(r.items || []))
      .catch(() => setList([]))
  }, [open, keyword])

  const toggle = (h: HH) => {
    setSelected(prev => prev.some(x => x.id === h.id) ? prev.filter(x => x.id !== h.id) : [...prev, h])
  }

  const start = () => {
    if (!current) return
    // 当前户作为目标户
    setSelected([current])
    setOpen(true)
  }

  const doMerge = async () => {
    if (selected.length < 2) return
    setBusy(true)
    try {
      const target = selected[0]
      for (const src of selected.slice(1)) {
        await submitMerge(src.id, target.id)
      }
      show(`已合并 ${selected.length} 户`)
      setConfirming(false)
      setOpen(false)
      setSelected([])
      onMerged()
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={start} disabled={!current}
        className="h-7 px-2.5 rounded-btn bg-[#E3EEF2] border border-[#C9DCE2] text-[11px] text-[#2E6478] font-medium hover:bg-[#D3E4EA] transition-colors disabled:opacity-40">合户</button>

      {open && !confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-card shadow-xl w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2.5 border-b border-border text-[13px] font-semibold">合户 · 选择要并入的家庭户</div>
            <div className="px-3 py-2 border-b border-[#F2EDE3]">
              <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索户名 / 户编码"
                className="w-full h-8 border border-border rounded-btn px-2.5 text-[12px] outline-none focus:border-primary-500" />
            </div>
            <div className="flex-1 overflow-y-auto max-h-[300px]">
              {list.map(h => {
                const on = selected.some(x => x.id === h.id)
                const isTarget = selected[0]?.id === h.id
                return (
                  <div key={h.id} onClick={() => !isTarget && toggle(h)}
                    className={`flex items-center gap-2 px-3 py-1.5 border-b border-[#F2EDE3] text-[11.5px] ${isTarget ? 'bg-[#F3F7F4] opacity-70 cursor-default' : 'cursor-pointer hover:bg-[#F7FAF8]'}`}>
                    <input type="checkbox" checked={on} disabled={isTarget} onChange={() => toggle(h)} className="w-3.5 h-3.5 accent-[#1A4D3A]" />
                    <span className="font-semibold">{h.household_name}</span>
                    <span className="text-[#8C877A] font-mono text-[10px]">{h.household_code}</span>
                    <span className="ml-auto text-[10px] text-[#8C877A]">{h.member_count ?? '?'} 人 · {h.contracted_area || 0} 亩</span>
                    {isTarget && <span className="text-[9px] bg-primary text-[#F7F3E7] rounded-[2px] px-1">目标户</span>}
                  </div>
                )
              })}
              {list.length === 0 && <div className="py-8 text-center text-[11px] text-text-muted/60">没有匹配的家庭户</div>}
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-warm/20">
              <span className="text-[10.5px] text-[#8C877A]">已选 {selected.length} 户（首个为目标户）</span>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="h-7 px-3 border border-border rounded-btn bg-white text-[11px] text-[#5A5A4F]">取消</button>
                <button disabled={selected.length < 2} onClick={() => { setConfirmForm({ contract_area: '', remark: '' }); setConfirming(true) }}
                  className="h-7 px-3 rounded-btn bg-primary text-[11px] text-[#F7F3E7] disabled:opacity-40">下一步</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <MergeConfirmForm open={confirming} mergeSelectedHouseholds={selected}
        mergeConfirmForm={confirmForm} setMergeConfirmForm={setConfirmForm} loading={busy}
        onClose={() => setConfirming(false)} onSubmit={doMerge} />
    </>
  )
}
