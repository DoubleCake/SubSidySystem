/**
 * 主体管理 · 渲染层
 *
 * 从 HouseholdRegistryV2Page 原样导出，不含状态逻辑；
 * 所有数据与回调通过 props 注入，便于后续按主体拆分。
 */
import { Ico } from './Icons'
import { Chip, ListRow, FARMER_STATUS_LABEL, HH_STATUS_LABEL } from './shared'
import { OPERATOR_LABEL } from './types'
import FarmerDetailPanel from './FarmerDetailPanel'
import HouseholdDetailPanel from './HouseholdDetailPanel'
import LargeFarmerPanel from './LargeFarmerPanel'
import VillagePanel from './VillagePanel'
import RegistryShell, { type SideTab } from './RegistryShell'

interface P {
  navigate: (to: string) => void
  sideTab: 'farmers' | 'households' | 'large' | 'villages'
  setSideTab: (t: any) => void
  list: any[]; total: number; page: number; totalPages: number; loadingList: boolean
  searchInput: string; setSearchInput: (v: string) => void
  village: string; setVillage: (v: string) => void
  status: string; setStatus: (v: string) => void
  villages: string[]; householdTotal: number | null; setPage: (p: number | ((prev: number) => number)) => void
  hhList: any[]; hhTotal: number; hhPage: number; hhTotalPages: number; loadingHhList: boolean
  hhSearchInput: string; setHhSearchInput: (v: string) => void
  hhVillage: string; setHhVillage: (v: string) => void
  hhStatus: string; setHhStatus: (v: string) => void
  selectedHhId: number | null; setSelectedHhId: (id: number) => void; setHhPage: (p: number | ((prev: number) => number)) => void
  largeList: any[]; largeTotal: number; largePage: number; largeTotalPages: number; loadingLarge: boolean
  selectedLargeId: number | null; setSelectedLargeId: (id: number) => void; setLargePage: (p: number | ((prev: number) => number)) => void
  largeTrusts: any[]; loadingTrusts: boolean
  villageList: any[]; selectedVillageId: number | null; setSelectedVillageId: (id: number) => void
  villageDetail: any; loadingVillage: boolean
  selectedId: number | null; setSelectedId: (id: number) => void
  farmer: any; household: any; loadingDetail: boolean
  reloadHousehold: () => void; reloadFarmer: () => void
}

