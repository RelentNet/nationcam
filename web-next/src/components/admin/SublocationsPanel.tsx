import { useMemo, useState } from 'react'
import { Landmark, Pencil, Trash2 } from 'lucide-react'
import type { ConditionsOverride, Host, State, Sublocation } from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import {
  AboutField,
  ActionBtn,
  BrandingFields,
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
  useAutoHide,
  useBranding,
} from '@/components/dashboardUi'
import {
  createSublocation,
  deleteSublocation,
  updateSublocation,
} from '@/lib/api'

/* ════════════════════════════════════════════════
   Sublocations Panel — moved from routes/dashboard.tsx
   during the DAN-41 admin/owner console split.
   ════════════════════════════════════════════════ */

/** The host block as form strings; converted by `hostBody` on submit. */
type HostForm = Record<keyof Host, string>

const emptyHost: HostForm = {
  lat: '',
  lng: '',
  host_name: '',
  host_url: '',
  host_since: '',
  address: '',
}

// useHostForm holds the six host / visit fields for a sublocation form, seeded
// from an existing row (edit) or blank (create).
function useHostForm(initial?: Host) {
  const [host, setHost] = useState<HostForm>(() =>
    initial
      ? {
          lat: initial.lat?.toString() ?? '',
          lng: initial.lng?.toString() ?? '',
          host_name: initial.host_name,
          host_url: initial.host_url,
          host_since: initial.host_since ?? '',
          address: initial.address,
        }
      : emptyHost,
  )
  const update = (patch: Partial<HostForm>) =>
    setHost((h) => ({ ...h, ...patch }))
  const reset = () => setHost(emptyHost)
  return { host, update, reset }
}

// hostBody turns the form strings into the API shape: blank coordinates and
// date become null, so the API's "both or neither" check sees real values.
function hostBody(h: HostForm): Host {
  return {
    lat: h.lat.trim() === '' ? null : Number(h.lat),
    lng: h.lng.trim() === '' ? null : Number(h.lng),
    host_name: h.host_name,
    host_url: h.host_url,
    host_since: h.host_since || null,
    address: h.address,
  }
}

function HostFields({
  host,
  update,
}: {
  host: HostForm
  update: (patch: Partial<HostForm>) => void
}) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-base/40 p-4">
      <p className="mb-0 text-xs font-semibold tracking-wide text-subtext0 uppercase">
        Host &amp; visit
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Latitude"
          type="number"
          value={host.lat}
          onChange={(v) => update({ lat: v })}
          placeholder="29.277 (unlocks the weather panel)"
        />
        <FormField
          label="Longitude"
          type="number"
          value={host.lng}
          onChange={(v) => update({ lng: v })}
          placeholder="-89.354"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          label="Host name"
          value={host.host_name}
          onChange={(v) => update({ host_name: v })}
          placeholder="Venice Marina"
        />
        <FormField
          label="Host website"
          type="url"
          value={host.host_url}
          onChange={(v) => update({ host_url: v })}
          placeholder="https://www.venicemarina.com"
        />
        <FormField
          label="On NationCam since"
          type="date"
          value={host.host_since}
          onChange={(v) => update({ host_since: v })}
        />
      </div>
      <FormField
        label="Address"
        value={host.address}
        onChange={(v) => update({ address: v })}
        placeholder="237 Sports Marina Rd, Venice, LA 70091"
      />
    </div>
  )
}

/** The tide/river override block as form strings; converted by
 *  `conditionsOverrideBody` on submit. */
type ConditionsOverrideForm = Record<keyof ConditionsOverride, string>

const emptyConditionsOverride: ConditionsOverrideForm = {
  noaa_station_id: '',
  usgs_site_id: '',
}

// useConditionsOverrideForm holds the two conditions-page override fields for
// a sublocation form, seeded from an existing row (edit) or blank (create).
function useConditionsOverrideForm(initial?: ConditionsOverride) {
  const [override, setOverride] = useState<ConditionsOverrideForm>(() =>
    initial
      ? {
          noaa_station_id: initial.noaa_station_id ?? '',
          usgs_site_id: initial.usgs_site_id ?? '',
        }
      : emptyConditionsOverride,
  )
  const update = (patch: Partial<ConditionsOverrideForm>) =>
    setOverride((o) => ({ ...o, ...patch }))
  const reset = () => setOverride(emptyConditionsOverride)
  return { override, update, reset }
}

