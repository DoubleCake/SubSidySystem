/**
 * 预申请列表 — 薄包装，配置 SubsidyListBase
 */
import { useState } from 'react'
import SubsidyListBase from './SubsidyListBase'
import type { SubsidyListBaseProps, SubsidyListConfig } from './SubsidyListBase'
import * as api from '../api'

export default function PreApplyList(props: Omit<SubsidyListBaseProps, 'config'>) {
  const [converting, setConverting] = useState(false)

  const config: SubsidyListConfig = {
    apiBase: '/api/subsidies/applications',
    importTitle: '导入预申请',
    exportPrefix: '预申请列表',
    batchImportEndpoint: '/api/subsidies/applications/batch-import',
    onExport: (id: number) => api.exportApplications(id),

    // 预检回调
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
      const checkPayload = {
        subsidy_type_id: props.subsidyType.id, year: props.subsidyType.subsidy_year,
        rows: mappedRows.map(r => ({ id_card: String(r.id_card || r['身份证号*'] || r['身份证号'] || ''), real_name: String(r.real_name || r['姓名*'] || r['姓名'] || ''), apply_area: Number(r.apply_area || 0), _row_index: r._row_index })),
      }
      const chk = await fetch('/api/eligibility/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checkPayload),
      }).then(r => r.json()) as {
        passed_list: Array<{ id_card: string; id_card_masked: string; real_name: string; issues: string[]; warnings: string[]; _row_index?: number }>
        failed_list: Array<{ id_card: string; id_card_masked: string; real_name: string; issues: string[]; _row_index?: number }>
        warning_list: Array<{ id_card: string; id_card_masked: string; real_name: string; warnings: string[]; _row_index?: number }>
      }
      return {
        passed_rows: (chk.passed_list || []).map(r => r._row_index).filter(i => i != null) as number[],
        failed_rows: (chk.failed_list || []).map(r => ({ index: r._row_index ?? 0, real_name: r.real_name, id_card_masked: r.id_card_masked, issues: r.issues })),
        warning_rows: (chk.warning_list || []).map(r => ({ index: r._row_index ?? 0, real_name: r.real_name, id_card_masked: r.id_card_masked, warnings: r.warnings })),
      }
    },

    // 转为发放按钮
    extraToolbar: ({ selectedIds, load, show }) => {
      if (selectedIds.length === 0) return null

      const batchConvertToPayment = async () => {
        if (!confirm(`将选中 ${selectedIds.length} 条预申请记录转为发放记录？\n\n已存在的发放记录将自动跳过。`)) return
        setConverting(true)
        try {
          const response = await fetch('/api/subsidies/applications/convert-to-payment', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ application_ids: selectedIds }),
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.detail || '转换失败')
          show(`✓ ${data.message}`)
          props.setSelectedIds([])
          load()
        } catch (error) {
          show('转换失败: ' + (error as Error).message, 'err')
        } finally {
          setConverting(false)
        }
      }

      return (
        <button onClick={batchConvertToPayment} disabled={converting}
          className="text-xs border-2 border-green-500 bg-green-500 text-white px-2.5 py-1 rounded hover:bg-green-600 hover:border-green-600 shadow-sm transition-all font-medium whitespace-nowrap disabled:opacity-50">
          {converting ? '转换中…' : `→ 转为发放 (${selectedIds.length})`}
        </button>
      )
    },
  }

  return <SubsidyListBase {...props} config={config} />
}
