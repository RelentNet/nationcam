import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Info, LayoutGrid, LogIn, Shield } from 'lucide-react'
import type { Me, MyAccount, OwnerSublocation, OwnerVideo } from '@/lib/types'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/Button'
import Panel from '@/components/ui/Panel'
import SectionHead from '@/components/ui/SectionHead'
import {
  fetchMe,
  fetchMyAccounts,
  fetchMySublocations,
  fetchMyVideos,
} from '@/lib/api'
import AccountSection from '@/components/owner/AccountSection'

// Behind Logto sign-in, so no crawler ever sees it and there is nothing to
// server-render — @logto/react is browser-only anyway.
export const Route = createFileRoute('/dashboard')({
  ssr: false,
  component: DashboardPage,
})

/* ════════════════════════════════════════════════
   Auth Gate
   ════════════════════════════════════════════════ */

function DashboardPage() {
  const { isAuthenticated, isLoading, user, login } = useAuth()

  // Track whether the initial auth check has completed. The Logto SDK's
  // proxy wraps every method with setIsLoading(true/false), so calling
  // getAccessToken or getIdTokenClaims causes isLoading to flicker.
  // Without this guard, each flicker unmounts DashboardContent (which
  // triggers fetchMe → getToken → getAccessToken → isLoading
  // flicker → unmount → remount → infinite loop).
  const authSettled = useRef(false)
  if (!isLoading) authSettled.current = true

  if (!authSettled.current) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className="flex flex-col items-center gap-4"
          style={{
            opacity: 0,
            animation: 'scale-fade-in 500ms var(--spring-poppy) forwards',
          }}
        >
          <div
            className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent"
            style={{ animation: 'spin 800ms linear infinite' }}
          />
          <p className="mb-0 font-mono text-sm text-subtext0">
            Authenticating...
          </p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div
          className="w-full max-w-sm"
          style={{
            opacity: 0,
            animation: 'scale-fade-in 400ms var(--spring-poppy) forwards',
          }}
        >
          <Panel accentTop padding="lg">
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <LogIn size={24} className="text-accent" />
              <h2 className="mb-0 font-display text-h3">Sign in to continue</h2>
              <p className="mb-0 text-sm text-subtext1">
                Authentication required for dashboard access.
              </p>
            </div>
            <Button size="lg" block onClick={login}>
              Sign In
            </Button>
          </Panel>
        </div>
      </div>
    )
  }

  return <DashboardContent userName={user?.name ?? user?.username ?? null} />
}

/* ════════════════════════════════════════════════
   Owner Dashboard (DAN-41) — a signed-in user's own
   locations and cameras. Admins land here too (Sign In
   always returns to /dashboard) and see a link to the
   full console at /admin.
   ════════════════════════════════════════════════ */

function DashboardContent({ userName }: { userName: string | null }) {
  const { getToken, isAdmin, isAdminLoading } = useAuth()

  const [me, setMe] = useState<Me | null>(null)
  const [accounts, setAccounts] = useState<Array<MyAccount>>([])
  const [videos, setVideos] = useState<Array<OwnerVideo>>([])
  const [locations, setLocations] = useState<Array<OwnerSublocation>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // One fetch of everything the caller can see; each account section picks
  // out its own rows by account_id (DAN-382), so N accounts cost the same
  // four requests as one.
  const loadAll = async () => {
    try {
      const token = await getToken()
      const [meData, accountData, vids, locs] = await Promise.all([
        fetchMe(token),
        fetchMyAccounts(token),
        fetchMyVideos(token),
        fetchMySublocations(token),
      ])
      setMe(meData)
      setAccounts(accountData)
      setVideos(vids)
      setLocations(locs)
      setLoadError(null)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load your dashboard.',
      )
    } finally {
      setLoading(false)
    }
  }

  // Fetch once on mount — same empty-deps pattern the admin console and
  // SubmissionsInbox use, to avoid the Logto isLoading-flicker refetch loop
  // (see useAuth.ts).
  useEffect(() => {
    loadAll()
  }, [])

  // Personal account first, then shared ones by name.
  const sortedAccounts = [...accounts].sort(
    (a, b) =>
      Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name),
  )

  return (
    <div className="page-container space-y-6">
      {/* ── Header ── */}
      <SectionHead
        as="h1"
        eyebrow="My NationCam"
        title={
          userName ? (
            <>
              Hello, <span className="text-accent-ink">{userName}</span>
            </>
          ) : (
            'Dashboard'
          )
        }
        body={
          accounts.length > 1 ? (
            <p className="mono-label">{accounts.length} accounts</p>
          ) : undefined
        }
      />

      {!isAdminLoading && isAdmin && (
        <Link to="/admin" className="group block no-underline">
          <Panel className="flex items-center gap-3 transition-colors duration-150 group-hover:border-accent">
            <Shield size={17} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="mb-0 text-sm font-medium text-text">
                You have admin access
              </p>
              <p className="mb-0 text-xs text-subtext1">
                Manage the full site, review submissions, and see all users at
                the admin console.
              </p>
            </div>
            <ArrowRight size={16} className="shrink-0 text-subtext1" />
          </Panel>
        </Link>
      )}

      {videos.length > 0 && (
        <Link
          to="/dashboard/command-center"
          className="group block no-underline"
        >
          <Panel className="flex items-center gap-3 transition-colors duration-150 group-hover:border-accent">
            <LayoutGrid size={17} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="mb-0 text-sm font-medium text-text">
                Command center
              </p>
              <p className="mb-0 text-xs text-subtext1">
                Every camera you can view on one wall, grouped by location, with
                live status.
              </p>
            </div>
            <ArrowRight size={16} className="shrink-0 text-subtext1" />
          </Panel>
        </Link>
      )}

      {loadError && (
        <p
          role="alert"
          className="mb-0 rounded-r-md border-l-2 border-live bg-live-glow px-3 py-2 text-sm font-medium text-text"
        >
          {loadError}
        </p>
      )}

      <HowReviewWorks />

      {/* A brand-new user has no account yet: show an empty Personal one
          (its first location creates the real account). */}
      {sortedAccounts.length === 0 ? (
        <AccountSection
          account={null}
          videos={videos}
          locations={locations}
          maxCameras={me?.limits.max_cameras ?? null}
          currentUserId={me?.user_id ?? null}
          loading={loading}
          loadError={loadError}
          onChanged={loadAll}
        />
      ) : (
        sortedAccounts.map((a) => (
          <AccountSection
            key={a.account_id}
            account={a}
            videos={videos}
            locations={locations}
            maxCameras={me?.limits.max_cameras ?? null}
            currentUserId={me?.user_id ?? null}
            loading={loading}
            loadError={loadError}
            onChanged={loadAll}
          />
        ))
      )}
    </div>
  )
}

function HowReviewWorks() {
  return (
    <Panel className="flex items-start gap-3">
      <Info size={16} className="mt-0.5 shrink-0 text-accent" />
      <p className="mb-0 text-sm text-subtext1">
        <span className="font-medium text-text">How review works:</span> a new
        location or camera you add starts in review and stays private until an
        admin approves it. Account admins can pause, resume, edit or delete an
        account's cameras at any time and invite other people to it; a rejected
        item shows the reviewer's note so you know what to change.
      </p>
    </Panel>
  )
}
