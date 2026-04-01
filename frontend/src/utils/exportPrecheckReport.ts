/**
 * 预检报告导出工具（调用后端API）
 * 用于 PreCheckPage 和 SubsidyProjectsPage 的预检结果导出
 */
import type { CheckResult } from '../types'

/**
 * 导出预检报告到 Excel（通过后端API，使用 openpyxl 生成，样式更美观）
 * @param result 预检结果
 * @param fileName 文件名（不含扩展名和日期）
 */
export async function exportPrecheckReport(result: CheckResult, fileName = '预检查报告') {
  try {
    const response = await fetch('/api/precheck/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result,
        file_name: fileName
      })
    })

    if (!response.ok) {
      throw new Error('导出失败')
    }

    // 从响应头获取文件名
    const contentDisposition = response.headers.get('Content-Disposition')
    let downloadFileName = `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch && filenameMatch[1]) {
        downloadFileName = filenameMatch[1].replace(/['"]/g, '')
      }
    }

    // 创建下载链接
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = downloadFileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('导出失败:', error)
    alert('导出失败，请重试')
  }
}