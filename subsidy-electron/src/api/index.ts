import type {
  VillageGroup, FarmerOut, FarmerCreate, PageResult,
  SubsidyType, SubsidyTypeCreate,
  ApplicationOut, ApplicationCreate, ApplicationSearchResult,
  YearCompare, VillageSummary, ExcelColumnTemplate,
  ErrorLibraryItem, ErrorLibraryCreate,
  HH, HHDetail, HHEvent, HistoryDateEvent, SnapshotAtResponse,
  HouseholdCreate, MemberCreate, MemberUpdate, MemberMoveRequest,
  SubsidyProxyOut, SubsidyProxyCreate,
} from '../types'

// ── Electron IPC 调用封装 ──

async function req<T>(channel: string, data?: unknown): Promise<T> {
  const result = await window.electronAPI.invoke(channel, data)
  if (result && typeof result === 'object' && 'code' in result && (result as { code: number }).code !== 0) {
    throw new Error((result as { message?: string }).message || `请求失败`)
  }
  // IPC handler 返回 { code: 0, data: ... } 格式，取 data 字段
  if (result && typeof result === 'object' && 'data' in result) {
    return (result as { data: T }).data as T
  }
  return result as T
}

// ── 村组 ──
export const getVillageGroups = () => req<VillageGroup[]>('households:groupOptions')
export const createVillageGroup = (data: { village_name: string; group_no: number }) =>
  req<VillageGroup>('settings:createVillageGroup', data)

// ── 农户 ──
export const getFarmers = (params: Record<string, string | number>) =>
  req<PageResult<FarmerOut>>('farmers:list', params)

export const getFarmer = (id: number) => req<FarmerOut>('farmers:get', id)

export const batchLookupFarmers = (idCards: string[]) =>
  req<{ results: Record<string, number> }>('farmers:batchLookup', idCards)

export const batchGetIdCards = (farmerIds: number[]) =>
  req<{ results: Record<string, string> }>('farmers:batchGetIdCards', farmerIds)

export const createFarmer = (data: FarmerCreate) =>
  req<{ id: number }>('farmers:create', data)

export const updateFarmer = (id: number, data: Partial<FarmerCreate>) =>
  req('farmers:update', { id, ...data })

export const batchImportFarmers = (rows: FarmerCreate[], overwrite = false) =>
  req<{ created: number; updated: number; skipped: number; errors: string[] }>(
    'farmers:batchImport', { rows, overwrite }
  )

export const bulkCompleteFarmers = (rows: Record<string, unknown>[]) =>
  req<{ updated: number; errors: string[] }>('farmers:bulkComplete', rows)

// ── 家庭关系导入 ──
export interface FamilyRelationRow {
  row_index: number
  real_name?: string
  id_card?: string
  relation?: string
  age?: number
  address?: string
}

export interface ImportFamilyRelationsResult {
  stage1_updated: number
  stage1_not_found: string[]
  stage1_relation_errors: string[]
  stage2_split?: {
    split_count: number
    created_households: number
    migrated_members: number
    details: { 原家庭: string; 新家庭: string; 新户主: string; 迁移人数: number }[]
  }
}

export const importFamilyRelations = (rows: FamilyRelationRow[], splitVillages?: string[]) =>
  req<ImportFamilyRelationsResult>('farmers:importRelations', { rows, splitVillages })

export interface MultiHeadHouseholdInfo {
  household_id: number
  household_name: string
  village_name: string
  head_count: number
  heads: { id: number; real_name: string; relation: string; id_card?: string; id_card_masked?: string }[]
  all_members: { id: number; real_name: string; relation: string; id_card?: string; id_card_masked?: string }[]
}

export const getMultiHeadHouseholds = (villageNames?: string[]) =>
  req<{ households: MultiHeadHouseholdInfo[] }>('farmers:multiHeadPreview', villageNames)

export const previewMultiHeadHouseholds = (villageNames: string[], excelRows: FamilyRelationRow[]) =>
  req<{ households: MultiHeadHouseholdInfo[] }>('farmers:multiHeadPreview', { villageNames, excelRows })

// ── 补贴类型 ──
export const getSubsidyTypes = (year?: number) =>
  req<SubsidyType[]>('subsidies:listTypes', year)

export const getSubsidyTypesWithStats = (year?: number) =>
  req<(SubsidyType & { app_count: number; beneficiary_count: number; total_apply: number; total_actual: number })[]>(
    'subsidies:listTypesWithStats', year
  )

export const createSubsidyType = (data: SubsidyTypeCreate) =>
  req<{ id: number }>('subsidies:createType', data)

export const updateSubsidyType = (id: number, data: Partial<SubsidyTypeCreate>) =>
  req('subsidies:updateType', { id, ...data })

