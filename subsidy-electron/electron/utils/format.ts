/**
 * 工具函数 — 村组格式化
 * 对应 Python 版 utils.py 中的 format_group_no / parse_group_no_to_int / gen_household_code
 */

const DIGITS = '零一二三四五六七八九十'

/**
 * 将 1~99 的整数转为中文数字
 */
export function arabicToChinese(n: number): string {
  if (n <= 10) return DIGITS[n]
  if (n < 20) {
    return '十' + (n % 10 ? DIGITS[n - 10] : '')
  }
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return DIGITS[tens] + '十' + (ones ? DIGITS[ones] : '')
}

/**
 * 将整数转为中文组名：1→'一组', 2→'二组'
 */
export function formatGroupNo(n: number | null): string {
  if (n == null) return '一组'
  if (n >= 1 && n <= 10) {
    return `${arabicToChinese(n)}组`
  }
  return `${n}组`
}

/**
 * 将 '1' / '一组' / 1 等多种格式转为整数
 */
export function parseGroupNoToInt(value: unknown): number {
  if (value == null) return 1
  const s = String(value).trim()

  // 纯数字字符串
  if (/^\d+$/.test(s)) return parseInt(s)

  // 开头数字 + 后续文字（如 "1组"、"2大队"）
  const m = s.match(/^(\d+)/)
  if (m) return parseInt(m[1])

  // 中文数字：一组、二组...
  const CN_MAP: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  }
  for (const [cn, num] of Object.entries(CN_MAP)) {
    if (s.includes(cn)) return num
  }

  return /^\d+$/.test(s) ? parseInt(s) : 1
}

/**
 * 生成家庭户编码：HH0001
 */
export function genHouseholdCode(farmerId: number): string {
  return `HH${String(farmerId).padStart(4, '0')}`
}
