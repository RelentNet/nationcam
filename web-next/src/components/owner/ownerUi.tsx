import {
  AlertTriangle,
  Check,
  Clock,
  Globe,
  Lock,
  PauseCircle,
  ShieldCheck,
} from 'lucide-react'

/* ════════════════════════════════════════════════
   Shared — Owner dashboard primitives (DAN-41).
   Small pieces used by both MyLocationsPanel and
   MyCamerasPanel; the bigger shared building blocks
   (PanelHeader, CreatePanel, form fields, dialogs) come
   from components/dashboardUi.tsx, same as the admin
   panels.
   ════════════════════════════════════════════════ */

/** A location's review status (`pending`/`approved`/`rejected`) or a
 *  camera's (`pending`/`active`/`paused`/`rejected` — `inactive` is an
 *  admin-only switch-off an owner never sees on their own rows). */
export function StatusPill({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; className: string; icon: typeof Check }
  > = {
    pending: {
      label: 'Pending review',
      className: 'bg-accent/10 text-accent',
      icon: Clock,
    },
    approved: {
      label: 'Approved',
      className: 'bg-teal/10 text-teal',
      icon: Check,
    },
    active: {
      label: 'Live',
      className: 'bg-teal/10 text-teal',
      icon: Check,
    },
    paused: {
      label: 'Paused',
      className: 'bg-surface2 text-subtext0',
      icon: PauseCircle,
    },
    rejected: {
      label: 'Rejected',
      className: 'bg-live/10 text-live',
      icon: AlertTriangle,
    },
  }
  const c = config[status] ?? {
    label: status,
    className: 'bg-surface2 text-subtext0',
    icon: Clock,
  }
  const Icon = c.icon
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-medium tracking-[0.02em] uppercase ${c.className}`}
    >
      <Icon size={12} />
      {c.label}
    </span>
  )
}

/** A camera's live state on the command center (`GET /me/videos/status`):
 *  distinct from `StatusPill`, which is the review status of the row. */
export function StateBadge({ state }: { state: string }) {
  const config: Record<
    string,
    { label: string; className: string; dot: string }
  > = {
    live: { label: 'Live', className: 'bg-teal/10 text-teal', dot: 'bg-teal' },
    offline: {
      label: 'Offline',
      className: 'bg-live/10 text-live',
      dot: 'bg-live',
    },
    paused: {
      label: 'Paused',
      className: 'bg-surface2 text-subtext0',
      dot: 'bg-overlay2',
    },
    pending: {
      label: 'Pending',
      className: 'bg-accent/10 text-accent',
      dot: 'bg-accent',
    },
    unknown: {
      label: 'Unknown',
      className: 'bg-surface2 text-subtext0',
      dot: 'bg-overlay1',
    },
  }
  const c = config[state] ?? config.unknown
  return (
    <span
      data-state={state}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.02em] uppercase ${c.className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${c.dot}`}
        style={
          state === 'live'
            ? { animation: 'pulse-live 2s ease-in-out infinite' }
            : undefined
        }
      />
      {c.label}
    </span>
  )
}

/** A member's role in an account (DAN-382). */
export function RolePill({ role }: { role: 'admin' | 'viewer' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-medium tracking-[0.02em] uppercase ${
        role === 'admin'
          ? 'bg-accent/10 text-accent'
          : 'bg-surface2 text-subtext0'
      }`}
    >
      {role === 'admin' && <ShieldCheck size={12} />}
      {role === 'admin' ? 'Admin' : 'Viewer'}
    </span>
  )
}

/** Read-only visibility for customers (DAN-205): only NationCam admins can
 *  change it. A private camera is visible to the account's members only. */
export function VisibilityPill({ isPrivate }: { isPrivate: boolean }) {
  const Icon = isPrivate ? Lock : Globe
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-medium tracking-[0.02em] uppercase ${
        isPrivate ? 'bg-accent/10 text-accent' : 'bg-surface2 text-subtext0'
      }`}
      title={
        isPrivate
          ? 'Only your team can watch this camera'
          : 'Anyone can watch this camera on NationCam'
      }
    >
      <Icon size={12} />
      {isPrivate ? 'Private' : 'Public'}
    </span>
  )
}

/** The review note under a status pill — shown only when the row carries
 *  one (an admin's reason for rejecting, or occasionally a note left on
 *  approval). */
export function ReviewNote({ note }: { note: string }) {
  if (!note) return null
  return (
    <p className="mb-0 mt-1 text-xs text-subtext0">
      <span className="font-medium text-text">Note from review:</span> {note}
    </p>
  )
}
