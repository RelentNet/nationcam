import type { QuoteConfig } from '@/lib/constructionPricing'
import { howItWorks, photoCameraNote } from '@/lib/constructionPricing'
import SectionHead from '@/components/ui/SectionHead'

/**
 * "How it works", written from the visitor's current picks. Renders its head
 * and list for the parent <Section>, which labels itself by the heading id.
 */
export default function HowItWorks({ config }: { config: QuoteConfig }) {
  const steps = howItWorks(config)
  const note = photoCameraNote(config)
  return (
    <>
      <SectionHead
        id="how-it-works-heading"
        number="04"
        eyebrow="Process"
        title="How it works"
        body="Written from the setup you picked above."
      />
      <ol className="m-0 grid list-none grid-cols-1 overflow-hidden rounded-xl border border-border bg-surface0 p-0 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="rule-cell grid min-w-0 grid-cols-[48px_1fr] gap-x-3 gap-y-1 p-6 lg:grid-cols-1 lg:px-5 lg:pb-7"
          >
            <span className="row-span-2 flex items-baseline gap-1.5 font-mono text-xs leading-[1.6] font-semibold whitespace-nowrap text-accent-ink before:inline-block before:h-0.5 before:w-2 before:self-center before:bg-accent before:content-[''] lg:mb-7 lg:row-auto">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="mb-0">{step.title}</h3>
            <p className="mb-0 text-sm leading-[1.55] text-subtext1 col-start-2 lg:col-start-auto">
              {step.text}
            </p>
          </li>
        ))}
      </ol>
      {note && (
        <p className="mt-3 mb-0 rounded-r-md border-l-2 border-accent bg-accent-glow px-4 py-3 text-sm text-text">
          {note}
        </p>
      )}
    </>
  )
}
