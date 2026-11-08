/**
 * 大户详情面板
 *
 * 结构：档案头 → 经营规模条 → 主体信息 + 经营数据 → 流转明细表 / 右侧信息卡
 */
import { useEffect, useState } from 'react'

import { Card, FieldRow } from './shared'
import { Ico, ThIco } from './Icons'
import { OPERATOR_LABEL } from './types'
import type { LargeFarmer, LargeFarmerTrust } from './types'

interface Props {
  farmer: LargeFarmer | null
  trusts: LargeFarmerTrust[]
  loading: boolean
  onChanged?: () => void
}

export default function LargeFarmerPanel({ farmer, trusts, loading }: Props) {
  const [folder, setFolder] = useState('')

  useEffect(() => {
    window.electronAPI.invoke('settings:getLargeFarmerFolder')
      .then((v: unknown) => setFolder(String(v || '')))
      .catch(() => {})
  }, [])

  if (!farmer) {
    return <div className="py-24 text-center text-[11.5px] text-text-muted/60">{loading ? '加载中…' : '请从左侧选择一名大户'}</div>
  }

  const trustTotal = trusts.reduce((s, t) => s + Number(t.area || 0), 0)
  const plantedTotal = trusts.reduce((s, t) => s + Number(t.planted_area ?? 0), 0)

  // 经营数据：流转面积 / 种植面积 / 自有面积
  const trustArea = Number(farmer.trust_in_area ?? trustTotal)
  const ownArea = Number(farmer.own_contract_area || 0)
  const plantedArea = plantedTotal > 0 ? plantedTotal : (Number(farmer.total_managed_area || 0) || trustArea + ownArea)

  const pickFolder = async () => {
    const f = await window.electronAPI.invoke('dialog:selectFolder')
    const fp = String(f || '')
    if (!fp) return
    await window.electronAPI.invoke('settings:setLargeFarmerFolder', fp)
    setFolder(fp)
  }

  return (
    <>
      {/* 档案头 */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#F2EDE3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[38px] h-[38px] rounded-card bg-primary text-[#E6C288] flex items-center justify-center text-[14px] font-bold shrink-0">
            {farmer.operator_name?.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-[18px] font-bold text-primary m-0 leading-tight">{farmer.operator_name}</h2>
              <span className="text-[10px] bg-[#F6EEDC] text-[#8A6620] rounded-full px-1.5 py-[1px]">
                {OPERATOR_LABEL[farmer.operator_type] || farmer.operator_type_label}
              </span>
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
          {folder ? (
            <>
              <button onClick={() => window.electronAPI.invoke('shell:openFolder', folder)}
                className="h-7 px-2.5 rounded-btn bg-[#E3EEF2] border border-[#C9DCE2] text-[11px] text-[#2E6478] font-medium hover:bg-[#D3E4EA] transition-colors inline-flex items-center gap-1"><Ico name="link" size={12} />打开资料</button>
              <button onClick={pickFolder}
                className="h-7 px-2.5 rounded-btn bg-white border border-border text-[11px] text-[#5A5A4F] hover:bg-warm/30 transition-colors">更换</button>
            </>
          ) : (
            <button onClick={pickFolder}
              className="h-7 px-2.5 rounded-btn bg-[#E3EEF2] border border-[#C9DCE2] text-[11px] text-[#2E6478] font-medium hover:bg-[#D3E4EA] transition-colors inline-flex items-center gap-1"><Ico name="create" size={12} />绑定资料文件夹</button>
          )}
        </div>
      </div>

      {/* 资料文件夹路径 */}
      {folder && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[#F2EDE3] bg-[#FAFBFC]">
          <span className="text-[10px] text-[#9A9588] shrink-0">资料文件夹</span>
          <span className="text-[10.5px] text-[#2E6478] font-mono truncate" title={folder}>{folder}</span>
        </div>
      )}

      {/* 经营规模条 */}
      <div className="flex items-center px-4 bg-gradient-to-r from-[#0F3D2E] via-[#1A5C46] to-[#2C7A63] text-[#F7F3E7]" style={{ height: 58 }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold">经营数据</div>
            <div className="text-[9.5px] text-white/55">按当前流转台账汇总</div>
          </div>
        </div>
        <div className="flex items-center ml-auto">
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">流转面积</div><div className="text-[15px] font-bold text-[#E6C288] font-mono">{trustArea.toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">种植面积</div><div className="text-[15px] font-bold font-mono">{plantedArea.toFixed(2)} 亩</div></div>
          <div className="px-4 border-l border-white/15"><div className="text-[9.5px] text-white/55">自有面积</div><div className="text-[15px] font-bold font-mono">{ownArea.toFixed(2)} 亩</div></div>
        </div>
      </div>

      {/* 主体信息四列 */}
      <div className="grid grid-cols-4 border-b border-[#F2EDE3]">
        {[
          ['经营人', farmer.operator_name || '—'],
          ['法人', (farmer as any).legal_person || '—'],
          ['联系方式', (farmer as any).contact_person || farmer.phone || '—'],
          ['公户账号', (farmer as any).public_account || '—'],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i < 3 ? 'border-r border-[#F2EDE3]' : ''}`}>
            <div className="text-[9.5px] text-[#9A9588]">{k}</div>
            <div className="text-[11.5px] text-[#5A5A4F] mt-px truncate" title={String(v)}>{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-3 px-3 py-2.5">
        {/* 流转明细 */}
        <div className="border border-[#F0EBE1] rounded-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#F2EDE3] shrink-0">
            <span className="text-[11.5px] font-semibold">流转明细 <span className="text-[10px] text-[#8C877A] font-normal">{trusts.length}</span></span>
            <span className="text-[10px] text-[#8C877A]">合计 <b className="font-mono text-primary">{trustTotal.toFixed(2)} 亩</b></span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#EFE7D8] text-[#6B6B60] text-[10px] text-left h-[28px] border-b border-[#DDD3C2]">
                  <th className="font-semibold px-2.5"><ThIco name="land" /><ThIco name="land" />与谁流转</th>
                  <th className="font-semibold px-1.5"><ThIco name="filter" /><ThIco name="filter" />类型</th>
                  <th className="font-semibold px-1.5 text-right"><ThIco name="area" /><ThIco name="area" />面积</th>
                  <th className="font-semibold px-2.5"><ThIco name="calendar" /><ThIco name="calendar" />流转时限</th>
                </tr>
              </thead>
              <tbody>
                {trusts.map(t => (
                  <tr key={t.id} className="border-t border-[#E4DCCD] h-[34px] hover:bg-[#F0F5F2] transition-colors">
                    <td className="px-2.5">
                      <b>{t.owner_household_name || t.counterparty_name || '—'}</b>
                      {(t.counterparty_village || t.owner_household_code) && (
                        <span className="ml-1 text-[9.5px] text-[#8C877A] font-mono">
                          {t.counterparty_village || t.owner_household_code}
                        </span>
                      )}
                    </td>
                    <td className="px-1.5 text-[#6B6B60]">{t.trust_type_label || t.trust_type || '—'}</td>
                    <td className="px-1.5 text-right font-mono">{Number(t.area || 0).toFixed(2)}</td>
                    <td className="px-2.5 text-[10px] text-[#8C877A]">
                      {t.start_date || t.end_date
                        ? `${(t.start_date || '').slice(0, 10) || '—'} ~ ${(t.end_date || '').slice(0, 10) || '—'}`
                        : `${t.trust_year} 年度`}
                      {t.trust_days ? <span className="ml-1 text-[#9A9588]">（{t.trust_days} 天）</span> : null}
                    </td>
                  </tr>
                ))}
                {trusts.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-[11px] text-text-muted/60">{loading ? '加载中…' : '暂无流转记录'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-2.5 py-1.5 border-t border-[#F2EDE3] text-[9.5px] text-[#9A9588]">
            流转明细后续支持从 Excel 批量导入
          </div>
        </div>

        {/* 右栏 */}
        <div className="flex flex-col gap-2.5 min-w-0">
          <Card title="经营构成" icon="chart">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="流转面积" value={`${trustArea.toFixed(2)} 亩`} />
              <FieldRow label="种植面积" value={`${plantedArea.toFixed(2)} 亩`} />
              <FieldRow label="自有面积" value={`${ownArea.toFixed(2)} 亩`} />
              <FieldRow label="流转笔数" value={`${trusts.length} 笔`} />
            </div>
          </Card>
          <Card title="主体信息" icon="person">
            <div className="flex flex-col gap-1 text-[10.5px]">
              <FieldRow label="经营人" value={farmer.operator_name || '—'} />
              <FieldRow label="法人" value={(farmer as any).legal_person || '—'} />
              <FieldRow label="联系方式" value={(farmer as any).contact_person || farmer.phone || '—'} />
              <FieldRow label="身份证" value={farmer.id_card || '—'} />
              <FieldRow label="公户账号" value={(farmer as any).public_account || '—'} />
              <FieldRow label="开户行" value={(farmer as any).public_bank || '—'} />
              <FieldRow label="所在村组" value={`${farmer.village_name}${farmer.group_no ? ` ${farmer.group_no} 组` : ''}`} />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
