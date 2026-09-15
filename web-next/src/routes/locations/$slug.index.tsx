import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ChevronRight, Radio, Video } from 'lucide-react'
import type { Sublocation } from '@/lib/types'
import {
  fetchStateBySlug,
  fetchSublocationsByState,
  fetchVideosByState,
} from '@/lib/api'
import { pickFeatured } from '@/lib/featured'
import { seo, streamPoster } from '@/lib/seo'
import LocationsHeroSection from '@/components/LocationsHeroSection'
import CameraToolbar from '@/components/CameraToolbar'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import BannerSlot from '@/components/BannerSlot'
import Reveal from '@/components/Reveal'
import { AboutSection } from '@/components/EditorialText'
import {
  CTA_CLASS,
  FeaturedBlock,
  sublocationMeta,
} from '@/components/SublocationPage'
import { useCameraFilter } from '@/hooks/useCameraFilter'

/** The search/sort toolbar only earns its space once the page gets long. */
const TOOLBAR_MIN = 12

export const Route = createFileRoute('/locations/$slug/')({
  loader: async ({ params }) => {
    // The old client page swallowed every failure into "state not found";
    // keep that behaviour, but as a real 404 rather than a 200 with no content.
    const state = await fetchStateBySlug(params.slug).catch(() => null)
    if (!state) throw notFound()

    const [videos, sublocations] = await Promise.all([
      fetchVideosByState(state.state_id),
      fetchSublocationsByState(params.slug),
    ])
    // Pick the featured camera server-side so the client hydrates the same one.
    return { state, videos, sublocations, featured: pickFeatured(videos) }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}
    const { state, videos, featured } = loaderData
    const base = seo({
      title: `${state.name} Live Cameras | NationCam`,
      description:
        videos.length > 0
          ? `Watch ${videos.length} live camera${videos.length === 1 ? '' : 's'} streaming from ${state.name} — ${state.description}. Free, real-time views from across the state.`
          : `Live cameras from ${state.name} — ${state.description}. New feeds are being added to NationCam soon.`,
      path: `/locations/${params.slug}`,
      image: featured
        ? streamPoster(featured.src, featured.status === 'active')
        : undefined,
    })
    // A state with no cameras yet is a placeholder — keep it out of the index
    // so crawlers (and AdSense review) don't read the site as unfinished.
    if (videos.length === 0) {
      return {
        ...base,
        meta: [...base.meta, { name: 'robots', content: 'noindex, follow' }],
      }
    }
    return base
  },
  component: StatePage,
  pendingComponent: LoadingSpinner,
  notFoundComponent: StateNotFound,
})

function LoadingSpinner() {
  return (
    <div className="page-container">
      <div
        className="flex flex-col items-center justify-center py-20"
        style={{
          opacity: 0,
          animation: 'scale-fade-in 500ms var(--spring-poppy) forwards',
        }}
      >
        <div
          className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent"
          style={{ animation: 'spin 800ms linear infinite' }}
        />
        <p className="mt-4 font-mono text-sm text-subtext0">Loading...</p>
      </div>
    </div>
  )
}

function StateNotFound() {
  return (
    <div className="page-container page-enter text-center">
      <h2>State not found</h2>
      <p>The location you are looking for does not exist.</p>
      <Link to="/locations" className={CTA_CLASS}>
        Back to locations
      </Link>
    </div>
  )
}

