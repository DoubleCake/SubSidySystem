import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// ═══════════════════════════════════════════
// 覆盖 window.fetch — 所有 HTTP 请求自动转为 IPC 调用
// 已有页面无需改代码，fetch('/api/xxx') 自动走 Electron IPC
// ═══════════════════════════════════════════
const _originalFetch = window.fetch.bind(window)

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  // 仅拦截 /api/ 路径的请求
  if (!url.includes('/api/')) {
    return _originalFetch(input, init)
  }

  const method = (init?.method || 'GET').toUpperCase()
  let body: unknown = undefined
  if (init?.body) {
    try { body = JSON.parse(init.body as string) } catch { body = init.body }
  }

  try {
    // URL → IPC channel 转换
    const urlObj = new URL(url, 'http://localhost')
    const path = urlObj.pathname
    const query: Record<string, string> = {}
    urlObj.searchParams.forEach((v, k) => { query[k] = v })

    // 提取路径段: /api/farmers/batch-import → farmers:batchImport
    const segments = path.replace(/^\/api\//, '').split('/')
    const channel = segments.map((s, i) => i === 0 ? s : s.replace(/-(\d+)$/, ':get')).join(':')

    // 构造数据
    let data: unknown = body
    if (method === 'GET') {
      data = Object.keys(query).length > 0 ? query : undefined
    } else if (method === 'DELETE') {
      data = body || (segments.length > 1 ? { id: parseInt(segments[segments.length - 1]) } : undefined)
    }

    const result = await window.electronAPI.invoke(channel, data)

    // 兼容 IPC 返回格式 { code: 0, data: ... } 和直接返回
    const responseBody = result && typeof result === 'object' && 'code' in result
      ? (result as any).data ?? result
      : result

    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
      blob: async () => new Blob([JSON.stringify(responseBody)]),
      headers: new Headers(),
      redirected: false,
      statusText: 'OK',
      type: 'basic' as ResponseType,
      url: url,
    } as Response
  } catch (err) {
    console.error(`[IPC fetch] ${method} ${url} 失败:`, err)
    return {
      ok: false,
      status: 500,
      json: async () => ({ detail: String(err) }),
      text: async () => String(err),
      blob: async () => new Blob([String(err)]),
      headers: new Headers(),
      redirected: false,
      statusText: 'Internal Error',
      type: 'basic' as ResponseType,
      url: url,
    } as Response
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
