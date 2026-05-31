import { useEffect } from 'react'
import Icon from './Icon'

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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16 px-4">
      <div className="bg-white rounded-card shadow-card flex flex-col max-h-[80vh] overflow-hidden"
        style={{ width: Math.min(width, window.innerWidth - 32) }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="font-bold text-text-primary text-card-title">{title}</h3>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:bg-red-50 hover:text-red-500 transition-all">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 flex-1">{children}</div>
        {onConfirm && (
          <div className="flex justify-end gap-3 px-5 py-3 border-t border-border shrink-0">
            <button onClick={onClose}
              className="px-4 py-1.5 text-body border-2 border-red-200 rounded-btn text-red-600 hover:bg-red-50 hover:border-red-300 transition-all font-medium">
              取消
            </button>
            <button onClick={onConfirm}
              className="px-4 py-1.5 text-body bg-primary-500 text-white rounded-btn hover:bg-primary-400 transition-all flex items-center gap-1.5 font-medium shadow-sm">
              <Icon name="confirm" size={14} />
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
