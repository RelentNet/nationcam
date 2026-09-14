import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import {
  fetchSublocationBySlug,
  fetchSublocationsByState,
  fetchVideosBySublocation,
  fetchWeather,
} from '@/lib/api'
import { pickFeatured } from '@/lib/featured'
import { seo, streamPoster } from '@/lib/seo'
import SublocationPage from '@/components/SublocationPage'

export const Route = createFileRoute('/locations/$slug/$sublocationSlug/')({
  loader: async ({ params }) => {
    const sublocation = await fetchSublocationBySlug(
      params.sublocationSlug,
    ).catch(() => null)
    if (!sublocation) throw notFound()

    const [videos, siblings, weather] = await Promise.all([
      fetchVideosBySublocation(sublocation.sublocation_id),
      fetchSublocationsByState(params.slug),
      fetchWeather(params.sublocationSlug),
    ])
    // Pick the featured camera server-side so the client hydrates the same one.
    return {
      sublocation,
      videos,
      siblings,
      weather,
      featured: pickFeatured(videos),
    }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}
    const { sublocation, videos, featured } = loaderData
    const base = seo({
      title: `${sublocation.name} Live Cameras — ${sublocation.state_name} | NationCam`,
      description:
        videos.length > 0
          ? `Watch ${videos.length} live camera${videos.length === 1 ? '' : 's'} streaming from ${sublocation.name} in ${sublocation.state_name}.${sublocation.description ? ` ${sublocation.description}` : ''}`
          : `Live cameras from ${sublocation.name} in ${sublocation.state_name} are coming to NationCam soon.`,
      path: `/locations/${params.slug}/${params.sublocationSlug}`,
      image: featured
        ? streamPoster(featured.src, featured.status === 'active')
        : undefined,
    })
    // No cameras yet → placeholder; keep it out of the index (see state page).
    if (videos.length === 0) {
      return {
        ...base,
        meta: [...base.meta, { name: 'robots', content: 'noindex, follow' }],
      }
    }
    return base
  },
  component: SublocationRoute,
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

function SublocationRoute() {
  const { slug } = Route.useParams()
  const data = Route.useLoaderData()
  return <SublocationPage stateSlug={slug} {...data} />
}
