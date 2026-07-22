import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Search,
  X,
} from 'lucide-react'
import { useRef } from 'react'

export type SortOption = 'a-z' | 'z-a' | 'newest' | 'oldest'

interface CameraToolbarProps {
  /** Current search query (controlled) */
  search: string
  /** Called when search changes */
  onSearchChange: (value: string) => void
  /** Current sort (controlled) */
  sort: SortOption
  /** Called when sort changes */
  onSortChange: (value: SortOption) => void
  /** Total number of results after filtering */
  resultCount: number
  /** Label for what's being shown (e.g. "cameras", "streams") */
  label?: string
}

const SORT_OPTIONS: Array<{
  value: SortOption
  label: string
  icon: typeof ArrowDownAZ
}> = [
  { value: 'a-z', label: 'A \u2192 Z', icon: ArrowDownAZ },
  { value: 'z-a', label: 'Z \u2192 A', icon: ArrowUpAZ },
  { value: 'newest', label: 'Newest', icon: CalendarArrowDown },
  { value: 'oldest', label: 'Oldest', icon: CalendarArrowUp },
]

export default function CameraToolbar({
  search,
  onSearchChange,
  sort,
  onSortChange,
  resultCount,
  label = 'cameras',
}: CameraToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      {/* Search input */}
      <div className="relative flex-1">
        <Search
          size={15}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtext0"
        />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={`Search ${label}...`}
          className="w-full rounded-xl border border-overlay0 bg-surface0 py-2.5 pr-9 pl-10 font-sans text-sm text-text placeholder:text-overlay2 transition-[border-color,box-shadow] duration-200 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              onSearchChange('')
              inputRef.current?.focus()
            }}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-0.5 text-subtext0 transition-colors hover:text-text"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Sort buttons */}
      <div className="flex items-center gap-1 rounded-xl border border-overlay0 bg-surface0 p-1">
        {SORT_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const isActive = sort === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSortChange(opt.value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs transition-all duration-200 ${
                isActive
                  ? 'bg-accent/12 text-accent shadow-sm'
                  : 'text-subtext0 hover:bg-surface1 hover:text-text'
              }`}
              aria-label={`Sort ${opt.label}`}
              title={`Sort ${opt.label}`}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          )
        })}
      </div>

      {/* Result count */}
      <span className="shrink-0 font-mono text-xs tabular-nums text-subtext0">
        {resultCount} {resultCount === 1 ? label.replace(/s$/, '') : label}
      </span>
    </div>
  )
}
