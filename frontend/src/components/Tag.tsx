import { clsx } from 'clsx'

type Color = 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'purple'

const colorMap: Record<Color, string> = {
  green:  'bg-green-50  text-green-700  border border-green-200',
  red:    'bg-red-50    text-red-600    border border-red-200',
  amber:  'bg-amber-50  text-amber-700  border border-amber-200',
  blue:   'bg-blue-50   text-blue-700   border border-blue-200',
  gray:   'bg-gray-100  text-gray-500   border border-gray-200',
  purple: 'bg-purple-50 text-purple-700 border border-purple-200',
}

export default function Tag({ label, color = 'gray' }: { label: string; color?: Color }) {
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded text-xs font-mono whitespace-nowrap', colorMap[color])}>
      {label}
    </span>
  )
}
