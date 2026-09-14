import { useEffect, useState } from 'react'
import type { Sublocation, Weather } from '@/lib/types'

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
        <div className="mt-3 flex items-center font-mono text-xs text-subtext1">
          <span>↑ {w.sunrise}</span>
          <span className="mx-3 h-px flex-1 bg-overlay0" />
          <span>↓ {w.sunset}</span>
        </div>
      </div>

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
