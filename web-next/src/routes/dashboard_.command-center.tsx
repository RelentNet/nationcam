import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogIn,
  Maximize,
  Minimize,
  Plus,
  VideoOff,
} from 'lucide-react'
import type { MyAccount, OwnerVideo, VideoState } from '@/lib/types'
import type { WallLayout } from '@/lib/wall'
import { useAuth } from '@/hooks/useAuth'
import Button, { buttonClasses } from '@/components/Button'
import Dropdown from '@/components/Dropdown'
import Panel from '@/components/ui/Panel'
import SectionHead from '@/components/ui/SectionHead'
import WallTile from '@/components/wall/WallTile'
import { fetchMyAccounts, fetchMyVideoStatuses, fetchMyVideos } from '@/lib/api'
import {
  LAYOUT_COLUMNS,
  STATUS_POLL_MS,
  STILL_REFRESH_MS,
  WALL_LAYOUTS,
  groupByLocation,
  loadAccountId,
  loadLayout,
  pageCount,
  saveAccountId,
  saveLayout,
  sortForWall,
  startLive,
} from '@/lib/wall'

/**
 * The command center (DAN-207): every camera a member can view in one account
 * on one wall, grouped by location, with a live status badge per tile. Stills
 * by default; a tile goes live on hover or via its play button, at most four
 * at a time. Clicking a tile opens `/dashboard/cameras/$videoId`.
 *
 * `/dashboard_` (trailing underscore) keeps this route out of the dashboard's
 * layout, same as the camera page.
 */
export const Route = createFileRoute('/dashboard_/command-center')({
  ssr: false,
  component: CommandCenterRoute,
})

/* ════════════════════════════════════════════════
   Auth gate — same shape as /dashboard
   ════════════════════════════════════════════════ */

function CommandCenterRoute() {
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
              <h2 className="mb-0 font-display text-h3">Sign in to continue</h2>
              <p className="mb-0 text-sm text-subtext1">
                The command center shows the cameras your account can view.
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

  return <CommandCenter />
}

/* ════════════════════════════════════════════════
   Page
   ════════════════════════════════════════════════ */

/** The wall is wider than the dashboard's reading column. */
const WIDE = 'mx-auto mt-[72px] mb-16 w-full max-w-[1760px] px-4 sm:px-6'

/** Static classes per layout so Tailwind sees them (columns step down on
 *  narrow screens). */
const GRID_CLASSES: Record<WallLayout, string> = {
  1: 'grid-cols-1',
  4: 'grid-cols-1 sm:grid-cols-2',
  9: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  16: 'grid-cols-2 lg:grid-cols-4',
}

