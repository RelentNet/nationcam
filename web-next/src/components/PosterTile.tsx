import { Link } from '@tanstack/react-router'
import { Pause, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import LiveBadge from '@/components/LiveBadge'

/** How often poster frames are re-fetched while the tab is visible. */
const POSTER_REFRESH_MS = 30_000

/**
 * A cache-busting timestamp that advances every 30s while the tab is visible
 * (and once more when it becomes visible again). 0 on the server and first
 * client render, so hydration is stable and the first paint uses the plain
 * poster URL. Call it once per page and hand the value to every PosterTile.
 */
export function usePosterTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === 'visible') setTick(Date.now())
    }
    const timer = setInterval(bump, POSTER_REFRESH_MS)
    document.addEventListener('visibilitychange', bump)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', bump)
    }
  }, [])
  return tick
}

/** The two pages a tile can lead to, with their params kept in step. */
type LinkTarget =
  | {
      to: '/locations/$slug/$sublocationSlug'
      params: { slug: string; sublocationSlug: string }
    }
  | {
      to: '/locations/$slug/$sublocationSlug/$cameraSlug'
      params: { slug: string; sublocationSlug: string; cameraSlug: string }
    }

interface PosterTileProps {
  title: string
  /** One short line under the title (tagline, camera count, …). */
  meta?: string
  /** Poster JPEG from `streamPoster`; undefined draws a placeholder. */
  poster?: string
  live?: boolean
  /** Owner has paused this camera — shows a muted "Paused" badge instead of
   *  the live pulse, while the tile stays clickable (DAN-40). Takes priority
   *  over `live` when both are set. */
  paused?: boolean
  /** Highlighted as the camera currently in the featured player. */
  selected?: boolean
  /** From `usePosterTick` — appended as `?t=` to bust the poster cache. */
  tick?: number
  /** Where the tile goes; omit for a camera with no page of its own. */
  link?: LinkTarget
  /** Popularity rank — draws the orange "#n" chip beside the title. */
  rank?: number
}

/**
 * A poster-frame tile (never a player) linking to a camera or sublocation page.
 * Restreamer refreshes the JPEG beside each HLS manifest, so re-requesting it
 * with a new `?t=` every 30s keeps the strip roughly live.
 */
export default function PosterTile({
  title,
  meta,
  poster,
  live = false,
  paused = false,
  selected = false,
  tick = 0,
  link,
  rank,
}: PosterTileProps) {
  const src = poster && tick ? `${poster}?t=${tick}` : poster
  const className = `group block overflow-hidden rounded-xl border bg-surface0 no-underline transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-[0_0_0_3px_var(--color-accent-glow)] ${
    selected
      ? 'border-accent shadow-[0_0_0_3px_var(--color-accent-glow)]'
      : 'border-border'
  }`
  const body = (
    <>
      <div className="relative aspect-video bg-crust">
        {src ? (
          <img
            src={src}
            alt={`${title} live view`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-overlay1">
            <Video size={28} />
          </div>
        )}
        {paused ? (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-live-bg px-2 py-[5px] font-mono text-[11px] leading-none font-semibold tracking-[0.05em] text-subtext1 uppercase shadow-[0_0_0_1px_var(--color-border)]">
            <Pause size={10} />
            Paused
          </span>
        ) : (
          live && <LiveBadge className="absolute top-2 left-2" />
        )}
      </div>
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="mb-0 line-clamp-1 font-display text-[15px] leading-[1.3] font-semibold tracking-tight text-text transition-colors group-hover:text-accent-ink">
            {title}
          </h4>
          {rank !== undefined && (
            <span className="shrink-0 rounded-full bg-accent px-[7px] py-[5px] font-mono text-xs leading-none font-bold text-on-accent">
              #{rank}
            </span>
          )}
        </div>
        {meta && (
          <p className="mt-0.5 mb-0 line-clamp-1 font-mono text-xs leading-[1.4] tracking-[0.02em] text-subtext1">
            {meta}
          </p>
        )}
      </div>
    </>
  )
  if (!link) return <div className={className}>{body}</div>
  return (
    <Link
      {...link}
      aria-current={selected ? 'true' : undefined}
      className={className}
    >
      {body}
    </Link>
  )
}
