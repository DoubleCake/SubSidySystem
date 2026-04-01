/**
 * 预检表格共享配置
 * 统一 PreCheckPage.tsx 和 SubsidyProjectsPage.tsx 中的预检结果显示
 *
 * 扩展性说明：
 * 1. 添加新的预检错误类型时，需要：
 *    - 在后端API（routers/precheck.py 和 routers/subsidies.py）中添加相应的字段
 *    - 在CheckResult类型（frontend/src/types/index.ts）中添加字段定义
 *    - 在此文件中添加对应的TableConfig配置
 *
 * 2. 配置字段说明：
 *    - field: 对应CheckResult中的字段名
 *    - title: 表格标题，可以是字符串或函数
 *    - headers: 表头数组
 *    - rowMapper: 行数据转换函数，将后端返回的行数据转换为React元素数组
 *
 * 3. 前端会自动使用此配置渲染所有预检错误类型的表格
 */

import Tag from '../components/Tag'
import type { CheckResult } from '../types'

// 预检错误类型定义
export type PrecheckErrorType =
  | 'error_library_hits'
  | 'format_errors'
  | 'village_errors'
  | 'duplicate_errors'
  | 'gender_mismatch'
  | 'area_anomalies'
  | 'area_missing'
  | 'age_anomaly'
  | 'deceased_farmers'
  | 'household_duplicates'
  | 'new_farmers'
  | 'removed_farmers'
  | 'changed_farmers'

// 表格配置接口
export interface TableConfig {
  /** 错误类型字段名 */
  field: keyof CheckResult
  /** 表格标题 */
  title: string | ((count: number) => string)
  /** 表头 */
  headers: string[]
  /** 行数据转换函数 */
  rowMapper: (row: any, index: number) => any[]
  /** 空状态消息 */
  emptyMessage?: string
  /** 是否默认显示 */
  defaultVisible?: boolean
}

