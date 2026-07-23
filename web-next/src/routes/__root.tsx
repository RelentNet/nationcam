import {
  HeadContent,
  Scripts,
  createRootRoute,
  useMatches,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import BannerSlot from '@/components/BannerSlot'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import GrainOverlay from '@/components/GrainOverlay'
import ThemeProvider, { themeInitScript } from '@/components/ThemeProvider'
import LogtoProvider from '@/components/LogtoProvider'

import appCss from '@/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'NationCam' },
      {
        name: 'description',
        content:
          'Live cameras from across the United States. Explore cities, landmarks, and communities through real-time video feeds.',
      },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The theme class is rewritten by themeInitScript before first paint, so
    // the server-rendered value is only a default — don't warn about the diff.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Must run before the body paints, so it lives here rather than in
            <Scripts />, which renders at the end of the body. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {/* Logto's browser client is SSR-safe (its storage no-ops without a
            `window`) and starts in the loading state on both sides, so the
            provider can wrap the server-rendered shell without a mismatch. */}
        <LogtoProvider>
          <ThemeProvider>
            <GrainOverlay />
            <Navbar />
            <PageBody>{children}</PageBody>
            <Footer />
          </ThemeProvider>
        </LogtoProvider>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

type AdScope = {
  videoId?: number
  sublocationId?: number
  stateId?: number
}

/**
 * Derive the banner page scope from the active route's loader data, so a single
 * set of slots in the root layout can target every page type without each page
 * wiring its own: camera pages expose `camera.video_id`, sublocation pages
 * `sublocation.sublocation_id`, state pages `state.state_id`, and everything
 * else (home, contact) falls through to house/global. Deepest match wins.
 */
function adScopeFromMatches(
  matches: ReturnType<typeof useMatches>,
): AdScope {
  for (let i = matches.length - 1; i >= 0; i--) {
    const data = matches[i].loaderData as Record<string, unknown> | undefined
    if (!data) continue
    const camera = data.camera as { video_id?: number } | undefined
    if (camera?.video_id) return { videoId: camera.video_id }
    const sub = data.sublocation as { sublocation_id?: number } | undefined
    if (sub?.sublocation_id) return { sublocationId: sub.sublocation_id }
    const state = data.state as { state_id?: number } | undefined
    if (state?.state_id) return { stateId: state.state_id }
  }
  return {}
}

/**
 * Page body with banner ad slots in reserved sticky gutter columns on wide
 * screens (they scroll with the page in their own space rather than hovering
 * over content) plus one in-flow mobile slot below the content. Gutters are
 * dimmed until hovered so an ad never dominates the page. Each `BannerSlot`
 * renders nothing until an ad is sold, so empty gutters just stay empty.
 * Dashboard/admin/auth surfaces render full-width with no ad slots.
 */
function PageBody({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const matches = useMatches()

  if (/^\/(dashboard|admin|callback)(\/|$)/.test(pathname)) {
    return <main className="pt-14">{children}</main>
  }

  const scope = adScopeFromMatches(matches)
  const gutter =
    'sticky top-20 hidden h-fit w-40 shrink-0 self-start opacity-60 transition-opacity duration-200 hover:opacity-100 xl:block'

  return (
    <main className="pt-14">
      <div className="relative mx-auto flex w-full justify-center gap-6">
        <div className={gutter}>
          <BannerSlot placement="left" {...scope} />
        </div>
        <div className="min-w-0 flex-1">{children}</div>
        <div className={gutter}>
          <BannerSlot placement="right" {...scope} />
        </div>
      </div>
      <BannerSlot
        placement="mobile"
        {...scope}
        className="mx-auto mb-10 flex justify-center px-4 xl:hidden"
      />
    </main>
  )
}
