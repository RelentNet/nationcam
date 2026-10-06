import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Camera, ChevronDown, Globe, Map } from 'lucide-react'
import type { State, Sublocation, Video } from '@/lib/types'
import { fetchStates, fetchSublocationsByState, fetchVideos } from '@/lib/api'
import StreamPlayer from '@/components/StreamPlayer'
import PrerollGate from '@/components/PrerollGate'
import LiveNowSection from '@/components/LiveNowSection'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import CameraGrid from '@/components/CameraGrid'
import { buttonClasses } from '@/components/Button'
import Eyebrow from '@/components/ui/Eyebrow'
import SectionHead from '@/components/ui/SectionHead'
import RuledGrid, { RuledCell } from '@/components/ui/RuledGrid'
import { pickFeatured } from '@/lib/featured'
import ContactCTA from '@/components/ContactCTA'
import Reveal from '@/components/Reveal'
import { seo, streamPoster } from '@/lib/seo'
import { useRecentCameras } from '@/hooks/useRecentCameras'

/** Home rows show a handful of tiles, not the full catalog — see /cameras/popular and /cameras/new for the rest. */
const HOME_ROW_SIZE = 6

/** Gate for the "Newest" row: only shown when something was added recently. */
const NEWEST_ROW_WINDOW_DAYS = 60

export const Route = createFileRoute('/')({
  loader: async () => {
    // Feature a real camera so the "Watch Now" hero can run a targeted pre-roll,
    // picked server-side so the client hydrates the same one. Tolerant: if the
    // API is unreachable the homepage still renders (falls back to no pre-roll).
    const [videos, states, popularVideos, newestVideos] = await Promise.all([
      fetchVideos().catch(() => []),
      fetchStates().catch(() => []),
      fetchVideos({ sort: 'views' }).catch(() => []),
      fetchVideos({ sort: 'newest' }).catch(() => []),
    ])
    // Sublocation slugs aren't on the video rows themselves, so fetch them for
    // every state with a live camera — that's what the "Live now", "Most
    // watched" and "Newest" grids need to build the same camera links as
    // routes/locations/$slug.index.tsx. popularVideos/newestVideos are the
    // same active-video universe as videos, just reordered by the API, so no
    // extra states are ever referenced here.
    const liveStateIds = new Set(
      videos.filter((v) => v.status === 'active').map((v) => v.state_id),
    )
    const statesWithLiveVideos = states.filter((s) =>
      liveStateIds.has(s.state_id),
    )
    const sublocations = (
      await Promise.all(
        statesWithLiveVideos.map((s) =>
          fetchSublocationsByState(s.slug).catch(() => []),
        ),
      )
    ).flat()
    return {
      featured: pickFeatured(videos),
      videos,
      states,
      sublocations,
      popularVideos,
      newestVideos,
    }
  },
  head: () =>
    seo({
      title: 'NationCam — Live Cameras Across America',
      description:
        'Watch live camera feeds from cities, landmarks, and communities across the United States. Free, real-time streams from coast to coast.',
      path: '/',
    }),
  component: HomePage,
})

function HomePage() {
  const {
    featured,
    videos,
    states,
    sublocations,
    popularVideos,
    newestVideos,
  } = Route.useLoaderData()
  return (
    <div>
      <HomeHeroSection />
      <FeaturedStream featured={featured} />
      <RecentlyWatchedSection />
      <LiveNowSection
        videos={videos}
        states={states}
        sublocations={sublocations}
      />
      <MostWatchedSection
        videos={popularVideos}
        states={states}
        sublocations={sublocations}
      />
      <NewestSection
        videos={newestVideos}
        states={states}
        sublocations={sublocations}
      />
      <StatsSection videos={videos} />
      <FAQSection />
      <ContactCTA />
    </div>
  )
}

/* ──────────────────── Hero ──────────────────── */

