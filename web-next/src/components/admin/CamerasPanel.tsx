import { useMemo, useState } from 'react'
import { Check, Code, Copy, Film, Pencil, Trash2 } from 'lucide-react'
import type { State, Sublocation, Video } from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import {
  AboutField,
  ActionBtn,
  ConfirmDeleteDialog,
  CreatePanel,
  DataList,
  ENTITY_SORT_OPTIONS,
  FormField,
  FormFooter,
  ListToolbar,
  ModalShell,
  PER_PAGE,
  PaginationBar,
  PanelHeader,
  SelectField,
  StatusDot,
  staggerStyle,
  useAutoHide,
} from '@/components/dashboardUi'
import { createVideo, deleteVideo, updateVideo } from '@/lib/api'
import { SITE_URL, streamPoster } from '@/lib/seo'
import EmbedSnippet from '@/components/EmbedSnippet'

/* ════════════════════════════════════════════════
   Cameras Panel — moved from routes/dashboard.tsx
   during the DAN-41 admin/owner console split.
   ════════════════════════════════════════════════ */

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

export default function CamerasPanel({
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
  const [about, setAbout] = useState('')
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
          about,
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
      setAbout('')
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
                <SelectField
                  label="Video Type"
                  options={VIDEO_TYPE_OPTIONS}
                  selectedValue={type}
                  onSelect={(v) => setType(String(v))}
                />
                <SelectField
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
                  <SelectField
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
                <SelectField
                  label="Status"
                  options={STATUS_OPTIONS}
                  selectedValue={status}
                  onSelect={(v) => setStatus(String(v))}
                />
              </div>
              <AboutField value={about} onChange={setAbout} />
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
                  states={states}
                  sublocations={sublocations}
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

/* ──── Camera Row ──── */

function VideoRow({
  video,
  index,
  states,
  sublocations,
  onEdit,
  onDelete,
}: {
  video: Video
  index: number
  states: Array<State>
  sublocations: Array<Sublocation>
  onEdit: () => void
  onDelete: () => void
}) {
  const typeLabel = VIDEO_TYPE_LABELS[video.type] ?? video.type
  const isActive = video.status === 'active'
  const [showEmbed, setShowEmbed] = useState(false)

  const stateSlug = states.find((s) => s.state_id === video.state_id)?.slug
  const subSlug = sublocations.find(
    (s) => s.sublocation_id === video.sublocation_id,
  )?.slug
  const canEmbed = Boolean(stateSlug && subSlug)

  return (
    <div style={staggerStyle(index)}>
      <div className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:px-5">
        {/* Icon */}
        <Film size={18} className="text-accent" />

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
            {video.title}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="truncate text-xs text-subtext0">
              {video.state_name}
              {video.sublocation_name ? ` · ${video.sublocation_name}` : ''}
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
          {canEmbed && (
            <ActionBtn
              icon={Code}
              onClick={() => setShowEmbed((v) => !v)}
              label="Embed code"
            />
          )}
          <ActionBtn icon={Pencil} onClick={onEdit} label="Edit" />
          <ActionBtn
            icon={Trash2}
            onClick={onDelete}
            label="Delete"
            variant="danger"
          />
        </div>
      </div>
      {showEmbed && stateSlug && subSlug && (
        <div className="px-4 pb-4 sm:px-5">
          <EmbedSnippet
            stateSlug={stateSlug}
            sublocationSlug={subSlug}
            cameraSlug={video.slug}
            title={video.title}
          />
        </div>
      )}
    </div>
  )
}

/* ──── Edit Camera Modal ──── */

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
  const [about, setAbout] = useState(video.about)
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
          about,
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
      <DirectoryLinks
        video={video}
        states={states}
        sublocations={sublocations}
      />
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
        <SelectField
          label="Video Type"
          options={VIDEO_TYPE_OPTIONS}
          selectedValue={type}
          onSelect={(v) => setType(String(v))}
        />
        <SelectField
          label="State"
          options={states.map((s) => ({ value: s.state_id, label: s.name }))}
          selectedValue={stateId}
          onSelect={(v) => {
            setStateId(Number(v))
            setSublocationId('')
          }}
        />
        {filteredSubs.length > 0 && (
          <SelectField
            label="Sublocation"
            options={filteredSubs.map((s) => ({
              value: s.sublocation_id,
              label: s.name,
            }))}
            selectedValue={sublocationId}
            onSelect={(v) => setSublocationId(Number(v))}
          />
        )}
        <SelectField
          label="Status"
          options={STATUS_OPTIONS}
          selectedValue={status}
          onSelect={(v) => setStatus(String(v) as Video['status'])}
        />
        <AboutField value={about} onChange={setAbout} />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}

/**
 * The saved camera's public URLs, as webcam directories (Windy, Ventusky) ask
 * for them, with a preview of the watermarked still they will poll. Hidden for
 * cameras those endpoints can't serve: inactive, no sublocation, or not a
 * Restreamer stream.
 */
function DirectoryLinks({
  video,
  states,
  sublocations,
}: {
  video: Video
  states: Array<State>
  sublocations: Array<Sublocation>
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const stateSlug = states.find((s) => s.state_id === video.state_id)?.slug
  const subSlug = sublocations.find(
    (s) => s.sublocation_id === video.sublocation_id,
  )?.slug
  if (
    !stateSlug ||
    !subSlug ||
    !streamPoster(video.src, video.status === 'active')
  )
    return null

  const path = `${stateSlug}/${subSlug}/${video.slug}`
  const snapshot = `/api/videos/${path}/snapshot.jpg`
  const links = [
    { label: 'Website', url: `${SITE_URL}/locations/${path}` },
    { label: 'Image', url: `${SITE_URL}${snapshot}` },
    { label: 'Video', url: `${SITE_URL}/api/videos/${path}/stream.m3u8` },
  ]

  const copy = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="mb-5 rounded-xl border border-border bg-base p-3.5">
      <p className="mb-2.5 text-xs font-medium text-subtext0">
        Webcam directory links (Windy, Ventusky)
      </p>
      <img
        src={snapshot}
        alt={`${video.title} snapshot`}
        className="mb-3 aspect-video w-full rounded-lg bg-crust object-cover"
      />
      <div className="space-y-1.5">
        {links.map(({ label, url }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-subtext0">{label}</span>
            <code className="min-w-0 flex-1 font-mono text-xs break-all text-text">
              {url}
            </code>
            <button
              type="button"
              onClick={() => copy(url)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-subtext0 transition-colors duration-150 hover:bg-accent/10 hover:text-accent"
              title={copied === url ? 'Copied!' : `Copy ${label} URL`}
              aria-label={`Copy ${label} URL`}
            >
              {copied === url ? (
                <Check size={14} className="text-teal" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
