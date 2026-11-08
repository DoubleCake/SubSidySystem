/** 大户详情面板 */
import { Card, FieldRow, money } from './shared'
import { OPERATOR_LABEL } from './types'
import type { LargeFarmer, LargeFarmerTrust } from './types'
export default function LargeFarmerPanel({ farmer, trusts, loading }: { farmer: LargeFarmer | null; trusts: LargeFarmerTrust[]; loading: boolean }) {
  if (!farmer) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一名大户'}</div>
  }
  const trustTotal = trusts.reduce((s, t) => s + Number(t.area || 0), 0)
  return (
    <>
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#F2EDE3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
            {farmer.operator_name?.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{farmer.operator_name}</h2>
              <span className="text-[10px] bg-[#F6EEDC] text-[#8A6620] rounded-full px-1.5 py-[1px]">{OPERATOR_LABEL[farmer.operator_type] || farmer.operator_type_label}</span>
            </div>
            <div className="text-[11px] text-[#8C877A] mt-[3px] truncate">
              <span className="font-mono">{farmer.id_card || '—'}</span>
              <span className="mx-1.5">·</span>
              <span className="font-mono">{farmer.phone || '—'}</span>
              <span className="mx-1.5">·</span>
              {farmer.village_name}{farmer.group_no ? ` ${farmer.group_no} 组` : ''}
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
            <div className="text-[11.5px] font-semibold">经营规模</div>
            <div className="text-[9.5px] text-white/55">按当前流转台账汇总</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">经营面积</div><div className="text-[15px] font-bold text-[#E6C288] font-mono">{Number(farmer.total_managed_area || 0).toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">自有承包</div><div className="text-[15px] font-bold font-mono">{Number(farmer.own_contract_area || 0).toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">流入</div><div className="text-[15px] font-bold font-mono">{Number(farmer.trust_in_area || 0).toFixed(2)} 亩</div></div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-[#F2EDE3]">
        {[
          ['身份证号', farmer.id_card || '—'],
          ['手机号', farmer.phone || '—'],
          ['所在村组', `${farmer.village_name}${farmer.group_no ? ` ${farmer.group_no} 组` : ''}`],
          ['地址', farmer.address || '—'],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
            <div className="text-[9.5px] text-[#9A9588]">{k}</div>
            <div className="text-[11.5px] text-[#5A5A4F] mt-px truncate">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        <div className="border border-[#F0EBE1] rounded-card overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3]">
            <span className="text-[11.5px] font-semibold">流转明细 <span className="text-[10px] text-[#8C877A] font-normal">{trusts.length}</span></span>
            <span className="text-[10px] text-[#8C877A]">合计 <b className="font-mono text-primary">{trustTotal.toFixed(2)} 亩</b></span>
          </div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-[#F6F1E7] text-[#8C877A] text-[10px] text-left h-[26px]">
                <th className="font-medium px-2.5">转出户</th>
                <th className="font-medium px-1.5">类型</th>
                <th className="font-medium px-1.5 text-right">面积</th>
                <th className="font-medium px-2.5">起止</th>
              </tr>
            </thead>
            <tbody>
              {trusts.map(t => (
                <tr key={t.id} className="border-t border-[#F2EDE3] h-[34px] hover:bg-[#F7FAF8] transition-colors">
                  <td className="px-2.5">
                    <b>{t.owner_household_name}</b>
                    <span className="ml-1 text-[9.5px] text-[#8C877A] font-mono">{t.owner_household_code}</span>
                  </td>
                  <td className="px-1.5 text-[#6B6B60]">{t.trust_type_label}</td>
                  <td className="px-1.5 text-right font-mono">{Number(t.area || 0).toFixed(2)}</td>
                  <td className="px-2.5 text-[10px] text-[#8C877A]">
                    {t.trust_year} 年{t.start_date ? ` · ${t.start_date.slice(0, 10)}` : ''}
                  </td>
                </tr>
              ))}
              {trusts.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-[11px] text-text-muted/60">{loading ? '加载中…' : '暂无流转记录'}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="经营构成">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="自有承包" value={`${Number(farmer.own_contract_area || 0).toFixed(2)} 亩`} />
              <FieldRow label="流入面积" value={`${Number(farmer.trust_in_area || 0).toFixed(2)} 亩`} />
              <FieldRow label="流转笔数" value={`${trusts.length} 笔`} />
              <FieldRow label="合计" value={`${trustTotal.toFixed(2)} 亩`} />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

/** 村组详情面板（村集体作为申报主体） */
