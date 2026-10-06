import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import Eyebrow from '@/components/ui/Eyebrow'
import SectionHead from '@/components/ui/SectionHead'
import RuledGrid, { RuledCell } from '@/components/ui/RuledGrid'
import DataTable from '@/components/ui/DataTable'
import LiveBadge from '@/components/LiveBadge'
import { buttonClasses } from '@/components/Button'
import { formatUSD, lowestPrices, plans } from '@/lib/constructionPricing'

const includedItems = [
  {
    title: 'Private live view',
    text: 'Only your team can see the stream.',
  },
  {
    title: 'Command center',
    text: 'Every one of your cameras on one screen.',
  },
  {
    title: 'Time-lapse every 15 minutes',
    text: 'A still is captured every 15 minutes, with an archive you can browse by day.',
  },
  {
    title: 'Site conditions',
    text: 'Weather, satellite-detected lightning and NWS alerts for your site. The lightning data is informational only.',
  },
  {
    title: 'Invite your team',
    text: 'Add the people who need to watch the site.',
  },
  {
    title: 'Optional public page',
    text: 'If you want the exposure, your camera can also get a public page on NationCam.',
  },
]

/** Section wrapper: the draft's measure column and section rhythm. */
export function Section({
  id,
  labelledBy,
  label,
  children,
}: {
  id?: string
  labelledBy?: string
  label?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      aria-label={label}
      className="measure section-y scroll-mt-16"
    >
      {children}
    </section>
  )
}

/**
 * Illustrative command-center screen. The current page has no hero visual,
 * so this is a drawn mock built from the theme tokens, labelled as such.
 */
