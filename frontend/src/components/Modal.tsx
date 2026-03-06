import { useEffect } from 'react'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  onConfirm?: () => void
  confirmText?: string
  width?: number
  children: React.ReactNode
}

export default function Modal({ open, title, onClose, onConfirm, confirmText = '保存', width = 560, children }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden"
        style={{ width: Math.min(width, window.innerWidth - 32) }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 shrink-0">
          <h3 className="font-bold text-stone-800 text-base">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-5 flex-1">{children}</div>
        {onConfirm && (
          <div className="flex justify-end gap-3 px-5 py-3 border-t border-stone-100 shrink-0">
            <button onClick={onClose} className="px-4 py-1.5 text-sm border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50">取消</button>
            <button onClick={onConfirm} className="px-4 py-1.5 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600">{confirmText}</button>
          </div>
        )}
      </div>
    </div>
  )
}
