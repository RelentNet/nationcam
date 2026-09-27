import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ChevronRight, CloudSun, Gauge, Waves } from 'lucide-react'
import type { Conditions, TidePrediction } from '@/lib/types'
import { fetchConditions, fetchSublocationBySlug } from '@/lib/api'
import { SITE_URL, seo } from '@/lib/seo'

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

    const conditions = await fetchConditions(params.sublocationSlug)
    return { sublocation, conditions }
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
    <div className="rounded-xl border border-overlay0 bg-surface1 px-4 py-3.5">
      <p className="mb-2 font-mono text-[11px] tracking-[0.08em] text-subtext0 uppercase">
        {dayLabel(date)}
      </p>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold text-text">
          {r(high_f)}°
        </span>
        <span className="text-sm text-subtext1">{r(low_f)}° low</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-subtext1">
        <span>Rain {r(precip_chance)}%</span>
        <span>Wind {r(wind_max_mph)} mph</span>
        <span>↑ {sunrise}</span>
        <span>↓ {sunset}</span>
      </div>
    </div>
  )
}

function ConditionsRoute() {
  const { slug } = Route.useParams()
  const { sublocation, conditions } = Route.useLoaderData()
  const crumbLink = 'transition-colors hover:text-accent'

  return (
    <div className="page-container page-enter">
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex items-center gap-1.5 font-mono text-xs text-subtext0"
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

      <h1 className="mb-1">{sublocation.name} Conditions</h1>
      <p className="mb-8 text-subtext0">
        Forecast, tides and river stage from public data — is it worth going
        today?
      </p>

      {conditions && conditions.forecast.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-lg">
            <CloudSun size={18} className="text-accent" />
            3-day forecast
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {conditions.forecast.map((day) => (
              <ForecastCard key={day.date} {...day} />
            ))}
          </div>
        </section>
      )}

      {conditions?.tides && (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-lg">
            <Waves size={18} className="text-teal" />
            Tides — {conditions.tides.station_name}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-overlay0 bg-surface0 p-4">
            <TideCurve predictions={conditions.tides.predictions} />
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="font-mono text-[11px] tracking-[0.08em] text-subtext0 uppercase">
                  <th className="pb-1.5 font-medium">Time</th>
                  <th className="pb-1.5 font-medium">Type</th>
                  <th className="pb-1.5 font-medium">Height</th>
                </tr>
              </thead>
              <tbody>
                {conditions.tides.predictions.map((p, i) => (
                  <tr key={i} className="border-t border-overlay0">
                    <td className="py-1.5 text-text">
                      {tideTimeLabel(p.time)}
                    </td>
                    <td className="py-1.5 text-subtext1 capitalize">
                      {p.type}
                    </td>
                    <td className="py-1.5 font-mono tabular-nums text-text">
                      {p.height_ft.toFixed(1)} ft
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {conditions?.river && (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-lg">
            <Gauge size={18} className="text-accent" />
            River stage
          </h2>
          <div className="rounded-2xl border border-overlay0 bg-surface0 px-5 py-4">
            <p className="mb-0 font-mono text-[11px] tracking-[0.08em] text-subtext0 uppercase">
              {conditions.river.site_name}
            </p>
            <p className="mb-0 font-display text-3xl font-semibold text-text">
              {conditions.river.stage_ft.toFixed(2)} ft
            </p>
            <p className="mb-0 text-xs text-subtext1">
              Observed {conditions.river.observed_at}
            </p>
          </div>
        </section>
      )}

      {!conditions && (
        <p className="text-subtext0">
          Conditions data is unavailable right now — check back soon.
        </p>
      )}
    </div>
  )
}

function ConditionsNotFound() {
  return (
    <div className="page-container page-enter text-center">
      <h2>Conditions unavailable</h2>
      <p>This location does not have a conditions page.</p>
      <Link
        to="/locations"
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-2.5 font-sans font-semibold text-crust transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
      >
        Back to locations
      </Link>
    </div>
  )
}
