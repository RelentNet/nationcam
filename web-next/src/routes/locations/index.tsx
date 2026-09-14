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
  // Cards = states with cameras, then states flagged upcoming (a camera is
  // confirmed but not live yet) — those earn a card instead of a pill.
  const active = [
    ...states.filter((s) => s.video_count > 0),
    ...states.filter((s) => !s.video_count && s.upcoming),
  ]
  const comingSoon = states.filter((s) => !s.video_count && !s.upcoming)

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

      {/* Coming-soon states — a compact strip, not a wall of empty cards. The
          states with cameras are the page; the rest is one line of intent, a
          host-a-camera CTA, and a small pill per state, so the network still
          reads as national without 49 full-size "Coming soon" tiles dominating
          the first impression. */}
      {comingSoon.length > 0 && (
        <Reveal variant="blur">
          <div className="mt-12 rounded-xl border border-overlay0/50 bg-surface0/50 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="mb-1 font-mono text-sm font-medium text-overlay2">
                  Coming soon &mdash; {comingSoon.length} more states
                </h4>
                <p className="mb-0 max-w-lg text-sm text-subtext0">
                  We&rsquo;re adding cameras state by state. Know a marina,
                  waterfront, or landmark worth watching? You could host the
                  first camera in your state &mdash; it costs nothing.
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
            <span className="font-mono text-sm text-overlay2">
              Coming soon
              {state.upcoming && (
                <span className="text-accent"> &middot; camera confirmed</span>
              )}
            </span>
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
