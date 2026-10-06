import { useEffect, useId, useState } from 'react'
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Branding } from '@/lib/types'
import { uploadAsset } from '@/lib/api'
import Dropdown from '@/components/Dropdown'
import Button from '@/components/Button'
import Field, { Input, Textarea } from '@/components/ui/Field'

/* ════════════════════════════════════════════════
   Shared dashboard primitives — used by both the
   dashboard panels (routes/dashboard.tsx) and the
   admin submissions inbox (components/SubmissionsInbox.tsx).
   ════════════════════════════════════════════════ */

export const PER_PAGE = 20

export const ENTITY_SORT_OPTIONS: Array<{
  value: string
  label: string
  icon: LucideIcon
}> = [
  { value: 'a-z', label: 'A→Z', icon: ArrowDownAZ },
  { value: 'z-a', label: 'Z→A', icon: ArrowUpAZ },
  { value: 'newest', label: 'Newest', icon: CalendarArrowDown },
  { value: 'oldest', label: 'Oldest', icon: CalendarArrowUp },
]

/* ──── Form message + auto-hide ──── */

export type FormMsg = { text: string; ok: boolean } | null

export function useAutoHide(msg: FormMsg, setMsg: (m: FormMsg) => void) {
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 5000)
    return () => clearTimeout(t)
  }, [msg, setMsg])
}

