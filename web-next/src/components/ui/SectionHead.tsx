import type { ReactNode } from 'react'
import Eyebrow from '@/components/ui/Eyebrow'

interface SectionHeadProps {
  /** Mono eyebrow text ("Included"). */
  eyebrow?: ReactNode
  /** Section number in the eyebrow ("01"). */
  number?: string
  title: ReactNode
  /** One or two sentences beside the title (right column from 900px). */
  body?: ReactNode
  /** id for the heading, for `aria-labelledby` on the section. */
  id?: string
  /** Heading level; h2 by default. */
  as?: 'h1' | 'h2'
  /** Stack title and body in one column at every width. */
  stacked?: boolean
  className?: string
}

/**
 * Section header: a hairline rule with an orange 48px lead segment, the mono
 * eyebrow, the h2, and an optional body. Title and body sit side by side
 * (5fr / 6fr) from 900px unless `stacked`.
 */
export default function SectionHead({
  eyebrow,
  number,
  title,
  body,
  id,
  as: Heading = 'h2',
  stacked = false,
  className = '',
}: SectionHeadProps) {
  return (
    <div
      className={`relative mb-10 grid grid-cols-1 gap-x-12 gap-y-3 border-t border-border pt-5 before:absolute before:-top-px before:left-0 before:h-0.5 before:w-12 before:bg-accent before:shadow-[0_0_12px_var(--color-accent-glow)] before:content-[''] ${
        stacked ? '' : 'min-[900px]:grid-cols-[5fr_6fr] min-[900px]:items-end'
      } ${className}`}
    >
      {(eyebrow || number) && (
        <Eyebrow number={number} className="col-span-full mb-0">
          {eyebrow}
        </Eyebrow>
      )}
      <Heading
        id={id}
        className="mb-0 font-display text-h2 font-bold tracking-tight text-balance text-text"
      >
        {title}
      </Heading>
      {body && (
        <div className="max-w-[52ch] text-body leading-[1.55] text-subtext1 [&_p]:mb-0">
          {body}
        </div>
      )}
    </div>
  )
}
