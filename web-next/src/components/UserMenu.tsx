import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  ExternalLink,
  LayoutDashboard,
  LogIn,
  LogOut,
  Shield,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

const LOGTO_ENDPOINT =
  import.meta.env['VITE_LOGTO_ENDPOINT'] ?? 'https://auth.nationcam.com'

/** Profile management lives on the Logto instance. */
const ACCOUNT_URL = `${LOGTO_ENDPOINT}/account`

export default function UserMenu() {
  const { isAuthenticated, isLoading, user, login, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (isLoading) {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-surface0" />
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={login}
        className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-sans text-sm font-medium text-subtext1 transition-colors duration-200 ease-[var(--spring-gentle)] hover:bg-surface0/50 hover:text-text"
      >
        <LogIn size={16} />
        <span className="hidden sm:inline">Sign In</span>
      </button>
    )
  }

  const initials = getInitials(user?.name, user?.email, user?.username)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-overlay0 bg-surface0 text-xs font-bold text-subtext1 transition-colors duration-200 ease-[var(--spring-gentle)] hover:border-accent/40 hover:text-accent"
        aria-label="User menu"
      >
        {user?.picture ? (
          <img
            src={user.picture}
            alt=""
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </button>

      {/* Dropdown */}
      <div
        className={`absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-overlay0 bg-surface0 shadow-xl transition-[scale,opacity] duration-350 ease-[var(--spring-smooth)] ${
          open
            ? 'pointer-events-auto scale-100 opacity-100'
            : 'pointer-events-none scale-95 opacity-0'
        }`}
        style={{ transformOrigin: 'top right' }}
      >
        {/* User info header */}
        {user && (
          <div className="border-b border-overlay0/50 px-4 py-3">
            <p className="mb-0 truncate text-sm font-medium text-text">
              {user.name ?? user.username ?? 'User'}
            </p>
            {user.email && (
              <p className="mb-0 truncate text-xs text-subtext0">
                {user.email}
              </p>
            )}
          </div>
        )}

        <div className="py-1">
          <MenuLink
            to="/dashboard"
            icon={LayoutDashboard}
            label="Dashboard"
            onClick={() => setOpen(false)}
          />
          <MenuExternalLink
            href={ACCOUNT_URL}
            icon={ExternalLink}
            label="Account Settings"
          />
          <MenuLink
            to="/admin"
            icon={Shield}
            label="Admin Console"
            onClick={() => setOpen(false)}
          />
        </div>

        <div className="border-t border-overlay0/50 py-1">
          <button
            onClick={() => {
              setOpen(false)
              logout()
            }}
            className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-subtext1 transition-colors hover:bg-surface1 hover:text-text"
          >
            <LogOut size={15} className="text-subtext0" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Dropdown menu items ── */

function MenuLink({
  to,
  icon: Icon,
  label,
  onClick,
}: {
  to: string
  icon: React.ComponentType<{ size: number; className?: string }>
  label: string
  onClick?: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2 text-sm text-subtext1 transition-colors hover:bg-surface1 hover:text-text"
    >
      <Icon size={15} className="text-subtext0" />
      {label}
    </Link>
  )
}

function MenuExternalLink({
  href,
  icon: Icon,
  label,
}: {
  href: string
  icon: React.ComponentType<{ size: number; className?: string }>
  label: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-4 py-2 text-sm text-subtext1 transition-colors hover:bg-surface1 hover:text-text"
    >
      <Icon size={15} className="text-subtext0" />
      {label}
    </a>
  )
}

/* ── Helpers ── */

function getInitials(
  name: string | null | undefined,
  email: string | null | undefined,
  username: string | null | undefined,
): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return parts[0][0].toUpperCase()
  }
  if (username) return username[0].toUpperCase()
  if (email) return email[0].toUpperCase()
  return '?'
}
