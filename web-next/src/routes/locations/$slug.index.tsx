import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { Radio, Video } from 'lucide-react'
import type { Sublocation } from '@/lib/types'
import {
  fetchStateBySlug,
  fetchSublocationsByState,
  fetchVideosByState,
} from '@/lib/api'
import { seo } from '@/lib/seo'
import LocationsHeroSection from '@/components/LocationsHeroSection'
import VideoCard from '@/components/VideoCard'
import CameraToolbar from '@/components/CameraToolbar'
import Reveal from '@/components/Reveal'
import { useCameraFilter } from '@/hooks/useCameraFilter'

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
    return { state, videos, sublocations }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}
    const { state, videos } = loaderData
    return seo({
      title: `${state.name} Live Cameras | NationCam`,
      description:
        videos.length > 0
          ? `Watch ${videos.length} live camera${videos.length === 1 ? '' : 's'} streaming from ${state.name} — ${state.description}. Free, real-time views from across the state.`
          : `Live cameras from ${state.name} — ${state.description}. New feeds are being added to NationCam soon.`,
      path: `/locations/${params.slug}`,
    })
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
      <Link
        to="/locations"
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-2.5 font-sans font-semibold text-crust transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
      >
        Back to locations
      </Link>
    </div>
  )
}

function StatePage() {
  const { slug } = Route.useParams()
  const { state, videos, sublocations } = Route.useLoaderData()

  // Search + sort across ALL videos on this state page
  const { search, setSearch, sort, setSort, filtered } = useCameraFilter(videos)

  // The video payload carries sublocation_id but not its slug, which the
  // camera-page links need.
  const subSlugById = new Map(
    sublocations.map((sub) => [sub.sublocation_id, sub.slug]),
  )

  // When searching, show a flat list (search crosses sublocation boundaries)
  const isSearching = search.trim().length > 0

  // Group filtered videos by sublocation for the default (non-search) view
  const sublocationSections = isSearching
    ? []
    : sublocations
        .map((sub) => ({
          sublocation: sub,
          videos: filtered.filter(
            (v) => v.sublocation_id === sub.sublocation_id,
          ),
        }))
        .filter(({ videos: subVideos }) => subVideos.length > 0)

  const uncategorizedVideos = isSearching
    ? []
    : filtered.filter((v) => !v.sublocation_id)

  return (
    <div>
      <LocationsHeroSection title={state.name} slug={slug} />

      <div className="page-container">
        {/* Toolbar — always visible when there are videos */}
        {videos.length > 0 && (
          <CameraToolbar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            resultCount={filtered.length}
          />
        )}

        {/* ── Search results (flat list) ── */}
        {isSearching && (
          <>
            {filtered.length > 0 ? (
              <Reveal stagger>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((video) => (
                    <VideoCard
                      key={video.video_id}
                      video={video}
                      showLocation
                      stateSlug={slug}
                      sublocationSlug={
                        video.sublocation_id
                          ? subSlugById.get(video.sublocation_id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </Reveal>
            ) : (
              <Reveal variant="scale">
                <div className="section-container py-12 text-center">
                  <p className="mb-0 text-subtext0">
                    No cameras matching &ldquo;{search}&rdquo;
                  </p>
                </div>
              </Reveal>
            )}
          </>
        )}

        {/* ── Default view: grouped by sublocation ── */}
        {!isSearching && (
          <>
            {sublocationSections.map(({ sublocation, videos: subVideos }) => (
              <Reveal key={sublocation.sublocation_id} variant="float">
                <section className="mb-14">
                  <SublocationHeader
                    sublocation={sublocation}
                    slug={slug}
                    videoCount={subVideos.length}
                  />
                  <Reveal stagger>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {subVideos.map((video) => (
                        <VideoCard
                          key={video.video_id}
                          video={video}
                          stateSlug={slug}
                          sublocationSlug={sublocation.slug}
                        />
                      ))}
                    </div>
                  </Reveal>
                </section>
              </Reveal>
            ))}

            {/* Uncategorized videos */}
            {uncategorizedVideos.length > 0 && (
              <Reveal variant="float">
                <section className="mb-14">
                  <h3>Other Cameras</h3>
                  <Reveal stagger>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {uncategorizedVideos.map((video) => (
                        <VideoCard
                          key={video.video_id}
                          video={video}
                          showLocation
                        />
                      ))}
                    </div>
                  </Reveal>
                </section>
              </Reveal>
            )}
          </>
        )}

        {/* Empty state — no videos at all */}
        {videos.length === 0 && (
          <Reveal variant="scale">
            <div className="section-container py-12 text-center">
              <Video size={32} className="mx-auto mb-4 text-overlay1" />
              <p className="mb-0">
                No cameras available for {state.name} yet. Check back soon!
              </p>
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
    <div className="mb-5 flex items-baseline gap-3">
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