function HomeHeroSection() {
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
        <source src="/videos/nc_default_hero.webm" type="video/webm" />
      </video>

      {/* Dual gradient overlays */}
      <div className="absolute inset-0 bg-crust/70" />
      <div className="absolute inset-0 bg-gradient-to-t from-base via-transparent to-transparent" />

      <div className="measure relative z-10 flex min-h-[85vh] flex-col justify-center pt-[calc(var(--nav-h)+48px)] pb-24">
        {/* Accent band */}
        <div
          aria-hidden="true"
          className="mb-7 h-[3px] w-16 bg-gradient-to-r from-accent to-accent-hover"
        />

        {/* Pill eyebrow — blur-in entrance */}
        <div
          style={{ animation: 'blur-in 600ms var(--spring-ease-out) forwards' }}
        >
          <Eyebrow variant="pill" className="mb-6">
            Live cameras across America
          </Eyebrow>
        </div>

        {/* Headline — float up with bounce spring */}
        <h1
          className="max-w-3xl text-white drop-shadow-2xl"
          style={{
            opacity: 0,
            animation: 'float-up 800ms var(--spring-bounce) 100ms forwards',
          }}
        >
          See America{' '}
          <span className="bg-gradient-to-r from-accent to-amber-300 bg-clip-text text-transparent">
            in real time
          </span>
        </h1>

        {/* Subtitle — slide in from right with stagger */}
        <p
          className="mt-5 mb-0 max-w-xl text-lede text-gray-300"
          style={{
            opacity: 0,
            animation:
              'slide-in-right 700ms var(--spring-smooth) 250ms forwards',
          }}
        >
          Explore cities, landmarks, and communities through live camera feeds
          from coast to coast.
        </p>

        {/* CTA buttons — scale-fade-in with poppy spring */}
        <div
          className="mt-8 flex flex-wrap items-center gap-3 max-[480px]:flex-col max-[480px]:items-stretch"
          style={{
            opacity: 0,
            animation: 'scale-fade-in 600ms var(--spring-poppy) 450ms forwards',
          }}
        >
          <Link
            to="/locations"
            className={buttonClasses({ variant: 'primary', size: 'marketing' })}
          >
            <Map size={18} />
            Explore Locations
          </Link>
          <Link
            to="/contact"
            className={buttonClasses({
              variant: 'secondary',
              size: 'marketing',
              className:
                'border-white/30! bg-white/5! text-white! backdrop-blur-sm hover:border-white/60! hover:bg-white/10!',
            })}
          >
            Add Your Camera
          </Link>
        </div>

        {/* Scroll indicator — delayed fade in */}
        <div
          className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 max-sm:hidden"
          style={{
            opacity: 0,
            animation: 'fade-in 1s ease 1.4s forwards',
          }}
        >
          <span className="font-mono text-[10px] tracking-widest text-white/40 uppercase">
            Scroll
          </span>
          <ChevronDown size={16} className="animate-bounce text-white/30" />
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute right-0 bottom-0 left-0 h-32 bg-gradient-to-t from-base to-transparent" />
    </section>
  )
}

/* ──────────────────── Featured Stream ──────────────────── */

function FeaturedStream({ featured }: { featured: Video | null }) {
  return (
    <section className="measure section-y" aria-labelledby="home-watch-now">
      <Reveal variant="blur">
        <SectionHead
          id="home-watch-now"
          eyebrow="Featured camera"
          title="Watch Now"
          body="A live look from our network. Tune in to see what is happening right now."
        />
        <div className="glow-accent overflow-hidden rounded-xl">
          {featured ? (
            <PrerollGate videoId={featured.video_id}>
              <StreamPlayer
                src={featured.src}
                type={featured.type}
                autoplay
                muted
                live={featured.status === 'active'}
                fluid
                audioChannels
              />
            </PrerollGate>
          ) : (
            <StreamPlayer
              src="https://streamer.nationcam.com/memfs/4cdb363f-2bfa-4a0a-b954-ac9b16200665.m3u8"
              autoplay
              muted
              live
              fluid
              audioChannels
            />
          )}
        </div>
      </Reveal>
    </section>
  )
}

/* ──────────────────── Recently watched ──────────────────── */

/**
 * A recorded path always looks like `/locations/$slug/$sublocationSlug/$cameraSlug`
 * — that's the only shape `recordRecentCamera` is called with (see
 * `SublocationPage.tsx`). Parses it back into the typed link `PosterTile` needs.
 */
