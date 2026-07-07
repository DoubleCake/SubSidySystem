/**
 * 户籍管理页 —— 薄容器
 *
 * 只负责：tab 切换 + 年份筛选 + 村组数据加载 + URL 同步 + Toast
 * 具体列表和详情逻辑在 FarmersTab / HouseholdsTab 中
 */
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../api'
import type { VillageGroup } from '../types'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import FarmersTab from './FarmersTab'
import HouseholdsTab from './HouseholdsTab'

type LeftTab = 'farmers' | 'households'

export default function FarmersPage() {
  const { toast, show } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── 从 URL 恢复状态 ──
  const getInitialLeftTab = (): LeftTab => {
    const tab = searchParams.get('tab')
    return tab === 'farmers' ? 'farmers' : 'households'
  }
  const getInitialFarmerId = (): number | null => {
    const id = searchParams.get('farmerId')
    return id ? Number(id) : null
  }
  const getInitialHouseholdId = (): number | null => {
    const id = searchParams.get('householdId')
    return id ? Number(id) : null
  }
  const getInitialYear = (): number => {
    const y = searchParams.get('year')
    return y ? Number(y) : new Date().getFullYear()
  }

  // ── 左侧Tab ──
  const [leftTab, setLeftTab] = useState<LeftTab>(getInitialLeftTab)

  // ── 年份筛选（由容器管理，传递给两个 Tab） ──
  const [yearFilter, setYearFilter] = useState<number>(getInitialYear)

  // ── 村组数据 ──
  const [groups, setGroups] = useState<VillageGroup[]>([])
  const [villages, setVillages] = useState<string[]>([])

  useEffect(() => {
    api.getVillageGroups().then(setGroups)
  }, [])

  // villages 自动从 groups 同步
  useEffect(() => {
    setVillages([...new Set(groups.map(v => v.village_name))])
  }, [groups])

  // ── 更新 URL ──
  const updateUrl = useCallback((params: { tab?: LeftTab; farmerId?: number | null; householdId?: number | null; year?: number }) => {
    const newParams = new URLSearchParams(searchParams)
    if (params.tab) {
      newParams.set('tab', params.tab)
    }
    if (params.farmerId !== undefined) {
      if (params.farmerId) {
        newParams.set('farmerId', String(params.farmerId))
        newParams.delete('householdId')
      } else {
        newParams.delete('farmerId')
      }
    }
    if (params.householdId !== undefined) {
      if (params.householdId) {
        newParams.set('householdId', String(params.householdId))
        newParams.delete('farmerId')
      } else {
        newParams.delete('householdId')
      }
    }
    if (params.year !== undefined) {
      newParams.set('year', String(params.year))
    }
    setSearchParams(newParams, { replace: true })
  }, [searchParams, setSearchParams])

  // ── 切换左侧 Tab ──
  const handleTabChange = (tab: LeftTab) => {
    setLeftTab(tab)
    updateUrl({ tab, farmerId: null, householdId: null })
  }

  // ── 从家庭户详情导航到农户 ──
  const handleNavigateToFarmer = useCallback((farmerId: number) => {
    setLeftTab('farmers')
    updateUrl({ tab: 'farmers', farmerId, householdId: null })
  }, [updateUrl])

  return (
    <div className="flex gap-5">
      {leftTab === 'farmers' ? (
        <FarmersTab
          show={show}
          groups={groups}
          villages={villages}
          setGroups={setGroups}
          yearFilter={yearFilter}
          activeTab={leftTab}
          onSwitchTab={handleTabChange}
          updateUrl={updateUrl}
          initialFarmerId={getInitialFarmerId()}
        />
      ) : (
        <HouseholdsTab
          show={show}
          groups={groups}
          villages={villages}
          setGroups={setGroups}
          yearFilter={yearFilter}
          setYearFilter={setYearFilter}
          activeTab={leftTab}
          onSwitchTab={handleTabChange}
          onNavigateToFarmer={handleNavigateToFarmer}
          updateUrl={updateUrl}
          initialHouseholdId={getInitialHouseholdId()}
        />
      )}
      <Toast {...toast} />
    </div>
  )
}
