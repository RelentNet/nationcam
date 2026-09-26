import { useNavigate } from '@tanstack/react-router'
import { Radio, Search, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SearchableCamera } from '@/hooks/useCameraSearchIndex'
import { useCameraSearchIndex } from '@/hooks/useCameraSearchIndex'

interface CameraSearchProps {
  open: boolean
  onClose: () => void
}

const RESULT_LIMIT = 20

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Simple case-insensitive substring match — no fuzzy scoring, no dependency. */
function matches(camera: SearchableCamera, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack =
    `${camera.video.title} ${camera.video.sublocation_name} ${camera.video.state_name}`.toLowerCase()
  return haystack.includes(q)
}

/**
 * Sitewide Ctrl-K / Cmd-K camera search. Renders nothing until `open`, so it
 * touches `document`/`window` only from effects and the portal target — never
 * during render — which keeps it SSR-safe.
 */
export default function CameraSearch({ open, onClose }: CameraSearchProps) {
  const { cameras, loading, error, ensureLoaded } = useCameraSearchIndex()
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const navigate = useNavigate()
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(() => {
    if (!query.trim()) return cameras.slice(0, RESULT_LIMIT)
    return cameras.filter((c) => matches(c, query)).slice(0, RESULT_LIMIT)
  }, [cameras, query])

  // Fetch (and cache) the camera list the first time the dialog opens.
  useEffect(() => {
    if (open) ensureLoaded()
  }, [open, ensureLoaded])

  // Reset transient state and move focus into the input on open.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlighted(0)
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  // Keep the highlighted index in range as the result set changes.
  useEffect(() => {
    setHighlighted((prev) => Math.min(prev, Math.max(results.length - 1, 0)))
  }, [results.length])

  // Keep the highlighted row in view as arrow keys move past the fold.
  useEffect(() => {
    const item = listRef.current?.children[highlighted]
    if (item instanceof HTMLElement) item.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  // Lock page scroll while the dialog is open.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const goTo = useCallback(
    (camera: SearchableCamera) => {
      onClose()
      void navigate({
        to: '/locations/$slug/$sublocationSlug/$cameraSlug',
        params: {
          slug: camera.stateSlug,
          sublocationSlug: camera.sublocationSlug,
          cameraSlug: camera.video.slug,
        },
      })
    },
    [navigate, onClose],
  )

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((prev) =>
          results.length === 0 ? 0 : (prev + 1) % results.length,
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((prev) =>
          results.length === 0
            ? 0
            : (prev - 1 + results.length) % results.length,
        )
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (results.length > 0) goTo(results[highlighted])
        return
      }
      if (e.key === 'Tab') {
        // Focus trap: cycle Tab/Shift+Tab within the dialog instead of
        // letting it escape to the page behind.
        const container = dialogRef.current
        if (!container) return
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [results, highlighted, goTo, onClose],
  )

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-crust/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-overlay0 bg-surface0 shadow-2xl"
      >
        <h2 id={titleId} className="sr-only">
          Search cameras
        </h2>

        <div className="flex items-center gap-3 border-b border-overlay0 px-4 py-3">
          <Search size={18} className="shrink-0 text-subtext0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cameras by name or location..."
            aria-label="Search cameras"
            className="w-full bg-transparent font-sans text-sm text-text placeholder:text-overlay1 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 rounded-md p-1 text-subtext0 transition-colors hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        <ul ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
          {loading && cameras.length === 0 && (
            <li className="px-4 py-6 text-center font-mono text-xs text-subtext0">
              Loading cameras...
            </li>
          )}
          {!loading && error && cameras.length === 0 && (
            <li className="px-4 py-6 text-center font-mono text-xs text-subtext0">
              Couldn&apos;t load cameras. Try again.
            </li>
          )}
          {!loading && !error && cameras.length > 0 && results.length === 0 && (
            <li className="px-4 py-6 text-center font-mono text-xs text-subtext0">
              No cameras matching &ldquo;{query}&rdquo;
            </li>
          )}
          {results.map((camera, index) => (
            <li key={camera.video.video_id}>
              <button
                type="button"
                onClick={() => goTo(camera)}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors ${
                  index === highlighted
                    ? 'bg-accent/10 text-accent'
                    : 'text-text hover:bg-surface1'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {camera.video.status === 'active' && (
                    <Radio size={10} className="shrink-0 text-live" />
                  )}
                  {camera.video.title}
                </span>
                <span className="font-mono text-xs text-subtext0">
                  {camera.video.sublocation_name} &middot;{' '}
                  {camera.video.state_name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
