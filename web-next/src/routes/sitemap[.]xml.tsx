import { createFileRoute } from '@tanstack/react-router'
import { fetchStates, fetchSublocationsByState } from '@/lib/api'
import { SITE_URL } from '@/lib/seo'

const STATIC_PATHS = ['/', '/locations', '/contact']

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const states = await fetchStates()
        const locationPaths = await Promise.all(
          states.map(async (state) => {
            const sublocations = await fetchSublocationsByState(state.slug)
            return [
              `/locations/${state.slug}`,
              ...sublocations.map(
                (sub) => `/locations/${state.slug}/${sub.slug}`,
              ),
            ]
          }),
        )

        const urls = [...STATIC_PATHS, ...locationPaths.flat()]
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
