import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import FieldOfView from './FieldOfView'
import OptionCard, { OptionGroup } from './OptionCard'
import { Section } from './ConstructionIntro'
import { SummaryBar, SummarySidebar } from './QuoteSummary'
import HowItWorks from './HowItWorks'
import QuoteForm from './QuoteForm'
import type { Acquisition, QuoteConfig } from '@/lib/constructionPricing'
import SectionHead from '@/components/ui/SectionHead'
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

// Option columns. Three-up groups drop to one column between 1024 and 1180px,
// where the 300px summary takes its share of the row.
const COLS_3 = 'sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3'
const COLS_2 = 'sm:grid-cols-2'

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
      <Section id="builder" labelledBy="builder-heading">
        <SectionHead
          id="builder-heading"
          number="03"
          eyebrow="Quote builder"
          title="Build your quote"
          body="Pick a plan, a camera, internet and add-ons. The estimate updates as you go, and you can send the whole setup to us at the end."
        />

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <div className="grid min-w-0 gap-16">
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
      </Section>

      <Section labelledBy="how-it-works-heading">
        <HowItWorks config={config} />
      </Section>

      <Section id="quote" labelledBy="quote-heading">
        <SectionHead
          id="quote-heading"
          number="05"
          eyebrow="Quote request"
          title="Make it happen"
          body="Send us your setup and your details, and we will get back to you with a quote."
        />
        <QuoteForm config={config} />
      </Section>
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
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-5 grid w-full grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 p-0">
        <span className="rounded-sm border border-accent bg-accent-glow px-1.5 py-[5px] font-mono text-xs leading-none font-semibold tracking-[0.02em] text-accent-ink">
          {n}/6
        </span>
        <span className="font-display text-lg leading-tight font-bold tracking-tight text-text">
          {title}
        </span>
        {hint && (
          <span className="col-start-2 text-sm text-subtext1">{hint}</span>
        )}
      </legend>
      {children}
    </fieldset>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <span className="pr-7 font-display text-body leading-snug font-semibold tracking-tight text-text group-has-[:checked]/opt:text-accent-ink">
      {children}
    </span>
  )
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1.5 block text-sm leading-normal text-subtext1">
      {children}
    </span>
  )
}

function PriceLine({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-auto block pt-3.5">
      <span className="block border-t border-border pt-3 font-mono text-[13px] leading-snug font-medium text-text">
        {children}
      </span>
    </span>
  )
}

function PlanStep({ config, set }: StepProps) {
  return (
    <Step n={1} title="Plan" hint="Priced per camera, per month.">
      <OptionGroup className={COLS_3}>
        {plans.map((p) => (
          <OptionCard
            key={p.id}
            type="radio"
            name="plan"
            value={p.id}
            checked={config.plan === p.id}
            onChange={() => set({ plan: p.id })}
          >
            <Title>{p.name}</Title>
            <span className="mt-3.5 mb-4 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-sm text-subtext1">from</span>
              <span
                className={`font-display text-[40px] leading-none font-extrabold tracking-tight ${
                  config.plan === p.id ? 'text-accent-fg' : 'text-text'
                }`}
              >
                {formatUSD(p.monthly)}
              </span>
              <span className="font-mono text-xs text-subtext1">
                per camera / month
              </span>
            </span>
            {p.lead && (
              <span className="mb-2 block text-sm font-medium text-text">
                {p.lead}
              </span>
            )}
            <span className="grid gap-2">
              {p.features.map((f) => (
                <span
                  key={f}
                  className="grid grid-cols-[14px_1fr] gap-2.5 text-sm leading-snug text-subtext1 before:mt-2.5 before:h-px before:w-2.5 before:bg-accent before:content-['']"
                >
                  {f}
                </span>
              ))}
            </span>
          </OptionCard>
        ))}
      </OptionGroup>
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
      <OptionGroup className={COLS_3}>
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
            <PriceLine>{priceFor(a.id)}</PriceLine>
          </OptionCard>
        ))}
      </OptionGroup>

      <div
        role="group"
        aria-labelledby="camera-count-label"
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface0 px-5 py-4"
      >
        <div className="min-w-0">
          <div
            id="camera-count-label"
            className="text-sm font-medium text-text"
          >
            Number of cameras
          </div>
          <div className="text-xs text-subtext1">
            Every camera gets the same setup. Up to {MAX_CAMERAS} here; ask us
            for more.
          </div>
        </div>
        <div className="flex items-center gap-1">
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
            className="w-11 text-center font-display text-2xl leading-none font-extrabold tracking-tight text-accent-fg tabular-nums"
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
      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-border-input bg-surface0 text-text transition-colors hover:border-accent hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-input disabled:hover:text-text"
    >
      {children}
    </button>
  )
}

function NotNeeded() {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-5 py-4 text-sm text-subtext1">
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
        <OptionGroup className={COLS_2}>
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
                <span className="mb-3.5 block w-28 text-subtext1">
                  <FieldOfView kind={s.id} />
                </span>
                <Title>{s.title}</Title>
                <Body>{s.sees}</Body>
                <span className="mt-2.5 block text-sm leading-normal text-subtext1">
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
        </OptionGroup>
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
        <OptionGroup>
          {style.resolutions.map((r) => (
            <OptionCard
              key={r.id}
              type="radio"
              name="resolution"
              value={r.id}
              checked={config.resolution === r.id}
              onChange={() => set({ resolution: r.id })}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pr-7">
                <span className="font-medium text-text">{r.label}</span>
                <span className="font-mono text-[13px] font-medium text-text group-has-[:checked]/opt:text-accent-ink">
                  {buy
                    ? `Buy from ${formatUSD(r.buy)}`
                    : `Rent from ${formatUSD(r.rent)} / month`}
                </span>
              </span>
            </OptionCard>
          ))}
        </OptionGroup>
      )}
    </Step>
  )
}

function InternetStep({ config, set }: StepProps) {
  return (
    <Step
      n={5}
      title="Internet"
      hint="Charged once per site, whatever the camera count."
    >
      <OptionGroup className={COLS_2}>
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
            <PriceLine>
              {i.monthly > 0
                ? `Starting at ${formatUSD(i.monthly)} / month per site`
                : 'No internet charge'}
            </PriceLine>
          </OptionCard>
        ))}
      </OptionGroup>
    </Step>
  )
}

function AddOnsStep({ config, set }: StepProps) {
  const premium = config.plan === 'premium'
  return (
    <Step n={6} title="Add-ons" hint="Optional. Pick any, or none.">
      <OptionGroup className={COLS_2}>
        <OptionCard
          type="checkbox"
          name="forever-video"
          value="forever-video"
          checked={config.foreverVideo}
          onChange={() => set({ foreverVideo: !config.foreverVideo })}
        >
          <Title>Forever video</Title>
          <Body>Keep every recorded day permanently, on any plan.</Body>
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
          <PriceLine>
            {premium
              ? 'Service included with Premium'
              : `+${formatUSD(WEATHER_STATION_MONTHLY)} / month per site`}
            <span className="block font-normal text-subtext1">
              Station {formatUSD(WEATHER_STATION_UPFRONT)} one-time
            </span>
          </PriceLine>
        </OptionCard>
      </OptionGroup>
    </Step>
  )
}