function CommandCenterMock() {
  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label="Illustrative command center screen: four camera stills on one screen, with time-lapse, site conditions and team rows"
        className="glow-accent overflow-hidden rounded-xl bg-surface0"
      >
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5 font-mono text-[11px] leading-none tracking-[0.02em] text-label uppercase">
          <span className="mr-1.5 inline-flex gap-[5px]" aria-hidden="true">
            <i className="block h-2 w-2 rounded-full bg-overlay1" />
            <i className="block h-2 w-2 rounded-full bg-overlay1" />
            <i className="block h-2 w-2 rounded-full bg-overlay1" />
          </span>
          Command center
          <span className="ml-auto">4 cameras</span>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="bg-surface0">
              <div
                className="relative aspect-video overflow-hidden"
                style={{
                  background:
                    'linear-gradient(to bottom, transparent 0 58%, var(--color-overlay1) 58% calc(58% + 1px), transparent calc(58% + 1px)), linear-gradient(to bottom, var(--color-surface1) 0 58%, var(--color-surface2) 58% 100%)',
                }}
              >
                <LiveBadge className="absolute top-2 left-2" />
              </div>
              <div className="flex justify-between px-2.5 py-2 font-mono text-[11px] leading-none text-subtext1">
                <span>Camera {n}</span>
                <span>Private</span>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 border-t border-border">
          {[
            ['Time-lapse', 'Every 15 min'],
            ['Conditions', 'Weather, NWS'],
            ['Team', 'Invited'],
          ].map(([k, v]) => (
            <div
              key={k}
              className="px-3 py-2.5 shadow-[1px_0_0_var(--color-border)]"
            >
              <div className="font-mono text-[10px] leading-none tracking-[0.02em] text-label uppercase">
                {k}
              </div>
              <div className="mt-1.5 text-[13px] leading-tight font-medium text-text">
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-subtext1">
        Illustrative screen, not a real product screenshot.
      </figcaption>
    </figure>
  )
}

export function ConstructionHero() {
  const low = lowestPrices()
  const prices: Array<{ k: string; v: number; unit: string }> = [
    { k: 'Plans', v: low.plan, unit: '/ camera / month' },
    { k: 'Rent a camera', v: low.rent, unit: '/ month' },
    { k: 'Buy a camera', v: low.buy, unit: 'one-time' },
  ]
  return (
    <div className="measure pt-[72px]">
      <div className="grid grid-cols-1 items-center gap-12 min-[960px]:grid-cols-2 min-[960px]:gap-16">
        <div>
          <div
            aria-hidden="true"
            className="mb-7 h-[3px] w-16 bg-linear-to-r from-accent to-accent-hover"
          />
          <Eyebrow variant="pill">Construction cameras</Eyebrow>
          <h1 className="text-h1 text-text">
            See your job site{' '}
            <span className="text-accent-fg">from anywhere</span>
          </h1>
          <p className="mt-5 max-w-measure text-lede text-subtext1">
            Live view, time-lapse and a private dashboard for your team.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#builder"
              className={buttonClasses({
                variant: 'primary',
                size: 'marketing',
                className: 'max-[480px]:w-full',
              })}
            >
              Build your quote
              <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a
              href="#compare"
              className={buttonClasses({
                variant: 'secondary',
                size: 'marketing',
                className: 'max-[480px]:w-full',
              })}
            >
              Compare plans
            </a>
          </div>
        </div>
        <CommandCenterMock />
      </div>

      <div className="mt-16" role="group" aria-label="Starting prices">
        <RuledGrid cols={1} className="sm:grid-cols-3">
          {prices.map((p) => (
            <RuledCell key={p.k}>
              <div className="mono-label">{p.k}</div>
              <div className="mt-3.5 font-display text-[32px] leading-none font-bold tracking-tight text-text">
                <span className="mr-1.5 font-sans text-sm font-normal tracking-normal text-subtext1">
                  from
                </span>
                <span className="text-accent-fg">{formatUSD(p.v)}</span>
                <small className="ml-1 font-sans text-sm font-normal tracking-normal text-subtext1">
                  {p.unit}
                </small>
              </div>
            </RuledCell>
          ))}
        </RuledGrid>
      </div>
    </div>
  )
}

export function IncludedSection() {
  return (
    <Section labelledBy="included-heading">
      <SectionHead
        id="included-heading"
        number="01"
        eyebrow="Included"
        title="Every camera includes"
        body="On every plan, whichever camera you pick."
      />
      <RuledGrid as="ul" cols={3}>
        {includedItems.map((item, i) => (
          <RuledCell
            key={item.title}
            as="li"
            index={String(i + 1).padStart(2, '0')}
            title={item.title}
          >
            <p>{item.text}</p>
          </RuledCell>
        ))}
      </RuledGrid>
    </Section>
  )
}

export function ComparePlans() {
  const included = <span className="text-text">Included</span>
  const dash = <span className="text-label">—</span>
  return (
    <Section id="compare" labelledBy="compare-heading">
      <SectionHead
        id="compare-heading"
        number="02"
        eyebrow="Plans"
        title="Compare plans"
        body="The three plans side by side. Priced per camera, per month. Pick one in the builder below."
      />
      <DataTable
        caption="Plan comparison table, scrolls sideways on small screens"
        minWidth={640}
        columns={[
          { key: 'feature', header: 'Feature' },
          ...plans.map((p) => ({
            key: p.id,
            header: p.name,
            sub: `from ${formatUSD(p.monthly)}`,
            highlight: true,
          })),
        ]}
        rows={[
          {
            key: 'live',
            cells: [
              'Private live view and command center',
              included,
              included,
              included,
            ],
          },
          {
            key: 'users',
            cells: ['Unlimited team users', included, included, included],
          },
          {
            key: 'conditions',
            cells: [
              'Site conditions: weather, satellite-detected lightning, NWS alerts',
              included,
              included,
              included,
            ],
          },
          {
            key: 'timelapse',
            cells: [
              'Time-lapse photo',
              'Every 15 minutes',
              'Every minute',
              'Every minute',
            ],
          },
          {
            key: 'video',
            cells: ['Recorded video', '7 days', '30 days', '90 days'],
          },
          {
            key: 'photos',
            cells: [
              'Photos kept',
              '1 year after the project',
              '3 years',
              'Permanently',
            ],
          },
          {
            key: 'station',
            cells: [
              'On-site weather station service',
              '+$15 / month per site',
              '+$15 / month per site',
              included,
            ],
          },
          {
            key: 'film',
            cells: [
              'Edited time-lapse film at project end',
              dash,
              dash,
              included,
            ],
          },
        ]}
      />
    </Section>
  )
}

const faqs = [
  {
    q: 'Can I use a camera I already have?',
    a: 'Yes. Pick Bring your own. It needs a standard RTSP video stream; we check compatibility with you.',
  },
  {
    q: 'What happens if a rented camera fails?',
    a: 'We swap it. Rented cameras are paid monthly and come back to us when the project wraps up.',
  },
  {
    q: 'Do I need internet at the site?',
    a: 'NationCam can provide it: cellular or satellite internet, managed and remotely supported by us, starting at $60 a month per site. One connection can serve several cameras on the same site. Or use your site connection and pay only for the streaming service.',
  },
  {
    q: 'Who installs the camera?',
    a: 'Each camera needs power at the mounting spot. Depending on where your site is, we install it, or you do with our help.',
  },
  {
    q: 'Who can see the stream?',
    a: 'Only your team. If you want the exposure, your camera can also get a public page on NationCam.',
  },
  {
    q: 'Is the estimate the final price?',
    a: 'Estimate only. Installation is quoted for your site; final pricing is confirmed on the quote call.',
  },
]

export function FaqSection() {
  return (
    <Section labelledBy="faq-heading">
      <div className="grid grid-cols-1 gap-12 min-[900px]:grid-cols-[5fr_7fr] min-[900px]:gap-16">
        <SectionHead
          id="faq-heading"
          number="06"
          eyebrow="Questions"
          title="Before you ask"
          body="The short answers to what people ask before they request a quote."
          stacked
          className="mb-0! self-start"
        />
        <div className="border-t border-border">
          {faqs.map((f) => (
            <details key={f.q} className="group border-b border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-medium text-text transition-colors group-open:text-accent-ink hover:text-accent-ink [&::-webkit-details-marker]:hidden">
                {f.q}
                <span
                  aria-hidden="true"
                  className="font-mono text-lg leading-none font-semibold text-accent-fg before:content-['+'] group-open:before:content-['−']"
                />
              </summary>
              <p className="max-w-[64ch] pb-5 text-sm text-subtext1">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  )
}

/** Free-camera cross-link, at the end of the page. */
export function FreeCameraLink() {
  return (
    <Section label="Free camera">
      <div className="grid grid-cols-1 items-center gap-4 rounded-xl border border-border bg-surface0 p-6 shadow-[inset_3px_0_0_var(--color-accent)] md:grid-cols-[1fr_auto]">
        <div>
          <Eyebrow>Free camera</Eyebrow>
          <p className="mb-0 font-display text-lg leading-snug font-semibold text-text">
            Have a site worth watching? You may qualify for a free NationCam
            camera with a public live view.
          </p>
        </div>
        {/* Plain anchor: /free-camera is added in a separate PR. */}
        <a
          href="/free-camera"
          className={buttonClasses({ variant: 'secondary', size: 'marketing' })}
        >
          See how it works
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    </Section>
  )
}
