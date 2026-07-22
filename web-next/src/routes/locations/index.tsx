import { Link, createFileRoute } from '@tanstack/react-router'
import { MapPin, Radio } from 'lucide-react'
import type { State } from '@/lib/types'
import { fetchStates } from '@/lib/api'
import { seo } from '@/lib/seo'
import Reveal from '@/components/Reveal'

export const Route = createFileRoute('/locations/')({
  loader: () => fetchStates(),
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

/* ──── State Grid (active-first, coming-soon below) ──── */

function StateGrid({ states }: { states: Array<State> }) {
  const active = states.filter((s) => s.video_count > 0)
  const comingSoon = states.filter((s) => !s.video_count || s.video_count === 0)

  // If every state is empty, just render them all normally
  if (active.length === 0) {
    return (
      <Reveal stagger>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {states.map((state) => (
            <StateCard key={state.state_id} state={state} muted />
          ))}
        </div>
      </Reveal>
    )
  }

  return (
    <>
      {/* Active states */}
      <Reveal stagger>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((state) => (
            <StateCard key={state.state_id} state={state} />
          ))}
        </div>
      </Reveal>

      {/* Coming soon states */}
      {comingSoon.length > 0 && (
        <Reveal variant="blur">
          <div className="mt-12">
            <h4 className="mb-4 font-mono text-sm font-medium text-overlay2">
              Coming Soon
            </h4>
            <Reveal stagger>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {comingSoon.map((state) => (
                  <StateCard key={state.state_id} state={state} muted />
                ))}
              </div>
            </Reveal>
          </div>
        </Reveal>
      )}
    </>
  )
}

/* ──── State Card ──── */

function StateCard({ state, muted }: { state: State; muted?: boolean }) {
  return (
    <Link
      to="/locations/$slug"
      params={{ slug: state.slug }}
      className={`reveal-float group block rounded-xl border p-6 shadow-lg transition-[scale,border-color,box-shadow] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.01] hover:shadow-xl ${
        muted
          ? 'border-overlay0/50 bg-surface0/50 hover:border-overlay0'
          : 'border-overlay0 bg-surface0 hover:border-accent/40'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <h4
            className={`mb-1 transition-colors ${muted ? 'text-subtext0 group-hover:text-subtext1' : 'group-hover:text-accent'}`}
          >
            {state.name}
          </h4>
          {state.video_count > 0 ? (
            <div className="flex items-center gap-1.5">
              <Radio size={12} className="text-live" />
              <span className="font-mono text-sm text-subtext0">
                {state.video_count} camera
                {state.video_count > 1 ? 's' : ''}
              </span>
            </div>
          ) : (
            <span className="font-mono text-sm text-overlay2">Coming soon</span>
          )}
        </div>
        <MapPin
          size={20}
          className={`shrink-0 transition-colors ${muted ? 'text-overlay0 group-hover:text-overlay1' : 'text-overlay1 group-hover:text-accent'}`}
        />
      </div>
    </Link>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-xl border border-overlay0 bg-surface0"
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
  const states = Route.useLoaderData()

  return (
    <div className="page-container">
      <LocationsHeader />
      <StateGrid states={states} />
    </div>
  )
}