// 预检表格配置映射
export const PRECHECK_TABLE_CONFIGS: Record<PrecheckErrorType, TableConfig> = {
  // 错误库命中
  error_library_hits: {
    field: 'error_library_hits',
    title: (count) => `⚠️ 错误库命中（${count}条）— 这些人员在历史错误记录中出现，请重点关注`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', '错误类型', '错误原因', '来源'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village, r.group,
      <Tag key="t" label={r.error_type} color="red" />,
      <span key="r" className="text-red-600 text-xs">{r.error_reason}</span>,
      r.source,
    ],
  },

  // 格式错误
  format_errors: {
    field: 'format_errors',
    title: (count) => `❌ 格式错误（${count}条）— 需修复后重新检查`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', '错误详情'],
    rowMapper: (r) => [
      r.row, r.name || '(空)', r.id_card || '(空)', r.village || '(空)', r.group || '(空)',
      <ul key="e" className="list-none">{r.errors.map((e: string, i: number) => <li key={i} className="text-red-600 text-xs">• {e}</li>)}</ul>,
    ],
  },

  // 村组不存在
  village_errors: {
    field: 'village_errors',
    title: (count) => `⚠️ 村组不存在（${count}条）— 请先在「系统设置→村组管理」中添加`,
    headers: ['行号', '姓名', '身份证号', '填写的村', '填写的组', '提示信息'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village, r.group,
      <span key="e" className="text-amber-600 text-xs">{r.error}</span>,
    ],
  },

  // 重复身份证
  duplicate_errors: {
    field: 'duplicate_errors',
    title: (count) => `⚠️ Excel内部重复（${count}条）— 同一身份证出现多次`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', '说明'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village || '-', r.group || '-',
      <span key="e" className="text-amber-600 text-xs">{r.error}</span>,
    ],
  },

  // 性别不符
  gender_mismatch: {
    field: 'gender_mismatch',
    title: (count) => `⚠️ 性别与身份证不符（${count}条）— 请核实后修正`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', 'Excel性别', '身份证推断'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village || '-', r.group || '-',
      r.excel_gender,
      <Tag key="g" label={r.id_card_gender} color={r.id_card_gender === '男' ? 'blue' : 'purple'} />,
    ],
  },

  // 面积异常
  area_anomalies: {
    field: 'area_anomalies',
    title: (count) => `⚠️ 面积异常（${count}条）— 请逐条核实`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', '异常类型', '异常详情', 'Excel承包地', '数据库承包地', '流转出', '代耕代种进', '不补贴', '实际补贴', '自有占用', '户级已用', '户级合计', '超出'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village, r.group,
      <span key="et" className={`text-xs font-semibold ${r.anomaly_type?.includes('面积超限') ? 'text-orange-600' : r.anomaly_type?.includes('承包面积不一致') ? 'text-purple-600' : 'text-red-600'}`}>{r.anomaly_type}</span>,
      <span key="ed" className="text-xs text-stone-600">{r.anomaly_details}</span>,
      <span key="c"  className="text-stone-600">{r.contract_area} 亩</span>,
      <span key="db" className="text-blue-600">{r.db_contract_area} 亩</span>,
      <span key="to" className="text-stone-400">{r.trust_out_area} 亩</span>,
      <span key="ti" className="text-stone-400">{r.trust_in_area} 亩</span>,
      <span key="n"  className="text-stone-400">{r.no_subsidy_area} 亩</span>,
      <span key="as" className="text-emerald-700">{r.actual_subsidy_area} 亩</span>,
      <span key="so" className="text-orange-600">{r.self_occupy} 亩</span>,
      <span key="hu" className="text-stone-400">{r.hh_used} 亩</span>,
      <span key="ht" className="text-orange-600 font-semibold">{r.hh_total} 亩</span>,
      r.exceed_amount > 0 ? <span key="ex" className="text-red-600 font-semibold">+{r.exceed_amount} 亩</span> : '-',
    ],
  },

  // 承包面积缺失
  area_missing: {
    field: 'area_missing',
    title: (count) => `⚠️ 承包面积缺失（${count}条）— 有申请面积但数据库中无承包面积记录`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', '申请面积', '说明'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village, r.group,
      <span key="a" className="text-orange-600 font-semibold">{r.contract_area} 亩</span>,
      <span key="e" className="text-red-600 text-xs">{r.error}</span>,
    ],
  },

  // 年龄异常
  age_anomaly: {
    field: 'age_anomaly',
    title: (count) => `⚠️ 年龄异常（${count}条）— 年龄小于16岁或大于100岁，请核实`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', '年龄', '出生年份', '说明'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village, r.group,
      <span key="a" className="text-orange-600 font-semibold">{r.age}岁</span>,
      r.birth_year,
      <span key="e" className="text-red-600 text-xs">{r.error}</span>,
    ],
  },

  // 死亡农户
  deceased_farmers: {
    field: 'deceased_farmers',
    title: (count) => `🚫 死亡农户（${count}条）— 该农户已标记为离世，不应出现在补贴名单中`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', '说明'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village, r.group,
      <span key="e" className="text-red-600 text-xs">{r.error}</span>,
    ],
  },

  // 同一家庭多成员申请
  household_duplicates: {
    field: 'household_duplicates',
    title: (count) => `⚠️ 同一家庭多成员申请（${count}条）— 同一家庭户有多人同时申请`,
    headers: ['行号', '姓名', '身份证号', '家庭ID', '其他成员', '说明'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card,
      <span key="h" className="font-mono text-xs">{r.household_id}</span>,
      r.other_members?.join('、') || '-',
      <span key="e" className="text-purple-600 text-xs">{r.error}</span>,
    ],
  },

  // 新增农户
  new_farmers: {
    field: 'new_farmers',
    title: (count) => `新增农户（${count}人）— 数据库中未存在，本次将新增`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组'],
    rowMapper: (r) => [r.row, r.name, r.id_card, r.village, r.group],
  },

  // 减少农户
  removed_farmers: {
    field: 'removed_farmers',
    title: (count) => `减少农户（${count}人）— 数据库在册但本次 Excel 未出现，请确认是否迁出/注销`,
    headers: ['姓名', '身份证号', '所在村', '所在组', '说明'],
    rowMapper: (r) => [r.name, r.id_card, r.village, r.group, <span key="n" className="text-blue-600 text-xs">{r.note}</span>],
  },

  // 字段变更
  changed_farmers: {
    field: 'changed_farmers',
    title: (count) => `ℹ️ 字段变更（${count}条）— 与数据库已有数据不一致，请人工确认`,
    headers: ['行号', '姓名', '身份证号', '所在村', '所在组', '变更内容'],
    rowMapper: (r) => [
      r.row, r.name, r.id_card, r.village, r.group,
      <div key="c" className="text-xs text-stone-600">
        {r.changes.map((c: string, i: number) => (
          <div key={i} className="flex items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mr-2" />
            {c}
          </div>
        ))}
      </div>,
    ],
  },
}

// 获取所有错误类型的表格配置（按优先级排序）
export const getPrecheckTableConfigs = (): TableConfig[] => [
  PRECHECK_TABLE_CONFIGS.error_library_hits,
  PRECHECK_TABLE_CONFIGS.format_errors,
  PRECHECK_TABLE_CONFIGS.village_errors,
  PRECHECK_TABLE_CONFIGS.duplicate_errors,
  PRECHECK_TABLE_CONFIGS.gender_mismatch,
  PRECHECK_TABLE_CONFIGS.area_anomalies,
  PRECHECK_TABLE_CONFIGS.area_missing,
  PRECHECK_TABLE_CONFIGS.age_anomaly,
  PRECHECK_TABLE_CONFIGS.deceased_farmers,
  PRECHECK_TABLE_CONFIGS.household_duplicates,
  PRECHECK_TABLE_CONFIGS.new_farmers,
  PRECHECK_TABLE_CONFIGS.removed_farmers,
  PRECHECK_TABLE_CONFIGS.changed_farmers,
]

// 检查结果中是否有错误
export const hasPrecheckErrors = (result: CheckResult): boolean => {
  const configs = getPrecheckTableConfigs()
  return configs.some(config => {
    const data = result[config.field] as any[]
    return data && data.length > 0
  })
}

// 获取错误统计
export const getErrorStats = (result: CheckResult): Record<string, number> => {
  const stats: Record<string, number> = {}
  const configs = getPrecheckTableConfigs()
  configs.forEach(config => {
    const data = result[config.field] as any[]
    if (data) {
      stats[config.field] = data.length
    }
  })
  return stats
}