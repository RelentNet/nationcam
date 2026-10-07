import { createFileRoute } from '@tanstack/react-router'

// The OIDC code exchange reads the URL fragment and sessionStorage, so this
// only ever runs in the browser. The exchange itself runs inside the lazily
// loaded Logto module (components/auth/LogtoAuthSync.tsx, CallbackRunner),
// which redirects to /dashboard when it completes.
export const Route = createFileRoute('/callback')({
  ssr: false,
  component: CallbackPage,
})

function CallbackPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-subtext0">Signing in...</p>
    </div>
  )
}
