import { useMemo, useState } from 'react'
import { MapPin, Pencil, Trash2 } from 'lucide-react'
import type { State } from '@/lib/types'
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
  ToggleRow,
  staggerStyle,
  timeAgo,
  useAutoHide,
  useBranding,
} from '@/components/dashboardUi'
import { createState, deleteState, updateState } from '@/lib/api'

/* ════════════════════════════════════════════════
   States Panel — moved from routes/dashboard.tsx
   during the DAN-41 admin/owner console split.
   ════════════════════════════════════════════════ */

export default function StatesPanel({
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
  const [about, setAbout] = useState('')
  const [upcoming, setUpcoming] = useState(false)
  const {
    branding,
    update: updateBranding,
    reset: resetBranding,
  } = useBranding()
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
      await createState(
        {
          name,
          description: description || undefined,
          about,
          upcoming,
          ...branding,
        },
        token,
      )
      setMsg({ text: 'State created!', ok: true })
      setName('')
      setDescription('')
      setAbout('')
      setUpcoming(false)
      resetBranding()
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
              <AboutField value={about} onChange={setAbout} />
              <ToggleRow
                label="Upcoming — a camera is confirmed for this state"
                description="Shows the state prominently on /locations before its first camera goes live."
                checked={upcoming}
                onChange={setUpcoming}
              />
              <BrandingFields
                branding={branding}
                update={updateBranding}
                getToken={getToken}
              />
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

/* ──── State Row ──── */

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
  const [about, setAbout] = useState(state.about)
  const [upcoming, setUpcoming] = useState(state.upcoming)
  const { branding, update: updateBranding } = useBranding(state)
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
      await updateState(
        state.state_id,
        { name, description, about, upcoming, ...branding },
        token,
      )
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
        <AboutField value={about} onChange={setAbout} />
        <ToggleRow
          label="Upcoming — a camera is confirmed for this state"
          description="Shows the state prominently on /locations before its first camera goes live."
          checked={upcoming}
          onChange={setUpcoming}
        />
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
