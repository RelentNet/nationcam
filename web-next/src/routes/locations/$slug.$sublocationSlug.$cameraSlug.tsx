import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import type { Camera } from '@/lib/types'
import {
  fetchCamera,
  fetchSublocationBySlug,
  fetchSublocationsByState,
  fetchVideosBySublocation,
  fetchWeather,
} from '@/lib/api'
import { SITE_URL, seo, streamPoster } from '@/lib/seo'
import SublocationPage from '@/components/SublocationPage'

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

    // The page is the sublocation hub with this camera selected, so it needs
    // the sublocation, every camera here, the state's other spots and weather.
    const [sublocation, videos, siblings, weather] = await Promise.all([
      fetchSublocationBySlug(params.sublocationSlug),
      fetchVideosBySublocation(detail.camera.sublocation_id ?? 0),
      fetchSublocationsByState(params.slug),
      fetchWeather(params.sublocationSlug),
    ])
    return { ...detail, sublocation, videos, siblings, weather }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}
    const { camera } = loaderData
    const path = `/locations/${params.slug}/${params.sublocationSlug}/${params.cameraSlug}`
    const url = `${SITE_URL}${path}`
    const title = `${camera.title} Live Camera — ${camera.sublocation_name}, ${camera.state_name} | NationCam`
    const description = describe(camera)
    const isLive = camera.status === 'active'
    const poster = streamPoster(camera.src, isLive)

    const base = seo({ title, description, path, image: poster })
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
            thumbnailUrl: [poster ?? `${SITE_URL}/logo512.png`],
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
  const { slug } = Route.useParams()
  const { camera, sublocation, videos, siblings, weather } =
    Route.useLoaderData()
  return (
    <SublocationPage
      stateSlug={slug}
      sublocation={sublocation}
      videos={videos}
      featured={camera}
      camera={camera}
      siblings={siblings}
      weather={weather}
    />
  )
}
