import { useState } from 'react'
import { Building2, CheckCircle, Minus, Plus } from 'lucide-react'
import FieldOfView from './FieldOfView'
import OptionCard from './OptionCard'
import { SummaryBar, SummarySidebar } from './QuoteSummary'
import HowItWorks from './HowItWorks'
import QuoteForm from './QuoteForm'
import type { Acquisition, QuoteConfig } from '@/lib/constructionPricing'
import {
  FOREVER_VIDEO_MONTHLY,
  MAX_CAMERAS,
  MIN_CAMERAS,
  WEATHER_STATION_MONTHLY,
  WEATHER_STATION_UPFRONT,
  acquisitions,
  clampCameras,
  defaultConfig,
  formatUSD,
  getStyle,
  internetOptions,
  lowestPrices,
  plans,
  styleFromPrice,
  styles,
} from '@/lib/constructionPricing'

/**
 * The construction quote builder: six steps on one page, a running estimate,
 * "How it works" written from the picks and the contact form that sends it
 * all. One configuration, times a camera count; nothing leaves the browser
 * until the form is submitted.
 */
export default function QuoteBuilder() {
  const [config, setConfig] = useState<QuoteConfig>(defaultConfig)
  const set = (patch: Partial<QuoteConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }))

  return (
    <>
      <section
        id="builder"
        aria-labelledby="builder-heading"
        className="scroll-mt-20"
      >
        <h2 id="builder-heading" className="text-center">
          Build your quote
        </h2>
        <p className="mx-auto max-w-2xl text-center">
          Pick a plan, a camera, internet and add-ons. The estimate updates as
          you go, and you can send the whole setup to us at the end.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <div className="space-y-14">
              <PlanStep config={config} set={set} />
              <CameraStep config={config} set={set} />
              <StyleStep config={config} set={set} />
              <ResolutionStep config={config} set={set} />
              <InternetStep config={config} set={set} />
              <AddOnsStep config={config} set={set} />
            </div>
            <SummaryBar config={config} />
          </div>
          <SummarySidebar config={config} />
        </div>
      </section>

      <HowItWorks config={config} />

      <section
        id="quote"
        aria-labelledby="quote-heading"
        className="mx-auto max-w-3xl scroll-mt-24"
      >
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-accent">
            <Building2 size={18} />
          </div>
          <h2 id="quote-heading">Make it happen</h2>
          <p className="mb-0">
            Send us your setup and your details, and we will get back to you
            with a quote.
          </p>
        </div>
        <QuoteForm config={config} />
      </section>
    </>
  )
}

interface StepProps {
  config: QuoteConfig
  set: (patch: Partial<QuoteConfig>) => void
}

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-4 w-full">
        <span className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-sm font-semibold text-accent">
            {n}
          </span>
          <span className="font-display text-xl font-bold text-text sm:text-2xl">
            {title}
          </span>
        </span>
        {hint && (
          <span className="mt-1.5 block text-sm text-subtext0">{hint}</span>
        )}
      </legend>
      {children}
    </fieldset>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-display text-lg leading-snug font-semibold text-text">
      {children}
    </span>
  )
}

function Body({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-sm text-subtext0">{children}</span>
}

function PriceLine({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-auto block border-t border-overlay0 pt-3 text-sm font-medium text-text">
      {children}
    </span>
  )
}

function PlanStep({ config, set }: StepProps) {
  return (
    <Step n={1} title="Plan" hint="Priced per camera, per month.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {plans.map((p) => (
          <OptionCard
            key={p.id}
            type="radio"
            name="plan"
            value={p.id}
            checked={config.plan === p.id}
            onChange={() => set({ plan: p.id })}
          >
            <span className="flex flex-wrap items-center gap-2">
              <Title>{p.name}</Title>
              {p.featured && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[0.65rem] font-semibold tracking-wider text-accent uppercase">
                  Most popular
                </span>
              )}
            </span>
            <span className="mt-2 mb-4 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-sm text-subtext0">from</span>
              <span className="font-display text-4xl leading-none font-extrabold text-text">
                {formatUSD(p.monthly)}
              </span>
              <span className="text-sm text-subtext0">per camera / month</span>
            </span>
            {p.lead && (
              <span className="mb-2 block text-sm font-medium text-text">
                {p.lead}
              </span>
            )}
            <span className="block space-y-2">
              {p.features.map((f) => (
                <span key={f} className="flex items-start gap-2">
                  <CheckCircle
                    size={16}
                    className="mt-0.5 shrink-0 text-accent"
                  />
                  <span className="text-sm text-subtext0">{f}</span>
                </span>
              ))}
            </span>
          </OptionCard>
        ))}
      </div>
    </Step>
  )
}

