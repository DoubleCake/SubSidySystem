/**
 * 工具函数 — 身份证解析与校验
 * 对应 Python 版 utils.py 中的 parse_id_card / validate_id_card / parse_gender_from_id
 */

export interface IdCardInfo {
  birthDate: string | null  // YYYY-MM-DD
  gender: number            // 1=男 2=女 0=无法解析
}

/**
 * 从身份证号解析出生日期和性别
 */
export function parseIdCard(idCard: string): IdCardInfo {
  const result: IdCardInfo = { birthDate: null, gender: 0 }
  const card = idCard.trim()

  if (card.length === 18) {
    try {
      const year = parseInt(card.substring(6, 10))
      const month = parseInt(card.substring(10, 12))
      const day = parseInt(card.substring(12, 14))
      result.birthDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    } catch {
      // ignore parse error
    }
    const genderDigit = parseInt(card[16])
    result.gender = genderDigit % 2 === 1 ? 1 : 2
  } else if (card.length === 15) {
    try {
      const year = 1900 + parseInt(card.substring(6, 8))
      const month = parseInt(card.substring(8, 10))
      const day = parseInt(card.substring(10, 12))
      result.birthDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    } catch {
      // ignore parse error
    }
    const genderDigit = parseInt(card[14])
    result.gender = genderDigit % 2 === 1 ? 1 : 2
  }

  return result
}

/**
 * 校验身份证号合法性 (GB11643-1999)
 * 返回: [是否合法, 错误原因]
 */
export function validateIdCard(idCard: string): [boolean, string] {
  if (!idCard) return [false, '身份证号为空']
  const card = idCard.trim().toUpperCase()

  if (card.length !== 18) return [false, `长度不是18位（当前${card.length}位）`]
  if (!/^\d{17}[\dX]$/.test(card)) return [false, '格式不正确（前17位应为数字，最后一位为数字或X）']

  // 出生日期校验
  const year = parseInt(card.substring(6, 10))
  const month = parseInt(card.substring(10, 12))
  const day = parseInt(card.substring(12, 14))
  if (year < 1900 || year > 2099) return [false, `出生年份 ${year} 不合理`]
  if (month < 1 || month > 12) return [false, `出生月份 ${month} 不合理`]
  if (day < 1 || day > 31) return [false, `出生日期 ${day} 不合理`]

  // 校验码
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checkMap = '10X98765432'
  let total = 0
  for (let i = 0; i < 17; i++) {
    total += parseInt(card[i]) * weights[i]
  }
  const expectedCheck = checkMap[total % 11]
  if (card[17] !== expectedCheck) {
    return [false, `校验码错误（应为${expectedCheck}，实际为${card[17]}）`]
  }

  return [true, '']
}

/**
 * 从身份证解析性别：奇数=男(1)，偶数=女(2)
 */
export function parseGenderFromId(idCard: string): number {
  if (idCard.length === 18) {
    return parseInt(idCard[16]) % 2 === 1 ? 1 : 2
  }
  return 0
}
