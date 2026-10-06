import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { State, Sublocation, Video } from '@/lib/types'
import {
  fetchAlerts,
  fetchLightning,
  fetchStates,
  fetchSublocationsByState,
  fetchVideos,
  fetchWeather,
} from '@/lib/api'
import StreamPlayer from '@/components/StreamPlayer'
import PrerollGate from '@/components/PrerollGate'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import CameraGrid from '@/components/CameraGrid'
import NowPanel from '@/components/NowPanel'
import { buttonClasses } from '@/components/Button'
import Eyebrow from '@/components/ui/Eyebrow'
import Panel from '@/components/ui/Panel'
import SectionHead from '@/components/ui/SectionHead'
import { pickFeatured } from '@/lib/featured'
import { seo, streamPoster } from '@/lib/seo'

/** The ranked row shows a handful of tiles — /cameras/popular has the rest. */
const HOME_ROW_SIZE = 6

export const Route = createFileRoute('/')({
  loader: async () => {
    // Feature a real camera so the hero can run a targeted pre-roll, picked
    // server-side so the client hydrates the same one. Tolerant: if the API is
    // unreachable the homepage still renders.
    const [videos, states, popularVideos] = await Promise.all([
      fetchVideos().catch(() => []),
      fetchStates().catch(() => []),
      fetchVideos({ sort: 'views' }).catch(() => []),
    ])
    // Sublocation slugs aren't on the video rows themselves, so fetch them for
    // every state with a live camera to build the same camera links as
    // routes/locations/$slug.index.tsx.
    const liveStateIds = new Set(
      videos.filter((v) => v.status === 'active').map((v) => v.state_id),
    )
    const sublocations = (
      await Promise.all(
        states
          .filter((s) => liveStateIds.has(s.state_id))
          .map((s) => fetchSublocationsByState(s.slug).catch(() => [])),
      )
    ).flat()
    const featured = pickFeatured(videos)
    // Conditions for the featured camera's sublocation. A null weather (no
    // coordinates, or an upstream failure) omits the section.
    const featuredSub =
      sublocations.find((s) => featured?.sublocation_id === s.sublocation_id) ??
      null
    const [weather, lightning, alerts] = featuredSub
      ? await Promise.all([
          fetchWeather(featuredSub.slug),
          fetchLightning(featuredSub.slug),
          fetchAlerts(featuredSub.slug),
        ])
      : [null, null, []]
    return {
      featured,
      states,
      sublocations,
      popularVideos,
      featuredSub,
      weather,
      lightning,
      alerts,
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
    states,
    sublocations,
    popularVideos,
    featuredSub,
    weather,
    lightning,
    alerts,
  } = Route.useLoaderData()
  return (
    <div>
      <HomeHero
        featured={featured}
        states={states}
        sublocations={sublocations}
      />
      <MostWatchedSection
        videos={popularVideos}
        states={states}
        sublocations={sublocations}
      />
      {featuredSub && weather && (
        <section className="measure section-y" aria-labelledby="home-cond">
          <SectionHead
            id="home-cond"
            number="02"
            eyebrow="Conditions"
            title={`Right now at ${featured?.title ?? featuredSub.name}`}
            body="The same conditions row that sits on every camera and sublocation page."
          />
          <NowPanel
            weather={weather}
            sublocation={featuredSub}
            lightning={lightning}
            alerts={alerts}
          />
        </section>
      )}
      <FAQSection />
      <JoinCTA />
    </div>
  )
}

/* ──────────────────── Shared helpers ──────────────────── */

interface RowProps {
  states: Array<State>
  sublocations: Array<Sublocation>
}

/** Builds the camera page link, or undefined for a camera with no page of its own. */
function cameraLinkFor(video: Video, { states, sublocations }: RowProps) {
  const stateSlug = states.find((s) => s.state_id === video.state_id)?.slug
  const sublocationSlug = sublocations.find(
    (s) => s.sublocation_id === video.sublocation_id,
  )?.slug
  if (!stateSlug || !sublocationSlug) return undefined
  return {
    to: '/locations/$slug/$sublocationSlug/$cameraSlug' as const,
    params: { slug: stateSlug, sublocationSlug, cameraSlug: video.slug },
  }
}

/* ──────────────────── Hero ──────────────────── */

function HomeHero({
  featured,
  states,
  sublocations,
}: RowProps & { featured: Video | null }) {
  const link = featured
    ? cameraLinkFor(featured, { states, sublocations })
    : undefined

  return (
    <section className="measure pt-10 pb-4 sm:pt-16 lg:pt-20">
      <div className="grid items-center gap-10 lg:grid-cols-[7fr_6fr] lg:gap-14">
        <div className="min-w-0">
          <div
            aria-hidden="true"
            className="mb-7 h-[3px] w-16 bg-gradient-to-r from-accent to-accent-hover"
          />
          <Eyebrow variant="pill" className="mb-6">
            Live cameras across America
          </Eyebrow>
          <h1 className="max-w-3xl text-balance text-text">
            See America <span className="text-accent-fg">in real time</span>
          </h1>
          <p className="mt-5 mb-0 max-w-xl text-lede text-subtext1">
            Explore cities, landmarks, and communities through live camera feeds
            from coast to coast.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 max-[480px]:flex-col max-[480px]:items-stretch">
            <Link
              to="/locations"
              className={buttonClasses({
                variant: 'primary',
                size: 'marketing',
              })}
            >
              Explore Locations <span aria-hidden="true">&rarr;</span>
            </Link>
            <Link
              to="/free-camera"
              className={buttonClasses({
                variant: 'secondary',
                size: 'marketing',
              })}
            >
              Add Your Camera
            </Link>
          </div>
        </div>

        <figure className="m-0 min-w-0">
          <Panel glow padding="none">
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
            <figcaption className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 font-mono text-xs tracking-[0.02em] text-label uppercase">
              <span className="min-w-0 truncate">Featured camera</span>
              {link ? (
                <Link
                  to={link.to}
                  params={link.params}
                  className="shrink-0 text-accent-ink hover:underline"
                >
                  Watch now
                </Link>
              ) : (
                <span className="shrink-0">Watch now</span>
              )}
            </figcaption>
          </Panel>
        </figure>
      </div>
    </section>
  )
}

/* ──────────────────── Most watched ──────────────────── */

function MostWatchedSection({
  videos,
  states,
  sublocations,
}: RowProps & { videos: Array<Video> }) {
  const tick = usePosterTick()
  if (videos.length === 0) return null
  const top = videos.slice(0, HOME_ROW_SIZE)

  return (
    <section className="measure section-y" aria-labelledby="home-popular">
      <SectionHead
        id="home-popular"
        number="01"
        eyebrow="Most watched"
        title="Fan favorites"
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
            link={cameraLinkFor(video, { states, sublocations })}
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
      <SectionHead
        id="home-faq"
        title="Frequently Asked Questions"
        body="Everything you need to know about NationCam."
      />
      <Panel padding="none">
        {faqItems.map((item, index) => (
          <div key={index} className="border-t border-border first:border-t-0">
            <button
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              aria-expanded={openIndex === index}
              className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left text-text transition-colors hover:bg-mantle sm:px-6"
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
                openIndex === index ? 'grid-rows-[1fr] pb-5' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="overflow-hidden px-5 sm:px-6">
                <p className="mb-0 max-w-[60ch] text-body text-subtext1">
                  {item.answer}
                </p>
              </div>
            </div>
          </div>
        ))}
      </Panel>
    </section>
  )
}

/* ──────────────────── Bottom call to action ──────────────────── */

function JoinCTA() {
  return (
    <section className="measure section-y pb-[var(--section-y)]">
      <Panel accentTop padding="lg">
        <div className="grid items-center gap-4 md:grid-cols-[1fr_auto] md:gap-8">
          <div>
            <p className="mono-label mb-2">Join the network</p>
            <h2 className="mb-2 font-display text-h2 font-bold tracking-tight text-text">
              Want your camera on our site?
            </h2>
            <p className="mb-0 max-w-[60ch] text-body text-subtext1">
              We are building a nationwide network of live cameras. If you have
              a camera you would like to share, we would love to hear from you.
            </p>
          </div>
          <Link
            to="/contact"
            className={buttonClasses({ variant: 'primary', size: 'marketing' })}
          >
            Get in touch
          </Link>
        </div>
      </Panel>
    </section>
  )
}
