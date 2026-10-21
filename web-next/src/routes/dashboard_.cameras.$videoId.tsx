import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Download,
  Loader2,
  LogIn,
  Pause,
  RefreshCw,
  X,
} from 'lucide-react'
import type { Frame, OwnerVideoStatus, Visibility } from '@/lib/types'
import { isPrivateCamera } from '@/lib/types'
import { useAuth } from '@/hooks/useAuth'
import { usePrivateImage } from '@/hooks/usePrivateImage'
import Button, { buttonClasses } from '@/components/Button'
import Dropdown from '@/components/Dropdown'
import Panel from '@/components/ui/Panel'
import SectionHead from '@/components/ui/SectionHead'
import StreamPlayer from '@/components/StreamPlayer'
import { StatusPill, VisibilityPill } from '@/components/owner/ownerUi'
import {
  fetchAllVideosAdmin,
  fetchMyVideos,
  fetchPrivateFrameDays,
  fetchPrivateFrames,
  fetchPrivateImage,
  privateVideoPath,
  watchSrc,
} from '@/lib/api'

/**
 * The page a member opens from /dashboard to watch a camera they can view —
 * private ones included (DAN-383). The live player asks for its stream token
 * with the caller's bearer token; the latest still and the archive come from
 * the bearer-authenticated `/private/videos/{id}/…` routes and are shown from
 * object URLs, since an `<img>` cannot send a header. DAN-207's command center
 * links here.
 *
 * `/dashboard_` (trailing underscore) keeps this route out of the dashboard's
 * layout: it is its own page, at `/dashboard/cameras/$videoId`.
 */
export const Route = createFileRoute('/dashboard_/cameras/$videoId')({
  ssr: false,
  component: PrivateCameraRoute,
})

/** What the page needs of a camera; `OwnerVideo` and the admin `Video` both fit. */
interface WatchCamera {
  video_id: number
  title: string
  src: string
  type: string
  status: OwnerVideoStatus
  state_name: string
  sublocation_name: string
  visibility?: Visibility
  sublocation_visibility?: Visibility | ''
}

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

/* ════════════════════════════════════════════════
   Auth gate — same shape as /dashboard
   ════════════════════════════════════════════════ */

function PrivateCameraRoute() {
  const { videoId } = Route.useParams()
  const { isAuthenticated, isLoading, login } = useAuth()

  // The Logto SDK flickers isLoading on every token call; once the first
  // check settles, never unmount the page for it (see routes/dashboard.tsx).
  const authSettled = useRef(false)
  if (!isLoading) authSettled.current = true

  if (!authSettled.current) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={22} className="animate-spin text-subtext0" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <Panel accentTop padding="lg">
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <LogIn size={24} className="text-accent" />
              <h2 className="mb-0 font-display text-h3">Sign in to watch</h2>
              <p className="mb-0 text-sm text-subtext1">
                This camera is only available to its team.
              </p>
            </div>
            <Button size="lg" block onClick={login}>
              Sign In
            </Button>
          </Panel>
        </div>
      </div>
    )
  }

  return <PrivateCameraPage id={Number(videoId)} />
}

/* ════════════════════════════════════════════════
   Page
   ════════════════════════════════════════════════ */