export default function RegistryView(p: P) {
  return (
    <div className="space-y-3">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-[8px] bg-gradient-to-br from-[#1A5C46] to-[#234A38] text-[#DDBE84]">
              <Ico name="farmers" size={15} />
            </span>
            <h1 className="text-[20px] font-bold text-primary leading-tight">主体管理</h1>
          </div>
          <div className="text-[11px] text-[#7A7466] mt-1">农户、家庭户、大户与村组统一管理，左侧选择对象，右侧查看档案与关联信息</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => p.navigate('/settings/farmer-attribute-import')}
            className="h-[30px] px-3 border border-border rounded-btn bg-white text-[12px] text-[#5C5749] hover:bg-warm/30 transition-colors inline-flex items-center gap-1.5">
            <Ico name="upload" size={13} />
            导入户籍
          </button>
        </div>
      </div>

      <RegistryShell
        tabs={[
          { id: 'farmers', label: '农户', icon: 'person', count: p.total },
          { id: 'households', label: '家庭户', icon: 'household', count: p.householdTotal },
          { id: 'large', label: '大户', icon: 'farmers', count: null },
          { id: 'villages', label: '村组', icon: 'village', count: null },
        ]}
        activeTab={p.sideTab}
        onTabChange={(t: any) => p.setSideTab(t)}
        searchPlaceholder={p.sideTab === 'farmers' ? '姓名 / 身份证 / 手机号' : '户名 / 户编码 / 户主'}
        searchValue={p.sideTab === 'farmers' ? p.searchInput : p.hhSearchInput}
        onSearchChange={(v: string) => { if (p.sideTab === 'farmers') p.setSearchInput(v); else p.setHhSearchInput(v) }}
        filters={(
              <div className="flex gap-1.5">
                <select value={p.sideTab === 'farmers' ? p.village : p.hhVillage}
                  onChange={e => { if (p.sideTab === 'farmers') { p.setVillage(e.target.value); p.setPage(1) } else { p.setHhVillage(e.target.value); p.setHhPage(1) } }}
                  className="flex-1 h-7 border border-border rounded-btn px-1.5 text-[11px] text-[#5C5749] bg-white outline-none">
                  <option value="">全部村</option>
                  {p.villages.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <select value={p.sideTab === 'farmers' ? p.status : p.hhStatus}
                  onChange={e => { if (p.sideTab === 'farmers') { p.setStatus(e.target.value); p.setPage(1) } else { p.setHhStatus(e.target.value); p.setHhPage(1) } }}
                  className="flex-1 h-7 border border-border rounded-btn px-1.5 text-[11px] text-[#5C5749] bg-white outline-none">
                  <option value="">全部状态</option>
                  <option value="1">在册</option>
                  <option value="2">注销</option>
                  <option value="3">迁出</option>
                  {p.sideTab === 'farmers' && <option value="4">死亡</option>}
                </select>
              </div>
        )}
        listBody={(
            <div className="flex-1 overflow-y-auto">
              {p.sideTab === 'farmers' && (
                <>
                  {p.loadingList && <div className="py-10 text-center text-[11px] text-text-muted/60">加载中…</div>}
                  {!p.loadingList && p.list.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无数据</div>}
                  {!p.loadingList && p.list.map(f => (
                    <ListRow key={f.id} active={p.selectedId === f.id} onClick={() => p.setSelectedId(f.id)}
                      avatar={f.real_name?.slice(-1) || '—'} name={f.real_name}
                      tags={
                        <>
                          <Chip tone={f.is_head === 1 ? 'green' : 'gray'}>{f.is_head === 1 ? '户主' : (f.relation || '成员')}</Chip>
                          <Chip tone={f.farmer_status === 1 ? 'green' : f.farmer_status === 3 ? 'amber' : 'gray'}>
                            {FARMER_STATUS_LABEL[f.farmer_status] || '未知'}
                          </Chip>
                        </>
                      }
                      sub={<>{f.village_full_name || '—'}{f.contract_area ? ` · ${f.contract_area} 亩` : ''} · <span className="font-mono">{f.id_card_masked}</span></>} />
                  ))}
                </>
              )}
              {p.sideTab === 'households' && (
                <>
                  {p.loadingHhList && <div className="py-10 text-center text-[11px] text-text-muted/60">加载中…</div>}
                  {!p.loadingHhList && p.hhList.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无数据</div>}
                  {!p.loadingHhList && p.hhList.map(h => (
                    <ListRow key={h.id} active={p.selectedHhId === h.id} onClick={() => p.setSelectedHhId(h.id)}
                      avatar={h.household_name?.slice(0, 1) || '户'} avatarSquare name={h.household_name}
                      tags={<Chip tone={h.status === 1 ? 'green' : 'amber'}>{HH_STATUS_LABEL[h.status] || '未知'}</Chip>}
                      right={(h.overdrawn_years?.length ?? 0) > 0
                        ? <span className="text-[9px] bg-[#FCEAE8] text-danger rounded-[2px] px-1 shrink-0">{h.overdrawn_years!.slice(0, 2).join('、')}超领</span>
                        : h.is_overdrawn ? <span className="text-[9px] bg-[#FCEAE8] text-danger rounded-[2px] px-1 shrink-0">超领</span> : null}
                      sub={<>{h.village_full_name || '—'} · <span className="font-mono">{h.household_code}</span> · {h.member_count ?? '?'} 人{h.contracted_area > 0 ? ` · ${h.contracted_area} 亩` : ''}</>} />
                  ))}
                </>
              )}
              {p.sideTab === 'large' && (
                <>
                  {p.loadingLarge && <div className="py-10 text-center text-[11px] text-text-muted/60">加载中…</div>}
                  {!p.loadingLarge && p.largeList.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无大户</div>}
                  {!p.loadingLarge && p.largeList.map(l => (
                    <ListRow key={l.id} active={p.selectedLargeId === l.id} onClick={() => p.setSelectedLargeId(l.id)}
                      avatar={l.operator_name?.slice(0, 1) || '大'} avatarSquare name={l.operator_name}
                      tags={<Chip tone="amber">{OPERATOR_LABEL[l.operator_type] || l.operator_type_label}</Chip>}
                      sub={<>{l.village_name || '—'}{l.group_no ? ` ${l.group_no} 组` : ''} · 经营 {Number(l.total_managed_area || 0).toFixed(2)} 亩</>} />
                  ))}
                </>
              )}
              {p.sideTab === 'villages' && (
                <>
                  {p.villageList.length === 0 && <div className="py-10 text-center text-[11px] text-text-muted/60">暂无村组</div>}
                  {p.villageList.map(v => (
                    <ListRow key={v.id} active={p.selectedVillageId === v.id} onClick={() => p.setSelectedVillageId(v.id)}
                      avatar={v.village_name?.slice(0, 1) || '村'} avatarSquare name={v.village_name}
                      tags={<Chip tone="gray">村集体</Chip>}
                      sub={<>{v.leader_name ? `负责人 ${v.leader_name}` : '非在册负责人'}{v.leader_phone ? ` · ${v.leader_phone}` : ''}</>} />
                  ))}
                </>
              )}
            </div>
        )}
        totalLabel={
          p.sideTab === 'farmers' ? `共 ${p.total} 人`
            : p.sideTab === 'households' ? `共 ${p.hhTotal} 户`
              : p.sideTab === 'large' ? `共 ${p.largeTotal} 户大户`
                : `共 ${p.villageList.length} 个村`
        }
        page={p.sideTab === 'farmers' ? p.page : p.sideTab === 'households' ? p.hhPage : p.largePage}
        totalPages={p.sideTab === 'farmers' ? p.totalPages : p.sideTab === 'households' ? p.hhTotalPages : p.sideTab === 'large' ? p.largeTotalPages : 1}
        onPageChange={(pg: number) => {
          if (p.sideTab === 'farmers') p.setPage(pg)
          else if (p.sideTab === 'households') p.setHhPage(pg)
          else if (p.sideTab === 'large') p.setLargePage(pg)
        }}
        detail={(
          <>
            {p.sideTab === 'households' && <HouseholdDetailPanel detail={p.household} loading={p.loadingDetail} onChanged={p.reloadHousehold} />}
            {p.sideTab === 'large' && (
              <LargeFarmerPanel farmer={p.largeList.find(l => l.id === p.selectedLargeId) || null} trusts={p.largeTrusts} loading={p.loadingTrusts} />
            )}
            {p.sideTab === 'villages' && <VillagePanel detail={p.villageDetail} loading={p.loadingVillage} />}
          </>
        )}
      />
    </div>
  )
}
