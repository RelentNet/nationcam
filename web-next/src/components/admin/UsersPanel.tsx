import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ServerOff,
  Shield,
  Users,
} from 'lucide-react'
import type { AdminRole, AdminUser, AdminUserStats } from '@/lib/types'
import { PanelHeaderStatic, timeAgo } from '@/components/dashboardUi'
import DataTable from '@/components/ui/DataTable'
import Panel from '@/components/ui/Panel'
import {
  fetchAdminRoles,
  fetchAdminUserStats,
  fetchAdminUsers,
} from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

const PAGE_SIZE = 20

/* ════════════════════════════════════════════════
   Users Panel (DAN-41) — admin-only. Reads
   GET /admin/users, /admin/users/stats and /admin/roles
   (the Logto management connection, DAN-37) and renders
   "Not configured" when those endpoints 404 — the M2M
   app credentials are optional server-side config.
   ════════════════════════════════════════════════ */

type LoadState = 'loading' | 'not-configured' | 'error' | 'ready'

export default function UsersPanel() {
  const { getToken } = useAuth()

  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<AdminUserStats | null>(null)
  const [roles, setRoles] = useState<Array<AdminRole>>([])
  const [users, setUsers] = useState<Array<AdminUser>>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  const load = async (targetPage: number) => {
    try {
      const token = await getToken()
      const [statsRes, rolesRes, usersRes] = await Promise.all([
        fetchAdminUserStats(token),
        fetchAdminRoles(token),
        fetchAdminUsers(targetPage, PAGE_SIZE, token),
      ])
      // All three endpoints are mounted (or not) together — if the users
      // list 404s, the panel is "not configured" regardless of the others.
      if (usersRes === null) {
        setState('not-configured')
        return
      }
      setStats(statsRes)
      setRoles(rolesRes?.roles ?? [])
      setUsers(usersRes.users)
      setTotal(usersRes.total)
      setPage(targetPage)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.')
      setState('error')
    }
  }

  // Fetch once on mount — same empty-deps pattern as SubmissionsInbox
  // (avoids the Logto isLoading-flicker refetch loop, see useAuth.ts).
  useEffect(() => {
    load(1)
  }, [])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <PanelHeaderStatic
        title="Users"
        subtitle="Signed-in accounts and roles, from Logto"
      />

      {state === 'loading' && (
        <div className="flex justify-center py-8">
          <div
            className="h-6 w-6 rounded-full border-2 border-accent border-t-transparent"
            style={{ animation: 'spin 800ms linear infinite' }}
          />
        </div>
      )}

      {state === 'not-configured' && (
        <Panel className="flex flex-col items-center gap-3 py-16 text-center">
          <ServerOff size={22} className="text-subtext0" />
          <p className="mb-0 max-w-sm text-sm text-subtext1">
            Not configured — set <code>LOGTO_M2M_APP_ID</code> and{' '}
            <code>LOGTO_M2M_APP_SECRET</code> to enable the Logto management
            connection (see AGENTS.md).
          </p>
        </Panel>
      )}

      {state === 'error' && (
        <p
          role="alert"
          className="mb-0 rounded-r-md border-l-2 border-live bg-live-glow px-3 py-2 text-sm font-medium text-text"
        >
          {error}
        </p>
      )}

      {state === 'ready' && (
        <>
          {stats && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Total" value={stats.total} icon={Users} />
              <StatTile label="Admins" value={stats.admins} icon={Shield} />
              <StatTile label="New (7d)" value={stats.new_7d} />
              <StatTile label="New (30d)" value={stats.new_30d} />
            </div>
          )}

          {roles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface0 px-3 py-1.5 text-xs text-subtext1"
                  title={r.description}
                >
                  <span className="font-medium text-text">{r.name}</span>
                  <span className="mono-label">
                    {r.user_count} user{r.user_count !== 1 ? 's' : ''}
                  </span>
                  {r.is_default && (
                    <span className="rounded bg-accent/10 px-1 py-px font-mono text-[10px] text-accent-ink uppercase">
                      default
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {users.length === 0 ? (
              <Panel className="py-16 text-center">
                <p className="mono-label mb-0">No users found</p>
              </Panel>
            ) : (
              <DataTable
                caption="Users"
                minWidth={640}
                columns={[
                  { key: 'user', header: 'User' },
                  { key: 'roles', header: 'Roles' },
                  { key: 'joined', header: 'Joined' },
                  { key: 'last', header: 'Last sign-in' },
                ]}
                rows={users.map((u) => ({
                  key: u.id,
                  cells: [
                    <>
                      <span className="block truncate">
                        {u.name || u.primary_email || u.id}
                      </span>
                      {u.primary_email && (
                        <span className="block truncate text-xs font-normal text-subtext1">
                          {u.primary_email}
                        </span>
                      )}
                    </>,
                    <UserRoles roles={u.roles} />,
                    timeAgo(u.created_at),
                    u.last_sign_in_at ? timeAgo(u.last_sign_in_at) : '—',
                  ],
                }))}
              />
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="mono-label mb-0">
                  Page {page}/{totalPages} &middot; {total} users
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => load(page - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-subtext1 transition-colors duration-150 hover:bg-surface1 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => load(page + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-subtext1 transition-colors duration-150 hover:bg-surface1 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Next page"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number
  icon?: typeof Users
}) {
  return (
    <Panel>
      <div className="mono-label flex items-center gap-1.5">
        {Icon && <Icon size={13} />}
        {label}
      </div>
      <p className="mt-2 mb-0 font-display text-2xl font-bold text-text">
        {value}
      </p>
    </Panel>
  )
}

function UserRoles({ roles }: { roles: Array<string> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {roles.length === 0 ? (
        <span className="rounded bg-surface2 px-1.5 py-px font-mono text-[11px] text-subtext1">
          no role
        </span>
      ) : (
        roles.map((role) => (
          <span
            key={role}
            className="rounded bg-accent/10 px-1.5 py-px font-mono text-[11px] text-accent-ink"
          >
            {role}
          </span>
        ))
      )}
    </div>
  )
}
