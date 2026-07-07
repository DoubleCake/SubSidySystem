/**
 * 前端内存缓存 — 避免重复 IPC 请求
 * 缓存村庄列表、补贴类型等不常变的数据
 */
import * as api from './api'
import type { SubsidyType } from './types'

interface Cache<T> {
  data: T | null
  promise: Promise<T> | null
  ts: number
}

const CACHE_TTL = 5 * 60 * 1000 // 5分钟过期

function makeCache<T>(fetcher: () => Promise<T>): Cache<T> {
  return { data: null, promise: null, ts: 0 }
}

function loadCache<T>(cache: Cache<T>, fetcher: () => Promise<T>): Promise<T> {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    return Promise.resolve(cache.data)
  }
  if (!cache.promise) {
    cache.promise = fetcher().then(data => {
      cache.data = data
      cache.ts = Date.now()
      cache.promise = null
      return data
    }).catch(err => {
      cache.promise = null
      throw err
    })
  }
  return cache.promise
}

function invalidateCache<T>(cache: Cache<T>) {
  cache.data = null
  cache.promise = null
  cache.ts = 0
}

// ── 缓存实例 ──
export const villageCache = makeCache(() =>
  api.getVillageGroups().then(g => [...new Set(g.map(v => v.village_name))])
)

export const subsidyTypeCache = makeCache<SubsidyType[]>(() =>
  api.getSubsidyTypes()
)

export const siteCache = makeCache(() =>
  api.getExternalSites()
)

export const loadVillages = () => loadCache(villageCache, () =>
  api.getVillageGroups().then(g => [...new Set(g.map(v => v.village_name))])
)

export const loadSubsidyTypes = () => loadCache<SubsidyType[]>(subsidyTypeCache, () =>
  api.getSubsidyTypes()
)

export const loadSites = () => loadCache(siteCache, () =>
  api.getExternalSites()
)

export function invalidateSites() { invalidateCache(siteCache) }
export function invalidateRecordCaches() {} // 统计在 ExternalLinksPage 内按需刷新
