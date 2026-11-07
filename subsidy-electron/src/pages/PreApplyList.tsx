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

    // 预检在详情页执行（导入只做纯数据入库）

    // 转为发放按钮
    extraToolbar: ({ selectedIds, load, show }) => {
      if (selectedIds.length === 0) return null

      const batchConvertToPayment = async () => {
        if (!confirm(`将选中 ${selectedIds.length} 条预申请记录转为发放记录？\n\n已存在的发放记录将自动跳过。`)) return
        setConverting(true)
        try {
          const res = await window.electronAPI.invoke<{ code: number; data?: { message: string }; message?: string }>(
            'subsidies:convertToPayment', { application_ids: selectedIds }
          )
          if (res?.code !== 0) throw new Error(res?.message || '转换失败')
          show(`✓ ${res?.data?.message || '转换完成'}`)
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
