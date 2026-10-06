import { useMemo, useState } from 'react'
import {
  Film,
  Globe,
  Landmark,
  MapPin,
  Newspaper,
  Pencil,
  Trash2,
} from 'lucide-react'
import type {
  AdminPost,
  PostInput,
  PostStatus,
  State,
  Sublocation,
  Video,
} from '@/lib/types'
import type { FormMsg, ScopeKind } from '@/components/dashboardUi'
import Field, { Textarea } from '@/components/ui/Field'
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
  ToggleRow,
  UploadField,
  staggerStyle,
  useAutoHide,
} from '@/components/dashboardUi'
import { createPost, deletePost, updatePost } from '@/lib/api'

/* ════════════════════════════════════════════════
   Notes Panel (Field notes) — moved from
   routes/dashboard.tsx during the DAN-41 admin/owner
   console split.
   ════════════════════════════════════════════════ */

// Same scope shape as ads (state/sublocation/camera, at most one), reworded
// for a post that need not be attached to anything.
const POST_SCOPE_OPTIONS = [
  { value: 'sublocation', label: 'Sublocation' },
  { value: 'state', label: 'State' },
  { value: 'camera', label: 'Camera' },
  { value: 'house', label: 'None (unscoped)' },
]

// One flat form model for both the create form and the edit modal — same
// shape and reasoning as AdFormState: scopeKind structurally enforces "at
// most one of state/sublocation/video", and buildPostInput only fills the
// column matching the chosen kind.
type PostFormState = {
  title: string
  bodyMd: string
  excerpt: string
  coverUrl: string
  status: PostStatus
  scopeKind: ScopeKind
  stateId: number | ''
  sublocationId: number | ''
  videoId: number | ''
}

function emptyPostForm(): PostFormState {
  return {
    title: '',
    bodyMd: '',
    excerpt: '',
    coverUrl: '',
    status: 'draft',
    scopeKind: 'house',
    stateId: '',
    sublocationId: '',
    videoId: '',
  }
}

// postToForm seeds the edit form from only the fields it needs — never the
// whole row — so a stale copy of e.g. state_name can never leak back into
// buildPostInput on submit (see 2bf88a6, the ads/branding version of this bug).
function postToForm(
  postRow: AdminPost,
  sublocations: Array<Sublocation>,
  videos: Array<Video>,
): PostFormState {
  let scopeKind: ScopeKind = 'house'
  let stateId: number | '' = ''
  let sublocationId: number | '' = ''
  let videoId: number | '' = ''
  if (postRow.video_id) {
    scopeKind = 'camera'
    videoId = postRow.video_id
    // Back-fill the state filter so the camera dropdown is populated on open.
    stateId =
      videos.find((v) => v.video_id === postRow.video_id)?.state_id ?? ''
  } else if (postRow.sublocation_id) {
    scopeKind = 'sublocation'
    sublocationId = postRow.sublocation_id
    stateId =
      sublocations.find((s) => s.sublocation_id === postRow.sublocation_id)
        ?.state_id ?? ''
  } else if (postRow.state_id) {
    scopeKind = 'state'
    stateId = postRow.state_id
  }
  return {
    title: postRow.title,
    bodyMd: postRow.body_md,
    excerpt: postRow.excerpt,
    coverUrl: postRow.cover_url,
    status: postRow.status,
    scopeKind,
    stateId,
    sublocationId,
    videoId,
  }
}

function validatePost(form: PostFormState): string | null {
  if (!form.title.trim()) return 'Title is required.'
  if (form.scopeKind === 'state' && form.stateId === '')
    return 'Select a state.'
  if (form.scopeKind === 'sublocation' && form.sublocationId === '')
    return 'Select a sublocation.'
  if (form.scopeKind === 'camera' && form.videoId === '')
    return 'Select a camera.'
  return null
}

function buildPostInput(form: PostFormState): PostInput {
  return {
    title: form.title.trim(),
    body_md: form.bodyMd,
    excerpt: form.excerpt.trim(),
    cover_url: form.coverUrl,
    status: form.status,
    state_id: form.scopeKind === 'state' ? Number(form.stateId) : null,
    sublocation_id:
      form.scopeKind === 'sublocation' ? Number(form.sublocationId) : null,
    video_id: form.scopeKind === 'camera' ? Number(form.videoId) : null,
  }
}

