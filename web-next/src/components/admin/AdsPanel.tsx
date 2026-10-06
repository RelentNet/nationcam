import { useMemo, useState } from 'react'
import {
  Code,
  Film,
  Globe,
  Landmark,
  MapPin,
  Megaphone,
  Pencil,
  ShieldAlert,
  Trash2,
  Video as VideoIcon,
} from 'lucide-react'
import type {
  Ad,
  AdInput,
  AdPlacement,
  AdType,
  State,
  Sublocation,
  Video,
} from '@/lib/types'
import type { FormMsg, ScopeKind } from '@/components/dashboardUi'
import Field, { Input, Textarea } from '@/components/ui/Field'
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
  SelectField,
  StatusDot,
  ToggleRow,
  staggerStyle,
  toISO,
  toLocalInput,
  useAutoHide,
} from '@/components/dashboardUi'
import { createAd, deleteAd, updateAd } from '@/lib/api'

/* ════════════════════════════════════════════════
   Ads Panel — moved from routes/dashboard.tsx during
   the DAN-41 admin/owner console split.
   ════════════════════════════════════════════════ */

const AD_TYPE_OPTIONS = [
  { value: 'preroll_video', label: 'Pre-roll video' },
  { value: 'banner_html', label: 'Banner (HTML)' },
]

const SCOPE_OPTIONS = [
  { value: 'sublocation', label: 'Sublocation' },
  { value: 'state', label: 'State' },
  { value: 'camera', label: 'Camera' },
  { value: 'house', label: 'House (global)' },
]

const PLACEMENT_OPTIONS = [
  { value: 'left', label: 'Left rail' },
  { value: 'right', label: 'Right rail' },
  { value: 'mobile', label: 'Mobile' },
]

// One flat form model for both the create form and the edit modal. Weight is
// kept as a string so the number input can be temporarily empty; scope is a
// single `scopeKind` choice, which is what structurally enforces the backend's
// "at most one of state/sublocation/video" rule — buildAdInput only fills the
// column matching the chosen kind.
type AdFormState = {
  name: string
  type: AdType
  videoUrl: string
  htmlCode: string
  clickUrl: string
  placement: AdPlacement
  weight: string
  startsAt: string
  endsAt: string
  enabled: boolean
  isOverride: boolean
  scopeKind: ScopeKind
  stateId: number | ''
  sublocationId: number | ''
  videoId: number | ''
}

// Default the scope to Sublocation — the common workflow (cameras inherit).
function emptyAdForm(): AdFormState {
  return {
    name: '',
    type: 'preroll_video',
    videoUrl: '',
    htmlCode: '',
    clickUrl: '',
    placement: 'left',
    weight: '1',
    startsAt: '',
    endsAt: '',
    enabled: true,
    isOverride: false,
    scopeKind: 'sublocation',
    stateId: '',
    sublocationId: '',
    videoId: '',
  }
}

function adToForm(
  ad: Ad,
  sublocations: Array<Sublocation>,
  videos: Array<Video>,
): AdFormState {
  let scopeKind: ScopeKind = 'house'
  let stateId: number | '' = ''
  let sublocationId: number | '' = ''
  let videoId: number | '' = ''
  if (ad.video_id) {
    scopeKind = 'camera'
    videoId = ad.video_id
    // Back-fill the state filter so the camera dropdown is populated on open.
    stateId = videos.find((v) => v.video_id === ad.video_id)?.state_id ?? ''
  } else if (ad.sublocation_id) {
    scopeKind = 'sublocation'
    sublocationId = ad.sublocation_id
    stateId =
      sublocations.find((s) => s.sublocation_id === ad.sublocation_id)
        ?.state_id ?? ''
  } else if (ad.state_id) {
    scopeKind = 'state'
    stateId = ad.state_id
  }
  return {
    name: ad.name,
    type: ad.type,
    videoUrl: ad.video_url,
    htmlCode: ad.html_code,
    clickUrl: ad.click_url,
    placement: ad.placement || 'left',
    weight: String(ad.weight),
    startsAt: toLocalInput(ad.starts_at),
    endsAt: toLocalInput(ad.ends_at),
    enabled: ad.enabled,
    isOverride: ad.is_override,
    scopeKind,
    stateId,
    sublocationId,
    videoId,
  }
}

function validateAd(form: AdFormState): string | null {
  if (!form.name.trim()) return 'Name is required.'
  if (form.type === 'preroll_video' && !form.videoUrl.trim())
    return 'Video URL is required for a pre-roll ad.'
  if (form.type === 'banner_html' && !form.htmlCode.trim())
    return 'Banner HTML is required.'
  if (form.scopeKind === 'state' && form.stateId === '')
    return 'Select a state.'
  if (form.scopeKind === 'sublocation' && form.sublocationId === '')
    return 'Select a sublocation.'
  if (form.scopeKind === 'camera' && form.videoId === '')
    return 'Select a camera.'
  return null
}

