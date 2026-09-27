import { useEffect, useMemo, useState } from 'react'
import {
  Film,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  Trash2,
} from 'lucide-react'
import type { OwnerSublocation, OwnerVideo } from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import Dropdown from '@/components/Dropdown'
import {
  AboutField,
  ActionBtn,
  ConfirmDeleteDialog,
  CreatePanel,
  DataList,
  FormField,
  FormFooter,
  ModalShell,
  PanelHeader,
  staggerStyle,
  useAutoHide,
} from '@/components/dashboardUi'
import { ReviewNote, StatusPill } from '@/components/owner/ownerUi'
import {
  createMyVideo,
  deleteMyVideo,
  fetchMySublocations,
  fetchMyVideos,
  pauseMyVideo,
  resumeMyVideo,
  updateMyVideo,
} from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import EmbedSnippet from '@/components/EmbedSnippet'

/* ════════════════════════════════════════════════
   My Cameras Panel (DAN-41) — the owner's own
   cameras, any status. Add form: title, RTSP URL, a
   location picker limited to the owner's own approved
   or pending locations, and about. Pause/Resume, edit
   title/about, delete with confirm.
   ════════════════════════════════════════════════ */

export default function MyCamerasPanel({
  onLimitsChange,
}: {
  /** Called after any write that could change the owner's camera count, so
   *  the dashboard route's "3 of 10 cameras" line (from GET /me) stays
   *  current without this panel needing to know about limits itself. */
  onLimitsChange: () => void
}) {
  const { getToken } = useAuth()

  const [videos, setVideos] = useState<Array<OwnerVideo>>([])
  const [locations, setLocations] = useState<Array<OwnerSublocation>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    try {
      const token = await getToken()
      const [vids, locs] = await Promise.all([
        fetchMyVideos(token),
        fetchMySublocations(token),
      ])
      setVideos(vids)
      setLocations(locs)
      setLoadError(null)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load your cameras.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const refresh = async () => {
    await load()
    onLimitsChange()
  }

  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [rtspUrl, setRtspUrl] = useState('')
  const [sublocationId, setSublocationId] = useState<number | ''>('')
  const [about, setAbout] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [rowMsg, setRowMsg] = useState<FormMsg>(null)
  useAutoHide(rowMsg, setRowMsg)
  const [editing, setEditing] = useState<OwnerVideo | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const sortedVideos = useMemo(
    () => [...videos].sort((a, b) => a.title.localeCompare(b.title)),
    [videos],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !rtspUrl || !sublocationId) {
      setMsg({ text: 'Title, RTSP URL and location are required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createMyVideo(
        {
          title,
          rtsp_url: rtspUrl,
          sublocation_id: Number(sublocationId),
          about: about || undefined,
        },
        token,
      )
      setMsg({ text: 'Camera submitted for review!', ok: true })
      setTitle('')
      setRtspUrl('')
      setSublocationId('')
      setAbout('')
      setShowCreate(false)
      await refresh()
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to add camera.',
        ok: false,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const token = await getToken()
      await deleteMyVideo(confirmDelete.id, token)
      setConfirmDelete(null)
      await refresh()
    } catch (err) {
      setRowMsg({
        text: err instanceof Error ? err.message : 'Failed to delete camera.',
        ok: false,
      })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleToggle = async (video: OwnerVideo) => {
    setBusyId(video.video_id)
    try {
      const token = await getToken()
      if (video.status === 'active') await pauseMyVideo(video.video_id, token)
      else await resumeMyVideo(video.video_id, token)
      await refresh()
    } catch (err) {
      setRowMsg({
        text:
          err instanceof Error ? err.message : 'Failed to update the camera.',
        ok: false,
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="My cameras"
          subtitle="Cameras you've added — new ones enter review before going live"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Camera"
        />

        {showCreate && (
          <CreatePanel>
            {locations.length === 0 ? (
              <p className="mb-0 text-sm text-subtext0">
                Add a location first — a camera has to belong to one of your
                locations.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <FormField
                  label="Title"
                  value={title}
                  onChange={setTitle}
                  placeholder="e.g. Marina Front Cam"
                />
                <FormField
                  label="RTSP URL"
                  value={rtspUrl}
                  onChange={setRtspUrl}
                  placeholder="rtsp://user:pass@ip:554/path"
                />
                <Dropdown
                  label="Location"
                  options={locations.map((l) => ({
                    value: l.sublocation_id,
                    label: l.name,
                  }))}
                  selectedValue={sublocationId}
                  onSelect={(v) => setSublocationId(Number(v))}
                />
                <AboutField value={about} onChange={setAbout} />
                <FormFooter
                  msg={msg}
                  submitting={submitting}
                  label="Submit for review"
                />
              </form>
            )}
          </CreatePanel>
        )}

        {loadError && (
          <p className="mb-0 rounded-lg bg-live/10 px-3.5 py-2.5 text-sm text-live">
            {loadError}
          </p>
        )}
        {rowMsg && (
          <p
            className={`mb-0 rounded-lg px-3.5 py-2.5 text-sm ${
              rowMsg.ok ? 'bg-teal/10 text-teal' : 'bg-live/10 text-live'
            }`}
          >
            {rowMsg.text}
          </p>
        )}

        <DataList
          loading={loading}
          empty={!loadError && sortedVideos.length === 0}
          emptyIcon={Film}
          emptyText="No cameras yet — add one to get started"
        >
          {sortedVideos.map((v, i) => (
            <CameraRow
              key={v.video_id}
              video={v}
              index={i}
              busy={busyId === v.video_id}
              onToggle={() => handleToggle(v)}
              onEdit={() => setEditing(v)}
              onDelete={() =>
                setConfirmDelete({ id: v.video_id, name: v.title })
              }
            />
          ))}
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
        <EditCameraModal
          video={editing}
          getToken={getToken}
          onSuccess={() => {
            setEditing(null)
            refresh()
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/* ──── Camera Row ──── */

function CameraRow({
  video,
  index,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  video: OwnerVideo
  index: number
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [showEmbed, setShowEmbed] = useState(false)
  const canToggle = video.status === 'active' || video.status === 'paused'
  const canEmbed =
    video.status !== 'pending' &&
    video.status !== 'rejected' &&
    Boolean(video.sublocation_slug)

  return (
    <div style={staggerStyle(index)}>
      <div className="flex items-start gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/50 sm:px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
          <Film size={18} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-base">
              {video.title}
            </p>
            <StatusPill status={video.status} />
          </div>
          <p className="mb-0 mt-0.5 truncate text-xs text-subtext0">
            {video.state_name}
            {video.sublocation_name ? ` · ${video.sublocation_name}` : ''}
          </p>
          <ReviewNote note={video.review_note} />
          {canEmbed && (
            <button
              type="button"
              onClick={() => setShowEmbed((s) => !s)}
              className="mt-1.5 text-xs font-medium text-accent hover:underline"
            >
              {showEmbed ? 'Hide embed code' : 'Embed code'}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canToggle && (
            <ActionBtn
              icon={video.status === 'active' ? PauseCircle : PlayCircle}
              onClick={onToggle}
              label={video.status === 'active' ? 'Pause' : 'Resume'}
            />
          )}
          {busy && <Loader2 size={14} className="animate-spin text-subtext0" />}
          <ActionBtn icon={Pencil} onClick={onEdit} label="Edit" />
          <ActionBtn
            icon={Trash2}
            onClick={onDelete}
            label="Delete"
            variant="danger"
          />
        </div>
      </div>
      {showEmbed && video.sublocation_slug && (
        <div className="px-4 pb-4 sm:px-5">
          <EmbedSnippet
            stateSlug={video.state_slug}
            sublocationSlug={video.sublocation_slug}
            cameraSlug={video.slug}
            title={video.title}
          />
        </div>
      )}
    </div>
  )
}

/* ──── Edit Camera Modal (title + about only — an owner never edits the
   source, sublocation or status directly) ──── */

function EditCameraModal({
  video,
  getToken,
  onSuccess,
  onClose,
}: {
  video: OwnerVideo
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(video.title)
  const [about, setAbout] = useState(video.about)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title) {
      setMsg({ text: 'Title is required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateMyVideo(video.video_id, { title, about }, token)
      onSuccess()
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to update camera.',
        ok: false,
      })
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
        <AboutField value={about} onChange={setAbout} />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}
