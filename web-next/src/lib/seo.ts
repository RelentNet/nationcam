/** Canonical public origin — used for absolute URLs in meta tags and sitemap. */
export const SITE_URL = 'https://nationcam.com'

const OG_IMAGE = `${SITE_URL}/logo512.png`

interface SeoOptions {
  title: string
  description: string
  /** Absolute path on this site, e.g. `/locations/louisiana`. */
  path: string
}

/**
 * Builds the `head` payload for a route: title, description, OpenGraph,
 * Twitter card and canonical link. Spread into `createFileRoute({ head })`.
 */
export function seo({ title, description, path }: SeoOptions) {
  const url = `${SITE_URL}${path}`
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'NationCam' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: OG_IMAGE },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: OG_IMAGE },
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}
