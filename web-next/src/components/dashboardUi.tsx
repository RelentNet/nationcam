import { useEffect } from 'react'
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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
