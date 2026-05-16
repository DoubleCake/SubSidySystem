interface ResultTableProps {
  title: string
  headers: string[]
  rows: (string | number | React.ReactNode)[][]
  empty?: boolean
  emptyText?: string
}

export default function ResultTable({ title, headers, rows, empty = false, emptyText }: ResultTableProps) {
  if (empty && !rows.length) {
    return (
      <div>
        <div className="px-4 py-3 border-b border-border/50 bg-warm/30 text-sm text-text-primary">
          {title}
        </div>
        <div className="py-12 text-center text-text-muted/50">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-sm">{emptyText || '此类问题为零，很好！'}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="px-4 py-3 border-b border-border/50 bg-warm/30 text-sm text-text-primary">
        {title}
      </div>
      <div className="overflow-auto max-h-96">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white border-b border-border/50">
            <tr>{headers.map(h => <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-semibold whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-warm/30">
                {row.map((cell, j) => <td key={j} className="px-4 py-2.5 text-sm align-top">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
