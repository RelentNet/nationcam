import { useEffect, useMemo, useState } from 'react'
import { Landmark, Pencil, Trash2 } from 'lucide-react'
import type { OwnerSublocation, State } from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import {
  ActionBtn,
  ConfirmDeleteDialog,
  CreatePanel,
  DataList,
  FormField,
  FormFooter,
  ModalShell,
  PanelHeader,
  SelectField,
  staggerStyle,
  useAutoHide,
} from '@/components/dashboardUi'
import { ReviewNote, StatusPill } from '@/components/owner/ownerUi'
import {
  createMySublocation,
  deleteMySublocation,
  fetchMySublocations,
  fetchStates,
  updateMySublocation,
} from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

/* ════════════════════════════════════════════════
   My Locations Panel (DAN-41) — the owner's own
   sublocations, any status. Add form: name, state,
   description, address, optional coordinates, host
   name/url. Delete only while it has no cameras (the
   API 409s otherwise; the message surfaces inline).
   ════════════════════════════════════════════════ */

type LocationForm = {
  name: string
  description: string
  stateId: number | ''
  address: string
  lat: string
  lng: string
  hostName: string
  hostUrl: string
}

function emptyLocationForm(): LocationForm {
  return {
    name: '',
    description: '',
    stateId: '',
    address: '',
    lat: '',
    lng: '',
    hostName: '',
    hostUrl: '',
  }
}

function locationToForm(s: OwnerSublocation): LocationForm {
  return {
    name: s.name,
    description: s.description,
    stateId: s.state_id,
    address: s.address,
    lat: s.lat?.toString() ?? '',
    lng: s.lng?.toString() ?? '',
    hostName: s.host_name,
    hostUrl: s.host_url,
  }
}

