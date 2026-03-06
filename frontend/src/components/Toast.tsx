interface ToastProps {
  msg?: string
  type?: 'ok' | 'err'
}

export default function Toast({ msg, type }: ToastProps) {
  if (!msg) return null
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white transition-all
      ${type === 'err' ? 'bg-red-600' : 'bg-stone-800'}`}>
      {msg}
    </div>
  )
}
