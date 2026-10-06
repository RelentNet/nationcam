import { useMemo, useState } from 'react'
import { CalendarDays, Film, Landmark, Pencil, Trash2 } from 'lucide-react'
import type {
  EventInput,
  EventItem,
  State,
  Sublocation,
  Video,
} from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import Field, { Input } from '@/components/ui/Field'
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
  staggerStyle,
  toISO,
  toLocalInput,
  useAutoHide,
} from '@/components/dashboardUi'
import { createEvent, deleteEvent, updateEvent } from '@/lib/api'

/* ════════════════════════════════════════════════
   Events Panel — moved from routes/dashboard.tsx
   during the DAN-41 admin/owner console split.
   ════════════════════════════════════════════════ */

// One flat form model for both the create form and the edit modal. Unlike
// ads/posts, sublocation_id is required and video_id is a plain optional
// pointer rather than a mutually-exclusive "scope kind" — stateId exists only
// to filter the sublocation dropdown and is never sent to the API.
type EventFormState = {
  title: string
  descriptionMd: string
  startsAt: string
  endsAt: string
  url: string
  stateId: number | ''
  sublocationId: number | ''
  videoId: number | ''
}

function emptyEventForm(): EventFormState {
  return {
    title: '',
    descriptionMd: '',
    startsAt: '',
    endsAt: '',
    url: '',
    stateId: '',
    sublocationId: '',
    videoId: '',
  }
}

// eventToForm seeds the edit form from only the fields it needs — never the
// whole row — so a stale copy of e.g. sublocation_name can never leak back
// into buildEventInput on submit (same reasoning as postToForm).
function eventToForm(
  event: EventItem,
  sublocations: Array<Sublocation>,
): EventFormState {
  const stateId =
    sublocations.find((s) => s.sublocation_id === event.sublocation_id)
      ?.state_id ?? ''
  return {
    title: event.title,
    descriptionMd: event.description_md,
    startsAt: toLocalInput(event.starts_at),
    endsAt: toLocalInput(event.ends_at),
    url: event.url ?? '',
    stateId,
    sublocationId: event.sublocation_id,
    videoId: event.video_id ?? '',
  }
}

function validateEvent(form: EventFormState): string | null {
  if (!form.title.trim()) return 'Title is required.'
  if (form.sublocationId === '') return 'Select a sublocation.'
  if (!form.startsAt) return 'Start date/time is required.'
  if (
    form.endsAt &&
    new Date(form.endsAt).getTime() <= new Date(form.startsAt).getTime()
  ) {
    return 'End must be after start.'
  }
  return null
}

function buildEventInput(form: EventFormState): EventInput {
  return {
    title: form.title.trim(),
    description_md: form.descriptionMd,
    starts_at: toISO(form.startsAt) ?? '',
    ends_at: toISO(form.endsAt),
    url: form.url.trim(),
    sublocation_id: Number(form.sublocationId),
    video_id: form.videoId === '' ? null : Number(form.videoId),
  }
}

