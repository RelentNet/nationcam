import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ChevronRight, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Frame } from '@/lib/types'
import { buttonClasses } from '@/components/Button'
import SectionHead from '@/components/ui/SectionHead'
import { fetchCamera, fetchFrameDays, fetchFrames } from '@/lib/api'
import { SITE_URL, seo } from '@/lib/seo'
import Dropdown from '@/components/Dropdown'

/** "2026-09-26" → "Sat, Sep 26" (UTC so the calendar date never shifts). */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** "14:15" → "2:15 PM". */
function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

export const Route = createFileRoute(
  '/locations/$slug/$sublocationSlug/$cameraSlug_/archive',
)({
  loader: async ({ params }) => {
    const detail = await fetchCamera(
      params.slug,
      params.sublocationSlug,
      params.cameraSlug,
    ).catch(() => null)
    if (!detail) throw notFound()

    const days = await fetchFrameDays(
      params.slug,
      params.sublocationSlug,
      params.cameraSlug,
    )
    // The days endpoint only lists days that actually have stills, so the
    // newest entry — not necessarily "today" — is what gets server-rendered.
    const day = days[0] ?? null
    const frames = day
      ? (
          await fetchFrames(
            params.slug,
            params.sublocationSlug,
            params.cameraSlug,
            day,
          )
        ).frames
      : []
    return { camera: detail.camera, days, day, frames }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}
    const { camera } = loaderData
    const path = `/locations/${params.slug}/${params.sublocationSlug}/${params.cameraSlug}/archive`
    const url = `${SITE_URL}${path}`
    const title = `${camera.title} Snapshot Archive — ${camera.sublocation_name}, ${camera.state_name} | NationCam`
    const description = `Browse past stills captured every 15 minutes from ${camera.title} in ${camera.sublocation_name}, ${camera.state_name}.`
    const base = seo({ title, description, path })
    return {
      ...base,
      meta: [
        ...base.meta,
        {
          'script:ld+json': {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { name: 'Locations', item: `${SITE_URL}/locations` },
              {
                name: camera.state_name,
                item: `${SITE_URL}/locations/${params.slug}`,
              },
              {
                name: camera.sublocation_name,
                item: `${SITE_URL}/locations/${params.slug}/${params.sublocationSlug}`,
              },
              {
                name: camera.title,
                item: `${SITE_URL}/locations/${params.slug}/${params.sublocationSlug}/${params.cameraSlug}`,
              },
              { name: 'Archive', item: url },
            ].map((entry, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              ...entry,
            })),
          },
        },
      ],
    }
  },
  component: ArchiveRoute,
  notFoundComponent: ArchiveNotFound,
})

function ArchiveRoute() {
  const { slug, sublocationSlug, cameraSlug } = Route.useParams()
  const {
    camera,
    days,
    day: initialDay,
    frames: initialFrames,
  } = Route.useLoaderData()
  const [selectedDay, setSelectedDay] = useState<string | null>(initialDay)
  const [frames, setFrames] = useState<Array<Frame>>(initialFrames)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (selectedDay === initialDay) {
      setFrames(initialFrames)
      return
    }
    if (!selectedDay) {
      setFrames([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetchFrames(slug, sublocationSlug, cameraSlug, selectedDay)
      .then((res) => {
        if (!cancelled) setFrames(res.frames)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedDay])

  const crumbLink = 'transition-colors hover:text-accent-ink'

  return (
    <div className="page-container page-enter">
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex flex-wrap items-center gap-1.5 font-mono text-xs text-label"
      >
        <Link
          to="/locations"
          activeOptions={{ exact: true }}
          className={crumbLink}
        >
          Locations
        </Link>
        <ChevronRight size={12} />
        <Link
          to="/locations/$slug"
          params={{ slug }}
          activeOptions={{ exact: true }}
          className={crumbLink}
        >
          {camera.state_name}
        </Link>
        <ChevronRight size={12} />
        <Link
          to="/locations/$slug/$sublocationSlug"
          params={{ slug, sublocationSlug }}
          activeOptions={{ exact: true }}
          className={crumbLink}
        >
          {camera.sublocation_name}
        </Link>
        <ChevronRight size={12} />
        <Link
          to="/locations/$slug/$sublocationSlug/$cameraSlug"
          params={{ slug, sublocationSlug, cameraSlug }}
          activeOptions={{ exact: true }}
          className={crumbLink}
        >
          {camera.title}
        </Link>
        <ChevronRight size={12} />
        <span className="text-text">Archive</span>
      </nav>

      <SectionHead
        as="h1"
        title={`${camera.title} Archive`}
        body={`Stills captured every 15 minutes at ${camera.sublocation_name}, ${camera.state_name}.`}
      />

      {days.length === 0 ? (
        <p className="text-subtext0">
          No archived stills yet — check back once the camera has been running a
          while.
        </p>
      ) : (
        <>
          <div className="mb-6 max-w-xs">
            <Dropdown
              label="Day"
              options={days.map((d) => ({ value: d, label: dayLabel(d) }))}
              selectedValue={selectedDay ?? days[0]}
              onSelect={(val) => setSelectedDay(String(val))}
            />
          </div>

          {loading ? (
            <p className="text-subtext0">Loading…</p>
          ) : frames.length === 0 ? (
            <p className="text-subtext0">
              No stills were captured on {selectedDay && dayLabel(selectedDay)}.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {frames.map((frame) => (
                <div
                  key={frame.url}
                  className="overflow-hidden rounded-xl border border-border bg-surface0"
                >
                  <a
                    href={frame.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <img
                      src={frame.url}
                      alt={`${camera.title} still at ${timeLabel(frame.time)}`}
                      width={320}
                      height={180}
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                  </a>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="font-mono text-xs tabular-nums text-text">
                      {timeLabel(frame.time)}
                    </span>
                    <a
                      href={frame.url}
                      download
                      className="inline-flex items-center gap-1 font-mono text-xs font-medium text-accent-ink hover:underline"
                    >
                      <Download size={12} />
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ArchiveNotFound() {
  const { slug, sublocationSlug } = Route.useParams()
  return (
    <div className="page-container page-enter text-center">
      <h2>Camera not found</h2>
      <p>The camera you are looking for does not exist.</p>
      <Link
        to="/locations/$slug/$sublocationSlug"
        params={{ slug, sublocationSlug }}
        className={buttonClasses({ variant: 'primary' })}
      >
        Back to location
      </Link>
    </div>
  )
}