export default function NotesPanel({
  posts: allPosts,
  states,
  sublocations,
  videos,
  getToken,
  onSuccess,
  loading,
}: {
  posts: Array<AdminPost>
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<PostFormState>(emptyPostForm)
  const update = (patch: Partial<PostFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    title: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<AdminPost | null>(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('newest')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = [...allPosts]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.state_name && p.state_name.toLowerCase().includes(q)) ||
          (p.sublocation_name &&
            p.sublocation_name.toLowerCase().includes(q)) ||
          (p.video_title && p.video_title.toLowerCase().includes(q)),
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
  }, [allPosts, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const posts = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

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
      await deletePost(confirmDelete.id, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete note.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validatePost(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createPost(buildPostInput(form), token)
      setMsg({ text: 'Note created successfully!', ok: true })
      setForm(emptyPostForm())
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to create note.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="Notes"
          subtitle="Field notes — written in markdown, published at /notes"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Note"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <PostFields
                form={form}
                update={update}
                states={states}
                sublocations={sublocations}
                videos={videos}
                getToken={getToken}
              />
              <FormFooter msg={msg} submitting={submitting} label="Add Note" />
            </form>
          </CreatePanel>
        )}

        <DataList
          loading={loading}
          empty={allPosts.length === 0}
          emptyIcon={Newspaper}
          emptyText="No field notes yet"
          toolbar={
            !loading && allPosts.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="notes"
                sortOptions={ENTITY_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No notes matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {posts.map((p, i) => (
                <PostRow
                  key={p.post_id}
                  post={p}
                  index={i}
                  onEdit={() => setEditing(p)}
                  onDelete={() =>
                    setConfirmDelete({ id: p.post_id, title: p.title })
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
        <EditPostModal
          post={editing}
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

/* ──── Note Form Fields (shared by create + edit) ──── */

function PostFields({
  form,
  update,
  states,
  sublocations,
  videos,
  getToken,
}: {
  form: PostFormState
  update: (patch: Partial<PostFormState>) => void
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
}) {
  const filteredSubs = sublocations.filter((s) => s.state_id === form.stateId)
  const filteredVideos = videos.filter((v) => v.state_id === form.stateId)

  return (
    <div className="space-y-4">
      <FormField
        label="Title"
        value={form.title}
        onChange={(v) => update({ title: v })}
        placeholder="e.g. Shrimp boats return to Venice"
      />

      <UploadField
        label="Cover image"
        value={form.coverUrl}
        onChange={(v) => update({ coverUrl: v })}
        getToken={getToken}
      />

      <Field label="Excerpt">
        <Textarea
          value={form.excerpt}
          onChange={(e) => update({ excerpt: e.target.value })}
          rows={3}
          placeholder="One or two sentences shown on the /notes list and article header."
        />
      </Field>

      <AboutField value={form.bodyMd} onChange={(v) => update({ bodyMd: v })} />

      {/* Scope picker — at most one of state/sublocation/camera, or unscoped */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Attach to"
          options={POST_SCOPE_OPTIONS}
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
          <SelectField
            label={form.scopeKind === 'state' ? 'State' : 'State (filter)'}
            options={states.map((s) => ({ value: s.state_id, label: s.name }))}
            selectedValue={form.stateId}
            onSelect={(v) =>
              update({ stateId: Number(v), sublocationId: '', videoId: '' })
            }
          />
        )}
        {form.scopeKind === 'sublocation' && form.stateId !== '' && (
          <SelectField
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
          <SelectField
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
          Unscoped — shown only in the main /notes feed, not on any
          camera/sublocation/state page.
        </p>
      )}

      <ToggleRow
        label="Published"
        description="Visible at /notes. Leave off to keep working as a draft."
        checked={form.status === 'published'}
        onChange={(v) => update({ status: v ? 'published' : 'draft' })}
      />
    </div>
  )
}

/* ──── Note Row ──── */

function postScopeLabel(postRow: AdminPost): {
  label: string
  icon: typeof Film
} {
  if (postRow.video_id)
    return {
      label: postRow.video_title || `Camera #${postRow.video_id}`,
      icon: Film,
    }
  if (postRow.sublocation_id)
    return {
      label:
        postRow.sublocation_name || `Sublocation #${postRow.sublocation_id}`,
      icon: Landmark,
    }
  if (postRow.state_id)
    return {
      label: postRow.state_name || `State #${postRow.state_id}`,
      icon: MapPin,
    }
  return { label: 'Unscoped', icon: Globe }
}

function publishedLabel(postRow: AdminPost): string {
  if (postRow.status !== 'published' || !postRow.published_at)
    return 'Not published'
  return new Date(postRow.published_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function PostRow({
  post: postRow,
  index,
  onEdit,
  onDelete,
}: {
  post: AdminPost
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  const scope = postScopeLabel(postRow)
  const ScopeIcon = scope.icon
  const isPublished = postRow.status === 'published'

  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:px-5"
      style={staggerStyle(index)}
    >
      <Newspaper size={18} className="text-accent" />

      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
          {postRow.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-px font-mono text-[11px] text-accent">
            <ScopeIcon size={11} />
            {scope.label}
          </span>
          <span className="text-xs text-subtext0">
            {publishedLabel(postRow)}
          </span>
        </div>
      </div>

      <StatusDot
        active={isPublished}
        label={isPublished ? 'Published' : 'Draft'}
      />

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

/* ──── Edit Note Modal ──── */

function EditPostModal({
  post: postRow,
  states,
  sublocations,
  videos,
  getToken,
  onSuccess,
  onClose,
}: {
  post: AdminPost
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<PostFormState>(() =>
    postToForm(postRow, sublocations, videos),
  )
  const update = (patch: Partial<PostFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validatePost(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updatePost(postRow.post_id, buildPostInput(form), token)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update note.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit Note" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <PostFields
          form={form}
          update={update}
          states={states}
          sublocations={sublocations}
          videos={videos}
          getToken={getToken}
        />
        <FormFooter msg={msg} submitting={submitting} label="Save Changes" />
      </form>
    </ModalShell>
  )
}
