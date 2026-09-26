import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { MapPin, Radio } from 'lucide-react'
import type { State, Video } from '@/lib/types'
import { fetchStates, fetchSublocationsByState, fetchVideos } from '@/lib/api'
import { seo, streamPoster } from '@/lib/seo'
import Reveal from '@/components/Reveal'
import PosterTile, { usePosterTick } from '@/components/PosterTile'

export const Route = createFileRoute('/locations/')({
  loader: async () => {
    const [states, videos] = await Promise.all([fetchStates(), fetchVideos()])

    // The bulk /videos payload has no sublocation slug (only the single-camera
    // endpoint resolves it), and a camera page URL requires one. Active states
    // are few compared to the full state list, so resolving their sublocation
    // slugs here — reusing the same fetchSublocationsByState() the state page
    // already calls — stays cheap while letting every camera tile link out.
    const statesWithVideos = states.filter((s) =>
      videos.some((v) => v.state_id === s.state_id),
    )
    const sublocationLists = await Promise.all(
      statesWithVideos.map((s) => fetchSublocationsByState(s.slug)),
    )
    const sublocationSlugs: Record<number, string> = {}
    for (const list of sublocationLists) {
      for (const sub of list) sublocationSlugs[sub.sublocation_id] = sub.slug
    }

    return { states, videos, sublocationSlugs }
  },
  head: () =>
    seo({
      title: 'Live Cameras by State | NationCam',
      description:
        'Browse live cameras across the United States. Select a state to see the cameras streaming there right now.',
      path: '/locations',
    }),
  component: LocationsPage,
  pendingComponent: LocationsSkeleton,
})

/* ──── Cameras — grouped by state, filterable by chip ──── */

function CamerasSection({
  states,
  videos,
  sublocationSlugs,
}: {
  states: Array<State>
  videos: Array<Video>
  sublocationSlugs: Record<number, string>
}) {
  const activeStates = states.filter((s) => s.video_count > 0)
  const [selected, setSelected] = useState<number | 'all'>('all')
  const tick = usePosterTick()

  if (activeStates.length === 0) return null

  const groups = activeStates
    .filter((s) => selected === 'all' || s.state_id === selected)
    .map((state) => ({
      state,
      videos: videos.filter((v) => v.state_id === state.state_id),
    }))
    .filter((g) => g.videos.length > 0)

  return (
    <div className="mb-12">
      <Reveal variant="blur">
        <div className="mb-8 flex flex-wrap gap-2">
          <StateChip
            active={selected === 'all'}
            onClick={() => setSelected('all')}
          >
            All
          </StateChip>
          {activeStates.map((state) => (
            <StateChip
              key={state.state_id}
              active={selected === state.state_id}
              onClick={() => setSelected(state.state_id)}
            >
              {state.name}
            </StateChip>
          ))}
        </div>
      </Reveal>

      {groups.map(({ state, videos: stateVideos }) => (
        <div key={state.state_id} className="mb-10">
          <div className="mb-4 flex items-baseline gap-3">
            <Link
              to="/locations/$slug"
              params={{ slug: state.slug }}
              className="group inline-flex items-baseline gap-2"
            >
              <h3 className="mb-0 transition-colors group-hover:text-accent">
                {state.name}
              </h3>
              <span className="font-mono text-sm text-subtext0 opacity-0 transition-opacity group-hover:opacity-100">
                View all &rarr;
              </span>
            </Link>
            <div className="flex items-center gap-1.5">
              <Radio size={10} className="text-live" />
              <span className="font-mono text-xs text-subtext0">
                {stateVideos.length} camera{stateVideos.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <Reveal stagger>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {stateVideos.map((v) => {
                const sublocationSlug = v.sublocation_id
                  ? sublocationSlugs[v.sublocation_id]
                  : undefined
                return (
                  <PosterTile
                    key={v.video_id}
                    title={v.title}
                    meta={v.sublocation_name || undefined}
                    poster={streamPoster(v.src, v.status === 'active')}
                    live={v.status === 'active'}
                    tick={tick}
                    link={
                      sublocationSlug
                        ? {
                            to: '/locations/$slug/$sublocationSlug/$cameraSlug',
                            params: {
                              slug: state.slug,
                              sublocationSlug,
                              cameraSlug: v.slug,
                            },
                          }
                        : undefined
                    }
                  />
                )
              })}
            </div>
          </Reveal>
        </div>
      ))}
    </div>
  )
}

function StateChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-4 py-1.5 font-mono text-xs font-medium transition-colors ${
        active
          ? 'border-accent bg-accent text-crust'
          : 'border-overlay0 bg-surface0 text-subtext0 hover:border-accent/40 hover:text-accent'
      }`}
    >
      {children}
    </button>
  )
}

/* ──── Coming soon — a compact strip, not a wall of empty cards ──── */

function ComingSoonSection({ states }: { states: Array<State> }) {
  const comingSoon = states.filter((s) => s.video_count === 0)
  if (comingSoon.length === 0) return null

  return (
    <Reveal variant="blur">
      <div className="rounded-xl border border-overlay0/50 bg-surface0/50 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="mb-1 font-mono text-sm font-medium text-overlay2">
              Coming soon &mdash; {comingSoon.length} more state
              {comingSoon.length === 1 ? '' : 's'}
            </h4>
            <p className="mb-0 max-w-lg text-sm text-subtext0">
              We&rsquo;re adding cameras state by state. Know a marina,
              waterfront, or landmark worth watching? You could host the first
              camera in your state &mdash; it costs nothing.
            </p>
          </div>
          <Link
            to="/contact"
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-accent px-5 py-2.5 font-sans font-semibold text-crust transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
          >
            Host a camera &rarr;
          </Link>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {comingSoon.map((state) => (
            <Link
              key={state.state_id}
              to="/locations/$slug"
              params={{ slug: state.slug }}
              className="rounded-full border border-overlay0/60 px-3 py-1 font-mono text-xs text-subtext0 transition-colors hover:border-accent/40 hover:text-accent"
            >
              {state.name}
            </Link>
          ))}
        </div>
      </div>
    </Reveal>
  )
}

/* ──── Page header, shared by the page and its pending state ──── */

function LocationsHeader() {
  return (
    <Reveal variant="blur">
      <div className="mb-10">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
          <MapPin size={14} className="text-accent" />
          <span className="font-mono text-xs font-medium text-accent">
            Browse by state
          </span>
        </div>
        <h1>Locations</h1>
        <p className="max-w-lg">
          Browse live cameras across the United States. Select a state to view
          available cameras.
        </p>
      </div>
    </Reveal>
  )
}

function LocationsSkeleton() {
  return (
    <div className="page-container">
      <LocationsHeader />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-video rounded-xl border border-overlay0 bg-surface0"
            style={{
              opacity: 0,
              animation: `fade-in 400ms var(--spring-ease-out) ${i * 60}ms forwards`,
            }}
          >
            <div
              className="h-full w-full rounded-xl bg-gradient-to-r from-surface0 via-mantle to-surface0 bg-[length:200%_100%]"
              style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function LocationsPage() {
  const { states, videos, sublocationSlugs } = Route.useLoaderData()

  return (
    <div className="page-container">
      <LocationsHeader />
      <CamerasSection
        states={states}
        videos={videos}
        sublocationSlugs={sublocationSlugs}
      />
      <ComingSoonSection states={states} />
    </div>
  )
}
