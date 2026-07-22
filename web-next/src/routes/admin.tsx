import { Link, createFileRoute } from '@tanstack/react-router'
import { ExternalLink, LayoutDashboard, LogIn, Shield } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/Button'
import Reveal from '@/components/Reveal'

const ADMIN_CONSOLE_URL = 'https://admin.auth.nationcam.com'

// Behind Logto sign-in, so no crawler ever sees it and there is nothing to
// server-render — @logto/react is browser-only anyway.
export const Route = createFileRoute('/admin')({
  ssr: false,
  component: AdminPage,
})

function AdminPage() {
  const { isAuthenticated, isLoading, user, login } = useAuth()

  if (isLoading) {
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
          <p className="mb-0 font-mono text-sm text-subtext0">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Reveal variant="scale">
          <div className="w-full max-w-sm">
            <div className="rounded-xl border border-overlay0 bg-surface0 p-8 shadow-xl">
              <div className="mb-6 flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
                  <LogIn size={20} className="text-accent" />
                </div>
                <h4 className="mb-0">Admin Access</h4>
                <p className="mb-0 text-sm text-subtext0">
                  Sign in to access the admin console.
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
        </Reveal>
      </div>
    )
  }

  const displayName = user?.name ?? user?.username ?? 'Admin'

  return (
    <div className="page-container space-y-10">
      <Reveal variant="blur">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
            <Shield size={14} className="text-accent" />
            <span className="font-mono text-xs font-medium text-accent">
              Admin Console
            </span>
          </div>
          <h1>Admin Console</h1>
          <p className="max-w-lg">
            Platform administration tools for{' '}
            <span className="font-medium text-accent">{displayName}</span>.
          </p>
        </div>
      </Reveal>

      <Reveal variant="float">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Dashboard link */}
          <Link
            to="/dashboard"
            className="group flex items-start gap-4 rounded-xl border border-overlay0 bg-surface0 p-6 transition-[border-color,box-shadow] duration-200 ease-[var(--spring-gentle)] hover:border-accent/40 hover:shadow-lg"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 transition-colors group-hover:bg-accent/20">
              <LayoutDashboard size={20} className="text-accent" />
            </div>
            <div>
              <h4 className="mb-1 text-text">Dashboard</h4>
              <p className="mb-0 text-sm text-subtext0">
                Manage cameras, states, and sublocations.
              </p>
            </div>
          </Link>

          {/* Logto admin console link */}
          <a
            href={ADMIN_CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-4 rounded-xl border border-overlay0 bg-surface0 p-6 transition-[border-color,box-shadow] duration-200 ease-[var(--spring-gentle)] hover:border-accent/40 hover:shadow-lg"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 transition-colors group-hover:bg-accent/20">
              <ExternalLink size={20} className="text-accent" />
            </div>
            <div>
              <h4 className="mb-1 text-text">
                Logto Console
                <ExternalLink
                  size={12}
                  className="ml-1.5 inline-block text-subtext0"
                />
              </h4>
              <p className="mb-0 text-sm text-subtext0">
                Manage users, roles, and authentication settings.
              </p>
            </div>
          </a>
        </div>
      </Reveal>
    </div>
  )
}
