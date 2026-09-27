import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  ClipboardCheck,
  Film,
  Inbox,
  Landmark,
  Loader2,
  LogIn,
  MapPin,
  Megaphone,
  Newspaper,
  Radio,
  Users,
} from 'lucide-react'
import type {
  Ad,
  AdminPost,
  EventItem,
  State,
  StreamDetail,
  Sublocation,
  Video,
} from '@/lib/types'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/Button'
import {
  fetchAds,
  fetchAllEvents,
  fetchAllPosts,
  fetchStates,
  fetchStreams,
  fetchSublocationsByState,
  fetchVideos,
} from '@/lib/api'
import CamerasPanel from '@/components/admin/CamerasPanel'
import StatesPanel from '@/components/admin/StatesPanel'
import SublocationsPanel from '@/components/admin/SublocationsPanel'
import StreamsPanel from '@/components/admin/StreamsPanel'
import AdsPanel from '@/components/admin/AdsPanel'
import NotesPanel from '@/components/admin/NotesPanel'
import EventsPanel from '@/components/admin/EventsPanel'
import ReviewQueuePanel from '@/components/admin/ReviewQueuePanel'
import UsersPanel from '@/components/admin/UsersPanel'
import SubmissionsInbox from '@/components/SubmissionsInbox'

/* ────────────────────────────────────────────────
   Tab bar
   ──────────────────────────────────────────────── */

type Tab =
  | 'cameras'
  | 'states'
  | 'sublocations'
  | 'streams'
  | 'ads'
  | 'notes'
  | 'events'
  | 'submissions'
  | 'review'
  | 'users'

const TABS: Array<{ id: Tab; label: string; icon: typeof Film }> = [
  { id: 'cameras', label: 'Cameras', icon: Film },
  { id: 'states', label: 'States', icon: MapPin },
  { id: 'sublocations', label: 'Locations', icon: Landmark },
  { id: 'streams', label: 'Streams', icon: Radio },
  { id: 'ads', label: 'Ads', icon: Megaphone },
  { id: 'notes', label: 'Notes', icon: Newspaper },
  { id: 'events', label: 'Events', icon: CalendarDays },
  { id: 'submissions', label: 'Inbox', icon: Inbox },
  { id: 'review', label: 'Review', icon: ClipboardCheck },
  { id: 'users', label: 'Users', icon: Users },
]

// Behind Logto sign-in, so no crawler ever sees it and there is nothing to
// server-render — @logto/react is browser-only anyway.
export const Route = createFileRoute('/admin')({
  ssr: false,
  component: AdminPage,
})

/* ════════════════════════════════════════════════
   Auth Gate — requires isAdmin. A signed-in
   non-admin is redirected to /dashboard (the owner
   console); a signed-out visitor sees a sign-in
   prompt (signing in returns to /dashboard, then they
   can navigate here again once their admin scope is
   confirmed).
   ════════════════════════════════════════════════ */

function AdminPage() {
  const { isAuthenticated, isLoading, isAdmin, isAdminLoading, user, login } =
    useAuth()
  const navigate = useNavigate()

  // Track whether the initial auth check has completed. The Logto SDK's
  // proxy wraps every method with setIsLoading(true/false), so calling
  // getAccessToken or getIdTokenClaims causes isLoading to flicker. Without
  // this guard, each flicker would unmount the console (which fetches on
  // mount) and remount it — an infinite render loop. Same guard the owner
  // dashboard uses (see routes/dashboard.tsx).
  const authSettled = useRef(false)
  if (!isLoading) authSettled.current = true

  useEffect(() => {
    if (!authSettled.current) return
    if (!isAuthenticated || isAdminLoading) return
    if (!isAdmin) navigate({ to: '/dashboard' })
  }, [isAuthenticated, isAdminLoading, isAdmin, navigate])

  if (!authSettled.current) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className="flex flex-col items-center gap-4"
          style={{
            opacity: 0,
            animation: 'scale-fade-in 500ms var(--spring-poppy) forwards',
          }}
        >
          <div
            className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent"
            style={{ animation: 'spin 800ms linear infinite' }}
          />
          <p className="mb-0 font-mono text-sm text-subtext0">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div
          className="w-full max-w-sm"
          style={{
            opacity: 0,
            animation: 'scale-fade-in 400ms var(--spring-poppy) forwards',
          }}
        >
          <div className="overflow-hidden rounded-2xl border border-overlay0 bg-surface0 shadow-xl">
            <div className="h-1 bg-gradient-to-r from-accent via-accent/50 to-transparent" />
            <div className="p-8">
              <div className="mb-6 flex flex-col items-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
                  <LogIn size={24} className="text-accent" />
                </div>
                <h4 className="mb-0 font-display">Admin access</h4>
                <p className="mb-0 text-sm text-subtext0">
                  Sign in to reach the admin console.
                </p>
              </div>
              <Button
                text="Sign In"
                variant="primary"
                size="lg"
                className="w-full"
                onClick={login}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Still resolving the admin scope, or resolved to false and the redirect
  // effect above is about to fire — either way, don't flash the console.
  if (isAdminLoading || !isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={22} className="animate-spin text-subtext0" />
      </div>
    )
  }

  return <AdminConsole userName={user?.name ?? user?.username ?? null} />
}

