export const fmt = (n: string | number | null | undefined): string =>
  n == null ? '—' : '¥' + Number(n).toFixed(2)

export const fmtDate = (d: string | null | undefined): string => d ?? '—'

export const maskIdCard = (s: string) =>
  s.length >= 10 ? s.slice(0, 6) + '********' + s.slice(-4) : s

export const parseIdCardInfo = (id: string): { birth: string; gender: number } | null => {
  if (id.length !== 18) return null
  try {
    const y = id.slice(6, 10), m = id.slice(10, 12), d = id.slice(12, 14)
    const gender = parseInt(id[16]) % 2 === 1 ? 1 : 2
    return { birth: `${y}-${m}-${d}`, gender }
  } catch { return null }
}

export const RESTRICTED_IDENTITY: Record<number, { label: string; color: string }> = {
  0: { label: '无限制', color: 'green' },
  1: { label: '受限制', color: 'red' },
}

export const FARMER_STATUS: Record<number, { label: string; color: string }> = {
  1: { label: '在册',  color: 'green'  },
  2: { label: '注销',  color: 'red'    },
  3: { label: '迁出',  color: 'amber'  },
  4: { label: '死亡',  color: 'gray'   },
}

export const PAY_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '待发放',  color: 'amber'  },
  1: { label: '部分发放', color: 'blue'   },
  2: { label: '已发放',  color: 'green'  },
  3: { label: '驳回',    color: 'red'    },
}

export const SUBSIDY_PAY_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '未发放',   color: 'gray'   },
  1: { label: '部分发放', color: 'amber'  },
  2: { label: '已完成',   color: 'green'  },
}

// 动态年份：当年往前8年+往后1年，不写死
export const years: number[] = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + 1 - i)

// 从 Excel 行猜测村组 ID
export const guessVillageGroupId = (
  groups: { id: number; village_name: string; group_no: string; full_name: string }[],
  village?: string,
  group?: string
): number | null => {
  if (!village && !group) return null
  const found = groups.find(g =>
    (!village || g.village_name.includes(village)) &&
    (!group   || g.group_no.includes(group) || g.full_name.includes(group))
  )
  return found?.id ?? groups[0]?.id ?? null
}