function CameraStep({ config, set }: StepProps) {
  const low = lowestPrices()
  const priceFor = (id: Acquisition) =>
    id === 'rent'
      ? `Cameras from ${formatUSD(low.rent)} / month`
      : id === 'buy'
        ? `Cameras from ${formatUSD(low.buy)}`
        : 'No camera cost'
  const cameras = clampCameras(config.cameras)
  return (
    <Step n={2} title="Camera" hint="Buy it, rent it, or use one you have.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {acquisitions.map((a) => (
          <OptionCard
            key={a.id}
            type="radio"
            name="acquisition"
            value={a.id}
            checked={config.acquisition === a.id}
            onChange={() => set({ acquisition: a.id })}
          >
            <Title>{a.title}</Title>
            <Body>{a.text}</Body>
            <span className="mt-3 block" />
            <PriceLine>{priceFor(a.id)}</PriceLine>
          </OptionCard>
        ))}
      </div>

      <div
        role="group"
        aria-labelledby="camera-count-label"
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-overlay0 bg-surface0 px-4 py-3 sm:px-5"
      >
        <div className="min-w-0">
          <div
            id="camera-count-label"
            className="text-sm font-semibold text-text"
          >
            Number of cameras
          </div>
          <div className="text-xs text-subtext0">
            Every camera gets the same setup. Up to {MAX_CAMERAS} here; ask us
            for more.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StepperButton
            label="One camera fewer"
            disabled={cameras <= MIN_CAMERAS}
            onClick={() => set({ cameras: clampCameras(cameras - 1) })}
          >
            <Minus size={16} />
          </StepperButton>
          <output
            aria-live="polite"
            aria-label={`${cameras} ${cameras === 1 ? 'camera' : 'cameras'}`}
            className="w-10 text-center font-display text-xl font-extrabold text-text tabular-nums"
          >
            {cameras}
          </output>
          <StepperButton
            label="One camera more"
            disabled={cameras >= MAX_CAMERAS}
            onClick={() => set({ cameras: clampCameras(cameras + 1) })}
          >
            <Plus size={16} />
          </StepperButton>
        </div>
      </div>
    </Step>
  )
}

function StepperButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-overlay0 text-text transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-overlay0"
    >
      {children}
    </button>
  )
}

function NotNeeded() {
  return (
    <div className="rounded-xl border border-dashed border-overlay0 px-4 py-4 text-sm text-subtext0 sm:px-5">
      Not needed when you bring your own camera.
    </div>
  )
}

