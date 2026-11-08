/**
 * 主体管理 · 渲染层
 *
 * 从 HouseholdRegistryV2Page 原样导出，不含状态逻辑；
 * 所有数据与回调通过 props 注入，便于后续按主体拆分。
 */
import { Ico } from './Icons'
import { Chip, ListRow, FARMER_STATUS_LABEL, HH_STATUS_LABEL } from './shared'
import { OPERATOR_LABEL } from './types'
import FarmerDetail from './farmers/FarmerDetail'
import HouseholdDetail from './households/HouseholdDetail'
import LargeDetail from './large/LargeDetail'
import VillageDetail from './villages/VillageDetail'
import RegistryShell, { type SideTab } from './RegistryShell'
import FarmerList from './farmers/FarmerList'
import HouseholdList from './households/HouseholdList'
import LargeList from './large/LargeList'
import VillageList from './villages/VillageList'

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
  const tabs = [
    { id: 'farmers' as const, label: '农户', icon: 'farmers' as const, count: p.total },
    { id: 'households' as const, label: '家庭户', icon: 'households' as const, count: p.householdTotal },
    { id: 'large' as const, label: '大户', icon: 'large' as const, count: null },
    { id: 'villages' as const, label: '村组', icon: 'villages' as const, count: null },
  ]
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
        sidebar={(
          p.sideTab === 'farmers' ? (
            <FarmerList
              tabs={tabs} sideTab={p.sideTab} setSideTab={p.setSideTab}
              list={p.list} total={p.total} page={p.page} totalPages={p.totalPages} loading={p.loadingList}
              selectedId={p.selectedId} setSelectedId={p.setSelectedId} setPage={p.setPage}
              search={p.searchInput} setSearch={p.setSearchInput}
              village={p.village} setVillage={p.setVillage}
              status={p.status} setStatus={p.setStatus}
              villages={p.villages}
            />
          ) : p.sideTab === 'households' ? (
            <HouseholdList
              tabs={tabs} sideTab={p.sideTab} setSideTab={p.setSideTab}
              list={p.hhList} total={p.hhTotal} page={p.hhPage} totalPages={p.hhTotalPages} loading={p.loadingHhList}
              selectedId={p.selectedHhId} setSelectedId={p.setSelectedHhId} setPage={p.setHhPage}
              search={p.hhSearchInput} setSearch={p.setHhSearchInput}
              village={p.hhVillage} setVillage={p.setHhVillage}
              status={p.hhStatus} setStatus={p.setHhStatus}
              villages={p.villages}
            />
          ) : p.sideTab === 'large' ? (
            <LargeList
              tabs={tabs} sideTab={p.sideTab} setSideTab={p.setSideTab}
              list={p.largeList} total={p.largeTotal} page={p.largePage} totalPages={p.largeTotalPages} loading={p.loadingLarge}
              selectedId={p.selectedLargeId} setSelectedId={p.setSelectedLargeId} setPage={p.setLargePage}
              search="" setSearch={() => {}}
            />
          ) : (
            <VillageList
              tabs={tabs} sideTab={p.sideTab} setSideTab={p.setSideTab}
              list={p.villageList}
              selectedId={p.selectedVillageId} setSelectedId={p.setSelectedVillageId}
            />
          )
        )}
        detail={(
          <>
            {p.sideTab === 'households' && <HouseholdDetail detail={p.household} loading={p.loadingDetail} onChanged={p.reloadHousehold} />}
            {p.sideTab === 'large' && (
              <LargeDetail farmer={p.largeList.find(l => l.id === p.selectedLargeId) || null} trusts={p.largeTrusts} loading={p.loadingTrusts} />
            )}
            {p.sideTab === 'villages' && <VillageDetail detail={p.villageDetail} loading={p.loadingVillage} />}
            {p.sideTab === 'farmers' && <FarmerDetail farmer={p.farmer} household={p.household} loading={p.loadingDetail} onChanged={p.reloadFarmer} />}
          </>
        )}
      />
    </div>
  )
}