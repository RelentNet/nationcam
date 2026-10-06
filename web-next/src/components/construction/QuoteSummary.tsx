import { useState } from 'react'
import { ChevronUp } from 'lucide-react'
import type { QuoteConfig } from '@/lib/constructionPricing'
import {
  describeConfig,
  estimateMonthly,
  estimateUpfront,
  formatUSD,
} from '@/lib/constructionPricing'
import { buttonClasses } from '@/components/Button'

const FOOTNOTE =
  'Estimate only. Installation is quoted for your site; final pricing is confirmed on the quote call.'

function SummaryList({ config }: { config: QuoteConfig }) {
  return (
    <dl className="m-0">
      {describeConfig(config).map((line) => (
        <div
          key={line.label}
          className="min-w-0 border-b border-border py-2.5 last:border-b-0"
        >
          <dt className="font-mono text-[11px] leading-none tracking-[0.02em] text-label uppercase">
            {line.label}
          </dt>
          <dd className="m-0 mt-[5px] text-sm leading-[1.45] [overflow-wrap:anywhere] text-text">
            {line.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Sticky sidebar on wide screens. */
export function SummarySidebar({ config }: { config: QuoteConfig }) {
  const monthly = estimateMonthly(config)
  const upfront = estimateUpfront(config)
  return (
    <aside
      aria-label="Your quote summary"
      className="sticky top-[calc(var(--nav-h)+16px)] hidden self-start lg:block"
    >
      <div className="glow-accent overflow-hidden rounded-xl bg-surface0">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <span className="font-display text-body leading-none font-bold tracking-tight text-text">
            Your setup
          </span>
          <span className="mono-label flex items-center gap-2 text-accent-ink before:h-1.5 before:w-1.5 before:rounded-full before:bg-accent before:shadow-[0_0_0_3px_var(--color-accent-glow)] before:content-['']">
            Live
          </span>
        </div>
        <div className="max-h-[calc(100vh-420px)] min-h-32 overflow-y-auto px-5 py-2">
          <SummaryList config={config} />
        </div>
        <div className="border-t-2 border-accent bg-surface1 px-5 py-4">
          <div
            data-estimate="monthly"
            className="flex items-baseline justify-between gap-2"
          >
            <span className="font-mono text-[11px] leading-tight tracking-[0.02em] text-label uppercase">
              Estimated monthly
            </span>
            <span className="font-display text-[28px] leading-none font-extrabold tracking-tight text-accent-fg tabular-nums">
              <span className="mr-1 font-sans text-sm font-normal tracking-normal text-subtext1">
                from
              </span>
              {formatUSD(monthly)}
            </span>
          </div>
          {upfront > 0 && (
            <div
              data-estimate="upfront"
              className="mt-2 flex items-baseline justify-between gap-2"
            >
              <span className="font-mono text-[11px] leading-tight tracking-[0.02em] text-label uppercase">
                Estimated upfront
              </span>
              <span className="font-display text-[28px] leading-none font-extrabold tracking-tight text-accent-fg tabular-nums">
                <span className="mr-1 font-sans text-sm font-normal tracking-normal text-subtext1">
                  from
                </span>
                {formatUSD(upfront)}
              </span>
            </div>
          )}
          <p className="mt-3 mb-0 text-xs leading-[1.45] text-subtext1">
            {FOOTNOTE}
          </p>
        </div>
        <div className="bg-surface1 px-5 pt-0 pb-5">
          <a
            href="#quote"
            className={buttonClasses({
              variant: 'primary',
              size: 'marketing',
              block: true,
            })}
          >
            Send this to NationCam
          </a>
        </div>
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
  const monthly = estimateMonthly(config)
  const upfront = estimateUpfront(config)
  const value =
    'font-display text-xl leading-[1.1] font-extrabold tracking-tight text-accent-fg tabular-nums'
  const from =
    'mr-1 font-sans text-xs font-normal tracking-normal text-subtext1'
  const label =
    'font-mono text-[10px] leading-tight tracking-[0.02em] text-label uppercase'
  return (
    <div
      data-summary-bar
      className="sticky bottom-0 z-30 mt-10 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="overflow-hidden rounded-xl bg-mantle/85 shadow-[0_0_0_1px_var(--color-accent-glow),0_0_24px_-4px_var(--color-accent-glow),0_4px_16px_-4px_rgba(0,0,0,0.3)] backdrop-blur-xl backdrop-saturate-[1.3]">
        {open && (
          <div
            id="quote-summary-details"
            className="max-h-[50vh] overflow-y-auto border-b border-border px-4 py-1"
          >
            <SummaryList config={config} />
          </div>
        )}
        <div className="flex items-center gap-3 px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <div data-estimate="monthly">
                <div className={label}>Monthly</div>
                <div className={value}>
                  <span className={from}>from</span>
                  {formatUSD(monthly)}
                </div>
              </div>
              {upfront > 0 && (
                <div data-estimate="upfront">
                  <div className={label}>Upfront</div>
                  <div className={value}>
                    <span className={from}>from</span>
                    {formatUSD(upfront)}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-subtext1">
              Estimate only. Installation is quoted for your site.
            </div>
          </div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="quote-summary-details"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border-input bg-surface0 px-3 font-sans text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent-ink"
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