function StyleStep({ config, set }: StepProps) {
  const own = config.acquisition === 'own'
  const mode = config.acquisition === 'buy' ? 'buy' : 'rent'
  return (
    <Step
      n={3}
      title="Style"
      hint={
        own
          ? undefined
          : 'What the camera sees. All video cameras are Axis network cameras.'
      }
    >
      {own ? (
        <NotNeeded />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {styles.map((s) => {
            const from = styleFromPrice(s.id, mode)
            return (
              <OptionCard
                key={s.id}
                type="radio"
                name="style"
                value={s.id}
                checked={config.style === s.id}
                onChange={() =>
                  set({
                    style: s.id,
                    resolution: getStyle(s.id).resolutions[0].id,
                  })
                }
              >
                <FieldOfView kind={s.id} />
                <span className="mt-3 block">
                  <Title>{s.title}</Title>
                </span>
                <Body>{s.sees}</Body>
                <span className="mt-2 mb-3 block text-sm text-subtext0">
                  <span className="font-medium text-text">Best for:</span>{' '}
                  {s.bestFor}
                  <span className="mt-1 block">
                    <span className="font-medium text-text">Good to know:</span>{' '}
                    {s.goodToKnow}
                  </span>
                </span>
                <PriceLine>
                  {mode === 'buy'
                    ? `Buy from ${formatUSD(from)}`
                    : `Rent from ${formatUSD(from)} / month`}
                </PriceLine>
              </OptionCard>
            )
          })}
        </div>
      )}
    </Step>
  )
}

function ResolutionStep({ config, set }: StepProps) {
  const own = config.acquisition === 'own'
  const style = getStyle(config.style)
  const buy = config.acquisition === 'buy'
  return (
    <Step
      n={4}
      title="Resolution"
      hint={own ? undefined : `The options for ${style.title}.`}
    >
      {own ? (
        <NotNeeded />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {style.resolutions.map((r) => (
            <OptionCard
              key={r.id}
              type="radio"
              name="resolution"
              value={r.id}
              checked={config.resolution === r.id}
              onChange={() => set({ resolution: r.id })}
            >
              <Title>{r.label}</Title>
              <span className="mt-3 block" />
              <PriceLine>
                {buy
                  ? `Buy from ${formatUSD(r.buy)}`
                  : `Rent from ${formatUSD(r.rent)} / month`}
              </PriceLine>
            </OptionCard>
          ))}
        </div>
      )}
    </Step>
  )
}

function InternetStep({ config, set }: StepProps) {
  return (
    <Step n={5} title="Internet">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {internetOptions.map((i) => (
          <OptionCard
            key={i.id}
            type="radio"
            name="internet"
            value={i.id}
            checked={config.internet === i.id}
            onChange={() => set({ internet: i.id })}
          >
            <Title>{i.title}</Title>
            <Body>{i.text}</Body>
            <span className="mt-3 block" />
            <PriceLine>
              {i.monthly > 0
                ? `Starting at ${formatUSD(i.monthly)} / month per site`
                : 'No internet charge'}
            </PriceLine>
          </OptionCard>
        ))}
      </div>
    </Step>
  )
}

function AddOnsStep({ config, set }: StepProps) {
  const premium = config.plan === 'premium'
  return (
    <Step n={6} title="Add-ons" hint="Optional. Pick any, or none.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <OptionCard
          type="checkbox"
          name="forever-video"
          value="forever-video"
          checked={config.foreverVideo}
          onChange={() => set({ foreverVideo: !config.foreverVideo })}
        >
          <Title>Forever video</Title>
          <Body>Keep every recorded day permanently, on any plan.</Body>
          <span className="mt-3 block" />
          <PriceLine>
            +{formatUSD(FOREVER_VIDEO_MONTHLY)} per camera / month
          </PriceLine>
        </OptionCard>
        <OptionCard
          type="checkbox"
          name="weather-station"
          value="weather-station"
          checked={config.weatherStation}
          onChange={() => set({ weatherStation: !config.weatherStation })}
        >
          <Title>On-site weather station</Title>
          <Body>
            A weather station at your site, with its readings in your dashboard.
          </Body>
          <span className="mt-3 block" />
          <PriceLine>
            {premium
              ? 'Service included with Premium'
              : `+${formatUSD(WEATHER_STATION_MONTHLY)} / month per site`}
            <span className="block font-normal text-subtext0">
              Station {formatUSD(WEATHER_STATION_UPFRONT)} one-time
            </span>
          </PriceLine>
        </OptionCard>
      </div>
    </Step>
  )
}
