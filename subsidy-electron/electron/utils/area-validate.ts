/**
 * 工具函数 — 面积录入合理性校验
 *
 * 用于家庭户承包面积/确权面积的保存前校验：
 *   · 不能为负数，不能超过上限（超过上限基本是录入错误）
 *   · 承包面积与确权面积差异过大只给警告，不阻止保存
 */

/** 单个面积字段的合理上限（亩） */
export const AREA_MAX = 10000

/** 承包面积与确权面积差异超过该比例时给出警告 */
export const AREA_DIFF_WARN_RATIO = 0.5

/** 面积校验结果 */
export interface AreaCheckResult {
  /** 阻止保存的错误信息 */
  error: string | null
  /** 不阻止保存的警告信息 */
  warnings: string[]
  /** 归一化后的承包面积（本次未修改时为 undefined，清空时为 null） */
  contractValue?: number | null
  /** 归一化后的确权面积（本次未修改时为 undefined，清空时为 null） */
  confirmedValue?: number | null
}

/**
 * 解析并校验单个面积值
 * 空值（undefined/''）视为未填写；null 显式清空
 */
export function checkAreaValue(fieldLabel: string, raw: unknown): { error: string | null; value: number | null } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { error: null, value: null }
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(num)) {
    return { error: `${fieldLabel}必须是数字`, value: null }
  }
  if (num < 0) {
    return { error: `${fieldLabel}不能为负数（当前 ${num}）`, value: null }
  }
  if (num > AREA_MAX) {
    return { error: `${fieldLabel} ${num} 亩超过合理上限 ${AREA_MAX} 亩，请核对录入数据`, value: null }
  }
  return { error: null, value: Math.round(num * 100) / 100 }
}

/**
 * 校验承包面积与确权面积的合理性
 * @param contractRaw 传入的承包面积原值；undefined 表示本次不修改
 * @param confirmedRaw 传入的确权面积原值；undefined 表示本次不修改
 * @param current 已有记录的面积（用于只改一个字段时对比另一个字段）
 */
export function validateHouseholdAreas(
  contractRaw: unknown,
  confirmedRaw: unknown,
  current?: { contract_area?: unknown; confirmed_area?: unknown }
): AreaCheckResult {
  const warnings: string[] = []

  const contract = checkAreaValue('承包面积', contractRaw)
  if (contract.error) return { error: contract.error, warnings }

  const confirmed = checkAreaValue('确权面积', confirmedRaw)
  if (confirmed.error) return { error: confirmed.error, warnings }

  // 只改一个字段时，另一个字段取数据库现值参与差异比较
  const curContract = current?.contract_area != null ? Number(current.contract_area) : null
  const curConfirmed = current?.confirmed_area != null ? Number(current.confirmed_area) : null
  // 未修改的字段用数据库现值参与比较；显式清空（传 null）的字段不参与
  const c = contractRaw === undefined ? curContract : contract.value
  const f = confirmedRaw === undefined ? curConfirmed : confirmed.value

  if (c != null && f != null && c > 0 && f > 0) {
    const diff = Math.abs(f - c)
    const base = Math.min(c, f)
    if (diff / base > AREA_DIFF_WARN_RATIO) {
      warnings.push(
        `承包面积 ${c} 亩与确权面积 ${f} 亩差异 ${Math.round(diff * 100) / 100} 亩（超过 ${AREA_DIFF_WARN_RATIO * 100}%），请确认数据是否准确`
      )
    }
  }

  return { error: null, warnings, contractValue: contract.value, confirmedValue: confirmed.value }
}
