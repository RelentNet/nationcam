import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Building2 } from 'lucide-react'
import type { AdminAccount, Sublocation, Video } from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import { isPrivateCamera } from '@/lib/types'
import {
  CreatePanel,
  DataList,
  FormField,
  FormFooter,
  PanelHeader,
  SelectField,
  StatusBanner,
  staggerStyle,
  useAutoHide,
} from '@/components/dashboardUi'
import Button from '@/components/Button'
import Panel from '@/components/ui/Panel'
import {
  createAccount,
  fetchAllAccounts,
  moveSublocationToAccount,
  moveVideoToAccount,
} from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

/* ════════════════════════════════════════════════
   Accounts Panel (DAN-382) — NationCam staff only.
   Lists every account (GET /accounts), creates a
   customer account with an optional first admin
   (POST /accounts), and moves an existing camera
   (PUT /videos/{id}/account) or location with its
   cameras (PUT /sublocations/{id}/account) into one.
   ════════════════════════════════════════════════ */

export default function AccountsPanel({
  videos,
  sublocations,
}: {
  videos: Array<Video>
  sublocations: Array<Sublocation>
}) {
  const { getToken } = useAuth()

  const [accounts, setAccounts] = useState<Array<AdminAccount>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    try {
      const token = await getToken()
      setAccounts(await fetchAllAccounts(token))
      setLoadError(null)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load accounts.',
      )
    } finally {
      setLoading(false)
    }
  }

  // Fetch once on mount (see useAuth.ts on the isLoading-flicker loop).
  useEffect(() => {
    load()
  }, [])

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [adminUserId, setAdminUserId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)
  useAutoHide(msg, setMsg)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setMsg({ text: 'Account name is required.', ok: false })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await createAccount(
        {
          name: name.trim(),
          admin_user_id: adminUserId.trim() || undefined,
        },
        token,
      )
      setMsg({ text: 'Account created.', ok: true })
      setName('')
      setAdminUserId('')
      setShowCreate(false)
      await load()
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to create account.',
        ok: false,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const sorted = useMemo(
    () =>
      [...accounts].sort(
        (a, b) =>
          Number(a.personal) - Number(b.personal) ||
          a.name.localeCompare(b.name),
      ),
    [accounts],
  )

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <PanelHeader
          title="Accounts"
          subtitle="Customer accounts share their cameras and locations between members. Personal accounts are created automatically."
          showCreate={showCreate}
          onToggleCreate={() => {
            setShowCreate(!showCreate)
            setMsg(null)
          }}
          createLabel="Create Account"
        />

        {showCreate && (
          <CreatePanel>
            <form onSubmit={handleCreate} className="space-y-4">
              <FormField
                label="Account name"
                value={name}
                onChange={setName}
                placeholder="e.g. Venice Marina"
              />
              <FormField
                label="First admin user id (optional)"
                value={adminUserId}
                onChange={setAdminUserId}
                placeholder="Logto sub — leave blank to make yourself the admin"
              />
              <FormFooter
                msg={msg}
                submitting={submitting}
                label="Create account"
              />
            </form>
          </CreatePanel>
        )}

        {!showCreate && msg && <StatusBanner msg={msg} />}
        {loadError && (
          <p className="mb-0 rounded-lg bg-live/10 px-3.5 py-2.5 text-sm text-live">
            {loadError}
          </p>
        )}

        <DataList
          loading={loading}
          empty={!loadError && sorted.length === 0}
          emptyIcon={Building2}
          emptyText="No accounts yet"
        >
          {sorted.map((a, i) => (
            <div
              key={a.account_id}
              className="flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:px-5"
              style={staggerStyle(i)}
            >
              <Building2 size={18} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mb-0 truncate font-display text-sm font-semibold text-text sm:text-body">
                    {a.personal ? 'Personal' : a.name}
                  </p>
                  <span className="mono-label">#{a.account_id}</span>
                </div>
                <p className="mb-0 mt-0.5 truncate text-xs text-subtext0">
                  {a.personal && a.personal_owner_id
                    ? `${a.personal_owner_id} · `
                    : ''}
                  {a.member_count} member{a.member_count === 1 ? '' : 's'}{' '}
                  &middot; {a.sublocation_count} location
                  {a.sublocation_count === 1 ? '' : 's'} &middot;{' '}
                  {a.video_count} camera{a.video_count === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          ))}
        </DataList>
      </div>

      <MovePanel
        accounts={accounts}
        videos={videos}
        sublocations={sublocations}
        onMoved={load}
      />
    </div>
  )
}

/* ──── Move a camera or location into an account ──── */