// ── 补贴申请 ──
export const getApplications = (params: Record<string, string | number>) =>
  req<PageResult<ApplicationOut>>('subsidies:listApplications', params)

export const searchApplications = (params: Record<string, string | number>) =>
  req<PageResult<ApplicationSearchResult>>('subsidies:listApplications', params)

export const createApplication = (data: ApplicationCreate) =>
  req<{ id: number }>('subsidies:createApplication', data)

export const updateApplication = (id: number, data: Partial<ApplicationCreate>) =>
  req('subsidies:updateApplication', { id, ...data })

export const batchImportApplications = (rows: ApplicationCreate[]) =>
  req<{ created: number; skipped: number; errors: string[] }>(
    'subsidies:batchImportApplications', rows
  )

// ── 代领关系 ──
export const getProxies = (params: Record<string, string | number>) =>
  req<SubsidyProxyOut[]>('subsidies:listProxies', params)

export const createProxy = (data: SubsidyProxyCreate) =>
  req<{ id: number }>('subsidies:createProxy', data)

export const deleteProxy = (id: number) =>
  req('subsidies:deleteProxy', id)

// ── 汇总 ──
export const getYearCompare = (year: number) =>
  req<YearCompare>('subsidies:yearCompare', year)

export const getSummaryByVillage = (year: number) =>
  req<VillageSummary[]>('subsidies:summaryByVillage', year)

export const getSummaryBySeason = (year: number) =>
  req<{ season: string; project_count: number; farmer_count: number; total_amount: number; total_area: number; application_count: number }[]>(
    'subsidies:summaryBySeason', year
  )

export interface VillageAreaStats {
  village: string
  farmer_count: number
  record_count: number
  total_apply_area: number
  total_contract_area: number
  total_trust_area: number
  total_no_subsidy_area: number
  total_amount: number
}

export interface AreaStatsResponse {
  by_village: VillageAreaStats[]
  total: VillageAreaStats
  data_source: 'payment' | 'application'
}

export const getAreaStatsByVillage = (subsidyTypeId: number, year: number, dataSource?: 'payment' | 'application') => {
  const params: Record<string, unknown> = { subsidy_type_id: subsidyTypeId, year }
  if (dataSource) params.data_source = dataSource
  return req<AreaStatsResponse>('subsidies:areaStatsByVillage', params)
}

// ── AI ──
export const aiAnalyze = (data: { year: number; village_name?: string; question: string }) =>
  req<{ result: string; data_preview: Record<string, unknown> }>('ai:analyze', data)

// ── Excel模板 ──
export const getExcelTemplates = (businessType?: string) =>
  req<ExcelColumnTemplate[]>('excel-templates:list', businessType)

export const getExcelTemplate = (id: number) =>
  req<ExcelColumnTemplate>('excel-templates:get', id)

export const detectExcelColumns = (columns: string[], businessType: string, sampleRows: Record<string, unknown>[]) =>
  req<{
    columns: Array<{ excel_column: string; suggested_field: string | null; confidence: number; alternatives: Array<{ field: string; confidence: number }> }>
    recommended_templates?: Array<{ id: number; template_name: string; match_rate: number }>
    auto_confirm_count?: number; unrecognized_count?: number
  }>('excel-templates:detectColumns', { columns, business_type: businessType, sample_rows: sampleRows })

export const saveExcelTemplate = (data: Record<string, unknown>) =>
  req<{ id: number }>('excel-templates:save', data)

// ── 健康检查 ──
export const healthCheck = () => req<{ status: string }>('app:getDbPath')

// ── 错误库 ──
export const getErrorLibrary = (params: Record<string, string | number>) =>
  req<PageResult<ErrorLibraryItem>>('error-library:list', params)

export const getErrorLibraryStats = () =>
  req<{ total: number; by_type: Record<string, number> }>('error-library:stats')

export const createErrorLibrary = (data: ErrorLibraryCreate) =>
  req<{ id: number }>('error-library:create', data)

export const updateErrorLibrary = (id: number, data: ErrorLibraryCreate) =>
  req('error-library:update', { id, ...data })

export const deleteErrorLibrary = (id: number) =>
  req('error-library:delete', id)

export const batchImportErrorLibrary = (rows: Record<string, unknown>[]) =>
  req<{ created: number; skipped: number }>('error-library:batchImport', rows)

export const batchDeleteErrorLibrary = (ids: number[]) =>
  req<{ deleted: number }>('error-library:batchDelete', ids)

// ── 家庭户 ──
export const getHouseholds = (params: Record<string, string | number>) =>
  req<PageResult<HH>>('households:list', params)

export const getOverdrawnHouseholds = () =>
  req<HH[]>('households:overdrawn')

