import type { ReactNode } from 'react'

interface PanelProps {
  children: ReactNode
  /** Accent glow ring (glow-accent) instead of the plain hairline ring. */
  glow?: boolean
  /** 3px orange rule along the top edge (the draft's form card). */
  accentTop?: boolean
  /** Inner padding; `none` for panels whose children bring their own. */
  padding?: 'none' | 'md' | 'lg'
  as?: 'div' | 'section' | 'aside' | 'article' | 'form'
  className?: string
}

const paddings = {
  none: '',
  md: 'p-5',
  lg: 'p-4 sm:p-7',
}

/** radius-xl surface card with a hairline ring, optionally glowing. */
export default function Panel({
  children,
  glow = false,
  accentTop = false,
  padding = 'md',
  as: Tag = 'div',
  className = '',
}: PanelProps) {
  const ring = glow ? 'glow-accent' : 'shadow-[0_0_0_1px_var(--color-border)]'
  return (
    <Tag
      className={`relative overflow-hidden rounded-xl bg-surface0 ${ring} ${paddings[padding]} ${
        accentTop
          ? "before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-accent before:content-['']"
          : ''
      } ${className}`}
    >
      {children}
    </Tag>
  )
}
