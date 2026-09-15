import { Link } from '@tanstack/react-router'
import { ChevronRight, Eye, MapPin, Video as VideoIcon } from 'lucide-react'
import type { Camera, Sublocation, Video, Weather } from '@/lib/types'
import { streamPoster } from '@/lib/seo'
import LocationsHeroSection from '@/components/LocationsHeroSection'
import CameraPlayer from '@/components/CameraPlayer'
import CameraToolbar from '@/components/CameraToolbar'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import NowPanel, { LocalClock, sinceLabel } from '@/components/NowPanel'
import BannerSlot from '@/components/BannerSlot'
import Reveal from '@/components/Reveal'
import { AboutSection } from '@/components/EditorialText'
import { useCameraFilter } from '@/hooks/useCameraFilter'

/** The search/sort toolbar only earns its space once the strip gets long. */
const TOOLBAR_MIN = 12

export const CTA_CLASS =
  'inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-sans font-semibold text-crust transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]'

interface SublocationPageProps {
  stateSlug: string
  sublocation: Sublocation
  videos: Array<Video>
  /** The camera in the featured player; null when the sublocation has none. */
  featured: Video | null
  /** Set on the camera route — adds that camera's About and view count. */
  camera?: Camera
  /** Every sublocation in the state; this one is filtered out for "More in". */
  siblings: Array<Sublocation>
  weather: Weather | null
}

/**
 * One view for the sublocation hub and the camera page: compact hero, the
 * single live player beside the "Right now" panel, a poster strip of every
 * camera here, About copy with a side column, then the state's other spots.
 */
