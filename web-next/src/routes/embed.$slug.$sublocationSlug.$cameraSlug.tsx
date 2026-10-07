import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { useEffect, useState } from 'react'
import type { HeatStressLevel, Weather } from '@/lib/types'
import {
  fetchCamera,
  fetchLightning,
  fetchSublocationBySlug,
  fetchWeather,
} from '@/lib/api'
import { SITE_URL, streamPoster } from '@/lib/seo'
import { LightningCard } from '@/components/NowPanel'
import LiveBadge from '@/components/LiveBadge'
import StreamPlayer from '@/components/StreamPlayer'
import { Wordmark } from '@/components/BrandMark'
import Panel from '@/components/ui/Panel'
import Eyebrow from '@/components/ui/Eyebrow'

/** What the SSR request says about who is framing this page. */
interface FrameContext {
  referrer: string
  /** `Sec-Fetch-Dest` — 'iframe' when framed, 'document' when opened directly. */
  dest: string
}

/**
 * Reads the Referer and Sec-Fetch-Dest of the incoming document request. A
 * server function because a route loader has no request object of its own.
 */
const getFrameContext = createServerFn({ method: 'GET' }).handler(
  (): FrameContext => ({
    referrer: getRequestHeader('referer') ?? '',
    dest: getRequestHeader('sec-fetch-dest') ?? '',
  }),
)

