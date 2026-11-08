/**
 * 界面开关设置（本地持久化）
 *
 * 目前只有一个：家庭户详情是否显示「异常」分类。
 * 使用 localStorage 保存，跨会话保留；后续可迁移到主进程配置。
 */
import { useCallback, useEffect, useState } from 'react'

const KEY = 'ui.household.showAnomalyTab'

const readFlag = (): boolean => {
  try {
    const v = localStorage.getItem(KEY)
    return v == null ? true : v === '1'
  } catch {
    return true
  }
}

/** 同一个 flag 的订阅者集合，保证设置页改动后其它页面立即同步 */
const listeners = new Set<(v: boolean) => void>()

export function setHouseholdAnomalyTabEnabled(v: boolean) {
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* ignore */ }
  listeners.forEach(fn => fn(v))
}

export function getHouseholdAnomalyTabEnabled(): boolean {
  return readFlag()
}

/** 家庭户详情「异常」分类开关 */
export function useHouseholdAnomalyTab(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(readFlag)

  useEffect(() => {
    const fn = (v: boolean) => setEnabled(v)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  const update = useCallback((v: boolean) => setHouseholdAnomalyTabEnabled(v), [])
  return [enabled, update]
}
