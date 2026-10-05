import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Inbox, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
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
  useAutoHide,
} from '@/components/dashboardUi'

/* ════════════════════════════════════════════════
   Submissions Inbox (construction / free camera / contact)

   Self-contained, admin-only inbox. Sub-tabs per form
   type; each tab fetches its own kinds (`?kind=`) so it
   gets its own latest 200, and shows the structured
   fields (DAN-226) as table columns. A row expands to
   every stored field plus the original message. Rows
   from before DAN-226 have empty fields: columns show
   an em dash and the expansion shows the message.

   Lives on the admin console — submissions carry names,
   emails and addresses, so this must render ONLY for
   admins (see routes/admin.tsx). The backend already
   enforces admin-only access to the submissions API.
   ════════════════════════════════════════════════ */

type TabId = 'all' | 'construction' | 'free-camera' | 'contact'

interface TabDef {
  id: TabId
  label: string
  /** Kinds this tab fetches; undefined = every kind. */
  kinds?: Array<string>
}

const TABS: Array<TabDef> = [
  { id: 'all', label: 'All' },
  { id: 'construction', label: 'Construction', kinds: ['construction'] },
  { id: 'free-camera', label: 'Free camera', kinds: ['free-camera'] },
  { id: 'contact', label: 'Contact', kinds: ['contact', 'camera'] },
]

const TAB_STORAGE_KEY = 'nationcam.submissions.tab'

function readStoredTab(): TabId {
  try {
    const v = window.localStorage.getItem(TAB_STORAGE_KEY)
    if (TABS.some((t) => t.id === v)) return v as TabId
  } catch {
    /* storage unavailable: start on All */
  }
  return 'all'
}

function storeTab(id: TabId) {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, id)
  } catch {
    /* storage unavailable: the tab just is not remembered */
  }
}

const KIND_LABELS: Record<string, string> = {
  construction: 'Construction',
  'free-camera': 'Free camera',
  contact: 'Contact',
  camera: 'Contact (add camera)',
}

const DASH = '—'

/* ──── Value helpers ──── */

