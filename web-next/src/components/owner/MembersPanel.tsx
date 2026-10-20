import { useEffect, useId, useMemo, useState } from 'react'
import { Check, Copy, Link2, Pencil, UserMinus, Users } from 'lucide-react'
import type {
  AccountMember,
  AccountRole,
  CreatedInvite,
  MemberSelectionInput,
  OwnerVideo,
} from '@/lib/types'
import type { FormMsg } from '@/components/dashboardUi'
import {
  ActionBtn,
  CreatePanel,
  DataList,
  FormFooter,
  ModalShell,
  PanelHeader,
  SelectField,
  ToggleRow,
  staggerStyle,
  useAutoHide,
} from '@/components/dashboardUi'
import Button, { buttonClasses } from '@/components/Button'
import {
  createAccountInvite,
  fetchAccountMembers,
  removeAccountMember,
  updateAccountMember,
} from '@/lib/api'
import { RolePill } from '@/components/owner/ownerUi'
import { inviteLink } from '@/lib/inviteToken'
import { useAuth } from '@/hooks/useAuth'

/* ════════════════════════════════════════════════
   Members Panel (DAN-382) — an account admin's view
   of who is in the account: list, change role and
   camera access, remove, and create single-use invite
   links. Members are shown by Logto sub only (names
   need the optional Logto management connection).
   Leaving the account lives on the account header.
   ════════════════════════════════════════════════ */

const ROLE_OPTIONS: Array<{ value: AccountRole; label: string }> = [
  { value: 'viewer', label: 'Viewer — watches cameras, changes nothing' },
  { value: 'admin', label: 'Admin — manages cameras, locations and members' },
]

function accessText(m: {
  role: AccountRole
  all_cameras: boolean
  video_ids: Array<number>
}): string {
  if (m.role === 'admin' || m.all_cameras) return 'All cameras'
  const n = m.video_ids.length
  return n === 0
    ? 'No cameras picked'
    : `${n} picked camera${n === 1 ? '' : 's'}`
}

