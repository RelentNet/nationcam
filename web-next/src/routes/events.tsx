import { Link, createFileRoute } from '@tanstack/react-router'
import { CalendarDays, ExternalLink } from 'lucide-react'
import type { EventItem } from '@/lib/types'
import { fetchUpcomingEvents } from '@/lib/api'
import { seo } from '@/lib/seo'
import Reveal from '@/components/Reveal'
import SectionHead from '@/components/ui/SectionHead'
import { EventWhen } from '@/components/SublocationPage'

/** The page this event's attachment links to: its camera when it has one,
 *  otherwise the sublocation hub. */
type ScopeTarget =
  | {
      to: '/locations/$slug/$sublocationSlug/$cameraSlug'
      params: { slug: string; sublocationSlug: string; cameraSlug: string }
    }
  | {
      to: '/locations/$slug/$sublocationSlug'
      params: { slug: string; sublocationSlug: string }
    }

function eventScopeTarget(e: EventItem): ScopeTarget {
  if (e.video_id != null && e.video_slug) {
    return {
      to: '/locations/$slug/$sublocationSlug/$cameraSlug',
      params: {
        slug: e.state_slug,
        sublocationSlug: e.sublocation_slug,
        cameraSlug: e.video_slug,
      },
    }
  }
  return {
    to: '/locations/$slug/$sublocationSlug',
    params: { slug: e.state_slug, sublocationSlug: e.sublocation_slug },
  }
}

/** "2026-09-27T18:00:00Z" -> "September 2026" — grouped in UTC so the month a
 *  server render puts an event in never disagrees with the client's. */
function monthKey(iso: string): string {
  return iso.slice(0, 7) // "YYYY-MM"
}

function monthLabel(iso: string): string {
  return new Date(`${monthKey(iso)}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Groups already-sorted (soonest-first) events into month buckets, in the
 *  order those months first appear. */
function groupByMonth(
  events: Array<EventItem>,
): Array<{ key: string; label: string; events: Array<EventItem> }> {
  const groups: Array<{
    key: string
    label: string
    events: Array<EventItem>
  }> = []
  for (const e of events) {
    const key = monthKey(e.starts_at)
    const last = groups.length > 0 ? groups[groups.length - 1] : undefined
    if (last?.key === key) {
      last.events.push(e)
    } else {
      groups.push({ key, label: monthLabel(e.starts_at), events: [e] })
    }
  }
  return groups
}

export const Route = createFileRoute('/events')({
  loader: async () => {
    const events = await fetchUpcomingEvents()
    return { groups: groupByMonth(events) }
  },
  head: () =>
    seo({
      title: 'Events | NationCam',
      description:
        'Upcoming tournaments, rodeos and festivals happening at the places NationCam watches — with a live camera on the ones you can watch.',
      path: '/events',
    }),
  component: EventsPage,
  pendingComponent: EventsSkeleton,
})

function EventsHeader() {
  return (
    <Reveal variant="blur">
      <SectionHead
        as="h1"
        eyebrow="Events"
        title="Upcoming Events"
        body="Tournaments, rodeos and festivals happening at the places NationCam watches. Times are shown in your local time."
      />
    </Reveal>
  )
}

function EventCard({ event: e }: { event: EventItem }) {
  const target = eventScopeTarget(e)
  const placeLabel = e.video_title || e.sublocation_name
  return (
    <article className="rounded-xl border border-border bg-surface0 p-5 transition-colors duration-150 hover:border-accent">
      <p className="mono-label mb-2">
        <EventWhen iso={e.starts_at} />
      </p>
      <h3 className="mb-2 font-display text-lg font-semibold">{e.title}</h3>
      <p className="mb-4 text-sm text-subtext1">
        {placeLabel}, {e.state_name}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          {...target}
          className="text-sm font-medium text-accent-ink hover:underline"
        >
          {e.video_id != null && e.video_slug ? 'Watch here' : 'View location'}{' '}
          &rarr;
        </Link>
        {e.url && (
          <a
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
          >
            Event site <ExternalLink size={12} />
          </a>
        )}
      </div>
    </article>
  )
}

function EventsEmpty() {
  return (
    <div className="rounded-xl border border-border bg-surface0 px-6 py-16 text-center">
      <CalendarDays size={32} className="mx-auto mb-4 text-overlay1" />
      <h3 className="mb-2">No events scheduled</h3>
      <p className="mx-auto mb-0 max-w-[52ch] text-subtext1">
        Check back soon — tournaments, rodeos and festivals hosted at our camera
        locations will show up here.
      </p>
    </div>
  )
}

function EventsSkeleton() {
  return (
    <div className="page-container">
      <EventsHeader />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-32 rounded-xl border border-border bg-surface0"
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

function EventsPage() {
  const { groups } = Route.useLoaderData()

  return (
    <div className="page-container">
      <EventsHeader />
      {groups.length === 0 ? (
        <EventsEmpty />
      ) : (
        <Reveal stagger>
          <div className="space-y-12">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-5 font-display text-h3 font-semibold">
                  {group.label}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.events.map((e) => (
                    <EventCard key={e.event_id} event={e} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  )
}