function detail(s: Submission, key: string): string {
  const v = s.details?.[key]
  if (v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

function money(s: Submission, key: string): string {
  const v = s.details?.[key]
  if (typeof v !== 'number') return ''
  return `$${Math.round(v).toLocaleString('en-US')}`
}

function site(s: Submission): string {
  return [s.site_city, s.site_state]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

function cameraSummary(s: Submission): string {
  return [detail(s, 'camera'), detail(s, 'style'), detail(s, 'resolution')]
    .filter(Boolean)
    .join(' · ')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function humanize(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/* ──── Columns ──── */

interface Column {
  key: string
  label: string
  render: (s: Submission) => ReactNode
  className?: string
}

const text =
  (fn: (s: Submission) => string) =>
  (s: Submission): ReactNode =>
    fn(s) || DASH

const dateCol: Column = {
  key: 'date',
  label: 'Date',
  render: (s) => formatDate(s.created_at),
  className: 'whitespace-nowrap',
}
const nameCol: Column = {
  key: 'name',
  label: 'Name',
  render: (s) => s.name,
  className: 'font-medium text-text',
}
const emailCol: Column = {
  key: 'email',
  label: 'Email',
  render: (s) => s.email,
}
const siteCol: Column = {
  key: 'site',
  label: 'Site',
  render: text(site),
}

const COLUMNS: Record<TabId, Array<Column>> = {
  all: [
    dateCol,
    {
      key: 'type',
      label: 'Type',
      render: (s) => KIND_LABELS[s.kind] ?? s.kind,
      className: 'whitespace-nowrap',
    },
    nameCol,
    emailCol,
  ],
  construction: [
    dateCol,
    nameCol,
    { key: 'company', label: 'Company', render: text((s) => s.company ?? '') },
    siteCol,
    { key: 'plan', label: 'Plan', render: text((s) => detail(s, 'plan')) },
    { key: 'camera', label: 'Camera', render: text(cameraSummary) },
    {
      key: 'cameras',
      label: 'Cameras',
      render: text((s) => detail(s, 'cameras')),
    },
    {
      key: 'est_monthly',
      label: 'Est. monthly',
      render: text((s) => money(s, 'est_monthly')),
      className: 'whitespace-nowrap',
    },
    {
      key: 'est_upfront',
      label: 'Est. upfront',
      render: text((s) => money(s, 'est_upfront')),
      className: 'whitespace-nowrap',
    },
  ],
  'free-camera': [
    dateCol,
    nameCol,
    {
      key: 'business',
      label: 'Business',
      render: text((s) => s.company ?? ''),
    },
    siteCol,
    {
      key: 'site_type',
      label: 'Site type',
      render: text((s) => detail(s, 'site_type')),
    },
    { key: 'power', label: 'Power', render: text((s) => detail(s, 'power')) },
    {
      key: 'internet',
      label: 'Internet',
      render: text((s) => detail(s, 'internet')),
    },
    {
      key: 'installer',
      label: 'Installer',
      render: text((s) => detail(s, 'installer')),
    },
  ],
  contact: [
    dateCol,
    nameCol,
    emailCol,
    siteCol,
    {
      key: 'cameras',
      label: 'Cameras',
      render: text((s) => detail(s, 'cameras')),
    },
    {
      key: 'timeline',
      label: 'Timeline',
      render: text((s) => detail(s, 'timeline')),
    },
  ],
}

/* ──── Component ──── */

type TabData = Partial<Record<TabId, Array<Submission>>>

export default function SubmissionsInbox() {
  const { getToken } = useAuth()

  const [data, setData] = useState<TabData>({})
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)
  const [toggling, setToggling] = useState<number | null>(null)

  const [tab, setTab] = useState<TabId>('all')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('newest')
  const [page, setPage] = useState(1)

  // Restore the remembered tab after mount (storage only exists in the browser).
  useEffect(() => {
    setTab(readStoredTab())
  }, [])

  // Every tab fetches its own kinds, so each gets its own latest 200 and the tab
  // badges can count unhandled entries without visiting the tab. `loading` is
  // only true initially, so reloading after a toggle causes no skeleton flash.
  const load = async () => {
    try {
      const token = await getToken()
      const lists = await Promise.all(
        TABS.map((t) =>
          fetchSubmissions(token, t.kinds).catch(() => [] as Array<Submission>),
        ),
      )
      const next: TabData = {}
      TABS.forEach((t, i) => {
        next[t.id] = Array.isArray(lists[i]) ? lists[i] : []
      })
      setData(next)
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

  const selectTab = (id: TabId) => {
    setTab(id)
    storeTab(id)
    setExpanded(null)
    setPage(1)
  }

  const current = data[tab] ?? []

  const filtered = useMemo(() => {
    let result = [...current]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((s) => {
        const haystack = [
          s.name,
          s.email,
          s.company,
          s.site_city,
          s.site_state,
          s.message,
          ...Object.keys(s.details ?? {}).map((k) => detail(s, k)),
        ]
        return haystack.some((v) => (v ?? '').toLowerCase().includes(q))
      })
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
  }, [current, search, sortKey])

  const total = filtered.length
  const totalPages = Math.ceil(total / PER_PAGE)
  const safePage = Math.min(page, Math.max(1, totalPages || 1))
  const rows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

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

  const columns = COLUMNS[tab]

  return (
    <div className="space-y-4">
      <PanelHeaderStatic
        title="Inbox"
        subtitle="Construction, free camera and contact form submissions"
      />

      <div
        role="tablist"
        aria-label="Submission type"
        className="flex flex-wrap gap-1.5"
      >
        {TABS.map((t) => {
          const unhandled = (data[t.id] ?? []).filter((s) => !s.handled).length
          const active = t.id === tab
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                active
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-overlay0/60 bg-base text-subtext0 hover:border-accent hover:text-accent'
              }`}
            >
              {t.label}
              <span
                aria-label={`${unhandled} unhandled`}
                className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-px font-mono text-[11px] tabular-nums ${
                  unhandled > 0
                    ? 'bg-accent text-crust'
                    : 'bg-surface2 text-subtext0'
                }`}
              >
                {unhandled}
              </span>
            </button>
          )
        })}
      </div>

      <DataList
        loading={loading}
        empty={current.length === 0}
        emptyIcon={Inbox}
        emptyText="No submissions yet"
        toolbar={
          !loading && current.length > 0 ? (
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
            {/* The table scrolls inside this box, never the page. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-overlay0/40 text-subtext0">
                    <th className="w-8 px-2 py-2" aria-label="Expand" />
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className="px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wide whitespace-nowrap"
                      >
                        {c.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wide">
                      Handled
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <SubmissionTableRow
                      key={s.submission_id}
                      submission={s}
                      columns={columns}
                      open={expanded === s.submission_id}
                      onOpen={() =>
                        setExpanded(
                          expanded === s.submission_id ? null : s.submission_id,
                        )
                      }
                      toggling={toggling === s.submission_id}
                      onToggle={() => handleToggle(s)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
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

/* ──── Table row + expansion ──── */

function SubmissionTableRow({
  submission: s,
  columns,
  open,
  onOpen,
  toggling,
  onToggle,
}: {
  submission: Submission
  columns: Array<Column>
  open: boolean
  onOpen: () => void
  toggling: boolean
  onToggle: () => void
}) {
  return (
    <Fragment>
      <tr
        onClick={onOpen}
        className={`cursor-pointer border-b border-overlay0/30 align-top text-subtext0 transition-colors duration-150 hover:bg-surface1/50 ${
          s.handled ? 'opacity-70' : ''
        }`}
      >
        <td className="px-2 py-2.5">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'Collapse submission' : 'Expand submission'}
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            className="rounded p-0.5 text-overlay2 hover:text-accent"
          >
            <ChevronRight
              size={14}
              className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            />
          </button>
        </td>
        {columns.map((c) => (
          <td key={c.key} className={`px-3 py-2.5 ${c.className ?? ''}`}>
            {c.render(s)}
          </td>
        ))}
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            disabled={toggling}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ${
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
        </td>
      </tr>
      {open && (
        <tr className="border-b border-overlay0/30 bg-surface1/30">
          <td colSpan={columns.length + 2} className="px-4 py-4">
            <SubmissionDetail submission={s} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function SubmissionDetail({ submission: s }: { submission: Submission }) {
  const fields: Array<{ label: string; value: ReactNode }> = [
    { label: 'Type', value: KIND_LABELS[s.kind] ?? s.kind },
    { label: 'Submitted', value: formatDate(s.created_at) },
    { label: 'Name', value: s.name },
    {
      label: 'Email',
      value: (
        <a
          href={`mailto:${s.email}`}
          className="text-accent underline-offset-2 hover:underline"
        >
          {s.email}
        </a>
      ),
    },
  ]
  const phone = (s.phone ?? '').trim()
  if (phone) {
    fields.push({
      label: 'Phone',
      value: (
        <a
          href={`tel:${phone}`}
          className="text-accent underline-offset-2 hover:underline"
        >
          {phone}
        </a>
      ),
    })
  }
  if (s.company) fields.push({ label: 'Company', value: s.company })
  if (s.site_city) fields.push({ label: 'Site city', value: s.site_city })
  if (s.site_state) fields.push({ label: 'Site state', value: s.site_state })
  for (const key of Object.keys(s.details ?? {})) {
    const v = key.startsWith('est_')
      ? money(s, key) || detail(s, key)
      : detail(s, key)
    if (v) fields.push({ label: humanize(key), value: v })
  }

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.label} className="flex min-w-0 gap-2 text-xs">
            <dt className="shrink-0 text-overlay2">{f.label}:</dt>
            <dd className="m-0 min-w-0 break-words text-text">{f.value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className="mb-1 font-mono text-[11px] tracking-wide text-overlay2 uppercase">
          Message
        </div>
        {/* Rendered as escaped plain text (React auto-escapes), never as markup. */}
        <div className="max-w-3xl text-xs break-words whitespace-pre-wrap text-subtext0">
          {s.message}
        </div>
      </div>
    </div>
  )
}
