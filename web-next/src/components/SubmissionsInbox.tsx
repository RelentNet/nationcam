import { useEffect, useMemo, useState } from 'react'
import { Check, Inbox, Loader2, Mail } from 'lucide-react'
import type { Submission } from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import { useAuth } from '@/hooks/useAuth'
import { fetchSubmissions, markSubmissionHandled } from '@/lib/api'
import {
  DataList,
  ENTITY_SORT_OPTIONS,
  ListToolbar,
  PER_PAGE,
  PaginationBar,
  PanelHeaderStatic,
  StatusBanner,
  staggerStyle,
  timeAgo,
  useAutoHide,
} from '@/components/dashboardUi'

/* ════════════════════════════════════════════════
   Submissions Inbox (contact / "Add Your Camera")

   Self-contained, admin-only inbox. Fetches its own
   submissions on mount and holds its own search /
   sort / pagination / toggle state. Lives on the
   admin console — submissions carry names, emails and
   addresses, so this must render ONLY for admins
   (see routes/admin.tsx). The backend already enforces
   admin-only access to the submissions API.
   ════════════════════════════════════════════════ */

export default function SubmissionsInbox() {
  const { getToken } = useAuth()

  const [allSubmissions, setAllSubmissions] = useState<Array<Submission>>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)
  const [toggling, setToggling] = useState<number | null>(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('newest')
  const [page, setPage] = useState(1)

  // Load submissions. `loading` is only set true initially, so re-running this
  // after a toggle refreshes the list without a skeleton flash.
  const load = async () => {
    try {
      const token = await getToken()
      const data = await fetchSubmissions(token)
      setAllSubmissions(Array.isArray(data) ? data : [])
    } catch {
      setAllSubmissions([])
    } finally {
      setLoading(false)
    }
  }

  // Fetch once on mount. Empty deps (matching the dashboard pattern) avoids the
  // Logto isLoading-flicker loop: getToken's identity changes when the SDK
  // toggles isLoading, so re-running on it would refetch endlessly.
  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    let result = [...allSubmissions]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.message.toLowerCase().includes(q),
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
  }, [allSubmissions, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const submissions = filtered.slice(
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

  const handleToggle = async (s: Submission) => {
    setToggling(s.submission_id)
    try {
      const token = await getToken()
      await markSubmissionHandled(s.submission_id, !s.handled, token)
      await load()
    } catch {
      setMsg({ text: 'Failed to update submission.', ok: false })
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="space-y-4">
      <PanelHeaderStatic
        title="Inbox"
        subtitle="Contact and camera-hosting form submissions"
      />

      <DataList
        loading={loading}
        empty={allSubmissions.length === 0}
        emptyIcon={Inbox}
        emptyText="No submissions yet"
        toolbar={
          !loading && allSubmissions.length > 0 ? (
            <ListToolbar
              search={search}
              onSearchChange={handleSearch}
              sortKey={sortKey}
              onSortChange={handleSort}
              resultCount={total}
              label="submissions"
              sortOptions={ENTITY_SORT_OPTIONS}
            />
          ) : undefined
        }
      >
        {total === 0 && search ? (
          <div className="py-8 text-center">
            <p className="mb-0 text-sm text-subtext0">
              No submissions matching &ldquo;{search}&rdquo;
            </p>
          </div>
        ) : (
          <>
            {submissions.map((s, i) => (
              <SubmissionRow
                key={s.submission_id}
                submission={s}
                index={i}
                toggling={toggling === s.submission_id}
                onToggle={() => handleToggle(s)}
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

      {msg && <StatusBanner msg={msg} />}
    </div>
  )
}

/* ──── Submission Row ──── */

function SubmissionRow({
  submission: s,
  index,
  toggling,
  onToggle,
}: {
  submission: Submission
  index: number
  toggling: boolean
  onToggle: () => void
}) {
  return (
    <div
      className="flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface1/50 sm:flex-row sm:items-start sm:gap-4 sm:px-5"
      style={staggerStyle(index)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
        <Inbox size={18} className="text-accent" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-base">
            {s.name}
          </p>
          <span className="inline-flex shrink-0 items-center rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext0">
            {s.kind}
          </span>
          <span className="text-xs text-subtext0">{timeAgo(s.created_at)}</span>
        </div>
        <a
          href={`mailto:${s.email}`}
          className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-subtext0 transition-colors hover:text-accent"
        >
          <Mail size={11} />
          {s.email}
        </a>
        {/* Rendered as escaped plain text (React auto-escapes), never as markup. */}
        <p className="mt-1.5 mb-0 whitespace-pre-wrap text-sm text-subtext0">
          {s.message}
        </p>
      </div>

      <button
        type="button"
        onClick={onToggle}
        disabled={toggling}
        className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ${
          s.handled
            ? 'bg-teal/10 text-teal hover:bg-teal/20'
            : 'border border-overlay0 bg-base text-subtext0 hover:border-accent hover:text-accent'
        }`}
      >
        {toggling ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          s.handled && <Check size={13} />
        )}
        {s.handled ? 'Handled' : 'Mark handled'}
      </button>
    </div>
  )
}