/** Checkbox list of the account's cameras — a restricted viewer's picks. */
function CameraPicker({
  cameras,
  picked,
  onChange,
}: {
  cameras: Array<OwnerVideo>
  picked: Array<number>
  onChange: (ids: Array<number>) => void
}) {
  const sorted = useMemo(
    () => [...cameras].sort((a, b) => a.title.localeCompare(b.title)),
    [cameras],
  )
  if (sorted.length === 0) {
    return (
      <p className="mb-0 text-xs text-subtext0">
        This account has no cameras to pick yet.
      </p>
    )
  }
  const toggle = (id: number) =>
    onChange(
      picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id],
    )
  return (
    <fieldset className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border-input bg-base p-2">
      <legend className="sr-only">Cameras this person can watch</legend>
      {sorted.map((c) => (
        <label
          key={c.video_id}
          className="flex cursor-pointer items-start gap-2.5 rounded px-2 py-1.5 text-sm text-text hover:bg-surface1/60"
        >
          <input
            type="checkbox"
            className="mt-0.5 accent-(--color-accent)"
            checked={picked.includes(c.video_id)}
            onChange={() => toggle(c.video_id)}
          />
          <span className="min-w-0">
            <span className="block truncate">{c.title}</span>
            {c.sublocation_name && (
              <span className="block truncate text-xs text-subtext0">
                {c.sublocation_name}
              </span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** Role + camera-access controls shared by the edit modal and invite form. */
function SelectionFields({
  value,
  cameras,
  onChange,
}: {
  value: MemberSelectionInput
  cameras: Array<OwnerVideo>
  onChange: (v: MemberSelectionInput) => void
}) {
  return (
    <div className="space-y-4">
      <SelectField
        label="Role"
        options={ROLE_OPTIONS}
        selectedValue={value.role}
        onSelect={(r) =>
          onChange({
            ...value,
            role: r as AccountRole,
            // An admin always sees every camera.
            all_cameras: r === 'admin' ? true : value.all_cameras,
          })
        }
      />
      {value.role === 'viewer' && (
        <>
          <ToggleRow
            label="Can watch every camera"
            description="Includes cameras added to the account later"
            checked={value.all_cameras}
            onChange={(v) => onChange({ ...value, all_cameras: v })}
          />
          {!value.all_cameras && (
            <CameraPicker
              cameras={cameras}
              picked={value.video_ids}
              onChange={(ids) => onChange({ ...value, video_ids: ids })}
            />
          )}
        </>
      )}
    </div>
  )
}

export default function MembersPanel({
  accountId,
  accountName,
  cameras,
  currentUserId,
}: {
  accountId: number
  accountName: string
  /** This account's cameras (from GET /me/videos) for the picker. */
  cameras: Array<OwnerVideo>
  currentUserId: string | null
}) {
  const { getToken } = useAuth()

  const [members, setMembers] = useState<Array<AccountMember>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    try {
      const token = await getToken()
      setMembers(await fetchAccountMembers(accountId, token))
      setLoadError(null)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load members.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [accountId])

  const [rowMsg, setRowMsg] = useState<FormMsg>(null)
  useAutoHide(rowMsg, setRowMsg)
  const [editing, setEditing] = useState<AccountMember | null>(null)
  const [removing, setRemoving] = useState<AccountMember | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [invite, setInvite] = useState<CreatedInvite | null>(null)

  const sorted = useMemo(
    () =>
      [...members].sort(
        (a, b) =>
          Number(b.role === 'admin') - Number(a.role === 'admin') ||
          a.user_id.localeCompare(b.user_id),
      ),
    [members],
  )

  return (
    <>
      <div className="space-y-4">
        <PanelHeader
          title="Members"
          subtitle={`Who can see ${accountName}, and what they can do. Invite links are single-use and expire after 7 days.`}
          showCreate={showInvite}
          onToggleCreate={() => {
            setShowInvite(!showInvite)
          }}
          createLabel="Invite someone"
        />

        {invite && (
          <InviteResult invite={invite} onDismiss={() => setInvite(null)} />
        )}

        {showInvite && !invite && (
          <InviteForm
            accountId={accountId}
            cameras={cameras}
            onCreated={(created) => {
              setInvite(created)
              setShowInvite(false)
            }}
          />
        )}

        {loadError && (
          <p className="mb-0 rounded-lg bg-live/10 px-3.5 py-2.5 text-sm text-live">
            {loadError}
          </p>
        )}
        {rowMsg && (
          <p
            className={`mb-0 rounded-lg px-3.5 py-2.5 text-sm ${
              rowMsg.ok ? 'bg-teal/10 text-teal' : 'bg-live/10 text-live'
            }`}
          >
            {rowMsg.text}
          </p>
        )}

        <DataList
          loading={loading}
          empty={!loadError && sorted.length === 0}
          emptyIcon={Users}
          emptyText="No members yet"
        >
          {sorted.map((m, i) => (
            <div
              key={m.user_id}
              className="flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface1/40 sm:px-5"
              style={staggerStyle(i)}
            >
              <Users size={18} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className="mb-0 truncate font-mono text-sm text-text"
                    title={m.user_id}
                  >
                    {m.user_id}
                  </p>
                  <RolePill role={m.role} />
                  {m.user_id === currentUserId && (
                    <span className="mono-label">You</span>
                  )}
                </div>
                <p className="mb-0 mt-0.5 text-xs text-subtext0">
                  {accessText(m)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ActionBtn
                  icon={Pencil}
                  onClick={() => setEditing(m)}
                  label="Change role or cameras"
                />
                {m.user_id !== currentUserId && (
                  <ActionBtn
                    icon={UserMinus}
                    onClick={() => setRemoving(m)}
                    label="Remove from account"
                    variant="danger"
                  />
                )}
              </div>
            </div>
          ))}
        </DataList>
      </div>

      {editing && (
        <EditMemberModal
          accountId={accountId}
          member={editing}
          cameras={cameras}
          onSuccess={() => {
            setEditing(null)
            setRowMsg({ text: 'Member updated.', ok: true })
            load()
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <RemoveMemberDialog
          accountId={accountId}
          member={removing}
          onDone={(err) => {
            setRemoving(null)
            setRowMsg(
              err
                ? { text: err, ok: false }
                : { text: 'Member removed.', ok: true },
            )
            load()
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  )
}

/* ──── Edit member ──── */

function EditMemberModal({
  accountId,
  member,
  cameras,
  onSuccess,
  onClose,
}: {
  accountId: number
  member: AccountMember
  cameras: Array<OwnerVideo>
  onSuccess: () => void
  onClose: () => void
}) {
  const { getToken } = useAuth()
  const [sel, setSel] = useState<MemberSelectionInput>({
    role: member.role,
    all_cameras: member.role === 'admin' ? true : member.all_cameras,
    video_ids: member.video_ids,
  })
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      await updateAccountMember(accountId, member.user_id, sel, token)
      onSuccess()
    } catch (err) {
      // e.g. 409 when this would demote the account's last admin.
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to update member.',
        ok: false,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Change access" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="mb-0 break-all font-mono text-xs text-subtext1">
          {member.user_id}
        </p>
        <SelectionFields value={sel} cameras={cameras} onChange={setSel} />
        <FormFooter msg={msg} submitting={submitting} label="Save changes" />
      </form>
    </ModalShell>
  )
}

/* ──── Remove member ──── */

function RemoveMemberDialog({
  accountId,
  member,
  onDone,
  onCancel,
}: {
  accountId: number
  member: AccountMember
  /** `err` is the API's message when the removal failed. */
  onDone: (err: string | null) => void
  onCancel: () => void
}) {
  const { getToken } = useAuth()
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      const token = await getToken()
      await removeAccountMember(accountId, member.user_id, token)
      onDone(null)
    } catch (err) {
      onDone(err instanceof Error ? err.message : 'Failed to remove member.')
    }
  }

  return (
    <ModalShell title="Remove member" onClose={onCancel}>
      <p className="mb-5 text-sm text-subtext1">
        Remove{' '}
        <span className="break-all font-mono text-xs text-text">
          {member.user_id}
        </span>{' '}
        from this account? They lose access immediately; you can invite them
        again later.
      </p>
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
          {busy ? 'Removing...' : 'Remove'}
        </button>
      </div>
    </ModalShell>
  )
}

/* ──── Invite someone ──── */

function InviteForm({
  accountId,
  cameras,
  onCreated,
}: {
  accountId: number
  cameras: Array<OwnerVideo>
  onCreated: (invite: CreatedInvite) => void
}) {
  const { getToken } = useAuth()
  const [sel, setSel] = useState<MemberSelectionInput>({
    role: 'viewer',
    all_cameras: true,
    video_ids: [],
  })
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<FormMsg>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (
      sel.role === 'viewer' &&
      !sel.all_cameras &&
      sel.video_ids.length === 0
    ) {
      setMsg({
        text: 'Pick at least one camera, or allow all cameras.',
        ok: false,
      })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      const token = await getToken()
      onCreated(await createAccountInvite(accountId, sel, token))
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : 'Failed to create invite.',
        ok: false,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <CreatePanel>
      <form onSubmit={handleSubmit} className="space-y-4">
        <SelectionFields value={sel} cameras={cameras} onChange={setSel} />
        <FormFooter
          msg={msg}
          submitting={submitting}
          label="Create invite link"
        />
      </form>
    </CreatePanel>
  )
}

/** The one-time reveal of a new invite link. The token lives only in this
 *  component's props: nothing writes it to storage, and dismissing drops it. */
function InviteResult({
  invite,
  onDismiss,
}: {
  invite: CreatedInvite
  onDismiss: () => void
}) {
  const id = useId()
  const [copied, setCopied] = useState(false)
  const link = inviteLink(window.location.origin, invite.token)

  const copy = () => {
    navigator.clipboard.writeText(link).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <CreatePanel>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-accent" />
          <h3 className="mb-0 font-display text-body font-semibold text-text">
            Invite link ready
          </h3>
        </div>
        <label htmlFor={id} className="sr-only">
          Invite link
        </label>
        <div className="flex items-start gap-2 rounded-xl border border-border bg-base p-3">
          <code
            id={id}
            className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap text-text"
          >
            {link}
          </code>
          <button
            type="button"
            onClick={copy}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-input text-subtext1 transition-colors duration-150 hover:border-accent hover:text-accent-ink"
            title={copied ? 'Copied!' : 'Copy invite link'}
            aria-label="Copy invite link"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <p className="mb-0 text-xs text-subtext1">
          Joins as <span className="font-medium text-text">{invite.role}</span>{' '}
          ({accessText(invite).toLowerCase()}). Works once, expires{' '}
          {new Date(invite.expires_at).toLocaleDateString()}. This link is shown
          only now — copy it before you close this box; if you lose it, create
          another.
        </p>
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </CreatePanel>
  )
}
