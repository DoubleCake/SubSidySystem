/**
 * v2 页面通用图标封装
 *
 * 复用 src/components/Icon.tsx 的内置 SVG 集，统一描边与配色，
 * 让主体管理各页面的按钮、表头、卡片标题都带图标。
 */
import BaseIcon, { type IconName } from '../../components/Icon'

export type V2IconName = IconName

/** 默认（中性灰）图标 */
export function Ico({ name, size = 13, className = '' }: { name: V2IconName; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size }}>
      <BaseIcon name={name} size={size} />
    </span>
  )
}

/** 表头小图标（更浅，配合 10px 表头文字） */
export function ThIco({ name }: { name: V2IconName }) {
  return (
    <span className="inline-flex items-center mr-1 opacity-55 align-[-1px]">
      <BaseIcon name={name} size={10} />
    </span>
  )
}

/** 卡片标题图标（绿色圆形底） */
export function CardIco({ name }: { name: V2IconName }) {
  return (
    <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-[5px] bg-[#E2EDE6] text-[#2F5C46] mr-1.5">
      <BaseIcon name={name} size={11} />
    </span>
  )
}