function PrivateCameraPage({ id }: { id: number }) {
  const { getToken } = useAuth()
  const [camera, setCamera] = useState<WatchCamera | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>(
    'loading',
  )
  const [error, setError] = useState('')

  // Fetch once per camera. Deliberately not keyed on isAdmin: the Logto
  // flicker described in routes/dashboard.tsx would refetch in a loop.
  useEffect(() => {
    const run = { cancelled: false }
    setState('loading')
    ;(async () => {
      try {
        const token = await getToken()
        // Everything a member can view is in /me/videos (the same
        // CanViewCamera rule the private routes enforce).
        let found: WatchCamera | null =
          (await fetchMyVideos(token)).find((v) => v.video_id === id) ?? null
        // A NationCam admin may open any camera for support without being a
        // member; their list is the admin one (raw src, plays via the proxy).
        // Asked of everyone not found above: for a non-admin the API answers
        // 403, which just means "not found" here.
        if (!found) {
          found = await fetchAllVideosAdmin(token)
            .then((all) => all.find((v) => v.video_id === id) ?? null)
            .catch(() => null)
        }
        if (run.cancelled) return
        setCamera(found)
        setState(found ? 'ready' : 'missing')
      } catch (err) {
        if (run.cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load.')
        setState('error')
      }
    })()
    return () => {
      run.cancelled = true
    }
  }, [id])

  const back = (
    <Link
      to="/dashboard"
      className="mb-6 inline-flex items-center gap-1.5 font-mono text-xs text-label transition-colors hover:text-accent-ink"
    >
      <ArrowLeft size={13} />
      My NationCam
    </Link>
  )

  if (state === 'loading') {
    return (
      <div className="page-container">
        {back}
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 size={22} className="animate-spin text-subtext0" />
        </div>
      </div>
    )
  }

  if (state !== 'ready' || !camera) {
    return (
      <div className="page-container">
        {back}
        <Panel className="mx-auto max-w-md text-center">
          <h2 className="mb-1 font-display text-h3">
            {state === 'error'
              ? 'Could not load this camera'
              : 'Camera not found'}
          </h2>
          <p className="mb-4 text-sm text-subtext1">
            {state === 'error'
              ? error
              : "It doesn't exist, or your account doesn't have access to it."}
          </p>
          <Link
            to="/dashboard"
            className={buttonClasses({ variant: 'primary' })}
          >
            Back to my cameras
          </Link>
        </Panel>
      </div>
    )
  }

  return (
    <div className="page-container page-enter space-y-8">
      <div>
        {back}
        <SectionHead
          as="h1"
          eyebrow="Private camera"
          title={camera.title}
          body={
            <div className="flex flex-wrap items-center gap-2">
              <p className="mono-label mb-0">
                {camera.state_name}
                {camera.sublocation_name ? ` · ${camera.sublocation_name}` : ''}
              </p>
              <StatusPill status={camera.status} />
              <VisibilityPill isPrivate={isPrivateCamera(camera)} />
            </div>
          }
          className="mb-0"
        />
      </div>

      <LiveSection camera={camera} getToken={getToken} />
      <Archive videoId={camera.video_id} title={camera.title} />
    </div>
  )
}

/* ════════════════════════════════════════════════
   Live player + latest still
   ════════════════════════════════════════════════ */

function LiveSection({
  camera,
  getToken,
}: {
  camera: WatchCamera
  getToken: () => Promise<string | null>
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const live = camera.status === 'active'
  const watchable = live || camera.status === 'paused'
  const still = usePrivateImage(
    watchable ? privateVideoPath(camera.video_id, 'snapshot.jpg?w=640') : null,
    getToken,
    reloadKey,
  )

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div>
        {live ? (
          <StreamPlayer
            src={watchSrc(camera)}
            type={camera.type}
            autoplay
            muted
            controls
            fluid
            live
            videoId={camera.video_id}
            poster={still.url ?? undefined}
            getToken={getToken}
            className="shadow-xl"
          />
        ) : (
          <div className="stream-player aspect-video shadow-xl">
            {still.url && (
              <img
                src={still.url}
                alt=""
                className="h-full w-full object-cover opacity-30"
              />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-crust/50 px-6 text-center">
              <Pause size={28} className="text-overlay1" />
              <p className="mb-0 font-sans font-semibold text-text">
                {camera.status === 'paused'
                  ? 'This camera has been paused'
                  : 'This camera is not live yet'}
              </p>
              <p className="mb-0 text-sm text-subtext1">
                {camera.status === 'paused'
                  ? 'Its stream is stopped. Resume it from your dashboard to watch live.'
                  : 'A camera can be watched once it has been approved and is running.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <Panel className="self-start">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="mono-label mb-0">Latest still</p>
          {watchable && (
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={still.loading}
              className="inline-flex items-center gap-1 font-mono text-xs font-medium text-accent-ink hover:underline disabled:opacity-50"
            >
              <RefreshCw
                size={12}
                className={still.loading ? 'animate-spin' : ''}
              />
              Refresh
            </button>
          )}
        </div>
        <div className="aspect-video overflow-hidden rounded-lg bg-crust">
          {still.url ? (
            <img
              src={still.url}
              alt={`${camera.title}, latest still`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-subtext0">
              {!watchable
                ? 'No still until the camera is live.'
                : still.loading
                  ? 'Loading…'
                  : 'The latest still is not available right now.'}
            </div>
          )}
        </div>
      </Panel>
    </section>
  )
}

/* ════════════════════════════════════════════════
   Archive — day picker and frames
   ════════════════════════════════════════════════ */

function Archive({ videoId, title }: { videoId: number; title: string }) {
  const { getToken } = useAuth()
  const [days, setDays] = useState<Array<string> | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [frames, setFrames] = useState<Array<Frame>>([])
  const [loadingFrames, setLoadingFrames] = useState(false)
  const [open, setOpen] = useState<Frame | null>(null)

  // Days with stills, newest first; the newest one opens by default.
  useEffect(() => {
    const run = { cancelled: false }
    ;(async () => {
      const token = await getToken()
      const list = await fetchPrivateFrameDays(videoId, token)
      if (run.cancelled) return
      setDays(list)
      setDay(list[0] ?? null)
    })()
    return () => {
      run.cancelled = true
    }
  }, [videoId])

  useEffect(() => {
    if (!day) {
      setFrames([])
      return
    }
    const run = { cancelled: false }
    setLoadingFrames(true)
    ;(async () => {
      const token = await getToken()
      const res = await fetchPrivateFrames(videoId, day, token)
      if (run.cancelled) return
      setFrames(res.frames)
      setLoadingFrames(false)
    })()
    return () => {
      run.cancelled = true
    }
  }, [videoId, day])

  return (
    <section>
      <SectionHead
        eyebrow="Archive"
        title="Snapshot archive"
        body="Stills captured every 15 minutes. Only your team can see them."
        className="mb-6"
      />

      {days === null ? (
        <p className="text-subtext0">Loading…</p>
      ) : days.length === 0 ? (
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
              selectedValue={day ?? days[0]}
              onSelect={(val) => setDay(String(val))}
            />
          </div>

          {loadingFrames ? (
            <p className="text-subtext0">Loading…</p>
          ) : frames.length === 0 ? (
            <p className="text-subtext0">
              No stills were captured on {day && dayLabel(day)}.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {frames.map((frame) => (
                <FrameTile
                  key={frame.url}
                  frame={frame}
                  title={title}
                  getToken={getToken}
                  onOpen={() => setOpen(frame)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {open && (
        <Lightbox
          frame={open}
          title={title}
          getToken={getToken}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  )
}

/** A thumbnail that only fetches (with the bearer) once it nears the viewport:
 *  a day holds up to 96 frames. */
function FrameTile({
  frame,
  title,
  getToken,
  onOpen,
}: {
  frame: Frame
  title: string
  getToken: () => Promise<string | null>
  onOpen: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const thumb = usePrivateImage(near ? `${frame.url}?w=320` : null, getToken)

  const download = async () => {
    setDownloading(true)
    try {
      const blob = await fetchPrivateImage(frame.url, await getToken())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = frame.url.split('/').slice(-3).join('-')
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      /* the button simply re-enables */
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-xl border border-border bg-surface0"
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full"
        aria-label={`Open ${title} still at ${timeLabel(frame.time)}`}
      >
        <div className="aspect-video w-full bg-crust">
          {thumb.url && (
            <img
              src={thumb.url}
              alt={`${title} still at ${timeLabel(frame.time)}`}
              className="h-full w-full object-cover"
            />
          )}
        </div>
      </button>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-mono text-xs text-text tabular-nums">
          {timeLabel(frame.time)}
        </span>
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className="inline-flex items-center gap-1 font-mono text-xs font-medium text-accent-ink hover:underline disabled:opacity-50"
        >
          {downloading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Download size={12} />
          )}
          Download
        </button>
      </div>
    </div>
  )
}

/** The full-size frame, fetched with the bearer when opened. */
function Lightbox({
  frame,
  title,
  getToken,
  onClose,
}: {
  frame: Frame
  title: string
  getToken: () => Promise<string | null>
  onClose: () => void
}) {
  const full = usePrivateImage(frame.url, getToken)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} still at ${timeLabel(frame.time)}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-crust/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-md bg-surface0 text-text"
      >
        <X size={18} />
      </button>
      <div
        className="max-h-full max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        {full.url ? (
          <img
            src={full.url}
            alt={`${title} still at ${timeLabel(frame.time)}`}
            className="max-h-[85vh] w-auto rounded-lg"
          />
        ) : (
          <p className="mb-0 font-mono text-sm text-subtext1">
            {full.failed ? 'This still could not be loaded.' : 'Loading…'}
          </p>
        )}
        <p className="mt-2 mb-0 text-center font-mono text-xs text-subtext1">
          {timeLabel(frame.time)}
        </p>
      </div>
    </div>
  )
}
