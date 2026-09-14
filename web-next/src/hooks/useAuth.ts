import { useLogto } from '@logto/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IdTokenClaims } from '@logto/react'

const API_RESOURCE =
  import.meta.env['VITE_LOGTO_API_RESOURCE'] ?? 'https://api.nationcam.com'

interface UserInfo {
  sub: string
  name: string | null
  picture: string | null
  email: string | null
  username: string | null
}

function claimsToUserInfo(claims: IdTokenClaims): UserInfo {
  return {
    sub: claims.sub,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
    email: claims.email ?? null,
    username: claims.username ?? null,
  }
}

/**
 * Read the space-separated `scope` claim out of an API access token (a JWT).
 * No signature verification — this is UI gating only; the backend still enforces
 * admin access via RequireAdmin. Fails closed (empty scopes) on any malformed
 * token or decode error.
 */
function tokenScopes(token: string): Array<string> {
  try {
    const payload = token.split('.')[1]
    if (!payload) return []
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json) as { scope?: unknown }
    return typeof claims.scope === 'string' ? claims.scope.split(' ') : []
  } catch {
    return []
  }
}

/**
 * Thin wrapper around @logto/react that exposes auth state, user info, and helpers.
 *
 * IMPORTANT: The Logto SDK wraps every method (getAccessToken, getIdTokenClaims,
 * etc.) in a proxy that calls setIsLoading(true/false). This means ANY call to
 * these methods causes isLoading to flicker, which can unmount components that
 * conditionally render based on isLoading. We use a ref guard to ensure
 * getIdTokenClaims is only called once per auth session.
 */
export function useAuth() {
  const {
    isAuthenticated,
    isLoading,
    signIn,
    signOut,
    getAccessToken,
    getIdTokenClaims,
  } = useLogto()

  const [user, setUser] = useState<UserInfo | null>(null)
  const claimsFetched = useRef(false)

  // Admin gate, derived from the API access token's `scope` claim. Starts
  // loading + closed (false), so the UI never shows admin-only content before
  // the scope has been checked.
  const [isAdmin, setIsAdmin] = useState(false)
  const [isAdminLoading, setIsAdminLoading] = useState(true)
  const scopeFetched = useRef(false)

  // When auth state settles, pull user info from the cached ID token claims.
  // The ref guard prevents re-calling getIdTokenClaims on isLoading flickers
  // (each call triggers setIsLoading(true/false) in the Logto SDK proxy).
  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      setUser(null)
      claimsFetched.current = false
      return
    }
    if (claimsFetched.current) return
    claimsFetched.current = true

    getIdTokenClaims().then((claims) => {
      if (!claims) return
      setUser(claimsToUserInfo(claims))
    })
  }, [isAuthenticated, isLoading, getIdTokenClaims])

  // Derive admin status from the access token's scope. Same ref-guard pattern as
  // above: getAccessToken flickers isLoading, so fetch the token only once per
  // auth session. Fail closed on any error.
  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      setIsAdmin(false)
      setIsAdminLoading(false)
      scopeFetched.current = false
      return
    }
    if (scopeFetched.current) return
    scopeFetched.current = true

    getAccessToken(API_RESOURCE)
      .then((token) => {
        setIsAdmin(token ? tokenScopes(token).includes('admin') : false)
      })
      .catch(() => setIsAdmin(false))
      .finally(() => setIsAdminLoading(false))
  }, [isAuthenticated, isLoading, getAccessToken])

  const login = useCallback(() => {
    signIn(`${window.location.origin}/callback`)
  }, [signIn])

  const logout = useCallback(() => {
    signOut(window.location.origin)
  }, [signOut])

  /** Get an access token scoped to our API resource. */
  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      return (await getAccessToken(API_RESOURCE)) ?? null
    } catch {
      return null
    }
  }, [getAccessToken])

  return {
    isAuthenticated,
    isLoading,
    isAdmin,
    isAdminLoading,
    user,
    login,
    logout,
    getToken,
  }
}