function StatePage() {
  const { slug } = Route.useParams()
  const { state, videos, sublocations, featured } = Route.useLoaderData()
  const tick = usePosterTick()

  // Search + sort across every camera on the page; tiles stay grouped.
  const { search, setSearch, sort, setSort, filtered } = useCameraFilter(videos)

  const liveCount = videos.filter((v) => v.status === 'active').length
  const featuredSub = sublocations.find(
    (s) => s.sublocation_id === featured?.sublocation_id,
  )
  const sections = sublocations
    .map((sub) => ({
      sublocation: sub,
      videos: filtered.filter((v) => v.sublocation_id === sub.sublocation_id),
    }))
    .filter(({ videos: subVideos }) => subVideos.length > 0)
  const uncategorized = filtered.filter((v) => !v.sublocation_id)

  return (
    <div>
      <LocationsHeroSection
        title={state.name}
        branding={state}
        tagline={state.description || undefined}
        breadcrumb={
          <>
            <Link
              to="/locations"
              activeOptions={{ exact: true }}
              className="transition-colors hover:text-accent"
            >
              Locations
            </Link>
            <ChevronRight size={12} />
            <span aria-current="page" className="text-text">
              {state.name}
            </span>
          </>
        }
        stats={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_0_3px_rgba(220,38,38,0.25)]" />
              {liveCount} live camera{liveCount === 1 ? '' : 's'}
            </span>
            <span>
              {sublocations.length} location
              {sublocations.length === 1 ? '' : 's'}
            </span>
          </>
        }
      />

      <div className="page-container">
        {featured && (
          <FeaturedBlock
            video={featured}
            sublocation={featuredSub}
            stateSlug={slug}
          >
            {/* ── Camera strip, grouped by sublocation ── */}
            {videos.length > 0 && (
              <section className="mt-8">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="mb-0 text-xl">Cameras in {state.name}</h2>
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

                {sections.map(({ sublocation, videos: subVideos }) => (
                  <div key={sublocation.sublocation_id} className="mb-10">
                    <SublocationHeader
                      sublocation={sublocation}
                      slug={slug}
                      videoCount={subVideos.length}
                    />
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                      {subVideos.map((v) => (
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
                              slug,
                              sublocationSlug: sublocation.slug,
                              cameraSlug: v.slug,
                            },
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {uncategorized.length > 0 && (
                  <div className="mb-10">
                    <h3>Other Cameras</h3>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                      {uncategorized.map((v) => (
                        <PosterTile
                          key={v.video_id}
                          title={v.title}
                          poster={streamPoster(v.src, v.status === 'active')}
                          live={v.status === 'active'}
                          selected={v.video_id === featured.video_id}
                          tick={tick}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {filtered.length === 0 && (
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
            <AboutSection title={`About ${state.name}`} text={state.about} />
          </div>
          <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
            {sublocations.length > 0 && (
              <div>
                <p className="mb-3 font-mono text-[11px] tracking-[0.08em] text-subtext0 uppercase">
                  Locations in {state.name}
                </p>
                <div className="grid gap-3">
                  {sublocations.map((s) => (
                    <PosterTile
                      key={s.sublocation_id}
                      title={s.name}
                      meta={sublocationMeta(s)}
                      poster={streamPoster(s.first_src, true)}
                      live={s.video_count > 0}
                      tick={tick}
                      link={{
                        to: '/locations/$slug/$sublocationSlug',
                        params: { slug, sublocationSlug: s.slug },
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <BannerSlot placement="right" stateId={state.state_id} />
          </aside>
        </div>

        {/* Empty state — no cameras yet. Framed as an invitation, not a
            placeholder: the page is noindex'd (see head), and for humans it
            should read as "we're coming here", not "this is broken". */}
        {videos.length === 0 && (
          <Reveal variant="scale">
            <div className="section-container py-12 text-center">
              <Video size={32} className="mx-auto mb-4 text-overlay1" />
              <h3>
                {state.upcoming ? 'Coming soon to' : 'Coming to'} {state.name}
              </h3>
              <p className="mx-auto max-w-lg">
                {state.upcoming ? (
                  <>
                    A camera is confirmed for {state.name} and will be live
                    soon. Know another spot here worth watching? You could host
                    it &mdash; it costs nothing.
                  </>
                ) : (
                  <>
                    We don&rsquo;t have a live camera in {state.name} yet. If
                    you run a marina, a waterfront restaurant, a hotel with a
                    view, or any place worth watching, you could host the first
                    one &mdash; it costs nothing.
                  </>
                )}
              </p>
              <Link to="/contact" className={CTA_CLASS}>
                Host a camera in {state.name} &rarr;
              </Link>
            </div>
          </Reveal>
        )}
      </div>
    </div>
  )
}

/* ──── Sublocation Section Header ──── */

function SublocationHeader({
  sublocation,
  slug,
  videoCount,
}: {
  sublocation: Sublocation
  slug: string
  videoCount: number
}) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <Link
        to="/locations/$slug/$sublocationSlug"
        params={{ slug, sublocationSlug: sublocation.slug }}
        className="group inline-flex items-baseline gap-2"
      >
        <h3 className="mb-0 transition-colors group-hover:text-accent">
          {sublocation.name}
        </h3>
        <span className="font-mono text-sm text-subtext0 opacity-0 transition-opacity group-hover:opacity-100">
          View all &rarr;
        </span>
      </Link>
      <div className="flex items-center gap-1.5">
        <Radio size={10} className="text-live" />
        <span className="font-mono text-xs text-subtext0">
          {videoCount} camera{videoCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
