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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-card shadow-card flex flex-col max-h-[80vh] overflow-hidden"
        style={{ width: Math.min(width, window.innerWidth - 32) }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="font-bold text-text-primary text-card-title">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 flex-1">{children}</div>
        {onConfirm && (
          <div className="flex justify-end gap-3 px-5 py-3 border-t border-border shrink-0">
            <button onClick={onClose}
              className="px-4 py-1.5 text-body border border-border rounded-btn text-text-primary hover:bg-warm/40 transition-colors">
              取消
            </button>
            <button onClick={onConfirm}
              className="px-4 py-1.5 text-body bg-primary text-white rounded-btn hover:bg-primary/90 transition-colors flex items-center gap-1.5">
              <Icon name="confirm" size={14} />
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