export const getHouseholdDetail = (id: number, year?: number) =>
  req<HHDetail>('households:get', { id, year })

export const mergeHouseholds = (data: { source_household_id: number; target_household_id: number; operator?: string }) =>
  req<{ message: string }>('households:merge', data)

export const updateHousehold = (id: number, data: Partial<HouseholdCreate & { status: number }>) =>
  req('households:update', { id, ...data })

export const createHousehold = (data: HouseholdCreate) =>
  req<{ id: number }>('households:create', data)

export const moveMember = (data: MemberMoveRequest) =>
  req('households:moveMember', data)

// ── 家庭户成员 ──
export const getHouseholdMembers = (householdId: number) =>
  req<{ household_id: number; members: HHDetail['members'] }>('households:members', householdId)

export const addHouseholdMember = (householdId: number, data: MemberCreate) =>
  req<{ id: number; household_id: number }>('households:addMember', { householdId, ...data })

export const updateHouseholdMember = (householdId: number, farmerId: number, data: MemberUpdate) =>
  req('households:updateMember', { householdId, farmerId, ...data })

export const removeHouseholdMember = (householdId: number, farmerId: number) =>
  req('households:removeMember', { householdId, farmerId })

export const getHouseholdAreaByYear = (householdId: number) =>
  req<{ household_id: number; years: { year: number; subsidy_area: number }[] }>(
    'households:areaByYear', householdId
  )

// ── 家庭户事件 ──
export const getHouseholdEvents = (householdId: number, year?: number) =>
  req<HHEvent[]>('households:events', { householdId, year })

export const addHouseholdEvent = (householdId: number, data: Record<string, unknown>) =>
  req<{ id: number }>('households:addEvent', { householdId, ...data })

export const undoHouseholdEvent = (householdId: number, eventId: number) =>
  req('households:undoEvent', { householdId, eventId })

// ── 家庭户历史 ──
export const getHouseholdHistoryDates = (householdId: number) =>
  req<{ events: HistoryDateEvent[] }>('households:historyDates', householdId)

export const getHouseholdSnapshotAt = (householdId: number, date: string) =>
  req<SnapshotAtResponse>('households:snapshotAt', { householdId, date })

export const getHouseholdSnapshotByEvent = (householdId: number, eventId: number) =>
  req<SnapshotAtResponse>('households:snapshotByEvent', { householdId, eventId })

export const getHouseholdHistoryYears = (householdId: number) =>
  req<{ household_id: number; years: number[] }>('households:historyYears', householdId)

export const getHouseholdHistory = (householdId: number, year: number) =>
  req<unknown>('households:history', { householdId, year })

// ── 家庭户分户 / 批量组建 ──
export const splitHousehold = (householdId: number, data: Record<string, unknown>) =>
  req<{ new_household_id: number; moved_members: number[] }>('households:split', { householdId, ...data })

export const batchBuildHouseholds = (rows: { household_id: string; id_card: string; real_name?: string; is_head?: number; relation?: string; land_area?: number }[]) =>
  req<{ created: number; errors: string[] }>('households:batchBuild', rows)

export const batchImportHouseholdMembers = (householdId: number, rows: Record<string, unknown>[]) =>
  req<{ created: number; skipped: number; errors: string[] }>('households:batchImportMembers', { householdId, rows })

export const importConfirmedArea = (rows: { real_name: string; id_card: string; confirmed_area: number }[]) =>
  req<{ success: number; not_found: { id_card: string; real_name: string }[]; mismatch_name: { id_card: string; input_name: string; db_name: string }[]; errors: { id_card: string; reason: string }[] }>(
    'households:importConfirmedArea', rows
  )

export const exportConfirmedAreaDiff = () =>
  window.electronAPI.invoke('households:exportConfirmedAreaDiff')

// ── 家庭户人工确认 ──
export const manualConfirmHousehold = (householdId: number, data: { operator?: string; remark?: string }) =>
  req<{ message: string; household_id: number; confirmed_at: string; confirmed_by: string | null }>(
    'households:manualConfirm', { householdId, ...data }
  )

export const cancelManualConfirm = (householdId: number, data: { operator?: string; remark?: string }) =>
  req<{ message: string; household_id: number; previous_confirmed_at: string | null; previous_confirmed_by: string | null }>(
    'households:cancelConfirm', { householdId, ...data }
  )

export const batchConfirmHouseholds = (data: { household_ids: number[]; operator?: string; remark?: string }) =>
  req<{
    message: string; total: number; confirmed: number; skipped: number
    errors: { household_id: number; error: string }[]
    results: { household_id: number; household_name: string; status: string; message: string }[]
  }>('households:batchConfirm', data)

