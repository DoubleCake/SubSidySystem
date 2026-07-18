import { clsx } from 'clsx'

type Color = 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'purple'

const colorMap: Record<Color, string> = {
  green:  'bg-primary-500/10 text-primary border border-primary-500/20',
  red:    'bg-danger/10 text-danger border border-danger/20',
  amber:  'bg-orange-tag/15 text-[#B8860B] border border-orange-tag/25',
  blue:   'bg-blue-50 text-blue-700 border border-blue-200',
  gray:   'bg-warm/60 text-text-muted border border-border',
  purple: 'bg-purple-50 text-purple-700 border border-purple-200',
}

export default function Tag({ label, color = 'gray' }: { label: string; color?: Color }) {
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded-btn text-meta font-mono whitespace-nowrap', colorMap[color])}>
      {label}
    </span>
  )
}
