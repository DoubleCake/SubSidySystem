import type {
  VillageGroup, FarmerOut, FarmerCreate, PageResult,
  SubsidyType, SubsidyTypeCreate,
  ApplicationOut, ApplicationCreate, ApplicationSearchResult,
  YearCompare, VillageSummary, ExcelColumnTemplate,
  ErrorLibraryItem, ErrorLibraryCreate,
  HH, HHDetail, HHEvent, HistoryDateEvent, SnapshotAtResponse,
  HouseholdCreate, MemberCreate, MemberUpdate, MemberMoveRequest,
  SubsidyProxyOut, SubsidyProxyCreate,
  PrecheckRecordItem, PrecheckRecordBatch,
  CheckConfig, CheckAreaMode,
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

export const batchEnsureFarmers = (rows: { id_card: string; real_name: string; village_name?: string; group_no?: string }[]) =>
  req<{ results: Record<string, number>; info: Record<string, { village_id: number; village_group_id: number; village_name: string; group_no: number }>; new_count: number }>(
    'farmers:batchEnsure', rows
  )

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
export const getSubsidyTypes = (year?: number, status?: number) =>
  req<SubsidyType[]>('subsidies:listTypes', { year, status })
export const getDeletedSubsidyTypes = (year?: number) =>
  req<SubsidyType[]>('subsidies:listTypes', { year, deleted: 1 })

export const getSubsidyTypesWithStats = (year?: number) =>
  req<(SubsidyType & { app_count: number; beneficiary_count: number; total_apply: number; total_actual: number })[]>(
    'subsidies:listTypesWithStats', year
  )

export const createSubsidyType = (data: SubsidyTypeCreate) =>
  req<{ id: number }>('subsidies:createType', data)

export const updateSubsidyType = (id: number, data: Partial<SubsidyTypeCreate>) =>
  req('subsidies:updateType', { id, ...data })

// ── 年度同类补贴关系链 ──
export interface ChainInfo {
  chain_id: number
  chain_name: string
  year_from: number
  year_to: number
  years: Array<{ type_id: number; subsidy_name: string; subsidy_year: number; season: string | null; category: string | null }>
}

export interface ChainYearSummary {
  year: number
  total_records: number
  total_farmers: number
  total_households: number
  total_area: number
  total_amount: number
  new_farmers: number
  removed_farmers: number
  new_households: number
  removed_households: number
}

export interface ChainDetailItem {
  id_card?: string
  real_name?: string
  household_id?: number | null
  household_name: string
  village: string
  /** 组信息（如 "1组" / "一组"） */
  group?: string
  /** 家庭户模式：该户当前在册成员（农户模式为空） */
  members?: Array<{ real_name: string; id_card: string | null }>
  per_year: Record<number, { area: number; amount: number }>
}

export interface ChainDetail {
  years: Array<{ type_id: number; subsidy_name: string; subsidy_year: number }>
  summary: ChainYearSummary[]
  farmers: ChainDetailItem[]
  households: ChainDetailItem[]
}

/** 保存/清除某补贴项目"上一年同类补贴"关联（prevYearTypeId 传 null 表示清除） */
export const setPrevYearType = (typeId: number, prevYearTypeId: number | null) =>
  req<{ ok: boolean }>('subsidies:setPrevYearType', { type_id: typeId, prev_year_type_id: prevYearTypeId })

/** 所有已形成年度关系链的补贴项目分组 */
export const listChains = () =>
  req<ChainInfo[]>('subsidies:listChains')

/** 一条链的完整数据（逐年聚合 + 农户/家庭户明细） */
export const chainDetail = (typeId: number, dataSource: 'application' | 'payment') =>
  req<ChainDetail>('subsidies:chainDetail', { type_id: typeId, data_source: dataSource })

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
    'subsidies:batchImportApplications', { rows }
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
  /** 不计入超限计算的补贴面积合计 */
  total_apply_area_no_calc: number
  total_contract_area: number
  total_trust_area: number
  total_no_subsidy_area: number
  total_amount: number
}

export interface AreaStatsResponse {
  by_village: VillageAreaStats[]
  total: VillageAreaStats
  data_source: 'payment' | 'application'
  group_by?: 'database' | 'excel'
}

