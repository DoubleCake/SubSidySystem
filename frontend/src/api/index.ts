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

const BASE = ''

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({})) as { detail?: string }
    throw new Error(e.detail || `请求失败 ${r.status}`)
  }
  return r.json() as Promise<T>
}

// ── 村组 ──
export const getVillageGroups = () => req<VillageGroup[]>('/api/households/group-options')
export const createVillageGroup = (data: { village_name: string; group_no: number }) =>
  req<VillageGroup>('/api/settings/village-groups', { method: 'POST', body: JSON.stringify(data) })

// ── 农户 ──
export const getFarmers = (params: Record<string, string | number>) =>
  req<PageResult<FarmerOut>>('/api/farmers?' + new URLSearchParams(params as Record<string, string>))

export const getFarmer = (id: number) => req<FarmerOut>('/api/farmers/' + id)

export const batchLookupFarmers = (idCards: string[]) =>
  req<{ results: Record<string, number> }>('/api/farmers/batch-lookup', {
    method: 'POST', body: JSON.stringify({ id_cards: idCards }),
  })

export const batchGetIdCards = (farmerIds: number[]) =>
  req<{ results: Record<string, string> }>('/api/farmers/batch-get-id-cards', {
    method: 'POST', body: JSON.stringify({ farmer_ids: farmerIds }),
  })

export const createFarmer = (data: FarmerCreate) =>
  req<{ id: number }>('/api/farmers/', { method: 'POST', body: JSON.stringify(data) })

export const updateFarmer = (id: number, data: Partial<FarmerCreate>) =>
  req('/api/farmers/' + id, { method: 'PUT', body: JSON.stringify(data) })

export const batchImportFarmers = (rows: FarmerCreate[], overwrite = false) =>
  req<{ created: number; updated: number; skipped: number; errors: string[] }>(
    '/api/farmers/batch-import',
    { method: 'POST', body: JSON.stringify({ rows, overwrite }) }
  )
export const bulkCompleteFarmers = (rows: Record<string, unknown>[]) =>
  req<{ updated: number; errors: string[] }>('/api/farmers/bulk-complete', {
    method: 'POST', body: JSON.stringify({ rows }),
  })
// ── 补贴类型 ──
export const getSubsidyTypes = (year?: number) =>
  req<SubsidyType[]>('/api/subsidies/types' + (year ? `?year=${year}` : ''))

export const getSubsidyTypesWithStats = (year?: number) =>
  req<(SubsidyType & { app_count: number; beneficiary_count: number; total_apply: number; total_actual: number })[]>(
    '/api/subsidies/types-with-stats' + (year ? `?year=${year}` : '')
  )

export const createSubsidyType = (data: SubsidyTypeCreate) =>
  req<{ id: number }>('/api/subsidies/types', { method: 'POST', body: JSON.stringify(data) })

export const updateSubsidyType = (id: number, data: Partial<SubsidyTypeCreate>) =>
  req('/api/subsidies/types/' + id, { method: 'PUT', body: JSON.stringify(data) })

// ── 补贴申请 ──
export const getApplications = (params: Record<string, string | number>) =>
  req<PageResult<ApplicationOut>>('/api/subsidies/applications?' + new URLSearchParams(params as Record<string, string>))

export const searchApplications = (params: Record<string, string | number>) =>
  req<PageResult<ApplicationSearchResult>>(
    '/api/subsidies/applications/search?' + new URLSearchParams(params as Record<string, string>)
  )

export const createApplication = (data: ApplicationCreate) =>
  req<{ id: number }>('/api/subsidies/applications', { method: 'POST', body: JSON.stringify(data) })

export const updateApplication = (id: number, data: Partial<ApplicationCreate>) =>
  req('/api/subsidies/applications/' + id, { method: 'PUT', body: JSON.stringify(data) })

export const batchImportApplications = (rows: ApplicationCreate[]) =>
  req<{ created: number; skipped: number; errors: string[] }>(
    '/api/subsidies/applications/batch-import',
    { method: 'POST', body: JSON.stringify({ rows }) }
  )

