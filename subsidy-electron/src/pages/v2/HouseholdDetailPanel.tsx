/** 家庭户详情面板（三块垂直排列：家庭人口 / 补贴记录 / 土地流转与异常 Tab） */
import { useNavigate } from 'react-router-dom'
import { AddMemberButton, MemberRowActions } from './HouseholdActions'
import HouseholdActions from './HouseholdActions'
import { Card, FieldRow, FARMER_STATUS_LABEL, HH_STATUS_LABEL, PAY_STATUS_LABEL, money } from './shared'
import { Ico, ThIco } from './Icons'
import YearTimeline, { buildYears, useYearSnapshots } from './YearTimeline'
import SnapshotCard from './SnapshotCard'
import SeasonBars from './SeasonBars'
import { useHouseholdAnomalyTab } from '../../hooks/useUiSettings'
import { useState } from 'react'
import type { HHDetail } from '../../types'
export default function HouseholdDetailPanel({ detail, loading, onChanged }: { detail: HHDetail | null; loading: boolean; onChanged: () => void }) {
  const navigate = useNavigate()
  const [hhTab, setHhTab] = useState<'trust' | 'anomaly'>('trust')
  const [anomalyEnabled] = useHouseholdAnomalyTab()

  if (!detail) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一个家庭户'}</div>
  }

  const usage = detail.area_usage
  const refArea = (usage?.cultivable_area ?? usage?.contracted_area ?? 0) || 0
  const usedArea = usage?.used_area ?? 0
  const remaining = Math.max(0, refArea - usedArea)
  const overAmount = Math.max(0, usedArea - refArea)
  const isOver = overAmount > 0.001
  const members = detail.members || []
  const apps = detail.app_summary || []
  const appTotal = apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0)
  const overYears = Object.entries(usage?.year_totals || {})
    .filter(([, seasons]) => refArea > 0 && Object.values(seasons).some(v => v > refArea + 0.001))
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([y, seasons]) => ({ year: y, used: Math.max(...Object.values(seasons)) }))
  const trustIn = Number(usage?.trust_in_area ?? 0)
  const currentYear = new Date().getFullYear()
  const [selYear, setSelYear] = useState<number>(currentYear)
  const yearList = buildYears(apps, usage, refArea, members, currentYear)
  const snapMap = useYearSnapshots(detail.id, yearList.map(y => y.year))
  const isCurrent = selYear === currentYear
  const years = buildYears(apps, usage, refArea, members, currentYear, snapMap)
  const yearApps = selYear ? apps.filter(a => Number(a.apply_year) === selYear) : apps

  const trustOut = Number(usage?.trust_out_area ?? 0)

  return (
    <>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#E6E0D4]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#DDBE84] flex items-center justify-center text-[14px] font-bold shrink-0">
            {detail.household_name?.slice(0, 1) || '户'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{detail.household_name}</h2>
              <span className="text-[10px] border border-border rounded-[3px] px-1.5 py-[1px] text-[#7A7466] font-mono">{detail.household_code}</span>
              {overYears.length > 0 && <span className="text-[10px] bg-danger text-white font-semibold rounded-full px-2 py-[1px] shadow-[0_1px_3px_rgba(211,47,47,.35)]">超领 {overYears.length} 项</span>}
              {detail.is_manually_confirmed === 1 && <span className="text-[10px] bg-[#E2EDE6] text-[#2F5C46] rounded-[3px] px-1.5 py-[1px]">已确认</span>}
            </div>
            <div className="text-[11px] text-[#7A7466] mt-[3px] truncate">
              {detail.village_full_name}
              {detail.address ? ` · ${detail.address}` : ''}
              <span className="mx-1.5">·</span>
              {members.length} 名成员 · 在册 {members.filter(m => m.farmer_status === 1).length}
              {detail.manually_confirmed_at && <><span className="mx-1.5">·</span>人工确认 {detail.manually_confirmed_at.slice(0, 10)}</>}
            </div>
          </div>
        </div>
        <HouseholdActions detail={detail} onChanged={onChanged} />
      </div>

      <YearTimeline years={years} value={selYear} onChange={setSelYear} isCurrent={selYear === currentYear} />

      <div className="flex items-center px-4 py-2.5 bg-gradient-to-r from-[#1A3A2C] via-[#1A5C46] to-[#234A38] text-[#FFFFFF]">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D8B567" strokeWidth="1.6" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 11v9h14v-9" /><path d="M9 20v-5h6v5" /></svg>
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold truncate">面积与发放</div>
            <div className="text-[9.5px] text-white/55">按季节取最大 · 全部年度</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">参考面积</div><div className="text-[15px] font-bold text-[#DDBE84] font-mono">{refArea.toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">已使用</div><div className="text-[15px] font-bold font-mono">{usedArea.toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">剩余</div><div className="text-[15px] font-bold font-mono">{remaining.toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">超出</div><div className={`text-[15px] font-bold font-mono ${isOver ? 'text-[#F5D3CF]' : ''}`}>{isOver ? `+${overAmount.toFixed(2)} 亩` : '—'}</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">累计发放</div><div className="text-[15px] font-bold font-mono">{money(appTotal)}</div></div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-[#E6E0D4]">
        {[
          ['承包面积', `${Number(usage?.contracted_area ?? 0).toFixed(2)} 亩`],
          ['确权面积', detail.confirmed_area != null ? `${detail.confirmed_area} 亩` : '—'],
          ['转入 / 转出', `${trustIn.toFixed(2)} / ${trustOut.toFixed(2)}`],
          ['可耕种', usage?.cultivable_area != null ? `${Number(usage.cultivable_area).toFixed(2)} 亩` : '—'],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#E6E0D4]' : ''}`}>
            <div className="text-[9.5px] text-[#7A7466]">{k}</div>
            <div className="text-[11.5px] text-[#5C5749] mt-px font-mono">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5 items-start">
        <div className="flex flex-col gap-2.5 min-w-0">

          {/* ① 补贴记录 */}
          <div className="border border-[#E6E0D4] rounded-card overflow-hidden flex flex-col shrink-0">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#E6E0D4] shrink-0">
              <span className="text-[11.5px] font-semibold">补贴记录 <span className="text-[10px] text-[#7A7466] font-normal">{selYear} · {yearApps.length}</span></span>
              <span className="text-[10px] text-[#7A7466]">当年累计 <b className="font-mono text-primary">{money(yearApps.reduce((s, a) => s + Number(a.actual_amount || a.apply_amount || 0), 0))}</b></span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 238 }}>
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#F3EFE7] text-[#5C5749] text-[10px] text-left h-[28px] border-b border-[#D2CBBC]">
                    <th className="font-semibold px-2.5"><ThIco name="calendar" />年度</th>
                    <th className="font-semibold px-1.5"><ThIco name="subsidies" />补贴项目</th>
                    <th className="font-semibold px-1.5"><ThIco name="person" />成员</th>
                    <th className="font-semibold px-1.5 text-right"><ThIco name="area" />面积</th>
                    <th className="font-semibold px-1.5 text-right"><ThIco name="money" />金额</th>
                    <th className="font-semibold px-2.5"><ThIco name="check" />状态</th>
                  </tr>
                </thead>
                <tbody>
                  {yearApps.map((a, i) => (
                    <tr key={`${a.farmer_id}-${a.subsidy_name}-${i}`} className="border-t border-[#E6E0D4] h-[34px] hover:bg-[#F2F7F4] transition-colors">
                      <td className="px-2.5 font-semibold text-[#234A38]">{a.apply_year}</td>
                      <td className="px-1.5 truncate">{a.subsidy_name}</td>
                      <td className="px-1.5 text-[#5C5749]">{a.farmer_name}</td>
                      <td className="px-1.5 text-right font-mono">{a.apply_area != null ? Number(a.apply_area).toFixed(2) : '—'}</td>
                      <td className="px-1.5 text-right font-mono">{a.actual_amount ? money(a.actual_amount) : (a.apply_amount ? money(a.apply_amount) : '—')}</td>
                      <td className="px-2.5">
                        <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${a.pay_status === 2 ? 'bg-[#E2EDE6] text-[#2F5C46]' : 'bg-[#FBF3E2] text-[#8A6118]'}`}>
                          {PAY_STATUS_LABEL[a.pay_status] || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {yearApps.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[11px] text-text-muted/60">{selYear} 年暂无补贴记录</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ② 家庭人口 */}
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#E6E0D4] shrink-0">
              <span className="text-[11.5px] font-semibold">家庭人口 <span className="text-[10px] text-[#7A7466] font-normal">{isCurrent ? members.length : `${selYear} 年 · ${members.length}`}</span></span>
              {isCurrent
                ? <AddMemberButton detail={detail} onChanged={onChanged} />
                : <span className="text-[10px] text-[#7A7466]">历史视图不可编辑</span>}
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 238 }}>
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#F3EFE7] text-[#7A7466] text-[10px] text-left h-[26px]">
                    <th className="font-medium px-2.5"><ThIco name="person" />姓名</th>
                    <th className="font-medium px-1.5"><ThIco name="link" />关系</th>
                    <th className="font-medium px-1.5"><ThIco name="person" />身份证号</th>
                    <th className="font-medium px-1.5"><ThIco name="check" />状态</th>
                    <th className="font-medium px-2.5 text-right"><ThIco name="settings" />操作</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className={`border-t border-[#E6E0D4] h-[34px] hover:bg-[#F2F7F4] transition-colors ${m.farmer_status !== 1 ? 'opacity-70' : ''}`}>
                      <td className="px-2.5 font-semibold">
                        {m.real_name}
                        {m.is_head === 1 && <span className="ml-1 text-[9px] bg-[#E2EDE6] text-[#2F5C46] rounded-[2px] px-1">户主</span>}
                      </td>
                      <td className="px-1.5 text-[#5C5749]">{m.relation || (m.is_head === 1 ? '本人' : '成员')}</td>
                      <td className="px-1.5 font-mono text-[#7A7466]">{m.id_card_masked || '—'}</td>
                      <td className="px-1.5">
                        <span className={`text-[9px] rounded-full px-1.5 py-[1px] ${m.farmer_status === 1 ? 'bg-[#E2EDE6] text-[#2F5C46]' : 'bg-[#F1EDE4] text-[#5C5749]'}`}>
                          {FARMER_STATUS_LABEL[m.farmer_status] || '—'}
                        </span>
                      </td>
                      <td className="px-2.5 text-right whitespace-nowrap">
                        {isCurrent && <MemberRowActions detail={detail} member={m} onChanged={onChanged} />}
                      </td>
                    </tr>
                  ))}
                  {members.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[11px] text-text-muted/60">暂无成员</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ③ 土地流转 / 异常（内部 Tab 切换） */}
          <div className="border border-[#E6E0D4] rounded-card overflow-hidden flex flex-col shrink-0">
            <div className="flex items-center gap-4 px-2.5 border-b border-[#E6E0D4] h-8 shrink-0">
              <button onClick={() => setHhTab('trust')}
                className={`h-8 flex items-center gap-1 border-b-2 text-[11.5px] transition-colors ${hhTab === 'trust' ? 'border-primary text-primary font-bold' : 'border-transparent text-[#5C5749] hover:text-text-primary'}`}>
                土地流转
              </button>
              {anomalyEnabled && (
                <button onClick={() => setHhTab('anomaly')}
                  className={`relative h-8 flex items-center gap-1 border-b-2 text-[11.5px] transition-colors ${hhTab === 'anomaly' ? 'border-primary text-primary font-bold' : 'border-transparent text-[#5C5749] hover:text-text-primary'}`}>
                  异常
                  {overYears.length > 0 && <span className="text-[10px] font-normal text-danger">{overYears.length}</span>}
                  {overYears.length > 0 && <span className="absolute -top-0.5 -right-2 w-1.5 h-1.5 rounded-full bg-danger" />}
                </button>
              )}
            </div>
            <div className="px-3 py-2.5">
              {hhTab === 'trust' && (
                <div className="flex flex-col gap-2 text-[11px]">
                  <div className="flex items-center justify-between"><span className="text-[#7A7466]">转入面积</span><b className="font-mono">{trustIn.toFixed(2)} 亩</b></div>
                  <div className="flex items-center justify-between"><span className="text-[#7A7466]">转出面积</span><b className="font-mono">{trustOut.toFixed(2)} 亩</b></div>
                  <div className="flex items-center justify-between border-t border-[#E6E0D4] pt-2"><span className="text-[#7A7466]">可耕种面积</span><b className="font-mono text-primary">{Number(usage?.cultivable_area ?? 0).toFixed(2)} 亩</b></div>
                  <div className="text-[10px] text-text-muted pt-1">
                    {usage?.has_trust_data ? '本户存在流转记录，详细台账请在「土地流转」中查看。' : '本户暂无土地流转记录。'}
                  </div>
                  <button onClick={() => navigate('/land')} className="mt-1 h-7 px-3 rounded-btn bg-[#E2EDE6] text-[11px] text-[#2F5C46] font-medium hover:bg-[#C4DACC] transition-colors self-start">打开土地流转台账</button>
                </div>
              )}
              {hhTab === 'anomaly' && (
                overYears.length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-text-muted/60">本户没有超领记录</div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {overYears.map(o => (
                      <div key={o.year} className="flex items-center gap-2">
                        <span className="text-[9px] bg-danger text-white font-semibold rounded-[2px] px-1.5 py-[1px]">超领</span>
                        <span className="text-[11.5px] font-semibold">{o.year} 年度</span>
                        <span className="text-[10px] text-[#7A7466]">{o.used.toFixed(2)} / {refArea.toFixed(2)} 亩</span>
                        <span className="ml-auto text-[11px] font-bold text-danger">+{Math.max(0, o.used - refArea).toFixed(2)}</span>
                      </div>
                    ))}
                    <button onClick={() => navigate('/anomalies')} className="mt-1 h-7 px-3 rounded-btn bg-[#FCEAE8] text-[11px] text-danger font-medium hover:bg-[#F5D3CF] transition-colors self-start">进入异常中心</button>
                  </div>
                )
              )}
            </div>
        </div>


        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="各季面积使用"><SeasonBars usage={usage} refArea={refArea} /></Card>
          <Card title="家庭户信息">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="户名" value={detail.household_name} />
              <FieldRow label="户编码" value={detail.household_code} />
              <FieldRow label="村组" value={detail.village_full_name} />
              <FieldRow label="成员" value={`${members.length} 人 · 在册 ${members.filter(m => m.farmer_status === 1).length}`} />
              <FieldRow label="参考面积" value={`${refArea.toFixed(2)} 亩`} />
              <FieldRow label="人工确认" value={detail.manually_confirmed_at?.slice(0, 10) || '未确认'} />
            </div>
          </Card>
          <SnapshotCard householdId={detail.id} />
        </div>
      </div>
    </>
  )
}