export default function EventsPanel({
  events: allEvents,
  states,
  sublocations,
  videos,
  getToken,
  onSuccess,
  loading,
}: {
  events: Array<EventItem>
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<EventFormState>(emptyEventForm)
  const update = (patch: Partial<EventFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    title: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<EventItem | null>(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('newest')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = [...allEvents]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.sublocation_name.toLowerCase().includes(q) ||
          (e.video_title && e.video_title.toLowerCase().includes(q)),
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
            new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
        )
        break
      case 'oldest':
        result.sort(
          (a, b) =>
            new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
        )
        break
    }
    return result
  }, [allEvents, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const events = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

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
      await deleteEvent(confirmDelete.id, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete event.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateEvent(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createEvent(buildEventInput(form), token)
      setMsg({ text: 'Event created successfully!', ok: true })
      setForm(emptyEventForm())
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to create event.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="Events"
          subtitle="Tournaments, rodeos and festivals — shown on their camera/sublocation page and at /events"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Event"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <EventFields
                form={form}
                update={update}
                states={states}
                sublocations={sublocations}
                videos={videos}
              />
              <FormFooter msg={msg} submitting={submitting} label="Add Event" />
            </form>
          </CreatePanel>
        )}

        <DataList
          loading={loading}
          empty={allEvents.length === 0}
          emptyIcon={CalendarDays}
          emptyText="No events yet"
          toolbar={
            !loading && allEvents.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="events"
                sortOptions={ENTITY_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No events matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {events.map((ev, i) => (
                <EventRow
                  key={ev.event_id}
                  event={ev}
                  index={i}
                  onEdit={() => setEditing(ev)}
                  onDelete={() =>
                    setConfirmDelete({ id: ev.event_id, title: ev.title })
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
          name={confirmDelete.title}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {editing && (
        <EditEventModal
          event={editing}
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

/* ──── Event Form Fields (shared by create + edit) ──── */

function EventFields({
  form,
  update,
  states,
  sublocations,
  videos,
}: {
  form: EventFormState
  update: (patch: Partial<EventFormState>) => void
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
}) {
  const filteredSubs = sublocations.filter((s) => s.state_id === form.stateId)
  // Cameras filtered by the chosen sublocation itself, not just its state —
  // the "Watch here" link only makes sense for a camera actually at the event.
  const filteredVideos = videos.filter(
    (v) => v.sublocation_id === form.sublocationId,
  )

  return (
    <div className="space-y-4">
      <FormField
        label="Title"
        value={form.title}
        onChange={(v) => update({ title: v })}
        placeholder="e.g. Fall Fishing Tournament"
      />

      <AboutField
        value={form.descriptionMd}
        onChange={(v) => update({ descriptionMd: v })}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="State (filter)"
          options={states.map((s) => ({ value: s.state_id, label: s.name }))}
          selectedValue={form.stateId}
          onSelect={(v) =>
            update({ stateId: Number(v), sublocationId: '', videoId: '' })
          }
        />
        {form.stateId !== '' && (
          <SelectField
            label="Sublocation"
            options={filteredSubs.map((s) => ({
              value: s.sublocation_id,
              label: s.name,
            }))}
            selectedValue={form.sublocationId}
            onSelect={(v) => update({ sublocationId: Number(v), videoId: '' })}
          />
        )}
        {form.sublocationId !== '' && (
          <SelectField
            label="Camera (optional)"
            options={[
              { value: '', label: 'None — no “Watch here” link' },
              ...filteredVideos.map((v) => ({
                value: v.video_id,
                label: v.title,
              })),
            ]}
            selectedValue={form.videoId}
            onSelect={(v) => update({ videoId: v === '' ? '' : Number(v) })}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts at">
          <Input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => update({ startsAt: e.target.value })}
          />
        </Field>
        <Field label="Ends at (optional)">
          <Input
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => update({ endsAt: e.target.value })}
          />
        </Field>
      </div>

      <FormField
        label="Event URL (optional)"
        value={form.url}
        onChange={(v) => update({ url: v })}
        placeholder="https://example.com/tournament"
      />
    </div>
  )
}

/* ──── Event Row ──── */

function eventWhenLabel(ev: EventItem): string {
  return new Date(ev.starts_at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function EventRow({
  event: ev,
  index,
  onEdit,
  onDelete,
}: {
  event: EventItem
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:px-5"
      style={staggerStyle(index)}
    >
      <CalendarDays size={18} className="text-accent" />

      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
          {ev.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-px font-mono text-[11px] text-accent">
            <Landmark size={11} />
            {ev.sublocation_name}
          </span>
          {ev.video_title && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-surface1 px-1.5 py-px font-mono text-[11px] text-subtext0">
              <Film size={11} />
              {ev.video_title}
            </span>
          )}
          <span className="text-xs text-subtext0">{eventWhenLabel(ev)}</span>
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

/* ──── Edit Event Modal ──── */

function EditEventModal({
  event: eventRow,
  states,
  sublocations,
  videos,
  getToken,
  onSuccess,
  onClose,
}: {
  event: EventItem
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<EventFormState>(() =>
    eventToForm(eventRow, sublocations),
  )
  const update = (patch: Partial<EventFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateEvent(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateEvent(eventRow.event_id, buildEventInput(form), token)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update event.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit Event" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <EventFields
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
