/**
 * 发放列表 — 薄包装，配置 SubsidyListBase
 * 与预申请列表使用相同的字段和导入逻辑
 */
import SubsidyListBase from './SubsidyListBase'
import type { SubsidyListBaseProps, SubsidyListConfig } from './SubsidyListBase'
import * as api from '../api'

export default function DisbursementList(props: Omit<SubsidyListBaseProps, 'config'>) {
  const config: SubsidyListConfig = {
    apiBase: '/api/subsidies/payments',
    importTitle: '导入发放',
    exportPrefix: '发放列表',
    batchImportEndpoint: '/api/subsidies/payments/batch-import',
    onExport: (id: number) => api.exportPayments(id),

    // 导入字段名映射（application → payment）
    buildImportRow: (common) => ({
      ...common,
      payment_year: common.apply_year,
      amount: common.apply_amount,
      pay_status: 2,
      apply_amount: undefined,
      actual_amount: undefined,
      apply_year: undefined,
      pay_date: undefined,
    }),

    // 预检在详情页执行（导入只做纯数据入库）
  }

  return <SubsidyListBase {...props} config={config} />
}
