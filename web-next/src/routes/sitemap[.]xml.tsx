import { createFileRoute } from '@tanstack/react-router'
import { fetchStates, fetchSublocationsByState, fetchVideos } from '@/lib/api'
import { SITE_URL } from '@/lib/seo'

const STATIC_PATHS = [
  '/',
  '/locations',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
]

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const [allStates, videos] = await Promise.all([
          fetchStates(),
          fetchVideos(),
        ])
        // Only states and sublocations that actually have cameras are listed:
        // empty "coming soon" pages are noindex'd and read as an unfinished
        // site to crawlers (and AdSense review), so keep them out of the map.
        const states = allStates.filter((state) => state.video_count > 0)

        // sublocation_id -> `{stateSlug}/{sublocationSlug}`, so camera rows
        // (which only carry ids) can be turned into URLs.
        const subPathById = new Map<number, string>()

        const locationPaths = await Promise.all(
          states.map(async (state) => {
            const sublocations = await fetchSublocationsByState(state.slug)
            // The sublocation hub page itself stays gated on having cameras
            // (an empty hub reads as unfinished, see above), but a conditions
            // page needs only coordinates — it has forecast/tide/river
            // content of its own even before a camera goes live there.
            return sublocations.flatMap((sub) => {
              const paths: Array<string> = []
              if (sub.video_count > 0) {
                subPathById.set(sub.sublocation_id, `${state.slug}/${sub.slug}`)
                paths.push(`/locations/${state.slug}/${sub.slug}`)
              }
              if (sub.lat != null && sub.lng != null) {
                paths.push(`/locations/${state.slug}/${sub.slug}/conditions`)
              }
              return paths
            })
          }),
        )
        const locationIndexPaths = states.map(
          (state) => `/locations/${state.slug}`,
        )

        // Camera pages — the highest-value URLs we have. Cameras with no
        // sublocation have no page to point at, so they are skipped.
        const cameraPaths = videos.flatMap((video) => {
          const subPath =
            video.sublocation_id && subPathById.get(video.sublocation_id)
          return subPath && video.slug
            ? [`/locations/${subPath}/${video.slug}`]
            : []
        })

        const urls = [
          ...STATIC_PATHS,
          ...locationIndexPaths,
          ...locationPaths.flat(),
          ...cameraPaths,
        ]
          .map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`)
          .join('\n')

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
          {
            headers: {
              'content-type': 'application/xml; charset=utf-8',
              // Slugs change about as often as states do — cache generously.
              'cache-control': 'public, max-age=3600',
            },
          },
        )
      },
    },
  },
})
