import type {
  VillageGroup, FarmerOut, FarmerCreate, PageResult,
  SubsidyType, SubsidyTypeCreate,
  ApplicationOut, ApplicationCreate,
  YearCompare, VillageSummary,
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
export const getVillageGroups = () => req<VillageGroup[]>('/api/village-groups')

// ── 农户 ──
export const getFarmers = (params: Record<string, string | number>) =>
  req<PageResult<FarmerOut>>('/api/farmers?' + new URLSearchParams(params as Record<string, string>))

export const getFarmer = (id: number) => req<FarmerOut>('/api/farmers/' + id)

export const createFarmer = (data: FarmerCreate) =>
  req<{ id: number }>('/api/farmers/', { method: 'POST', body: JSON.stringify(data) })

export const updateFarmer = (id: number, data: Partial<FarmerCreate>) =>
  req('/api/farmers/' + id, { method: 'PUT', body: JSON.stringify(data) })

export const batchImportFarmers = (rows: FarmerCreate[]) =>
  req<{ created: number; skipped: number; errors: string[] }>(
    '/api/farmers/batch-import',
    { method: 'POST', body: JSON.stringify({ rows }) }
  )

// ── 补贴类型 ──
export const getSubsidyTypes = (year?: number) =>
  req<SubsidyType[]>('/api/subsidies/types' + (year ? `?year=${year}` : ''))

export const createSubsidyType = (data: SubsidyTypeCreate) =>
  req<{ id: number }>('/api/subsidies/types', { method: 'POST', body: JSON.stringify(data) })

export const updateSubsidyType = (id: number, data: Partial<SubsidyTypeCreate>) =>
  req('/api/subsidies/types/' + id, { method: 'PUT', body: JSON.stringify(data) })

// ── 补贴申请 ──
export const getApplications = (params: Record<string, string | number>) =>
  req<PageResult<ApplicationOut>>('/api/subsidies/applications?' + new URLSearchParams(params as Record<string, string>))

export const createApplication = (data: ApplicationCreate) =>
  req<{ id: number }>('/api/subsidies/applications', { method: 'POST', body: JSON.stringify(data) })

export const updateApplication = (id: number, data: Partial<ApplicationCreate>) =>
  req('/api/subsidies/applications/' + id, { method: 'PUT', body: JSON.stringify(data) })

export const batchImportApplications = (rows: ApplicationCreate[]) =>
  req<{ created: number; skipped: number; errors: string[] }>(
    '/api/subsidies/applications/batch-import',
    { method: 'POST', body: JSON.stringify({ rows }) }
  )

// ── 汇总 ──
export const getYearCompare = (year: number) =>
  req<YearCompare>('/api/subsidies/summary/compare?year=' + year)

export const getSummaryByVillage = (year: number) =>
  req<VillageSummary[]>('/api/subsidies/summary/by-village?year=' + year)

// ── AI ──
export const aiAnalyze = (data: { year: number; village_name?: string; question: string }) =>
  req<{ result: string; data_preview: Record<string, unknown> }>(
    '/api/ai/analyze',
    { method: 'POST', body: JSON.stringify(data) }
  )

// ── 健康检查 ──
export const healthCheck = () => req<{ status: string }>('/api/health')
