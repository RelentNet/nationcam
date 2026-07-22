import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { Video } from 'lucide-react'
import { fetchSublocationBySlug, fetchVideosBySublocation } from '@/lib/api'
import { seo } from '@/lib/seo'
import LocationsHeroSection from '@/components/LocationsHeroSection'
import VideoCard from '@/components/VideoCard'
import CameraToolbar from '@/components/CameraToolbar'
import Reveal from '@/components/Reveal'
import { useCameraFilter } from '@/hooks/useCameraFilter'

export const Route = createFileRoute('/locations/$slug/$sublocationSlug/')({
  loader: async ({ params }) => {
    const sublocation = await fetchSublocationBySlug(
      params.sublocationSlug,
    ).catch(() => null)
    if (!sublocation) throw notFound()

    const videos = await fetchVideosBySublocation(sublocation.sublocation_id)
    return { sublocation, videos }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}
    const { sublocation, videos } = loaderData
    return seo({
      title: `${sublocation.name} Live Cameras — ${sublocation.state_name} | NationCam`,
      description:
        videos.length > 0
          ? `Watch ${videos.length} live camera${videos.length === 1 ? '' : 's'} streaming from ${sublocation.name} in ${sublocation.state_name}.${sublocation.description ? ` ${sublocation.description}` : ''}`
          : `Live cameras from ${sublocation.name} in ${sublocation.state_name} are coming to NationCam soon.`,
      path: `/locations/${params.slug}/${params.sublocationSlug}`,
    })
  },
  component: SublocationPage,
  pendingComponent: LoadingSpinner,
  notFoundComponent: SublocationNotFound,
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

function SublocationNotFound() {
  const { slug } = Route.useParams()

  return (
    <div className="page-container page-enter text-center">
      <h2>Location not found</h2>
      <p>The location you are looking for does not exist.</p>
      <Link
        to="/locations/$slug"
        params={{ slug }}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-2.5 font-sans font-semibold text-crust transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
      >
        Back to state
      </Link>
    </div>
  )
}

function SublocationPage() {
  const { slug, sublocationSlug } = Route.useParams()
  const { sublocation, videos } = Route.useLoaderData()

  const { search, setSearch, sort, setSort, filtered } = useCameraFilter(videos)

  return (
    <div>
      <LocationsHeroSection title={sublocation.name} slug={sublocation.slug} />

      <div className="page-container">
        {/* Toolbar */}
        {videos.length > 0 && (
          <CameraToolbar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            resultCount={filtered.length}
          />
        )}

        {filtered.length > 0 ? (
          <Reveal stagger>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((video) => (
                <VideoCard
                  key={video.video_id}
                  video={video}
                  stateSlug={slug}
                  sublocationSlug={sublocationSlug}
                />
              ))}
            </div>
          </Reveal>
        ) : videos.length > 0 && search.trim() ? (
          <Reveal variant="scale">
            <div className="section-container py-12 text-center">
              <p className="mb-0 text-subtext0">
                No cameras matching &ldquo;{search}&rdquo;
              </p>
            </div>
          </Reveal>
        ) : (
          <Reveal variant="scale">
            <div className="section-container py-12 text-center">
              <Video size={32} className="mx-auto mb-4 text-overlay1" />
              <p className="mb-0">
                No cameras available for {sublocation.name} yet. Check back
                soon!
              </p>
            </div>
          </Reveal>
        )}
      </div>
    </div>
  )
}