export function StatusBanner({ msg }: { msg: FormMsg }) {
  if (!msg) return null
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
        msg.ok ? 'bg-teal/10 text-teal' : 'bg-live/10 text-live'
      }`}
      style={{
        opacity: 0,
        animation: 'scale-fade-in 250ms var(--spring-poppy) forwards',
      }}
    >
      {msg.ok ? <Check size={15} /> : <AlertCircle size={15} />}
      {msg.text}
    </div>
  )
}

/* ──── Panel header (read-only, no create action) ──── */

export function PanelHeaderStatic({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <h3 className="!mb-0 !text-lg font-display font-bold sm:!text-xl">
        {title}
      </h3>
      <p className="mb-0 text-xs text-subtext0 sm:text-sm">{subtitle}</p>
    </div>
  )
}

/* ──── Data list (list container + skeleton + empty state) ──── */

export function DataList({
  loading,
  empty,
  emptyIcon: EmptyIcon,
  emptyText,
  toolbar,
  children,
}: {
  loading: boolean
  empty: boolean
  emptyIcon: LucideIcon
  emptyText: string
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-overlay0/60 bg-surface0">
      {toolbar}
      {loading ? (
        <ListSkeleton />
      ) : empty ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface1">
            <EmptyIcon size={22} className="text-subtext0" />
          </div>
          <p className="mb-0 max-w-[220px] text-sm text-subtext0">
            {emptyText}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-overlay0">{children}</div>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-overlay0/40">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-surface1" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-surface1" />
            <div className="h-3 w-24 animate-pulse rounded bg-surface1" />
          </div>
          <div className="h-6 w-16 animate-pulse rounded-md bg-surface1" />
        </div>
      ))}
    </div>
  )
}

/* ──── List toolbar (search + sort) ──── */

export function ListToolbar({
  search,
  onSearchChange,
  sortKey,
  onSortChange,
  resultCount,
  label,
  sortOptions,
}: {
  search: string
  onSearchChange: (v: string) => void
  sortKey: string
  onSortChange: (v: string) => void
  resultCount: number
  label: string
  sortOptions: Array<{ value: string; label: string; icon: LucideIcon }>
}) {
  return (
    <div className="flex items-center gap-2 border-b border-overlay0/30 px-4 py-2.5 sm:px-5">
      {/* Search */}
      <div className="relative min-w-0 flex-1">
        <Search
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-overlay2"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={`Search ${label}...`}
          className="w-full rounded-lg border border-overlay0/50 bg-base py-1.5 pr-7 pl-8 text-xs text-text placeholder:text-overlay1 transition-colors duration-150 focus:border-accent focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-overlay2 hover:text-text"
            aria-label="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-0.5 rounded-lg border border-overlay0/50 bg-base p-0.5">
        {sortOptions.map((opt) => {
          const Icon = opt.icon
          const isActive = sortKey === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSortChange(opt.value)}
              className={`flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] transition-colors duration-150 ${
                isActive
                  ? 'bg-accent/12 text-accent'
                  : 'text-overlay2 hover:text-text'
              }`}
              title={`Sort: ${opt.label}`}
            >
              <Icon size={11} />
              <span className="hidden lg:inline">{opt.label}</span>
            </button>
          )
        })}
      </div>

      {/* Count */}
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-overlay2">
        {resultCount}
      </span>
    </div>
  )
}

/* ──── Pagination bar ──── */

export function PaginationBar({
  page,
  perPage,
  total,
  onPageChange,
}: {
  page: number
  perPage: number
  total: number
  onPageChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / perPage)
  if (totalPages <= 1) return null

  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, total)

  return (
    <div className="flex items-center justify-between border-t border-overlay0/30 px-4 py-2.5 sm:px-5">
      <p className="mb-0 font-mono text-xs text-subtext0">
        {from}&ndash;{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtext0 transition-colors duration-150 hover:bg-surface1 disabled:pointer-events-none disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="min-w-[3rem] px-1 text-center font-mono text-xs text-subtext0">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtext0 transition-colors duration-150 hover:bg-surface1 disabled:pointer-events-none disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

/* ──── Utilities ──── */

export function staggerStyle(index: number): React.CSSProperties | undefined {
  if (index >= 10) return undefined
  return {
    opacity: 0,
    animation: `fade-in-up 350ms var(--spring-smooth) ${index * 40}ms forwards`,
  }
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/* ════════════════════════════════════════════════
   Shared — Panel header, create panel, form
   primitives, dialogs. Moved from routes/dashboard.tsx
   during the DAN-41 admin/owner console split — used by
   the admin panels (components/admin/) and, where noted,
   the owner panels (components/owner/).
   ════════════════════════════════════════════════ */

/** Structurally enforces "at most one of state/sublocation/camera" for a
 *  scoped row (ads, notes) — 'house' means unscoped/global. */
export type ScopeKind = 'house' | 'state' | 'sublocation' | 'camera'

export function PanelHeader({
  title,
  subtitle,
  showCreate,
  onToggleCreate,
  createLabel,
}: {
  title: string
  subtitle: string
  showCreate: boolean
  onToggleCreate: () => void
  createLabel: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="!mb-0 !text-lg font-display font-bold sm:!text-xl">
          {title}
        </h3>
        <p className="mb-0 text-xs text-subtext0 sm:text-sm">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onToggleCreate}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 ease-[var(--spring-snappy)] ${
          showCreate
            ? 'border border-overlay0 bg-surface1 text-subtext0 hover:text-text'
            : 'bg-accent/10 text-accent hover:bg-accent/20'
        }`}
      >
        {showCreate ? (
          <>
            <X size={15} />
            <span className="hidden sm:inline">Cancel</span>
          </>
        ) : (
          <>
            <Plus size={15} />
            <span className="hidden sm:inline">{createLabel}</span>
          </>
        )}
      </button>
    </div>
  )
}

export function CreatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-overlay0/60 bg-surface0"
      style={{
        opacity: 0,
        animation: 'scale-fade-in 280ms var(--spring-poppy) forwards',
      }}
    >
      <div className="h-px bg-gradient-to-r from-accent/40 via-accent/15 to-transparent" />
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  )
}

// AboutField is the editorial-copy textarea shared by the state, sublocation and
// camera forms. The hint spells out the light markdown EditorialText renders —
// anything else (including pasted HTML) comes out as plain text on the page.
export function AboutField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field
      label="About (editorial)"
      hint={
        <>
          Formatting: <code>## Heading</code>, a blank line between paragraphs,{' '}
          <code>- </code> for bullets.
        </>
      }
    >
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        placeholder="Shown as an “About” section on the public page. Leave blank for no section."
      />
    </Field>
  )
}

export function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number' | 'date' | 'url'
}) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  )
}

