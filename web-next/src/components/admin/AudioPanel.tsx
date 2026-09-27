import { useMemo, useState } from 'react'
import { Globe, Landmark, MapPin, Music2, Pencil, Trash2 } from 'lucide-react'
import type {
  AudioStation,
  AudioStationInput,
  State,
  Sublocation,
} from '@/lib/types'
import type { FormMsg, ScopeKind } from '@/components/dashboardUi'
import Dropdown from '@/components/Dropdown'
import {
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
  StatusDot,
  ToggleRow,
  staggerStyle,
  useAutoHide,
} from '@/components/dashboardUi'
import {
  createAudioStation,
  deleteAudioStation,
  updateAudioStation,
} from '@/lib/api'

/* ════════════════════════════════════════════════
   Audio Panel — DAN-47. Admin CRUD for DB-backed
   radio stations, merged with AzuraCast at
   GET /audio/stations. Scope is optional and
   single-level (state or sublocation) — no
   per-camera scope, unlike ads/posts.
   ════════════════════════════════════════════════ */

// A subset of ScopeKind: no 'camera' — audio stations don't scope to one.
const SCOPE_OPTIONS = [
  { value: 'house', label: 'Everywhere' },
  { value: 'state', label: 'State' },
  { value: 'sublocation', label: 'Sublocation' },
]

type AudioFormState = {
  name: string
  streamUrl: string
  enabled: boolean
  sortOrder: string
  scopeKind: ScopeKind
  stateId: number | ''
  sublocationId: number | ''
}

function emptyAudioForm(): AudioFormState {
  return {
    name: '',
    streamUrl: '',
    enabled: true,
    sortOrder: '0',
    scopeKind: 'house',
    stateId: '',
    sublocationId: '',
  }
}

function stationToForm(
  station: AudioStation,
  sublocations: Array<Sublocation>,
): AudioFormState {
  let scopeKind: ScopeKind = 'house'
  let stateId: number | '' = ''
  let sublocationId: number | '' = ''
  if (station.sublocation_id) {
    scopeKind = 'sublocation'
    sublocationId = station.sublocation_id
    stateId =
      sublocations.find((s) => s.sublocation_id === station.sublocation_id)
        ?.state_id ?? ''
  } else if (station.state_id) {
    scopeKind = 'state'
    stateId = station.state_id
  }
  return {
    name: station.name,
    streamUrl: station.stream_url,
    enabled: station.enabled,
    sortOrder: String(station.sort_order),
    scopeKind,
    stateId,
    sublocationId,
  }
}

function validateAudioForm(form: AudioFormState): string | null {
  if (!form.name.trim()) return 'Name is required.'
  if (form.name.trim().length > 80)
    return 'Name must be 80 characters or fewer.'
  if (!form.streamUrl.trim().startsWith('https://'))
    return 'Stream URL must be an https:// URL.'
  if (form.scopeKind === 'state' && form.stateId === '')
    return 'Select a state.'
  if (form.scopeKind === 'sublocation' && form.sublocationId === '')
    return 'Select a sublocation.'
  return null
}

function buildAudioInput(form: AudioFormState): AudioStationInput {
  return {
    name: form.name.trim(),
    stream_url: form.streamUrl.trim(),
    enabled: form.enabled,
    sort_order: parseInt(form.sortOrder, 10) || 0,
    state_id: form.scopeKind === 'state' ? Number(form.stateId) : null,
    sublocation_id:
      form.scopeKind === 'sublocation' ? Number(form.sublocationId) : null,
  }
}