function hostOf(raw: string): string {
  const withScheme = raw.includes('://') ? raw : `https://${raw}`
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const ALWAYS_LICENSED = new Set(['nationcam.com', 'localhost', '127.0.0.1'])

/**
 * Licence rule (DAN-241): a sublocation with a `host_url` may only be framed
 * by that host's domain (or by nationcam.com itself); one without a
 * `host_url` — free-camera hosts — may be embedded anywhere. A page opened
 * directly (not inside a frame) is always shown. A framed page whose parent
 * sent no Referer cannot prove it is the licensed host, so it is refused.
 */
function isEmbedLicensed(hostUrl: string, ctx: FrameContext): boolean {
  const licensedHost = hostOf(hostUrl)
  if (!licensedHost) return true
  const framed = ctx.dest ? ctx.dest === 'iframe' : ctx.referrer !== ''
  if (!framed) return true
  const host = hostOf(ctx.referrer)
  if (!host) return false
  return host === licensedHost || ALWAYS_LICENSED.has(host)
}

/**
 * Only the non-default values are ever present — same convention as
 * `notes.index.tsx`'s `NotesSearch` — so a bare `/embed/...` URL (the common
 * case, pasted straight from `EmbedSnippet`) round-trips through SSR without
 * TanStack Router's search-canonicalization redirect appending `?theme=dark
 * &player=false` to it.
 */
interface EmbedSearch {
  /** `?theme=light` — anything else (including absent) is dark, the widget's
   *  default. */
  theme?: 'light'
  /**
   * `?player=1` swaps the still for the live HLS player. Kept as the literal
   * number `1` (not a boolean): the router's default search codec JSON-parses
   * every raw query value, so `?player=1` arrives here as the number `1`
   * already, and a boolean would re-serialize as the string `"true"` —
   * mismatching the URL that was requested and triggering the same
   * search-canonicalization redirect this type is built to avoid.
   */
  player?: 1
}

const r = Math.round

/**
 * `GET /embed/{state}/{sublocation}/{camera}` — the embeddable host widget
 * (DAN-33): a self-contained card meant to sit inside another site's
 * `<iframe>` (see `EmbedSnippet`). It renders through the shared root route
 * (`__root.tsx`'s `isEmbedSurface` branch strips the navbar/footer/ad slots/
 * AdSense/PostHog/devtools for `/embed/*`), so this component only needs to
 * build the card itself.
 *
 * Fetching the camera is what records the view (same endpoint the camera
 * page loader uses), so an embed load counts toward `view_count` exactly
 * once — there is no ad slot here, so it never touches the ad-impression
 * path.
 */
export const Route = createFileRoute(
  '/embed/$slug/$sublocationSlug/$cameraSlug',
)({
  validateSearch: (search: Record<string, unknown>): EmbedSearch => {
    const out: EmbedSearch = {}
    if (search.theme === 'light') out.theme = 'light'
    if (search.player === '1' || search.player === 1) out.player = 1
    return out
  },
  loader: async ({ params }) => {
    const detail = await fetchCamera(
      params.slug,
      params.sublocationSlug,
      params.cameraSlug,
    ).catch(() => null)
    if (!detail) throw notFound()

    // Who is framing us? SSR reads the request; a client-side navigation
    // reads the document. Only the licensed host (or nationcam.com) may show
    // the camera when the sublocation has a host_url.
    const sublocation = await fetchSublocationBySlug(
      params.sublocationSlug,
    ).catch(() => null)
    const ctx: FrameContext =
      typeof document === 'undefined'
        ? await getFrameContext()
        : {
            referrer: document.referrer,
            dest: window.self !== window.top ? 'iframe' : 'document',
          }
    if (!isEmbedLicensed(sublocation?.host_url ?? '', ctx)) {
      return {
        licensed: false as const,
        camera: detail.camera,
        weather: null,
        lightning: null,
        minute: 0,
      }
    }

    const [weather, lightning] = await Promise.all([
      fetchWeather(params.sublocationSlug),
      fetchLightning(params.sublocationSlug),
    ])
    return {
      licensed: true as const,
      camera: detail.camera,
      weather,
      lightning,
      // Computed server-side so the still's first `t=` cache-buster matches
      // between SSR and hydration; the client ticks it forward every 60s.
      minute: Math.floor(Date.now() / 60_000),
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    return {
      meta: [
        { title: `${loaderData.camera.title} — NationCam` },
        // Embeds are never a canonical destination for search — the camera
        // page is (see the sitemap, which never lists `/embed/*`).
        { name: 'robots', content: 'noindex' },
      ],
    }
  },
  component: EmbedPage,
  notFoundComponent: () => (
    <div className="p-4 text-center font-mono text-xs text-subtext0">
      Camera not found
    </div>
  ),
})

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type Tone = 'calm' | 'caution' | 'alert'

const toneClasses: Record<Tone, string> = {
  calm: 'bg-teal/10 text-teal',
  caution: 'bg-accent/10 text-accent',
  alert: 'bg-live/10 text-live',
}

function heatStressTone(level: HeatStressLevel): Tone {
  if (level === 'low') return 'calm'
  if (level === 'moderate') return 'caution'
  return 'alert' // high | extreme
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

/**
 * Up to three compact outdoor-activity tiles (heat stress, UV, rain next
 * hour) — a small slice of `NowPanel`'s outdoor row sized for the widget,
 * skipping any field Open-Meteo didn't offer. `NowPanel.tsx` is shared with
 * the full site and is out of scope here, so this is a minimal standalone
 * read of the same `Weather` fields rather than an import of its internals.
 */
function OutdoorTiles({ weather }: { weather: Weather }) {
  const tiles: Array<{ id: string; value: string; label: string; tone: Tone }> =
    []
  if (weather.heat_stress) {
    tiles.push({
      id: 'heat',
      value: capitalize(weather.heat_stress.level),
      label: 'Heat stress',
      tone: heatStressTone(weather.heat_stress.level),
    })
  }
  if (weather.uv_index != null) {
    tiles.push({
      id: 'uv',
      value: `${r(weather.uv_index)}`,
      label: 'UV',
      tone: uvTone(weather.uv_index),
    })
  }
  if (weather.rain_next_hour_pct != null) {
    tiles.push({
      id: 'rain',
      value: `${r(weather.rain_next_hour_pct)}%`,
      label: 'Rain 1h',
      tone: rainNextHourTone(weather.rain_next_hour_pct),
    })
  }
  if (tiles.length === 0) return null
  return (
    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
      {tiles.map((t) => (
        <div
          key={t.id}
          className={`rounded-md px-1.5 py-1 text-center ${toneClasses[t.tone]}`}
        >
          <b className="block font-mono text-[12px] leading-tight font-semibold tabular-nums">
            {t.value}
          </b>
          <span className="text-[9px] tracking-[0.04em] uppercase opacity-80">
            {t.label}
          </span>
        </div>
      ))}
    </div>
  )
}

/** The camera's latest watermarked still, refreshed every 60s client-side.
 *  `minute` starts at the loader's server-computed value (so SSR and
 *  hydration agree) and ticks forward on an interval once mounted. */
function EmbedStill({
  path,
  title,
  minute,
}: {
  path: string
  title: string
  minute: number
}) {
  const [t, setT] = useState(minute)
  useEffect(() => {
    const id = setInterval(() => setT(Math.floor(Date.now() / 60_000)), 60_000)
    return () => clearInterval(id)
  }, [])
  return (
    <img
      src={`/api/videos/${path}/snapshot.jpg?t=${t}`}
      alt={title}
      className="h-[150px] w-full rounded-lg bg-crust object-cover"
    />
  )
}

function EmbedPage() {
  const { slug, sublocationSlug, cameraSlug } = Route.useParams()
  const { player } = Route.useSearch()
  const { camera, weather, lightning, minute, licensed } = Route.useLoaderData()

  const isLive = camera.status === 'active'
  const poster = streamPoster(camera.src, isLive)
  const cameraPath = `${slug}/${sublocationSlug}/${cameraSlug}`
  const cameraPageUrl = `${SITE_URL}/locations/${cameraPath}`

  if (!licensed) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface0 p-2.5 text-text">
        <Panel className="w-full text-center">
          <Eyebrow className="justify-center">Not licensed</Eyebrow>
          <p className="mb-3 text-body text-subtext1">
            This camera is not licensed for this site.
          </p>
          <a
            href={cameraPageUrl}
            target="_blank"
            rel="noopener"
            className="font-mono text-[11px] font-medium text-accent-ink hover:underline"
          >
            Watch it on NationCam &rarr;
          </a>
        </Panel>
      </div>
    )
  }

  return (
    // `overflow-y-auto` is the fallback, not the plan: the sizes/spacing below
    // are tuned so a camera with weather but no lightning fits the 400×360
    // default with no scrollbar. A camera that also has satellite lightning
    // (LightningCard, DAN-34) is the one combination that can run past 360px
    // — the card scrolls internally rather than clipping, which beats hiding
    // the highest-value row (the still) to make room.
    <div className="h-screen overflow-y-auto bg-surface0 p-2.5 text-text">
      {/* Still / live player */}
      <div className="relative">
        {player ? (
          <StreamPlayer
            src={camera.src}
            type={camera.type}
            autoplay
            muted
            controls
            live={isLive}
            poster={poster}
            className="h-[150px] rounded-lg"
          />
        ) : (
          <>
            <EmbedStill
              path={cameraPath}
              title={camera.title}
              minute={minute}
            />
            {isLive && (
              <LiveBadge className="absolute top-2 left-2 z-10 scale-90" />
            )}
          </>
        )}
      </div>

      {/* Title */}
      <div className="mt-1.5 min-w-0">
        <p className="mb-0 truncate font-display text-[13px] font-semibold text-text">
          {camera.title}
        </p>
        <p className="mb-0 truncate font-mono text-[11px] text-subtext1">
          {camera.sublocation_name
            ? `${camera.sublocation_name}, ${camera.state_name}`
            : camera.state_name}
        </p>
      </div>

      {/* Conditions row */}
      {weather && (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <MiniStat value={`${r(weather.temp_f)}°`} label="Temp" />
          <MiniStat value={`${r(weather.feels_f)}°`} label="Feels" />
          <MiniStat
            value={`${r(weather.wind_mph)} mph`}
            label={`Wind ${weather.wind_dir}`}
          />
        </div>
      )}
      {weather && <OutdoorTiles weather={weather} />}

      {/* Lightning — renders nothing when unavailable (no coordinates) */}
      {lightning !== null && (
        <div className="mt-1.5">
          <LightningCard slug={sublocationSlug} initial={lightning} />
        </div>
      )}

      {/* Footer */}
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border pt-1.5">
        <a
          href={cameraPageUrl}
          target="_blank"
          rel="noopener"
          className="truncate font-mono text-[11px] font-medium text-accent-ink hover:underline"
        >
          Watch live on NationCam &rarr;
        </a>
        <a
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-subtext0"
          aria-label="NationCam"
        >
          <Wordmark className="h-2.5 w-auto" />
        </a>
      </div>
    </div>
  )
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border border-border bg-base px-1.5 py-1 text-center">
      <b className="block font-mono text-[12px] leading-tight font-medium tabular-nums">
        {value}
      </b>
      <span className="text-[9px] tracking-[0.04em] text-subtext0 uppercase">
        {label}
      </span>
    </div>
  )
}
