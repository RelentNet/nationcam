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
  Music2,
  Newspaper,
  Radio,
  Users,
} from 'lucide-react'
import type {
  Ad,
  AdminPost,
  AudioStation,
  EventItem,
  State,
  StreamDetail,
  Sublocation,
  Video,
} from '@/lib/types'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/Button'
import Panel from '@/components/ui/Panel'
import SectionHead from '@/components/ui/SectionHead'
import {
  fetchAds,
  fetchAllEvents,
  fetchAllPosts,
  fetchAudioStations,
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
import AudioPanel from '@/components/admin/AudioPanel'
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
  | 'audio'
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
  { id: 'audio', label: 'Audio', icon: Music2 },
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
          <Panel accentTop padding="lg">
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <LogIn size={24} className="text-accent" />
              <h2 className="mb-0 font-display text-h3">Admin access</h2>
              <p className="mb-0 text-sm text-subtext1">
                Sign in to reach the admin console.
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
  const [allAudioStations, setAllAudioStations] = useState<Array<AudioStation>>(
    [],
  )
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

      try {
        const audioData = await fetchAudioStations(token)
        setAllAudioStations(Array.isArray(audioData) ? audioData : [])
      } catch {
        setAllAudioStations([])
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

      try {
        const audioData = await fetchAudioStations(token)
        setAllAudioStations(Array.isArray(audioData) ? audioData : [])
      } catch {
        setAllAudioStations([])
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
    audio: allAudioStations.length,
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
          <ClipboardCheck size={28} className="text-live" />
          <div className="text-center">
            <h2 className="mb-1 font-display text-h3">Connection lost</h2>
            <p className="mb-0 max-w-xs text-sm text-subtext1">
              Could not reach the NationCam API. Check your connection and try
              again.
            </p>
          </div>
          <Button onClick={fetchOverview}>Retry</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-6">
      {/* ── Header ── */}
      <SectionHead
        as="h1"
        eyebrow="Admin Console"
        title={
          userName ? (
            <>
              Hello, <span className="text-accent-ink">{userName}</span>
            </>
          ) : (
            'Admin Console'
          )
        }
        body={
          !dataLoading ? (
            <p className="mono-label">
              {allVideos.length} cameras &middot; {allStates.length} states
              &middot; {allStreams.length} streams
            </p>
          ) : undefined
        }
      />

      {/* ── Tab Bar ── */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const count = dataLoading ? null : (tabCounts[tab.id] ?? null)
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={isActive}
              className={`group relative flex flex-col items-center gap-0.5 overflow-hidden rounded-xl border px-2 py-3 transition-colors duration-150 sm:gap-1 sm:px-4 sm:py-4 ${
                isActive
                  ? 'border-accent bg-accent/8 text-accent-ink shadow-[inset_0_2px_0_var(--color-accent)]'
                  : 'border-border bg-surface0 text-subtext1 hover:border-border-input hover:text-text'
              }`}
            >
              <div className="flex items-center gap-1.5 sm:gap-2">
                <tab.icon size={15} />
                {count !== null ? (
                  <span className="font-display text-xl leading-none font-bold sm:text-2xl">
                    {count}
                  </span>
                ) : dataLoading ? (
                  <span className="inline-block h-5 w-6 animate-pulse rounded bg-surface1 sm:h-6 sm:w-8" />
                ) : null}
              </div>
              <span className="mono-label leading-tight text-inherit">
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Tab Content ── */}
      <div key={activeTab}>
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
        {activeTab === 'audio' && (
          <AudioPanel
            stations={allAudioStations}
            states={allStates}
            sublocations={allSublocations}
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
