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
 * 对农户对象做完整脱敏，返回新对象（不修改原数据）
 */
export function desensitizeFarmer<T extends Record<string, unknown>>(farmer: T): T {
  const d = { ...farmer }
  if (d.id_card) d.id_card = maskIdCard(d.id_card as string)
  if (d.phone) d.phone = maskPhone(d.phone as string)
  if (d.bank_card) d.bank_card = maskBankCard(d.bank_card as string)
  return d
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
