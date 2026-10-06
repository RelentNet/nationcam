import type { ReactNode } from 'react'

interface EyebrowProps {
  children: ReactNode
  /** Section number shown first in accent ink ("01"). Plain variant only. */
  number?: string
  /** `plain` = mono label above a heading; `pill` = the hero's accent pill
   *  with a glowing dot. */
  variant?: 'plain' | 'pill'
  as?: 'p' | 'span' | 'div'
  className?: string
}

/** Mono uppercase eyebrow (12px JetBrains Mono, label colour). */
export default function Eyebrow({
  children,
  number,
  variant = 'plain',
  as: Tag = 'p',
  className = '',
}: EyebrowProps) {
  if (variant === 'pill') {
    return (
      <Tag
        className={`mb-3 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-3.5 py-1.5 font-mono text-xs leading-none font-medium tracking-[0.02em] text-accent-ink uppercase ${className}`}
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_var(--color-accent-glow)]"
        />
        {children}
      </Tag>
    )
  }
  return (
    <Tag
      className={`mono-label mb-3 flex flex-wrap items-center gap-2.5 ${className}`}
    >
      {number && (
        <span className="font-semibold text-accent-ink">{number}</span>
      )}
      {children}
    </Tag>
  )
}
