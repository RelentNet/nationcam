import { useEffect } from 'react'
import posthog from 'posthog-js'

// Public, write-only project key — safe to ship to the browser.
const PROJECT_KEY = 'phc_pnHFQQH9uQ5CeB9rFqjPkVPA2jEDd9osryzL5W7mniYn'
const API_HOST = 'https://us.i.posthog.com'

let started = false

/**
 * Client-only PostHog bootstrap, rendered once in the root shell. The effect
 * never runs during SSR, so posthog-js never touches `window` on the server.
 * `defaults` enables autocapture plus automatic SPA pageviews/pageleaves, so
 * TanStack Router navigations are tracked with no per-route wiring. Only runs
 * in production builds so local/dev traffic stays out of analytics.
 */
export default function PostHogInit() {
  useEffect(() => {
    if (started || !import.meta.env.PROD) return
    started = true
    posthog.init(PROJECT_KEY, {
      api_host: API_HOST,
      defaults: '2026-06-25',
      person_profiles: 'identified_only',
    })
  }, [])
  return null
}
