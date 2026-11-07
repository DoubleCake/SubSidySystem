/**
 * 人员属性导入解析规则测试（开发用）
 * 运行：node node_modules/tsx/dist/cli.mjs scripts/test-attribute-preview.ts
 */
import assert from 'node:assert'
import { buildAttributePreview } from '../electron/utils/attribute-import'

/** 生成合法身份证号（含校验码） */
function makeId(birth: string, seq = '001', gender = 1): string {
  const area = '510123'
  const y = birth.slice(0, 4), m = birth.slice(4, 6), d = birth.slice(6, 8)
  const seqPart = String(Number(seq) * 2 - (gender === 1 ? 1 : 0)).padStart(3, '0')
  const body = `${area}${y}${m}${d}${seqPart}`
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checkMap = '10X98765432'
  let total = 0
  for (let i = 0; i < 17; i++) total += Number(body[i]) * weights[i]
  return body + checkMap[total % 11]
}

const idZhang = makeId('19650315', '001', 1)
const idLi = makeId('19900101', '002', 2)
const idWang = makeId('19920202', '003', 1)
const idUnknown = makeId('19800101', '004', 1)

const farmers: Record<string, any> = {
  [idZhang]: { id: 1, household_id: 10, real_name: '张三', farmer_status: 1, status_date: null, death_date: null },
  [idLi]: { id: 2, household_id: 11, real_name: '李四', farmer_status: 4, status_date: '2026-01-01', death_date: '2026-01-01' },
  [idWang]: { id: 3, household_id: 12, real_name: '王五', farmer_status: 1, status_date: null, death_date: null },
}

const db = { getRaw: (_sql: string, id: unknown) => farmers[String(id)] }

const rows = [
  { id_card: idZhang, real_name: '张三', farmer_status: '死亡', status_date: '2026-03-01', death_date: '2026-03-01' },
  { id_card: idZhang, real_name: '张三丰', farmer_status: '死亡' },
  { id_card: idUnknown, real_name: '赵六', farmer_status: '死亡' },
  { id_card: idLi, real_name: '李四', farmer_status: '死亡', status_date: '2026-01-01', death_date: '2026-01-01' },
  { id_card: idWang, real_name: '王五', farmer_status: '火化' },
  { id_card: idWang, real_name: '王五', farmer_status: '在册', death_date: '2026-01-01' },
  { id_card: idWang, real_name: '王五', farmer_status: '死亡', death_date: '1980-01-01' },
]

const result = buildAttributePreview(rows, db)

assert.equal(result[0].action, 'update', '正常死亡行应可更新')
assert.equal(result[0].next_status, 4)
assert.equal(result[0].next_death_date, '2026-03-01')

assert.equal(result[1].action, 'error', '姓名不一致应判为问题行')
assert.ok(result[1].messages.join('').includes('姓名与系统不一致'), '应提示姓名不一致')
assert.equal(result[1].db_name, '张三')

assert.equal(result[2].action, 'error', '系统不存在应报错')
assert.ok(result[2].messages.join('').includes('不存在'))

assert.equal(result[3].action, 'skip', '与系统一致应跳过')

assert.equal(result[4].action, 'error', '非法状态应报错')

assert.equal(result[5].action, 'error', '非死亡状态填写死亡日期应报错')

assert.equal(result[6].action, 'error', '死亡日期早于出生日期应报错')

console.log('人员属性解析测试通过：姓名不一致/不存在/无变化/非法状态/非法日期 均按预期处理')