export const getAreaStatsByVillage = (subsidyTypeId: number, year: number, dataSource?: 'payment' | 'application', groupBy?: string) => {
  const params: Record<string, unknown> = { subsidy_type_id: subsidyTypeId, year }
  if (dataSource) params.data_source = dataSource
  if (groupBy) params.group_by = groupBy
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

// 后端 excel-templates:detectColumns 实际返回 { business_type, detected_count, unmatched_count, mapping, unmatched }
// 其中 mapping 为「Excel 列名 → { 系统字段, 置信度(0-100) }」
// 注：recommended_templates / match_rate / auto_confirm_count 等后端并不返回，模板推荐功能已停用
export const detectExcelColumns = (columns: string[], businessType: string, sampleRows: Record<string, unknown>[]) =>
  req<{
    business_type?: string
    detected_count?: number
    unmatched_count?: number
    mapping?: Record<string, { column: string; confidence: number }>
    unmatched?: string[]
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

// ── 预检记录 ──
// CheckConfig / CheckAreaMode 统一定义在 src/types，这里重新导出以兼容既有引用
export type { CheckConfig, CheckAreaMode }

export const getCheckConfig = (typeId: number) =>
  req<{ check_config: CheckConfig; raw: string | null }>('subsidies:getCheckConfig', typeId)

export const updateCheckConfig = (typeId: number, config: CheckConfig) =>
  req('subsidies:updateCheckConfig', { typeId, config })

export const restoreSubsidyType = (typeId: number) =>
  req<{ message: string }>('subsidies:restoreType', typeId)

export const destroySubsidyType = (typeId: number) =>
  req<{ message: string }>('subsidies:destroyType', typeId)

export const savePrecheckRecord = (subsidy_type_id: number, year: number, items: Array<{ error_type: string; farmer_name: string; id_card: string; village: string; group_no: string; error_message: string }>) =>
  req<{ saved: number; batch_key: string }>('precheck:saveRecord', { subsidy_type_id, year, items })

export const getPrecheckBatches = (subsidy_type_id: number, year: number) =>
  req<{ batches: PrecheckRecordBatch[] }>('precheck:listBatches', { subsidy_type_id, year })

export const getPrecheckRecords = (params: Record<string, string | number>) =>
  req<PageResult<PrecheckRecordItem>>('precheck:listRecords', params)

export const togglePrecheckRecord = (id: number) =>
  req<{ status: string }>('precheck:toggleRecord', id)

export const deletePrecheckRecord = (id: number) =>
  req<null>('precheck:deleteRecord', id)

export const autoResolvePrecheck = (subsidy_type_id: number, year: number) =>
  req<{ resolved_count: number; total: number }>('precheck:autoResolve', { subsidy_type_id, year })

// 导出用行数据：SELECT sa.* / sp.* + farmer_profile / household / village 关联字段，不做打码（含明文 id_card）
// 注意：发放表的 SELECT 未带 fp.phone，故 phone 可能缺失；两表金额/年度列名不同，未列出的用索引签名兜底
export interface SubsidyExportRow extends ApplicationSearchResult {
  /** 发放表：sp.amount */
  amount?: string | number | null
  /** 发放表：sp.payment_year */
  payment_year?: number
  household_name?: string | null
  household_code?: string | null
  [key: string]: unknown
}

export const exportApplications = (subsidyTypeId: number) =>
  req<{ items: SubsidyExportRow[] }>('subsidies:exportApplications', subsidyTypeId)

export const exportPayments = (subsidyTypeId: number) =>
  req<{ items: SubsidyExportRow[] }>('subsidies:exportPayments', subsidyTypeId)

// ── 仪表盘 ──
export const getDashboardTodos = (year: number) =>
  req<{ incomplete_projects: number; pending_records: number; overdrawn_households: number; id_card_errors: number }>(
    'subsidies:dashboardTodos', { year }
  )

// ── 数据库备份管理 ──
export const getDbInfo = () =>
  req<{
    db_path: string; db_size_kb: number; db_size_mb: number; total_records: number
    record_counts: Record<string, number>; backups: { filename: string; size_kb: number; created: string }[]
    backup_dir: string
  }>('settings:getDbInfo')

export const createBackup = () =>
  req<{ message: string; filename: string; size_kb: number }>('settings:createBackup')

export const restoreDatabase = (filePath: string) =>
  req<{ message: string; backup_created: string }>('settings:restore', filePath)

export const deleteBackup = (filename: string) =>
  req('settings:deleteBackup', filename)

export const exportExcel = () =>
  req<{ message: string }>('settings:exportExcel')

export const downloadDb = () =>
  req<{ message: string }>('settings:downloadDb')

export const downloadBackup = (filename: string) =>
  req('settings:downloadBackup', filename)

// ── 超领明细 ──
export interface OverdrawnDetailItem {
  household_name: string; head_name: string; village: string
  contracted_area: number; cultivable_area: number; used_area: number; overdraw_amount: number
  season_breakdown: Record<string, { used_area: number; is_overdrawn: boolean; overdraw_amount: number }>
}

export const getOverdrawnDetail = (year: number) =>
  req<{ year: number; total: number; items: OverdrawnDetailItem[] }>('households:overdrawnDetail', { year })

// ── 农业任务 ──
export interface AgriTask {
  id: number; task_name: string; crop_type: string; total_area: number
  task_year: number; season: string | null; alloc_method: string; alloc_method_label: string
  status: string; status_label: string; description: string | null; operator: string | null
}

export interface AgriTaskAllocation {
  village_id: number; village_name: string; alloc_area: number; alloc_ratio: number
  basis_area: number; actual_area: number | null
}

export interface AgriTaskDetail extends AgriTask {
  allocations: AgriTaskAllocation[]
  total_actual_area: number | null; completion_rate: number | null
}

export const getAgriTasks = (params: Record<string, string | number>) =>
  req<{ total: number; items: AgriTask[] }>('agri-tasks:list', params)

export const getAgriTaskDetail = (id: number) =>
  req<AgriTaskDetail>('agri-tasks:get', id)

export const createAgriTask = (data: Record<string, unknown>) =>
  req('agri-tasks:create', data)

export const deleteAgriTask = (id: number) =>
  req('agri-tasks:delete', id)

export const previewAgriTask = (id: number) =>
  req<{ total_area: number; alloc_method_label: string; total_basis_area: number; allocations: { village_id: number; village_name: string; basis_area: number; alloc_ratio: number; alloc_area: number }[] }>(
    'agri-tasks:preview', id
  )

export const issueAgriTask = (id: number) =>
  req<{ village_count: number }>('agri-tasks:issue', id)

export const revokeAgriTask = (id: number) =>
  req('agri-tasks:revoke', id)

export const completeAgriTask = (id: number) =>
  req('agri-tasks:done', id)

export const getAgriTaskMeta = () =>
  req<{ alloc_methods: { value: string; label: string }[]; statuses: { value: string; label: string }[]; crop_types: string[] }>(
    'agri-tasks:meta'
  )

export const updateAgriTaskAllocation = (taskId: number, villageId: number, actualArea: number | null) =>
  req('agri-tasks:updateAllocation', { taskId, villageId, actual_area: actualArea })

// ── 资格规则 ──
export interface EligibilityRule {
  id: number; subsidy_type_id: number; rule_name: string; rule_desc: string | null
  require_farmer_status: number | null; require_age_min: number | null; require_age_max: number | null
  require_land_type: string | null; require_min_area: number | null; require_max_area: number | null
  require_not_idle: number; require_contract_valid: number
  can_combine_with_others: number; exclusive_with: number[]; is_active: number
}

export const getEligibilityRules = (subsidyTypeId: number) =>
  req<EligibilityRule[]>('eligibility:list', subsidyTypeId)

export const getEligibilityRuleTemplates = () =>
  req<{ name: string; desc: string; preset: Partial<EligibilityRule> }[]>('eligibility:ruleTemplates')

export const createEligibilityRule = (data: Partial<EligibilityRule>) =>
  req('eligibility:create', data)

export const updateEligibilityRule = (id: number, data: Partial<EligibilityRule>) =>
  req('eligibility:update', { id, ...data })

export const deleteEligibilityRule = (id: number) =>
  req('eligibility:delete', id)

export const checkEligibility = (data: { subsidy_type_id: number; year: number; rows: { id_card: string; real_name: string; apply_area: number; _row_index?: number }[] }) =>
  req<{ passed_list: { _row_index?: number }[]; failed_list: { _row_index?: number; real_name: string; id_card_masked: string; issues: string[] }[]; warning_list?: { _row_index?: number; real_name: string; id_card_masked: string; warnings: string[] }[] }>(
    'eligibility:check', data
  )

// ── 土地流转 ──
export interface LandTrustRecord {
  id: number; owner_type?: string; owner_entity_id?: number | null
  owner_household_id: number | null; owner_name: string; owner_code: string
  operator_type?: string; operator_entity_id?: number | null
  operator_household_id: number | null; operator_name: string | null; operator_code: string | null
  trust_type: string; trust_type_label: string
  area: number | null; trust_year: number; trust_end_year?: number | null
  start_date: string | null; end_date: string | null
  annual_fee: number | null; payment_method: string | null
  parcel_desc: string | null; data_reliability: string; reliability_label: string
  affect_subsidy_calc: number; subsidy_arable?: number; subsidy_cash_crop?: number
  note: string | null; operator: string | null; is_active: number
  // 来源 + 大户流转扩展（land:list 合并两表返回）
  source_type?: 'normal' | 'large_farmer'
  large_farmer_name?: string
  large_farmer_type?: string
  large_farmer_type_label?: string
  parcel_village_name?: string
  parcel_group_no?: number
  is_high_standard?: number
  is_demonstration?: number
}

export const getLandTrusts = (params: Record<string, string | number>) =>
  req<{ total: number; items: LandTrustRecord[] }>('land:list', params)

export const createLandTrust = (data: Record<string, unknown>) =>
  req('land:create', data)

export const updateLandTrust = (id: number, data: Record<string, unknown>) =>
  req('land:update', { id, ...data })

export const deleteLandTrust = (id: number) =>
  req('land:delete', id)

export const searchLandHousehold = (q: string) =>
  req<{ id: number; household_code: string; household_name: string; head_name: string; village_full_name: string; land_area: number | null }[]>(
    'land:searchHousehold', q
  )

export const searchLandVillage = (q: string) =>
  req<{ id: number; village_name: string }[]>('land:searchVillage', q)

export const searchLandVillageGroup = (q: string) =>
  req<{ id: number; full_name: string }[]>('land:searchVillageGroup', q)

export const resolveLandByIdCard = (q: string) =>
  req<{ found: boolean; farmer_name: string | null; household_id: number | null; household_name: string | null }>(
    'land:resolveByIdCard', q
  )

export const getLandAreaSummary = (householdId: number, year: number) =>
  req<{
    contracted_area: number; trust_out_area: number; trust_in_area: number
    trust_in_arable_area: number; trust_in_cash_crop_area: number
    cultivable_area: number; applied_area: number
    is_overdrawn: boolean; overdraw_amount: number
    cultivable_note: string; has_trust_data: boolean
    subsidy_breakdown: { subsidy_name: string; applied_area: number; actual_amount: number }[]
    trust_records: LandTrustRecord[]
  }>('land:areaSummary', { householdId, year })

export const batchRenewLandTrusts = (ids: number[]) =>
  req<{ created: number }>('land:batchRenew', ids)

export const batchImportIdleLand = (rows: Record<string, unknown>[]) =>
  req<{ created: number; skipped: number; errors: string[] }>('land:batchImportIdle', rows)

// ── 外联查询 ──
export interface ExternalSite { id: number; name: string; url: string; site_type: 'link' | 'query'; description: string | null; sort_order: number; is_active: number }

export const getExternalSites = () =>
  req<ExternalSite[]>('external-links:list')

export const createExternalSite = (data: Partial<ExternalSite>) =>
  req('external-links:createSite', data)

export const updateExternalSite = (id: number, data: Partial<ExternalSite>) =>
  req('external-links:updateSite', { id, ...data })

export const deleteExternalSite = (id: number) =>
  req('external-links:deleteSite', id)

export const getExternalRecords = (params: Record<string, string | number>) =>
  req<{ total: number; items: Record<string, unknown>[] }>('external-links:listRecords', params)

export const getExternalStats = () =>
  req<{ total_records: number; total_items: number; by_type: { type: string; times: number; total_items: number }[]; by_site: { site: string; times: number }[] }>(
    'external-links:stats'
  )

export const createExternalRecord = (data: Record<string, unknown>) =>
  req('external-links:createRecord', data)

export const updateExternalRecord = (id: number, data: Record<string, unknown>) =>
  req('external-links:updateRecord', { id, ...data })

export const deleteExternalRecord = (id: number) =>
  req('external-links:deleteRecord', id)

// ── Excel 模板扩展 ──
export const deleteExcelTemplate = (id: number) =>
  req('excel-templates:delete', id)

export const getExcelTemplateLogs = (params?: Record<string, string | number>) =>
  req<{ total: number; items: Record<string, unknown>[] }>('excel-templates:logs', params || { page_size: 30 })

export const aiDetectColumns = (data: { columns: string[]; business_type: string; sample_rows: Record<string, unknown>[] }) =>
  req<{ results: { excel_column: string; system_field: string | null; confidence: number; reason: string }[]; source: string }>(
    'excel-templates:aiDetect', data
  )

// ── 错误库扩展 ──
export const getErrorLibraryFilterOptions = () =>
  req<{ villages: string[]; subsidies: string[] }>('error-library:filterOptions')

// ── 身份验证 ──
export const verifyNames = (rows: { name: string; id_card: string }[]) =>
  req<{ results: { match: string; db_name: string | null; db_village: string | null }[] }>(
    'farmers:verifyNames', { rows }
  )

// ── 人员模糊匹配 ──
export const matchPeople = (rows: { name: string; village: string; phone: string }[]) =>
  req<{
    total: number; summary: { high: number; medium: number; low: number; none: number }
    results: {
      index: number; input: { name: string; village: string; phone: string }
      matches: { farmer_id: number; real_name: string; village_name: string; phone: string; id_card: string; id_card_masked?: string; farmer_status: number }[]
      matched_by: string; confidence: 'high' | 'medium' | 'low' | 'none'; match_count: number; warning?: string; note?: string
    }[]
  }>('farmers:matchPeople', { rows })

// ── 村组列表（非分组选项） ──
export const getVillages = () =>
  req<{ village_name: string }[]>('settings:listVillages')

// ── 家庭户批量组建 ──
export const batchBuildHouseholdsFromList = (rows: Record<string, unknown>[]) =>
  req<{ created: number; errors: string[] }>('households:batchBuild', rows)
