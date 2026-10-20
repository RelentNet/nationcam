// An invite link is /invite#t=<token>. The token lives in the URL fragment
// (never sent to a server, never in the query string) and is parked in
// sessionStorage while the visitor signs in, so the round trip through Logto
// can bring them back to /invite. It is removed the moment the invite is
// accepted or found dead.
const KEY = 'nc_invite_token'

export function readStoredInviteToken(): string | null {
  try {
    return window.sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function storeInviteToken(token: string): void {
  try {
    window.sessionStorage.setItem(KEY, token)
  } catch {
    /* storage unavailable: the token then only survives while the fragment does */
  }
}

export function clearInviteToken(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Pulls `t=` out of a location hash like `#t=abc`. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const t = params.get('t')
  return t && t.length > 0 ? t : null
}

/** The shareable link for a freshly created invite. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/invite#t=${encodeURIComponent(token)}`
}
