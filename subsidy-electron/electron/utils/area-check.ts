/**
 * 工具函数 — 面积异常检查
 * 对应 Python 版 utils.py 中的 check_area_anomaly / check_confirmed_vs_contract
 */

export interface AreaAnomalyResult {
  anomalyType: string | null
  anomalyDetails: string[]
  exceedAmount: number
  selfOccupy: number
  hhTotal: number
  finalSubsidy: number
  dbContractArea: number
  hhUsed: number
}

/**
 * 统一面积异常检查
 */
export function checkAreaAnomaly(options: {
  excelContractArea: number | null
  dbContractArea: number | null
  applyArea: number | null
  excelTrustOut?: number
  excelTrustIn?: number
  excelNoSubsidy?: number
  actualSubsidyArea?: number | null
  season?: string | null
  hhUsed?: number
  ignoreTrustIn?: boolean
}): AreaAnomalyResult {
  const {
    excelContractArea, dbContractArea, applyArea,
    excelTrustOut = 0, excelTrustIn = 0, excelNoSubsidy = 0,
    actualSubsidyArea = null, season = null, hhUsed = 0,
    ignoreTrustIn = true,
  } = options

  let anomalyType: string | null = null
  const anomalyDetails: string[] = []
  let exceedAmount = 0
  let selfOccupy = 0
  let hhTotal = 0

  if (excelContractArea == null || dbContractArea == null) {
    return {
      anomalyType: null, anomalyDetails: [],
      exceedAmount: 0, selfOccupy: 0, hhTotal: 0,
      finalSubsidy: 0, dbContractArea: 0, hhUsed: 0,
    }
  }

  const excelC = excelContractArea
  const dbC = dbContractArea

  // 检查一：Excel承包面积与数据库承包面积不一致
  if (Math.abs(excelC - dbC) > 0.001) {
    anomalyType = '承包面积不一致'
    anomalyDetails.push(`Excel填报${excelC}亩，数据库登记${dbC}亩`)
  }

  // 计算有效补贴面积
  let finalSubsidy = 0
  if (actualSubsidyArea != null) {
    finalSubsidy = actualSubsidyArea
  } else {
    finalSubsidy = Math.round((excelC - excelTrustOut - excelNoSubsidy) * 10000) / 10000
  }

  // 计算自有占用面积
  if (ignoreTrustIn) {
    selfOccupy = Math.round(finalSubsidy * 10000) / 10000
  } else {
    selfOccupy = Math.round((finalSubsidy - excelTrustIn) * 10000) / 10000
  }

  // 情况A：单行超限
  if (dbC > 0 && selfOccupy > dbC) {
    anomalyType = anomalyType ? `${anomalyType}+面积超限` : '面积超限'
    exceedAmount = Math.round((selfOccupy - dbC) * 10000) / 10000
    anomalyDetails.push(`单行超限${exceedAmount}亩`)
  }

  // 情况B：户级累计超限
  const validSeasons = ['大春', '小春', '全年单补', '临时']
  if (season && validSeasons.includes(season) && dbC > 0) {
    hhTotal = Math.round((hhUsed + finalSubsidy) * 10000) / 10000
    if (hhTotal > dbC) {
      anomalyType = anomalyType && anomalyType.includes('面积超限')
        ? anomalyType
        : anomalyType ? `${anomalyType}+面积超限` : '面积超限'
      const hhExceed = Math.round((hhTotal - dbC) * 10000) / 10000
      exceedAmount = Math.max(exceedAmount, hhExceed)
      if (!anomalyDetails.some(d => d.includes('累计超限'))) {
        anomalyDetails.push(`累计超限${hhExceed}亩`)
      }
    }
  }

  return {
    anomalyType, anomalyDetails, exceedAmount, selfOccupy, hhTotal,
    finalSubsidy, dbContractArea: dbC, hhUsed,
  }
}

/**
 * 比较承包面积与确权面积
 */
export function checkConfirmedVsContract(contractArea: number | null, confirmedArea: number | null): {
  diff: number | null
  status: 'match' | 'confirmed_larger' | 'contract_larger' | 'missing'
  label: string
} {
  if (contractArea == null || confirmedArea == null) {
    return { diff: null, status: 'missing', label: '数据缺失' }
  }

  const c = Math.round(contractArea * 100) / 100
  const f = Math.round(confirmedArea * 100) / 100
  const diff = Math.round((f - c) * 100) / 100

  if (Math.abs(diff) <= 0.001) {
    return { diff: 0, status: 'match', label: '一致' }
  } else if (diff > 0) {
    return { diff, status: 'confirmed_larger', label: `确权多${diff}亩` }
  } else {
    return { diff, status: 'contract_larger', label: `承包多${Math.abs(diff)}亩` }
  }
}
