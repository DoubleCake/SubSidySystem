/**
 * 工具函数 — 脱敏
 * 对应 Python 版 utils.py 中的 mask_id_card / mask_phone / mask_bank_card
 */

/**
 * 身份证脱敏：510123********4231
 */
export function maskIdCard(idCard: string): string {
  if (!idCard || idCard.length < 15) return idCard
  return idCard.substring(0, 6) + '********' + idCard.substring(idCard.length - 4)
}

/**
 * 手机号脱敏：138****0001
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone
  return phone.substring(0, 3) + '****' + phone.substring(phone.length - 4)
}

/**
 * 银行卡脱敏：****0001
 */
export function maskBankCard(card: string): string {
  if (!card || card.length < 4) return card
  return '****' + card.substring(card.length - 4)
}

/**
 * 姓名脱敏：张三 → 张*；张小明 → 张*明；欧阳小明 → 欧**明
 * 用于上传 AI 模型前的数据脱敏
 */
export function maskName(name: string): string {
  const s = (name || '').trim()
  if (s.length <= 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}

/** 需要脱敏的字段名 */
type SensitiveKey = 'id_card' | 'phone' | 'bank_card'

/**
 * 脱敏结果类型：
 * - 若入参本身声明了某敏感字段，则返回对象中该字段保持原类型（值已被打码）
 * - 若入参没声明某敏感字段，返回对象中该字段可选、类型为 unknown（不再多出必填属性）
 */
type Desensitized<T extends Record<string, unknown>> = Omit<T, SensitiveKey> & {
  [K in SensitiveKey & keyof T]?: T[K]
} & {
  [K in Exclude<SensitiveKey, keyof T>]?: unknown
}

/**
 * 对农户对象做完整脱敏，返回新对象（不修改原数据）
 * 键结构与入参保持一致；空值（null/undefined/''）与原始值原样保留，
 * 仅非空值按身份证/手机号/银行卡规则打码。
 */
export function desensitizeFarmer<T extends Record<string, unknown>>(farmer: T): Desensitized<T> {
  const d: Record<string, unknown> = { ...farmer }
  if (d.id_card) d.id_card = maskIdCard(String(d.id_card))
  if (d.phone) d.phone = maskPhone(String(d.phone))
  if (d.bank_card) d.bank_card = maskBankCard(String(d.bank_card))
  return d as Desensitized<T>
}

/**
 * 对文本中的敏感信息做批量打码（用于 AI 分析前）
 * 匹配身份证号、手机号模式
 */
export function desensitizeText(text: string): string {
  let result = text
  // 18位身份证号
  result = result.replace(/\b\d{6}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, (match) => maskIdCard(match))
  // 手机号
  result = result.replace(/\b1[3-9]\d{9}\b/g, (match) => maskPhone(match))
  return result
}
