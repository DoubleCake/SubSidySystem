/**
 * 人员基本属性导入 — 解析与预览（纯逻辑，不依赖 Electron，便于测试）
 *
 * 规则：按身份证号匹配；姓名不一致的行标记为问题并跳过；
 * 只处理 farmer_status / status_date / death_date 三个属性。
 */
import { maskIdCard } from './masking'
import { validateIdCard, parseIdCard } from './id-card'

export const STATUS_LABEL: Record<number, string> = { 1: '在册', 2: '注销', 3: '迁出', 4: '死亡' }

const STATUS_MAP: Record<string, number> = {
  '1': 1, '在册': 1, '正常': 1, '存活': 1,
  '2': 2, '注销': 2, '删除': 2,
  '3': 3, '迁出': 3, '移出': 3, '迁走': 3,
  '4': 4, '死亡': 4, '去世': 4, '已故': 4, '身故': 4,
}

export type AttributeAction = 'update' | 'skip' | 'error'

export interface AttributePreviewRow {
  row_index: number
  raw: Record<string, unknown>
  id_card: string
  id_card_masked: string
  input_name: string
  db_id?: number
  household_id?: number
  db_name?: string
  current_status?: number
  current_status_date?: string | null
  current_death_date?: string | null
  next_status?: number
  next_status_date?: string | null
  next_death_date?: string | null
  action: AttributeAction
  messages: string[]
}

export interface AttributeDb {
  getRaw<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined
}

/** 解析日期，支持 Excel 序列号 / 2026-1-2 / 2026/1/2 / 20260102 / ISO */
export function parseDateValue(v: unknown): { date: string | null; error?: string } {
  if (v === null || v === undefined || v === '') return { date: null }

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return { date: toDateStr(v) }
  }

  if (typeof v === 'number' || /^\d{5}$/.test(String(v).trim())) {
    const n = Number(v)
    if (n > 20000 && n < 80000) {
      const ms = Math.round((n - 25569) * 86400 * 1000) // Excel 1900 日期系统
      const d = new Date(ms)
      if (!Number.isNaN(d.getTime())) return { date: toDateStr(d) }
    }
    return { date: null, error: `无法识别的日期序列：${v}` }
  }

  const s = String(v).trim().slice(0, 10)
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return { date: null, error: `日期格式无法识别：${String(v)}` }

  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return { date: null, error: `日期不存在：${String(v)}` }
  }
  return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseStatusValue(v: unknown): { status: number | null; error?: string } {
  if (v === null || v === undefined || v === '') return { status: null }
  const key = String(v).trim()
  if (key in STATUS_MAP) return { status: STATUS_MAP[key] }
  return { status: null, error: `无法识别的状态：${key}（可用：在册/注销/迁出/死亡）` }
}

export function buildAttributePreview(rows: Record<string, unknown>[], db: AttributeDb): AttributePreviewRow[] {
  const today = toDateStr(new Date())

  return rows.map((raw, idx) => {
    const out: AttributePreviewRow = {
      row_index: idx + 1,
      raw,
      id_card: '',
      id_card_masked: '',
      input_name: String(raw.real_name ?? raw.name ?? '').trim(),
      action: 'skip',
      messages: [],
    }

    if (typeof raw.id_card === 'number') {
      out.action = 'error'
      out.messages.push('身份证号被 Excel 识别为数字（可能已丢失精度），请把该列设为文本后重新导出')
      return out
    }

    const idCard = String(raw.id_card ?? raw.idCard ?? '').trim().toUpperCase()
    out.id_card = idCard
    out.id_card_masked = idCard ? maskIdCard(idCard) : ''

    if (!idCard) {
      out.action = 'error'
      out.messages.push('身份证号为空')
      return out
    }
    const [valid, idMsg] = validateIdCard(idCard)
    if (!valid) {
      out.action = 'error'
      out.messages.push(`身份证号无效：${idMsg}`)
      return out
    }

    const farmer = db.getRaw<Record<string, any>>(
      'SELECT id, household_id, real_name, farmer_status, status_date, death_date FROM farmer_profile WHERE id_card = ?',
      idCard
    )
    if (!farmer) {
      out.action = 'error'
      out.messages.push('系统中不存在该身份证号，未导入')
      return out
    }

    out.db_id = Number(farmer.id)
    out.household_id = Number(farmer.household_id)
    out.db_name = String(farmer.real_name || '')
    out.current_status = Number(farmer.farmer_status)
    out.current_status_date = farmer.status_date ? String(farmer.status_date) : null
    out.current_death_date = farmer.death_date ? String(farmer.death_date) : null

    // 姓名核对：不一致直接判为问题行，展示但不覆盖
    if (out.input_name && out.input_name !== out.db_name) {
      out.action = 'error'
      out.messages.push(`姓名与系统不一致（系统中：${out.db_name}），已跳过`)
      return out
    }

    const statusParsed = parseStatusValue(raw.farmer_status ?? raw.status)
    if (statusParsed.error) {
      out.action = 'error'
      out.messages.push(statusParsed.error)
      return out
    }
    const explicitStatus = statusParsed.status

    const statusDateParsed = parseDateValue(raw.status_date)
    if (statusDateParsed.error) {
      out.action = 'error'
      out.messages.push(`状态变更日期无效：${statusDateParsed.error}`)
      return out
    }
    const deathDateParsed = parseDateValue(raw.death_date ?? raw.death_time)
    if (deathDateParsed.error) {
      out.action = 'error'
      out.messages.push(`死亡日期无效：${deathDateParsed.error}`)
      return out
    }

    if (explicitStatus == null && statusDateParsed.date == null && deathDateParsed.date == null) {
      out.action = 'error'
      out.messages.push('没有可导入的属性（状态、状态变更日期、死亡日期均为空）')
      return out
    }

    const nextStatus = explicitStatus ?? out.current_status
    let nextStatusDate = statusDateParsed.date ?? out.current_status_date ?? null
    let nextDeathDate = deathDateParsed.date ?? out.current_death_date ?? null

    if (nextStatus === 4) {
      if (!nextDeathDate) nextDeathDate = nextStatusDate
      if (!nextDeathDate) out.messages.push('未填写死亡日期，将只记录状态')
    } else {
      if (deathDateParsed.date) {
        out.action = 'error'
        out.messages.push('当前行状态不是「死亡」，不能填写死亡日期')
        return out
      }
      nextDeathDate = null
    }

    if (nextStatusDate && nextStatusDate > today) out.messages.push(`日期 ${nextStatusDate} 晚于今天`)
    if (nextDeathDate && nextDeathDate > today) out.messages.push(`死亡日期 ${nextDeathDate} 晚于今天`)

    const birth = parseIdCard(idCard).birthDate
    if (birth && nextDeathDate && nextDeathDate < birth) {
      out.action = 'error'
      out.messages.push(`死亡日期 ${nextDeathDate} 早于出生日期 ${birth}`)
      return out
    }
    if (birth && nextStatusDate && nextStatusDate < birth) {
      out.action = 'error'
      out.messages.push(`状态变更日期 ${nextStatusDate} 早于出生日期 ${birth}`)
      return out
    }

    out.next_status = nextStatus
    out.next_status_date = nextStatusDate
    out.next_death_date = nextDeathDate

    const changed =
      nextStatus !== out.current_status ||
      nextStatusDate !== out.current_status_date ||
      nextDeathDate !== out.current_death_date

    out.action = changed ? 'update' : 'skip'
    if (!changed) out.messages.push('与系统当前值一致，跳过')
    return out
  })
}
