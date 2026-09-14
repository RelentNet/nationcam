import type { Branding } from '@/lib/types'

const DEFAULT_HERO = '/videos/nc_default_hero.webm'
const DEFAULT_LOGO = '/logos/nc_default_logo.webp'

interface LocationsHeroSectionProps {
  title: string
  branding: Branding
  alt?: string
  /** Breadcrumb trail (Locations › State › …), rendered above the title. */
  breadcrumb?: React.ReactNode
  /** One-line tagline under the title — the entity's `description`. */
  tagline?: string
  /** Stat line under the tagline (live count, local time, …). */
  stats?: React.ReactNode
}

// videoType maps a hero video URL to a <source> type. Unknown extensions (e.g. a
// signed CDN URL with no extension) return undefined so the browser sniffs.
function videoType(url: string): string | undefined {
  if (url.endsWith('.webm')) return 'video/webm'
  if (url.endsWith('.mp4')) return 'video/mp4'
  if (url.endsWith('.ogg') || url.endsWith('.ogv')) return 'video/ogg'
  return undefined
}

/**
 * Compact location hero: ~300px tall, content bottom-aligned to the page
 * column, sponsor logo at the right when set.
 */
export default function LocationsHeroSection({
  title,
  branding,
  alt,
  breadcrumb,
  tagline,
  stats,
}: LocationsHeroSectionProps) {
  const { hero_url, hero_kind, logo_url, sponsor_url, sponsor_link } = branding

  const heroIsImage = hero_kind === 'image' && hero_url !== ''
  const videoSrc = hero_url || DEFAULT_HERO
  const logoSrc = logo_url || DEFAULT_LOGO

  return (
    <section className="relative overflow-hidden">
      {/* Background hero — an uploaded image, or a looping video (default or URL) */}
      {heroIsImage ? (
        <img
          src={hero_url}
          alt={alt ?? `${title} hero`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={videoSrc} type={videoType(videoSrc)} />
        </video>
      )}

      {/* Cinematic gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-crust/60 via-crust/50 to-crust/90" />
      <div className="absolute inset-0 bg-gradient-to-r from-crust/40 to-transparent" />

      {/* Content — bottom-aligned to the page column */}
      <div className="relative z-10 mx-auto flex min-h-[300px] w-11/12 flex-wrap items-end gap-x-5 gap-y-4 pt-16 pb-8 lg:w-10/12 xl:max-w-7xl">
        <img
          src={logoSrc}
          alt={alt ?? `${title} Logo`}
          className="h-20 w-20 rounded-full object-cover shadow-xl ring-2 ring-white/10"
          style={{ animation: 'scale-in 500ms var(--spring-smooth) forwards' }}
        />
        <div
          className="min-w-0 flex-1"
          style={{
            animation: 'fade-in-up 600ms var(--spring-smooth) 100ms forwards',
            opacity: 0,
          }}
        >
          {breadcrumb && (
            <nav
              aria-label="Breadcrumb"
              className="mb-2 flex flex-wrap items-center gap-1 font-mono text-xs text-white/70"
            >
              {breadcrumb}
            </nav>
          )}
          <h1 className="mb-0 text-white">{title}</h1>
          {tagline && (
            <p className="mt-1 mb-0 text-lg text-white/85">{tagline}</p>
          )}
          {stats && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-white/70">
              {stats}
            </div>
          )}
        </div>

        {sponsor_url && sponsor_link && (
          <a
            href={sponsor_link}
            target={sponsor_link.startsWith('http') ? '_blank' : undefined}
            rel={
              sponsor_link.startsWith('http')
                ? 'noopener noreferrer'
                : undefined
            }
            className="flex items-center gap-2 self-end font-mono text-xs text-white/70 sm:ml-auto"
            style={{
              animation: 'fade-in-up 600ms var(--spring-smooth) 250ms forwards',
              opacity: 0,
            }}
          >
            <span className="hidden sm:inline">Sponsored by</span>
            <img
              src={sponsor_url}
              alt={`${title} sponsor`}
              className="h-11 rounded-lg transition-transform duration-350 ease-[var(--spring-snappy)] hover:scale-105"
            />
          </a>
        )}
      </div>

      {/* Bottom gradient fade into page */}
      <div className="absolute right-0 bottom-0 left-0 h-24 bg-gradient-to-t from-base to-transparent" />
    </section>
  )
}
