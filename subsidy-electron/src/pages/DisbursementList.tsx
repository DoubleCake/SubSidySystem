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

    // 导入预检 + 与预申请比对
    preCheck: async (rows, mapping) => {
      const mappedRows = rows.map((row, idx) => {
        const mapped: Record<string, unknown> = { ...row }
        if (mapping) {
          for (const [excelCol, systemField] of Object.entries(mapping)) {
            if (row[excelCol] !== undefined) mapped[systemField] = row[excelCol]
          }
        }
        mapped._row_index = idx
        return mapped
      })
      const chk = await api.checkEligibility({
        subsidy_type_id: props.subsidyType.id,
        year: props.subsidyType.subsidy_year,
        rows: mappedRows.map(r => ({ id_card: String(r.id_card || ''), real_name: String(r.real_name || ''), apply_area: Number(r.apply_area || 0), _row_index: r._row_index })),
      }) as any

      const preCheckResult = {
        passed_rows: (chk.passed_list || []).map((r: any) => r._row_index).filter((i: any) => i != null) as number[],
        failed_rows: (chk.failed_list || []).map((r: any) => ({ index: r._row_index ?? 0, real_name: r.real_name, id_card_masked: r.id_card_masked, issues: r.issues })),
        warning_rows: (chk.warning_list || []).map((r: any) => ({ index: r._row_index ?? 0, real_name: r.real_name, id_card_masked: r.id_card_masked, warnings: r.warnings })),
      }

      try {
        const appData = await api.exportApplications(props.subsidyType.id)
        const appMap: Record<string, any> = {}
        for (const a of (appData.items || [])) {
          const ic = (a as any).id_card || ''; if (ic) appMap[ic] = { real_name: a.farmer_name, village: a.village, apply_area: Number(a.apply_area || 0) }
        }
        const impMap: Record<string, any> = {}
        for (const r of mappedRows) {
          const ic = String(r.id_card || '').trim(); if (ic) impMap[ic] = { real_name: String(r.real_name || ''), apply_area: Number(r.apply_area || 0) }
        }
        const appIds = new Set(Object.keys(appMap)), impIds = new Set(Object.keys(impMap))
        return {
          ...preCheckResult,
          comparison: {
            missing_from_import: [...appIds].filter(ic => !impIds.has(ic)).map(ic => ({ id_card: ic, ...appMap[ic] })),
            new_in_import: [...impIds].filter(ic => !appIds.has(ic)).map(ic => ({ id_card: ic, ...impMap[ic] })),
            area_changed: [...appIds].filter(ic => impIds.has(ic)).map(ic => ({ id_card: ic, real_name: appMap[ic].real_name, app_area: appMap[ic].apply_area, import_area: impMap[ic].apply_area, diff: impMap[ic].apply_area - appMap[ic].apply_area })).filter((a: any) => Math.abs(a.diff) > 0.001),
          },
        }
      } catch { return preCheckResult }
    },
  }

  return <SubsidyListBase {...props} config={config} />
}
