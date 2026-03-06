interface Column<T> {
  key: string
  title: string
  width?: number
  render?: (row: T) => React.ReactNode
}

interface Props<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  footer?: string
  rowKey?: (row: T) => string | number
}

export default function Table<T extends Record<string, unknown>>({ columns, data, loading, footer, rowKey }: Props<T>) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-stone-50 border-b-2 border-stone-200">
              {columns.map(c => (
                <th key={c.key} style={c.width ? { width: c.width } : {}}
                  className="px-3.5 py-2.5 text-left text-xs text-stone-400 font-semibold tracking-wide whitespace-nowrap">
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={columns.length} className="text-center py-10 text-stone-400 text-sm">加载中…</td></tr>
            )}
            {!loading && data.length === 0 && (
              <tr><td colSpan={columns.length} className="text-center py-10 text-stone-300 text-sm">暂无数据</td></tr>
            )}
            {!loading && data.map((row, i) => (
              <tr key={rowKey ? rowKey(row) : i}
                className="border-b border-stone-50 hover:bg-stone-50/60 transition-colors">
                {columns.map(c => (
                  <td key={c.key} className="px-3.5 py-2.5 text-sm text-stone-700">
                    {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && (
        <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100 bg-stone-50/50">{footer}</div>
      )}
    </div>
  )
}
