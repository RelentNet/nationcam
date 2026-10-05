import {
  ArrowRight,
  CloudSun,
  Gift,
  Globe,
  HardHat,
  LayoutGrid,
  Lock,
  Timer,
  Users,
} from 'lucide-react'
import Reveal from '@/components/Reveal'
import { formatUSD, lowestPrices } from '@/lib/constructionPricing'

const includedItems = [
  {
    icon: Lock,
    title: 'Private live view',
    text: 'Only your team can see the stream.',
  },
  {
    icon: LayoutGrid,
    title: 'Command center',
    text: 'Every one of your cameras on one screen.',
  },
  {
    icon: Timer,
    title: 'Time-lapse every 15 minutes',
    text: 'A still is captured every 15 minutes, with an archive you can browse by day.',
  },
  {
    icon: CloudSun,
    title: 'Site conditions',
    text: 'Weather, satellite-detected lightning and NWS alerts for your site. The lightning data is informational only.',
  },
  {
    icon: Users,
    title: 'Invite your team',
    text: 'Add the people who need to watch the site.',
  },
  {
    icon: Globe,
    title: 'Optional public page',
    text: 'If you want the exposure, your camera can also get a public page on NationCam.',
  },
]

/** Slim strip at the very top of the page pointing at the free-camera offer. */
export function FreeCameraStrip() {
  return (
    <aside
      aria-label="Free camera"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border border-accent/25 bg-accent/5 px-4 py-2.5 text-center text-sm text-text"
    >
      <Gift size={16} className="shrink-0 text-accent" aria-hidden="true" />
      <span>
        Have a site worth watching? You may qualify for a free NationCam camera
        with a public live view.
      </span>
      {/* Plain anchor: /free-camera is added in a separate PR. */}
      <a
        href="/free-camera"
        className="inline-flex items-center gap-1 font-semibold whitespace-nowrap text-accent underline-offset-4 hover:underline"
      >
        See how it works
        <ArrowRight size={14} aria-hidden="true" />
      </a>
    </aside>
  )
}

export function ConstructionHero() {
  const low = lowestPrices()
  return (
    <Reveal>
      <section className="mx-auto max-w-3xl text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
          <HardHat size={14} className="text-accent" />
          <span className="font-mono text-xs font-medium text-accent">
            Construction cameras
          </span>
        </div>
        <h1>See your job site from anywhere</h1>
        <p>Live view, time-lapse and a private dashboard for your team.</p>
        <p className="!mb-4 !text-sm text-subtext0">
          Plans from {formatUSD(low.plan)} per camera a month. Cameras from{' '}
          {formatUSD(low.rent)} a month to rent, or {formatUSD(low.buy)} to buy.
        </p>
        <a
          href="#builder"
          className="mt-2 inline-flex items-center justify-center rounded-lg bg-accent px-8 py-3 font-sans text-[1rem] font-semibold text-crust shadow-md transition-[scale,background-color,box-shadow] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover hover:shadow-lg active:scale-[0.98]"
        >
          Build your quote
        </a>
      </section>
    </Reveal>
  )
}

export function IncludedSection() {
  return (
    <section>
      <Reveal>
        <h2 className="text-center">Every camera includes</h2>
      </Reveal>
      <Reveal stagger>
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {includedItems.map(({ icon: Icon, title, text }) => (
            <li
              key={title}
              className="section-container reveal-scale flex items-start gap-3"
            >
              <Icon size={20} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0">
                <h3 className="!mb-1 !text-[1rem]">{title}</h3>
                <p className="!mb-0 !text-sm text-subtext0">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}
