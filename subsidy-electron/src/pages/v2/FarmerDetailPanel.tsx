/** 农户详情面板 */
import { Card, FieldRow, FARMER_STATUS_LABEL, PAY_STATUS_LABEL, money } from './shared'
import { Ico, ThIco } from './Icons'
import { FarmerActions } from './FarmerActions'
import SnapshotCard from './SnapshotCard'
import SeasonBars from './SeasonBars'
import type { FarmerDetail, HHDetail } from '../../types'
export default function FarmerDetailPanel({ farmer, household, loading, onChanged }: { farmer: FarmerDetail | null; household: HHDetail | null; loading: boolean; onChanged: () => void }) {
  if (!farmer) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一名农户'}</div>
  }
  const members = household?.members || []
  const usage = household?.area_usage
  const refArea = (usage?.cultivable_area ?? usage?.contracted_area ?? 0) || 0
  const usedArea = usage?.used_area ?? 0
  const overAmount = Math.max(0, usedArea - refArea)
  const isOver = overAmount > 0.001
  const apps = farmer.applications || []
  const appTotal = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
  const age = (() => {
    const b = farmer.birth_date
    if (!b) return null
    const y = Number(b.slice(0, 4))
    return y ? new Date().getFullYear() - y : null
  })()
  const overYears = Object.entries(usage?.year_totals || {})
    .filter(([, seasons]) => refArea > 0 && Object.values(seasons).some(v => v > refArea + 0.001))
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([y]) => y)

  return (
    <>
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#F2EDE3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
            {farmer.real_name?.slice(-1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{farmer.real_name}</h2>
              <span className={`text-[10px] rounded-full px-1.5 py-[1px] ${farmer.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                {FARMER_STATUS_LABEL[farmer.farmer_status] || '未知'}
              </span>
              <span className={`text-[10px] rounded-[3px] px-1.5 py-[1px] ${farmer.is_head === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                {farmer.is_head === 1 ? '户主' : (farmer.relation || '成员')}
              </span>
              {overYears.length > 0 && <span className="text-[10px] bg-[#FDECEA] text-danger rounded-full px-1.5 py-[1px]">超领 {overYears.length} 项</span>}
            </div>
            <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
              <span className="font-mono">{farmer.id_card || farmer.id_card_masked || '—'}</span>
              <span className="mx-1.5">·</span>
              <span className="font-mono">{farmer.phone || farmer.phone_masked || '—'}</span>
              <span className="mx-1.5">·</span>
              {farmer.village_full_name}
            </div>
          </div>
        </div>
        <FarmerActions farmer={farmer} onChanged={onChanged} />
      </div>

      <div className="flex items-center px-4 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7] shadow-[0_6px_16px_rgba(15,61,46,.14)] shrink-0" style={{ height: 58 }}>
        <div className="flex items-center gap-2 w-[210px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D8B567" strokeWidth="1.6" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 11v9h14v-9" /><path d="M9 20v-5h6v5" /></svg>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold truncate">{household?.household_name || '未关联家庭户'}</div>
            <div className="text-[9.5px] text-white/55 truncate">{household ? `${household.household_code} · ${members.length} 名成员` : '—'}</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-[18px] border-l border-white/15">
            <div className="text-[9.5px] text-white/55">参考面积</div>
            <div className="text-[16px] font-bold text-[#E6C288] font-mono">{refArea.toFixed(2)} 亩</div>
          </div>
          <div className="px-[18px] border-l border-white/15">
            <div className="text-[9.5px] text-white/55">已使用</div>
            <div className="text-[16px] font-bold font-mono">{usedArea.toFixed(2)} 亩</div>
          </div>
          <div className="px-[18px] border-l border-white/15">
            <div className="text-[9.5px] text-white/55">超出</div>
            <div className={`text-[16px] font-bold font-mono ${isOver ? 'text-[#F2B8A8]' : ''}`}>{isOver ? `+${overAmount.toFixed(2)} 亩` : '—'}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-[#F2EDE3]">
        {[
          ['身份证号', farmer.id_card || farmer.id_card_masked || '—'],
          ['手机号', farmer.phone || farmer.phone_masked || '—'],
          ['出生日期 / 年龄', farmer.birth_date ? `${farmer.birth_date.slice(0, 10)}${age ? ` · ${age} 岁` : ''}` : '—'],
          ['银行卡', farmer.bank_card || farmer.bank_card_masked || '—'],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
            <div className="text-[9.5px] text-[#9A9588]">{k}</div>
            <div className="text-[11.5px] text-[#5A5A4F] mt-px font-mono truncate">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        <div className="flex flex-col gap-2.5 min-w-0 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 430px)' }}>
          <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
              <span className="text-[11.5px] font-semibold">补贴记录 <span className="text-[10px] text-[#8C877A] font-normal">{apps.length}</span></span>
              <span className="text-[10px] text-[#8C877A]">累计 <b className="font-mono text-primary">{money(appTotal)}</b></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                  <th className="font-medium px-2.5"><ThIco name="calendar" />年度</th>
                  <th className="font-medium px-1.5"><ThIco name="subsidies" />补贴项目</th>
                  <th className="font-medium px-1.5 text-right"><ThIco name="area" />面积</th>
                  <th className="font-medium px-1.5 text-right"><ThIco name="money" />金额</th>
                  <th className="font-medium px-1.5"><ThIco name="check" />状态</th>
                  <th className="font-medium px-2.5">发放日期</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a, i) => (
                  <tr key={a.id ?? i} className="border-t border-[#F2EDE3] h-[34px] hover:bg-[#F7FAF8] transition-colors">
                    <td className="px-2.5 font-semibold text-[#1A4D3A]">{a.apply_year}</td>
                    <td className="px-1.5 truncate">{a.subsidy_name}</td>
                    <td className="px-1.5 text-right font-mono">{a.apply_area != null ? Number(a.apply_area).toFixed(2) : '—'}</td>
                    <td className="px-1.5 text-right font-mono">{a.actual_amount ? money(a.actual_amount) : (a.apply_amount ? money(a.apply_amount) : '—')}</td>
                    <td className="px-1.5">
                      <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${a.pay_status === 2 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F6EEDC] text-[#8A6620]'}`}>
                        {PAY_STATUS_LABEL[a.pay_status] || '—'}
                      </span>
                    </td>
                    <td className="px-2.5 text-[#8C877A]">{a.pay_date || '—'}</td>
                  </tr>
                ))}
                {apps.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[11px] text-text-muted/60">暂无补贴记录</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
              <span className="text-[11.5px] font-semibold">家庭成员 <span className="text-[10px] text-[#8C877A] font-normal">{members.length}</span></span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <tbody>
                {members.map(m => (
                  <tr key={m.id} className="border-t border-[#F2EDE3] h-[30px] hover:bg-[#F7FAF8] transition-colors">
                    <td className="px-2.5 font-semibold">
                      {m.real_name}
                      {m.is_head === 1 && <span className="ml-1 text-[9px] bg-[#EDF3EF] text-[#2C6B52] rounded-[2px] px-1">户主</span>}
                    </td>
                    <td className="px-1.5 text-[#6B6B60]">{m.relation || (m.is_head === 1 ? '本人' : '成员')}</td>
                    <td className="px-1.5">
                      <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${m.farmer_status === 1 ? 'bg-[#EDF3EF] text-[#2C6B52]' : 'bg-[#F1EDE4] text-[#6B6B60]'}`}>
                        {FARMER_STATUS_LABEL[m.farmer_status] || '—'}
                      </span>
                    </td>
                    <td className="px-1.5 font-mono text-[#8C877A]">{m.id_card_masked || '—'}</td>
                  </tr>
                ))}
                {members.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-[11px] text-text-muted/60">暂无成员</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="各季面积使用">
            <SeasonBars usage={usage} refArea={refArea} />
          </Card>
          <Card title="家庭户信息">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="户名" value={household?.household_name || '—'} />
              <FieldRow label="户编码" value={household?.household_code || '—'} />
              <FieldRow label="村组" value={household?.village_full_name || farmer.village_full_name || '—'} />
              <FieldRow label="成员" value={household ? `${members.length} 人 · 在册 ${members.filter(m => m.farmer_status === 1).length}` : '—'} />
              <FieldRow label="参考面积" value={household ? `${refArea.toFixed(2)} 亩` : '—'} />
              <FieldRow label="人工确认" value={household?.manually_confirmed_at ? household.manually_confirmed_at.slice(0, 10) : '未确认'} />
            </div>
          </Card>
          <SnapshotCard householdId={household?.id ?? null} />
        </div>
      </div>
    </>
  )
}

/** 各季面积使用条（超限标红） */
