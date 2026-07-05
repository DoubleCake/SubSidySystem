/**
 * IPC fetch 适配器
 * 将 HTTP fetch 风格的调用自动转换为 IPC 调用
 * 用于批量修复仍使用 fetch() 的页面
 *
 * 用法：
 *   import { ipcFetch as fetch } from '../utils/ipc-fetch'
 *   或直接替换文件中的 fetch 调用:
 *   const r = await ipcFetch('/api/farmers?page=1')
 *   const r = await ipcFetch('/api/farmers', { method: 'POST', body: JSON.stringify(data) })
 */

// URL → IPC channel 映射表
const URL_TO_CHANNEL: Record<string, { get: string; post?: string; put?: string; delete?: string }> = {
  '/api/farmers': { get: 'farmers:list', post: 'farmers:create' },
  '/api/settings/village-groups': { get: 'settings:createVillageGroup', post: 'settings:createVillageGroup' },
  '/api/households/group-options': { get: 'households:groupOptions' },
  '/api/settings/villages': { get: 'settings:listVillages' },
  '/api/land/all-trusts': { get: 'land:list' },
  '/api/land/search-household': { get: 'land:searchHousehold' },
  '/api/land/search-village': { get: 'land:searchVillage' },
  '/api/large-farmers': { get: 'land:listLargeFarmers' },
  '/api/farmers/match-people': { post: 'farmers:matchPeople' },
  '/api/agri-tasks/village-land-info': { get: 'agri-tasks:villageLandInfo' },
  '/api/eligibility/check': { post: 'eligibility:check' },
}

// 动态路由匹配
const DYNAMIC_ROUTES: { pattern: RegExp; get: string; put?: string; delete?: string }[] = [
  { pattern: /^\/api\/farmers\/(\d+)$/, get: 'farmers:get' },
  { pattern: /^\/api\/large-farmers\/(\d+)\/trusts/, get: 'land:listLargeFarmerTrusts' },
  { pattern: /^\/api\/subsidies\/payments/, get: 'subsidies:listPayments' },
  { pattern: /^\/api\/village-contacts/, get: 'village-contacts:list' },
  { pattern: /^\/api\/project-progress/, get: 'project-progress:list' },
]

export async function ipcFetch(url: string, opts?: RequestInit): Promise<Response> {
  const method = (opts?.method || 'GET').toUpperCase()
  let body: unknown = undefined
  if (opts?.body) {
    try { body = JSON.parse(opts.body as string) } catch { body = opts.body }
  }

  // 解析 URL
  const urlObj = new URL(url, 'http://localhost')
  const path = urlObj.pathname
  const searchParams = Object.fromEntries(urlObj.searchParams)

  // 1) 精确匹配
  const exact = URL_TO_CHANNEL[path]
  if (exact) {
    const channel = method === 'POST' ? (exact.post || exact.get)
      : method === 'PUT' ? (exact.put || exact.get)
      : method === 'DELETE' ? (exact.delete || exact.get)
      : exact.get

    const data = method === 'GET' ? searchParams : body
    const result = await window.electronAPI.invoke(channel, data)
    return ipcResultToResponse(result)
  }

  // 2) 动态路由匹配
  for (const route of DYNAMIC_ROUTES) {
    const m = path.match(route.pattern)
    if (m) {
      const id = parseInt(m[1])
      const channel = method === 'PUT' ? (route.put || route.get)
        : method === 'DELETE' ? (route.delete || route.get)
        : route.get
      const data = method === 'GET' ? id : { id, ...(body as object || {}) }
      const result = await window.electronAPI.invoke(channel, data)
      return ipcResultToResponse(result)
    }
  }

  // 3) 通用 fallback：按路径构造 channel
  // /api/xxx/yyy → xxx:yyy
  const channelFallback = path
    .replace(/^\/api\//, '')
    .replace(/\//g, ':')
    .replace(/-\d+$/, '')  // remove trailing -id
  const data = method === 'GET' ? searchParams : body
  const result = await window.electronAPI.invoke(channelFallback, data)
  return ipcResultToResponse(result)
}

function ipcResultToResponse(result: unknown): Response {
  // 将 IPC 返回值包装成类 Response 对象
  const body = JSON.stringify(result)
  return {
    ok: true,
    status: 200,
    json: async () => result,
    text: async () => body,
  } as Response
}