function buildAdInput(form: AdFormState): AdInput {
  return {
    name: form.name.trim(),
    type: form.type,
    video_url: form.type === 'preroll_video' ? form.videoUrl.trim() : '',
    html_code: form.type === 'banner_html' ? form.htmlCode : '',
    click_url: form.clickUrl.trim(),
    placement: form.type === 'banner_html' ? form.placement : '',
    weight: Math.max(1, parseInt(form.weight, 10) || 1),
    starts_at: toISO(form.startsAt),
    ends_at: toISO(form.endsAt),
    enabled: form.enabled,
    is_override: form.isOverride,
    state_id: form.scopeKind === 'state' ? Number(form.stateId) : null,
    sublocation_id:
      form.scopeKind === 'sublocation' ? Number(form.sublocationId) : null,
    video_id: form.scopeKind === 'camera' ? Number(form.videoId) : null,
  }
}

export default function AdsPanel({
  ads: allAds,
  states,
  sublocations,
  videos,
  getToken,
  onSuccess,
  loading,
}: {
  ads: Array<Ad>
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  loading: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<AdFormState>(emptyAdForm)
  const update = (patch: Partial<AdFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const [confirmDelete, setConfirmDelete] = useState<{
    id: number
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<Ad | null>(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('a-z')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = [...allAds]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.state_name && a.state_name.toLowerCase().includes(q)) ||
          (a.sublocation_name &&
            a.sublocation_name.toLowerCase().includes(q)) ||
          (a.video_title && a.video_title.toLowerCase().includes(q)),
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
  }, [allAds, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const ads = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

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
      await deleteAd(confirmDelete.id, token)
      setConfirmDelete(null)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to delete ad.', ok: false })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateAd(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createAd(buildAdInput(form), token)
      setMsg({ text: 'Ad created successfully!', ok: true })
      setForm(emptyAdForm())
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to create ad.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="Ads"
          subtitle="Pre-roll videos and banner ads, targeted by scope"
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Add Ad"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AdFields
                form={form}
                update={update}
                states={states}
                sublocations={sublocations}
                videos={videos}
              />
              <FormFooter msg={msg} submitting={submitting} label="Add Ad" />
            </form>
          </CreatePanel>
        )}

        <DataList
          loading={loading}
          empty={allAds.length === 0}
          emptyIcon={Megaphone}
          emptyText="No ads yet"
          toolbar={
            !loading && allAds.length > 0 ? (
              <ListToolbar
                search={search}
                onSearchChange={handleSearch}
                sortKey={sortKey}
                onSortChange={handleSort}
                resultCount={total}
                label="ads"
                sortOptions={ENTITY_SORT_OPTIONS}
              />
            ) : undefined
          }
        >
          {total === 0 && search ? (
            <div className="py-8 text-center">
              <p className="mb-0 text-sm text-subtext0">
                No ads matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : (
            <>
              {ads.map((a, i) => (
                <AdRow
                  key={a.ad_id}
                  ad={a}
                  index={i}
                  onEdit={() => setEditing(a)}
                  onDelete={() =>
                    setConfirmDelete({ id: a.ad_id, name: a.name })
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
        <EditAdModal
          ad={editing}
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

/* ──── Ad Form Fields (shared by create + edit) ──── */

function AdFields({
  form,
  update,
  states,
  sublocations,
  videos,
}: {
  form: AdFormState
  update: (patch: Partial<AdFormState>) => void
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
}) {
  const filteredSubs = sublocations.filter((s) => s.state_id === form.stateId)
  const filteredVideos = videos.filter((v) => v.state_id === form.stateId)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          value={form.name}
          onChange={(v) => update({ name: v })}
          placeholder="e.g. Summer promo"
        />
        <SelectField
          label="Ad Type"
          options={AD_TYPE_OPTIONS}
          selectedValue={form.type}
          onSelect={(v) => update({ type: v as AdType })}
        />
      </div>

      {/* Type-specific fields */}
      {form.type === 'preroll_video' ? (
        <FormField
          label="Video URL (MP4)"
          value={form.videoUrl}
          onChange={(v) => update({ videoUrl: v })}
          placeholder="https://cdn.example.com/ad.mp4"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <Field label="Banner HTML / AdSense code">
            <Textarea
              value={form.htmlCode}
              onChange={(e) => update({ htmlCode: e.target.value })}
              rows={5}
              spellCheck={false}
              placeholder="<script async src=...></script>"
              className="font-mono text-xs"
            />
          </Field>
          <SelectField
            label="Placement"
            options={PLACEMENT_OPTIONS}
            selectedValue={form.placement}
            onSelect={(v) => update({ placement: v as AdPlacement })}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Click-through URL"
          value={form.clickUrl}
          onChange={(v) => update({ clickUrl: v })}
          placeholder="https://advertiser.example.com"
        />
        <Field label="Weight">
          <Input
            type="number"
            min={1}
            value={form.weight}
            onChange={(e) => update({ weight: e.target.value })}
          />
        </Field>
      </div>

      {/* Scope picker — at most one of state/sublocation/camera, or House */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Scope"
          options={SCOPE_OPTIONS}
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
          House ad — eligible everywhere, beaten by any more specific ad.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts at (optional)">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <ToggleRow
          label="Enabled"
          description="Serve this ad"
          checked={form.enabled}
          onChange={(v) => update({ enabled: v })}
        />
        <ToggleRow
          label="Global override"
          description="Beats all targeting for this ad type"
          checked={form.isOverride}
          onChange={(v) => update({ isOverride: v })}
          warning
        />
      </div>
    </div>
  )
}

/* ──── Ad Row ──── */

function adScopeLabel(ad: Ad): { label: string; icon: typeof Film } {
  if (ad.video_id)
    return { label: ad.video_title || `Camera #${ad.video_id}`, icon: Film }
  if (ad.sublocation_id)
    return {
      label: ad.sublocation_name || `Sublocation #${ad.sublocation_id}`,
      icon: Landmark,
    }
  if (ad.state_id)
    return { label: ad.state_name || `State #${ad.state_id}`, icon: MapPin }
  return { label: 'House', icon: Globe }
}

function adWindowLabel(ad: Ad): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  if (ad.starts_at && ad.ends_at)
    return `${fmt(ad.starts_at)} – ${fmt(ad.ends_at)}`
  if (ad.starts_at) return `from ${fmt(ad.starts_at)}`
  if (ad.ends_at) return `until ${fmt(ad.ends_at)}`
  return 'Always'
}

function AdRow({
  ad,
  index,
  onEdit,
  onDelete,
}: {
  ad: Ad
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  const isBanner = ad.type === 'banner_html'
  const scope = adScopeLabel(ad)
  const ScopeIcon = scope.icon

  return (
    <div
      className="group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:px-5"
      style={staggerStyle(index)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
        {isBanner ? (
          <Code size={18} className="text-accent" />
        ) : (
          <VideoIcon size={18} className="text-accent" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
          {ad.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
            {isBanner ? 'Banner' : 'Pre-roll'}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-px font-mono text-[11px] text-accent">
            <ScopeIcon size={11} />
            {scope.label}
          </span>
          {isBanner && ad.placement && (
            <span className="inline-flex shrink-0 items-center rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
              {ad.placement}
            </span>
          )}
          <span className="text-xs text-subtext0">{adWindowLabel(ad)}</span>
          <span className="font-mono text-[11px] text-overlay2">
            w:{ad.weight} &middot; {ad.impressions} imp &middot; {ad.clicks} clk
          </span>
        </div>
        {isBanner && ad.html_code && (
          // Rendered as escaped text (React auto-escapes), never as live markup.
          <code className="mt-1 block truncate font-mono text-[11px] text-overlay2">
            {ad.html_code}
          </code>
        )}
      </div>

      {ad.is_override && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-live/10 px-2 py-1 text-xs font-medium text-live">
          <ShieldAlert size={12} />
          <span className="hidden sm:inline">Override</span>
        </span>
      )}

      <StatusDot active={ad.enabled} label={ad.enabled ? 'On' : 'Off'} />

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

/* ──── Edit Ad Modal ──── */

function EditAdModal({
  ad,
  states,
  sublocations,
  videos,
  getToken,
  onSuccess,
  onClose,
}: {
  ad: Ad
  states: Array<State>
  sublocations: Array<Sublocation>
  videos: Array<Video>
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<AdFormState>(() =>
    adToForm(ad, sublocations, videos),
  )
  const update = (patch: Partial<AdFormState>) =>
    setForm((f) => ({ ...f, ...patch }))
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateAd(form)
    if (err) {
      setMsg({ text: err, ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateAd(ad.ad_id, buildAdInput(form), token)
      onSuccess()
    } catch {
      setMsg({ text: 'Failed to update ad.', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Edit Ad" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <AdFields
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
