/**
 * 主题色常量（与 designs/subsidy-ui/project/Palette.dc.html 一一对应）
 *
 * 三条铁律：
 *  1. 深底只配白字（moss-600 及以上）
 *  2. 浅底只配深字（同族深色，禁止白色）
 *  3. 灰阶不跨档：warm-400 及以下只做图标/分隔线，不作正文
 */

// ── 主色 · 墨绿（色相 158°，10 阶明度等距）──
export const MOSS = {
  50: '#F2F7F4',
  100: '#E2EDE6',
  200: '#C4DACC',
  300: '#9BC0A8',
  400: '#6C9C7D',
  500: '#43765A',
  600: '#2F5C46',
  700: '#234A38',
  800: '#1A3A2C',
  900: '#122B20',
} as const

// ── 中性 · 暖灰（带同族微绿调）──
export const WARM = {
  50: '#FAF8F4',
  100: '#F3EFE7',
  200: '#E6E0D4',
  300: '#D2CBBC',
  400: '#A8A091',
  500: '#7A7466',
  600: '#5C5749',
  700: '#434035',
  800: '#2C2A23',
  900: '#1C1B16',
} as const

// ── 强调 · 谷金（只做装饰，永不承载白字）──
export const GOLD = {
  50: '#FBF3E2',
  100: '#F2E0B8',
  200: '#DDBE84',
  300: '#C29A55',
  600: '#8A6118',
  700: '#6B4A0F',
} as const

// ── 语义色（浅底 + 深字配色对，对比 6.1–7.7）──
export const SEMANTIC = {
  success: { bg: '#E7F2EA', fg: '#1B5E36', solid: '#2F5C46' },
  warning: { bg: '#FBF0DA', fg: '#7A5210', solid: '#B45309' },
  danger:  { bg: '#FCEAE8', fg: '#A81D1D', solid: '#B91C1C' },
  info:    { bg: '#E7EFF4', fg: '#1F4F63', solid: '#1F4F63' },
} as const

/** 常用快捷别名 */
export const T = {
  /** 页面底色 */
  pageBg: WARM[100],
  /** 卡片底色 */
  cardBg: '#FFFFFF',
  /** 卡片边框 */
  border: WARM[200],
  /** 分隔线 */
  divider: WARM[200],
  /** 正文 */
  text: WARM[800],
  /** 正文强 */
  textStrong: WARM[900],
  /** 次要文字（4.7:1） */
  textMuted: WARM[500],
  /** 表头字 */
  textHeader: WARM[700],
  /** 标题绿 */
  heading: MOSS[700],
  /** 主按钮底 */
  primary: MOSS[600],
  /** 主按钮悬停 */
  primaryHover: MOSS[700],
  /** 浅绿底（按钮/标签） */
  primarySoft: MOSS[100],
  /** 浅绿底悬停 */
  primarySoftHover: MOSS[200],
  /** 强调数字（金） */
  accent: GOLD[200],
  /** 金色文字（5.6:1） */
  accentText: GOLD[600],
} as const
