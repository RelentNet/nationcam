import {
  HeadContent,
  Scripts,
  createRootRoute,
  useMatches,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { useEffect } from 'react'

import BannerSlot from '@/components/BannerSlot'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import GrainOverlay from '@/components/GrainOverlay'
import ThemeProvider, { themeInitScript } from '@/components/ThemeProvider'
import LogtoProvider from '@/components/LogtoProvider'
import PostHogInit from '@/lib/posthog'

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
      // AdSense site-ownership verification ("Meta tag" method). Harmless on
      // app surfaces, and a <meta> is hoisted, so it never disturbs hydration.
      { name: 'google-adsense-account', content: 'ca-pub-7286243668972753' },
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

/**
 * Google AdSense publisher ID. Public by design (it is in every page's HTML and
 * in /ads.txt), so it is committed rather than injected. Change it here and in
 * `public/ads.txt` together.
 */
export const ADSENSE_CLIENT = 'ca-pub-7286243668972753'

/**
 * Dashboard, admin and the sign-in callback are app surfaces, not content:
 * they render full-width with no ad slots and no AdSense loader.
 */
export function isAppSurface(pathname: string): boolean {
  return /^\/(dashboard|admin|callback)(\/|$)/.test(pathname)
}

/**
 * The embeddable host widget (DAN-33): a self-contained card meant to sit
 * inside another site's `<iframe>`. It renders through the same root route
 * as everything else (TanStack Start has one shell per app), so `RootDocument`
 * strips the navbar/footer/ad slots/AdSense loader/PostHog/devtools for it
 * instead of standing up a second document shell.
 */
export function isEmbedSurface(pathname: string): boolean {
  return /^\/embed(\/|$)/.test(pathname)
}

/**
 * Loads the AdSense library once, from an effect, on the first public page
 * the visitor reaches. Deliberately NOT a server-rendered `<script async src>`:
 * when the library runs it inserts its own script before the first <script>
 * in the document, and if that happens before React has hydrated <head> it
 * lands ahead of the inline scripts React matches by position (the theme init
 * script, JSON-LD) and mispairs every one of them. Loading after hydration
 * makes that impossible. Site ownership is verified server-side through the
 * `google-adsense-account` meta tag and /ads.txt, so Google does not need the
 * literal snippet in the HTML.
 */
function AdSenseLoader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => {
    if (isAppSurface(pathname) || isEmbedSurface(pathname)) return
    if (document.querySelector('script[src*="adsbygoogle.js"]')) return
    const s = document.createElement('script')
    s.async = true
    s.crossOrigin = 'anonymous'
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`
    document.head.appendChild(s)
  }, [pathname])
  return null
}

/** `?theme=` on an `/embed/*` URL — anything but `light` is dark (the widget's
 *  default). Read from the raw query string, not the child route's parsed
 *  search, so this has no dependency on that route's `validateSearch` shape. */
function embedTheme(searchStr: string): 'dark' | 'light' {
  return new URLSearchParams(searchStr).get('theme') === 'light'
    ? 'light'
    : 'dark'
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })

  // The embed widget (DAN-33) renders through a bare document: no navbar,
  // footer, ad slots/AdSense, PostHog or devtools, and its theme comes from
  // the `?theme=` query param rather than localStorage — a host's page must
  // render the same for every visitor, not whatever the visitor last picked
  // on nationcam.com. `html.dark` is what the Observatory theme's CSS
  // variables key off (see styles.css), so it's set directly here instead of
  // going through `themeInitScript`/`ThemeProvider`, both of which read
  // localStorage.
  if (isEmbedSurface(pathname)) {
    const theme = embedTheme(searchStr)
    return (
      <html
        lang="en"
        className={theme === 'dark' ? 'dark' : ''}
        suppressHydrationWarning
      >
        <head>
          <HeadContent />
        </head>
        <body>
          {children}
          <Scripts />
        </body>
      </html>
    )
  }

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
        <PostHogInit />
        <AdSenseLoader />
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
function adScopeFromMatches(matches: ReturnType<typeof useMatches>): AdScope {
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
 * Page body with banner ad slots in reserved in-flow gutter columns on wide
 * screens plus one mobile slot below the content. The gutter columns are
 * reserved space, never overlays: they take their own width beside the content,
 * and on wide screens they stick just below the navbar so a sold banner stays on
 * screen while the page scrolls (the same treatment the state and sublocation
 * sidebars already use). Each `BannerSlot` renders nothing until an ad is sold,
 * so empty gutters just stay empty. Dashboard/admin/auth surfaces render
 * full-width with no ad slots.
 */
function PageBody({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const matches = useMatches()

  if (isAppSurface(pathname)) {
    return <main className="pt-14">{children}</main>
  }

  const scope = adScopeFromMatches(matches)
  // `self-start` + `h-fit` keep the column shorter than the flex row, which is
  // what lets `sticky` engage; `top-20` clears the 56px navbar with a margin.
  const gutter =
    'hidden h-fit w-40 shrink-0 self-start pt-3 xl:sticky xl:top-20 xl:block'

  return (
    <main className="pt-14">
      <div className="relative mx-auto flex w-full justify-center gap-6 xl:px-6">
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