function CommandCenter() {
  const { getToken } = useAuth()
  // Read at call time so a new function identity never re-runs the effects.
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken
  const tokenFn = useRef(() => getTokenRef.current()).current

  const [accounts, setAccounts] = useState<Array<MyAccount>>([])
  const [videos, setVideos] = useState<Array<OwnerVideo>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [states, setStates] = useState<Map<number, VideoState>>(new Map())

  const [layout, setLayout] = useState<WallLayout>(() => loadLayout())
  const [accountId, setAccountId] = useState<number | null>(() =>
    loadAccountId(),
  )
  const [page, setPage] = useState(0)
  const [live, setLive] = useState<Array<number>>([])
  const [stillTick, setStillTick] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const wallRef = useRef<HTMLDivElement>(null)

  // Load the cameras once. Deliberately empty deps (Logto isLoading flicker).
  useEffect(() => {
    const run = { cancelled: false }
    ;(async () => {
      try {
        const t = await tokenFn()
        const [accts, vids] = await Promise.all([
          fetchMyAccounts(t),
          fetchMyVideos(t),
        ])
        if (run.cancelled) return
        setAccounts(accts)
        setVideos(vids)
      } catch (err) {
        if (!run.cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load your cameras.',
          )
        }
      } finally {
        if (!run.cancelled) setLoading(false)
      }
    })()
    return () => {
      run.cancelled = true
    }
  }, [])

  // Status every 30 s and stills every 60 s, only while the tab is visible;
  // coming back to the tab refreshes both at once.
  useEffect(() => {
    let cancelled = false
    const pollStatus = async () => {
      try {
        const rows = await fetchMyVideoStatuses(await tokenFn())
        if (!cancelled)
          setStates(new Map(rows.map((r) => [r.video_id, r.state])))
      } catch {
        /* keep the last known states; the next poll retries */
      }
    }
    const visible = () => document.visibilityState !== 'hidden'
    pollStatus()
    const statusTimer = setInterval(() => {
      if (visible()) pollStatus()
    }, STATUS_POLL_MS)
    const stillTimer = setInterval(() => {
      if (visible()) setStillTick((n) => n + 1)
    }, STILL_REFRESH_MS)
    const onVisible = () => {
      if (visible()) {
        pollStatus()
        setStillTick((n) => n + 1)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(statusTimer)
      clearInterval(stillTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Personal account first, then shared ones by name.
  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort(
        (a, b) =>
          Number(b.personal) - Number(a.personal) ||
          a.name.localeCompare(b.name),
      ),
    [accounts],
  )
  const activeAccount: MyAccount | null =
    sortedAccounts.find((a) => a.account_id === accountId) ??
    // No (valid) saved choice: the first account that has cameras to show.
    sortedAccounts.find((a) =>
      videos.some((v) => v.account_id === a.account_id),
    ) ??
    (sortedAccounts.length > 0 ? sortedAccounts[0] : null)

  const cameras = useMemo(
    () =>
      sortForWall(
        videos.filter(
          (v) => activeAccount && v.account_id === activeAccount.account_id,
        ),
      ),
    [videos, activeAccount],
  )

  const pages = pageCount(cameras.length, layout)
  const safePage = Math.min(page, pages - 1)
  const pageCameras = cameras.slice(safePage * layout, (safePage + 1) * layout)
  const groups = useMemo(() => groupByLocation(pageCameras), [pageCameras])

  // A camera that scrolled off the page (or was removed) stops playing and
  // frees its slot under the cap.
  useEffect(() => {
    const onPage = new Set(pageCameras.map((c) => c.video_id))
    setLive((l) =>
      l.every((id) => onPage.has(id)) ? l : l.filter((id) => onPage.has(id)),
    )
  }, [pageCameras])

  const chooseLayout = (next: WallLayout) => {
    setLayout(next)
    setPage(0)
    saveLayout(next)
  }
  const chooseAccount = (id: number) => {
    setAccountId(id)
    setPage(0)
    setLive([])
    saveAccountId(id)
  }

  // Fullscreen wall: the browser's Fullscreen API when it works, with the
  // fixed full-viewport layout as the fallback (and the thing that sizes it).
  const enterWall = () => setFullscreen(true)
  const exitWall = () => {
    setFullscreen(false)
    try {
      if (document.fullscreenElement)
        document.exitFullscreen().catch(() => undefined)
    } catch {
      /* already out */
    }
  }
  useEffect(() => {
    if (!fullscreen) return
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('keydown', onKey)
    // The wall element exists now; ask the browser for real fullscreen.
    try {
      wallRef.current?.requestFullscreen().catch(() => undefined)
    } catch {
      /* the fixed layout alone is still a wall */
    }
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('keydown', onKey)
    }
  }, [fullscreen])

  const back = (
    <Link
      to="/dashboard"
      className="mb-6 inline-flex items-center gap-1.5 font-mono text-xs text-label transition-colors hover:text-accent-ink"
    >
      <ArrowLeft size={13} />
      My NationCam
    </Link>
  )

  if (loading) {
    return (
      <div className="page-container">
        {back}
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 size={22} className="animate-spin text-subtext0" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        {back}
        <Panel className="mx-auto max-w-md text-center">
          <h2 className="mb-1 font-display text-h3">
            Could not load your cameras
          </h2>
          <p className="mb-0 text-sm text-subtext1">{error}</p>
        </Panel>
      </div>
    )
  }

  const toolbar = (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      {sortedAccounts.length > 1 && activeAccount && (
        <div className="w-56">
          <Dropdown
            label="Account"
            options={sortedAccounts.map((a) => ({
              value: a.account_id,
              label: a.name,
            }))}
            selectedValue={activeAccount.account_id}
            onSelect={(v) => chooseAccount(Number(v))}
          />
        </div>
      )}

      <div>
        <p className="mono-label mb-1.5">Layout</p>
        <div className="flex gap-1" role="group" aria-label="Tiles per screen">
          {WALL_LAYOUTS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => chooseLayout(n)}
              aria-pressed={layout === n}
              className={`h-8 min-w-9 rounded-md border px-2 font-mono text-xs font-medium transition-colors ${
                layout === n
                  ? 'border-accent bg-accent/10 text-accent-ink'
                  : 'border-border text-subtext1 hover:border-accent hover:text-text'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {pages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-subtext1 hover:border-accent hover:text-text disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-20 text-center font-mono text-xs text-subtext1 tabular-nums">
              Page {safePage + 1} of {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pages - 1, safePage + 1))}
              disabled={safePage >= pages - 1}
              aria-label="Next page"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-subtext1 hover:border-accent hover:text-text disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={fullscreen ? exitWall : enterWall}
          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
        >
          {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          {fullscreen ? 'Exit wall' : 'Wall mode'}
        </button>
      </div>
    </div>
  )

  const tile = (cam: OwnerVideo) => (
    <WallTile
      key={cam.video_id}
      camera={cam}
      state={states.get(cam.video_id)}
      isLive={live.includes(cam.video_id)}
      stillTick={stillTick}
      fill={fullscreen}
      getToken={tokenFn}
      onStartLive={(id) => setLive((l) => startLive(l, id))}
      onStopLive={(id) => setLive((l) => l.filter((x) => x !== id))}
    />
  )

  /* ── Empty: nothing to put on a wall ── */
  if (cameras.length === 0) {
    return (
      <div className={WIDE}>
        {back}
        <SectionHead
          as="h1"
          eyebrow="Command center"
          title="All your cameras"
        />
        {toolbar}
        <Panel className="mx-auto mt-8 max-w-md text-center">
          <VideoOff size={24} className="mx-auto mb-3 text-subtext0" />
          <h2 className="mb-1 font-display text-h3">No cameras yet</h2>
          <p className="mb-4 text-sm text-subtext1">
            {activeAccount
              ? `${activeAccount.name} has no cameras you can view.`
              : 'You do not have access to any cameras yet.'}{' '}
            Add one from your dashboard, or ask an account admin to share theirs
            with you.
          </p>
          <Link
            to="/dashboard"
            className={buttonClasses({ variant: 'primary' })}
          >
            <Plus size={14} />
            Go to my dashboard
          </Link>
        </Panel>
      </div>
    )
  }

  /* ── Fullscreen wall: one grid filling the viewport, no headings (each
        tile already names its location) ── */
  if (fullscreen) {
    const cols = LAYOUT_COLUMNS[layout]
    const rows = Math.ceil(layout / cols)
    return (
      <div
        ref={wallRef}
        data-testid="wall-fullscreen"
        className="fixed inset-0 z-[60] flex flex-col gap-3 bg-base p-3"
      >
        {toolbar}
        <div
          className="grid min-h-0 flex-1 gap-2"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {pageCameras.map(tile)}
        </div>
      </div>
    )
  }

  return (
    <div ref={wallRef} className={`${WIDE} page-enter space-y-6`}>
      <div>
        {back}
        <SectionHead
          as="h1"
          eyebrow="Command center"
          title="All your cameras"
          body={
            <p className="mono-label mb-0">
              {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'}
              {activeAccount ? ` · ${activeAccount.name}` : ''}
            </p>
          }
          className="mb-0"
        />
      </div>

      {toolbar}

      {groups.map((g) => (
        <section
          key={`${g.key}-${g.cameras[0].video_id}`}
          className="space-y-3"
        >
          <h2 className="mono-label mb-0 border-b border-border pb-2">
            {g.heading}
            <span className="ml-2 text-subtext0">{g.cameras.length}</span>
          </h2>
          <div className={`grid gap-3 ${GRID_CLASSES[layout]}`}>
            {g.cameras.map(tile)}
          </div>
        </section>
      ))}
    </div>
  )
}
