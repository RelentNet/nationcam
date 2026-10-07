import { createContext, useContext } from 'react'

export interface UserInfo {
  sub: string
  name: string | null
  picture: string | null
  email: string | null
  username: string | null
}

export interface AuthValue {
  isAuthenticated: boolean
  isLoading: boolean
  isAdmin: boolean
  isAdminLoading: boolean
  user: UserInfo | null
  login: () => void
  logout: () => void
  getToken: () => Promise<string | null>
}

/** Signed-out stand-in used until (unless) the Logto SDK is loaded. */
export const signedOutAuth: AuthValue = {
  isAuthenticated: false,
  isLoading: false,
  isAdmin: false,
  isAdminLoading: false,
  user: null,
  login: () => {},
  logout: () => {},
  getToken: () => Promise.resolve(null),
}

export const AuthContext = createContext<AuthValue>(signedOutAuth)

/**
 * Auth state and helpers. The Logto SDK is not in the main bundle: the real
 * implementation lives in components/auth/LogtoAuthSync.tsx and is mirrored
 * into this context by components/auth/AuthBridge.tsx, which documents when
 * the SDK loads.
 */
export function useAuth(): AuthValue {
  return useContext(AuthContext)
}
