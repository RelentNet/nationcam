import type { ReactNode } from 'react'

interface RuledGridProps {
  children: ReactNode
  /** 1 column always, 2 from sm (640px), or 2 from sm / 3 from lg (1024px). */
  cols?: 1 | 2 | 3
  /** `ul` when the cells are a list (pair with `RuledCell as="li"`). */
  as?: 'div' | 'ul' | 'ol'
  className?: string
}

const colClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
}

/**
 * The 1px-ruled panel: one radius-xl card whose cells are separated by
 * hairlines rather than gaps. Put `RuledCell`s inside.
 */
export default function RuledGrid({
  children,
  cols = 3,
  as: Tag = 'div',
  className = '',
}: RuledGridProps) {
  return (
    <Tag
      className={`grid list-none overflow-hidden rounded-xl border border-border bg-surface0 p-0 ${colClasses[cols]} ${className}`}
    >
      {children}
    </Tag>
  )
}

interface RuledCellProps {
  children?: ReactNode
  /** Index label with the orange tick ("01"). */
  index?: string
  /** Saira 600 16px cell title (rendered as h3). */
  title?: ReactNode
  as?: 'div' | 'li'
  className?: string
}

/** One 24px-padded cell of a RuledGrid. */
export function RuledCell({
  children,
  index,
  title,
  as: Tag = 'div',
  className = '',
}: RuledCellProps) {
  return (
    <Tag className={`rule-cell min-w-0 p-6 ${className}`}>
      {index && (
        <span className="mb-5 flex items-center gap-2 font-mono text-xs leading-none font-medium tracking-[0.02em] text-accent-ink before:inline-block before:h-0.5 before:w-3 before:bg-accent before:content-['']">
          {index}
        </span>
      )}
      {title && <h3 className="mb-1.5">{title}</h3>}
      {children && (
        <div className="text-sm leading-[1.55] text-subtext1 [&_p]:mb-0">
          {children}
        </div>
      )}
    </Tag>
  )
}
