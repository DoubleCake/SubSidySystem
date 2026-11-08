/**
 * 输入防抖 hook
 *
 * 用法：
 *   const [value, setValue] = useState('')
 *   const debounced = useDebouncedValue(value, 300)
 */
import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
