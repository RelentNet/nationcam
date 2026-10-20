import { useState } from 'react'
import { LogOut } from 'lucide-react'
import type { MyAccount, OwnerSublocation, OwnerVideo } from '@/lib/types'
import Button, { buttonClasses } from '@/components/Button'
import { ModalShell } from '@/components/dashboardUi'
import Panel from '@/components/ui/Panel'
import MyLocationsPanel from '@/components/owner/MyLocationsPanel'
import MyCamerasPanel from '@/components/owner/MyCamerasPanel'
import MembersPanel from '@/components/owner/MembersPanel'
import { RolePill } from '@/components/owner/ownerUi'
import { removeAccountMember } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

/* ════════════════════════════════════════════════
   Account Section (DAN-382) — one account on the
   owner dashboard: its name and the caller's role, a
   per-account limits line, the locations and cameras
   panels (read-only for a viewer), and, for an account
   admin, the Members panel. `account` is null for a
   brand-new user with no personal account yet: the
   section then offers the add forms, and the API
   creates the personal account on the first location.
   ════════════════════════════════════════════════ */

export default function AccountSection({
  account,
  videos,
  locations,
  maxCameras,
  currentUserId,
  loading,
  loadError,
  onChanged,
}: {
  account: MyAccount | null
  /** Every camera the caller can see (GET /me/videos). */
  videos: Array<OwnerVideo>
  /** Every location the caller can see (GET /me/sublocations). */
  locations: Array<OwnerSublocation>
  /** The per-account camera cap, from GET /me. */
  maxCameras: number | null
  currentUserId: string | null
  loading: boolean
  loadError: string | null
  /** Re-fetch accounts, cameras and locations after a write. */
  onChanged: () => Promise<void>
}) {
  const accountId = account?.account_id ?? null
  const isAdmin = account === null || account.role === 'admin'
  const name = account === null || account.personal ? 'Personal' : account.name

  const myVideos = videos.filter((v) => v.account_id === accountId)
  const myLocations = locations.filter((s) => s.account_id === accountId)

  const [confirmLeave, setConfirmLeave] = useState(false)

  const cameraCount = account?.video_count ?? 0
  const locationCount = account?.sublocation_count ?? 0
  const limits = [
    isAdmin && maxCameras !== null
      ? `${cameraCount} of ${maxCameras} cameras`
      : `${cameraCount} camera${cameraCount === 1 ? '' : 's'}`,
    `${locationCount} location${locationCount === 1 ? '' : 's'}`,
  ].join(' · ')

  return (
    <section className="space-y-6" aria-label={`${name} account`}>
      <Panel className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mb-0 font-display text-h3">{name}</h2>
            <RolePill role={isAdmin ? 'admin' : 'viewer'} />
            {!isAdmin && <span className="mono-label">View only</span>}
          </div>
          <p className="mono-label mb-0 mt-1">{limits}</p>
        </div>
        {account !== null && !account.personal && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirmLeave(true)}
          >
            <LogOut size={14} />
            Leave account
          </Button>
        )}
      </Panel>

      <MyLocationsPanel
        locations={myLocations}
        accountId={accountId}
        canEdit={isAdmin}
        loading={loading}
        loadError={loadError}
        onChanged={onChanged}
      />
      <MyCamerasPanel
        videos={myVideos}
        locations={myLocations}
        canEdit={isAdmin}
        loading={loading}
        loadError={loadError}
        onChanged={onChanged}
      />
      {account !== null && isAdmin && (
        <MembersPanel
          accountId={account.account_id}
          accountName={name}
          cameras={myVideos}
          currentUserId={currentUserId}
        />
      )}

      {confirmLeave && account !== null && currentUserId && (
        <LeaveDialog
          accountId={account.account_id}
          accountName={name}
          userId={currentUserId}
          onLeft={async () => {
            setConfirmLeave(false)
            await onChanged()
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </section>
  )
}

function LeaveDialog({
  accountId,
  accountName,
  userId,
  onLeft,
  onCancel,
}: {
  accountId: number
  accountName: string
  userId: string
  onLeft: () => Promise<void>
  onCancel: () => void
}) {
  const { getToken } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      await removeAccountMember(accountId, userId, token)
      await onLeft()
    } catch (err) {
      // e.g. 409: you are the last admin of the account.
      setError(err instanceof Error ? err.message : 'Failed to leave.')
      setBusy(false)
    }
  }

  return (
    <ModalShell title="Leave account" onClose={onCancel}>
      <p className="mb-4 text-sm text-subtext1">
        Leave <span className="font-semibold text-text">{accountName}</span>?
        You lose access to its cameras and locations until someone invites you
        again.
      </p>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-r-md border-l-2 border-live bg-live-glow px-3 py-2 text-sm font-medium text-text"
        >
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
          className="flex-1"
        >
          Cancel
        </Button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className={buttonClasses({
            variant: 'primary',
            className:
              'flex-1 border-live! bg-live! text-white! hover:bg-live/90!',
          })}
        >
          {busy ? 'Leaving...' : 'Leave'}
        </button>
      </div>
    </ModalShell>
  )
}
