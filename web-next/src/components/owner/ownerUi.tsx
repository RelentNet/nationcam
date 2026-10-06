import { AlertTriangle, Check, Clock, PauseCircle } from 'lucide-react'

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