// ── 代领关系 ──
export const getProxies = (params: Record<string, string | number>) =>
  req<SubsidyProxyOut[]>('/api/subsidies/proxies?' + new URLSearchParams(params as Record<string, string>))

export const createProxy = (data: SubsidyProxyCreate) =>
  req<{ id: number }>('/api/subsidies/proxies', { method: 'POST', body: JSON.stringify(data) })

export const deleteProxy = (id: number) =>
  req('/api/subsidies/proxies/' + id, { method: 'DELETE' })

// ── 汇总 ──
export const getYearCompare = (year: number) =>
  req<YearCompare>('/api/subsidies/summary/compare?year=' + year)

export const getSummaryByVillage = (year: number) =>
  req<VillageSummary[]>('/api/subsidies/summary/by-village?year=' + year)

export const getSummaryBySeason = (year: number) =>
  req<{ season: string; project_count: number; farmer_count: number; total_amount: number; total_area: number; application_count: number }[]>(
    '/api/subsidies/summary/by-season?year=' + year
  )

// ── AI ──
export const aiAnalyze = (data: { year: number; village_name?: string; question: string }) =>
  req<{ result: string; data_preview: Record<string, unknown> }>(
    '/api/ai/analyze',
    { method: 'POST', body: JSON.stringify(data) }
  )

// ── Excel模板 ──
export const getExcelTemplates = (businessType?: string) =>
  req<ExcelColumnTemplate[]>('/api/excel-templates' + (businessType ? `?business_type=${businessType}` : ''))

export const getExcelTemplate = (id: number) =>
  req<ExcelColumnTemplate>('/api/excel-templates/' + id)

export const detectExcelColumns = (columns: string[], businessType: string, sampleRows: Record<string, unknown>[]) =>
  req<{
    columns: Array<{ excel_column: string; suggested_field: string | null; confidence: number; alternatives: Array<{ field: string; confidence: number }> }>
    recommended_templates?: Array<{ id: number; template_name: string; match_rate: number }>
    auto_confirm_count?: number; unrecognized_count?: number
  }>(
    '/api/excel-templates/detect-columns', {
      method: 'POST', body: JSON.stringify({ columns, business_type: businessType, sample_rows: sampleRows }),
    }
  )

export const saveExcelTemplate = (data: Record<string, unknown>) =>
  req<{ id: number }>('/api/excel-templates', { method: 'POST', body: JSON.stringify(data) })

// ── 健康检查 ──
export const healthCheck = () => req<{ status: string }>('/api/health')

// ── 错误库 ──
export const getErrorLibrary = (params: Record<string, string | number>) =>
  req<PageResult<ErrorLibraryItem>>('/api/error-library?' + new URLSearchParams(params as Record<string, string>))

export const getErrorLibraryStats = () =>
  req<{ total: number; by_type: Record<string, number> }>('/api/error-library/stats')

export const createErrorLibrary = (data: ErrorLibraryCreate) =>
  req<{ id: number }>('/api/error-library', { method: 'POST', body: JSON.stringify(data) })

export const updateErrorLibrary = (id: number, data: ErrorLibraryCreate) =>
  req('/api/error-library/' + id, { method: 'PUT', body: JSON.stringify(data) })

export const deleteErrorLibrary = (id: number) =>
  req('/api/error-library/' + id, { method: 'DELETE' })

export const batchImportErrorLibrary = (rows: Record<string, unknown>[]) =>
  req<{ created: number; skipped: number }>('/api/error-library/batch-import', {
    method: 'POST', body: JSON.stringify({ rows }),
  })

export const batchDeleteErrorLibrary = (ids: number[]) =>
  req<{ deleted: number }>('/api/error-library/batch-delete', {
    method: 'POST', body: JSON.stringify({ ids }),
  })

// ── 家庭户 ──
export const getHouseholds = (params: Record<string, string | number>) =>
  req<PageResult<HH>>('/api/households?' + new URLSearchParams(params as Record<string, string>))