export function FormFooter({
  msg,
  submitting,
  label,
}: {
  msg: FormMsg
  submitting: boolean
  label: string
}) {
  return (
    <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1">{msg && <StatusBanner msg={msg} />}</div>
      <Button type="submit" disabled={submitting} className="shrink-0">
        {submitting && <Loader2 size={15} className="animate-spin" />}
        {submitting ? 'Saving...' : label}
      </Button>
    </div>
  )
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  warning = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  warning?: boolean
}) {
  const on = warning
    ? 'border-live/50 bg-live/10'
    : 'border-accent/40 bg-accent/8'
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors duration-150 ${
        checked ? on : 'border-overlay0 bg-base'
      }`}
    >
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-text">
          {warning && <ShieldAlert size={14} className="text-live" />}
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-subtext0">
          {description}
        </span>
      </div>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${
          checked ? (warning ? 'bg-live' : 'bg-accent') : 'bg-surface2'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

export function StatusDot({
  active,
  label,
}: {
  active: boolean
  label: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
        active ? 'bg-teal/10 text-teal' : 'bg-surface1 text-subtext0'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${active ? 'bg-teal' : 'bg-overlay2'}`}
        style={
          active
            ? { animation: 'pulse-live 2s ease-in-out infinite' }
            : undefined
        }
      />
      {label}
    </span>
  )
}