function cameraLink(path: string) {
  const match = path.match(/^\/locations\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (!match) return undefined
  const [, slug, sublocationSlug, cameraSlug] = match
  return {
    to: '/locations/$slug/$sublocationSlug/$cameraSlug' as const,
    params: { slug, sublocationSlug, cameraSlug },
  }
}

/**
 * "Recently watched" — one click back to the cameras this visitor already
 * looked at, read from localStorage. Renders nothing on the server and on
 * first client render (matching `useRecentCameras`'s SSR-safe empty state),
 * then fills in after mount, and is hidden entirely when there's no history.
 */
function RecentlyWatchedSection() {
  const recent = useRecentCameras()
  if (recent.length === 0) return null

  return (
    <section className="measure section-y" aria-labelledby="home-recent">
      <Reveal variant="blur">
        <SectionHead
          id="home-recent"
          eyebrow="Recently watched"
          title="Jump Back In"
          body="Pick up right where you left off."
        />
        <CameraGrid>
          {recent.map((entry) => (
            <PosterTile
              key={entry.path}
              title={entry.title}
              meta={entry.subtitle}
              poster={entry.poster}
              link={cameraLink(entry.path)}
            />
          ))}
        </CameraGrid>
      </Reveal>
    </section>
  )
}

/* ──────────────────── Most watched / Newest ──────────────────── */

/** Builds the same camera link LiveNowSection does, or undefined for a camera with no page of its own. */
function buildCameraLink(
  video: Video,
  stateSlugById: Map<number, string>,
  sublocationSlugById: Map<number, string>,
) {
  const stateSlug = stateSlugById.get(video.state_id)
  const sublocationSlug = video.sublocation_id
    ? sublocationSlugById.get(video.sublocation_id)
    : undefined
  if (!stateSlug || !sublocationSlug) return undefined
  return {
    to: '/locations/$slug/$sublocationSlug/$cameraSlug' as const,
    params: { slug: stateSlug, sublocationSlug, cameraSlug: video.slug },
  }
}

interface RankedRowProps {
  videos: Array<Video>
  states: Array<State>
  sublocations: Array<Sublocation>
}

/** "Most watched" — top cameras by total views, linking to the full ranking. */
function MostWatchedSection({ videos, states, sublocations }: RankedRowProps) {
  const tick = usePosterTick()
  if (videos.length === 0) return null

  // `globalThis.Map` — this file also imports the `Map` icon from
  // lucide-react (for the hero's "Explore Locations" link), which shadows
  // the built-in constructor at module scope.
  const stateSlugById = new globalThis.Map(
    states.map((s) => [s.state_id, s.slug]),
  )
  const sublocationSlugById = new globalThis.Map(
    sublocations.map((s) => [s.sublocation_id, s.slug]),
  )
  const top = videos.slice(0, HOME_ROW_SIZE)

  return (
    <section className="measure section-y" aria-labelledby="home-popular">
      <Reveal variant="blur">
        <SectionHead
          id="home-popular"
          eyebrow="Most watched"
          title="Fan Favorites"
          body="The cameras our viewers keep coming back to."
        />
        <CameraGrid>
          {top.map((video, index) => (
            <PosterTile
              key={video.video_id}
              title={video.title}
              meta={video.sublocation_name || video.state_name}
              poster={streamPoster(video.src, true)}
              live
              rank={index + 1}
              tick={tick}
              link={buildCameraLink(video, stateSlugById, sublocationSlugById)}
            />
          ))}
        </CameraGrid>
        <div className="mt-10">
          <Link
            to="/cameras/popular"
            className={buttonClasses({ variant: 'secondary' })}
          >
            See the full ranking &rarr;
          </Link>
        </div>
      </Reveal>
    </section>
  )
}

/** "Newest" — recently added cameras, only shown when one exists. */
function NewestSection({ videos, states, sublocations }: RankedRowProps) {
  const tick = usePosterTick()
  const cutoff = Date.now() - NEWEST_ROW_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const hasRecent = videos.some(
    (v) => new Date(v.created_at).getTime() >= cutoff,
  )
  if (!hasRecent) return null

  const stateSlugById = new globalThis.Map(
    states.map((s) => [s.state_id, s.slug]),
  )
  const sublocationSlugById = new globalThis.Map(
    sublocations.map((s) => [s.sublocation_id, s.slug]),
  )
  const top = videos.slice(0, HOME_ROW_SIZE)

  return (
    <section className="measure section-y" aria-labelledby="home-newest">
      <Reveal variant="blur">
        <SectionHead
          id="home-newest"
          eyebrow="Newest"
          title="Just Added"
          body="The latest cameras to join our network."
        />
        <CameraGrid>
          {top.map((video) => (
            <PosterTile
              key={video.video_id}
              title={video.title}
              meta={video.sublocation_name || video.state_name}
              poster={streamPoster(video.src, true)}
              live
              tick={tick}
              link={buildCameraLink(video, stateSlugById, sublocationSlugById)}
            />
          ))}
        </CameraGrid>
        <div className="mt-10">
          <Link
            to="/cameras/new"
            className={buttonClasses({ variant: 'secondary' })}
          >
            See all new cameras &rarr;
          </Link>
        </div>
      </Reveal>
    </section>
  )
}

/* ──────────────────── Stats ──────────────────── */

function StatsSection({ videos }: { videos: Array<Video> }) {
  const activeVideos = videos.filter((v) => v.status === 'active')
  const stateCount = new Set(activeVideos.map((v) => v.state_id)).size
  const locationCount = new Set(
    activeVideos
      .filter((v) => v.sublocation_id !== null)
      .map((v) => v.sublocation_id),
  ).size

  const stats = [
    {
      icon: Camera,
      value: String(activeVideos.length),
      label: `Live Camera${activeVideos.length === 1 ? '' : 's'}`,
    },
    {
      icon: Globe,
      value: String(stateCount),
      label: `State${stateCount === 1 ? '' : 's'} With Cameras`,
    },
    {
      icon: Map,
      value: String(locationCount),
      label: `Location${locationCount === 1 ? '' : 's'} Hosting Cameras`,
    },
  ]

  return (
    <section className="measure section-y" aria-labelledby="home-network">
      <Reveal variant="blur">
        <SectionHead
          id="home-network"
          title="Our Growing Network"
          body="Building a nationwide network of live cameras, one location at a time."
        />
        <RuledGrid cols={3}>
          {stats.map((stat) => (
            <RuledCell key={stat.label}>
              <stat.icon size={20} className="mb-4 text-accent-fg" />
              <div className="font-display text-h1 leading-none font-extrabold tracking-tight text-accent-fg tabular-nums">
                {stat.value}
              </div>
              <div className="mt-2 font-mono text-xs tracking-[0.02em] text-label uppercase">
                {stat.label}
              </div>
            </RuledCell>
          ))}
        </RuledGrid>
      </Reveal>
    </section>
  )
}

/* ──────────────────── FAQ ──────────────────── */

const faqItems = [
  {
    question: 'What is NationCam?',
    answer:
      'NationCam is a platform that provides live camera feeds from locations across the United States, allowing you to explore different cities and landmarks in real time.',
  },
  {
    question: 'How can I add my camera?',
    answer:
      'Visit our Contact page and fill out the form with your camera details. Our team will review your submission and get back to you.',
  },
  {
    question: 'Is NationCam free to use?',
    answer:
      'Yes, viewing live camera feeds on NationCam is completely free for all users.',
  },
  {
    question: 'What kind of cameras are supported?',
    answer:
      'We support a variety of camera types including IP cameras, HLS streams, and DASH streams. Contact us for specific compatibility questions.',
  },
]

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="measure section-y" aria-labelledby="home-faq">
      <Reveal variant="blur">
        <SectionHead
          id="home-faq"
          title="Frequently Asked Questions"
          body="Everything you need to know about NationCam."
        />
        <div className="max-w-3xl overflow-hidden rounded-xl border border-border bg-surface0">
          {faqItems.map((item, index) => (
            <div
              key={index}
              className="border-t border-border first:border-t-0"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                aria-expanded={openIndex === index}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-text transition-colors hover:bg-mantle"
              >
                <span className="font-sans font-medium">{item.question}</span>
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-subtext0 transition-transform duration-350 ease-[var(--spring-snappy)] ${
                    openIndex === index ? 'rotate-180' : ''
                  }`}
                />
              </button>
              <div
                className={`grid transition-[grid-template-rows,padding] duration-350 ease-[var(--spring-smooth)] ${
                  openIndex === index
                    ? 'grid-rows-[1fr] pb-5'
                    : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden px-6">
                  <p className="mb-0 text-subtext1">{item.answer}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
