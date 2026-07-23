import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  Film,
  Globe,
  Landmark,
  Loader2,
  LogIn,
  MapPin,
  Megaphone,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Video as VideoIcon,
  X,
} from 'lucide-react'
import type {
  Ad,
  AdInput,
  AdPlacement,
  AdType,
  State,
  StreamDetail,
  Sublocation,
  Video,
} from '@/lib/types'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/Button'
import Dropdown from '@/components/Dropdown'
import {
  createAd,
  createState,
  createStream,
  createSublocation,
  createVideo,
  deleteAd,
  deleteState,
  deleteStream,
  deleteSublocation,
  deleteVideo,
  fetchAds,
  fetchStates,
  fetchStreams,
  fetchSublocationsByState,
  fetchVideos,
  restartStream,
  updateAd,
  updateState,
  updateSublocation,
  updateVideo,
} from '@/lib/api'

/* ──── Constants ──── */

type Tab = 'cameras' | 'states' | 'sublocations' | 'streams' | 'ads'

const TABS: Array<{ id: Tab; label: string; icon: typeof Film }> = [
  { id: 'cameras', label: 'Cameras', icon: Film },
  { id: 'states', label: 'States', icon: MapPin },
  { id: 'sublocations', label: 'Locations', icon: Landmark },
  { id: 'streams', label: 'Streams', icon: Radio },
  { id: 'ads', label: 'Ads', icon: Megaphone },
]

// Ad type + scope + placement option lists for the create/edit dropdowns.
type ScopeKind = 'house' | 'state' | 'sublocation' | 'camera'

const AD_TYPE_OPTIONS = [
  { value: 'preroll_video', label: 'Pre-roll video' },
  { value: 'banner_html', label: 'Banner (HTML)' },
]

const SCOPE_OPTIONS = [
  { value: 'sublocation', label: 'Sublocation' },
  { value: 'state', label: 'State' },
  { value: 'camera', label: 'Camera' },
  { value: 'house', label: 'House (global)' },
]

const PLACEMENT_OPTIONS = [
  { value: 'left', label: 'Left rail' },
  { value: 'right', label: 'Right rail' },
  { value: 'mobile', label: 'Mobile' },
]

const VIDEO_TYPE_OPTIONS = [
  { value: 'application/x-mpegURL', label: 'HLS (recommended)' },
  { value: 'video/mp4', label: 'MP4' },
  { value: 'video/webm', label: 'WebM' },
  { value: 'video/ogg', label: 'Ogg' },
  { value: 'application/dash+xml', label: 'DASH' },
]

