import { useEffect, useState } from 'react'
import { assetExists } from '@/lib/utils'
import buttonRedirects from '@/lib/buttonRedirects'

interface LocationsHeroSectionProps {
  title: string
  slug: string
  alt?: string
}

export default function LocationsHeroSection({
  title,
  slug,
  alt,
}: LocationsHeroSectionProps) {
  const [videoSrc, setVideoSrc] = useState('/videos/nc_default_hero.webm')
  const [logoSrc, setLogoSrc] = useState('/logos/nc_default_logo.webp')
  const [buttonSrc, setButtonSrc] = useState<string | null>(null)

  useEffect(() => {
    async function checkAssets() {
      const customVideo = `/videos/nc_${slug}_hero.webm`
      const customLogo = `/logos/nc_${slug}_logo.webp`
      const customButton = `/buttons/nc_${slug}_button.webp`

      const [hasVideo, hasLogo, hasButton] = await Promise.all([
        assetExists(customVideo),
        assetExists(customLogo),
        assetExists(customButton),
      ])

      if (hasVideo) setVideoSrc(customVideo)
      if (hasLogo) setLogoSrc(customLogo)
      if (hasButton) setButtonSrc(customButton)
    }
    void checkAssets()
  }, [slug])

  const redirectUrl = buttonRedirects[slug]

  return (
    <section className="relative overflow-hidden">
      {/* Background video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src={videoSrc} type="video/webm" />
      </video>

      {/* Cinematic gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-crust/80 via-crust/40 to-crust/90" />
      <div className="absolute inset-0 bg-gradient-to-r from-crust/40 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex min-h-[50vh] flex-col items-center justify-center gap-5 px-6 py-24 text-center">
        <img
          src={logoSrc}
          alt={alt ?? `${title} Logo`}
          className="h-20 w-20 rounded-full object-cover shadow-xl ring-2 ring-white/10"
          style={{ animation: 'scale-in 500ms var(--spring-smooth) forwards' }}
        />
        <h1
          className="text-white"
          style={{
            animation: 'fade-in-up 600ms var(--spring-smooth) 100ms forwards',
            opacity: 0,
          }}
        >
          {title}
        </h1>

        {buttonSrc && redirectUrl && (
          <a
            href={redirectUrl}
            target={redirectUrl.startsWith('http') ? '_blank' : undefined}
            rel={
              redirectUrl.startsWith('http') ? 'noopener noreferrer' : undefined
            }
            style={{
              animation: 'fade-in-up 600ms var(--spring-smooth) 250ms forwards',
              opacity: 0,
            }}
          >
            <img
              src={buttonSrc}
              alt={`${title} sponsor`}
              className="h-12 rounded-lg transition-transform duration-350 ease-[var(--spring-snappy)] hover:scale-105"
            />
          </a>
        )}
      </div>

      {/* Bottom gradient fade into page */}
      <div className="absolute right-0 bottom-0 left-0 h-24 bg-gradient-to-t from-base to-transparent" />
    </section>
  )
}
