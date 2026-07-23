import { Link } from '@tanstack/react-router'
import { MapPin, Star } from 'lucide-react'
import type { Video } from '@/lib/types'
import StreamPlayer from '@/components/StreamPlayer'
import LiveBadge from '@/components/LiveBadge'

/**
 * Pick one camera to feature. Prefers an active camera; falls back to any
 * camera if none are active, and returns null for an empty list (no hero).
 *
 * Call this in the route loader, never in render — `Math.random()` during
 * render picks a different camera on server vs client and desyncs hydration.
 */
export function pickFeatured(videos: Array<Video>): Video | null {
  const pool = videos.filter((v) => v.status === 'active')
  const from = pool.length > 0 ? pool : videos
  if (from.length === 0) return null
  return from[Math.floor(Math.random() * from.length)]
}

interface FeaturedHeroProps {
  video: Video
  stateSlug: string
  /** Sublocation slug for the camera link — required to link to the camera page. */
  sublocationSlug?: string
  /** Show the sublocation name (for the state page, which crosses sublocations). */
  showLocation?: boolean
}

export default function FeaturedHero({
  video,
  stateSlug,
  sublocationSlug,
  showLocation = false,
}: FeaturedHeroProps) {
  const isActive = video.status === 'active'
  const canLink = Boolean(stateSlug && sublocationSlug && video.slug)
  const linkParams = sublocationSlug
    ? { slug: stateSlug, sublocationSlug, cameraSlug: video.slug }
    : null

  const title = (
    <h2 className="mb-0 font-display text-xl font-semibold tracking-tight text-text transition-colors group-hover:text-accent sm:text-2xl">
      {video.title}
    </h2>
  )

  return (
    <section className="mb-14">
      <div className="mb-4 flex items-center gap-2">
        <Star size={14} className="text-accent" fill="currentColor" />
        <span className="font-mono text-xs tracking-wide text-subtext0 uppercase">
          Featured camera
        </span>
      </div>

      <article className="group relative overflow-hidden rounded-2xl border border-overlay0/60 bg-surface0 shadow-lg ring-1 ring-black/[0.03] dark:ring-white/[0.02]">
        <div className="relative">
          <StreamPlayer
            src={video.src}
            type={video.type}
            autoplay
            muted
            controls
            fluid
            live={isActive}
          />
          {isActive && (
            <LiveBadge className="absolute top-3 left-3 z-10 shadow-sm" />
          )}
        </div>

        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            {canLink && linkParams ? (
              <Link
                to="/locations/$slug/$sublocationSlug/$cameraSlug"
                params={linkParams}
              >
                {title}
              </Link>
            ) : (
              title
            )}

            {showLocation && video.sublocation_name && (
              <span className="inline-flex items-center gap-1 font-mono text-xs text-subtext0">
                <MapPin size={11} className="text-overlay2" />
                {video.sublocation_name}
              </span>
            )}
          </div>

          {canLink && linkParams && (
            <Link
              to="/locations/$slug/$sublocationSlug/$cameraSlug"
              params={linkParams}
              className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-accent px-5 py-2.5 font-sans font-semibold text-crust transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98] sm:self-auto"
            >
              Watch camera &rarr;
            </Link>
          )}
        </div>
      </article>
    </section>
  )
}