const VIDEO_TYPE_LABELS: Record<string, string> = {
  'video/mp4': 'MP4',
  'video/webm': 'WebM',
  'video/ogg': 'Ogg',
  'application/x-mpegURL': 'HLS',
  'application/dash+xml': 'DASH',
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const PER_PAGE = 20

const ENTITY_SORT_OPTIONS: Array<{
  value: string
  label: string
  icon: typeof ArrowDownAZ
}> = [
  { value: 'a-z', label: 'A\u2192Z', icon: ArrowDownAZ },
  { value: 'z-a', label: 'Z\u2192A', icon: ArrowUpAZ },
  { value: 'newest', label: 'Newest', icon: CalendarArrowDown },
  { value: 'oldest', label: 'Oldest', icon: CalendarArrowUp },
]

const STREAM_SORT_OPTIONS: Array<{
  value: string
  label: string
  icon: typeof ArrowDownAZ
}> = [
  { value: 'a-z', label: 'A\u2192Z', icon: ArrowDownAZ },
  { value: 'z-a', label: 'Z\u2192A', icon: ArrowUpAZ },
  { value: 'running', label: 'Running', icon: Radio },
]

// Behind Logto sign-in, so no crawler ever sees it and there is nothing to
// server-render — @logto/react is browser-only anyway.
export const Route = createFileRoute('/dashboard')({
  ssr: false,
  component: DashboardPage,
})

/* ════════════════════════════════════════════════
   Auth Gate
   ════════════════════════════════════════════════ */

function DashboardPage() {
  const { isAuthenticated, isLoading, user, login } = useAuth()

  // Track whether the initial auth check has completed. The Logto SDK's
  // proxy wraps every method with setIsLoading(true/false), so calling
  // getAccessToken or getIdTokenClaims causes isLoading to flicker.
  // Without this guard, each flicker unmounts DashboardContent (which
  // triggers fetchOverview → getToken → getAccessToken → isLoading
  // flicker → unmount → remount → infinite loop).
  const authSettled = useRef(false)
  if (!isLoading) authSettled.current = true

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
          <p className="mb-0 font-mono text-sm text-subtext0">
            Authenticating...
          </p>
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
                <h4 className="mb-0 font-display">Sign in to continue</h4>
                <p className="mb-0 text-sm text-subtext0">
                  Authentication required for dashboard access.
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

  return <DashboardContent userName={user?.name ?? user?.username ?? null} />
}

/* ════════════════════════════════════════════════
   Dashboard Content
   ════════════════════════════════════════════════ */

function DashboardContent({ userName }: { userName: string | null }) {
  const { getToken } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('cameras')

  // Non-paginated data for dropdowns + stat cards
  const [allStates, setAllStates] = useState<Array<State>>([])
  const [allSublocations, setAllSublocations] = useState<Array<Sublocation>>([])
  const [allVideos, setAllVideos] = useState<Array<Video>>([])
  const [allStreams, setAllStreams] = useState<Array<StreamDetail>>([])
  const [allAds, setAllAds] = useState<Array<Ad>>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState(false)

  // Server-side pagination removed — all filtering/sorting/pagination
  // is now handled client-side within each panel using the full datasets.

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

  const tabCounts: Record<Tab, number> = {
    cameras: allVideos.length,
    states: allStates.length,
    sublocations: allSublocations.length,
    streams: allStreams.length,
    ads: allAds.length,
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
            <AlertCircle size={28} className="text-live" />
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
            <RotateCcw size={15} />
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
            Control Room
          </p>
          <h1 className="!mb-0 !text-2xl sm:!text-3xl">
            {userName ? (
              <>
                Hello, <span className="text-accent">{userName}</span>
              </>
            ) : (
              'Dashboard'
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
          const count = dataLoading ? null : tabCounts[tab.id]
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
                ) : (
                  <span className="inline-block h-5 w-6 animate-pulse rounded bg-surface1 sm:h-6 sm:w-8" />
                )}
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
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════
   Cameras Panel
   ════════════════════════════════════════════════ */

function CamerasPanel({
  videos: allVideos,
  states,
  sublocations,
  getToken,
  onSuccess,
  loading,
}: {
  videos: Array<Video>
  states: Array<State>
  sublocations: Array<Sublocation>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [src, setSrc] = useState('')
  const [type, setType] = useState('')
  const [stateId, setStateId] = useState<number | ''>('')
  const [sublocationId, setSublocationId] = useState<number | ''>('')
  const [status, setStatus] = useState('active')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)

  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<Video | null>(null)

  // Search + sort + client-side pagination
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('a-z')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = [...allVideos]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          (v.state_name && v.state_name.toLowerCase().includes(q)) ||
          (v.sublocation_name && v.sublocation_name.toLowerCase().includes(q)),
      )
    }
    switch (sortKey) {
      case 'a-z':
        result.sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'z-a':
        result.sort((a, b) => b.title.localeCompare(a.title))
        break
      case 'newest':
        result.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        break
      case 'oldest':
        result.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        break
    }
    return result
  }, [allVideos, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const videos = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }
  const handleSort = (v: string) => {
    setSortKey(v)
    setPage(1)
  }

  const filteredSubs = sublocations.filter((s) => s.state_id === stateId)

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const token = await getToken()
      await deleteVideo(confirmDelete.id, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete camera.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !src || !type || !stateId) {
      setMsg({ text: 'Please fill in all required fields.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createVideo(
        {
          title,
          src,
          type,
          state_id: Number(stateId),
          sublocation_id: sublocationId ? Number(sublocationId) : null,
          status,
        },
        token,
      )
      setMsg({ text: 'Camera added successfully!', ok: true })
      setTitle('')
      setSrc('')
      setType('')
      setStateId('')
      setSublocationId('')
      setStatus('active')
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to add camera.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        {/* Panel header */}
        <PanelHeader
          title="Cameras"
          subtitle="Manage camera feeds and streams"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Camera"
        />

        {/* Collapsible create form */}
        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Title"
                  value={title}
                  onChange={setTitle}
                  placeholder="e.g. Miami Beach South Cam"
                />
                <FormField
                  label="Source URL"
                  value={src}
                  onChange={setSrc}
                  placeholder="https://stream.example.com/live.m3u8"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Dropdown
                  label="Video Type"
                  options={VIDEO_TYPE_OPTIONS}
                  selectedValue={type}
                  onSelect={(v) => setType(String(v))}
                />
                <Dropdown
                  label="State"
                  options={states.map((s) => ({
                    value: s.state_id,
                    label: s.name,
                  }))}
                  selectedValue={stateId}
                  onSelect={(v) => {
                    setStateId(Number(v))
                    setSublocationId('')
                  }}
                />
                {filteredSubs.length > 0 ? (
                  <Dropdown
                    label="Sublocation"
                    options={filteredSubs.map((s) => ({
                      value: s.sublocation_id,
                      label: s.name,
                    }))}
                    selectedValue={sublocationId}
                    onSelect={(v) => setSublocationId(Number(v))}
                  />
                ) : (
                  <div />
                )}
                <Dropdown
                  label="Status"
                  options={STATUS_OPTIONS}
                  selectedValue={status}
                  onSelect={(v) => setStatus(String(v))}
                />
              </div>
              <FormFooter
                msg={msg}
                submitting={submitting}
                label="Add Camera"
              />
            </form>
          </CreatePanel>
        )}

        {/* List */}
        <DataList
          loading={loading}
          empty={allVideos.length === 0}
          emptyIcon={Film}
          emptyText="No cameras yet"
          toolbar={
            !loading && allVideos.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="cameras"
                sortOptions={ENTITY_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No cameras matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {videos.map((v, i) => (
                <VideoRow
                  key={v.video_id}
                  video={v}
                  index={i}
                  onEdit={() => setEditing(v)}
                  onDelete={() =>
                    setConfirmDelete({ id: v.video_id, name: v.title })
                  }
                />
              ))}
              <PaginationBar
                page={safePage}
                perPage={PER_PAGE}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </DataList>
      </div>

      {confirmDelete && (
        <ConfirmDeleteDialog
          name={confirmDelete.name}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {editing && (
        <EditVideoModal
          video={editing}
          states={states}
          sublocations={sublocations}
          getToken={getToken}
          onSuccess={() => {
            setEditing(null)
            onSuccess()
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/* ════════════════════════════════════════════════
   States Panel
   ════════════════════════════════════════════════ */

function StatesPanel({
  states: allStates,
  getToken,
  onSuccess,
  loading,
}: {
  states: Array<State>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)

  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    slug: string
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<State | null>(null)

  // Search + sort + client-side pagination
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('a-z')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = [...allStates]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q)),
      )
    }
    switch (sortKey) {
      case 'a-z':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'z-a':
        result.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'newest':
        result.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        break
      case 'oldest':
        result.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        break
    }
    return result
  }, [allStates, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const states = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }
  const handleSort = (v: string) => {
    setSortKey(v)
    setPage(1)
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const token = await getToken()
      await deleteState(confirmDelete.slug, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete state.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) {
      setMsg({ text: 'State name is required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createState({ name, description: description || undefined }, token)
      setMsg({ text: 'State created!', ok: true })
      setName('')
      setDescription('')
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to create state.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="States"
          subtitle="Geographic regions for camera grouping"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add State"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="State Name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g. Florida"
                />
                <FormField
                  label="Description"
                  value={description}
                  onChange={setDescription}
                  placeholder="Brief description (optional)"
                />
              </div>
              <FormFooter msg={msg} submitting={submitting} label="Add State" />
            </form>
          </CreatePanel>
        )}

        <DataList
          loading={loading}
          empty={allStates.length === 0}
          emptyIcon={MapPin}
          emptyText="No states yet"
          toolbar={
            !loading && allStates.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="states"
                sortOptions={ENTITY_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No states matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {states.map((s, i) => (
                <StateRow
                  key={s.state_id}
                  state={s}
                  index={i}
                  onEdit={() => setEditing(s)}
                  onDelete={() =>
                    setConfirmDelete({ slug: s.slug, name: s.name })
                  }
                />
              ))}
              <PaginationBar
                page={safePage}
                perPage={PER_PAGE}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </DataList>
      </div>

      {confirmDelete && (
        <ConfirmDeleteDialog
          name={confirmDelete.name}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {editing && (
        <EditStateModal
          state={editing}
          getToken={getToken}
          onSuccess={() => {
            setEditing(null)
            onSuccess()
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/* ════════════════════════════════════════════════
   Sublocations Panel
   ════════════════════════════════════════════════ */

function SublocationsPanel({
  sublocations: allSublocations,
  states,
  getToken,
  onSuccess,
  loading,
}: {
  sublocations: Array<Sublocation>
  states: Array<State>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [stateId, setStateId] = useState<number | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)

  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<Sublocation | null>(null)

  // Search + sort + client-side pagination
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('a-z')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = [...allSublocations]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.state_name && s.state_name.toLowerCase().includes(q)) ||
          (s.description && s.description.toLowerCase().includes(q)),
      )
    }
    switch (sortKey) {
      case 'a-z':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'z-a':
        result.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'newest':
        result.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        break
      case 'oldest':
        result.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        break
    }
    return result
  }, [allSublocations, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const sublocations = filtered.slice(
    (safePage - 1) * PER_PAGE,
    safePage * PER_PAGE,
  )

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }
  const handleSort = (v: string) => {
    setSortKey(v)
    setPage(1)
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const token = await getToken()
      await deleteSublocation(confirmDelete.id, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete sublocation.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !stateId) {
      setMsg({ text: 'Name and parent state are required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createSublocation(
        {
          name,
          description: description || undefined,
          state_id: Number(stateId),
        },
        token,
      )
      setMsg({ text: 'Sublocation created!', ok: true })
      setName('')
      setDescription('')
      setStateId('')
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to create sublocation.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="Sublocations"
          subtitle="Specific locations within a state"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Sublocation"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  label="Name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g. Miami Beach"
                />
                <Dropdown
                  label="Parent State"
                  options={states.map((s) => ({
                    value: s.state_id,
                    label: s.name,
                  }))}
                  selectedValue={stateId}
                  onSelect={(v) => setStateId(Number(v))}
                />
                <FormField
                  label="Description"
                  value={description}
                  onChange={setDescription}
                  placeholder="Optional"
                />
              </div>
              <FormFooter
                msg={msg}
                submitting={submitting}
                label="Add Sublocation"
              />
            </form>
          </CreatePanel>
        )}

        <DataList
          loading={loading}
          empty={allSublocations.length === 0}
          emptyIcon={Landmark}
          emptyText="No sublocations yet"
          toolbar={
            !loading && allSublocations.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="locations"
                sortOptions={ENTITY_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No locations matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {sublocations.map((s, i) => (
                <SublocationRow
                  key={s.sublocation_id}
                  sublocation={s}
                  index={i}
                  onEdit={() => setEditing(s)}
                  onDelete={() =>
                    setConfirmDelete({ id: s.sublocation_id, name: s.name })
                  }
                />
              ))}
              <PaginationBar
                page={safePage}
                perPage={PER_PAGE}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </DataList>
      </div>

      {confirmDelete && (
        <ConfirmDeleteDialog
          name={confirmDelete.name}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {editing && (
        <EditSublocationModal
          sublocation={editing}
          states={states}
          getToken={getToken}
          onSuccess={() => {
            setEditing(null)
            onSuccess()
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/* ════════════════════════════════════════════════
   Streams Panel
   ════════════════════════════════════════════════ */

function StreamsPanel({
  streams: allStreams,
  getToken,
  onSuccess,
  loading,
}: {
  streams: Array<StreamDetail>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [rtspUrl, setRtspUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)

  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: string
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [restarting, setRestarting] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // Search + sort
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('a-z')

  const filtered = useMemo(() => {
    let result = [...allStreams]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.streamId.toLowerCase().includes(q),
      )
    }
    switch (sortKey) {
      case 'a-z':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'z-a':
        result.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'running':
        result.sort((a, b) => {
          if (a.status === 'running' && b.status !== 'running') return -1
          if (a.status !== 'running' && b.status === 'running') return 1
          return a.name.localeCompare(b.name)
        })
        break
    }
    return result
  }, [allStreams, search, sortKey])

  const streams = filtered
  const total = filtered.length

  const handleSearch = (v: string) => {
    setSearch(v)
  }
  const handleSort = (v: string) => {
    setSortKey(v)
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const token = await getToken()
      await deleteStream(confirmDelete.id, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete stream.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleRestart = async (id: string) => {
    setRestarting(id)
    try {
      const token = await getToken()
      await restartStream(id, token)
      setMsg({ text: 'Stream restarting...', ok: true })
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to restart stream.', ok: false })
    } finally {
      setRestarting(null)
    }
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !rtspUrl) {
      setMsg({ text: 'Name and RTSP URL are required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createStream({ name, rtspUrl }, token)
      setMsg({ text: 'Stream created!', ok: true })
      setName('')
      setRtspUrl('')
      onSuccess()
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes('400')
          ? 'Invalid RTSP URL. Must start with rtsp:// or rtsps://'
          : 'Failed to create stream.'
      setMsg({ text: message, ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="Streams"
          subtitle="RTSP-to-HLS stream management via Restreamer"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Stream"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Stream Name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g. Pavilion Front Camera"
                />
                <FormField
                  label="RTSP URL"
                  value={rtspUrl}
                  onChange={setRtspUrl}
                  placeholder="rtsp://user:pass@ip:554/path"
                />
              </div>
              <p className="mb-0 text-xs text-subtext0">
                Creates an RTSP-to-HLS stream on Restreamer. Streams appear in
                the Restreamer UI for YouTube/Facebook egress setup.
              </p>
              <FormFooter
                msg={msg}
                submitting={submitting}
                label="Create Stream"
              />
            </form>
          </CreatePanel>
        )}

        <DataList
          loading={loading}
          empty={allStreams.length === 0}
          emptyIcon={Radio}
          emptyText="No streams yet"
          toolbar={
            !loading && allStreams.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="streams"
                sortOptions={STREAM_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No streams matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {streams.map((s, i) => (
                <StreamRow
                  key={s.streamId}
                  stream={s}
                  index={i}
                  restarting={restarting === s.streamId}
                  copied={copied === s.streamId}
                  onRestart={() => handleRestart(s.streamId)}
                  onCopy={() => handleCopy(s.hlsUrl, s.streamId)}
                  onDelete={() =>
                    setConfirmDelete({ id: s.streamId, name: s.name })
                  }
                />
              ))}
            </>
          )}
        </DataList>

        {/* Stream-level status banner (for restart/delete feedback) */}
        {msg && !showCreate && <StatusBanner msg={msg} />}
      </div>

      {confirmDelete && (
        <ConfirmDeleteDialog
          name={confirmDelete.name}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}

/* ════════════════════════════════════════════════
   Ads Panel
   ════════════════════════════════════════════════ */

// One flat form model for both the create form and the edit modal. Weight is
// kept as a string so the number input can be temporarily empty; scope is a
// single `scopeKind` choice, which is what structurally enforces the backend's
// "at most one of state/sublocation/video" rule — buildAdInput only fills the
// column matching the chosen kind.
type AdFormState = {
  name: string
  type: AdType
  videoUrl: string
  htmlCode: string
  clickUrl: string
  placement: AdPlacement
  weight: string
  startsAt: string
  endsAt: string
  enabled: boolean
  isOverride: boolean
  scopeKind: ScopeKind
  stateId: number | ''
  sublocationId: number | ''
  videoId: number | ''
}

// Default the scope to Sublocation — the common workflow (cameras inherit).
function emptyAdForm(): AdFormState {
  return {
    name: '',
    type: 'preroll_video',
    videoUrl: '',
    htmlCode: '',
    clickUrl: '',
    placement: 'left',
    weight: '1',
    startsAt: '',
    endsAt: '',
    enabled: true,
    isOverride: false,
    scopeKind: 'sublocation',
    stateId: '',
    sublocationId: '',
    videoId: '',
  }
}

function adToForm(
  ad: Ad,
  sublocations: Array<Sublocation>,
  videos: Array<Video>,
): AdFormState {
  let scopeKind: ScopeKind = 'house'
  let stateId: number | '' = ''
  let sublocationId: number | '' = ''
  let videoId: number | '' = ''
  if (ad.video_id) {
    scopeKind = 'camera'
    videoId = ad.video_id
    // Back-fill the state filter so the camera dropdown is populated on open.
    stateId = videos.find((v) => v.video_id === ad.video_id)?.state_id ?? ''
  } else if (ad.sublocation_id) {
    scopeKind = 'sublocation'
    sublocationId = ad.sublocation_id
    stateId =
      sublocations.find((s) => s.sublocation_id === ad.sublocation_id)
        ?.state_id ?? ''
  } else if (ad.state_id) {
    scopeKind = 'state'
    stateId = ad.state_id
  }
  return {
    name: ad.name,
    type: ad.type,
    videoUrl: ad.video_url,
    htmlCode: ad.html_code,
    clickUrl: ad.click_url,
    placement: ad.placement || 'left',
    weight: String(ad.weight),
    startsAt: toLocalInput(ad.starts_at),
    endsAt: toLocalInput(ad.ends_at),
    enabled: ad.enabled,
    isOverride: ad.is_override,
    scopeKind,
    stateId,
    sublocationId,
    videoId,
  }
}

function validateAd(form: AdFormState): string | null {
  if (!form.name.trim()) return 'Name is required.'
  if (form.type === 'preroll_video' && !form.videoUrl.trim())
    return 'Video URL is required for a pre-roll ad.'
  if (form.type === 'banner_html' && !form.htmlCode.trim())
    return 'Banner HTML is required.'
  if (form.scopeKind === 'state' && form.stateId === '')
    return 'Select a state.'
  if (form.scopeKind === 'sublocation' && form.sublocationId === '')
    return 'Select a sublocation.'
  if (form.scopeKind === 'camera' && form.videoId === '')
    return 'Select a camera.'
  return null
}

function buildAdInput(form: AdFormState): AdInput {
  return {
    name: form.name.trim(),
    type: form.type,
    video_url: form.type === 'preroll_video' ? form.videoUrl.trim() : '',
    html_code: form.type === 'banner_html' ? form.htmlCode : '',
    click_url: form.clickUrl.trim(),
    placement: form.type === 'banner_html' ? form.placement : '',
    weight: Math.max(1, parseInt(form.weight, 10) || 1),
    starts_at: toISO(form.startsAt),
    ends_at: toISO(form.endsAt),
    enabled: form.enabled,
    is_override: form.isOverride,
    state_id: form.scopeKind === 'state' ? Number(form.stateId) : null,
    sublocation_id:
      form.scopeKind === 'sublocation' ? Number(form.sublocationId) : null,
    video_id: form.scopeKind === 'camera' ? Number(form.videoId) : null,
  }
}

function AdsPanel({
  ads: allAds,
  states,
  sublocations,
  videos,
  getToken,
  onSuccess,
  loading,
}: {
  ads: Array<Ad>
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<AdFormState>(emptyAdForm)
  const update = (patch: Partial<AdFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<Ad | null>(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('a-z')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = [...allAds]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.state_name && a.state_name.toLowerCase().includes(q)) ||
          (a.sublocation_name &&
            a.sublocation_name.toLowerCase().includes(q)) ||
          (a.video_title && a.video_title.toLowerCase().includes(q)),
      )
    }
    switch (sortKey) {
      case 'a-z':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'z-a':
        result.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'newest':
        result.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        break
      case 'oldest':
        result.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        break
    }
    return result
  }, [allAds, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const ads = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }
  const handleSort = (v: string) => {
    setSortKey(v)
    setPage(1)
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const token = await getToken()
      await deleteAd(confirmDelete.id, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete ad.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateAd(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createAd(buildAdInput(form), token)
      setMsg({ text: 'Ad created successfully!', ok: true })
      setForm(emptyAdForm())
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to create ad.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="Ads"
          subtitle="Pre-roll videos and banner ads, targeted by scope"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Ad"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AdFields
                form={form}
                update={update}
                states={states}
                sublocations={sublocations}
                videos={videos}
              />
              <FormFooter msg={msg} submitting={submitting} label="Add Ad" />
            </form>
          </CreatePanel>
        )}

        <DataList
          loading={loading}
          empty={allAds.length === 0}
          emptyIcon={Megaphone}
          emptyText="No ads yet"
          toolbar={
            !loading && allAds.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="ads"
                sortOptions={ENTITY_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No ads matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {ads.map((a, i) => (
                <AdRow
                  key={a.ad_id}
                  ad={a}
                  index={i}
                  onEdit={() => setEditing(a)}
                  onDelete={() =>
                    setConfirmDelete({ id: a.ad_id, name: a.name })
                  }
                />
              ))}
              <PaginationBar
                page={safePage}
                perPage={PER_PAGE}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </DataList>
      </div>

      {confirmDelete && (
        <ConfirmDeleteDialog
          name={confirmDelete.name}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {editing && (
        <EditAdModal
          ad={editing}
          states={states}
          sublocations={sublocations}
          videos={videos}
          getToken={getToken}
          onSuccess={() => {
            setEditing(null)
            onSuccess()
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/* ──── Ad Form Fields (shared by create + edit) ──── */

function AdFields({
  form,
  update,
  states,
  sublocations,
  videos,
}: {
  form: AdFormState
  update: (patch: Partial<AdFormState>) => void
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
}) {
  const filteredSubs = sublocations.filter((s) => s.state_id === form.stateId)
  const filteredVideos = videos.filter((v) => v.state_id === form.stateId)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          value={form.name}
          onChange={(v) => update({ name: v })}
          placeholder="e.g. Summer promo"
        />
        <Dropdown
          label="Ad Type"
          options={AD_TYPE_OPTIONS}
          selectedValue={form.type}
          onSelect={(v) => update({ type: v as AdType })}
        />
      </div>

      {/* Type-specific fields */}
      {form.type === 'preroll_video' ? (
        <FormField
          label="Video URL (MP4)"
          value={form.videoUrl}
          onChange={(v) => update({ videoUrl: v })}
          placeholder="https://cdn.example.com/ad.mp4"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-subtext0">
              Banner HTML / AdSense code
            </label>
            <textarea
              value={form.htmlCode}
              onChange={(e) => update({ htmlCode: e.target.value })}
              rows={5}
              spellCheck={false}
              placeholder="<script async src=...></script>"
              className="w-full rounded-lg border border-overlay0 bg-base px-3.5 py-2.5 font-mono text-xs text-text transition-[border-color,box-shadow] duration-200 placeholder:text-overlay1 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
            />
          </div>
          <Dropdown
            label="Placement"
            options={PLACEMENT_OPTIONS}
            selectedValue={form.placement}
            onSelect={(v) => update({ placement: v as AdPlacement })}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Click-through URL"
          value={form.clickUrl}
          onChange={(v) => update({ clickUrl: v })}
          placeholder="https://advertiser.example.com"
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-subtext0">
            Weight
          </label>
          <input
            type="number"
            min={1}
            value={form.weight}
            onChange={(e) => update({ weight: e.target.value })}
            className="w-full rounded-lg border border-overlay0 bg-base px-3.5 py-2.5 font-sans text-sm text-text transition-[border-color,box-shadow] duration-200 placeholder:text-overlay1 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
          />
        </div>
      </div>

      {/* Scope picker — at most one of state/sublocation/camera, or House */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Dropdown
          label="Scope"
          options={SCOPE_OPTIONS}
          selectedValue={form.scopeKind}
          onSelect={(v) =>
            update({
              scopeKind: v as ScopeKind,
              stateId: '',
              sublocationId: '',
              videoId: '',
            })
          }
        />
        {form.scopeKind !== 'house' && (
          <Dropdown
            label={form.scopeKind === 'state' ? 'State' : 'State (filter)'}
            options={states.map((s) => ({ value: s.state_id, label: s.name }))}
            selectedValue={form.stateId}
            onSelect={(v) =>
              update({ stateId: Number(v), sublocationId: '', videoId: '' })
            }
          />
        )}
        {form.scopeKind === 'sublocation' && form.stateId !== '' && (
          <Dropdown
            label="Sublocation"
            options={filteredSubs.map((s) => ({
              value: s.sublocation_id,
              label: s.name,
            }))}
            selectedValue={form.sublocationId}
            onSelect={(v) => update({ sublocationId: Number(v) })}
          />
        )}
        {form.scopeKind === 'camera' && form.stateId !== '' && (
          <Dropdown
            label="Camera"
            options={filteredVideos.map((v) => ({
              value: v.video_id,
              label: v.title,
            }))}
            selectedValue={form.videoId}
            onSelect={(v) => update({ videoId: Number(v) })}
          />
        )}
      </div>
      {form.scopeKind === 'house' && (
        <p className="mb-0 -mt-2 text-xs text-subtext0">
          House ad — eligible everywhere, beaten by any more specific ad.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-subtext0">
            Starts at (optional)
          </label>
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => update({ startsAt: e.target.value })}
            className="w-full rounded-lg border border-overlay0 bg-base px-3.5 py-2.5 font-sans text-sm text-text transition-[border-color,box-shadow] duration-200 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-subtext0">
            Ends at (optional)
          </label>
          <input
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => update({ endsAt: e.target.value })}
            className="w-full rounded-lg border border-overlay0 bg-base px-3.5 py-2.5 font-sans text-sm text-text transition-[border-color,box-shadow] duration-200 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ToggleRow
          label="Enabled"
          description="Serve this ad"
          checked={form.enabled}
          onChange={(v) => update({ enabled: v })}
        />
        <ToggleRow
          label="Global override"
          description="Beats all targeting for this ad type"
          checked={form.isOverride}
          onChange={(v) => update({ isOverride: v })}
          warning
        />
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  warning = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  warning?: boolean
}) {
  const on = warning ? 'border-live/50 bg-live/10' : 'border-accent/40 bg-accent/8'
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors duration-150 ${
        checked ? on : 'border-overlay0 bg-base'
      }`}
    >
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-text">
          {warning && <ShieldAlert size={14} className="text-live" />}
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-subtext0">{description}</span>
      </div>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${
          checked ? (warning ? 'bg-live' : 'bg-accent') : 'bg-surface2'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

/* ──── Ad Row ──── */

function adScopeLabel(ad: Ad): { label: string; icon: typeof Film } {
  if (ad.video_id)
    return { label: ad.video_title || `Camera #${ad.video_id}`, icon: Film }
  if (ad.sublocation_id)
    return {
      label: ad.sublocation_name || `Sublocation #${ad.sublocation_id}`,
      icon: Landmark,
    }
  if (ad.state_id)
    return { label: ad.state_name || `State #${ad.state_id}`, icon: MapPin }
  return { label: 'House', icon: Globe }
}

function adWindowLabel(ad: Ad): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  if (ad.starts_at && ad.ends_at) return `${fmt(ad.starts_at)} – ${fmt(ad.ends_at)}`
  if (ad.starts_at) return `from ${fmt(ad.starts_at)}`
  if (ad.ends_at) return `until ${fmt(ad.ends_at)}`
  return 'Always'
}

function AdRow({
  ad,
  index,
  onEdit,
  onDelete,
}: {
  ad: Ad
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  const isBanner = ad.type === 'banner_html'
  const scope = adScopeLabel(ad)
  const ScopeIcon = scope.icon

  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/50 sm:px-5"
      style={staggerStyle(index)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
        {isBanner ? (
          <Code size={18} className="text-accent" />
        ) : (
          <VideoIcon size={18} className="text-accent" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-base">
          {ad.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
            {isBanner ? 'Banner' : 'Pre-roll'}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-px font-mono text-[11px] text-accent">
            <ScopeIcon size={11} />
            {scope.label}
          </span>
          {isBanner && ad.placement && (
            <span className="inline-flex shrink-0 items-center rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
              {ad.placement}
            </span>
          )}
          <span className="text-xs text-subtext0">{adWindowLabel(ad)}</span>
          <span className="font-mono text-[11px] text-overlay2">
            w:{ad.weight} &middot; {ad.impressions} imp &middot; {ad.clicks} clk
          </span>
        </div>
        {isBanner && ad.html_code && (
          // Rendered as escaped text (React auto-escapes), never as live markup.
          <code className="mt-1 block truncate font-mono text-[11px] text-overlay2">
            {ad.html_code}
          </code>
        )}
      </div>

      {ad.is_override && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-live/10 px-2 py-1 text-xs font-medium text-live">
          <ShieldAlert size={12} />
          <span className="hidden sm:inline">Override</span>
        </span>
      )}

      <StatusDot active={ad.enabled} label={ad.enabled ? 'On' : 'Off'} />

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <ActionBtn icon={Pencil} onClick={onEdit} label="Edit" />
        <ActionBtn
          icon={Trash2}
          onClick={onDelete}
          label="Delete"
          variant="danger"
        />
      </div>
    </div>
  )
}

/* ──── Edit Ad Modal ──── */

function EditAdModal({
  ad,
  states,
  sublocations,
  videos,
  getToken,
  onSuccess,
  onClose,
}: {
  ad: Ad
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<AdFormState>(() =>
    adToForm(ad, sublocations, videos),
  )
  const update = (patch: Partial<AdFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateAd(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateAd(ad.ad_id, buildAdInput(form), token)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update ad.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit Ad" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <AdFields
          form={form}
          update={update}
          states={states}
          sublocations={sublocations}
          videos={videos}
        />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}

/* ────  datetime helpers (datetime-local <-> RFC3339)  ──── */

// datetime-local gives 'YYYY-MM-DDTHH:mm' in local time; the API wants RFC3339.
function toISO(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ════════════════════════════════════════════════
   Shared — Panel Header
   ════════════════════════════════════════════════ */

function PanelHeader({
  title,
  subtitle,
  showCreate,
  onToggleCreate,
  createLabel,
}: {
  title: string
  subtitle: string
  showCreate: boolean
  onToggleCreate: () => void
  createLabel: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="!mb-0 !text-lg font-display font-bold sm:!text-xl">
          {title}
        </h3>
        <p className="mb-0 text-xs text-subtext0 sm:text-sm">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onToggleCreate}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 ease-[var(--spring-snappy)] ${
          showCreate
            ? 'border border-overlay0 bg-surface1 text-subtext0 hover:text-text'
            : 'bg-accent/10 text-accent hover:bg-accent/20'
        }`}
      >
        {showCreate ? (
          <>
            <X size={15} />
            <span className="hidden sm:inline">Cancel</span>
          </>
        ) : (
          <>
            <Plus size={15} />
            <span className="hidden sm:inline">{createLabel}</span>
          </>
        )}
      </button>
    </div>
  )
}

/* ════════════════════════════════════════════════
   Shared — Create Panel (collapsible wrapper)
   ════════════════════════════════════════════════ */

function CreatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-overlay0/60 bg-surface0"
      style={{
        opacity: 0,
        animation: 'scale-fade-in 280ms var(--spring-poppy) forwards',
      }}
    >
      <div className="h-px bg-gradient-to-r from-accent/40 via-accent/15 to-transparent" />
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  )
}

/* ════════════════════════════════════════════════
   Shared — Form Components
   ════════════════════════════════════════════════ */

type FormMsg = { text: string; ok: boolean } | null

function useAutoHide(msg: FormMsg, setMsg: (m: FormMsg) => void) {
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 5000)
    return () => clearTimeout(t)
  }, [msg, setMsg])
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-subtext0">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-overlay0 bg-base px-3.5 py-2.5 font-sans text-sm text-text transition-[border-color,box-shadow] duration-200 placeholder:text-overlay1 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
      />
    </div>
  )
}

function FormFooter({
  msg,
  submitting,
  label,
}: {
  msg: FormMsg
  submitting: boolean
  label: string
}) {
  return (
    <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1">{msg && <StatusBanner msg={msg} />}</div>
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-crust shadow-sm transition-all duration-200 ease-[var(--spring-snappy)] hover:bg-accent-hover hover:shadow-md active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
      >
        {submitting && <Loader2 size={15} className="animate-spin" />}
        {submitting ? 'Saving...' : label}
      </button>
    </div>
  )
}

function StatusBanner({ msg }: { msg: FormMsg }) {
  if (!msg) return null
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
        msg.ok ? 'bg-teal/10 text-teal' : 'bg-live/10 text-live'
      }`}
      style={{
        opacity: 0,
        animation: 'scale-fade-in 250ms var(--spring-poppy) forwards',
      }}
    >
      {msg.ok ? <Check size={15} /> : <AlertCircle size={15} />}
      {msg.text}
    </div>
  )
}

/* ════════════════════════════════════════════════
   Shared — Data List
   ════════════════════════════════════════════════ */

function DataList({
  loading,
  empty,
  emptyIcon: EmptyIcon,
  emptyText,
  toolbar,
  children,
}: {
  loading: boolean
  empty: boolean
  emptyIcon: typeof Film
  emptyText: string
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-overlay0/60 bg-surface0">
      {toolbar}
      {loading ? (
        <ListSkeleton />
      ) : empty ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface1">
            <EmptyIcon size={22} className="text-subtext0" />
          </div>
          <p className="mb-0 max-w-[220px] text-sm text-subtext0">
            {emptyText}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-overlay0">{children}</div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════
   Shared — List Toolbar (search + sort)
   ════════════════════════════════════════════════ */

function ListToolbar({
  search,
  onSearchChange,
  sortKey,
  onSortChange,
  resultCount,
  label,
  sortOptions,
}: {
  search: string
  onSearchChange: (v: string) => void
  sortKey: string
  onSortChange: (v: string) => void
  resultCount: number
  label: string
  sortOptions: Array<{ value: string; label: string; icon: typeof ArrowDownAZ }>
}) {
  return (
    <div className="flex items-center gap-2 border-b border-overlay0/30 px-4 py-2.5 sm:px-5">
      {/* Search */}
      <div className="relative min-w-0 flex-1">
        <Search
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-overlay2"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={`Search ${label}...`}
          className="w-full rounded-lg border border-overlay0/50 bg-base py-1.5 pr-7 pl-8 text-xs text-text placeholder:text-overlay1 transition-colors duration-150 focus:border-accent focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-overlay2 hover:text-text"
            aria-label="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-0.5 rounded-lg border border-overlay0/50 bg-base p-0.5">
        {sortOptions.map((opt) => {
          const Icon = opt.icon
          const isActive = sortKey === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSortChange(opt.value)}
              className={`flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] transition-colors duration-150 ${
                isActive
                  ? 'bg-accent/12 text-accent'
                  : 'text-overlay2 hover:text-text'
              }`}
              title={`Sort: ${opt.label}`}
            >
              <Icon size={11} />
              <span className="hidden lg:inline">{opt.label}</span>
            </button>
          )
        })}
      </div>

      {/* Count */}
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-overlay2">
        {resultCount}
      </span>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-overlay0/40">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-surface1" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-surface1" />
            <div className="h-3 w-24 animate-pulse rounded bg-surface1" />
          </div>
          <div className="h-6 w-16 animate-pulse rounded-md bg-surface1" />
        </div>
      ))}
    </div>
  )
}

function PaginationBar({
  page,
  perPage,
  total,
  onPageChange,
}: {
  page: number
  perPage: number
  total: number
  onPageChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / perPage)
  if (totalPages <= 1) return null

  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, total)

  return (
    <div className="flex items-center justify-between border-t border-overlay0/30 px-4 py-2.5 sm:px-5">
      <p className="mb-0 font-mono text-xs text-subtext0">
        {from}&ndash;{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtext0 transition-colors duration-150 hover:bg-surface1 disabled:pointer-events-none disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="min-w-[3rem] px-1 text-center font-mono text-xs text-subtext0">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtext0 transition-colors duration-150 hover:bg-surface1 disabled:pointer-events-none disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════
   Row Components
   ════════════════════════════════════════════════ */

function VideoRow({
  video,
  index,
  onEdit,
  onDelete,
}: {
  video: Video
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  const typeLabel = VIDEO_TYPE_LABELS[video.type] ?? video.type
  const isActive = video.status === 'active'

  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/50 sm:px-5"
      style={staggerStyle(index)}
    >
      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
        <Film size={18} className="text-accent" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-base">
          {video.title}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-xs text-subtext0">
            {video.state_name}
            {video.sublocation_name ? ` \u00B7 ${video.sublocation_name}` : ''}
          </span>
          <span className="shrink-0 rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
            {typeLabel}
          </span>
        </div>
      </div>

      {/* Status */}
      <StatusDot active={isActive} label={isActive ? 'Live' : 'Off'} />

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <ActionBtn icon={Pencil} onClick={onEdit} label="Edit" />
        <ActionBtn
          icon={Trash2}
          onClick={onDelete}
          label="Delete"
          variant="danger"
        />
      </div>
    </div>
  )
}

function StateRow({
  state,
  index,
  onEdit,
  onDelete,
}: {
  state: State
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/50 sm:px-5"
      style={staggerStyle(index)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
        <MapPin size={18} className="text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-base">
          {state.name}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-subtext0">
            {timeAgo(state.created_at)}
          </span>
          <span className="shrink-0 rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
            {state.video_count} cam{state.video_count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <ActionBtn icon={Pencil} onClick={onEdit} label="Edit" />
        <ActionBtn
          icon={Trash2}
          onClick={onDelete}
          label="Delete"
          variant="danger"
        />
      </div>
    </div>
  )
}

function SublocationRow({
  sublocation,
  index,
  onEdit,
  onDelete,
}: {
  sublocation: Sublocation
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/50 sm:px-5"
      style={staggerStyle(index)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
        <Landmark size={18} className="text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-base">
          {sublocation.name}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-xs text-subtext0">
            {sublocation.state_name}
          </span>
          <span className="shrink-0 rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
            {sublocation.video_count} cam
            {sublocation.video_count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <ActionBtn icon={Pencil} onClick={onEdit} label="Edit" />
        <ActionBtn
          icon={Trash2}
          onClick={onDelete}
          label="Delete"
          variant="danger"
        />
      </div>
    </div>
  )
}

function StreamRow({
  stream,
  index,
  restarting,
  copied,
  onRestart,
  onCopy,
  onDelete,
}: {
  stream: StreamDetail
  index: number
  restarting: boolean
  copied: boolean
  onRestart: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const isRunning = stream.status === 'running'
  const isFailed = stream.status === 'failed'
  const dotColor = isRunning ? 'bg-teal' : isFailed ? 'bg-live' : 'bg-overlay2'
  const runtime = formatRuntime(stream.runtimeSeconds)

  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/50 sm:px-5"
      style={staggerStyle(index)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
        <Radio size={18} className="text-accent" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-base">
          {stream.name}
        </p>
        <p className="mb-0 mt-0.5 truncate font-mono text-xs text-subtext0">
          {runtime}
          {stream.fps ? ` \u00B7 ${stream.fps.toFixed(1)} fps` : ''}
          {stream.bitrateKbit
            ? ` \u00B7 ${(stream.bitrateKbit / 1000).toFixed(1)} Mbps`
            : ''}
        </p>
      </div>

      {/* Status */}
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
          isRunning
            ? 'bg-teal/10 text-teal'
            : isFailed
              ? 'bg-live/10 text-live'
              : 'bg-surface1 text-subtext0'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${dotColor}`}
          style={
            isRunning
              ? { animation: 'pulse-live 2s ease-in-out infinite' }
              : undefined
          }
        />
        {stream.status}
      </span>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <button
          type="button"
          onClick={onCopy}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-subtext0 transition-colors duration-150 hover:bg-accent/10 hover:text-accent"
          title={copied ? 'Copied!' : 'Copy HLS URL'}
        >
          {copied ? (
            <Check size={15} className="text-teal" />
          ) : (
            <Copy size={15} />
          )}
        </button>
        <button
          type="button"
          onClick={onRestart}
          disabled={restarting}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-subtext0 transition-colors duration-150 hover:bg-accent/10 hover:text-accent disabled:pointer-events-none disabled:opacity-40"
          title="Restart stream"
        >
          <RefreshCw size={15} className={restarting ? 'animate-spin' : ''} />
        </button>
        <ActionBtn
          icon={Trash2}
          onClick={onDelete}
          label="Delete"
          variant="danger"
        />
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════
   Shared — Small Components
   ════════════════════════════════════════════════ */

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
        active ? 'bg-teal/10 text-teal' : 'bg-surface1 text-subtext0'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${active ? 'bg-teal' : 'bg-overlay2'}`}
        style={
          active
            ? { animation: 'pulse-live 2s ease-in-out infinite' }
            : undefined
        }
      />
      {label}
    </span>
  )
}

function ActionBtn({
  icon: Icon,
  onClick,
  label,
  variant = 'default',
}: {
  icon: typeof Pencil
  onClick: () => void
  label: string
  variant?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-subtext0 transition-colors duration-150 ${
        variant === 'danger'
          ? 'hover:bg-live/10 hover:text-live'
          : 'hover:bg-accent/10 hover:text-accent'
      }`}
      title={label}
      aria-label={label}
    >
      <Icon size={15} />
    </button>
  )
}

/* ════════════════════════════════════════════════
   Dialogs & Modals
   ════════════════════════════════════════════════ */

function ConfirmDeleteDialog({
  name,
  deleting,
  onConfirm,
  onCancel,
}: {
  name: string
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="mx-4 w-full max-w-sm overflow-hidden rounded-2xl border border-overlay0 bg-surface0 shadow-2xl"
        style={{
          opacity: 0,
          animation: 'scale-fade-in 250ms var(--spring-poppy) forwards',
        }}
      >
        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-live/10">
              <Trash2 size={18} className="text-live" />
            </div>
            <div>
              <h5 className="mb-0 !text-base font-semibold text-text">
                Confirm Delete
              </h5>
              <p className="mb-0 text-xs text-subtext0">
                This cannot be undone.
              </p>
            </div>
          </div>
          <p className="mb-5 text-sm text-subtext1">
            Delete <span className="font-semibold text-text">{name}</span>?
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="flex-1 rounded-lg border border-overlay0 bg-surface1 px-4 py-2.5 text-sm font-medium text-text transition-colors duration-150 hover:bg-surface2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deleting}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-live px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 hover:bg-live/90 active:scale-[0.97] disabled:opacity-60"
            >
              {deleting && <Loader2 size={14} className="animate-spin" />}
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        className={`w-full overflow-hidden rounded-2xl border border-overlay0 bg-surface0 shadow-2xl ${
          wide ? 'max-w-2xl' : 'max-w-md'
        }`}
        style={{
          opacity: 0,
          animation: 'scale-fade-in 250ms var(--spring-poppy) forwards',
        }}
      >
        <div className="flex items-center justify-between border-b border-overlay0/50 px-5 py-4">
          <h5 className="mb-0 !text-base font-display font-semibold text-text">
            {title}
          </h5>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtext0 transition-colors duration-150 hover:bg-surface1 hover:text-text"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

/* ──── Edit State Modal ──── */

function EditStateModal({
  state,
  getToken,
  onSuccess,
  onClose,
}: {
  state: State
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(state.name)
  const [description, setDescription] = useState(state.description)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) {
      setMsg({ text: 'Name is required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateState(state.state_id, { name, description }, token)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update state.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit State" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="State Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Florida"
        />
        <FormField
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Optional"
        />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}

/* ──── Edit Sublocation Modal ──── */

function EditSublocationModal({
  sublocation,
  states,
  getToken,
  onSuccess,
  onClose,
}: {
  sublocation: Sublocation
  states: Array<State>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(sublocation.name)
  const [description, setDescription] = useState(sublocation.description)
  const [stateId, setStateId] = useState<number>(sublocation.state_id)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !stateId) {
      setMsg({ text: 'Name and state are required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateSublocation(
        sublocation.sublocation_id,
        { name, description, state_id: stateId },
        token,
      )
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update sublocation.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit Sublocation" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Miami Beach"
        />
        <Dropdown
          label="Parent State"
          options={states.map((s) => ({ value: s.state_id, label: s.name }))}
          selectedValue={stateId}
          onSelect={(v) => setStateId(Number(v))}
        />
        <FormField
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Optional"
        />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}

/* ──── Edit Video Modal ──── */

function EditVideoModal({
  video,
  states,
  sublocations,
  getToken,
  onSuccess,
  onClose,
}: {
  video: Video
  states: Array<State>
  sublocations: Array<Sublocation>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(video.title)
  const [src, setSrc] = useState(video.src)
  const [type, setType] = useState(video.type)
  const [stateId, setStateId] = useState<number>(video.state_id)
  const [sublocationId, setSublocationId] = useState<number | ''>(
    video.sublocation_id ?? '',
  )
  const [status, setStatus] = useState(video.status)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const filteredSubs = sublocations.filter((s) => s.state_id === stateId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !src || !type || !stateId) {
      setMsg({ text: 'Please fill in all required fields.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateVideo(
        video.video_id,
        {
          title,
          src,
          type,
          state_id: stateId,
          sublocation_id: sublocationId ? Number(sublocationId) : null,
          status,
        },
        token,
      )
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update camera.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit Camera" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="Camera title"
        />
        <FormField
          label="Source URL"
          value={src}
          onChange={setSrc}
          placeholder="Stream URL"
        />
        <Dropdown
          label="Video Type"
          options={VIDEO_TYPE_OPTIONS}
          selectedValue={type}
          onSelect={(v) => setType(String(v))}
        />
        <Dropdown
          label="State"
          options={states.map((s) => ({ value: s.state_id, label: s.name }))}
          selectedValue={stateId}
          onSelect={(v) => {
            setStateId(Number(v))
            setSublocationId('')
          }}
        />
        {filteredSubs.length > 0 && (
          <Dropdown
            label="Sublocation"
            options={filteredSubs.map((s) => ({
              value: s.sublocation_id,
              label: s.name,
            }))}
            selectedValue={sublocationId}
            onSelect={(v) => setSublocationId(Number(v))}
          />
        )}
        <Dropdown
          label="Status"
          options={STATUS_OPTIONS}
          selectedValue={status}
          onSelect={(v) => setStatus(String(v) as Video['status'])}
        />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}

/* ════════════════════════════════════════════════
   Utilities
   ════════════════════════════════════════════════ */

function staggerStyle(index: number): React.CSSProperties | undefined {
  if (index >= 10) return undefined
  return {
    opacity: 0,
    animation: `fade-in-up 350ms var(--spring-smooth) ${index * 40}ms forwards`,
  }
}

function formatRuntime(seconds: number): string {
  if (seconds <= 0) return 'not started'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m uptime`
  if (m > 0) return `${m}m uptime`
  return `${seconds}s uptime`
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
