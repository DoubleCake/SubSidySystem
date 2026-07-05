import { useState, useCallback } from 'react'

interface Toast { msg: string; type: 'ok' | 'err' }

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null)

  const show = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2800)
  }, [])

  return { toast, show }
}
