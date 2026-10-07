import { useRouterState } from '@tanstack/react-router'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { AuthValue } from '@/hooks/useAuth'
import { AuthContext, signedOutAuth } from '@/hooks/useAuth'
import {
  clearSignedInHint,
  hasSignedInHint,
  setSignedInHint,
} from '@/lib/authHint'

// The only reference to the Logto SDK on public pages, and it is dynamic.
const LogtoAuthSync = lazy(() => import('@/components/auth/LogtoAuthSync'))

function isAuthPath(pathname: string): boolean {
  return (
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/callback'
  )
}

/**
 * Lightweight auth context for every page. It reports signed-out until the
 * Logto SDK is needed, and loads the SDK (lazily, once, sticky) when:
 *  - the route is /dashboard, /admin or /callback,
 *  - this browser carries the signed-in hint (lib/authHint.ts), or
 *  - the visitor clicks Sign In (the click queues a login that runs as soon
 *    as the SDK is ready).
 * Children are never remounted when the SDK arrives; the real state is
 * mirrored in through context.
 */
export default function AuthBridge({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const onAuthRoute = isAuthPath(pathname)
  const [enabled, setEnabled] = useState(false)
  const [pendingLogin, setPendingLogin] = useState(false)
  const [real, setReal] = useState<AuthValue | null>(null)

  useEffect(() => {
    if (enabled) return
    if (onAuthRoute || hasSignedInHint()) setEnabled(true)
  }, [enabled, onAuthRoute])

  const onValue = useCallback((v: AuthValue) => {
    setReal(v)
    if (!v.isLoading) {
      if (v.isAuthenticated) setSignedInHint()
      else clearSignedInHint()
    }
  }, [])
  const onLoginHandled = useCallback(() => setPendingLogin(false), [])

  const value = useMemo<AuthValue>(() => {
    if (real) return real
    const loading = onAuthRoute || enabled
    return {
      ...signedOutAuth,
      isLoading: loading,
      isAdminLoading: loading,
      login: () => {
        setPendingLogin(true)
        setEnabled(true)
      },
    }
  }, [real, onAuthRoute, enabled])

  return (
    <AuthContext.Provider value={value}>
      {enabled ? (
        <Suspense fallback={null}>
          <LogtoAuthSync
            onValue={onValue}
            isCallback={pathname === '/callback'}
            pendingLogin={pendingLogin}
            onLoginHandled={onLoginHandled}
          />
        </Suspense>
      ) : null}
      {children}
    </AuthContext.Provider>
  )
}