export const getOverdrawnHouseholds = () =>
  req<HH[]>('/api/households/alert/overdrawn')

export const getHouseholdDetail = (id: number, year?: number) =>
  req<HHDetail>(`/api/households/${id}${year && year > 0 ? `?year=${year}` : ''}`)

export const mergeHouseholds = (data: { source_household_id: number; target_household_id: number; operator?: string }) =>
  req<{ message: string }>('/api/households/merge', {
    method: 'POST', body: JSON.stringify(data),
  })

export const updateHousehold = (id: number, data: Partial<HouseholdCreate & { status: number }>) =>
  req(`/api/households/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const createHousehold = (data: HouseholdCreate) =>
  req<{ id: number }>('/api/households', { method: 'POST', body: JSON.stringify(data) })

export const moveMember = (data: MemberMoveRequest) =>
  req('/api/households/member/move', { method: 'POST', body: JSON.stringify(data) })

// ── 家庭户成员 ──
export const getHouseholdMembers = (householdId: number) =>
  req<{ household_id: number; members: HHDetail['members'] }>(`/api/households/${householdId}/members`)

export const addHouseholdMember = (householdId: number, data: MemberCreate) =>
  req<{ id: number; household_id: number }>(`/api/households/${householdId}/members`, {
    method: 'POST', body: JSON.stringify(data),
  })

export const updateHouseholdMember = (householdId: number, farmerId: number, data: MemberUpdate) =>
  req(`/api/households/${householdId}/members/${farmerId}`, {
    method: 'PUT', body: JSON.stringify(data),
  })

export const removeHouseholdMember = (householdId: number, farmerId: number) =>
  req(`/api/households/${householdId}/members/${farmerId}`, { method: 'DELETE' })

export const getHouseholdAreaByYear = (householdId: number) =>
  req<{ household_id: number; years: { year: number; subsidy_area: number }[] }>(
    `/api/households/${householdId}/area-by-year`
  )

// ── 家庭户事件 ──
export const getHouseholdEvents = (householdId: number, year?: number) =>
  req<HHEvent[]>(`/api/households/${householdId}/events` + (year ? `?year=${year}` : ''))

export const addHouseholdEvent = (householdId: number, data: Record<string, unknown>) =>
  req<{ id: number }>(`/api/households/${householdId}/events`, {
    method: 'POST', body: JSON.stringify(data),
  })

export const undoHouseholdEvent = (householdId: number, eventId: number) =>
  req(`/api/households/${householdId}/events/${eventId}`, { method: 'DELETE' })

// ── 家庭户历史 ──
export const getHouseholdHistoryDates = (householdId: number) =>
  req<{ events: HistoryDateEvent[] }>(`/api/households/${householdId}/history-dates`)

export const getHouseholdSnapshotAt = (householdId: number, date: string) =>
  req<SnapshotAtResponse>(`/api/households/${householdId}/snapshot-at/${date}`)

export const getHouseholdSnapshotByEvent = (householdId: number, eventId: number) =>
  req<SnapshotAtResponse>(`/api/households/${householdId}/snapshot-by-event/${eventId}`)

export const getHouseholdHistoryYears = (householdId: number) =>
  req<{ household_id: number; years: number[] }>(`/api/households/${householdId}/history-years`)

export const getHouseholdHistory = (householdId: number, year: number) =>
  req<unknown>(`/api/households/${householdId}/history/${year}`)

// ── 家庭户分户 / 批量组建 ──
export const splitHousehold = (householdId: number, data: Record<string, unknown>) =>
  req<{ new_household_id: number; moved_members: number[] }>(
    `/api/households/${householdId}/split`, { method: 'POST', body: JSON.stringify(data) }
  )

export const batchBuildHouseholds = (rows: { household_id: string; id_card: string; real_name?: string; is_head?: number; relation?: string; land_area?: number }[]) =>
  req<{ created: number; errors: string[] }>('/api/households/batch-build', {
    method: 'POST', body: JSON.stringify({ rows }),
  })

export const batchImportHouseholdMembers = (householdId: number, rows: Record<string, unknown>[]) =>
  req<{ created: number; skipped: number; errors: string[] }>(
    `/api/households/${householdId}/members/batch-import`, {
      method: 'POST', body: JSON.stringify({ rows }),
    }
  )

export const importConfirmedArea = (rows: { real_name: string; id_card: string; confirmed_area: number }[]) =>
  req<{ success: number; not_found: { id_card: string; real_name: string }[]; mismatch_name: { id_card: string; input_name: string; db_name: string }[]; errors: { id_card: string; reason: string }[] }>(
    '/api/households/import-confirmed-area', {
      method: 'POST', body: JSON.stringify({ rows }),
    }
  )

export const exportConfirmedAreaDiff = () =>
  fetch('/api/households/export-confirmed-area-diff')

// ── 家庭户人工确认 ──
export const manualConfirmHousehold = (householdId: number, data: { operator?: string; remark?: string }) =>
  req<{ message: string; household_id: number; confirmed_at: string; confirmed_by: string | null }>(
    `/api/households/${householdId}/manual-confirm`,
    { method: 'POST', body: JSON.stringify(data) }
  )

export const cancelManualConfirm = (householdId: number, data: { operator?: string; remark?: string }) =>
  req<{ message: string; household_id: number; previous_confirmed_at: string | null; previous_confirmed_by: string | null }>(
    `/api/households/${householdId}/cancel-confirm`,
    { method: 'POST', body: JSON.stringify(data) }
  )

export const batchConfirmHouseholds = (data: { household_ids: number[]; operator?: string; remark?: string }) =>
  req<{
    message: string
    total: number
    confirmed: number
    skipped: number
    errors: { household_id: number; error: string }[]
    results: { household_id: number; household_name: string; status: string; message: string }[]
  }>(
    '/api/households/batch-confirm',
    { method: 'POST', body: JSON.stringify(data) }
  )

export const deleteHousehold = (householdId: number) =>
  req<{ message: string; household_id: number }>(
    `/api/households/${householdId}`,
    { method: 'DELETE' }
  )

export const refreshAreaCache = (householdId?: number) =>
  req<{ message: string; household_id?: number; household_name?: string; total?: number }>(
    `/api/households/refresh-cache${householdId ? `?household_id=${householdId}` : ''}`,
    { method: 'POST' }
  )

// ── 家庭户批量导入 ──
export interface HouseholdImportRow {
  real_name: string
  id_card: string
  address: string
  head_relation?: string
  phone?: string
  bank_card?: string
  bank_name?: string
  gender?: string
}

export interface HouseholdImportPreview {
  groups: {
    address: string
    action: 'create' | 'merge_one' | 'merge_multi'
    head_name: string
    head_id_card: string
    member_count: number
    members: { real_name: string; id_card: string; is_head: boolean; in_db: boolean; has_errors: boolean }[]
    matched_hh_info: { id: number; household_code: string; household_name: string; village_name: string; group_display: string; contract_area: number | null }[]
    target_village_name: string
    target_group_display: string
    total_area_after_merge: number | null
    warnings: string[]
    has_errors: boolean
  }[]
  row_errors: { row: number; name: string; errors: string[] }[]
  summary: {
    total_rows: number
    total_groups: number
    new_households: number
    merge_single: number
    merge_multi: number
    error_rows: number
  }
}

export interface HouseholdImportResult {
  created_households: number
  merged_households: number
  created_farmers: number
  skipped_farmers: number
  errors: string[]
}

export const previewHouseholdImport = (rows: HouseholdImportRow[]) =>
  req<HouseholdImportPreview>('/api/household-import/preview', {
    method: 'POST', body: JSON.stringify({ rows }),
  })

export const executeHouseholdImport = (rows: HouseholdImportRow[]) =>
  req<HouseholdImportResult>('/api/household-import/execute', {
    method: 'POST', body: JSON.stringify({ rows }),
  })
