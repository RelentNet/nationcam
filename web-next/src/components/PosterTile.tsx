import { Link } from '@tanstack/react-router'
import { Video } from 'lucide-react'
import { useEffect, useState } from 'react'

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
  /** Highlighted as the camera currently in the featured player. */
  selected?: boolean
  /** From `usePosterTick` — appended as `?t=` to bust the poster cache. */
  tick?: number
  /** Where the tile goes; omit for a camera with no page of its own. */
  link?: LinkTarget
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
  selected = false,
  tick = 0,
  link,
}: PosterTileProps) {
  const src = poster && tick ? `${poster}?t=${tick}` : poster
  const className = `group block overflow-hidden rounded-xl border bg-surface0 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-accent ${
    selected
      ? 'border-accent shadow-[0_0_0_3px_var(--color-accent-glow)]'
      : 'border-overlay0/60'
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
        {live && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-white uppercase">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-live"
              style={{ animation: 'pulse-live 1.5s ease-in-out infinite' }}
            />
            Live
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <h4 className="mb-0 line-clamp-1 font-display text-[15px] font-semibold tracking-tight text-text transition-colors group-hover:text-accent">
          {title}
        </h4>
        {meta && (
          <p className="mt-0.5 mb-0 line-clamp-1 text-[13px] text-subtext1">
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
