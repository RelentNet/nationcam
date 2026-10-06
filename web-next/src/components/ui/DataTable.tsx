import type { ReactNode } from 'react'

export interface DataTableColumn {
  /** Stable key for React. */
  key: string
  header: ReactNode
  /** Mono sub-line under a highlighted header ("$79 / camera / mo"). */
  sub?: ReactNode
  /** Plan-style column head: Saira, ink, orange top rule. */
  highlight?: boolean
}

interface DataTableProps {
  columns: Array<DataTableColumn>
  /** One array of cells per row, in column order. The first cell is the
   *  row label (ink, medium); the rest are muted. */
  rows: Array<{ key: string; cells: Array<ReactNode> }>
  /** Screen-reader caption. */
  caption?: string
  /** Table min-width in px before the wrapper scrolls (default 560). */
  minWidth?: number
  className?: string
}

/**
 * The compare-table: hairline rows, mono uppercase headers, inside a
 * radius-xl card that scrolls horizontally on narrow screens.
 */
export default function DataTable({
  columns,
  rows,
  caption,
  minWidth = 560,
  className = '',
}: DataTableProps) {
  return (
    <div
      className={`overflow-x-auto rounded-xl border border-border bg-surface0 ${className}`}
    >
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) =>
              col.highlight ? (
                <th
                  key={col.key}
                  scope="col"
                  className="border-b border-border p-3 text-left align-bottom font-display text-body leading-[1.2] font-bold tracking-tight text-text shadow-[inset_0_2px_0_var(--color-accent)]"
                >
                  {col.header}
                  {col.sub && (
                    <span className="mono-label mt-1 block leading-[1.4]">
                      {col.sub}
                    </span>
                  )}
                </th>
              ) : (
                <th
                  key={col.key}
                  scope="col"
                  className="mono-label border-b border-border p-3 text-left align-bottom leading-[1.4]"
                >
                  {col.header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="[&:last-child>td]:border-b-0">
              {row.cells.map((cell, i) => (
                <td
                  key={columns[i]?.key ?? i}
                  className={`border-b border-border p-3 align-top ${
                    i === 0 ? 'font-medium text-text' : 'text-subtext1'
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
