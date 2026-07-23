import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ChevronRight, Eye } from 'lucide-react'
import type { Camera } from '@/lib/types'
import { fetchCamera } from '@/lib/api'
import { SITE_URL, seo } from '@/lib/seo'
import CameraPlayer from '@/components/CameraPlayer'
import VideoCard from '@/components/VideoCard'
import LiveBadge from '@/components/LiveBadge'
import Reveal from '@/components/Reveal'

function describe(camera: Camera): string {
  return `Watch ${camera.title}, a live streaming camera in ${camera.sublocation_name}, ${camera.state_name}. Free real-time video, streaming 24/7 on NationCam.`
}

export const Route = createFileRoute(
  '/locations/$slug/$sublocationSlug/$cameraSlug',
)({
  loader: async ({ params }) => {
    // Fetching this endpoint is also what records the view, so it must run on
    // every request — same catch-to-404 shape as the state/sublocation routes.
    const detail = await fetchCamera(
      params.slug,
      params.sublocationSlug,
      params.cameraSlug,
    ).catch(() => null)
    if (!detail) throw notFound()
    return detail
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}
    const { camera } = loaderData
    const path = `/locations/${params.slug}/${params.sublocationSlug}/${params.cameraSlug}`
    const url = `${SITE_URL}${path}`
    const title = `${camera.title} Live Camera — ${camera.sublocation_name}, ${camera.state_name} | NationCam`
    const description = describe(camera)
    const isLive = camera.status === 'active'

    const base = seo({ title, description, path })
    return {
      ...base,
      meta: [
        ...base.meta,
        // Overrides the generic `website` type from `seo()` — later entries win.
        { property: 'og:type', content: 'video.other' },
        { property: 'og:video', content: camera.src },
        {
          'script:ld+json': {
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            name: `${camera.title} Live Camera`,
            description,
            contentUrl: camera.src,
            embedUrl: url,
            thumbnailUrl: [`${SITE_URL}/logo512.png`],
            uploadDate: camera.created_at,
            isLiveBroadcast: isLive,
            publication: {
              '@type': 'BroadcastEvent',
              name: `${camera.title} live stream`,
              isLiveBroadcast: isLive,
              startDate: camera.created_at,
            },
            contentLocation: {
              '@type': 'Place',
              name: `${camera.sublocation_name}, ${camera.state_name}`,
            },
            interactionStatistic: {
              '@type': 'InteractionCounter',
              interactionType: { '@type': 'https://schema.org/WatchAction' },
              userInteractionCount: camera.view_count ?? 0,
            },
          },
        },
        {
          'script:ld+json': {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { name: 'Locations', item: `${SITE_URL}/locations` },
              {
                name: camera.state_name,
                item: `${SITE_URL}/locations/${params.slug}`,
              },
              {
                name: camera.sublocation_name,
                item: `${SITE_URL}/locations/${params.slug}/${params.sublocationSlug}`,
              },
              { name: camera.title, item: url },
            ].map((entry, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              ...entry,
            })),
          },
        },
      ],
    }
  },
  component: CameraPage,
  pendingComponent: LoadingSpinner,
  notFoundComponent: CameraNotFound,
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

function CameraNotFound() {
  const { slug, sublocationSlug } = Route.useParams()

  return (
    <div className="page-container page-enter text-center">
      <h2>Camera not found</h2>
      <p>The camera you are looking for does not exist.</p>
      <Link
        to="/locations/$slug/$sublocationSlug"
        params={{ slug, sublocationSlug }}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-2.5 font-sans font-semibold text-crust transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
      >
        Back to location
      </Link>
    </div>
  )
}

function CameraPage() {
  const { slug, sublocationSlug } = Route.useParams()
  const { camera, related } = Route.useLoaderData()
  const isLive = camera.status === 'active'

  return (
    <div className="page-container page-enter">
      {/* ── Breadcrumbs ── */}
      {/* `exact` keeps the router from marking every ancestor link
          aria-current="page" — only the trailing crumb is the current page. */}
      <nav
        aria-label="Breadcrumb"
        className="mb-5 flex flex-wrap items-center gap-1 font-mono text-xs text-subtext0"
      >
        <Link
          to="/locations"
          activeOptions={{ exact: true }}
          className="hover:text-accent"
        >
          Locations
        </Link>
        <ChevronRight size={12} className="text-overlay1" />
        <Link
          to="/locations/$slug"
          params={{ slug }}
          activeOptions={{ exact: true }}
          className="hover:text-accent"
        >
          {camera.state_name}
        </Link>
        <ChevronRight size={12} className="text-overlay1" />
        <Link
          to="/locations/$slug/$sublocationSlug"
          params={{ slug, sublocationSlug }}
          activeOptions={{ exact: true }}
          className="hover:text-accent"
        >
          {camera.sublocation_name}
        </Link>
        <ChevronRight size={12} className="text-overlay1" />
        <span aria-current="page" className="text-text">
          {camera.title}
        </span>
      </nav>

      {/* ── Player (optional skippable pre-roll, then the live stream) ── */}
      <CameraPlayer camera={camera} />

      {/* ── Title + meta ── */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="mb-0 text-3xl sm:text-4xl">{camera.title}</h1>
        {isLive && <LiveBadge />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 font-mono text-sm text-subtext0">
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <Eye size={14} className="text-overlay2" />
          {(camera.view_count ?? 0).toLocaleString('en-US')} view
          {camera.view_count === 1 ? '' : 's'}
        </span>
      </div>

      <p className="mt-4 max-w-3xl">{describe(camera)}</p>

      {/* ── Related cameras ── */}
      {related.length > 0 && (
        <section className="mt-14">
          <h3>More cameras in {camera.sublocation_name}</h3>
          <Reveal stagger>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((video) => (
                <VideoCard
                  key={video.video_id}
                  video={video}
                  stateSlug={video.state_slug}
                  sublocationSlug={video.sublocation_slug}
                />
              ))}
            </div>
          </Reveal>
        </section>
      )}
    </div>
  )
}
