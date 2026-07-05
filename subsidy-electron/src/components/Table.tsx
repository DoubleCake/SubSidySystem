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
    <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-warm/40 border-b-2 border-border">
              {columns.map(c => (
                <th key={c.key} style={c.width ? { width: c.width } : {}}
                  className="px-3.5 py-2.5 text-left text-meta text-text-muted font-semibold tracking-wide whitespace-nowrap">
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={columns.length} className="text-center py-10 text-text-muted text-body">加载中…</td></tr>
            )}
            {!loading && data.length === 0 && (
              <tr><td colSpan={columns.length} className="text-center py-10 text-text-muted/50 text-body">暂无数据</td></tr>
            )}
            {!loading && data.map((row, i) => (
              <tr key={rowKey ? rowKey(row) : i}
                className="border-b border-border/50 hover:bg-warm/20 transition-colors">
                {columns.map(c => (
                  <td key={c.key} className="px-3.5 py-2.5 text-body text-text-primary">
                    {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && (
        <div className="px-4 py-2 text-meta text-text-muted border-t border-border bg-warm/20">{footer}</div>
      )}
    </div>
  )
}