export default function AudioPanel({
  stations: allStations,
  states,
  sublocations,
  getToken,
  onSuccess,
  loading,
}: {
  stations: Array<AudioStation>
  states: Array<State>
  sublocations: Array<Sublocation>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<AudioFormState>(emptyAudioForm)
  const update = (patch: Partial<AudioFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<AudioStation | null>(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('a-z')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = [...allStations]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.stream_url.toLowerCase().includes(q) ||
          (s.state_name && s.state_name.toLowerCase().includes(q)) ||
          (s.sublocation_name && s.sublocation_name.toLowerCase().includes(q)),
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
  }, [allStations, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const stations = filtered.slice(
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

  const handleToggle = async (station: AudioStation) => {
    try {
      const token = await getToken()
      await updateAudioStation(
        station.audio_station_id,
        {
          name: station.name,
          stream_url: station.stream_url,
          enabled: !station.enabled,
          sort_order: station.sort_order,
          state_id: station.state_id,
          sublocation_id: station.sublocation_id,
        },
        token,
      )
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update station.', ok: false })
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const token = await getToken()
      await deleteAudioStation(confirmDelete.id, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete station.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateAudioForm(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createAudioStation(buildAudioInput(form), token)
      setMsg({ text: 'Station created successfully!', ok: true })
      setForm(emptyAudioForm())
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to create station.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="Audio"
          subtitle="Radio stations for the player's audio picker"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Station"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AudioFields
                form={form}
                update={update}
                states={states}
                sublocations={sublocations}
              />
              <FormFooter
                msg={msg}
                submitting={submitting}
                label="Add Station"
              />
            </form>
          </CreatePanel>
        )}

        <DataList
          loading={loading}
          empty={allStations.length === 0}
          emptyIcon={Music2}
          emptyText="No stations yet"
          toolbar={
            !loading && allStations.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="stations"
                sortOptions={ENTITY_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No stations matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {stations.map((s, i) => (
                <AudioRow
                  key={s.audio_station_id}
                  station={s}
                  index={i}
                  onToggle={() => handleToggle(s)}
                  onEdit={() => setEditing(s)}
                  onDelete={() =>
                    setConfirmDelete({ id: s.audio_station_id, name: s.name })
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
        <EditAudioModal
          station={editing}
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

/* ──── Form fields (shared by create + edit) ──── */

function AudioFields({
  form,
  update,
  states,
  sublocations,
}: {
  form: AudioFormState
  update: (patch: Partial<AudioFormState>) => void
  states: Array<State>
  sublocations: Array<Sublocation>
}) {
  const filteredSubs = sublocations.filter((s) => s.state_id === form.stateId)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          value={form.name}
          onChange={(v) => update({ name: v })}
          placeholder="e.g. FNIT Radio"
        />
        <FormField
          label="Stream URL (https)"
          value={form.streamUrl}
          onChange={(v) => update({ streamUrl: v })}
          placeholder="https://stream.example.com/radio.mp3"
        />
      </div>

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
            })
          }
        />
        {form.scopeKind !== 'house' && (
          <Dropdown
            label={form.scopeKind === 'state' ? 'State' : 'State (filter)'}
            options={states.map((s) => ({ value: s.state_id, label: s.name }))}
            selectedValue={form.stateId}
            onSelect={(v) => update({ stateId: Number(v), sublocationId: '' })}
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
      </div>
      {form.scopeKind === 'house' && (
        <p className="mb-0 -mt-2 text-xs text-subtext0">
          Everywhere — shown in the picker on every camera.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-subtext0">
            Sort order
          </label>
          <input
            type="number"
            value={form.sortOrder}
            onChange={(e) => update({ sortOrder: e.target.value })}
            className="w-full rounded-lg border border-overlay0 bg-base px-3.5 py-2.5 font-sans text-sm text-text transition-[border-color,box-shadow] duration-200 placeholder:text-overlay1 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
          />
        </div>
        <ToggleRow
          label="Enabled"
          description="Show this station in the picker"
          checked={form.enabled}
          onChange={(v) => update({ enabled: v })}
        />
      </div>
    </div>
  )
}

/* ──── Row ──── */

function audioScopeLabel(station: AudioStation): {
  label: string
  icon: typeof Globe
} {
  if (station.sublocation_id)
    return {
      label:
        station.sublocation_name || `Sublocation #${station.sublocation_id}`,
      icon: Landmark,
    }
  if (station.state_id)
    return {
      label: station.state_name || `State #${station.state_id}`,
      icon: MapPin,
    }
  return { label: 'Everywhere', icon: Globe }
}

function AudioRow({
  station,
  index,
  onToggle,
  onEdit,
  onDelete,
}: {
  station: AudioStation
  index: number
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const scope = audioScopeLabel(station)
  const ScopeIcon = scope.icon

  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/50 sm:px-5"
      style={staggerStyle(index)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
        <Music2 size={18} className="text-accent" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-base">
          {station.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-px font-mono text-[11px] text-accent">
            <ScopeIcon size={11} />
            {scope.label}
          </span>
          <span className="truncate font-mono text-[11px] text-overlay2">
            {station.stream_url}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        title={station.enabled ? 'Disable' : 'Enable'}
      >
        <StatusDot
          active={station.enabled}
          label={station.enabled ? 'On' : 'Off'}
        />
      </button>

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

/* ──── Edit modal ──── */

function EditAudioModal({
  station,
  states,
  sublocations,
  getToken,
  onSuccess,
  onClose,
}: {
  station: AudioStation
  states: Array<State>
  sublocations: Array<Sublocation>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<AudioFormState>(() =>
    stationToForm(station, sublocations),
  )
  const update = (patch: Partial<AudioFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateAudioForm(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateAudioStation(
        station.audio_station_id,
        buildAudioInput(form),
        token,
      )
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update station.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit Station" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <AudioFields
          form={form}
          update={update}
          states={states}
          sublocations={sublocations}
        />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}