export const deleteHousehold = (householdId: number) =>
  req<{ message: string; household_id: number }>('households:delete', householdId)

export const refreshAreaCache = (householdId?: number) =>
  req<{ message: string; household_id?: number; household_name?: string; total?: number }>(
    'households:refreshAreaCache', householdId
  )

export const recalcUnconfirmedContractArea = () =>
  req<{
    message: string; total: number; updated: number
    results: Array<{ household_id: number; household_name: string; year_used: number | null; contract_area: number | null; message?: string }>
  }>('households:recalcUnconfirmedContractArea')

// ── 家庭户批量导入 ──
export interface HouseholdImportRow {
  real_name: string; id_card: string; address: string
  head_relation?: string; phone?: string; bank_card?: string; bank_name?: string; gender?: string
  household_code?: string   // 家庭编码（分组依据，优先级高于地址）
  farmer_status?: string    // 人员状态：死亡、移居、出国等
  village_name?: string     // 指定所属村
  group_no?: string         // 指定所属组（如"一组"或"1"）
}

export interface HouseholdImportPreview {
  groups: {
    address: string
    household_code?: string | null         // 家庭编码
    action: 'create' | 'merge_one' | 'merge_multi'
    head_name: string; head_id_card: string; member_count: number
    members: { real_name: string; id_card: string; is_head: boolean; in_db: boolean; has_errors: boolean }[]
    matched_hh_info: { id: number; household_code: string; household_name: string; village_name: string; group_display: string; contract_area: number | null }[]
    target_village_name: string; target_group_display: string
    total_area_after_merge: number | null; warnings: string[]; has_errors: boolean
  }[]
  row_errors: { row: number; name: string; errors: string[] }[]
  conflicts?: { row: number; real_name: string; id_card: string; village_name: string; group_no: string; phone: string; db_name: string; db_household_id: number }[]
  summary: { total_rows: number; total_groups: number; new_households: number; merge_single: number; merge_multi: number; error_rows: number }
}

export interface HouseholdImportResult {
  created_households: number; merged_households: number
  created_farmers: number; skipped_farmers: number; errors: string[]
}

export const previewHouseholdImport = (rows: HouseholdImportRow[]) =>
  req<HouseholdImportPreview>('household-import:preview', rows)

export const executeHouseholdImport = (rows: HouseholdImportRow[], defaultVillageName?: string, defaultGroupNo?: string) =>
  req<HouseholdImportResult>('household-import:execute', { rows, default_village_name: defaultVillageName, default_group_no: defaultGroupNo })

// ── 预检历史 ──
export interface CheckConfig { checks: Record<string, boolean> }
export interface PrecheckHistoryItem { id: number; subsidy_type_id: number; year: number; error_type: string; error_detail: string; status: string; created_at: string }
export interface PrecheckHistoryBatch { batch_key: string; count: number; created_at: string }

export const getCheckConfig = (typeId: number) =>
  req<{ check_config: CheckConfig; raw: string | null }>('subsidies:getCheckConfig', typeId)

export const updateCheckConfig = (typeId: number, config: CheckConfig) =>
  req('subsidies:updateCheckConfig', { typeId, config })

export const restoreSubsidyType = (typeId: number) =>
  req<{ message: string }>('subsidies:restoreType', typeId)

export const savePrecheckHistory = (subsidy_type_id: number, year: number, precheck_result: unknown, error_types?: string[]) =>
  req<{ saved: number; batch_key: string }>('precheck:saveHistory', { subsidy_type_id, year, precheck_result, error_types })

export const getPrecheckHistory = (params: Record<string, string | number>) =>
  req<PageResult<PrecheckHistoryItem>>('precheck:listHistory', params)

export const getPrecheckHistoryBatches = (subsidy_type_id: number, year: number) =>
  req<{ batches: PrecheckHistoryBatch[] }>('precheck:listBatches', { subsidy_type_id, year })

export const resolvePrecheckHistory = (id: number) =>
  req('precheck:resolveHistory', id)

export const unresolvePrecheckHistory = (id: number) =>
  req('precheck:unresolveHistory', id)

export const deletePrecheckHistory = (id: number) =>
  req('precheck:deleteHistory', id)

export const autoResolvePrecheckHistory = (subsidy_type_id: number, year: number) =>
  req<{ resolved_count: number; total: number }>('precheck:autoResolve', { subsidy_type_id, year })

export const exportApplications = (subsidyTypeId: number) =>
  req<{ items: unknown[] }>('subsidies:exportApplications', subsidyTypeId)

export const exportPayments = (subsidyTypeId: number) =>
  req<{ items: unknown[] }>('subsidies:exportPayments', subsidyTypeId)