/* ════════════════════════════════════════════════
   Admin Console
   ════════════════════════════════════════════════ */

function AdminConsole({ userName }: { userName: string | null }) {
  const { getToken } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('cameras')

  // Non-paginated data for dropdowns + stat cards
  const [allStates, setAllStates] = useState<Array<State>>([])
  const [allSublocations, setAllSublocations] = useState<Array<Sublocation>>([])
  const [allVideos, setAllVideos] = useState<Array<Video>>([])
  const [allStreams, setAllStreams] = useState<Array<StreamDetail>>([])
  const [allAds, setAllAds] = useState<Array<Ad>>([])
  const [allPosts, setAllPosts] = useState<Array<AdminPost>>([])
  const [allEvents, setAllEvents] = useState<Array<EventItem>>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState(false)

  // Fetch non-paginated data (for dropdowns + stat cards)
  const fetchOverview = async () => {
    setDataLoading(true)
    setDataError(false)
    try {
      const token = await getToken()
      const [statesData, videosData] = await Promise.all([
        fetchStates(),
        fetchVideos(),
      ])
      setAllStates(statesData)
      setAllVideos(videosData)

      const allSubs = await Promise.all(
        statesData.map((s) => fetchSublocationsByState(s.slug)),
      )
      setAllSublocations(allSubs.flat())

      try {
        const streamsData = await fetchStreams(token)
        setAllStreams(streamsData)
      } catch {
        setAllStreams([])
      }

      try {
        const adsData = await fetchAds(token)
        setAllAds(Array.isArray(adsData) ? adsData : [])
      } catch {
        setAllAds([])
      }

      try {
        const postsData = await fetchAllPosts(token)
        setAllPosts(Array.isArray(postsData) ? postsData : [])
      } catch {
        setAllPosts([])
      }

      try {
        const eventsData = await fetchAllEvents(token)
        setAllEvents(Array.isArray(eventsData) ? eventsData : [])
      } catch {
        setAllEvents([])
      }
    } catch {
      setDataError(true)
    } finally {
      setDataLoading(false)
    }
  }

  // Silent refresh — re-fetches data without showing skeleton loaders.
  const refreshData = async () => {
    try {
      const token = await getToken()
      const [statesData, videosData] = await Promise.all([
        fetchStates(),
        fetchVideos(),
      ])
      setAllStates(statesData)
      setAllVideos(videosData)

      const allSubs = await Promise.all(
        statesData.map((s) => fetchSublocationsByState(s.slug)),
      )
      setAllSublocations(allSubs.flat())

      try {
        const streamsData = await fetchStreams(token)
        setAllStreams(Array.isArray(streamsData) ? streamsData : [])
      } catch {
        setAllStreams([])
      }

      try {
        const adsData = await fetchAds(token)
        setAllAds(Array.isArray(adsData) ? adsData : [])
      } catch {
        setAllAds([])
      }

      try {
        const postsData = await fetchAllPosts(token)
        setAllPosts(Array.isArray(postsData) ? postsData : [])
      } catch {
        setAllPosts([])
      }

      try {
        const eventsData = await fetchAllEvents(token)
        setAllEvents(Array.isArray(eventsData) ? eventsData : [])
      } catch {
        setAllEvents([])
      }
    } catch {
      // Silent refresh — don't crash the page on failure
    }
  }

  const refreshAll = async () => {
    await refreshData()
  }

  useEffect(() => {
    fetchOverview()
  }, [])

  const tabCounts: Partial<Record<Tab, number>> = {
    cameras: allVideos.length,
    states: allStates.length,
    sublocations: allSublocations.length,
    streams: allStreams.length,
    ads: allAds.length,
    notes: allPosts.length,
    events: allEvents.length,
  }

  // Error state — failed initial load
  if (dataError && !dataLoading) {
    return (
      <div className="page-container">
        <div
          className="flex min-h-[40vh] flex-col items-center justify-center gap-5"
          style={{
            opacity: 0,
            animation: 'scale-fade-in 400ms var(--spring-poppy) forwards',
          }}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-live/10">
            <ClipboardCheck size={28} className="text-live" />
          </div>
          <div className="text-center">
            <h4 className="mb-1 font-display">Connection lost</h4>
            <p className="mb-0 max-w-xs text-sm text-subtext0">
              Could not reach the NationCam API. Check your connection and try
              again.
            </p>
          </div>
          <button
            onClick={fetchOverview}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-crust transition-all duration-200 hover:bg-accent-hover active:scale-95"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-6">
      {/* ── Header ── */}
      <div
        className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"
        style={{
          opacity: 0,
          animation: 'blur-in 500ms var(--spring-ease-out) forwards',
        }}
      >
        <div>
          <p className="mb-1 font-mono text-[11px] font-medium tracking-[0.2em] text-accent uppercase">
            Admin Console
          </p>
          <h1 className="!mb-0 !text-2xl sm:!text-3xl">
            {userName ? (
              <>
                Hello, <span className="text-accent">{userName}</span>
              </>
            ) : (
              'Admin Console'
            )}
          </h1>
        </div>
        {!dataLoading && (
          <p
            className="mb-0 font-mono text-[11px] text-subtext0"
            style={{
              opacity: 0,
              animation: 'fade-in 600ms var(--spring-ease-out) 300ms forwards',
            }}
          >
            {allVideos.length} cameras &middot; {allStates.length} states
            &middot; {allStreams.length} streams
          </p>
        )}
      </div>

      {/* ── Tab Bar ── */}
      <div
        className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3"
        style={{
          opacity: 0,
          animation: 'float-up 500ms var(--spring-bounce) 100ms forwards',
        }}
      >
        {TABS.map((tab, i) => {
          const isActive = activeTab === tab.id
          const count = dataLoading ? null : (tabCounts[tab.id] ?? null)
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group relative flex flex-col items-center gap-0.5 overflow-hidden rounded-xl border px-2 py-3 transition-all duration-300 ease-[var(--spring-snappy)] sm:gap-1 sm:px-4 sm:py-4 ${
                isActive
                  ? 'border-accent/30 bg-accent/8 text-accent shadow-sm'
                  : 'border-overlay0/50 bg-surface0/60 text-subtext0 hover:border-overlay0 hover:bg-surface0 hover:text-text'
              }`}
              style={{
                opacity: 0,
                animation: `scale-fade-in 350ms var(--spring-poppy) ${150 + i * 60}ms forwards`,
              }}
            >
              {/* Accent glow on active */}
              {isActive && (
                <div className="absolute inset-x-0 -top-px h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent" />
              )}

              <div className="flex items-center gap-1.5 sm:gap-2">
                <tab.icon
                  size={15}
                  className={
                    isActive
                      ? 'text-accent'
                      : 'text-subtext0 transition-colors group-hover:text-text'
                  }
                />
                {count !== null ? (
                  <span className="font-display text-xl font-bold leading-none sm:text-2xl">
                    {count}
                  </span>
                ) : dataLoading ? (
                  <span className="inline-block h-5 w-6 animate-pulse rounded bg-surface1 sm:h-6 sm:w-8" />
                ) : null}
              </div>
              <span className="font-mono text-[9px] leading-tight tracking-[0.15em] uppercase sm:text-[10px]">
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Tab Content ── */}
      <div
        key={activeTab}
        style={{
          opacity: 0,
          animation: 'fade-in 200ms var(--spring-ease-out) forwards',
        }}
      >
        {activeTab === 'cameras' && (
          <CamerasPanel
            videos={allVideos}
            states={allStates}
            sublocations={allSublocations}
            getToken={getToken}
            onSuccess={refreshAll}
            loading={dataLoading}
          />
        )}
        {activeTab === 'states' && (
          <StatesPanel
            states={allStates}
            getToken={getToken}
            onSuccess={refreshAll}
            loading={dataLoading}
          />
        )}
        {activeTab === 'sublocations' && (
          <SublocationsPanel
            sublocations={allSublocations}
            states={allStates}
            getToken={getToken}
            onSuccess={refreshAll}
            loading={dataLoading}
          />
        )}
        {activeTab === 'streams' && (
          <StreamsPanel
            streams={allStreams}
            getToken={getToken}
            onSuccess={refreshAll}
            loading={dataLoading}
          />
        )}
        {activeTab === 'ads' && (
          <AdsPanel
            ads={allAds}
            states={allStates}
            sublocations={allSublocations}
            videos={allVideos}
            getToken={getToken}
            onSuccess={refreshAll}
            loading={dataLoading}
          />
        )}
        {activeTab === 'notes' && (
          <NotesPanel
            posts={allPosts}
            states={allStates}
            sublocations={allSublocations}
            videos={allVideos}
            getToken={getToken}
            onSuccess={refreshAll}
            loading={dataLoading}
          />
        )}
        {activeTab === 'events' && (
          <EventsPanel
            events={allEvents}
            states={allStates}
            sublocations={allSublocations}
            videos={allVideos}
            getToken={getToken}
            onSuccess={refreshAll}
            loading={dataLoading}
          />
        )}
        {activeTab === 'submissions' && <SubmissionsInbox />}
        {activeTab === 'review' && <ReviewQueuePanel />}
        {activeTab === 'users' && <UsersPanel />}
      </div>
    </div>
  )
}
