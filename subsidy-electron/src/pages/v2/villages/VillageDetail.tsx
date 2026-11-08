/** 村组详情面板（村集体作为申报主体） */
import { Card, FieldRow } from '../shared'
import { Ico, ThIco } from '../Icons'
import { VillageActions, VillageContactTable, GroupLeaderEditor } from './VillageActions'
import type { VillageDetail } from '../types'
export default function VillageDetail({ detail, loading, onChanged }: { detail: VillageDetail | null; loading: boolean; onChanged?: () => void }) {
  if (!detail) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一个村'}</div>
  }
  const groups = detail.groups || []
  const contacts = detail.contacts || []
  return (
    <>
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#E6E0D4]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#DDBE84] flex items-center justify-center text-[14px] font-bold shrink-0">
            {detail.village_name?.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{detail.village_name}</h2>
              <span className="text-[10px] bg-[#E2EDE6] text-[#2F5C46] rounded-[3px] px-1.5 py-[1px]">村集体主体</span>
            </div>
            <div className="text-[11px] text-[#7A7466] mt-[3px] truncate">
              {detail.leader_name ? `负责人 ${detail.leader_name}` : '暂无在册负责人'}
              {detail.leader_phone ? <><span className="mx-1.5">·</span><span className="font-mono">{detail.leader_phone}</span></> : null}
              <span className="mx-1.5">·</span>
              {groups.length} 个组
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onChanged && <VillageActions villageId={detail.id} onChanged={onChanged} />}
        </div>
      </div>

      <div className="flex items-center px-4 bg-gradient-to-r from-[#1A3A2C] via-[#1A5C46] to-[#234A38] text-[#FFFFFF]" style={{ height: 58 }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold">村集体概况</div>
            <div className="text-[9.5px] text-white/55">村集体可作为补贴申报主体</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">村民组</div><div className="text-[15px] font-bold text-[#DDBE84] font-mono">{groups.length} 个</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">历任负责人</div><div className="text-[15px] font-bold font-mono">{contacts.length} 人</div></div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        <div className="flex flex-col gap-2.5 min-w-0">
          <div className="border border-[#E6E0D4] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#E6E0D4]">
              <span className="text-[11.5px] font-semibold">村民组 <span className="text-[10px] text-[#7A7466] font-normal">{groups.length}</span></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#EFE7D8] text-[#5C5749] text-[10px] text-left h-[26px] border-b border-[#D2CBBC]">
                  <th className="font-semibold px-2.5">组号</th>
                  <th className="font-semibold px-2.5">组长</th>
                  <th className="font-semibold px-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id} className="border-t border-[#E6E0D4] h-[30px] hover:bg-[#F2F7F4] transition-colors">
                    <td className="px-2.5 font-semibold">{g.group_no} 组</td>
                    <td className="px-2.5 text-[#5C5749]">{g.leader_name || '—'}</td>
                    <td className="px-2.5 text-right">
                      {onChanged && <GroupLeaderEditor villageId={detail.id} group={g} onChanged={onChanged} />}
                    </td>
                  </tr>
                ))}
                {groups.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-[11px] text-[#A8A091]">暂无村民组</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="border border-[#E6E0D4] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#E6E0D4]">
              <span className="text-[11.5px] font-semibold">负责人记录 <span className="text-[10px] text-[#7A7466] font-normal">{contacts.length}</span></span>
            </div>
            <VillageContactTable villageId={detail.id} contacts={contacts as any} onChanged={onChanged || (() => {})} />
          </div>
        </div>

        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="村集体信息">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="村名" value={detail.village_name} />
              <FieldRow label="负责人" value={detail.leader_name || '—'} />
              <FieldRow label="联系电话" value={detail.leader_phone || '—'} />
              <FieldRow label="村民组" value={`${groups.length} 个`} />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

