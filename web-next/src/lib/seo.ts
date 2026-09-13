/** Canonical public origin — used for absolute URLs in meta tags and sitemap. */
export const SITE_URL = 'https://nationcam.com'

const OG_IMAGE = `${SITE_URL}/logo512.png`

interface SeoOptions {
  title: string
  description: string
  /** Absolute path on this site, e.g. `/locations/louisiana`. */
  path: string
  /** Share image (og/twitter). Absolute URL. Defaults to the site logo. */
  image?: string
}

/**
 * Share/thumbnail image for a camera. Restreamer writes a periodic JPEG frame
 * grab beside each HLS manifest (…/memfs/<id>.m3u8 → …/memfs/<id>.jpg), served
 * publicly — so a live frame becomes the social preview where the logo used to.
 * Returns undefined for a non-memfs src or an offline camera (whose snapshot may
 * be gone), so the caller falls back to the logo.
 */
export function streamPoster(src: string, isLive: boolean): string | undefined {
  if (!isLive) return undefined
  const m = src.match(/^(https?:\/\/[^?]+\/memfs\/[^/?]+)\.m3u8/)
  return m ? `${m[1]}.jpg` : undefined
}

/**
 * Builds the `head` payload for a route: title, description, OpenGraph,
 * Twitter card and canonical link. Spread into `createFileRoute({ head })`.
 */
export function seo({ title, description, path, image }: SeoOptions) {
  const url = `${SITE_URL}${path}`
  const ogImage = image ?? OG_IMAGE
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'NationCam' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: ogImage },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: ogImage },
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}