// conditionsOverrideBody turns the form strings into the API shape: blank
// becomes null ("no override, use the nearest station/gauge").
function conditionsOverrideBody(o: ConditionsOverrideForm): ConditionsOverride {
  return {
    noaa_station_id: o.noaa_station_id.trim() || null,
    usgs_site_id: o.usgs_site_id.trim() || null,
  }
}

// ConditionsOverrideFields lets an admin pin (or turn off with "none") the
// tide station and river gauge a sublocation's conditions page uses, instead
// of always taking the nearest one — see DAN-28.
function ConditionsOverrideFields({
  override,
  update,
}: {
  override: ConditionsOverrideForm
  update: (patch: Partial<ConditionsOverrideForm>) => void
}) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-base/40 p-4">
      <p className="mb-0 text-xs font-semibold tracking-wide text-subtext0 uppercase">
        Conditions overrides
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FormField
            label="NOAA tide station ID"
            value={override.noaa_station_id}
            onChange={(v) => update({ noaa_station_id: v })}
            placeholder="8760922"
          />
          <p className="mt-1 mb-0 text-xs text-overlay2">
            Pins the tide table to this station instead of the nearest one.
            Enter <code>none</code> to turn tides off. Find an ID on the{' '}
            <a
              href="https://tidesandcurrents.noaa.gov/stations.html?type=Tide+Predictions"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              NOAA station list
            </a>
            .
          </p>
        </div>
        <div>
          <FormField
            label="USGS site ID"
            value={override.usgs_site_id}
            onChange={(v) => update({ usgs_site_id: v })}
            placeholder="07374525"
          />
          <p className="mt-1 mb-0 text-xs text-overlay2">
            Pins river stage to this gauge instead of the nearest one. Enter{' '}
            <code>none</code> to turn river stage off. Find an ID on the{' '}
            <a
              href="https://waterdata.usgs.gov/nwis/rt"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              USGS site map
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SublocationsPanel({
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
  const [about, setAbout] = useState('')
  const {
    branding,
    update: updateBranding,
    reset: resetBranding,
  } = useBranding()
  const { host, update: updateHost, reset: resetHost } = useHostForm()
  const {
    override,
    update: updateOverride,
    reset: resetOverride,
  } = useConditionsOverrideForm()
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
          about,
          ...branding,
          ...hostBody(host),
          ...conditionsOverrideBody(override),
        },
        token,
      )
      setMsg({ text: 'Sublocation created!', ok: true })
      setName('')
      setDescription('')
      setStateId('')
      setAbout('')
      resetBranding()
      resetHost()
      resetOverride()
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
                <SelectField
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
              <AboutField value={about} onChange={setAbout} />
              <HostFields host={host} update={updateHost} />
              <ConditionsOverrideFields
                override={override}
                update={updateOverride}
              />
              <BrandingFields
                branding={branding}
                update={updateBranding}
                getToken={getToken}
              />
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

/* ──── Sublocation Row ──── */

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
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:px-5"
      style={staggerStyle(index)}
    >
      <Landmark size={18} className="text-accent" />
      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
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
  const [about, setAbout] = useState(sublocation.about)
  const { branding, update: updateBranding } = useBranding(sublocation)
  const { host, update: updateHost } = useHostForm(sublocation)
  const { override, update: updateOverride } =
    useConditionsOverrideForm(sublocation)
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
        {
          name,
          description,
          state_id: stateId,
          about,
          ...branding,
          ...hostBody(host),
          ...conditionsOverrideBody(override),
        },
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
        <SelectField
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
        <AboutField value={about} onChange={setAbout} />
        <HostFields host={host} update={updateHost} />
        <ConditionsOverrideFields override={override} update={updateOverride} />
        <BrandingFields
          branding={branding}
          update={updateBranding}
          getToken={getToken}
        />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}
