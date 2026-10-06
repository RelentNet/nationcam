import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { Conditions, HourlyPoint, TidePrediction } from '@/lib/types'
import {
  fetchAlerts,
  fetchConditions,
  fetchLightning,
  fetchSublocationBySlug,
} from '@/lib/api'
import { SITE_URL, seo } from '@/lib/seo'
import { AlertsBanner, LightningCard } from '@/components/NowPanel'
import { buttonClasses } from '@/components/Button'
import SectionHead from '@/components/ui/SectionHead'
import Panel from '@/components/ui/Panel'
import RuledGrid, { RuledCell } from '@/components/ui/RuledGrid'
import DataTable from '@/components/ui/DataTable'

export const Route = createFileRoute(
  '/locations/$slug/$sublocationSlug/conditions',
)({
  loader: async ({ params }) => {
    const sublocation = await fetchSublocationBySlug(
      params.sublocationSlug,
    ).catch(() => null)
    if (!sublocation) throw notFound()
    // Same coordinate gate as the API: no lat/lng, no page.
    if (sublocation.lat == null || sublocation.lng == null) throw notFound()

    const [conditions, lightning, alerts] = await Promise.all([
      fetchConditions(params.sublocationSlug),
      fetchLightning(params.sublocationSlug),
      fetchAlerts(params.sublocationSlug),
    ])
    return { sublocation, conditions, lightning, alerts }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}
    const { sublocation, conditions } = loaderData
    const path = `/locations/${params.slug}/${params.sublocationSlug}/conditions`
    const url = `${SITE_URL}${path}`
    const bits = ['a 3-day forecast']
    if (conditions?.tides) bits.push('NOAA tide predictions')
    if (conditions?.river) bits.push('USGS river stage')
    const base = seo({
      title: `${sublocation.name} Conditions — Forecast, Tides & River Stage | NationCam`,
      description: `Is it worth going today? ${bits.join(', ')} for ${sublocation.name}, ${sublocation.state_name}.`,
      path,
    })
    return {
      ...base,
      meta: [
        ...base.meta,
        {
          'script:ld+json': {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { name: 'Locations', item: `${SITE_URL}/locations` },
              {
                name: sublocation.state_name,
                item: `${SITE_URL}/locations/${params.slug}`,
              },
              {
                name: sublocation.name,
                item: `${SITE_URL}/locations/${params.slug}/${params.sublocationSlug}`,
              },
              { name: 'Conditions', item: url },
            ].map((entry, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              ...entry,
            })),
          },
        },
      ],
    }
  },
  component: ConditionsRoute,
  notFoundComponent: ConditionsNotFound,
})

const r = Math.round

/** "2026-09-26" → "Sat, Sep 26" (UTC so the calendar date never shifts). */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** "2026-09-26 01:15" → "1:15 AM Sat" — NOAA's naive local timestamp. */
function tideTimeLabel(time: string): string {
  const d = new Date(time.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return time
  return d.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'short',
  })
}

/** A minimal inline SVG curve through the 48h hi/lo tide predictions. Smoothed
 *  with quadratic bezier segments through each midpoint — good enough for a
 *  "is the tide coming in" glance, not a navigational chart. */
function TideCurve({ predictions }: { predictions: Array<TidePrediction> }) {
  if (predictions.length < 2) return null

  const width = 600
  const height = 160
  const padX = 16
  const padY = 20

  const times = predictions.map((p) =>
    new Date(p.time.replace(' ', 'T')).getTime(),
  )
  const heights = predictions.map((p) => p.height_ft)
  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const minH = Math.min(...heights)
  const maxH = Math.max(...heights)
  const spanT = maxT - minT || 1
  const spanH = maxH - minH || 1

  const points = predictions.map((p, i) => {
    const x = padX + ((times[i] - minT) / spanT) * (width - padX * 2)
    const y =
      height - padY - ((p.height_ft - minH) / spanH) * (height - padY * 2)
    return { x, y, type: p.type }
  })

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const midX = (prev.x + curr.x) / 2
    path += ` Q ${prev.x} ${prev.y}, ${midX} ${(prev.y + curr.y) / 2}`
    path += ` T ${curr.x} ${curr.y}`
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-40 w-full"
      role="img"
      aria-label="Tide height over the next 48 hours"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--color-teal, currentColor)"
        strokeWidth={2}
        className="text-teal"
      />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} className="fill-teal" />
          <text
            x={p.x}
            y={p.type === 'high' ? p.y - 8 : p.y + 16}
            textAnchor="middle"
            className="fill-subtext0 font-mono text-[9px] uppercase"
          >
            {p.type === 'high' ? 'H' : 'L'}
          </text>
        </g>
      ))}
    </svg>
  )
}

/** One hour of the 12-hour strip. */
function HourCard({ hour, temp_f, rain_pct, wind_mph, uv_index }: HourlyPoint) {
  return (
    <div className="flex w-[84px] shrink-0 flex-col items-center gap-1.5 rounded-lg border border-border bg-surface0 px-2 py-3">
      <span className="font-mono text-[11px] text-label">{hour}</span>
      <span className="font-display text-xl font-bold text-text tabular-nums">
        {r(temp_f)}°
      </span>
      <span className="font-mono text-[11px] text-label tabular-nums">
        {r(rain_pct)}% rain
      </span>
      <span className="font-mono text-[11px] text-label tabular-nums">
        {r(wind_mph)} mph
      </span>
      <span className="font-mono text-[11px] text-label tabular-nums">
        UV {r(uv_index)}
      </span>
    </div>
  )
}