export function ActionBtn({
  icon: Icon,
  onClick,
  label,
  variant = 'default',
}: {
  icon: LucideIcon
  onClick: () => void
  label: string
  variant?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-subtext0 transition-colors duration-150 ${
        variant === 'danger'
          ? 'hover:bg-live/10 hover:text-live'
          : 'hover:bg-accent/10 hover:text-accent'
      }`}
      title={label}
      aria-label={label}
    >
      <Icon size={15} />
    </button>
  )
}

export function ConfirmDeleteDialog({
  name,
  deleting,
  onConfirm,
  onCancel,
}: {
  name: string
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="mx-4 w-full max-w-sm overflow-hidden rounded-2xl border border-overlay0 bg-surface0 shadow-2xl"
        style={{
          opacity: 0,
          animation: 'scale-fade-in 250ms var(--spring-poppy) forwards',
        }}
      >
        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-live/10">
              <Trash2 size={18} className="text-live" />
            </div>
            <div>
              <h5 className="mb-0 !text-base font-semibold text-text">
                Confirm Delete
              </h5>
              <p className="mb-0 text-xs text-subtext0">
                This cannot be undone.
              </p>
            </div>
          </div>
          <p className="mb-5 text-sm text-subtext1">
            Delete <span className="font-semibold text-text">{name}</span>?
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="flex-1 rounded-lg border border-overlay0 bg-surface1 px-4 py-2.5 text-sm font-medium text-text transition-colors duration-150 hover:bg-surface2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deleting}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-live px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 hover:bg-live/90 active:scale-[0.97] disabled:opacity-60"
            >
              {deleting && <Loader2 size={14} className="animate-spin" />}
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        className={`w-full overflow-hidden rounded-2xl border border-overlay0 bg-surface0 shadow-2xl ${
          wide ? 'max-w-2xl' : 'max-w-md'
        }`}
        style={{
          opacity: 0,
          animation: 'scale-fade-in 250ms var(--spring-poppy) forwards',
        }}
      >
        <div className="flex items-center justify-between border-b border-overlay0/50 px-5 py-4">
          <h5 className="mb-0 !text-base font-display font-semibold text-text">
            {title}
          </h5>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtext0 transition-colors duration-150 hover:bg-surface1 hover:text-text"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

/* ──── datetime helpers (datetime-local <-> RFC3339), shared by
   the Ads and Events panels ──── */

// datetime-local gives 'YYYY-MM-DDTHH:mm' in local time; the API wants RFC3339.
export function toISO(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ──── Branding fields (shared by the States and Sublocations panels,
   create + edit) ──── */

export const HERO_KIND_OPTIONS = [
  { value: 'video', label: 'Video URL' },
  { value: 'image', label: 'Image upload' },
]

export const emptyBranding: Branding = {
  hero_url: '',
  hero_kind: 'video',
  logo_url: '',
  sponsor_url: '',
  sponsor_link: '',
  title_url: '',
  tourism_name: '',
  tourism_url: '',
}

// useBranding holds the five branding fields for a form, seeded from an existing
// row (edit) or blank (create).
export function useBranding(initial?: Partial<Branding>) {
  // Pick only the branding keys. Callers pass a whole State/Sublocation row,
  // and spreading it wholesale would carry name/about/upcoming/... into
  // `branding`, which the edit forms spread LAST on submit — silently
  // overwriting the user's edits with the row's old values.
  const [branding, setBranding] = useState<Branding>(() => {
    const picked: Record<string, unknown> = {}
    for (const k of Object.keys(emptyBranding)) {
      if (initial && k in initial) picked[k] = initial[k as keyof Branding]
    }
    return { ...emptyBranding, ...(picked as Partial<Branding>) }
  })
  const update = (patch: Partial<Branding>) =>
    setBranding((b) => ({ ...b, ...patch }))
  const reset = () => setBranding(emptyBranding)
  return { branding, update, reset }
}

// UploadField uploads a single image to local object storage and stores the
// returned URL. Empty means "use the site default".
export function UploadField({
  label,
  value,
  onChange,
  getToken,
}: {
  label: string
  value: string
  onChange: (url: string) => void
  getToken: () => Promise<string | null>
}) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setErr(null)
    try {
      const token = await getToken()
      const { url } = await uploadAsset(file, token)
      onChange(url)
    } catch {
      setErr('Upload failed — images only, max 10MB.')
    } finally {
      setUploading(false)
      e.target.value = '' // let the same file be re-picked after a failure
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-subtext0">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {value && (
          <img
            src={value}
            alt=""
            className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-overlay0"
          />
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFile}
          disabled={uploading}
          className="w-full text-xs text-subtext0 file:mr-3 file:rounded-lg file:border-0 file:bg-surface0 file:px-3 file:py-2 file:text-xs file:font-medium file:text-text hover:file:bg-surface1"
        />
        {uploading && (
          <Loader2 size={15} className="shrink-0 animate-spin text-subtext0" />
        )}
        {value && !uploading && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="shrink-0 text-xs text-subtext0 transition-colors hover:text-live"
          >
            Clear
          </button>
        )}
      </div>
      {err && <p className="mt-1 mb-0 text-xs text-live">{err}</p>}
    </div>
  )
}

// BrandingFields renders the hero/logo/sponsor editor. Hero is either an uploaded
// image or a pasted video URL; switching modes clears hero_url so an image path
// is never sent as a video URL (or vice versa).
export function BrandingFields({
  branding,
  update,
  getToken,
}: {
  branding: Branding
  update: (patch: Partial<Branding>) => void
  getToken: () => Promise<string | null>
}) {
  return (
    <div className="space-y-4 rounded-lg border border-overlay0/60 bg-base/40 p-4">
      <p className="mb-0 text-xs font-semibold tracking-wide text-subtext0 uppercase">
        Branding
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Dropdown
          label="Hero type"
          options={HERO_KIND_OPTIONS}
          selectedValue={branding.hero_kind}
          onSelect={(v) =>
            update({ hero_kind: v as Branding['hero_kind'], hero_url: '' })
          }
        />
        {branding.hero_kind === 'video' ? (
          <FormField
            label="Hero video URL"
            value={branding.hero_url}
            onChange={(v) => update({ hero_url: v })}
            placeholder="https://cdn.example.com/hero.mp4 (blank = default)"
          />
        ) : (
          <UploadField
            label="Hero image"
            value={branding.hero_url}
            onChange={(v) => update({ hero_url: v })}
            getToken={getToken}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <UploadField
          label="Logo (round)"
          value={branding.logo_url}
          onChange={(v) => update({ logo_url: v })}
          getToken={getToken}
        />
        <UploadField
          label="Title image (replaces the name in the hero)"
          value={branding.title_url}
          onChange={(v) => update({ title_url: v })}
          getToken={getToken}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <UploadField
          label="Sponsor button image"
          value={branding.sponsor_url}
          onChange={(v) => update({ sponsor_url: v })}
          getToken={getToken}
        />
        <FormField
          label="Sponsor link URL"
          value={branding.sponsor_link}
          onChange={(v) => update({ sponsor_link: v })}
          placeholder="https://sponsor.example.com"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Tourism site name"
          value={branding.tourism_name}
          onChange={(v) => update({ tourism_name: v })}
          placeholder="Explore Louisiana"
        />
        <FormField
          label="Tourism site URL (a location inherits its state's when empty)"
          value={branding.tourism_url}
          onChange={(v) => update({ tourism_url: v })}
          placeholder="https://www.explorelouisiana.com"
        />
      </div>
    </div>
  )
}
