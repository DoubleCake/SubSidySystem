/** 村组详情面板（村集体作为申报主体） */
import { Card, FieldRow } from './shared'
import type { VillageDetail } from './types'
export default function VillagePanel({ detail, loading }: { detail: VillageDetail | null; loading: boolean }) {
  if (!detail) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一个村'}</div>
  }
  const groups = detail.groups || []
  const contacts = detail.contacts || []
  return (
    <>
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#F2EDE3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
            {detail.village_name?.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{detail.village_name}</h2>
              <span className="text-[10px] bg-[#EDF3EF] text-[#2C6B52] rounded-[3px] px-1.5 py-[1px]">村集体主体</span>
            </div>
            <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
              {detail.leader_name ? `负责人 ${detail.leader_name}` : '暂无在册负责人'}
              {detail.leader_phone ? <><span className="mx-1.5">·</span><span className="font-mono">{detail.leader_phone}</span></> : null}
              <span className="mx-1.5">·</span>
              {groups.length} 个组
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-7 px-2.5 border border-[#E6C288] rounded-btn bg-[#E6C288] text-[11px] text-[#5A4215] flex items-center">只读预览</span>
        </div>
      </div>

      <div className="flex items-center px-4 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7]" style={{ height: 58 }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold">村集体概况</div>
            <div className="text-[9.5px] text-white/55">村集体可作为补贴申报主体</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">村民组</div><div className="text-[15px] font-bold text-[#E6C288] font-mono">{groups.length} 个</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">历任负责人</div><div className="text-[15px] font-bold font-mono">{contacts.length} 人</div></div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        <div className="flex flex-col gap-2.5 min-w-0">
          <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
              <span className="text-[11.5px] font-semibold">村民组 <span className="text-[10px] text-[#8C877A] font-normal">{groups.length}</span></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                  <th className="font-medium px-2.5">组号</th>
                  <th className="font-medium px-2.5">组长</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id} className="border-t border-[#F2EDE3] h-[30px] hover:bg-[#F7FAF8] transition-colors">
                    <td className="px-2.5 font-semibold">{g.group_no} 组</td>
                    <td className="px-2.5 text-[#6B6B60]">{g.leader_name || '—'}</td>
                  </tr>
                ))}
                {groups.length === 0 && <tr><td colSpan={2} className="py-8 text-center text-[11px] text-text-muted/60">暂无村民组</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
              <span className="text-[11.5px] font-semibold">负责人记录 <span className="text-[10px] text-[#8C877A] font-normal">{contacts.length}</span></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id} className="border-t border-[#F2EDE3] h-[30px] hover:bg-[#F7FAF8] transition-colors">
                    <td className="px-2.5 font-semibold">{c.leader_name}</td>
                    <td className="px-1.5 font-mono text-[#8C877A]">{c.leader_phone}</td>
                    <td className="px-2.5 text-[10px] text-[#8C877A] text-right">{c.start_year} — {c.end_year ?? '至今'}</td>
                  </tr>
                ))}
                {contacts.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-[11px] text-text-muted/60">暂无负责人记录</td></tr>}
              </tbody>
            </table>
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

