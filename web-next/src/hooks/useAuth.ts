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
    user,
    login,
    logout,
    getToken,
  }
}
