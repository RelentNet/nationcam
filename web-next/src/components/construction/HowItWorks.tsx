import { Info } from 'lucide-react'
import type { QuoteConfig } from '@/lib/constructionPricing'
import { howItWorks, photoCameraNote } from '@/lib/constructionPricing'

/** "How it works", written from the visitor's current picks. */
export default function HowItWorks({ config }: { config: QuoteConfig }) {
  const steps = howItWorks(config)
  const note = photoCameraNote(config)
  return (
    <section aria-labelledby="how-it-works-heading">
      <h2 id="how-it-works-heading" className="text-center">
        How it works
      </h2>
      <p className="mx-auto max-w-2xl text-center">
        Written from the setup you picked above.
      </p>
      <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, i) => (
          <li key={step.title} className="section-container">
            <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 font-mono text-sm font-semibold text-accent">
              {i + 1}
            </span>
            <h3 className="!mb-1 !text-[1rem]">{step.title}</h3>
            <p className="!mb-0 !text-sm text-subtext0">{step.text}</p>
          </li>
        ))}
      </ol>
      {note && (
        <div className="mx-auto mt-4 flex max-w-3xl items-start gap-2 rounded-lg border border-overlay0 px-4 py-3 text-sm text-subtext0">
          <Info size={16} className="mt-0.5 shrink-0 text-accent" />
          <span>{note}</span>
        </div>
      )}
    </section>
  )
}