function accountLabel(a: AdminAccount): string {
  return `${a.personal ? 'Personal' : a.name} (#${a.account_id})`
}

function MovePanel({
  accounts,
  videos,
  sublocations,
  onMoved,
}: {
  accounts: Array<AdminAccount>
  videos: Array<Video>
  sublocations: Array<Sublocation>
  onMoved: () => Promise<void>
}) {
  const { getToken } = useAuth()

  const accountOptions = accounts.map((a) => ({
    value: a.account_id,
    label: accountLabel(a),
  }))
  const videoOptions = [...videos]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((v) => ({
      value: v.video_id,
      label:
        (v.sublocation_name ? `${v.title} — ${v.sublocation_name}` : v.title) +
        (isPrivateCamera(v) ? ' (private)' : ''),
    }))
  const locationOptions = [...sublocations]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      value: s.sublocation_id,
      label: s.visibility === 'private' ? `${s.name} (private)` : s.name,
    }))

  const [videoId, setVideoId] = useState<number | ''>('')
  const [videoAccount, setVideoAccount] = useState<number | ''>('')
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoMsg, setVideoMsg] = useState<FormMsg>(null)
  useAutoHide(videoMsg, setVideoMsg)

  const [locationId, setLocationId] = useState<number | ''>('')
  const [locationAccount, setLocationAccount] = useState<number | ''>('')
  const [locationBusy, setLocationBusy] = useState(false)
  const [locationMsg, setLocationMsg] = useState<FormMsg>(null)
  useAutoHide(locationMsg, setLocationMsg)

  const moveVideo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!videoId || !videoAccount) {
      setVideoMsg({ text: 'Pick a camera and an account.', ok: false })
      return
    }
    setVideoBusy(true)
    setVideoMsg(null)
    try {
      const token = await getToken()
      await moveVideoToAccount(Number(videoId), Number(videoAccount), token)
      setVideoMsg({ text: 'Camera moved.', ok: true })
      setVideoId('')
      await onMoved()
    } catch (err) {
      setVideoMsg({
        text: err instanceof Error ? err.message : 'Failed to move camera.',
        ok: false,
      })
    } finally {
      setVideoBusy(false)
    }
  }

  const moveLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!locationId || !locationAccount) {
      setLocationMsg({ text: 'Pick a location and an account.', ok: false })
      return
    }
    setLocationBusy(true)
    setLocationMsg(null)
    try {
      const token = await getToken()
      await moveSublocationToAccount(
        Number(locationId),
        Number(locationAccount),
        token,
      )
      setLocationMsg({ text: 'Location and its cameras moved.', ok: true })
      setLocationId('')
      await onMoved()
    } catch (err) {
      setLocationMsg({
        text: err instanceof Error ? err.message : 'Failed to move location.',
        ok: false,
      })
    } finally {
      setLocationBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel padding="lg">
        <form onSubmit={moveVideo} className="space-y-4">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-accent" />
            <h3 className="mb-0 font-display text-body font-semibold text-text">
              Move a camera
            </h3>
          </div>
          <SelectField
            label="Camera"
            options={videoOptions}
            selectedValue={videoId}
            onSelect={(v) => setVideoId(Number(v))}
          />
          <SelectField
            label="Into account"
            options={accountOptions}
            selectedValue={videoAccount}
            onSelect={(v) => setVideoAccount(Number(v))}
          />
          <MoveFooter msg={videoMsg} busy={videoBusy} label="Move camera" />
        </form>
      </Panel>
      <Panel padding="lg">
        <form onSubmit={moveLocation} className="space-y-4">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-accent" />
            <h3 className="mb-0 font-display text-body font-semibold text-text">
              Move a location
            </h3>
          </div>
          <SelectField
            label="Location"
            options={locationOptions}
            selectedValue={locationId}
            onSelect={(v) => setLocationId(Number(v))}
          />
          <SelectField
            label="Into account"
            options={accountOptions}
            selectedValue={locationAccount}
            onSelect={(v) => setLocationAccount(Number(v))}
          />
          <p className="mb-0 text-xs text-subtext1">
            Every camera in the location moves with it, and members' now-stale
            camera picks are dropped.
          </p>
          <MoveFooter
            msg={locationMsg}
            busy={locationBusy}
            label="Move location"
          />
        </form>
      </Panel>
    </div>
  )
}

function MoveFooter({
  msg,
  busy,
  label,
}: {
  msg: FormMsg
  busy: boolean
  label: string
}) {
  return (
    <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1">{msg && <StatusBanner msg={msg} />}</div>
      <Button type="submit" disabled={busy} className="shrink-0">
        {busy ? 'Moving...' : label}
      </Button>
    </div>
  )
}
