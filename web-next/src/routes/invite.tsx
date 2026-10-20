import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, LogIn } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import Button, { buttonClasses } from '@/components/Button'
import Panel from '@/components/ui/Panel'
import { InviteError, acceptInvite } from '@/lib/api'
import {
  clearInviteToken,
  readStoredInviteToken,
  storeInviteToken,
  tokenFromHash,
} from '@/lib/inviteToken'

// An invite link is /invite#t=<token>. The token is in the fragment so it
// never reaches a server log or a Referer; this page parks it in
// sessionStorage (to survive the Logto round trip), strips it from the
// address bar, and POSTs it in a request body. Behind Logto sign-in and
// browser-only, so no server render.
export const Route = createFileRoute('/invite')({
  ssr: false,
  component: InvitePage,
})

type Outcome =
  | { kind: 'working' }
  | { kind: 'joined' }
  | { kind: 'failed'; message: string; retry: boolean }

function InvitePage() {
  const { isAuthenticated, isLoading, login, getToken } = useAuth()

  // `undefined` until the fragment/sessionStorage have been read.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'working' })

  useEffect(() => {
    const fromHash = tokenFromHash(window.location.hash)
    if (fromHash) {
      storeInviteToken(fromHash)
      // Drop the token from the address bar and history entry.
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      )
      setToken(fromHash)
    } else {
      setToken(readStoredInviteToken())
    }
  }, [])

  // The Logto SDK flips isLoading around every call it makes; only the first
  // settle matters here (same guard as /dashboard and /admin).
  const authSettled = useRef(false)
  if (!isLoading) authSettled.current = true

  const started = useRef(false)
  const attempt = async (inviteToken: string) => {
    setOutcome({ kind: 'working' })
    try {
      const access = await getToken()
      await acceptInvite(inviteToken, access)
      clearInviteToken()
      setOutcome({ kind: 'joined' })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not accept this invite.'
      // 404 unknown, 409 used / already a member, 410 expired: the token is
      // dead, so stop carrying it around. Anything else may be retried.
      const dead =
        err instanceof InviteError &&
        (err.status === 404 || err.status === 409 || err.status === 410)
      if (dead) clearInviteToken()
      setOutcome({ kind: 'failed', message, retry: !dead })
    }
  }

  useEffect(() => {
    if (!authSettled.current || !isAuthenticated || !token) return
    if (started.current) return
    started.current = true
    attempt(token)
  }, [isAuthenticated, isLoading, token])

  if (token === undefined || !authSettled.current) {
    return (
      <Centered>
        <Loader2 size={22} className="animate-spin text-subtext0" />
      </Centered>
    )
  }

  if (!token && outcome.kind === 'working') {
    return (
      <Centered>
        <Card
          icon={<AlertCircle size={24} className="text-live" />}
          title="No invite found"
          body="This link is missing its invite code. Ask the person who invited you to send the link again."
        />
      </Centered>
    )
  }

  if (!isAuthenticated) {
    return (
      <Centered>
        <Card
          icon={<LogIn size={24} className="text-accent" />}
          title="You've been invited"
          body="Sign in to join the account. Your invite stays ready while you sign in."
        >
          <Button size="lg" block onClick={login}>
            Sign In
          </Button>
        </Card>
      </Centered>
    )
  }

  if (outcome.kind === 'joined') {
    return (
      <Centered>
        <Card
          icon={<CheckCircle2 size={24} className="text-teal" />}
          title="You've joined"
          body="The account is now on your dashboard, with the cameras and locations you were given access to."
        >
          <Link
            to="/dashboard"
            className={buttonClasses({
              variant: 'primary',
              size: 'lg',
              block: true,
            })}
          >
            Go to dashboard
          </Link>
        </Card>
      </Centered>
    )
  }

  if (outcome.kind === 'failed') {
    return (
      <Centered>
        <Card
          icon={<AlertCircle size={24} className="text-live" />}
          title="Could not join"
          body={outcome.message}
        >
          {outcome.retry && token ? (
            <Button size="lg" block onClick={() => attempt(token)}>
              Try again
            </Button>
          ) : (
            <Link
              to="/dashboard"
              className={buttonClasses({
                variant: 'secondary',
                size: 'lg',
                block: true,
              })}
            >
              Go to dashboard
            </Link>
          )}
        </Card>
      </Centered>
    )
  }

  return (
    <Centered>
      <Card
        icon={<Loader2 size={24} className="animate-spin text-accent" />}
        title="Joining..."
        body="Accepting your invite."
      />
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      {children}
    </div>
  )
}

function Card({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode
  title: string
  body: string
  children?: React.ReactNode
}) {
  return (
    <div
      className="w-full max-w-sm"
      style={{
        opacity: 0,
        animation: 'scale-fade-in 400ms var(--spring-poppy) forwards',
      }}
    >
      <Panel accentTop padding="lg">
        <div
          className={`flex flex-col items-center gap-3 text-center ${children ? 'mb-6' : ''}`}
        >
          {icon}
          <h2 className="mb-0 font-display text-h3">{title}</h2>
          <p className="mb-0 text-sm text-subtext1">{body}</p>
        </div>
        {children}
      </Panel>
    </div>
  )
}