function ForecastCard({
  date,
  high_f,
  low_f,
  precip_chance,
  wind_max_mph,
  sunrise,
  sunset,
}: Conditions['forecast'][number]) {
  return (
    <RuledCell>
      <p className="mono-label mb-3 leading-none">{dayLabel(date)}</p>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-bold text-text tabular-nums">
          {r(high_f)}°
        </span>
        <span className="text-sm text-label">{r(low_f)}° low</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-label">
        <span>Rain {r(precip_chance)}%</span>
        <span>Wind {r(wind_max_mph)} mph</span>
        <span>↑ {sunrise}</span>
        <span>↓ {sunset}</span>
      </div>
    </RuledCell>
  )
}

function ConditionsRoute() {
  const { slug } = Route.useParams()
  const { sublocation, conditions, lightning, alerts } = Route.useLoaderData()
  const crumbLink = 'transition-colors hover:text-accent-ink'

  return (
    <div className="page-container page-enter">
      <AlertsBanner slug={sublocation.slug} initial={alerts} standalone />

      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex flex-wrap items-center gap-1.5 font-mono text-xs text-label"
      >
        <Link
          to="/locations"
          activeOptions={{ exact: true }}
          className={crumbLink}
        >
          Locations
        </Link>
        <ChevronRight size={12} />
        <Link
          to="/locations/$slug"
          params={{ slug }}
          activeOptions={{ exact: true }}
          className={crumbLink}
        >
          {sublocation.state_name}
        </Link>
        <ChevronRight size={12} />
        <Link
          to="/locations/$slug/$sublocationSlug"
          params={{ slug, sublocationSlug: sublocation.slug }}
          activeOptions={{ exact: true }}
          className={crumbLink}
        >
          {sublocation.name}
        </Link>
        <ChevronRight size={12} />
        <span className="text-text">Conditions</span>
      </nav>

      <SectionHead
        as="h1"
        title={`${sublocation.name} Conditions`}
        body="Forecast, tides and river stage from public data — is it worth going today?"
      />

      <div className="flex flex-col gap-[var(--section-y)]">
        {lightning !== null && (
          <section aria-labelledby="cond-lightning">
            <SectionHead id="cond-lightning" stacked title="Lightning" />
            <Panel>
              <LightningCard
                slug={sublocation.slug}
                initial={lightning}
                detail
              />
            </Panel>
          </section>
        )}

        {conditions && conditions.hourly.length > 0 && (
          <section aria-labelledby="cond-hourly">
            <SectionHead id="cond-hourly" stacked title="Next 12 hours" />
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
              {conditions.hourly.map((hour, i) => (
                <HourCard key={i} {...hour} />
              ))}
            </div>
          </section>
        )}

        {conditions && conditions.forecast.length > 0 && (
          <section aria-labelledby="cond-forecast">
            <SectionHead id="cond-forecast" stacked title="3-day forecast" />
            <RuledGrid cols={3}>
              {conditions.forecast.map((day) => (
                <ForecastCard key={day.date} {...day} />
              ))}
            </RuledGrid>
          </section>
        )}

        {conditions?.tides && (
          <section aria-labelledby="cond-tides">
            <SectionHead
              id="cond-tides"
              stacked
              title={`Tides — ${conditions.tides.station_name}`}
            />
            <Panel>
              <TideCurve predictions={conditions.tides.predictions} />
              <DataTable
                className="mt-4"
                minWidth={320}
                columns={[
                  { key: 'time', header: 'Time' },
                  { key: 'type', header: 'Type' },
                  { key: 'height', header: 'Height' },
                ]}
                rows={conditions.tides.predictions.map((p, i) => ({
                  key: String(i),
                  cells: [
                    tideTimeLabel(p.time),
                    <span key="t" className="capitalize">
                      {p.type}
                    </span>,
                    <span key="h" className="font-mono tabular-nums">
                      {p.height_ft.toFixed(1)} ft
                    </span>,
                  ],
                }))}
              />
            </Panel>
          </section>
        )}

        {conditions?.river && (
          <section aria-labelledby="cond-river">
            <SectionHead id="cond-river" stacked title="River stage" />
            <Panel>
              <p className="mono-label mb-2 leading-none">
                {conditions.river.site_name}
              </p>
              <p className="mb-0 font-display text-3xl font-bold text-accent-fg tabular-nums">
                {conditions.river.stage_ft.toFixed(2)} ft
              </p>
              <p className="mt-1 mb-0 text-xs text-label">
                Observed {conditions.river.observed_at}
              </p>
            </Panel>
          </section>
        )}

        {!conditions && (
          <p className="mb-0 text-subtext0">
            Conditions data is unavailable right now — check back soon.
          </p>
        )}
      </div>
    </div>
  )
}

function ConditionsNotFound() {
  return (
    <div className="page-container page-enter text-center">
      <h2>Conditions unavailable</h2>
      <p>This location does not have a conditions page.</p>
      <Link to="/locations" className={buttonClasses({ variant: 'primary' })}>
        Back to locations
      </Link>
    </div>
  )
}
