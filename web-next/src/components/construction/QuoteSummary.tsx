import { useState } from 'react'
import { ChevronUp } from 'lucide-react'
import type { QuoteConfig } from '@/lib/constructionPricing'
import {
  describeConfig,
  estimateMonthly,
  estimateUpfront,
  formatUSD,
} from '@/lib/constructionPricing'

const FOOTNOTE =
  'Estimate only. Installation is quoted for your site; final pricing is confirmed on the quote call.'

function SummaryList({ config }: { config: QuoteConfig }) {
  return (
    <dl className="space-y-2.5">
      {describeConfig(config).map((line) => (
        <div key={line.label} className="min-w-0">
          <dt className="font-mono text-[0.7rem] font-semibold tracking-widest text-subtext0 uppercase">
            {line.label}
          </dt>
          <dd className="text-sm break-words text-text">{line.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Estimate({
  monthly,
  upfront,
  compact = false,
}: {
  monthly: number
  upfront: number
  compact?: boolean
}) {
  const big = compact
    ? 'font-display text-lg font-extrabold text-text'
    : 'font-display text-2xl font-extrabold text-text'
  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-2'}>
      <div
        data-estimate="monthly"
        className="flex flex-wrap items-baseline gap-x-2 text-sm text-subtext0"
      >
        <span>Estimated monthly:</span>
        <span className={big}>from {formatUSD(monthly)}</span>
      </div>
      {upfront > 0 && (
        <div
          data-estimate="upfront"
          className="flex flex-wrap items-baseline gap-x-2 text-sm text-subtext0"
        >
          <span>Estimated upfront:</span>
          <span className={big}>from {formatUSD(upfront)}</span>
        </div>
      )}
    </div>
  )
}

/** Sticky sidebar on wide screens. */
export function SummarySidebar({ config }: { config: QuoteConfig }) {
  return (
    <aside aria-label="Your quote summary" className="hidden lg:block">
      <div className="section-container sticky top-20 max-h-[calc(100vh-6rem)] space-y-5 overflow-y-auto">
        <div className="font-display text-xl font-bold text-text">
          Your setup
        </div>
        <SummaryList config={config} />
        <div className="space-y-2 border-t border-overlay0 pt-4">
          <Estimate
            monthly={estimateMonthly(config)}
            upfront={estimateUpfront(config)}
          />
          <div className="text-xs text-overlay2">{FOOTNOTE}</div>
        </div>
        <a
          href="#quote"
          className="inline-flex w-full items-center justify-center rounded-lg bg-accent px-6 py-2.5 font-sans text-sm font-semibold text-crust shadow-md transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
        >
          Send this to NationCam
        </a>
      </div>
    </aside>
  )
}

/**
 * Compact bar for phones and tablets. It is sticky to the bottom of the
 * builder column only, so once the builder is scrolled past it settles at the
 * end of the steps and never sits over the contact form.
 */
export function SummaryBar({ config }: { config: QuoteConfig }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      data-summary-bar
      className="sticky bottom-0 z-30 mt-10 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="overflow-hidden rounded-xl border border-overlay0 bg-surface0 shadow-2xl">
        {open && (
          <div
            id="quote-summary-details"
            className="max-h-[50vh] space-y-4 overflow-y-auto border-b border-overlay0 p-4"
          >
            <div className="font-display text-lg font-bold text-text">
              Your setup
            </div>
            <SummaryList config={config} />
          </div>
        )}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <Estimate
              compact
              monthly={estimateMonthly(config)}
              upfront={estimateUpfront(config)}
            />
            <div className="mt-1 text-[0.7rem] leading-snug text-overlay2">
              {FOOTNOTE}
            </div>
          </div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="quote-summary-details"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-overlay0 px-3 py-2 font-sans text-sm font-medium text-text transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {open ? 'Hide' : 'Details'}
            <ChevronUp
              size={16}
              className={`transition-transform ${open ? '' : 'rotate-180'}`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
