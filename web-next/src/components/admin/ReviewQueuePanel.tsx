import { useEffect, useState } from 'react'
import {
  Check,
  ClipboardCheck,
  Film,
  Landmark,
  Loader2,
  User,
  X,
} from 'lucide-react'
import type { OwnerSublocation, OwnerVideo } from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import {
  DataList,
  ModalShell,
  PanelHeaderStatic,
  StatusBanner,
  staggerStyle,
  timeAgo,
  useAutoHide,
} from '@/components/dashboardUi'
import {
  approveSublocation,
  approveVideo,
  fetchReviewQueue,
  rejectSublocation,
  rejectVideo,
} from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import Button, { buttonClasses } from '@/components/Button'
import Field, { Textarea } from '@/components/ui/Field'
import StreamPlayer from '@/components/StreamPlayer'

/* ════════════════════════════════════════════════
   Review Queue Panel (DAN-41) — admin-only. Pending
   sublocations and cameras, oldest first, with the
   submitting owner's id, an HLS preview for a pending
   camera, and Approve / Reject-with-note.
   ════════════════════════════════════════════════ */

export default function ReviewQueuePanel() {
  const { getToken } = useAuth()

  const [sublocations, setSublocations] = useState<Array<OwnerSublocation>>([])
  const [videos, setVideos] = useState<Array<OwnerVideo>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const load = async () => {
    try {
      const token = await getToken()
      const queue = await fetchReviewQueue(token)
      setSublocations(queue.sublocations)
      setVideos(queue.videos)
      setLoadError(null)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load the review queue.',
      )
    } finally {
      setLoading(false)
    }
  }

  // Fetch once on mount — same empty-deps pattern as SubmissionsInbox, to
  // avoid the Logto isLoading-flicker refetch loop (see useAuth.ts).
  useEffect(() => {
    load()
  }, [])

  const [rejecting, setRejecting] = useState<{
    kind: 'sublocation' | 'video'
    id: number
    name: string
  } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const handleApprove = async (kind: 'sublocation' | 'video', id: number) => {
    const key = `${kind}-${id}`
    setBusyId(key)
    try {
      const token = await getToken()
      if (kind === 'sublocation') await approveSublocation(id, token)
      else await approveVideo(id, token)
      setMsg({ text: 'Approved.', ok: true })
      await load()
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to approve.',
        ok: false,
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (note: string) => {
    if (!rejecting) return
    const { kind, id } = rejecting
    const key = `${kind}-${id}`
    setBusyId(key)
    try {
      const token = await getToken()
      if (kind === 'sublocation') await rejectSublocation(id, note, token)
      else await rejectVideo(id, note, token)
      setMsg({ text: 'Rejected.', ok: true })
      setRejecting(null)
      await load()
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to reject.',
        ok: false,
      })
    } finally {
      setBusyId(null)
    }
  }

  const total = sublocations.length + videos.length

  return (
    <div className="space-y-4">
      <PanelHeaderStatic
        title="Review queue"
        subtitle="Pending locations and cameras submitted by owners"
      />

      {loadError && (
        <p
          role="alert"
          className="mb-0 rounded-r-md border-l-2 border-live bg-live-glow px-3 py-2 text-sm font-medium text-text"
        >
          {loadError}
        </p>
      )}

      <DataList
        loading={loading}
        empty={!loadError && total === 0}
        emptyIcon={ClipboardCheck}
        emptyText="Nothing waiting on review"
        toolbar={undefined}
      >
        {sublocations.map((s, i) => (
          <SublocationReviewRow
            key={`sub-${s.sublocation_id}`}
            sublocation={s}
            index={i}
            busy={busyId === `sublocation-${s.sublocation_id}`}
            onApprove={() => handleApprove('sublocation', s.sublocation_id)}
            onReject={() =>
              setRejecting({
                kind: 'sublocation',
                id: s.sublocation_id,
                name: s.name,
              })
            }
          />
        ))}
        {videos.map((v, i) => (
          <VideoReviewRow
            key={`vid-${v.video_id}`}
            video={v}
            index={sublocations.length + i}
            busy={busyId === `video-${v.video_id}`}
            onApprove={() => handleApprove('video', v.video_id)}
            onReject={() =>
              setRejecting({ kind: 'video', id: v.video_id, name: v.title })
            }
          />
        ))}
      </DataList>

      {msg && <StatusBanner msg={msg} />}

      {rejecting && (
        <RejectModal
          name={rejecting.name}
          busy={busyId === `${rejecting.kind}-${rejecting.id}`}
          onCancel={() => setRejecting(null)}
          onConfirm={handleReject}
        />
      )}
    </div>
  )
}