export default function SublocationPage({
  stateSlug,
  sublocation,
  videos,
  featured,
  camera,
  siblings,
  weather,
}: SublocationPageProps) {
  const tick = usePosterTick()
  const { search, setSearch, sort, setSort, filtered } = useCameraFilter(videos)
  const liveCount = videos.filter((v) => v.status === 'active').length
  const others = siblings.filter(
    (s) => s.sublocation_id !== sublocation.sublocation_id,
  )
  const hasVisit = Boolean(
    sublocation.address || sublocation.host_name || sublocation.lat != null,
  )
  const crumbLink = 'transition-colors hover:text-accent'

  return (
    <div>
      <LocationsHeroSection
        title={sublocation.name}
        branding={sublocation}
        tagline={sublocation.description || undefined}
        breadcrumb={
          <>
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
              params={{ slug: stateSlug }}
              activeOptions={{ exact: true }}
              className={crumbLink}
            >
              {sublocation.state_name}
            </Link>
            <ChevronRight size={12} />
            {camera ? (
              <>
                <Link
                  to="/locations/$slug/$sublocationSlug"
                  params={{
                    slug: stateSlug,
                    sublocationSlug: sublocation.slug,
                  }}
                  activeOptions={{ exact: true }}
                  className={crumbLink}
                >
                  {sublocation.name}
                </Link>
                <ChevronRight size={12} />
                <span aria-current="page" className="text-text">
                  {camera.title}
                </span>
              </>
            ) : (
              <span aria-current="page" className="text-text">
                {sublocation.name}
              </span>
            )}
          </>
        }
        stats={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_0_3px_rgba(220,38,38,0.25)]" />
              {liveCount} live camera{liveCount === 1 ? '' : 's'}
            </span>
            {weather && (
              <LocalClock
                timeZone={weather.timezone}
                initial={weather.fetched_at}
              />
            )}
          </>
        }
      />

      <div className="page-container">
        {featured && (
          <FeaturedBlock
            video={featured}
            sublocation={sublocation}
            stateSlug={stateSlug}
            camera={camera}
            weather={weather}
          >
            {/* ── Camera strip — posters, not players ── */}
            {videos.length > 0 && (
              <section className="mt-8">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="mb-0 text-xl">
                    Cameras at {sublocation.name}
                  </h2>
                  <span className="font-mono text-xs text-subtext0">
                    {liveCount} live &middot; tap to switch
                  </span>
                </div>
                {videos.length > TOOLBAR_MIN && (
                  <CameraToolbar
                    search={search}
                    onSearchChange={setSearch}
                    sort={sort}
                    onSortChange={setSort}
                    resultCount={filtered.length}
                  />
                )}
                {filtered.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {filtered.map((v) => (
                      <PosterTile
                        key={v.video_id}
                        title={v.title}
                        poster={streamPoster(v.src, v.status === 'active')}
                        live={v.status === 'active'}
                        selected={v.video_id === featured.video_id}
                        tick={tick}
                        link={{
                          to: '/locations/$slug/$sublocationSlug/$cameraSlug',
                          params: {
                            slug: stateSlug,
                            sublocationSlug: sublocation.slug,
                            cameraSlug: v.slug,
                          },
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mb-0 text-subtext0">
                    No cameras matching &ldquo;{search}&rdquo;
                  </p>
                )}
              </section>
            )}
          </FeaturedBlock>
        )}

        {/* ── About + side column ── */}
        <div className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {camera && (
              <AboutSection
                title={`About ${camera.title}`}
                text={camera.about}
              />
            )}
            <AboutSection
              title={`About ${sublocation.name}`}
              text={sublocation.about}
            />
          </div>
          <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
            {hasVisit && <PlanVisitCard sublocation={sublocation} />}
            {/* Third distinct creative on desktop: the 320px column takes the
                mobile unit, so the right-rail ad is not repeated. Hidden below
                xl, where the root layout already shows the mobile slot. */}
            <BannerSlot
              placement="mobile"
              videoId={camera?.video_id}
              sublocationId={camera ? undefined : sublocation.sublocation_id}
              className="hidden xl:block"
            />
          </aside>
        </div>

        {/* ── More in this state ── */}
        {others.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-4 text-xl">More in {sublocation.state_name}</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {others.map((s) => (
                <PosterTile
                  key={s.sublocation_id}
                  title={s.name}
                  meta={sublocationMeta(s)}
                  poster={streamPoster(s.first_src, true)}
                  live={s.video_count > 0}
                  tick={tick}
                  link={{
                    to: '/locations/$slug/$sublocationSlug',
                    params: { slug: stateSlug, sublocationSlug: s.slug },
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty state — framed as an invitation (the page is noindex'd). */}
        {videos.length === 0 && (
          <Reveal variant="scale">
            <div className="section-container mt-12 py-12 text-center">
              <VideoIcon size={32} className="mx-auto mb-4 text-overlay1" />
              <h3>Coming to {sublocation.name}</h3>
              <p className="mx-auto max-w-lg">
                We don&rsquo;t have a live camera at {sublocation.name} yet.
                Know a spot here worth watching? You could host the first one
                &mdash; it costs nothing.
              </p>
              <Link to="/contact" className={CTA_CLASS}>
                Host a camera here &rarr;
              </Link>
            </div>
          </Reveal>
        )}
      </div>
    </div>
  )
}

/**
 * The page's one live player (pre-roll gated) with title and meta beneath, the
 * "Right now" panel beside it when there is weather, and a "Watch full page"
 * link on hub pages. `children` (the camera strip) render in the player's
 * column, so they sit under the picture on desktop and above the panel when
 * the two stack on mobile. Shared with the state page.
 */
export function FeaturedBlock({
  video,
  sublocation,
  stateSlug,
  camera,
  weather = null,
  children,
}: {
  video: Video
  /** The camera's sublocation — needed for the full-page link and the panel. */
  sublocation?: Sublocation
  stateSlug: string
  camera?: Camera
  weather?: Weather | null
  children?: React.ReactNode
}) {
  const panel = weather && sublocation
  return (
    <div
      className={
        panel ? 'grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]' : ''
      }
    >
      <div>
        <CameraPlayer camera={video} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="mb-0 text-2xl">{video.title}</h2>
            <p className="mt-1 mb-0 flex flex-wrap items-center gap-3 font-mono text-xs text-subtext0">
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} className="text-overlay2" />
                {video.sublocation_name
                  ? `${video.sublocation_name}, ${video.state_name}`
                  : video.state_name}
              </span>
              {camera && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Eye size={12} className="text-overlay2" />
                  {(camera.view_count ?? 0).toLocaleString('en-US')} view
                  {camera.view_count === 1 ? '' : 's'}
                </span>
              )}
            </p>
          </div>
          {!camera && sublocation && (
            <Link
              to="/locations/$slug/$sublocationSlug/$cameraSlug"
              params={{
                slug: stateSlug,
                sublocationSlug: sublocation.slug,
                cameraSlug: video.slug,
              }}
              className={CTA_CLASS}
            >
              Watch full page &rarr;
            </Link>
          )}
        </div>
        {children}
      </div>
      {panel && <NowPanel weather={weather} sublocation={sublocation} />}
    </div>
  )
}

/** One-line tile meta for a sublocation: its tagline and/or camera count. */
export function sublocationMeta(s: Sublocation): string {
  const count = `${s.video_count} camera${s.video_count === 1 ? '' : 's'}`
  return s.description ? `${s.description} · ${count}` : count
}

function PlanVisitCard({ sublocation: s }: { sublocation: Sublocation }) {
  return (
    <div className="rounded-2xl border border-overlay0 bg-surface0 p-5">
      <p className="mb-3 font-mono text-[11px] tracking-[0.08em] text-subtext0 uppercase">
        Plan a visit
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {s.address && (
          <>
            <dt className="text-subtext0">Address</dt>
            <dd className="mb-0 whitespace-pre-line text-text">{s.address}</dd>
          </>
        )}
        {s.host_name && (
          <>
            <dt className="text-subtext0">Host</dt>
            <dd className="mb-0 text-text">
              {s.host_url ? (
                <a
                  href={s.host_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {s.host_name}
                </a>
              ) : (
                s.host_name
              )}
            </dd>
          </>
        )}
        {s.host_since && (
          <>
            <dt className="text-subtext0">Since</dt>
            <dd className="mb-0 text-text">{sinceLabel(s.host_since)}</dd>
          </>
        )}
      </dl>
      {/* Search by the street address when there is one: it lands on the
          business pin, where the coordinates only get within a block or so. */}
      {(s.address || (s.lat != null && s.lng != null)) && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address || `${s.lat},${s.lng}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
        >
          Open in Maps ↗
        </a>
      )}
    </div>
  )
}
