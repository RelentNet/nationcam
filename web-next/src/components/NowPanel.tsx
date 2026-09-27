import { Link, useParams } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  HeatStressLevel,
  StormPotentialLevel,
  Sublocation,
  Weather,
} from '@/lib/types'

function clockText(date: Date, timeZone: string): string {
  try {
    return date.toLocaleTimeString('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return ''
  }
}

/**
 * Local wall-clock at the location, ticking every 30s on the client. The
 * server-rendered text is `initial` (the weather's fetched_at) formatted in the
 * same zone, so hydration matches and the clock corrects itself on mount.
 */
export function LocalClock({
  timeZone,
  initial,
  className = '',
}: {
  timeZone: string
  initial: string
  className?: string
}) {
  const [text, setText] = useState(() => clockText(new Date(initial), timeZone))
  useEffect(() => {
    const tick = () => setText(clockText(new Date(), timeZone))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [timeZone])
  return <span className={`tabular-nums ${className}`}>{text}</span>
}

/** "2026-02-01" → "Feb 2026" (UTC so the calendar date never shifts). */
export function sinceLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Who to credit in the hosted-by row: host fields first, sponsor as fallback. */
function hostRow(sub: Sublocation) {
  if (sub.host_name) {
    return { name: sub.host_name, url: sub.host_url, logo: '' }
  }
  if (sub.sponsor_url && sub.sponsor_link) {
    return {
      name: domain(sub.sponsor_link),
      url: sub.sponsor_link,
      logo: sub.sponsor_url,
    }
  }
  return null
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-surface1 px-2.5 py-1.5">
      <b className="block font-mono text-[13px] font-medium whitespace-nowrap tabular-nums">
        {value}
      </b>
      <span className="text-[11px] tracking-[0.05em] text-subtext0 uppercase">
        {label}
      </span>
    </div>
  )
}

const r = Math.round

/* ──── Outdoor-activity stats (DAN-32) ──── */

/**
 * Color-coding tone for a status tile, expressed as the three semantic
 * tokens the Observatory theme already defines (teal/accent/live) rather
 * than raw Tailwind palette colors, so the tiles stay correct in both
 * themes without any new CSS. Written as full literal class strings (not
 * built from a template) so Tailwind's scanner can see them.
 */
type Tone = 'calm' | 'caution' | 'alert'

const toneClasses: Record<Tone, string> = {
  calm: 'bg-teal/10 text-teal',
  caution: 'bg-accent/10 text-accent',
  alert: 'bg-live/10 text-live',
}

function StatusTile({
  value,
  label,
  tone,
}: {
  value: string
  label: string
  tone: Tone
}) {
  return (
    <div className={`rounded-lg px-2.5 py-1.5 ${toneClasses[tone]}`}>
      <b className="block font-mono text-[13px] leading-tight font-semibold tabular-nums">
        {value}
      </b>
      <span className="text-[11px] tracking-[0.05em] uppercase opacity-80">
        {label}
      </span>
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function heatStressTone(level: HeatStressLevel): Tone {
  if (level === 'low') return 'calm'
  if (level === 'moderate') return 'caution'
  return 'alert' // high | extreme
}

function stormTone(level: StormPotentialLevel): Tone {
  if (level === 'low') return 'calm'
  if (level === 'moderate') return 'caution'
  return 'alert' // high
}

function aqiTone(category: string): Tone {
  if (category === 'Good') return 'calm'
  if (
    category === 'Moderate' ||
    category === 'Unhealthy for Sensitive Groups'
  ) {
    return 'caution'
  }
  return 'alert' // Unhealthy | Very Unhealthy | Hazardous
}

/** Standard EPA UV Index category for a raw index value. */
function uvCategory(uv: number): string {
  if (uv < 3) return 'Low'
  if (uv < 6) return 'Moderate'
  if (uv < 8) return 'High'
  if (uv < 11) return 'Very high'
  return 'Extreme'
}

function uvTone(uv: number): Tone {
  if (uv < 3) return 'calm'
  if (uv < 8) return 'caution'
  return 'alert'
}

function rainNextHourTone(pct: number): Tone {
  if (pct < 20) return 'calm'
  if (pct < 50) return 'caution'
  return 'alert'
}

const pressureTrendArrow: Record<string, string> = {
  rising: '↑',
  falling: '↓',
  steady: '→',
}

/** Builds the five outdoor-activity status tiles, skipping any whose value
 *  is unavailable. */
function statusTiles(
  w: Weather,
): Array<{ id: string; value: string; label: string; tone: Tone }> {
  const tiles: Array<{
    id: string
    value: string
    label: string
    tone: Tone
  }> = []
  if (w.heat_stress) {
    tiles.push({
      id: 'heat',
      value: capitalize(w.heat_stress.level),
      label: 'Heat stress',
      tone: heatStressTone(w.heat_stress.level),
    })
  }
  if (w.uv_index != null) {
    tiles.push({
      id: 'uv',
      value: `${r(w.uv_index)} ${uvCategory(w.uv_index)}`,
      label: 'UV',
      tone: uvTone(w.uv_index),
    })
  }
  if (w.us_aqi) {
    tiles.push({
      id: 'aqi',
      value: `${w.us_aqi.value} ${w.us_aqi.category}`,
      label: 'Air quality',
      tone: aqiTone(w.us_aqi.category),
    })
  }
  if (w.rain_next_hour_pct != null) {
    tiles.push({
      id: 'rain-next-hour',
      value: `${r(w.rain_next_hour_pct)}%`,
      label: 'Rain next hour',
      tone: rainNextHourTone(w.rain_next_hour_pct),
    })
  }
  if (w.storm_potential) {
    tiles.push({
      id: 'storm',
      value: capitalize(w.storm_potential.level),
      label: 'Storm potential',
      tone: stormTone(w.storm_potential.level),
    })
  }
  return tiles
}

/**
 * "Right now at {place}": current conditions from Open-Meteo, the local clock,
 * and who hosts the camera. Rendered only when the loader got weather back.
 */
export default function NowPanel({
  weather: w,
  sublocation,
}: {
  weather: Weather
  sublocation: Sublocation
}) {
  const host = hostRow(sublocation)
  // NowPanel is only ever rendered inside a /locations/$slug/$sublocationSlug
  // route, but it isn't handed the state slug as a prop — reading it off the
  // matched route avoids threading it through every caller.
  const { slug: stateSlug } = useParams({ strict: false })
  const hasCoords = sublocation.lat != null && sublocation.lng != null
  const tiles = statusTiles(w)
  const hasDetailStats =
    w.dew_point_f != null ||
    w.pressure_inhg != null ||
    w.visibility_mi != null ||
    w.cloud_cover_pct != null
  return (
    <aside
      aria-label={`Current conditions at ${sublocation.name}`}
      className="overflow-hidden rounded-2xl border border-overlay0 bg-surface0"
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
        <span className="font-mono text-[11px] tracking-[0.08em] text-subtext0 uppercase">
          Right now at {sublocation.name}
        </span>
        <LocalClock
          timeZone={w.timezone}
          initial={w.fetched_at}
          className="shrink-0 font-mono text-sm text-text"
        />
      </div>

      <div className="border-b border-overlay0 px-5 pt-3 pb-4">
        <div className="flex items-center gap-4">
          <div className="font-display text-5xl leading-none font-semibold tracking-tight text-text">
            {r(w.temp_f)}
            <sup className="ml-0.5 align-top text-xl font-medium">°F</sup>
          </div>
          <div className="text-[15px] text-text">
            {w.condition}
            <span className="block text-[13px] text-subtext0">
              Feels like {r(w.feels_f)}° · Humidity {r(w.humidity)}%
            </span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat value={`${r(w.wind_mph)} mph`} label={`Wind ${w.wind_dir}`} />
          <Stat value={`${r(w.gust_mph)} mph`} label="Gusts" />
          <Stat value={`${r(w.high_f)}°`} label="High" />
          <Stat value={`${r(w.rain_pct)}%`} label="Rain" />
        </div>
        {hasDetailStats && (
          <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
            {w.dew_point_f != null && (
              <Stat value={`${r(w.dew_point_f)}°`} label="Dew point" />
            )}
            {w.pressure_inhg != null && (
              <Stat
                value={`${w.pressure_inhg.toFixed(2)}${w.pressure_trend ? ` ${pressureTrendArrow[w.pressure_trend]}` : ''}`}
                label="Pressure"
              />
            )}
            {w.visibility_mi != null && (
              <Stat
                value={`${w.visibility_mi.toFixed(1)} mi`}
                label="Visibility"
              />
            )}
            {w.cloud_cover_pct != null && (
              <Stat value={`${r(w.cloud_cover_pct)}%`} label="Cloud cover" />
            )}
          </div>
        )}
        <div className="mt-3 flex items-center font-mono text-xs text-subtext1">
          <span>↑ {w.sunrise}</span>
          <span className="mx-3 h-px flex-1 bg-overlay0" />
          <span>↓ {w.sunset}</span>
        </div>
      </div>

      {tiles.length > 0 && (
        <div className="border-b border-overlay0 px-5 py-3">
          <p className="mb-1.5 font-mono text-[11px] tracking-[0.08em] text-subtext0 uppercase">
            Outdoor conditions
          </p>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
            {tiles.map(({ id, ...tile }) => (
              <StatusTile key={id} {...tile} />
            ))}
          </div>
          <p className="mt-2 mb-0 font-mono text-[11px] text-subtext0">
            Estimates from forecast models, not on-site sensors
          </p>
        </div>
      )}

      {hasCoords && stateSlug && (
        <div className="border-b border-overlay0 px-5 py-2.5">
          <Link
            to="/locations/$slug/$sublocationSlug/conditions"
            params={{ slug: stateSlug, sublocationSlug: sublocation.slug }}
            className="inline-flex items-center gap-1 font-mono text-xs font-medium text-accent hover:underline"
          >
            Full conditions <ArrowRight size={12} />
          </Link>
        </div>
      )}

      {w.marine && (
        <div className="border-b border-overlay0 px-5 py-3">
          <p className="mb-1.5 font-mono text-[11px] tracking-[0.08em] text-teal uppercase">
            On the water
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={`${w.marine.wave_ft.toFixed(1)} ft`} label="Waves" />
            <Stat value={`${r(w.marine.period_s)} s`} label="Period" />
            <Stat value={`${r(w.marine.water_f)}°F`} label="Water" />
          </div>
        </div>
      )}

      {/* Windy's embed takes coordinates, not an address — a regional map,
          so the stored lat/lng is plenty precise. Lazy so it never delays
          the live player. */}
      {sublocation.lat != null && sublocation.lng != null && (
        <iframe
          title={`Weather map around ${sublocation.name}`}
          src={`https://embed.windy.com/embed.html?type=map&location=coordinates&lat=${sublocation.lat}&lon=${sublocation.lng}&zoom=9&overlay=wind&marker=true&metricWind=mph&metricTemp=%C2%B0F&metricRain=in`}
          loading="lazy"
          className="block h-60 w-full border-0 border-b border-overlay0"
        />
      )}

      {host && (
        <div className="flex items-center gap-3 px-5 py-3.5">
          {host.logo && (
            <img
              src={host.logo}
              alt=""
              className="h-11 w-11 shrink-0 rounded-lg bg-white object-contain"
            />
          )}
          <div className="min-w-0">
            <p className="mb-0 font-mono text-[11px] tracking-[0.08em] text-subtext0 uppercase">
              Hosted by
            </p>
            <p className="mb-0 font-semibold text-text">{host.name}</p>
            {sublocation.host_since && (
              <p className="mb-0 text-[13px] text-subtext1">
                On NationCam since {sinceLabel(sublocation.host_since)}
              </p>
            )}
          </div>
          {host.url && (
            <a
              href={host.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto shrink-0 text-sm font-medium text-accent hover:underline"
            >
              {domain(host.url)} ↗
            </a>
          )}
        </div>
      )}

      <p className="mb-0 px-5 pb-3 font-mono text-[11px] text-subtext0">
        Weather via{' '}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-accent"
        >
          Open-Meteo
        </a>
      </p>
    </aside>
  )
}
