import { useMemo, useState } from 'react'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  Copy,
  Radio,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { StreamDetail } from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import {
  ActionBtn,
  ConfirmDeleteDialog,
  CreatePanel,
  DataList,
  FormField,
  FormFooter,
  ListToolbar,
  PanelHeader,
  StatusBanner,
  staggerStyle,
  useAutoHide,
} from '@/components/dashboardUi'
import { createStream, deleteStream, restartStream } from '@/lib/api'

/* ════════════════════════════════════════════════
   Streams Panel — moved from routes/dashboard.tsx
   during the DAN-41 admin/owner console split.
   ════════════════════════════════════════════════ */

const STREAM_SORT_OPTIONS: Array<{
  value: string
  label: string
  icon: typeof ArrowDownAZ
}> = [
  { value: 'a-z', label: 'A→Z', icon: ArrowDownAZ },
  { value: 'z-a', label: 'Z→A', icon: ArrowUpAZ },
  { value: 'running', label: 'Running', icon: Radio },
]

export default function StreamsPanel({
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

/* ──── Stream Row ──── */

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
          {stream.fps ? ` · ${stream.fps.toFixed(1)} fps` : ''}
          {stream.bitrateKbit
            ? ` · ${(stream.bitrateKbit / 1000).toFixed(1)} Mbps`
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

/* ──── Utilities ──── */

function formatRuntime(seconds: number): string {
  if (seconds <= 0) return 'not started'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m uptime`
  if (m > 0) return `${m}m uptime`
  return `${seconds}s uptime`
}