export default function MyLocationsPanel() {
  const { getToken } = useAuth()

  const [locations, setLocations] = useState<Array<OwnerSublocation>>([])
  const [states, setStates] = useState<Array<State>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    try {
      const token = await getToken()
      const [locs, statesData] = await Promise.all([
        fetchMySublocations(token),
        fetchStates(),
      ])
      setLocations(locs)
      setStates(statesData)
      setLoadError(null)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load your locations.',
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
  }

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<LocationForm>(emptyLocationForm)
  const update = (patch: Partial<LocationForm>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState<FormMsg>(null)
  useAutoHide(deleteMsg, setDeleteMsg)
  const [editing, setEditing] = useState<OwnerSublocation | null>(null)

  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) => a.name.localeCompare(b.name)),
    [locations],
  )

  const buildInput = (f: LocationForm) => ({
    name: f.name,
    description: f.description || undefined,
    state_id: Number(f.stateId),
    address: f.address || undefined,
    lat: f.lat.trim() === '' ? null : Number(f.lat),
    lng: f.lng.trim() === '' ? null : Number(f.lng),
    host_name: f.hostName || undefined,
    host_url: f.hostUrl || undefined,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.stateId) {
      setMsg({ text: 'Name and state are required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createMySublocation(buildInput(form), token)
      setMsg({ text: 'Location submitted for review!', ok: true })
      setForm(emptyLocationForm())
      setShowCreate(false)
      await refresh()
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to add location.',
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
      await deleteMySublocation(confirmDelete.id, token)
      setConfirmDelete(null)
      await refresh()
    } catch (err) {
      setDeleteMsg({
        text: err instanceof Error ? err.message : 'Failed to delete location.',
        ok: false,
      })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="My locations"
          subtitle="Places you've added — review takes place before they go public"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Location"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Name"
                  value={form.name}
                  onChange={(v) => update({ name: v })}
                  placeholder="e.g. Miami Beach"
                />
                <SelectField
                  label="State"
                  options={states.map((s) => ({
                    value: s.state_id,
                    label: s.name,
                  }))}
                  selectedValue={form.stateId}
                  onSelect={(v) => update({ stateId: Number(v) })}
                />
              </div>
              <FormField
                label="Description"
                value={form.description}
                onChange={(v) => update({ description: v })}
                placeholder="Optional"
              />
              <FormField
                label="Address"
                value={form.address}
                onChange={(v) => update({ address: v })}
                placeholder="Optional"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Latitude (optional)"
                  type="number"
                  value={form.lat}
                  onChange={(v) => update({ lat: v })}
                  placeholder="29.277"
                />
                <FormField
                  label="Longitude (optional)"
                  type="number"
                  value={form.lng}
                  onChange={(v) => update({ lng: v })}
                  placeholder="-89.354"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Host name (optional)"
                  value={form.hostName}
                  onChange={(v) => update({ hostName: v })}
                  placeholder="Venice Marina"
                />
                <FormField
                  label="Host website (optional)"
                  type="url"
                  value={form.hostUrl}
                  onChange={(v) => update({ hostUrl: v })}
                  placeholder="https://www.venicemarina.com"
                />
              </div>
              <FormFooter
                msg={msg}
                submitting={submitting}
                label="Submit for review"
              />
            </form>
          </CreatePanel>
        )}

        {loadError && (
          <p className="mb-0 rounded-lg bg-live/10 px-3.5 py-2.5 text-sm text-live">
            {loadError}
          </p>
        )}
        {deleteMsg && (
          <p
            className={`mb-0 rounded-lg px-3.5 py-2.5 text-sm ${
              deleteMsg.ok ? 'bg-teal/10 text-teal' : 'bg-live/10 text-live'
            }`}
          >
            {deleteMsg.text}
          </p>
        )}

        <DataList
          loading={loading}
          empty={!loadError && sortedLocations.length === 0}
          emptyIcon={Landmark}
          emptyText="No locations yet — add one to get started"
        >
          {sortedLocations.map((s, i) => (
            <LocationRow
              key={s.sublocation_id}
              location={s}
              index={i}
              onEdit={() => setEditing(s)}
              onDelete={() =>
                setConfirmDelete({ id: s.sublocation_id, name: s.name })
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
        <EditLocationModal
          location={editing}
          states={states}
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

/* ──── Location Row ──── */

function LocationRow({
  location,
  index,
  onEdit,
  onDelete,
}: {
  location: OwnerSublocation
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="flex items-start gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:px-5"
      style={staggerStyle(index)}
    >
      <Landmark size={18} className="text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
            {location.name}
          </p>
          <StatusPill status={location.status} />
        </div>
        <p className="mb-0 mt-0.5 truncate text-xs text-subtext0">
          {location.state_name} &middot; {location.video_count} camera
          {location.video_count !== 1 ? 's' : ''}
        </p>
        <ReviewNote note={location.review_note} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ActionBtn icon={Pencil} onClick={onEdit} label="Edit" />
        <ActionBtn
          icon={Trash2}
          onClick={onDelete}
          label={
            location.video_count > 0
              ? 'Delete or move its cameras first'
              : 'Delete'
          }
          variant="danger"
        />
      </div>
    </div>
  )
}

/* ──── Edit Location Modal ──── */

function EditLocationModal({
  location,
  states,
  getToken,
  onSuccess,
  onClose,
}: {
  location: OwnerSublocation
  states: Array<State>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<LocationForm>(() => locationToForm(location))
  const update = (patch: Partial<LocationForm>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.stateId) {
      setMsg({ text: 'Name and state are required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateMySublocation(
        location.sublocation_id,
        {
          name: form.name,
          description: form.description || undefined,
          state_id: Number(form.stateId),
          address: form.address || undefined,
          lat: form.lat.trim() === '' ? null : Number(form.lat),
          lng: form.lng.trim() === '' ? null : Number(form.lng),
          host_name: form.hostName || undefined,
          host_url: form.hostUrl || undefined,
        },
        token,
      )
      onSuccess()
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to update location.',
        ok: false,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit Location" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="Name"
          value={form.name}
          onChange={(v) => update({ name: v })}
          placeholder="e.g. Miami Beach"
        />
        <SelectField
          label="State"
          options={states.map((s) => ({ value: s.state_id, label: s.name }))}
          selectedValue={form.stateId}
          onSelect={(v) => update({ stateId: Number(v) })}
        />
        <FormField
          label="Description"
          value={form.description}
          onChange={(v) => update({ description: v })}
          placeholder="Optional"
        />
        <FormField
          label="Address"
          value={form.address}
          onChange={(v) => update({ address: v })}
          placeholder="Optional"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Latitude (optional)"
            type="number"
            value={form.lat}
            onChange={(v) => update({ lat: v })}
            placeholder="29.277"
          />
          <FormField
            label="Longitude (optional)"
            type="number"
            value={form.lng}
            onChange={(v) => update({ lng: v })}
            placeholder="-89.354"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Host name (optional)"
            value={form.hostName}
            onChange={(v) => update({ hostName: v })}
            placeholder="Venice Marina"
          />
          <FormField
            label="Host website (optional)"
            type="url"
            value={form.hostUrl}
            onChange={(v) => update({ hostUrl: v })}
            placeholder="https://www.venicemarina.com"
          />
        </div>
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}
