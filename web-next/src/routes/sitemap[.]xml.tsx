import { createFileRoute } from '@tanstack/react-router'
import { fetchStates, fetchSublocationsByState, fetchVideos } from '@/lib/api'
import { SITE_URL } from '@/lib/seo'

const STATIC_PATHS = ['/', '/locations', '/contact']

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const [states, videos] = await Promise.all([
          fetchStates(),
          fetchVideos(),
        ])

        // sublocation_id -> `{stateSlug}/{sublocationSlug}`, so camera rows
        // (which only carry ids) can be turned into URLs.
        const subPathById = new Map<number, string>()

        const locationPaths = await Promise.all(
          states.map(async (state) => {
            const sublocations = await fetchSublocationsByState(state.slug)
            return [
              `/locations/${state.slug}`,
              ...sublocations.map((sub) => {
                subPathById.set(sub.sublocation_id, `${state.slug}/${sub.slug}`)
                return `/locations/${state.slug}/${sub.slug}`
              }),
            ]
          }),
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

        const urls = [...STATIC_PATHS, ...locationPaths.flat(), ...cameraPaths]
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
