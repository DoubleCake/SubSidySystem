/**
 * IPC 响应格式 — 对应 Python 版 core/response.py
 */

export interface ApiResponse<T = unknown> {
  code: number
  data?: T
  message?: string
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

/**
 * 成功响应
 */
export function success<T>(data: T, message = 'ok'): ApiResponse<T> {
  return { code: 0, data, message }
}

/**
 * 列表响应
 */
export function successList<T>(items: T[], total: number, page = 1, pageSize = 20): { code: number; data: PageResult<T> } {
  return { code: 0, data: { items, total, page, page_size: pageSize } }
}

/**
 * 错误响应
 */
export function errorResponse(message: string, code = 400): ApiResponse {
  return { code, message }
}

/**
 * 从 query string 解析分页参数
 */
export function parsePagination(params: Record<string, unknown>): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, parseInt(String(params.page || '1')) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(String(params.page_size || String(params.pageSize || '20'))) || 20))
  const offset = (page - 1) * pageSize
  return { page, pageSize, offset }
}
