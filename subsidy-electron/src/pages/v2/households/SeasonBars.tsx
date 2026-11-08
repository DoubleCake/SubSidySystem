/** 各季面积使用条（超限标红） */
import type { HHDetail } from '../../../types'
export default function SeasonBars({ usage, refArea }: { usage: HHDetail['area_usage'] | undefined; refArea: number }) {
  const seasons = Object.entries(usage?.season_breakdown || {})
  if (seasons.length === 0) return <div className="text-[10.5px] text-text-muted/60 py-2 text-center">暂无面积使用记录</div>
  return (
    <div className="flex flex-col gap-1.5">
      {seasons.map(([season, s]) => {
        const seasonRef = (s as { reference_area?: number }).reference_area ?? refArea
        const used = s.used_area || 0
        const over = used > seasonRef + 0.001
        const pct = seasonRef > 0 ? Math.min(100, Math.round(used / seasonRef * 100)) : 0
        return (
          <div key={season}>
            <div className="flex items-baseline justify-between text-[10.5px]">
              <span className={over ? 'text-danger font-semibold' : 'text-primary font-semibold'}>{season}</span>
              <span className={`font-mono ${over ? 'text-danger font-semibold' : 'text-text-muted'}`}>{used.toFixed(2)} / {seasonRef.toFixed(2)}</span>
            </div>
            <div className="h-[4px] bg-[#E6E0D4] rounded-full mt-1 overflow-hidden">
              <div className={`h-[4px] rounded-full ${over ? 'bg-danger' : 'bg-[#234A38]'}`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            {over && <div className="text-[9.5px] text-danger mt-0.5">超出 {(used - seasonRef).toFixed(2)} 亩</div>}
          </div>
        )
      })}
    </div>
  )
}
