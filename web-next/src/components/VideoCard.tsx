import { Link } from '@tanstack/react-router'
import { MapPin } from 'lucide-react'
import type { Video } from '@/lib/types'
import StreamPlayer from '@/components/StreamPlayer'
import LiveBadge from '@/components/LiveBadge'

interface VideoCardProps {
  video: Video
  /** Show sublocation name beneath the title */
  showLocation?: boolean
  /**
   * Slugs of the camera's state and sublocation. Both are needed to build the
   * camera page URL — without them the title renders unlinked (the video list
   * endpoints do not return the parent slugs).
   */
  stateSlug?: string
  sublocationSlug?: string
}

export default function VideoCard({
  video,
  showLocation = false,
  stateSlug,
  sublocationSlug,
}: VideoCardProps) {
  const isActive = video.status === 'active'

  const title = (
    <h4 className="mb-0 line-clamp-2 font-display text-base leading-snug font-semibold tracking-tight text-text transition-colors group-hover:text-accent sm:text-lg">
      {video.title}
    </h4>
  )

  return (
    <article className="reveal-scale group relative flex flex-col overflow-hidden rounded-2xl border border-overlay0/60 bg-surface0 shadow-md ring-1 ring-black/[0.03] transition-all duration-350 ease-[var(--spring-snappy)] hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:ring-accent/10 dark:ring-white/[0.02]">
      {/* ── Stream viewport ── */}
      <div className="relative">
        <StreamPlayer
          src={video.src}
          type={video.type}
          muted
          controls
          fluid
          live={isActive}
        />

        {/* Status badge overlay */}
        {isActive && (
          <LiveBadge className="absolute top-3 left-3 z-10 shadow-sm" />
        )}
      </div>

      {/* ── Card body ── */}
      <div className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
        {/* Title — links to the camera page when we know its parent slugs */}
        {stateSlug && sublocationSlug && video.slug ? (
          <Link
            to="/locations/$slug/$sublocationSlug/$cameraSlug"
            params={{
              slug: stateSlug,
              sublocationSlug,
              cameraSlug: video.slug,
            }}
          >
            {title}
          </Link>
        ) : (
          title
        )}

        {/* Meta row */}
        <div className="flex items-center gap-3 font-mono text-xs text-subtext0">
          {showLocation && video.sublocation_name && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={11} className="text-overlay2" />
              {video.sublocation_name}
            </span>
          )}
        </div>
      </div>

      {/* ── Bottom accent bar ── */}
      <div
        className="h-[2px] w-full origin-left scale-x-0 transition-transform duration-350 ease-[var(--spring-snappy)] group-hover:scale-x-100"
        style={{
          background:
            'linear-gradient(90deg, var(--color-accent), var(--color-teal))',
        }}
      />
    </article>
  )
}