/* ──── Pending sublocation row ──── */

function SublocationReviewRow({
  sublocation: s,
  index,
  busy,
  onApprove,
  onReject,
}: {
  sublocation: OwnerSublocation
  index: number
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div
      className="flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
      style={staggerStyle(index)}
    >
      <Landmark size={18} className="text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
            {s.name}
          </p>
          <span className="inline-flex shrink-0 items-center rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
            Location
          </span>
          <span className="text-xs text-subtext0">{timeAgo(s.created_at)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-xs text-subtext0">{s.state_name}</span>
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-overlay2">
            <User size={11} />
            {s.owner_id}
          </span>
        </div>
      </div>
      <ReviewActions busy={busy} onApprove={onApprove} onReject={onReject} />
    </div>
  )
}

/* ──── Pending camera row (with HLS preview) ──── */

function VideoReviewRow({
  video: v,
  index,
  busy,
  onApprove,
  onReject,
}: {
  video: OwnerVideo
  index: number
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const [showPreview, setShowPreview] = useState(false)

  return (
    <div style={staggerStyle(index)}>
      <div className="flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <Film size={18} className="text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
              {v.title}
            </p>
            <span className="inline-flex shrink-0 items-center rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
              Camera
            </span>
            <span className="text-xs text-subtext0">
              {timeAgo(v.created_at)}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-xs text-subtext0">
              {v.state_name}
              {v.sublocation_name ? ` · ${v.sublocation_name}` : ''}
              {v.sublocation_status === 'pending'
                ? ' (location also pending)'
                : ''}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-overlay2">
              <User size={11} />
              {v.owner_id}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className="mt-1.5 text-xs font-medium text-accent-ink hover:underline"
          >
            {showPreview ? 'Hide preview' : 'Preview stream'}
          </button>
        </div>
        <ReviewActions busy={busy} onApprove={onApprove} onReject={onReject} />
      </div>
      {showPreview && (
        <div className="px-4 pb-4 sm:px-5">
          <div className="overflow-hidden rounded-lg border border-border">
            <StreamPlayer src={v.src} type={v.type} controls fluid />
          </div>
        </div>
      )}
    </div>
  )
}

/* ──── Shared approve/reject buttons ──── */

function ReviewActions({
  busy,
  onApprove,
  onReject,
}: {
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button size="sm" onClick={onApprove} disabled={busy}>
        {busy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Check size={13} />
        )}
        Approve
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={onReject}
        disabled={busy}
        className="hover:border-live! hover:text-live!"
      >
        <X size={13} />
        Reject
      </Button>
    </div>
  )
}

/* ──── Reject-with-note modal ──── */

function RejectModal({
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string
  busy: boolean
  onCancel: () => void
  onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')

  return (
    <ModalShell title={`Reject "${name}"`} onClose={onCancel}>
      <div className="space-y-4">
        <Field label="Note to the owner (optional)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Why this was rejected — shown to the owner on their dashboard."
          />
        </Field>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
            className="flex-1"
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={() => onConfirm(note)}
            disabled={busy}
            className={buttonClasses({
              className:
                'flex-1 border-live! bg-live! text-white! hover:bg-live/90!',
            })}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
