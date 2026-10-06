/** Upper bound on how long to wait for an idle moment after `load`. */
const IDLE_TIMEOUT_MS = 4000

/**
 * Runs `fn` once the page has finished loading and the main thread is idle
 * (or `IDLE_TIMEOUT_MS` after `load`, whichever is first). Third-party scripts
 * that are not needed for first paint — analytics, the AdSense library — start
 * here so they never compete with the page's own scripts and its largest image
 * on a slow phone (DAN-239). Browser-only: call it from an effect. Safari has
 * no `requestIdleCallback`, so it falls back to a short timeout.
 */
export function afterLoadIdle(fn: () => void): void {
  const idle = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS })
    } else {
      setTimeout(fn, 200)
    }
  }
  if (document.readyState === 'complete') idle()
  else window.addEventListener('load', idle, { once: true })
}
