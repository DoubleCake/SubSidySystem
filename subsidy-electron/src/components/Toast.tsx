interface ToastProps {
  msg?: string
  type?: 'ok' | 'err'
}

export default function Toast({ msg, type }: ToastProps) {
  if (!msg) return null
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-card shadow-card text-body text-white transition-all
      ${type === 'err' ? 'bg-danger' : 'bg-primary'}`}>
      {msg}
    </div>
  )
}
