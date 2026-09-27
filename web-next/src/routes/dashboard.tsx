import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Info, LogIn, Shield } from 'lucide-react'
import type { Me } from '@/lib/types'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/Button'
import { fetchMe } from '@/lib/api'
import MyLocationsPanel from '@/components/owner/MyLocationsPanel'
import MyCamerasPanel from '@/components/owner/MyCamerasPanel'

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
          <div className="overflow-hidden rounded-2xl border border-overlay0 bg-surface0 shadow-xl">
            <div className="h-1 bg-gradient-to-r from-accent via-accent/50 to-transparent" />
            <div className="p-8">
              <div className="mb-6 flex flex-col items-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
                  <LogIn size={24} className="text-accent" />
                </div>
                <h4 className="mb-0 font-display">Sign in to continue</h4>
                <p className="mb-0 text-sm text-subtext0">
                  Authentication required for dashboard access.
                </p>
              </div>
              <Button
                text="Sign In"
                variant="primary"
                size="lg"
                className="w-full"
                onClick={login}
              />
            </div>
          </div>
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
  const [meError, setMeError] = useState<string | null>(null)

  const loadMe = async () => {
    try {
      const token = await getToken()
      setMe(await fetchMe(token))
      setMeError(null)
    } catch (err) {
      setMeError(err instanceof Error ? err.message : 'Failed to load limits.')
    }
  }

  // Fetch once on mount — same empty-deps pattern the admin console and
  // SubmissionsInbox use, to avoid the Logto isLoading-flicker refetch loop
  // (see useAuth.ts).
  useEffect(() => {
    loadMe()
  }, [])

  return (
    <div className="page-container space-y-6">
      {/* ── Header ── */}
      <div
        className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"
        style={{
          opacity: 0,
          animation: 'blur-in 500ms var(--spring-ease-out) forwards',
        }}
      >
        <div>
          <p className="mb-1 font-mono text-[11px] font-medium tracking-[0.2em] text-accent uppercase">
            My NationCam
          </p>
          <h1 className="!mb-0 !text-2xl sm:!text-3xl">
            {userName ? (
              <>
                Hello, <span className="text-accent">{userName}</span>
              </>
            ) : (
              'Dashboard'
            )}
          </h1>
        </div>
        {me && (
          <p className="mb-0 font-mono text-[11px] text-subtext0">
            {me.counts.videos} of {me.limits.max_cameras} cameras
          </p>
        )}
      </div>

      {!isAdminLoading && isAdmin && (
        <Link
          to="/admin"
          className="group flex items-center gap-3 rounded-xl border border-overlay0 bg-surface0 p-4 transition-[border-color,box-shadow] duration-200 ease-[var(--spring-gentle)] hover:border-accent/40 hover:shadow-lg"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 transition-colors group-hover:bg-accent/20">
            <Shield size={17} className="text-accent" />
          </div>
          <div className="min-w-0">
            <p className="mb-0 text-sm font-medium text-text">
              You have admin access
            </p>
            <p className="mb-0 text-xs text-subtext0">
              Manage the full site, review submissions, and see all users at the
              admin console.
            </p>
          </div>
        </Link>
      )}

      {meError && (
        <p className="mb-0 rounded-lg bg-live/10 px-3.5 py-2.5 text-sm text-live">
          {meError}
        </p>
      )}

      <HowReviewWorks />

      <MyLocationsPanel />
      <MyCamerasPanel onLimitsChange={loadMe} />
    </div>
  )
}

function HowReviewWorks() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-overlay0/60 bg-surface0 p-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
        <Info size={16} className="text-accent" />
      </div>
      <p className="mb-0 text-sm text-subtext0">
        <span className="font-medium text-text">How review works:</span> a new
        location or camera you add starts in review and stays private until an
        admin approves it. You can pause, resume, edit or delete your own
        cameras at any time; a rejected item shows the admin's note so you know
        what to change.
      </p>
    </div>
  )
}
