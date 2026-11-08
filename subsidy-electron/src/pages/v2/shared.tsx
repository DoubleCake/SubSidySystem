import { CardIco, type V2IconName as IconName } from './Icons'
/**
 * 主体管理 - 共用组件与常量
 *
 * 统一两栏外壳里的列表行、弹窗、标签样式集中在这里，
 * 农户 / 家庭户 / 大户 / 村组 四个 Tab 复用。
 */
import type { ReactNode } from 'react'

export const FARMER_STATUS_LABEL: Record<number, string> = { 1: '在册', 2: '注销', 3: '迁出', 4: '死亡' }
export const HH_STATUS_LABEL: Record<number, string> = { 1: '在册', 2: '注销', 3: '迁出' }
export const PAY_STATUS_LABEL: Record<number, string> = { 0: '待发放', 1: '发放中', 2: '已发放' }

const AVATAR_TONES = [
  'bg-[#234A38] text-[#DDBE84]',
  'bg-[#FBF3E2] text-[#8A6118]',
  'bg-[#E2EDE6] text-[#234A38]',
  'bg-[#E7EFF4] text-[#1F4F63]',
  'bg-[#F1EDE4] text-[#5C5749]',
]

export const tone = (name: string) =>
  AVATAR_TONES[(name?.charCodeAt(0) || 0) % AVATAR_TONES.length]

export const money = (v: unknown) =>
  `¥${Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 列表行：首行名称 + 标签，次行说明 */
export function ListRow({
  active, onClick, avatar, avatarSquare, name, tags, right, sub, strike,
}: {
  active: boolean
  onClick: () => void
  avatar: string
  avatarSquare?: boolean
  name: string
  tags?: ReactNode
  right?: ReactNode
  sub: ReactNode
  strike?: boolean
}) {
  return (
    <div onClick={onClick}
      className={`cursor-pointer border-b border-[#E6E0D4] transition-colors py-[9px] ${
        active ? 'bg-[#F2F7F4] border-l-[3px] border-l-primary pl-3 pr-2.5' : 'pl-[15px] pr-2.5 hover:bg-[#F2F7F4]'
      }`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-6 h-6 ${avatarSquare ? 'rounded-[5px]' : 'rounded-full'} flex items-center justify-center text-[10px] font-bold shrink-0 ${tone(name)}`}>
            {avatar}
          </span>
          <b className={`text-[12px] truncate ${strike ? 'line-through decoration-[#A81D1D] decoration-[1.5px] opacity-55' : 'text-text-primary'}`}>{name}</b>
          {tags}
        </div>
        {right}
      </div>
      <div className="text-[10px] text-[#7A7466] mt-[3px] pl-[31px] truncate">{sub}</div>
    </div>
  )
}

/** 小标签 */
export function Chip({ children, tone: t = 'green', solid }: { children: ReactNode; tone?: 'green' | 'gray' | 'amber' | 'red'; solid?: boolean }) {
  const soft: Record<string, string> = {
    green: 'bg-[#E2EDE6] text-[#2F5C46]',
    gray: 'bg-[#F1EDE4] text-[#5C5749]',
    amber: 'bg-[#FBF3E2] text-[#8A6118]',
    red: 'bg-[#FCEAE8] text-danger',
  }
  const solidCls: Record<string, string> = {
    green: 'bg-[#2F5C46] text-white',
    gray: 'bg-[#5C5749] text-white',
    amber: 'bg-[#B45309] text-white',
    red: 'bg-[#B91C1C] text-white',
  }
  const cls = (solid ? solidCls : soft)[t]
  return (
    <span className={`text-[9px] rounded-[2px] px-1 shrink-0 ${solid ? 'font-semibold' : ''} ${cls}`}>
      {children}
    </span>
  )
}

/** 字段行 */
export function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[#7A7466] shrink-0">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  )
}

export function Card({ title, icon, extra, children, className = '' }: { title?: ReactNode; icon?: IconName; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`border border-[#E6E0D4] rounded-card px-3 py-2 ${className}`}>
      {(title || extra) && (
        <div className="flex items-center justify-between mb-1.5">
          {typeof title === 'string'
            ? <span className="inline-flex items-center text-[11.5px] font-semibold"><CardIco name={icon || 'info'} />{title}</span>
            : title}
          {extra}
        </div>
      )}
      {children}
    </div>
  )
}
