import { createFileRoute } from '@tanstack/react-router'
import {
  fetchPosts,
  fetchStates,
  fetchSublocationsByState,
  fetchVideos,
} from '@/lib/api'
import { SITE_URL } from '@/lib/seo'

const STATIC_PATHS = [
  '/',
  '/locations',
  '/notes',
  '/events',
  '/about',
  '/contact',
  '/construction',
  '/privacy',
  '/terms',
  '/cameras/popular',
  '/cameras/new',
]

// The public listing is paginated (max 100/page), so every published slug is
// collected with a bounded page loop rather than one huge request. The loop
// cap is generous headroom over any realistic post count so a pagination bug
// cannot hang the sitemap request.
async function fetchAllPublishedPostSlugs(): Promise<Array<string>> {
  const limit = 100
  const slugs: Array<string> = []
  for (let offset = 0, page = 0; page < 50; page++, offset += limit) {
    const { data, has_more } = await fetchPosts({ limit, offset })
    slugs.push(...data.map((p) => p.slug))
    if (!has_more) break
  }
  return slugs
}

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const [allStates, videos, notePaths] = await Promise.all([
          fetchStates(),
          fetchVideos(),
          fetchAllPublishedPostSlugs().then((slugs) =>
            slugs.map((slug) => `/notes/${slug}`),
          ),
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

        // Snapshot archive — only active cameras actually accumulate stills,
        // so an inactive camera's archive page is left out.
        const archivePaths = videos.flatMap((video) => {
          const subPath =
            video.sublocation_id && subPathById.get(video.sublocation_id)
          return subPath && video.slug && video.status === 'active'
            ? [`/locations/${subPath}/${video.slug}/archive`]
            : []
        })

        const urls = [
          ...STATIC_PATHS,
          ...locationIndexPaths,
          ...locationPaths.flat(),
          ...cameraPaths,
          ...archivePaths,
          ...notePaths,
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
